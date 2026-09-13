import { describe, expect, it } from 'vitest'
import { generateSound, createLabBatch, fitDuration, fuseSounds, varySound, fusionCompatibility, renderCandidate } from './generate'
import { adjustReference, makeLabSound, mappedPatch } from './design'
import { DEFAULT_CRITERIA, DURATION_MIN, DURATION_MAX, LAB_TYPES, LAB_MATERIALS, LAB_CHARACTERS, emptyLabSession, fingerprint, type LabRequest } from './model'
import { sanitizeLabSession } from './session'
import { sanitizeAudioDocument } from '../document'
import { makeLayer, makePatch, makeMod, makePerformer } from '@paramrig/audio'
import { emptyMacros, macroAmount, writeMacros } from '../macros'
import { LINEAR } from '@paramrig/audio/curves'

const criteria = { ...DEFAULT_CRITERIA, minMs: 450, maxMs: 900 }
const sound = (seed = 17) => generateSound(criteria, seed)
describe('Labs generation', () => {
  it('keeps useful controls and valid patches across crossed materials and characters', () => {
    for (const type of LAB_TYPES) for (const [i, material] of LAB_MATERIALS.entries()) {
      const result = generateSound({ ...criteria, type, material, character: LAB_CHARACTERS[i]! }, i + 49)
      expect(result.controls.length, `${type}/${material}`).toBe(4)
      expect(mappedPatch(result), `${type}/${material}`).toEqual(result.patch)
    }
  })
  it('reproduces a recipe and separates the 12 archetypes', () => {
    expect(sound()).toEqual(sound())
    const prints = new Set<string>()
    for (const type of LAB_TYPES) {
      const result = generateSound({ ...criteria, type }, 71)
      prints.add(result.fingerprint)
      expect(result.patch.duration * 1000).toBeGreaterThanOrEqual(450)
      expect(result.patch.duration * 1000).toBeLessThanOrEqual(900)
      expect(result.controls.length, type).toBe(4)
      expect(mappedPatch(result), `${type} macro center`).toEqual(result.patch)
    }
    expect(prints.size).toBe(12)
  })
  it('supports fixed durations including both limits, with no overshooting envelope', () => {
    for (const time of [DURATION_MIN, 151, 1800, DURATION_MAX]) {
      const result = generateSound({ ...criteria, minMs: time, maxMs: time }, 71)
      expect(result.patch.duration * 1000).toBeCloseTo(time, 6)
      for (const layer of result.patch.layers.filter((l) => l.enabled)) {
        expect(layer.offset).toBeLessThan(result.patch.duration)
        const total = layer.amp.attack + layer.amp.hold + layer.amp.decay + layer.amp.release
        expect(total).toBeLessThanOrEqual(result.patch.duration - layer.offset + 0.005)
      }
    }
  })
  it('rejects reversed and non-finite durations', () => {
    expect(() => generateSound({ ...criteria, minMs: 1000, maxMs: 200 }, 1)).toThrow()
    expect(() => generateSound({ ...criteria, minMs: NaN }, 1)).toThrow()
  })
  it('keeps exclusions active at the macro extremes', () => {
    const base = generateSound({ ...criteria, avoid: ['sub', 'piercing', 'reverb', 'click'] }, 11)
    for (const amount of [0, 1]) {
      const altered = adjustReference(base, [amount, amount, amount, amount])
      for (const layer of altered.patch.layers.filter((l) => l.enabled)) {
        expect(layer.filterA.kind).toBe('highpass'); expect(layer.filterA.cutoff).toBeGreaterThanOrEqual(160)
        expect(layer.filterB.kind).toBe('lowpass'); expect(layer.filterB.cutoff).toBeLessThanOrEqual(5200)
        expect(layer.amp.attack).toBeGreaterThanOrEqual(0.018)
      }
      expect([altered.patch.fx.x, altered.patch.fx.y, altered.patch.fx.z].every((fx) => fx.kind !== 'reverb')).toBe(true)
    }
  })
  it('produces four audible, finite candidates at bounded output level', () => {
    const result = createLabBatch({ mode: 'create', criteria, seed: 17 }, 16000)
    expect(result.issue).toBe('')
    expect(result.results).toHaveLength(4)
    for (const render of result.results) {
      expect(render.peak).toBeLessThan(0.99); expect(render.rms).toBeGreaterThan(0.001)
      expect(render.samples.left.length).toBe(Math.round(render.sound.patch.duration * 16000))
      expect(Math.abs(render.samples.left.at(-1)!)).toBeLessThan(0.01)
      expect(render.preview).toHaveLength(112)
    }
  })
})

describe('anchored variations', () => {
  it('keeps the source immutable and moves around its adjusted anchor with locks', () => {
    const reference = sound()
    const before = structuredClone(reference)
    const request: LabRequest = { mode: 'vary', criteria, seed: 74, reference, values: [0.7, 0.5, 0.5, 0.5], locks: [true, false, true, true], amount: 'subtle' }
    const child = varySound(request, 74)
    expect(reference).toEqual(before)
    expect(child.patch.duration).toBe(reference.patch.duration)
    child.patch.layers.forEach((layer, i) => { expect(layer.pitch).toEqual(reference.patch.layers[i]!.pitch); expect(layer.amp).toEqual(reference.patch.layers[i]!.amp) })
    expect(macroAmount(child.macros[child.controls[0]!]!)).toBeCloseTo(0.7)
    expect(varySound(request, 74)).toEqual(child)
    expect(child.patch).not.toEqual(reference.patch)
    expect(() => varySound({ ...request, locks: [true, true, true, true] }, 1)).toThrow('Unlock')
  })
  it('imports custom names and all mappings without a jump at the initial value', () => {
    const patch = makePatch(0.8, [makeLayer({ filter: { kind: 'lowpass', cutoff: 1000 } })])
    const macros = emptyMacros()
    macros[0] = { label: 'My brightness', renamed: true, value: 0.4, destinations: [{ property: 'layers[0].filterA.cutoff', from: 80, to: 12000, curve: LINEAR, invert: false }] }
    macros[1] = { label: 'My pitch', renamed: true, value: 0.5, destinations: [{ property: 'layers[0].pitch.start', from: 80, to: 500, curve: LINEAR, invert: false }] }
    const rig = writeMacros(undefined, macros, patch)
    const imported = makeLabSound(patch, criteria, { kind: 'instrument', recipe: 'imported', seed: 1, version: 1, parentIds: [] }, 'Mine', rig)
    expect(imported.controls).toEqual([0]); expect(imported.macros[1]!.label).toBe('My pitch')
    expect(adjustReference(imported, [0.4]).patch).toEqual(patch)
    const changed = adjustReference(imported, [0.41])
    expect(mappedPatch({ ...changed, macros: changed.macros.map((macro, i) => i === 0 ? macro : { ...macro, destinations: [] }) })).toEqual(changed.patch)
    expect(changed.macros[0]!.label).toBe('My brightness')
    expect(changed.macros[1]).toEqual(imported.macros[1])
    expect(imported.roles.every((r) => r === 'unknown')).toBe(true)
  })
  it('retimes recorded gestures proportionally', () => {
    const patch = sound().patch
    patch.gestures = [{ id: 'take', macro: 0, enabled: true, start: 0.1, duration: 0.2, points: [{ t: 0, v: 0 }, { t: 1, v: 1 }], destinations: [] }]
    const scaled = fitDuration(patch, patch.duration * 2)
    expect(scaled.gestures?.[0]?.start).toBe(0.2); expect(scaled.gestures?.[0]?.duration).toBe(0.4)
  })
  it('can vary only duration while every timbre control is locked', () => {
    const reference = sound()
    const child = varySound({ mode: 'vary', criteria: { ...criteria, minMs: 200, maxMs: 200 }, seed: 9, reference, locks: [true, true, true, true], varyDuration: true }, 9)
    expect(child.patch.duration).toBe(0.2)
    child.patch.layers.forEach((layer, i) => expect(layer.pitch).toEqual(reference.patch.layers[i]!.pitch))
  })
})

function fusionPair() {
  const a = sound(19)
  a.patch = makePatch(0.8, [makeLayer({ pitch: { start: 70 }, amp: { hold: 0.3 } })])
  a.roles = ['body', 'unknown', 'unknown', 'unknown']; a.fingerprint = fingerprint(a.patch)
  const b = sound(23)
  b.patch = makePatch(0.8, [makeLayer({ pitch: { start: 410 } }), makeLayer({ source: { fmIndex: 0.4, pmFrom: 'layer0' }, pitch: { start: 811 } })])
  b.roles = ['mechanism', 'texture', 'unknown', 'unknown']; b.fingerprint = fingerprint(b.patch)
  b.patch.mods[0] = makeMod({ enabled: true, target: 'layers[1].cutoff', depth: 0.2 })
  b.patch.performers[0] = makePerformer({ enabled: true, target: 'layers[1].gain', depth: 0.2 })
  b.fingerprint = fingerprint(b.patch)
  return { a, b }
}
describe('guided fusion', () => {
  it('brings the PM dependency group and routes to new indices, without changing parents', () => {
    const { a, b } = fusionPair(), beforeA = structuredClone(a), beforeB = structuredClone(b)
    const child = fuseSounds({ mode: 'fuse', criteria, seed: 1, reference: a, contributor: b, contribution: 'texture' }, 9)
    expect(a).toEqual(beforeA); expect(b).toEqual(beforeB)
    expect(child.patch.layers[0]!.pitch).toEqual(a.patch.layers[0]!.pitch)
    expect(child.patch.layers[1]!.pitch.start).toBe(410)
    expect(child.patch.layers[2]!.source.pmFrom).toBe('layer1')
    expect(child.patch.mods[0]!.target).toBe('layers[2].cutoff')
    expect(child.patch.performers[0]!.target).toBe('layers[2].gain')
    expect(child.parents.map((p) => p.id)).toEqual([a.id, b.id])
    expect(renderCandidate(child, 16000)).not.toBeNull()
  })
  it('refuses unknown roles and dependent groups larger than the remaining slots', () => {
    const { a, b } = fusionPair()
    b.roles = b.roles.map(() => 'unknown')
    expect(fusionCompatibility(a, b, 'texture')).toContain('unknown')
    b.roles = ['mechanism', 'texture', 'unknown', 'unknown']
    a.patch.layers = Array.from({ length: 4 }, () => makeLayer()); a.roles = a.roles.map(() => 'body'); a.fingerprint = fingerprint(a.patch)
    expect(() => fuseSounds({ mode: 'fuse', criteria, seed: 1, reference: a, contributor: b }, 9)).toThrow('do not fit')
  })
})

describe('Labs storage', () => {
  it('round trips reserve, reference and custom mappings independently of Instrument', () => {
    const reference = sound()
    const bench = sound(28)
    const labs = { ...emptyLabSession(), reference, reserve: [reference], history: [bench], current: bench.id, locks: [true, false, false, false] }
    const restored = sanitizeLabSession(JSON.parse(JSON.stringify(labs)))
    expect(restored.reference?.patch).toEqual(reference.patch)
    expect(restored.reference?.macros).toEqual(reference.macros)
    expect(restored.reserve[0]?.roles).toEqual(reference.roles)
    expect(restored.history[0]?.patch).toEqual(bench.patch)
    expect(restored.current).toBe(bench.id)
    expect(restored.locks).toEqual([true, false, false, false])
    // The four-candidate bench called its list `results`; it reads straight into the history.
    const older = sanitizeLabSession(JSON.parse(JSON.stringify({ ...emptyLabSession(), results: [bench] })))
    expect(older.history).toHaveLength(1); expect(older.current).toBe(bench.id)
    const doc = sanitizeAudioDocument({ id: 'test', name: 'Test', patch: makePatch(0.2, []), labs, snapshots: [{ id: 'snap', patch: reference.patch, lab: reference }] })!
    expect(doc.patch.duration).toBe(0.2); expect(doc.labs?.reserve).toHaveLength(1); expect(doc.snapshots?.[0]?.lab?.origin).toEqual(reference.origin)
  })
  it('bounds malformed sessions and invalidates role claims after external edits', () => {
    const reference = sound(); reference.patch.layers[0]!.pitch.start += 10
    const session = sanitizeLabSession({ ...emptyLabSession(), reference, reserve: Array(100).fill(reference), history: Array(50).fill(reference), current: 'nowhere', criteria: { minMs: 9000, maxMs: -5 }, locks: [1, true, 'yes'] })
    expect(session.reserve).toHaveLength(24); expect(session.history).toHaveLength(20); expect(session.reference?.roles.every((r) => r === 'unknown')).toBe(true)
    expect(session.criteria.minMs).toBe(DURATION_MAX); expect(session.criteria.maxMs).toBe(DURATION_MAX)
    expect(session.current).toBe(reference.id); expect(session.locks).toEqual([false, true, false, false])
  })
})
