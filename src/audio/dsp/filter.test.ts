import { describe, expect, it } from 'vitest'
import { createFilter, filterSample } from '@/audio/dsp/filter'

const SAMPLE_RATE = 44100

/** Root-mean-square of a steady sine pushed through the filter, after letting the state settle. */
function through(kind: 'lowpass' | 'highpass' | 'bandpass', tone: number, cutoff: number, resonance = 0): number {
  const state = createFilter()
  let sum = 0
  const total = 4096
  for (let i = 0; i < total * 2; i += 1) {
    const input = Math.sin((2 * Math.PI * tone * i) / SAMPLE_RATE)
    const out = filterSample(state, kind, input, cutoff, resonance, SAMPLE_RATE)
    if (i >= total) sum += out * out
  }
  return Math.sqrt(sum / total)
}

describe('filterSample', () => {
  it('passes the signal untouched when it is off', () => {
    const state = createFilter()
    expect(filterSample(state, 'off', 0.42, 100, 0.9, SAMPLE_RATE)).toBe(0.42)
  })

  it('lets lows through and holds highs back', () => {
    expect(through('lowpass', 200, 1000)).toBeGreaterThan(0.6)
    expect(through('lowpass', 8000, 1000)).toBeLessThan(0.1)
  })

  it('does the opposite on highpass', () => {
    expect(through('highpass', 8000, 1000)).toBeGreaterThan(0.6)
    expect(through('highpass', 200, 1000)).toBeLessThan(0.1)
  })

  it('favours the band around its cutoff', () => {
    const middle = through('bandpass', 1000, 1000, 0.5)
    expect(middle).toBeGreaterThan(through('bandpass', 100, 1000, 0.5))
    expect(middle).toBeGreaterThan(through('bandpass', 10000, 1000, 0.5))
  })

  it('lifts the cutoff region as resonance rises', () => {
    expect(through('lowpass', 1000, 1000, 0.9)).toBeGreaterThan(through('lowpass', 1000, 1000, 0))
  })

  /**
   * The reason this filter is a state variable and not a biquad: the cutoff is retuned on every
   * single sample here, across five octaves, at high resonance. A biquad blows up doing this.
   */
  it('stays finite while its cutoff is swept every sample at high resonance', () => {
    const state = createFilter()
    for (let i = 0; i < 20000; i += 1) {
      const cutoff = 80 * Math.pow(2, 5 * (0.5 + 0.5 * Math.sin(i / 300)))
      const out = filterSample(state, 'lowpass', Math.sin(i / 7), cutoff, 0.95, SAMPLE_RATE)
      expect(Number.isFinite(out)).toBe(true)
      expect(Math.abs(out)).toBeLessThan(50)
    }
  })

  it('survives a cutoff asked for above Nyquist', () => {
    const state = createFilter()
    for (let i = 0; i < 500; i += 1) {
      const out = filterSample(state, 'lowpass', Math.sin(i / 3), 900000, 0.5, SAMPLE_RATE)
      expect(Number.isFinite(out)).toBe(true)
    }
  })
})
