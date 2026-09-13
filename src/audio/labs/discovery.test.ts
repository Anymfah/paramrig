import { describe, expect, it } from 'vitest'
import { pmOrder } from '../dsp/engine'
import { renderPatch } from '@paramrig/audio'
import { makeLayer, makePatch } from '@paramrig/audio'
import type { AudioPatch, Stereo } from '@paramrig/audio'
import { DEFAULT_DISCOVERY_CRITERIA, SOUND_FAMILIES, LAB_TYPES, LAB_MATERIALS, LAB_CHARACTERS, LAB_MOTIONS,
  LAB_TEXTURES, LAB_ENDINGS, generateSound, createLabBatch, renderCandidate, describeLabRecipe, labFamilyCatalog,
  labGestureOptions, sanitizeCriteria, sanitizeLabSound, validateLabCriteria, labCriteriaKey, varySound, fuseSounds, type LabCriteria } from './sdk'
import { LAB_TYPES as PALETTE_FAMILIES, LAB_MATERIALS as PALETTE_MATERIALS } from './model'
import { fft } from './analysis'
import { mappedPatch } from './design'

const fixed: LabCriteria = { ...DEFAULT_DISCOVERY_CRITERIA, minMs: 350, maxMs: 350 }
function topology(patch: AudioPatch): string {
  return JSON.stringify(patch.layers.filter((l) => l.enabled).map((l) => [l.source.kind,
    l.source.kind === 'table' ? l.source.table : l.source.kind === 'noise' ? l.source.colour : l.source.wave,
    l.source.pmFrom, l.filterA.kind, l.filterB.kind, ...[l.insertA, l.insertB, l.insertC].map((s) => [s.kind, s.kind === 'body' ? s.profile : '', s.place])]))
}

/** RMS-normalized spectral bands and temporal energy, independent of labels and output gain. */
function features(samples: Stereo): number[] {
  const bands = Array<number>(5).fill(0), size = 512, rate = 16000
  for (let offset = 0; offset + size <= samples.left.length; offset += size) {
    const re = new Float32Array(size), im = new Float32Array(size)
    for (let i = 0; i < size; i++) re[i] = (samples.left[offset + i]! + samples.right[offset + i]!) * 0.5 * (0.5 - 0.5 * Math.cos(i * Math.PI * 2 / (size - 1)))
    fft(re, im)
    for (let i = 1; i < size / 2; i++) {
      const hz = i * rate / size, band = hz < 250 ? 0 : hz < 800 ? 1 : hz < 2400 ? 2 : hz < 5000 ? 3 : 4
      bands[band]! += re[i]! ** 2 + im[i]! ** 2
    }
  }
  const temporal = Array.from({ length: 12 }, (_, n) => {
    const from = Math.floor(samples.left.length * n / 12), to = Math.floor(samples.left.length * (n + 1) / 12)
    let energy = 0
    for (let i = from; i < to; i++) energy += samples.left[i]! ** 2 + samples.right[i]! ** 2
    return Math.sqrt(energy / Math.max(1, to - from))
  })
  const sum = bands.reduce((a, b) => a + b, 0) || 1, peak = Math.max(...temporal, 1e-9)
  return [...bands.map((v) => v / sum), ...temporal.map((v) => v / peak)]
}
const distance = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / a.length

describe('general sound-design SDK', () => {
  it('exposes the broad catalog without expanding the current UI palette', () => {
    expect(SOUND_FAMILIES).toHaveLength(49); expect(LAB_TYPES[0]).toBe('any')
    expect(LAB_MATERIALS).toHaveLength(15); expect(LAB_CHARACTERS).toHaveLength(13)
    expect(PALETTE_FAMILIES).toHaveLength(12); expect(PALETTE_MATERIALS).toHaveLength(6)
    const catalog = labFamilyCatalog()
    expect(new Set(catalog.map((entry) => entry.domain)).size).toBe(7)
    expect(catalog.every((entry) => entry.engines.length >= 3 && entry.description.length > 20)).toBe(true)
    catalog[0]!.label = 'changed'
    expect(labFamilyCatalog()[0]!.label).toBe('Growl')
  })

  it('changes real source graphs in every family and keeps phase dependencies valid', () => {
    for (const type of SOUND_FAMILIES) {
      const engines = new Set(), layouts = new Set(), graphs = new Set(), recent: string[] = []
      for (let n = 0; n < 24; n++) {
        const criteria = { ...fixed, type, material: 'wood' as const, character: 'clean' as const }
        const sound = generateSound(criteria, n * 7919 + 171, recent)
        const recipe = describeLabRecipe(sound.origin.recipe)!
        expect(recipe.family).toBe(type)
        expect(recent.slice(-2).map((r) => describeLabRecipe(r)!.engine)).not.toContain(recipe.engine)
        engines.add(recipe.engine); layouts.add(recipe.layout); graphs.add(topology(sound.patch)); recent.push(sound.origin.recipe)
        const order = pmOrder(sound.patch.layers)
        sound.patch.layers.forEach((layer, i) => {
          if (!layer.enabled) return
          expect(sound.roles[i]).not.toBe('unknown')
          if (layer.source.pmFrom !== 'internal') {
            const source = Number(layer.source.pmFrom.slice(5))
            expect(sound.patch.layers[source]?.enabled).toBe(true); expect(order.from[i]).toBe(source)
          }
        })
      }
      expect(engines.size, type).toBeGreaterThanOrEqual(3)
      expect(layouts.size, type).toBeGreaterThanOrEqual(2)
      expect(graphs.size, type).toBeGreaterThanOrEqual(10)
    }
  }, 60000)

  it('resolves Any within explicit pools, uses every domain, and reproduces history-aware draws', () => {
    const domains = new Set(), recent: string[] = []
    const catalog = labFamilyCatalog()
    for (let seed = 0; seed < 100; seed++) {
      const sound = generateSound(fixed, seed, recent), recipe = describeLabRecipe(sound.origin.recipe)!
      domains.add(catalog.find((entry) => entry.id === recipe.family)!.domain); recent.push(sound.origin.recipe)
    }
    expect(domains.size).toBe(7)
    const criteria: LabCriteria = { ...fixed, pool: { families: ['water', 'pad', 'notification'], materials: ['wood', 'liquid'], characters: ['digital', 'ethereal'] } }
    const seen = new Set(), poolRecent: string[] = []
    for (let seed = 0; seed < 24; seed++) {
      const sound = generateSound(criteria, seed, poolRecent), recipe = describeLabRecipe(sound.origin.recipe)!
      expect(criteria.pool!.families).toContain(recipe.family); expect(criteria.pool!.materials).toContain(recipe.material); expect(criteria.pool!.characters).toContain(recipe.character)
      expect(generateSound(criteria, seed, poolRecent)).toEqual(sound)
      seen.add(recipe.family)
      expect(sanitizeLabSound(JSON.parse(JSON.stringify(sound)))).toMatchObject({ criteria, fingerprint: sound.fingerprint, origin: sound.origin })
      expect(sanitizeLabSound(JSON.parse(JSON.stringify(sound)))!.roles).toEqual(sound.roles)
      poolRecent.push(sound.origin.recipe)
    }
    expect(seen.size).toBe(3)
    expect(labCriteriaKey(criteria)).toBe(labCriteriaKey({ ...criteria, pool: { families: ['notification', 'water', 'pad'], materials: ['liquid', 'wood'], characters: ['ethereal', 'digital'] } }))
    expect(generateSound(criteria, 171).patch).toEqual(generateSound({ ...criteria, pool: { ...criteria.pool, families: ['pad', 'notification', 'water'] } }, 171).patch)
  })

  it('rejects contradictory pools and tuning while recovering imported criteria', () => {
    const invalid = [
      { pool: { families: [] } }, { pool: { families: ['invalid'] } }, { pool: { materials: ['any'] } },
      { pool: { families: ['pad'] }, gesture: 'assemble-lock' }, { type: 'pad', pool: { families: ['pad'] } },
      { rootNote: 23 }, { rootNote: 60.5 }, { rootNote: NaN }, { rootNote: 60, register: 'high' }, { scale: 'invalid' }, { diversity: 'invalid' },
    ]
    for (const input of invalid) expect(() => validateLabCriteria({ ...fixed, ...input }), JSON.stringify(input)).toThrow()
    expect(sanitizeCriteria({ ...fixed, pool: { families: ['pad', 'wrong', 'pad'] }, gesture: 'assemble-lock', rootNote: 110 })).toMatchObject({ pool: { families: ['pad'] }, gesture: 'auto', rootNote: 96 })
    for (const change of [{ diversity: 'wild' }, { rootNote: 60 }, { scale: 'minor' }, { pool: { families: ['pad'] } }] as const) expect(labCriteriaKey({ ...fixed, ...change } as LabCriteria)).not.toBe(labCriteriaKey(fixed))
  })

  it('rejects malformed operations, seeds and render requests before producing audio', () => {
    for (const input of [{ seed: NaN }, { seed: -1 }, { seed: 2 ** 32 }, { count: NaN }, { count: 0 }, { mode: 'wrong' }, { locks: [true] }, { values: [0, 1, NaN, 0] }, { influence: Infinity }]) {
      const batch = createLabBatch({ mode: 'create', criteria: fixed, seed: 171, ...input } as Parameters<typeof createLabBatch>[0], 16000)
      expect(batch.results).toEqual([]); expect(batch.issue).not.toBe('')
    }
    expect(() => generateSound(fixed, NaN)).toThrow('Seed')
    expect(createLabBatch({ mode: 'create', criteria: fixed, seed: 171 }, 0).issue).toContain('Sample rate')
  })

  it('renders all family/material pairs with crossed characters, textures and movements', () => {
    const rejected: string[] = []
    for (const [i, type] of SOUND_FAMILIES.entries()) for (const [j, material] of LAB_MATERIALS.entries()) {
      const options = labGestureOptions(type)
      const criteria: LabCriteria = { ...fixed, type, material, character: LAB_CHARACTERS[(i + j) % LAB_CHARACTERS.length]!,
        gesture: options[(i + j) % options.length]!.id, texture: LAB_TEXTURES[(i * 3 + j) % LAB_TEXTURES.length]!,
        motion: LAB_MOTIONS[(i + j) % LAB_MOTIONS.length]!, ending: LAB_ENDINGS[(i + j) % LAB_ENDINGS.length]!,
        intensity: (j % 3) / 2, density: (i % 3) / 2, diversity: j % 3 === 0 ? 'wild' : 'balanced' }
      const result = renderCandidate(generateSound(criteria, 171 + i * 7919 + j * 997), 16000)
      if (!result) { rejected.push(`${type}/${material}`); continue }
      expect(result.peak).toBeLessThan(0.99); expect(result.rms).toBeGreaterThan(0.001)
      expect(result.samples.left).toHaveLength(5600)
      expect(result.spectrum.values.every(Number.isFinite)).toBe(true)
      expect(Math.abs(result.samples.left.at(-1)!)).toBeLessThan(0.015)
      expect(Math.abs(result.samples.right.at(-1)!)).toBeLessThan(0.015)
    }
    expect(rejected).toEqual([])
  }, 180000)

  it('supports both duration limits and all exclusions across the full catalog', () => {
    for (const [i, type] of SOUND_FAMILIES.entries()) for (const ms of [20, 4000]) {
      const criteria: LabCriteria = { ...fixed, type, minMs: ms, maxMs: ms, avoid: ['sub', 'piercing', 'click', 'reverb'], diversity: 'wild' }
      const batch = createLabBatch({ mode: 'create', count: 1, criteria, seed: i * 997 + 171 }, 16000)
      expect(batch.issue, `${type}/${ms}`).toBe(''); expect(batch.results).toHaveLength(1)
      const result = batch.results[0]!
      expect(result.samples.left).toHaveLength(ms * 16)
      for (const layer of result.sound.patch.layers.filter((l) => l.enabled)) {
        expect(layer.filterA.kind).toBe('highpass'); expect(layer.filterA.cutoff).toBeGreaterThanOrEqual(160)
        expect(layer.filterB.kind).toBe('lowpass'); expect(layer.filterB.cutoff).toBeLessThanOrEqual(5200)
      }
      expect([result.sound.patch.fx.x, result.sound.patch.fx.y, result.sound.patch.fx.z].some((fx) => fx.kind === 'reverb')).toBe(false)
    }
  }, 180000)

  it('keeps exact musical roots, coherent macros and reference intent through variations', () => {
    for (const type of ['bass', 'lead', 'pad', 'pluck', 'bell', 'keys'] as const) {
      const criteria: LabCriteria = { ...fixed, type, rootNote: 57, scale: 'minor', character: 'clean', material: 'wood', gesture: 'auto' }
      const sound = generateSound(criteria, 171)
      expect(sound.patch.layers[0]!.pitch.start).toBeCloseTo(220, 8)
      expect(sound.patch.layers[0]!.pitch.slide).toBe(0); expect(sound.patch.layers[0]!.pitch.jitter).toBe(0)
      expect(sound.controls).toHaveLength(4)
      const variation = varySound({ mode: 'vary', criteria, reference: sound, seed: 31 }, 31)
      expect(variation.criteria).toEqual(criteria)
      expect(() => varySound({ mode: 'vary', criteria: { ...criteria, rootNote: 58 }, reference: sound, seed: 31 }, 31)).toThrow('reference search')
      expect(() => fuseSounds({ mode: 'fuse', criteria: { ...criteria, material: 'ice' }, reference: sound, contributor: sound, seed: 31 }, 31)).toThrow('reference search')
    }
  })

  it('calibrates quiet designs within editable gains without altering their source graph or input', () => {
    const sound = generateSound({ ...fixed, type: 'lead', rootNote: 57, character: 'clean' }, 171)
    sound.patch.layers.forEach((l) => { l.gain *= 0.015 })
    const before = structuredClone(sound), result = renderCandidate(sound, 24000)
    expect(result).not.toBeNull()
    expect(sound).toEqual(before)
    expect(result!.sound.patch.master.gain).toBeLessThanOrEqual(3)
    const boost = result!.sound.patch.layers[0]!.gain / sound.patch.layers[0]!.gain
    expect(boost).toBeGreaterThan(1)
    result!.sound.patch.layers.forEach((layer, i) => {
      if (!layer.enabled) return
      expect(layer.gain).toBeLessThanOrEqual(1.5)
      expect(layer.gain / sound.patch.layers[i]!.gain).toBeCloseTo(boost, 10)
      expect(layer.source).toEqual(sound.patch.layers[i]!.source)
    })
    expect(mappedPatch(result!.sound)).toEqual(result!.sound.patch)
    expect(sanitizeLabSound(JSON.parse(JSON.stringify(result!.sound)))!.patch).toEqual(result!.sound.patch)
    expect(result!.peak).toBeGreaterThan(0.04)
  })

  it('calibrates audio diversity measurement and remains diverse with pitch travel removed', () => {
    const tone = (frequency: number, gain = 1): Stereo => {
      const left = Float32Array.from({ length: 5600 }, (_, i) => gain * Math.sin(i * frequency * 2 * Math.PI / 16000))
      return { left, right: left }
    }
    expect(features(tone(500))[1]).toBeGreaterThan(0.99)
    expect(features(tone(3500))[3]).toBeGreaterThan(0.99)
    expect(distance(features(tone(500)), features(tone(500, 0.1)))).toBeLessThan(1e-5)
    const example = makePatch(0.35, [makeLayer()]), transposed = structuredClone(example)
    transposed.seed++; transposed.layers[0]!.pitch.start *= 2; transposed.layers[0]!.gain *= 0.5
    expect(topology(example)).toBe(topology(transposed))
    for (const type of ['bass', 'pad', 'water', 'crush', 'notification'] as const) {
      const vectors = Array.from({ length: 10 }, (_, n) => {
        const patch = generateSound({ ...fixed, type, material: 'wood', character: 'clean' }, 171 + n * 7919).patch
        patch.layers.forEach((l) => { l.pitch = { ...l.pitch, start: 220, slide: 0, jitter: 0, vibratoDepth: 0, arpeggioRatio: 1 } })
        return features(renderPatch(patch, 16000))
      })
      const pairs = vectors.flatMap((a, i) => vectors.slice(i + 1).map((b) => distance(a, b)))
      expect(pairs.reduce((a, b) => a + b, 0) / pairs.length, type).toBeGreaterThan(0.08)
    }
  })
})
