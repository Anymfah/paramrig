import { describe, expect, it } from 'vitest'
import { makeLayer, makePatch } from '@paramrig/audio'
import { renderPatch } from '@paramrig/audio'
import type { Stereo } from '@paramrig/audio'
import { applySearchDesign } from './search-design'
import { DEFAULT_CRITERIA, DEFAULT_DISCOVERY_CRITERIA, SOUND_FAMILIES, LAB_MOTIONS, labSubtypeCatalog,
  generateSound, renderCandidate, sanitizeLabSound, describeLabRecipe, labGestureOptions, varySound, type LabCriteria } from './sdk'

const rate = 16000
const criteria: LabCriteria = { ...DEFAULT_DISCOVERY_CRITERIA, type: 'growl', material: 'wood', character: 'clean', minMs: 1000, maxMs: 1000, gesture: 'auto', density: 0.5 }
function fixture() {
  return makePatch(1, [0, 1].map((n) => makeLayer({ gain: n ? 0.2 : 0.4, source: { wave: 'sine', fmIndex: 0, voices: 1 },
    pitch: { start: n ? 1500 : 1000 }, filterA: { kind: 'off' },
    amp: { attack: 0.006, hold: 0.8, decay: 0.01, sustain: 1, release: 0.12, curve: 1 } })), {}, { gain: 0.35, limiter: 0 })
}
function rms(samples: Stereo, bins = 160): number[] {
  return Array.from({ length: bins }, (_, n) => {
    const from = Math.floor(samples.left.length * n / bins), to = Math.floor(samples.left.length * (n + 1) / bins)
    let sum = 0
    for (let i = from; i < to; i++) sum += samples.left[i]! ** 2 + samples.right[i]! ** 2
    return Math.sqrt(sum / (to - from) / 2)
  })
}
function attacks(row: number[]): number[] {
  const top = Math.max(...row), found: number[] = []
  let open = false
  row.forEach((value, i) => {
    if (!open && value > top * 0.32) { found.push(i / row.length); open = true }
    if (value < top * 0.16) open = false
  })
  return found
}
const gaps = (times: number[]) => times.slice(1).map((value, i) => value - times[i]!)
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
function rendered(motion: LabCriteria['motion'], density: number | null = 0.5, gesture: LabCriteria['gesture'] = 'auto', seed = 171) {
  const patch = fixture()
  applySearchDesign(patch, ['body', 'texture'], { ...criteria, motion, density, gesture }, seed)
  return renderPatch(patch, rate)
}

describe('movement temporal identity', () => {
  it('calibrates attack timing on known accelerating, regular and decaying audio', () => {
    const known = (onsets: number[], decay = false) => {
      const left = Float32Array.from({ length: rate }, (_, i) => {
        const t = i / rate, amplitude = decay ? (1 - t) ** 2 : onsets.some((at) => t >= at && t < at + 0.05) ? 1 : 0
        return amplitude * Math.sin(i * Math.PI * 2 * 1000 / rate)
      })
      return { left, right: left }
    }
    expect(attacks(rms(known([0, 0.4, 0.7, 0.9])))).toEqual([0, 0.4, 0.7, 0.9])
    expect(attacks(rms(known([0, 0.25, 0.5, 0.75])))).toEqual([0, 0.25, 0.5, 0.75])
    expect(attacks(rms(known([], true)))).toHaveLength(1)
  })

  it('measures shrinking versus growing intervals, a steady pulse and a single collapse at every density', () => {
    for (const density of [0, 0.5, 1, null]) {
      const accelerating = gaps(attacks(rms(rendered('accelerating', density))))
      const decelerating = gaps(attacks(rms(rendered('decelerating', density))))
      const pulsed = gaps(attacks(rms(rendered('pulsed', density))))
      expect(accelerating.length, `accelerating/${density}`).toBeGreaterThanOrEqual(2)
      expect(decelerating.length, `decelerating/${density}`).toBeGreaterThanOrEqual(2)
      expect(accelerating.at(-1)!).toBeLessThan(accelerating[0]! * 0.8)
      expect(decelerating.at(-1)!).toBeGreaterThan(decelerating[0]! * 1.3)
      // The first event starts at the boundary; later ramps cross the onset threshold
      // before their peak. Allow less than one contour sample for that boundary bias.
      expect(Math.max(...pulsed) - Math.min(...pulsed)).toBeLessThan(0.75 / 16)
      expect(Math.max(...pulsed.slice(1)) - Math.min(...pulsed.slice(1))).toBeLessThan(0.025)
      const collapse = rms(rendered('collapsing', density))
      expect(attacks(collapse)).toHaveLength(1)
      expect(sum(collapse.slice(100, 145))).toBeLessThan(sum(collapse.slice(5, 50)) * 0.18)
      expect(attacks(rms(rendered('continuous', density)))).toHaveLength(1)
    }
  })

  it('keeps an automatic natural sound intact when density changes, with distinct stutter/irregular/alternating intent', () => {
    for (const density of [0, 1]) expect(attacks(rms(rendered('natural', density)))).toHaveLength(1)
    const stuttering = gaps(attacks(rms(rendered('stuttering')))), irregular = gaps(attacks(rms(rendered('irregular'))))
    expect(Math.max(...stuttering)).toBeGreaterThan(Math.min(...stuttering) * 1.8)
    expect(Math.max(...irregular)).toBeGreaterThan(Math.min(...irregular) * 1.5)
    expect(stuttering).not.toEqual(irregular)
    const alternate = rendered('alternating'), left = rms({ left: alternate.left, right: alternate.left }), right = rms({ left: alternate.right, right: alternate.right })
    const difference = left.map((value, i) => value - right[i]!)
    expect(Math.max(...difference)).toBeGreaterThan(0.01)
    expect(Math.min(...difference)).toBeLessThan(-0.01)
    expect(attacks(rms(alternate))).toHaveLength(1)
  })

  it('preserves explicit one-hit and charge-impact landmarks instead of multiplying rhythms', () => {
    for (const motion of LAB_MOTIONS) {
      expect(attacks(rms(rendered(motion, 0.7, 'single-hit'))), motion).toHaveLength(1)
      const baseline = fixture(), candidate = fixture()
      applySearchDesign(baseline, ['body', 'texture'], { ...criteria, motion: 'natural', gesture: 'charge-impact' }, 171)
      applySearchDesign(candidate, ['body', 'texture'], { ...criteria, motion, gesture: 'charge-impact' }, 171)
      expect(candidate.performers[0]!.patterns, motion).toEqual(baseline.performers[0]!.patterns)
    }
    const regular = gaps(attacks(rms(rendered('pulsed', 0.4, 'phrase')))), faster = gaps(attacks(rms(rendered('accelerating', 0.4, 'phrase'))))
    expect(Math.max(...regular) - Math.min(...regular)).toBeLessThan(0.05)
    expect(faster.at(-1)!).toBeLessThan(faster[0]! * 0.85)
  })

  it('draws different audible stutter rhythms at fixed pitch and duration, with density controlling the event count', () => {
    const counts: number[] = []
    for (const density of [0, 0.5, 1]) {
      const rows = Array.from({ length: 32 }, (_, i) => attacks(rms(rendered('stuttering', density, 'auto', 171 + i * 7919))))
      // Quantize onset intervals to the contour grid: accent/threshold drift alone does not
      // count as another rhythm. The old two grids fail this even with randomized levels.
      const rhythms = rows.map((row) => gaps(row).map((gap) => Math.round(gap * 15)).join(','))
      expect(new Set(rhythms).size, `stutter rhythm diversity/${density}`).toBeGreaterThanOrEqual(14)
      for (const row of rows) {
        expect(row.length).toBeGreaterThanOrEqual(3)
        expect(row.at(-1)!).toBeGreaterThan(0.7)
        const intervals = gaps(row)
        expect(Math.max(...intervals)).toBeGreaterThan(Math.min(...intervals) * 1.65)
      }
      counts.push(sum(rows.map((row) => row.length)) / rows.length)
    }
    expect(counts[1]!).toBeGreaterThan(counts[0]! + 0.5)
    expect(counts[2]!).toBeGreaterThan(counts[1]! + 0.4)
    expect(rendered('stuttering', 0.5, 'auto', 7919)).toEqual(rendered('stuttering', 0.5, 'auto', 7919))
  }, 30000)

  it('applies the same movement ownership to both generation paths and every subtype', () => {
    for (const defaults of [DEFAULT_CRITERIA, DEFAULT_DISCOVERY_CRITERIA]) for (const motion of ['accelerating', 'collapsing', 'continuous'] as const) for (const density of [null, 0, 1]) {
      const sound = generateSound({ ...defaults, type: 'growl', motion, density, mass: 'balanced', minMs: 1000, maxMs: 1000 }, 171)
      const lane = sound.patch.performers[0]!
      if (motion === 'collapsing') expect(lane.patterns[0]!.every((v, i, row) => i === 0 || v <= row[i - 1]!)).toBe(true)
      if (motion === 'accelerating') expect(gaps(attacks(lane.patterns[0]!)).at(-1)!).toBeLessThan(gaps(attacks(lane.patterns[0]!))[0]!)
      if (motion === 'continuous') expect(lane.target).not.toContain('.gain')
      expect(sound.patch.layers.every((l) => !l.enabled || l.offset === 0)).toBe(true)
      expect(sound.criteria.gesture).toBe('auto')
    }
    for (const { id: subtype } of labSubtypeCatalog()) {
      const sound = generateSound({ ...criteria, type: 'any', subtype, motion: 'collapsing', density: 1 }, 7919)
      expect(sound.patch.performers[0]!.patterns[0]!.every((v, i, row) => i === 0 || v <= row[i - 1]!), subtype).toBe(true)
      expect(describeLabRecipe(sound.origin.recipe)?.gesture).toBe('auto')
    }
    for (const subtype of ['blast', 'marimba'] as const) {
      const sound = generateSound({ ...criteria, type: 'any', subtype, gesture: 'single-hit', motion: 'stuttering' }, 171)
      expect(sound.patch.performers[0]!.patterns[0]!.every((v, i, row) => i === 0 || v <= row[i - 1]!)).toBe(true)
    }
    for (const type of SOUND_FAMILIES.filter((family) => labGestureOptions(family).some((g) => g.id === 'single-hit'))) for (let n = 0; n < 12; n++) {
      const sound = generateSound({ ...criteria, type, gesture: 'single-hit', motion: n % 2 ? 'natural' : 'accelerating' }, 171 + n * 7919)
      expect(sound.patch.layers.every((layer) => !layer.enabled || layer.offset === 0), `${type}/${n}`).toBe(true)
    }
  })

  it.each(SOUND_FAMILIES.flatMap((type, i) => LAB_MOTIONS.map((motion, m) => ({ type, i, motion, m }))))(
    'renders $type/$motion without rejecting the first attempt', ({ type, i, motion, m }) => {
      const sound = generateSound({ ...criteria, type, motion, minMs: 700, maxMs: 700,
        density: i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : null,
        material: ['wood', 'glass', 'electrical', 'air'][i % 4] as LabCriteria['material'],
        character: ['clean', 'acoustic', 'corrupted', 'ethereal'][m % 4] as LabCriteria['character'] }, 171 + i * 997 + m * 7919)
      const result = renderCandidate(sound, rate)
      expect(result, `${type}/${motion}`).not.toBeNull()
      if (!result) return
      expect(result.peak).toBeLessThan(0.99); expect(result.samples.left).toHaveLength(11200)
    })

  it.each(labSubtypeCatalog().flatMap(({ id: subtype }, i) => (['accelerating', 'collapsing'] as const).map(motion => ({ subtype, i, motion }))))(
    'renders $subtype/$motion without rejecting the first attempt', ({ subtype, i, motion }) => {
      const result = renderCandidate(generateSound({ ...criteria, type: 'any', subtype, motion, minMs: 700, maxMs: 700 }, 171 + i * 997), rate)
      expect(result, `${subtype}/${motion}`).not.toBeNull()
    })

  it('preserves movement timing through saved replay and variation', () => {
    for (const motion of ['accelerating', 'collapsing', 'continuous', 'alternating', 'stuttering'] as const) {
      const sound = renderCandidate(generateSound({ ...criteria, motion }, 171), 48000)!.sound
      const restored = sanitizeLabSound(JSON.parse(JSON.stringify(sound)))!
      expect(renderPatch(restored.patch, 48000)).toEqual(renderPatch(sound.patch, 48000))
      const variant = varySound({ mode: 'vary', reference: sound, criteria: sound.criteria, seed: 7919, amount: 'strong' }, 7919)
      expect(variant.patch.performers.map((p) => p.patterns)).toEqual(sound.patch.performers.map((p) => p.patterns))
      expect(variant.patch.layers.map((l) => l.pitch)).toEqual(sound.patch.layers.map((l) => l.pitch))
      expect(renderCandidate(variant, 48000)).not.toBeNull()
    }
  }, 30000)

  it('keeps continuous and collapsing filter contours active across every chord quality', () => {
    for (const chord of ['major', 'minor', 'sus2', 'sus4', 'dissonant'] as const) for (const motion of LAB_MOTIONS) {
      const sound = generateSound({ ...criteria, type: 'keys', chord, motion, rootNote: 60 }, 171)
      if (['continuous', 'alternating', 'collapsing'].includes(motion)) {
        const filterLane = sound.patch.performers.find((p) => p.enabled && p.target === 'layers[0].cutoff')
        expect(filterLane, `${chord}/${motion}`).toBeDefined()
        expect([filterLane!.targetB, filterLane!.targetC, filterLane!.targetD]).toEqual(['layers[1].cutoff', 'layers[2].cutoff', 'layers[3].cutoff'])
      }
      expect(renderCandidate(sound, rate), `${chord}/${motion}`).not.toBeNull()
    }
  }, 30000)
})
