import { describe, expect, it } from 'vitest'
import { renderPatch } from '@paramrig/audio'
import { makeLayer, makePatch } from '@paramrig/audio'
import type { Stereo } from '@paramrig/audio'
import { analyseShape, fft } from './analysis'
import { generateSound } from './generate'
import { makeLabSound } from './design'
import { DEFAULT_CRITERIA } from './model'
import { clampSculpt, renderSculpted, sculptSound, sculptValues } from './sculpt'

const RATE = 16000
/** The strongest frequency in the middle of a render: the pitch the ear follows. */
function pitchOf(samples: Stereo): number {
  const size = 4096, from = Math.max(0, (samples.left.length >> 1) - size / 2)
  const re = new Float32Array(size), im = new Float32Array(size)
  for (let i = 0; i < size; i++) re[i] = (samples.left[from + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)))
  fft(re, im)
  let best = 1
  for (let k = 2; k < size / 2; k++) if (re[k]! ** 2 + im[k]! ** 2 > re[best]! ** 2 + im[best]! ** 2) best = k
  return best * RATE / size
}
const sideRatio = (samples: Stereo) => {
  let mid = 0, side = 0
  for (let i = 0; i < samples.left.length; i++) { const m = (samples.left[i]! + samples.right[i]!) / 2, s = (samples.left[i]! - samples.right[i]!) / 2; mid += m * m; side += s * s }
  return Math.sqrt(side / mid)
}
const toneSound = () => {
  const patch = makePatch(0.6, [makeLayer({ pitch: { start: 330 }, amp: { attack: 0.01, hold: 0.4, decay: 0.1, sustain: 0.8, release: 0.05 } })])
  return makeLabSound(patch, { ...DEFAULT_CRITERIA, minMs: 600, maxMs: 600 }, { kind: 'instrument', recipe: 'test', version: 1, seed: 1, parentIds: [] }, 'Tone')
}

describe('shaping the sound on the bench', () => {
  it('stretches to the exact length asked for, on the same seed, without moving the pitch', () => {
    const sound = toneSound()
    const before = renderPatch(sound.patch, RATE)
    for (const ms of [240, 1450]) {
      const longer = sculptSound(sound, 'duration', ms, Number.NaN)
      expect(longer.patch.duration * 1000).toBeCloseTo(ms, 6)
      expect(longer.patch.seed).toBe(sound.patch.seed)
      const after = renderPatch(longer.patch, RATE)
      expect(after.left.length).toBe(Math.round(ms / 1000 * RATE))
      expect(Math.abs(pitchOf(after) - pitchOf(before))).toBeLessThanOrEqual(RATE / 4096)
      expect(longer.fingerprint).not.toBe(sound.fingerprint)
    }
    expect(clampSculpt('duration', 9)).toBe(20)
    expect(clampSculpt('duration', 99999)).toBe(4000)
  })
  it('widens and narrows the real stereo image through the master width', () => {
    const sound = generateSound({ ...DEFAULT_CRITERIA, minMs: 400, maxMs: 400 }, 23)
    const base = sideRatio(renderPatch(sound.patch, RATE))
    expect(base).toBeGreaterThan(0.02)
    const wide = sculptSound(sound, 'width', 1.8, Number.NaN)
    expect(wide.patch.master.width).toBe(1.8)
    expect(sideRatio(renderPatch(wide.patch, RATE)) / base).toBeGreaterThan(1.5)
    const mono = sculptSound(sound, 'width', 0, Number.NaN)
    expect(sideRatio(renderPatch(mono.patch, RATE))).toBeLessThan(0.001)
    expect(sculptValues(wide, null).width).toBe(1.8)
  })
  it('puts the peak where the handle says, within a tenth of a decibel, and never past -0.3 dBFS', () => {
    const sound = generateSound({ ...DEFAULT_CRITERIA, minMs: 400, maxMs: 400 }, 41)
    const shape = analyseShape(renderPatch(sound.patch, RATE))
    const from = sculptValues(sound, shape)
    for (const target of [from.levelDb - 9, -0.3]) {
      const asked = sculptSound(sound, 'level', target, from.levelDb)
      const { sound: landed, samples } = renderSculpted(asked, RATE, target)
      expect(analyseShape(samples).topDb).toBeCloseTo(target, 0)
      expect(Math.abs(analyseShape(samples).topDb - target)).toBeLessThanOrEqual(0.1)
      expect(landed.patch.seed).toBe(sound.patch.seed)
      expect(landed.patch.duration).toBe(sound.patch.duration)
    }
    expect(clampSculpt('level', 6)).toBe(-0.3)
  })
})
