import { describe, expect, it } from 'vitest'
import { renderPatch } from '@paramrig/audio'
import { makeLayer, makePatch } from '@paramrig/audio'
import type { Stereo } from '@paramrig/audio'
import { DEFAULT_CRITERIA, LAB_TYPES, LAB_MATERIALS, LAB_CHARACTERS, LAB_MOTIONS, type LabCriteria } from './model'
import { LAB_TEXTURES, LAB_ENDINGS, labGestureOptions } from './selections'
import { createLabBatch, generateSound, renderCandidate } from './generate'
import { applyEnding, applySearchDesign } from './search-design'
import { fft } from './analysis'

const rate = 24000
const fixed: LabCriteria = { ...DEFAULT_CRITERIA, minMs: 700, maxMs: 700 }
function envelope(samples: Stereo, bins = 48): number[] {
  const length = samples.left.length
  return Array.from({ length: bins }, (_, n) => {
    const from = Math.floor(n * length / bins), to = Math.floor((n + 1) * length / bins)
    let sum = 0
    for (let i = from; i < to; i++) sum += (samples.left[i]! ** 2 + samples.right[i]! ** 2) / 2
    return Math.sqrt(sum / Math.max(1, to - from))
  })
}
function centroid(samples: Stereo): number {
  let energy = 0, weighted = 0
  const size = 1024
  for (let from = 0; from + size <= samples.left.length; from += size) {
    const real = new Float32Array(size), imaginary = new Float32Array(size)
    for (let i = 0; i < size; i++) real[i] = (samples.left[from + i]! + samples.right[from + i]!) * 0.5 * (0.5 - 0.5 * Math.cos(i * 2 * Math.PI / (size - 1)))
    fft(real, imaginary)
    for (let i = 1; i < size / 2; i++) {
      const power = real[i]! ** 2 + imaginary[i]! ** 2
      energy += power; weighted += power * i * rate / size
    }
  }
  return weighted / Math.max(1e-12, energy)
}
const peaks = (row: number[]) => row.filter((v, i) => v > Math.max(...row) * 0.22 && v > (row[i - 1] ?? 0) && v >= (row[i + 1] ?? 0)).length
const sum = (row: number[]) => row.reduce((a, b) => a + b, 0)
const referencePatch = () => makePatch(1, [makeLayer({ source: { wave: 'sine', fmIndex: 0 }, pitch: { start: 375 }, gain: 0.5,
  amp: { attack: 0.008, hold: 0.7, decay: 0.05, sustain: 0.8, release: 0.1, curve: 1 } })], {}, { gain: 0.5, limiter: 0 })

describe('audible search selections', () => {
  it('calibrates the audio probes on known tones and counted events', () => {
    const tone = (hz: number, events = 0): Stereo => {
      const left = Float32Array.from({ length: rate }, (_, i) => Math.sin(i * hz * Math.PI * 2 / rate)
        * (events ? Math.max(0, Math.sin((i / rate * events - 0.1) * Math.PI * 2)) ** 2 : 1))
      return { left, right: left }
    }
    expect(centroid(tone(750))).toBeCloseTo(750, 0)
    expect(centroid(tone(3750))).toBeCloseTo(3750, 0)
    expect(peaks(envelope(tone(750, 2)))).toBe(2)
    expect(peaks(envelope(tone(750, 6)))).toBe(6)
  })

  it('renders every texture across all families, with crossed material, movement and ending choices', () => {
    const rejected: string[] = []
    for (const [i, type] of LAB_TYPES.entries()) for (const [n, texture] of LAB_TEXTURES.entries()) {
      const criteria: LabCriteria = { ...fixed, type, texture, gesture: labGestureOptions(type)[1]!.id,
        register: ['low', 'mid', 'high', 'full'][n % 4] as LabCriteria['register'], mass: ['light', 'balanced', 'heavy'][n % 3] as LabCriteria['mass'],
        material: LAB_MATERIALS[n % LAB_MATERIALS.length]!, character: LAB_CHARACTERS[n % LAB_CHARACTERS.length]!, motion: LAB_MOTIONS[n % LAB_MOTIONS.length]!,
        intensity: n / (LAB_TEXTURES.length - 1), density: 1 - n / (LAB_TEXTURES.length - 1), ending: LAB_ENDINGS[(i + n) % LAB_ENDINGS.length]! }
      const candidate = renderCandidate(generateSound(criteria, 171 + i * 997 + n * 7919), rate)
      if (!candidate) { rejected.push(`${type}/${texture}`); continue }
      expect(candidate.peak).toBeLessThan(0.99)
      expect(candidate.rms).toBeGreaterThan(0.001)
      expect(candidate.samples.left).toHaveLength(16800)
      expect(candidate.spectrum.values.every(Number.isFinite)).toBe(true)
      expect(Math.abs(candidate.samples.left.at(-1)!)).toBeLessThan(0.01)
      expect(Math.abs(candidate.samples.right.at(-1)!)).toBeLessThan(0.01)
    }
    expect(rejected).toEqual([])
  }, 60000)

  it('keeps exclusions and duration extremes valid with explicit selections', () => {
    for (const [i, type] of LAB_TYPES.entries()) for (const ms of [20, 4000]) {
      const criteria: LabCriteria = { ...fixed, type, minMs: ms, maxMs: ms, register: 'low', texture: LAB_TEXTURES[i % LAB_TEXTURES.length]!,
        mass: 'heavy', intensity: 1, density: 1, ending: LAB_ENDINGS[i % LAB_ENDINGS.length]!, avoid: ['sub', 'piercing', 'click', 'reverb'] }
      const batch = createLabBatch({ mode: 'create', criteria, count: 1, seed: 171 + i * 991 }, rate)
      expect(batch.issue, `${type}/${ms}`).toBe(''); expect(batch.results).toHaveLength(1)
      const result = batch.results[0]!
      expect(result.samples.left).toHaveLength(ms * rate / 1000)
      for (const layer of result.sound.patch.layers.filter((l) => l.enabled)) {
        expect(layer.filterA.kind).toBe('highpass'); expect(layer.filterA.cutoff).toBeGreaterThanOrEqual(160)
        expect(layer.filterB.kind).toBe('lowpass'); expect(layer.filterB.cutoff).toBeLessThanOrEqual(5200)
      }
      expect([result.sound.patch.fx.x, result.sound.patch.fx.y, result.sound.patch.fx.z].some((fx) => fx.kind === 'reverb')).toBe(false)
    }
  }, 60000)

  it('changes measured register and intensity independently of mere output gain', () => {
    const registers: number[][] = [[], []], intensity: number[][] = [[], []]
    for (const seed of [17, 71, 171, 7802]) {
      for (const [i, register] of (['low', 'high'] as const).entries()) {
        registers[i]!.push(centroid(renderPatch(generateSound({ ...fixed, register, mass: 'balanced' }, seed).patch, rate)))
      }
      const soft = generateSound({ ...fixed, intensity: 0 }, seed), sharp = generateSound({ ...fixed, intensity: 1 }, seed)
      expect(soft.patch.layers.map((l) => l.pitch)).toEqual(sharp.patch.layers.map((l) => l.pitch))
      expect(soft.patch.master.gain).toBe(sharp.patch.master.gain)
      intensity[0]!.push(centroid(renderPatch(soft.patch, rate)))
      intensity[1]!.push(centroid(renderPatch(sharp.patch, rate)))
    }
    expect(sum(registers[1]!)).toBeGreaterThan(sum(registers[0]!) * 1.5)
    expect(sum(intensity[1]!)).toBeGreaterThan(sum(intensity[0]!) * 1.08)
  })

  it('makes density change the number of audible events without changing duration or pitch', () => {
    const counts = [0, 1].map((density) => {
      const patch = referencePatch()
      applySearchDesign(patch, ['body'], { ...fixed, gesture: 'phrase', density }, 171)
      expect(patch.duration).toBe(1); expect(patch.layers[0]!.pitch.start).toBe(375)
      return peaks(envelope(renderPatch(patch, rate)))
    })
    expect(counts[0]).toBe(2); expect(counts[1]).toBe(6)
  })

  it('separates attack-then-decay from charge-then-impact in the rendered timeline', () => {
    const rows = (['single-hit', 'charge-impact'] as const).map((gesture) => {
      const patch = referencePatch()
      applySearchDesign(patch, ['body'], { ...fixed, type: 'impact', gesture }, 171)
      return envelope(renderPatch(patch, rate))
    })
    expect(sum(rows[0]!.slice(0, 16))).toBeGreaterThan(sum(rows[0]!.slice(24, 40)) * 2)
    expect(sum(rows[1]!.slice(24, 40))).toBeGreaterThan(sum(rows[1]!.slice(0, 16)) * 1.5)
  })

  it('gives cut, fade and ring different audible endings within the same duration', () => {
    const endings = (['cut', 'fade'] as const).map((ending) => {
      const patch = referencePatch(); applyEnding(patch, { ...fixed, ending })
      return envelope(renderPatch(patch, rate))
    })
    expect(sum(endings[0]!.slice(36))).toBeGreaterThan(sum(endings[1]!.slice(36)) * 2)
    const dry = referencePatch()
    dry.layers[0]!.amp = { attack: 0.002, hold: 0, decay: 0.025, sustain: 0, release: 0.01, curve: 2 }
    const ring = structuredClone(dry); applyEnding(ring, { ...fixed, ending: 'ring' })
    const a = renderPatch(dry, rate), b = renderPatch(ring, rate)
    expect(sum(envelope(b).slice(4, 14))).toBeGreaterThan(sum(envelope(a).slice(4, 14)) + 0.001)
    expect(b.left.length).toBe(a.left.length)
    expect(Math.abs(b.left.at(-1)!)).toBeLessThan(0.01)
  })
})
