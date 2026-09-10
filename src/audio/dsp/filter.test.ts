import { describe, expect, it } from 'vitest'
import { createFilter, filterSample } from '@/audio/dsp/filter'
import { makeLayer, makePatch } from '@/audio/patch'
import { monoSum, renderPatch } from '@/audio/dsp/render'
import type { FilterKind } from '@/audio/types'

const SAMPLE_RATE = 44100

/** Root-mean-square of a steady sine pushed through the filter, after letting the state settle. */
function through(kind: FilterKind, tone: number, cutoff: number, resonance = 0): number {
  const state = createFilter(kind, SAMPLE_RATE)
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

describe('the models that come out of the same two integrators', () => {
  it('takes out what a band-pass keeps, and keeps what it takes out', () => {
    // A notch is quiet at its corner and loud either side; a band-pass is the other way round.
    expect(through('notch', 1000, 1000, 0.7)).toBeLessThan(through('notch', 200, 1000, 0.7))
    expect(through('notch', 1000, 1000, 0.7)).toBeLessThan(through('notch', 6000, 1000, 0.7))
    expect(through('bandpass', 1000, 1000, 0.7)).toBeGreaterThan(through('bandpass', 200, 1000, 0.7))
  })

  it('lifts its corner as a peak and leaves the rest of the band where it was', () => {
    expect(through('peak', 1000, 1000, 0.8)).toBeGreaterThan(through('peak', 200, 1000, 0.8))
    expect(through('peak', 1000, 1000, 0.8)).toBeGreaterThan(through('peak', 6000, 1000, 0.8))
    // Away from the corner it is a wire: an equaliser that moved the whole band would be a tone
    // control wearing a filter's name.
    for (const tone of [120, 8000]) {
      expect(Math.abs(through('peak', tone, 1000, 0.8) - Math.SQRT1_2)).toBeLessThan(0.1)
    }
  })
})

describe('the ladder', () => {
  it('falls away far faster than one pair of poles', () => {
    const octaveUp = through('ladder', 2000, 1000) / through('ladder', 1000, 1000)
    const twoPole = through('lowpass', 2000, 1000) / through('lowpass', 1000, 1000)
    expect(octaveUp).toBeLessThan(twoPole)
    expect(through('ladder', 200, 1000)).toBeGreaterThan(0.5)
  })

  it('stays finite through a five-octave sweep at the top of its resonance', () => {
    const state = createFilter('ladder', SAMPLE_RATE)
    let worst = 0
    for (let i = 0; i < 20000; i += 1) {
      const cutoff = 100 * Math.pow(2, 5 * (i / 20000))
      const out = filterSample(state, 'ladder', Math.sin(i * 0.05), cutoff, 0.95, SAMPLE_RATE)
      expect(Number.isFinite(out)).toBe(true)
      worst = Math.max(worst, Math.abs(out))
    }
    expect(worst).toBeLessThan(12)
  })
})

describe('the comb', () => {
  it('is loud at the note its length names and quiet between two of them', () => {
    const onTune = through('comb', 500, 500, 0.85)
    const between = through('comb', 750, 500, 0.85)
    expect(onTune).toBeGreaterThan(between * 1.5)
  })

  it('is a bypass with nothing fed back, and stays finite fed back hard', () => {
    expect(through('comb', 1000, 400, 0)).toBeCloseTo(Math.SQRT1_2, 1)
    const state = createFilter('comb', SAMPLE_RATE)
    for (let i = 0; i < 20000; i += 1) {
      const out = filterSample(state, 'comb', Math.sin(i * 0.05), 100 * Math.pow(2, 5 * (i / 20000)), 1, SAMPLE_RATE)
      expect(Number.isFinite(out)).toBe(true)
    }
  })
})

describe('the formant bank', () => {
  it('lifts three bands and leaves the space between them, which is what a vowel is', () => {
    // The cutoff dial walks the vowels rather than tuning a corner, so two settings of it are two
    // different mouths and not the same one moved.
    const near = [200, 500, 1000, 2000, 4000].map((tone) => through('formant', tone, 300, 0.7))
    const far = [200, 500, 1000, 2000, 4000].map((tone) => through('formant', tone, 6000, 0.7))
    expect(near.some((level, at) => Math.abs(level - (far[at] ?? 0)) > 0.05)).toBe(true)
    // And it is a bank, not a wall: something gets through, and something does not.
    const all = [...near, ...far]
    expect(Math.max(...all)).toBeGreaterThan(0.15)
    expect(Math.min(...all)).toBeLessThan(0.1)
  })

  it('stays finite through a five-octave sweep at the top of its resonance', () => {
    const state = createFilter('formant', SAMPLE_RATE)
    for (let i = 0; i < 20000; i += 1) {
      const cutoff = 100 * Math.pow(2, 5 * (i / 20000))
      const out = filterSample(state, 'formant', Math.sin(i * 0.05), cutoff, 0.95, SAMPLE_RATE)
      expect(Number.isFinite(out)).toBe(true)
    }
  })
})

describe('two filters and what they do to each other', () => {
  const layer = (over: object) => makeLayer({
    gain: 0.8,
    source: { kind: 'tone', wave: 'saw' },
    pitch: { start: 200 },
    amp: { attack: 0.002, hold: 0.2, decay: 0.05, sustain: 0.9, release: 0.03, curve: 1 },
    ...over,
  })
  const heard = (over: object) => {
    const out = monoSum(renderPatch(makePatch(0.3, [layer(over)]), 22050))
    let energy = 0
    for (const value of out) energy += value * value
    return Math.sqrt(energy / out.length)
  }

  it('leaves B out of it while the routing says one filter', () => {
    const alone = heard({ filterA: { kind: 'lowpass', cutoff: 900, resonance: 0.3 }, routing: 'single' })
    const ignored = heard({ filterA: { kind: 'lowpass', cutoff: 900, resonance: 0.3 }, filterB: { kind: 'highpass', cutoff: 3000 }, routing: 'single' })
    expect(ignored).toBeCloseTo(alone, 6)
  })

  it('takes more away in series than either does alone, since B is fed what A left', () => {
    const low = heard({ filterA: { kind: 'lowpass', cutoff: 800, resonance: 0.2 }, routing: 'single' })
    const both = heard({
      filterA: { kind: 'lowpass', cutoff: 800, resonance: 0.2 },
      filterB: { kind: 'highpass', cutoff: 400, resonance: 0.2 },
      routing: 'series',
    })
    expect(both).toBeLessThan(low)
  })

  it('balances the two in parallel, and the balance reaches both ends', () => {
    const settings = {
      filterA: { kind: 'lowpass' as const, cutoff: 400, resonance: 0.2 },
      filterB: { kind: 'highpass' as const, cutoff: 4000, resonance: 0.2 },
      routing: 'parallel' as const,
    }
    const allA = heard({ ...settings, filterMix: 0 })
    const allB = heard({ ...settings, filterMix: 1 })
    const middle = heard({ ...settings, filterMix: 0.5 })
    // Two different filters, so two different levels — and the middle is a mix of them, not a third thing.
    expect(Math.abs(allA - allB)).toBeGreaterThan(0.002)
    expect(middle).toBeGreaterThan(Math.min(allA, allB) * 0.3)
    expect(middle).toBeLessThan(Math.max(allA, allB) * 1.2)
    // All of A is A alone: the balance is a crossfade, not a blend that leaves something behind.
    expect(allA).toBeCloseTo(heard({ filterA: settings.filterA, routing: 'single' }), 6)
  })
})
