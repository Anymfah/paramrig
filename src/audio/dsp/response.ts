import type { FilterKind } from '../types.ts'
import { createFilter, filterSample } from './filter.ts'

/**
 * What a filter does to a sound, measured rather than drawn.
 *
 * A picker of eight filter names is a picker nobody uses, and a hand-drawn curve beside each name
 * is a promise the code does not have to keep. So the curve is measured: a steady tone at each of
 * a few dozen frequencies is pushed through the filter itself, the level that comes out is what is
 * plotted, and a model whose behaviour changes is a picture that changes with it.
 *
 * Measuring is also what settled which models are worth having. An allpass was written and then
 * removed: its magnitude is flat, and summed with the dry signal — the only way anyone uses one —
 * it measures as the notch that is already in the list. Its own use is inside a phaser, which is
 * an effect rather than a filter.
 */

/** Where the curve is measured, in decibels, and the band it covers. */
export const RESPONSE_FLOOR = -36
export const RESPONSE_CEILING = 12
const LOW = 60
const HIGH = 16000

/**
 * The level a steady tone comes out at, per frequency, in decibels.
 *
 * Half the run is thrown away: a filter needs a few hundred samples to stop answering the start of
 * the tone and start answering the tone.
 */
export function filterCurve(kind: FilterKind, points = 48, cutoff = 1200, resonance = 0.55, sampleRate = 44100): Float64Array {
  const out = new Float64Array(points)
  for (let at = 0; at < points; at += 1) {
    const tone = LOW * Math.pow(HIGH / LOW, at / (points - 1))
    const state = createFilter(kind, sampleRate)
    const run = 2048
    let sum = 0
    for (let i = 0; i < run * 2; i += 1) {
      const input = Math.sin((2 * Math.PI * tone * i) / sampleRate)
      const value = filterSample(state, kind, input, cutoff, resonance, sampleRate)
      if (i >= run) sum += value * value
    }
    const rms = Math.sqrt(sum / run)
    // A steady sine has an RMS of one over root two; that is the level nothing has been done to.
    const level = 20 * Math.log10(Math.max(1e-6, rms * Math.SQRT2))
    out[at] = Math.min(RESPONSE_CEILING, Math.max(RESPONSE_FLOOR, level))
  }
  return out
}

const drawn = new Map<string, Float64Array>()

/** The same curve, measured once per model and kept. */
export function filterResponse(kind: FilterKind): Float64Array {
  const kept = drawn.get(kind)
  if (kept) return kept
  const made = filterCurve(kind)
  drawn.set(kind, made)
  return made
}
