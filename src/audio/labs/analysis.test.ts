import { describe, expect, it } from 'vitest'
import { analyseSpectrum, fft, spectrumPosition, waveEnvelope } from './analysis'

/* With 5 ms fades, as the engine's own sounds have: a tone switched on at full amplitude splashes
   every band at the edges, and that splash is the loudest thing in a steady sound's spectrum. */
const tone = (hz: number, rate: number, seconds: number, gain = 0.5) => {
  const length = Math.round(rate * seconds), fade = Math.round(rate * 0.005)
  const left = new Float32Array(length), right = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const edge = Math.min(1, i / fade, (length - 1 - i) / fade)
    left[i] = Math.sin(2 * Math.PI * hz * i / rate) * gain * edge; right[i] = left[i]!
  }
  return { left, right }
}

describe('spectral analysis', () => {
  it('transforms a pure tone into one peak at its bin', () => {
    const size = 1024, bin = 37
    const re = new Float32Array(size), im = new Float32Array(size)
    for (let i = 0; i < size; i++) re[i] = Math.cos(2 * Math.PI * bin * i / size)
    fft(re, im)
    const power = Array.from({ length: size / 2 }, (_, i) => re[i]! * re[i]! + im[i]! * im[i]!)
    expect(power.indexOf(Math.max(...power))).toBe(bin)
    expect(() => fft(new Float32Array(100), new Float32Array(100))).toThrow()
  })
  it('places a tone in the band that holds its frequency, on every column, at full level', () => {
    const rate = 16000
    const spectrum = analyseSpectrum(tone(1000, rate, 0.5), rate, 32, 48)
    expect(spectrum.columns).toBe(32); expect(spectrum.rows).toBe(48); expect(spectrum.maxHz).toBe(8000)
    const row = Math.floor(spectrumPosition(1000, spectrum) * spectrum.rows)
    for (let column = 4; column < spectrum.columns - 4; column++) {
      let best = 0
      for (let r = 0; r < spectrum.rows; r++) if (spectrum.values[r * spectrum.columns + column]! > spectrum.values[best * spectrum.columns + column]!) best = r
      expect(Math.abs(best - row)).toBeLessThanOrEqual(1)
      expect(spectrum.values[best * spectrum.columns + column]).toBeGreaterThan(0.95)
    }
    expect(Math.max(...spectrum.values)).toBe(1)
    expect(Math.min(...spectrum.values)).toBeGreaterThanOrEqual(0)
  })
  it('keeps silence on the floor and every value finite', () => {
    const rate = 16000
    const spectrum = analyseSpectrum({ left: new Float32Array(4000), right: new Float32Array(4000) }, rate, 8, 8)
    expect(Array.from(spectrum.values).every((value) => value === 0)).toBe(true)
  })
  it('retains stereo energy when opposite phases cancel in mono', () => {
    const samples = tone(1000, 16000, 0.5)
    const regular = analyseSpectrum(samples, 16000, 32, 48)
    const opposite = analyseSpectrum({ left: samples.left, right: samples.right.map((value) => -value) }, 16000, 32, 48)
    for (let i = 0; i < regular.values.length; i++) expect(opposite.values[i]).toBeCloseTo(regular.values[i]!, 4)
    expect(Math.max(...opposite.values)).toBe(1)
  })
  it('shows different frequency content in the left and right channels', () => {
    const left = tone(500, 16000, 0.5).left
    const right = tone(2000, 16000, 0.5).right
    const spectrum = analyseSpectrum({ left, right }, 16000, 32, 64)
    for (const hz of [500, 2000]) {
      const row = Math.floor(spectrumPosition(hz, spectrum) * spectrum.rows)
      expect(spectrum.values[row * spectrum.columns + 16]).toBeGreaterThan(0.9)
    }
  })
  it('keeps separate short attacks distinct instead of blurring their gap into a ridge', () => {
    const rate = 16000, length = rate / 2
    const left = new Float32Array(length)
    for (const centre of [0.14, 0.18]) {
      for (let i = 0; i < length; i++) {
        const distance = Math.abs(i / rate - centre)
        if (distance < 0.003) left[i]! += Math.sin(2 * Math.PI * 2000 * i / rate) * (1 + Math.cos(Math.PI * distance / 0.003)) / 2
      }
    }
    const spectrum = analyseSpectrum({ left, right: left.slice() }, rate, 96, 48)
    const row = Math.floor(spectrumPosition(2000, spectrum) * spectrum.rows)
    const levelAt = (seconds: number) => spectrum.values[row * spectrum.columns + Math.floor(seconds * spectrum.columns / 0.5)]!
    const first = levelAt(0.14), second = levelAt(0.18), gap = levelAt(0.16)
    expect(first).toBeGreaterThan(0.9)
    expect(second).toBeGreaterThan(0.9)
    // At least 20 dB of separation remains between these two short events.
    expect(Math.min(first, second) - gap).toBeGreaterThan(20 / 80)
  })
  it('reads neighbouring low rows between bins rather than repeating one', () => {
    const rate = 48000
    const spectrum = analyseSpectrum(tone(70, rate, 0.5), rate, 16, 64)
    const column = 8
    const low = Array.from({ length: 10 }, (_, r) => spectrum.values[r * spectrum.columns + column]!)
    expect(new Set(low.map((value) => value.toFixed(4))).size).toBeGreaterThan(7)
  })
  it('resolves two bass fundamentals with a real valley and retains relative levels across gain changes', () => {
    const rate = 48000
    const a = tone(70, rate, 1), b = tone(110, rate, 1)
    const left = a.left.map((value, i) => value + b.left[i]!)
    const result = analyseSpectrum({ left, right: left }, rate, 32, 128)
    const at = (hz: number) => result.values[Math.floor(spectrumPosition(hz, result) * result.rows) * result.columns + 16]!
    expect(at(70)).toBeGreaterThan(0.9)
    expect(at(110)).toBeGreaterThan(0.9)
    expect(Math.min(at(70), at(110)) - at(90)).toBeGreaterThan(10 / 80)
    const quiet = left.map((value) => value * 0.1)
    const scaled = analyseSpectrum({ left: quiet, right: quiet }, rate, 32, 128)
    for (let i = 0; i < result.values.length; i++) expect(scaled.values[i]).toBeCloseTo(result.values[i]!, 3)
  })
  it('does not let the longer bass window fill a silent gap between two short events', () => {
    const rate = 48000
    const samples = tone(80, rate, 0.5)
    for (let i = 0; i < samples.left.length; i++) {
      if (i / rate < 0.1 || (i / rate > 0.14 && i / rate < 0.22) || i / rate > 0.26) samples.left[i] = 0
    }
    const result = analyseSpectrum({ left: samples.left, right: samples.left }, rate, 96, 128)
    const row = Math.floor(spectrumPosition(80, result) * result.rows)
    const at = (seconds: number) => result.values[row * result.columns + Math.floor(seconds * result.columns / 0.5)]!
    expect(at(0.12)).toBeGreaterThan(0.85)
    expect(at(0.24)).toBeGreaterThan(0.85)
    expect(at(0.18)).toBeLessThan(0.05)
  })
  it('keeps the loudest and quietest sample of every column in the envelope', () => {
    const samples = tone(50, 16000, 0.2, 0.8)
    const wave = waveEnvelope(samples, 16)
    expect(wave).toHaveLength(32)
    expect(Math.max(...wave)).toBeCloseTo(0.8, 1)
    expect(Math.min(...wave)).toBeCloseTo(-0.8, 1)
    for (let i = 0; i < 16; i++) expect(wave[i * 2]).toBeLessThanOrEqual(wave[i * 2 + 1]!)
  })
})
