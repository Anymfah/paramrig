import { describe, expect, it } from 'vitest'
import { makeLayer, makeMod, makePatch, makePerformer } from '@paramrig/audio'
import { makeLabSound } from './design'
import { fuseSounds, fusionCompatibility, renderCandidate } from './generate'
import { DEFAULT_CRITERIA, fingerprint, type Contribution } from './model'
import { sanitizeLabSound } from './session'

const criteria = { ...DEFAULT_CRITERIA, minMs: 800, maxMs: 800 }
function pair() {
  const a = makeLabSound(makePatch(0.8, [makeLayer({ pitch: { start: 70 } })]), criteria, { kind: 'generated', recipe: 'growl', version: 1, seed: 1, parentIds: [] }, 'Principal')
  const b = makeLabSound(makePatch(0.8, [makeLayer({ pitch: { start: 300 }, amp: { attack: 0.02, hold: 0.3, decay: 0.2, sustain: 0.6, release: 0.15 } })]), { ...criteria, type: 'impact' }, { kind: 'generated', recipe: 'impact', version: 1, seed: 2, parentIds: [] }, 'Contributor')
  return { a, b }
}
const fuse = (a: ReturnType<typeof pair>['a'], b: ReturnType<typeof pair>['b'], contribution: Contribution) => fuseSounds({ mode: 'fuse', reference: a, contributor: b, criteria: a.criteria, contribution, seed: 31 }, 31)

describe('saved fusion sources', () => {
  it('verifies the serialized snapshot before canonical key ordering and new defaults', () => {
    const { a } = pair()
    const stored = JSON.parse(JSON.stringify(a))
    delete stored.patch.layers[0].source.pulseWidth
    stored.patch = Object.fromEntries(Object.entries(stored.patch).reverse())
    stored.fingerprint = fingerprint(stored.patch)
    const restored = sanitizeLabSound(stored)!
    expect(restored.roles).toEqual(a.roles)
    expect(restored.patch.layers[0]!.source.pulseWidth).toBeDefined()
    expect(restored.rolesInvalidated).toBeUndefined()
    expect(sanitizeLabSound(JSON.parse(JSON.stringify(restored)))!.roles).toEqual(a.roles)
  })
  it('recovers legacy Labs metadata without changing the stored audio', () => {
    const { a } = pair()
    a.roles = a.roles.map(() => 'unknown')
    const restored = sanitizeLabSound(a)!
    expect(restored.roles[0]).toBe('body')
    expect(restored.patch).toEqual(a.patch)
    expect(restored.id).toBe(a.id)
    expect(restored.origin).toEqual(a.origin)
    a.origin.kind = 'instrument'
    expect(sanitizeLabSound(a)!.roles.every((role) => role === 'unknown')).toBe(true)
  })
  it('does not revive invalidated role claims on a later reload', () => {
    const { a } = pair()
    a.patch.layers[0]!.pitch.start += 10
    const restored = sanitizeLabSound(a)!
    expect(restored.rolesInvalidated).toBe(true)
    expect(restored.roles.every((role) => role === 'unknown')).toBe(true)
    expect(sanitizeLabSound(JSON.parse(JSON.stringify(restored)))!.roles).toEqual(restored.roles)
  })
})

describe('fusion planning', () => {
  it('extracts a short attack from a body-only impact without moving the principal body', () => {
    const { a, b } = pair(), beforeA = structuredClone(a), beforeB = structuredClone(b)
    b.patch.performers[0] = makePerformer({ enabled: true, target: 'layers[0].gain', depth: 0.7 })
    b.fingerprint = fingerprint(b.patch)
    const contributor = structuredClone(b)
    expect(fusionCompatibility(a, b, 'attack')).toBeNull()
    const child = fuse(a, b, 'attack')
    expect(a).toEqual(beforeA); expect(b).toEqual(contributor)
    expect(child.patch.layers[0]).toEqual(a.patch.layers[0])
    const attack = child.patch.layers[1]!.amp
    expect(attack.attack + attack.hold + attack.decay + attack.release).toBeLessThanOrEqual(0.180001)
    expect(attack.sustain).toBe(0)
    expect(child.roles[1]).toBe('attack')
    expect(child.patch.performers.every((p) => !p.enabled)).toBe(true)
    expect(child.patch.layers[1]!.source).toEqual(beforeB.patch.layers[0]!.source)
    expect(renderCandidate(child, 16000)).not.toBeNull()
  })
  it('tries a smaller compatible group when the preferred PM group cannot fit', () => {
    const { a, b } = pair()
    a.patch.layers = [makeLayer(), makeLayer(), makeLayer(), a.patch.layers[3]!]
    a.roles = ['body', 'body', 'body', 'unknown']
    b.patch.layers = [makeLayer({ source: { pmFrom: 'layer1', fmIndex: 1 } }), makeLayer(), b.patch.layers[2]!, makeLayer({ pitch: { start: 900 } })]
    b.roles = ['texture', 'mechanism', 'unknown', 'texture']
    a.fingerprint = fingerprint(a.patch); b.fingerprint = fingerprint(b.patch)
    expect(fusionCompatibility(a, b, 'texture')).toBeNull()
    expect(fuse(a, b, 'texture').patch.layers[3]!.pitch.start).toBe(900)
  })
  it('preflights protected layer and modulation capacity with the same reason as execution', () => {
    const { a, b } = pair()
    a.patch.layers = Array.from({ length: 4 }, () => makeLayer()); a.roles = a.roles.map(() => 'body')
    a.fingerprint = fingerprint(a.patch)
    const issue = fusionCompatibility(a, b, 'attack')!
    expect(issue).toContain('do not fit')
    expect(() => fuse(a, b, 'attack')).toThrow(issue)
    a.patch.mods = a.patch.mods.map((_, i) => makeMod({ enabled: true, target: 'layers[0].gain', depth: 0.1, rate: i + 1 }))
    a.patch.performers = a.patch.performers.map(() => makePerformer({ enabled: true, target: 'layers[0].gain', depth: 0.2 }))
    b.patch.mods[0] = makeMod({ enabled: true, target: 'layers[0].cutoff', depth: 0.2, rate: 20 })
    a.fingerprint = fingerprint(a.patch); b.fingerprint = fingerprint(b.patch)
    expect(fusionCompatibility(a, b, 'motion')).toContain('No compatible modulation slot')
  })
  it('reuses identical modulation drivers without replacing the principal routes', () => {
    const { a, b } = pair()
    a.patch.mods = a.patch.mods.map(() => makeMod({ enabled: true, target: 'layers[0].gain', depth: 0.1 }))
    b.patch.mods[0] = makeMod({ enabled: true, target: 'layers[0].cutoff', depth: 0.2 })
    a.fingerprint = fingerprint(a.patch); b.fingerprint = fingerprint(b.patch)
    const child = fuse(a, b, 'motion')
    expect(child.patch.mods[0]!.target).toBe('layers[0].gain')
    expect(child.patch.mods[0]!.depth).toBe(0.1)
    expect(child.patch.mods[0]!.targetB).toBe('layers[0].cutoff')
    expect(child.patch.mods[0]!.depthB).toBeGreaterThan(0)
  })
  it('does not advertise empty or gain-only movement as a usable contribution', () => {
    const { a, b } = pair()
    b.patch.mods[0] = makeMod({ enabled: true, target: 'layers[0].cutoff', depth: 0 })
    b.patch.performers[0] = makePerformer({ enabled: true, target: 'layers[0].gain', depth: 0.2 })
    b.fingerprint = fingerprint(b.patch)
    expect(fusionCompatibility(a, b, 'motion')).not.toBeNull()
  })
})
