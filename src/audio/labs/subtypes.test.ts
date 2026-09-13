import { describe, expect, it } from 'vitest'
import { renderPatch } from '@paramrig/audio'
import type { Stereo } from '@paramrig/audio'
import { fft } from './analysis'
import { DETAIL_SUBTYPES } from './detail-catalog'
import { DEFAULT_DISCOVERY_CRITERIA, LAB_SUBTYPES, labSubtypeCatalog, generateSound, describeLabRecipe,
  sanitizeLabSound, sanitizeCriteria, validateLabCriteria, labCriteriaKey, renderCandidate, createLabBatch,
  varySound, fuseSounds, type LabCriteria } from './sdk'

const fixed: LabCriteria = { ...DEFAULT_DISCOVERY_CRITERIA, minMs: 650, maxMs: 650, material: 'any', character: 'clean' }

/** Gain-invariant acoustic probe: temporal RMS plus normalized spectral energy. */
function signature(samples: Stereo): number[] {
  const temporal = Array.from({ length: 16 }, (_, n) => {
    const from = Math.floor(samples.left.length * n / 16), end = Math.floor(samples.left.length * (n + 1) / 16)
    let energy = 0
    for (let i = from; i < end; i++) energy += samples.left[i]! ** 2 + samples.right[i]! ** 2
    return Math.sqrt(energy / Math.max(1, end - from))
  })
  const bands = [0, 0, 0, 0, 0, 0], size = 512
  for (let offset = 0; offset + size < samples.left.length; offset += size) {
    const re = new Float32Array(size), im = new Float32Array(size)
    for (let i = 0; i < size; i++) re[i] = (samples.left[offset + i]! + samples.right[offset + i]!) * (0.5 - 0.5 * Math.cos(i * Math.PI * 2 / (size - 1)))
    fft(re, im)
    for (let i = 1; i < size / 2; i++) {
      const hz = i * 16000 / size, band = hz < 150 ? 0 : hz < 500 ? 1 : hz < 1500 ? 2 : hz < 3500 ? 3 : hz < 6000 ? 4 : 5
      bands[band]! += re[i]! ** 2 + im[i]! ** 2
    }
  }
  const energy = bands.reduce((a, b) => a + b, 0) || 1, peak = Math.max(...temporal, 1e-9)
  return [...temporal.map((n) => n / peak), ...bands.map((n) => n / energy)]
}
const distance = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + Math.abs(n - b[i]!), 0) / a.length

describe('sound subtype constructions', () => {
  it('exposes contextual, independent metadata and round-trips every resolved recipe', () => {
    const catalog = labSubtypeCatalog()
    expect(catalog).toHaveLength(78)
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(78)
    expect(catalog.filter((entry) => entry.group === 'animals').map((entry) => entry.id)).toEqual(['purr', 'croak', 'bark', 'wing-flap'])
    expect(labSubtypeCatalog('engine').map((entry) => entry.id)).toEqual(['combustion', 'turbine', 'electric-motor', 'ignition'])
    expect(labSubtypeCatalog('notification')).toEqual([])
    catalog[0]!.label = 'Edited' as typeof catalog[0]['label']
    expect(labSubtypeCatalog()[0]!.label).toBe('Expanding blast')
    for (const entry of labSubtypeCatalog()) {
      const criteria: LabCriteria = { ...fixed, type: entry.family, subtype: entry.id }
      const sound = generateSound(criteria, 171)
      expect(sound.origin.recipe).toMatch(/^discovery-v2\//)
      expect(describeLabRecipe(sound.origin.recipe)).toMatchObject({ family: entry.family, subtype: entry.id })
      expect(generateSound(criteria, 171)).toEqual(sound)
      const restored = sanitizeLabSound(JSON.parse(JSON.stringify(sound)))!
      expect(restored.patch, entry.id).toEqual(sound.patch)
      expect(restored.criteria, entry.id).toEqual(sound.criteria)
      expect(restored.roles).toEqual(sound.roles)
      expect(restored.origin).toEqual(sound.origin)
    }
    const old = generateSound({ ...fixed, type: 'water' }, 171)
    expect(old.origin.recipe).toMatch(/^discovery-v1\//)
    expect(describeLabRecipe(old.origin.recipe)).not.toBeNull()
    expect(describeLabRecipe(`${old.origin.recipe}/steam`)).toBeNull()
    expect(describeLabRecipe('discovery-v2/choir/vocal/bed/air/clean/sustain/combustion')).toBeNull()
  })

  it('rejects contradictory intents and repairs stale imported selections', () => {
    for (const input of [
      { type: 'choir', subtype: 'turbine' }, { subtype: 'missing' }, { subtype: 'toString' },
      { subtype: 'flute', pool: { families: ['engine'] } }, { subtype: 'flute', gesture: 'fracture' },
    ]) expect(() => validateLabCriteria({ ...fixed, ...input }), JSON.stringify(input)).toThrow()
    const criteria: LabCriteria = { ...fixed, subtype: 'turbine', pool: { families: ['engine', 'choir'] } }
    expect(describeLabRecipe(generateSound(criteria, 171).origin.recipe)?.family).toBe('engine')
    expect(sanitizeCriteria({ ...fixed, type: 'water', subtype: 'turbine' }).subtype).toBeUndefined()
    expect(sanitizeCriteria({ ...fixed, subtype: 'turbine', pool: { families: ['choir'] } }).subtype).toBeUndefined()
    expect(sanitizeCriteria({ ...fixed, subtype: 'turbine', gesture: 'fracture' })).toMatchObject({ subtype: 'turbine', gesture: 'auto' })
    expect(labCriteriaKey({ ...fixed, subtype: 'turbine' })).not.toBe(labCriteriaKey({ ...fixed, subtype: 'combustion' }))
    expect(labCriteriaKey({ ...fixed, subtype: 'auto' })).not.toBe(labCriteriaKey(fixed))
  })

  it('explores subtypes without immediate repeats and keeps requested Auto separate from the recipe', () => {
    for (const type of ['engine', 'explosion', 'bowed', 'choir', 'percussion', 'water'] as const) {
      const seen = new Set(), recent: string[] = []
      for (let seed = 0; seed < labSubtypeCatalog(type).length * 8; seed++) {
        const criteria: LabCriteria = { ...fixed, type, subtype: 'auto' }
        const sound = generateSound(criteria, seed * 7919 + 171, recent), recipe = describeLabRecipe(sound.origin.recipe)!
        const options = labSubtypeCatalog(type)
        expect(options.map((entry) => entry.id)).toContain(recipe.subtype)
        expect(recipe.subtype).not.toBe(describeLabRecipe(recent.at(-1) ?? '')?.subtype)
        expect(sound.criteria.subtype).toBe('auto')
        if (recipe.layout === 'response' || recipe.layout === 'particles') expect(sound.patch.layers.some((layer) => layer.enabled && layer.offset > 0)).toBe(true)
        expect(generateSound(criteria, seed * 7919 + 171, recent)).toEqual(sound)
        recent.push(sound.origin.recipe); seen.add(recipe.subtype)
      }
      expect(seen.size, type).toBe(labSubtypeCatalog(type).length)
    }
  })

  it('renders every subtype across seeds, materials, character extremes and requested controls', () => {
    const rejected: string[] = []
    for (const [i, entry] of labSubtypeCatalog().entries()) for (let n = 0; n < 4; n++) {
      const criteria: LabCriteria = { ...fixed, type: entry.family, subtype: entry.id,
        material: ['any', 'glass', 'fabric', 'electrical'][n] as LabCriteria['material'],
        character: ['clean', 'acoustic', 'corrupted', 'ethereal'][n] as LabCriteria['character'],
        density: n === 0 ? 0 : n === 3 ? 1 : null, intensity: n === 0 ? 0 : n === 3 ? 1 : null,
        motion: n === 3 ? 'continuous' : 'natural', diversity: n === 2 ? 'wild' : 'balanced' }
      const result = renderCandidate(generateSound(criteria, 171 + n * 7919 + i * 997), 16000)
      if (!result) { rejected.push(`${entry.id}/${n}`); continue }
      expect(result.peak).toBeLessThan(0.99)
      expect(result.samples.left).toHaveLength(10400)
      expect(result.rms).toBeGreaterThan(0.001)
      expect(result.samples.left.every(Number.isFinite)).toBe(true)
      expect(Math.abs(result.samples.left.at(-1)!)).toBeLessThan(0.015)
      expect(sanitizeLabSound(JSON.parse(JSON.stringify(result.sound)))!.patch).toEqual(result.sound.patch)
    }
    expect(rejected).toEqual([])
  }, 180000)

  it('measures different rendered timbres and developments with fixed pitch and calibrated gain invariance', () => {
    const tone = (frequency: number, gain = 1) => {
      const left = Float32Array.from({ length: 10400 }, (_, i) => gain * Math.sin(i * 2 * Math.PI * frequency / 16000))
      return { left, right: left }
    }
    expect(distance(signature(tone(500)), signature(tone(500, 0.15)))).toBeLessThan(0.00001)
    expect(distance(signature(tone(200)), signature(tone(4000)))).toBeGreaterThan(0.07)
    for (const type of ['explosion', 'engine', 'spring', 'creak', 'tear', 'pressure', 'bowed', 'wind-instrument', 'choir', 'percussion'] as const) {
      const vectors = labSubtypeCatalog(type).map(({ id }) => {
        const sound = generateSound({ ...fixed, type, subtype: id, rootNote: 60, material: 'wood', character: 'clean' }, 7919)
        const patch = structuredClone(sound.patch)
        for (const layer of patch.layers) { layer.pitch.slide = 0; layer.pitch.vibratoDepth = 0; layer.pitch.jitter = 0 }
        for (const mod of [...patch.mods, ...patch.performers]) for (const key of ['target', 'targetB', 'targetC', 'targetD'] as const) if (mod[key].endsWith('.pitch')) mod[key] = 'off'
        return signature(renderPatch(patch, 16000))
      })
      const pairs = vectors.flatMap((a, i) => vectors.slice(i + 1).map((b) => distance(a, b)))
      expect.soft(Math.min(...pairs), `${type}: ${pairs.join(',')}`).toBeGreaterThan(0.015)
      expect.soft(pairs.reduce((a, b) => a + b, 0) / pairs.length, type).toBeGreaterThan(0.045)
    }
  }, 60000)

  it('distinguishes the eight detail groups at fixed tuning and varies their actual source graphs', () => {
    const entries = Object.entries(DETAIL_SUBTYPES) as [keyof typeof DETAIL_SUBTYPES, typeof DETAIL_SUBTYPES[keyof typeof DETAIL_SUBTYPES]][]
    expect(new Set(entries.map(([, detail]) => detail.group)).size).toBe(8)
    for (const group of new Set(entries.map(([, detail]) => detail.group))) {
      const vectors = entries.filter(([, detail]) => detail.group === group).map(([subtype]) => {
        const sound = generateSound({ ...fixed, type: 'any', subtype, rootNote: 60, material: 'wood' }, 7919)
        const patch = structuredClone(sound.patch)
        for (const layer of patch.layers) { layer.pitch.slide = 0; layer.pitch.jitter = 0; layer.pitch.vibratoDepth = 0 }
        for (const mod of [...patch.mods, ...patch.performers]) for (const key of ['target', 'targetB', 'targetC', 'targetD'] as const) if (mod[key].endsWith('.pitch')) mod[key] = 'off'
        return signature(renderPatch(patch, 16000))
      })
      const pairs = vectors.flatMap((a, i) => vectors.slice(i + 1).map((b) => distance(a, b)))
      expect.soft(Math.min(...pairs), group).toBeGreaterThan(0.015)
      expect.soft(pairs.reduce((a, b) => a + b, 0) / pairs.length, group).toBeGreaterThan(0.045)
    }
    for (const [subtype] of entries) {
      const graphs = new Set(), recent: string[] = []
      for (let n = 0; n < 16; n++) {
        const sound = generateSound({ ...fixed, type: 'any', subtype, material: 'wood', rootNote: 60 }, 171 + n * 7919, recent)
        graphs.add(JSON.stringify(sound.patch.layers.filter((l) => l.enabled).map((l) => [l.source.kind, l.source.wave, l.source.table, l.source.pmFrom,
          l.filterA.kind, l.filterB.kind, l.insertA.kind, l.insertB.kind, l.insertC.kind])))
        recent.push(sound.origin.recipe)
      }
      expect(graphs.size, subtype).toBeGreaterThanOrEqual(3)
    }
  }, 60000)

  it('preserves explicit gestures, exact tuning, variation intent and limits', () => {
    const late = generateSound({ ...fixed, type: 'explosion', subtype: 'blast', gesture: 'charge-impact' }, 171)
    const row = late.patch.performers[0]!.patterns[0]!
    expect(row.slice(8).some((value) => value > Math.max(...row.slice(0, 5)) * 2)).toBe(true)
    const spring = generateSound({ ...fixed, type: 'spring', subtype: 'boing' }, 171)
    const wobble = spring.patch.performers.find((p) => p.target === 'layers[0].pitch')!.patterns[0]!
    expect(Math.max(...wobble.slice(10).map((v) => Math.abs(v - 0.5)))).toBeLessThan(Math.max(...wobble.slice(0, 6).map((v) => Math.abs(v - 0.5))) * 0.3)
    for (const subtype of ['bowed-string', 'flute', 'vowel-choir'] as const) {
      const criteria: LabCriteria = { ...fixed, subtype, rootNote: 60 }
      const sound = renderCandidate(generateSound(criteria, 171), 16000)!.sound
      expect(sound.patch.layers[0]!.pitch.start).toBeCloseTo(261.625565, 5)
      const child = varySound({ mode: 'vary', criteria, seed: 99, reference: sound, amount: 'subtle' }, 99)
      expect(child.criteria.subtype).toBe(subtype)
      expect(child.patch.layers[0]!.pitch).toEqual(sound.patch.layers[0]!.pitch)
      expect(renderCandidate(child, 16000), subtype).not.toBeNull()
      expect(() => varySound({ mode: 'vary', criteria: { ...criteria, subtype: 'turbine' }, seed: 99, reference: sound }, 99)).toThrow()
    }
    for (const [i, subtype] of LAB_SUBTYPES.entries()) {
      const ms = i % 2 ? 20 : 4000
      const result = createLabBatch({ mode: 'create', count: 1, seed: 171 + i * 997,
        criteria: { ...fixed, subtype, minMs: ms, maxMs: ms, avoid: ['click', 'sub', 'piercing', 'reverb'] } }, 16000)
      expect(result.issue, `${subtype}/${ms}`).toBe('')
      expect(result.results[0]!.samples.left).toHaveLength(ms * 16)
    }
  }, 180000)

  it('replays saved new-family audio at 48 kHz and preserves subtype intent in fusion', () => {
    for (const type of ['explosion', 'engine', 'spring', 'creak', 'tear', 'pressure', 'bowed', 'wind-instrument', 'choir'] as const) {
      const rendered = renderCandidate(generateSound({ ...fixed, type }, 171), 48000)!
      expect(rendered, type).not.toBeNull()
      const restored = sanitizeLabSound(JSON.parse(JSON.stringify(rendered.sound)))!
      const replay = renderPatch(restored.patch, 48000)
      expect(replay.left, type).toEqual(rendered.samples.left)
      expect(replay.right, type).toEqual(rendered.samples.right)
    }
    const reference = generateSound({ ...fixed, type: 'engine', subtype: 'turbine' }, 171)
    const contributor = generateSound({ ...fixed, type: 'pressure', subtype: 'steam' }, 7919)
    const before = structuredClone([reference, contributor])
    const request = { mode: 'fuse' as const, criteria: reference.criteria, seed: 91, reference, contributor, contribution: 'texture' as const }
    const child = fuseSounds(request, 91)
    expect(child.criteria.subtype).toBe('turbine')
    expect(child.patch.layers[0]!.pitch).toEqual(reference.patch.layers[0]!.pitch)
    expect(renderCandidate(child, 48000)).not.toBeNull()
    expect([reference, contributor]).toEqual(before)
    expect(() => fuseSounds({ ...request, criteria: { ...reference.criteria, subtype: 'combustion' } }, 91)).toThrow()
  }, 60000)
})
