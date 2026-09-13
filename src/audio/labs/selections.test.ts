import { describe, expect, it } from 'vitest'
import { DEFAULT_CRITERIA, SOUND_FAMILIES, emptyLabSession, type LabCriteria, LAB_GESTURES, labCriteriaKey, labGestureOptions,
  validateLabCriteria, sanitizeCriteria, sanitizeLabSession, createLabBatch, generateSound, varySound, fuseSounds } from './sdk'
import { sanitizeAudioDocument } from '../document'
import { pmOrder } from '../dsp/engine'
import { makePatch } from '@paramrig/audio'
import { fingerprint, LAB_TYPES } from './model'

const fixed: LabCriteria = { ...DEFAULT_CRITERIA, minMs: 500, maxMs: 500 }
// Captured from the v3 generator before adding search selections, one representative per family.
const legacy = ['1njxo1s', 'ij0913', 'mogr60', 'p3ml56', '8e62c6', '1y00tfj', '1to9n7t', '1nc8nwf', '1gthtbt', 'qsxzs2', 'pwzqj', 'kgaams']

describe('Labs SDK search contract', () => {
  it('preserves existing recipes exactly when the new selections are automatic or absent', () => {
    for (const [i, type] of LAB_TYPES.entries()) {
      const criteria = { ...fixed, type }
      const sound = generateSound(criteria, 171)
      if (type === 'texture') {
        // The frozen texture uses sin(): Node 22 ARM/x86 differ by at most 2e-16
        // in its performer curves. Compare 14 significant digits in this fixture
        // only; never round persisted patches or change their identity hashes.
        const portable = JSON.parse(JSON.stringify(sound.patch, (_, value: unknown) =>
          typeof value === 'number' ? Number(value.toPrecision(14)) : value))
        expect(fingerprint(portable), type).toBe('i2t334')
      } else expect(sound.fingerprint, type).toBe(legacy[i])
      for (const key of ['gesture', 'register', 'texture', 'intensity', 'density', 'ending'] as const) delete criteria[key]
      expect(generateSound(criteria, 171).patch, `${type} legacy input`).toEqual(sound.patch)
      const restored = sanitizeCriteria(JSON.parse(JSON.stringify(criteria)))
      expect(restored.mass).toBeUndefined()
      expect(generateSound(restored, 171).patch).toEqual(sound.patch)
    }
  })

  it('provides contextual, duration-aware gestures for every family and supports every advertised option', () => {
    const seen = new Set<string>()
    for (const type of SOUND_FAMILIES) {
      const options = labGestureOptions(type)
      const fingerprints = new Set<string>()
      expect(options[0]?.id).toBe('auto'); expect(options.length).toBeGreaterThanOrEqual(3)
      for (const { id: gesture, minMs } of options) {
        seen.add(gesture)
        const criteria = { ...fixed, type, gesture }
        expect(() => validateLabCriteria(criteria)).not.toThrow()
        const result = createLabBatch({ mode: 'create', count: 1, criteria, seed: 171 }, 16000)
        expect(result.issue, `${type}/${gesture}`).toBe('')
        expect(result.results).toHaveLength(1)
        expect(result.results[0]!.sound.criteria.gesture).toBe(gesture)
        if (gesture !== 'auto') fingerprints.add(generateSound(criteria, 171).fingerprint)
        if (minMs > 20) expect(() => validateLabCriteria({ ...criteria, minMs: 20, maxMs: minMs - 1 })).toThrow('needs at least')
      }
      expect(fingerprints.size, `${type} explicit gestures must not be aliases`).toBe(options.length - 1)
      // Callers cannot mutate the shared catalog by editing a returned label.
      options[0]!.label = 'changed'
      expect(labGestureOptions(type)[0]!.label).toBe('Auto')
    }
    expect(seen).toEqual(new Set(LAB_GESTURES))
  }, 60000)

  it('keeps requested bounds while avoiding durations too short for the selected gesture', () => {
    const criteria: LabCriteria = { ...fixed, type: 'transformation', gesture: 'assemble-lock', minMs: 20, maxMs: 400 }
    for (let seed = 0; seed < 32; seed++) {
      const sound = generateSound(criteria, seed)
      expect(sound.patch.duration).toBeGreaterThanOrEqual(0.24)
      expect(sound.patch.duration).toBeLessThanOrEqual(0.4)
      expect(sound.criteria.minMs).toBe(20)
    }
  })

  it('rejects invalid API selections while recovering malformed saved input', () => {
    for (const value of [NaN, Infinity, -0.1, 1.1, '0.5', false]) {
      expect(() => validateLabCriteria({ ...fixed, intensity: value })).toThrow('intensity')
      expect(() => validateLabCriteria({ ...fixed, density: value })).toThrow('density')
    }
    for (const key of ['gesture', 'texture', 'register', 'ending', 'mass', 'type', 'material', 'character', 'motion', 'weight']) {
      expect(() => validateLabCriteria({ ...fixed, [key]: 'not-an-option' })).toThrow()
    }
    expect(() => validateLabCriteria({ ...fixed, type: 'drone', gesture: 'assemble-lock' })).toThrow('not available')
    expect(() => validateLabCriteria({ ...fixed, avoid: ['unknown'] })).toThrow('exclusion')
    expect(() => validateLabCriteria({ ...fixed, minMs: 20.1 })).toThrow('whole number')
    expect(() => validateLabCriteria({ ...fixed, intensity: 0, density: 0 })).not.toThrow()
    const imported = sanitizeCriteria({ ...fixed, type: 'drone', gesture: 'assemble-lock', register: 'wrong', texture: 'wrong', ending: 'wrong', mass: 'wrong', intensity: -1, density: Infinity })
    expect(imported).toMatchObject({ gesture: 'auto', register: 'auto', texture: 'auto', ending: 'auto', intensity: 0, density: null })
    expect(imported.mass).toBeUndefined()
    expect(sanitizeCriteria({ ...fixed, type: 'impact', gesture: 'rebounds', minMs: 20, maxMs: 30 }).gesture).toBe('auto')
  })

  it('preserves new criteria in documents, history, reserve and references without altering the patch', () => {
    const criteria: LabCriteria = { ...fixed, type: 'transformation', gesture: 'assemble-lock', register: 'low', texture: 'friction',
      intensity: 0.65, density: 0.75, ending: 'cut', mass: 'heavy' }
    const sound = generateSound(criteria, 718)
    const session = { ...emptyLabSession(), criteria, history: [sound], reserve: [sound], reference: sound, references: [sound], current: sound.id }
    const restored = sanitizeLabSession(JSON.parse(JSON.stringify(session)))
    expect(restored.criteria).toEqual(criteria)
    for (const saved of [...restored.history, ...restored.reserve, ...restored.references, restored.reference!]) {
      expect(saved.criteria).toEqual(criteria); expect(saved.patch).toEqual(sound.patch); expect(saved.roles).toEqual(sound.roles)
    }
    const doc = sanitizeAudioDocument({ id: 'sdk-selections', name: 'SDK', patch: makePatch(0.2, []), labs: session,
      snapshots: [{ id: 'selected', patch: sound.patch, lab: sound }] })!
    expect(doc.snapshots?.[0]?.lab?.criteria).toEqual(criteria)
  })

  it('separates register from mass without changing the source graph or transposing mass', () => {
    for (const type of LAB_TYPES) {
      const a = generateSound({ ...fixed, type, register: 'mid', mass: 'light' }, 171)
      const b = generateSound({ ...fixed, type, register: 'mid', mass: 'heavy' }, 171)
      expect(a.patch.layers.map((layer) => layer.pitch)).toEqual(b.patch.layers.map((layer) => layer.pitch))
      expect(a.patch.layers.map((layer) => layer.source)).toEqual(b.patch.layers.map((layer) => layer.source))
      expect(a.fingerprint).not.toBe(b.fingerprint)
      expect(a.patch.layers[0]!.pitch.start).toBeGreaterThanOrEqual(220)
      expect(a.patch.layers[0]!.pitch.start).toBeLessThanOrEqual(550)
    }
  })

  it('keeps engine diversity and valid dependency graphs under tightly selected intent', () => {
    const criteria: LabCriteria = { ...fixed, type: 'transformation', gesture: 'assemble-lock', register: 'low', texture: 'friction', density: 0.75, intensity: 0.65, mass: 'heavy', ending: 'cut' }
    const recent: string[] = [], graphs = new Set<string>()
    for (let seed = 0; seed < 24; seed++) {
      const before = structuredClone(criteria)
      const sound = generateSound(criteria, seed, recent)
      expect(generateSound(criteria, seed, recent)).toEqual(sound)
      expect(criteria).toEqual(before)
      const engine = sound.origin.recipe.split('/')[2]!
      expect(recent.slice(-2).map((r) => r.split('/')[2])).not.toContain(engine)
      graphs.add(engine); recent.push(sound.origin.recipe)
      const order = pmOrder(sound.patch.layers)
      for (const [i, layer] of sound.patch.layers.entries()) if (layer.enabled && layer.source.pmFrom !== 'internal') {
        const source = Number(layer.source.pmFrom.slice(5))
        expect(sound.patch.layers[source]?.enabled).toBe(true); expect(order.from[i]).toBe(source)
      }
    }
    expect(graphs.size).toBeGreaterThanOrEqual(3)
  })

  it('includes every selection in the history intent key and treats exclusions as a set', () => {
    const baseline = labCriteriaKey(fixed)
    for (const change of [{ gesture: 'phrase' }, { register: 'low' }, { texture: 'vocal' }, { ending: 'ring' }, { intensity: 0 }, { density: 0 }, { mass: 'heavy' }] as const) {
      expect(labCriteriaKey({ ...fixed, ...change })).not.toBe(baseline)
    }
    expect(labCriteriaKey({ ...fixed, avoid: ['sub', 'reverb', 'sub'] })).toBe(labCriteriaKey({ ...fixed, avoid: ['reverb', 'sub'] }))
  })

  it('does not pretend changed search intent was applied during a protected variation or fusion', () => {
    const criteria: LabCriteria = { ...fixed, texture: 'vocal', register: 'low', intensity: 0.4 }
    const reference = generateSound(criteria, 17), before = structuredClone(reference)
    const child = varySound({ mode: 'vary', criteria, seed: 74, reference }, 74)
    expect(child.criteria).toEqual(criteria)
    for (const altered of [{ ...criteria, texture: 'buzz' as const }, { ...criteria, intensity: 0.8 }]) {
      expect(() => varySound({ mode: 'vary', criteria: altered, seed: 74, reference }, 74)).toThrow('Keep the reference search selections')
      expect(() => fuseSounds({ mode: 'fuse', criteria: altered, seed: 74, reference, contributor: reference }, 74)).toThrow('Keep the reference search selections')
    }
    expect(reference).toEqual(before)
  })
})
