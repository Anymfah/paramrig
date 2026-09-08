import { describe, expect, it } from 'vitest'
import { createNoise, polyBlep, waveAt } from '@/audio/dsp/osc'
import { mulberry32 } from '@/audio/dsp/rng'

const SAMPLE_RATE = 44100
const N = 2048

function sweepFree(freq: number, blep: boolean): Float64Array {
  const out = new Float64Array(N)
  const dt = freq / SAMPLE_RATE
  let phase = 0
  for (let i = 0; i < N; i += 1) {
    out[i] = blep ? waveAt('saw', phase, dt, 0.5) : 2 * phase - 1
    phase = (phase + dt) % 1
  }
  return out
}

/**
 * Energy sitting below the fundamental of a saw can only have folded down from above Nyquist,
 * so it is a direct measure of aliasing. Parseval gives the total, and a partial DFT the part
 * under the fundamental — cheaper than transforming the whole spectrum to throw most of it away.
 */
function aliasRatio(samples: Float64Array, freq: number): number {
  const windowed = new Float64Array(N)
  let total = 0
  for (let i = 0; i < N; i += 1) {
    windowed[i] = (samples[i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)))
    total += (windowed[i] ?? 0) ** 2
  }
  const cut = Math.floor((freq * 0.9 * N) / SAMPLE_RATE)
  let below = 0
  for (let k = 2; k < cut; k += 1) {
    let re = 0
    let im = 0
    const step = (2 * Math.PI * k) / N
    for (let i = 0; i < N; i += 1) {
      re += (windowed[i] ?? 0) * Math.cos(step * i)
      im -= (windowed[i] ?? 0) * Math.sin(step * i)
    }
    below += ((re * re + im * im) * 2) / N
  }
  return below / Math.max(1e-12, total)
}

describe('polyBlep', () => {
  it('is zero away from a discontinuity', () => {
    expect(polyBlep(0.5, 0.01)).toBe(0)
    expect(polyBlep(0.3, 0.01)).toBe(0)
  })

  it('only corrects within one sample either side of the wrap', () => {
    expect(polyBlep(0.005, 0.01)).not.toBe(0)
    expect(polyBlep(0.995, 0.01)).not.toBe(0)
  })

  it('does nothing when the increment is zero', () => {
    expect(polyBlep(0.5, 0)).toBe(0)
  })
})

describe('waveAt', () => {
  it('draws a sine that peaks a quarter of the way through', () => {
    expect(waveAt('sine', 0, 0.001, 0.5)).toBeCloseTo(0, 6)
    expect(waveAt('sine', 0.25, 0.001, 0.5)).toBeCloseTo(1, 6)
    expect(waveAt('sine', 0.75, 0.001, 0.5)).toBeCloseTo(-1, 6)
  })

  it('draws a triangle that peaks in the middle', () => {
    expect(waveAt('triangle', 0, 0.001, 0.5)).toBeCloseTo(-1, 4)
    expect(waveAt('triangle', 0.5, 0.001, 0.5)).toBeCloseTo(1, 4)
  })

  it('splits the square at its duty cycle', () => {
    expect(waveAt('square', 0.1, 0.0001, 0.25)).toBeGreaterThan(0)
    expect(waveAt('square', 0.5, 0.0001, 0.25)).toBeLessThan(0)
  })

  it('keeps every shape inside a sensible range', () => {
    for (const shape of ['sine', 'triangle', 'saw', 'square'] as const) {
      for (let i = 0; i < 400; i += 1) {
        const value = waveAt(shape, i / 400, 0.01, 0.5)
        expect(Number.isFinite(value)).toBe(true)
        expect(Math.abs(value)).toBeLessThanOrEqual(2)
      }
    }
  })

  /**
   * The claim the whole oscillator exists to make. A naive saw at 4 kHz folds its upper harmonics
   * back under its own fundamental where they are plainly audible; this asserts the correction
   * removes at least 30 dB of that, which is the difference between grit and none.
   */
  it('folds far less energy below the fundamental than a naive saw', () => {
    for (const freq of [2000, 4000]) {
      const naive = aliasRatio(sweepFree(freq, false), freq)
      const corrected = aliasRatio(sweepFree(freq, true), freq)
      expect(corrected).toBeLessThan(naive / 1000)
    }
  })
})

describe('createNoise', () => {
  /**
   * The bounds differ by colour and the reason is worth writing down: a band-limited square is
   * its own +/-1 plus two corrections each in [-1, 1], so it can reach three, and metallic is a
   * mean of six of them. Peaks like that are harmless here because a source is heard through a
   * layer gain, an envelope and the limiter, but a test that pretended they were +/-1 would be
   * asserting something untrue.
   */
  it('stays inside the bound its construction allows', () => {
    const bounds = { white: 1, pink: 2, metallic: 3 } as const
    for (const colour of ['white', 'pink', 'metallic'] as const) {
      const noise = createNoise(colour, mulberry32(3))
      for (let i = 0; i < 2000; i += 1) {
        const value = noise.next(0.05)
        expect(Number.isFinite(value)).toBe(true)
        expect(Math.abs(value)).toBeLessThanOrEqual(bounds[colour])
      }
    }
  })

  it('sits at a usable level rather than near silence or near clipping', () => {
    for (const colour of ['white', 'pink', 'metallic'] as const) {
      const noise = createNoise(colour, mulberry32(8))
      let sum = 0
      const total = 4000
      for (let i = 0; i < total; i += 1) sum += noise.next(0.05) ** 2
      const rms = Math.sqrt(sum / total)
      expect(rms).toBeGreaterThan(0.05)
      expect(rms).toBeLessThan(0.9)
    }
  })

  it('repeats exactly when the stream does', () => {
    const first = createNoise('pink', mulberry32(11))
    const again = createNoise('pink', mulberry32(11))
    for (let i = 0; i < 200; i += 1) expect(first.next(0.02)).toBe(again.next(0.02))
  })

  it('gives pink noise more low-frequency weight than white', () => {
    const energy = (colour: 'white' | 'pink') => {
      const noise = createNoise(colour, mulberry32(5))
      let slow = 0
      let previous = 0
      for (let i = 0; i < 8000; i += 1) {
        const value = noise.next(0.02)
        slow += (value + previous) ** 2
        previous = value
      }
      return slow / 8000
    }
    expect(energy('pink')).toBeGreaterThan(energy('white'))
  })
})
