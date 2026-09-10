import { describe, expect, it } from 'vitest'
import { createModal, modalPartial, modalSample } from '@/audio/dsp/modal'

const SAMPLE_RATE = 22050

/** One sample of excitation, then silence: exactly how a struck thing is played. */
function strike(partials: number, frequency: number, spread: number, decay: number, length = 4000): Float32Array {
  const states = createModal(partials)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    out[i] = modalSample(states, i === 0 ? 1 : 0, frequency, spread, decay, SAMPLE_RATE)
  }
  return out
}

const rms = (samples: Float32Array, from = 0, to = samples.length) => {
  let sum = 0
  for (let i = from; i < to; i += 1) sum += (samples[i] ?? 0) ** 2
  return Math.sqrt(sum / Math.max(1, to - from))
}

describe('modalPartial', () => {
  it('puts every partial on the fundamental when nothing is spread', () => {
    for (let i = 0; i < 6; i += 1) expect(modalPartial(i, 400, 0)).toBeCloseTo(400, 6)
  })

  /** A struck bar's partials are multiples of nothing, which is the point of the whole file. */
  it('opens onto ratios that are not whole numbers', () => {
    expect(modalPartial(1, 400, 1)).toBeCloseTo(400 * 2.756, 3)
    expect(modalPartial(2, 400, 1)).toBeCloseTo(400 * 5.404, 3)
    expect(Number.isInteger(modalPartial(1, 400, 1) / 400)).toBe(false)
  })
})

describe('modalSample', () => {
  it('keeps ringing after the strike is over', () => {
    const rung = strike(4, 800, 0.7, 0.4)
    expect(rms(rung, 2000, 3000)).toBeGreaterThan(0)
    expect(rms(rung, 0, 200)).toBeGreaterThan(rms(rung, 3000, 4000))
  })

  it('rings longer when it is asked to', () => {
    const short = strike(3, 800, 0.5, 0.05)
    const long = strike(3, 800, 0.5, 0.8)
    expect(rms(long, 2000, 4000)).toBeGreaterThan(rms(short, 2000, 4000) * 5)
  })

  it('stays finite at the longest ring and the highest body', () => {
    const rung = strike(6, 7900, 1, 3)
    expect(rung.every((value) => Number.isFinite(value))).toBe(true)
  })

  /**
   * A partial above Nyquist is skipped rather than folded back down as a whine.
   *
   * The assertion used to be `< 20`, which is the "did not blow up" test one line above wearing a
   * different name: take the Nyquist check out of `modal.ts` altogether and this still passed. It
   * asks the real question now — the body's own partials fold to audible tones when they are kept,
   * so what is heard is measured, and a bank whose partials all sit above the ceiling is silent.
   */
  it('drops a partial that would not fit under the rate', () => {
    const loudest = (samples: Float32Array) => samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0)
    // Every partial of a body at 21 kHz is above this rate's ceiling, so there is nothing to ring:
    // the bank passes the one sample of excitation and then nothing at all.
    expect(loudest(strike(6, 21000, 1, 0.3).slice(1))).toBeLessThan(1e-6)
    // The same body two octaves down has partials that fit, and rings on after the strike.
    expect(loudest(strike(6, 5000, 1, 0.3).slice(1))).toBeGreaterThan(0.01)
  })

  it('passes the signal straight through when it has no partials', () => {
    const states = createModal(0)
    expect(modalSample(states, 0.42, 800, 0.5, 0.2, SAMPLE_RATE)).toBe(0.42)
  })
})
