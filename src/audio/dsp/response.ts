import type { FilterKind, InsertKind, InsertSlot } from '../types.ts'
import { createFilter, filterSample } from './filter.ts'
import { createInsert, insertSample } from './insert.ts'

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

/**
 * What an insert does to a sound, drawn the same way: by running one through it.
 *
 * The same short burst goes into all seven — three cycles of a sine, then silence — and what
 * comes out is the picture. One input and seven outputs is a comparison; seven hand-drawn icons are
 * seven opinions. It is also the only way a picture of a body or a comb can show the thing that
 * matters about them, which is what happens after the sound that caused it has gone.
 */
const SHAPE_POINTS = 96
const SHAPE_RATE = 8000
const SHAPE_SECONDS = 0.04

/** The settings each kind is drawn at: enough of it to see, never so much that it is a smear. */
function drawnAt(kind: InsertKind): InsertSlot {
  const slot: InsertSlot = {
    kind, place: 'pre', amount: 1,
    drive: 0.22, bitDepth: 2, crush: 0.14, ratio: 0.5,
    frequency: 320, spread: 0.6, decay: 0.2, partials: 4,
    time: 7, feedback: 0.86,
  }
  if (kind === 'fold') slot.drive = 0.05
  // A comb heard fully wet is a delay; what makes it a comb is hearing it against the dry sound.
  if (kind === 'comb') slot.amount = 0.55
  return slot
}

export function insertShape(kind: InsertKind): Float64Array {
  const slot = drawnAt(kind)
  const state = createInsert(slot, SHAPE_RATE)
  const total = Math.round(SHAPE_SECONDS * SHAPE_RATE)
  const half = Math.round(total / 2)
  const tone = 3 / (SHAPE_SECONDS / 2)
  const raw = new Float64Array(total)
  let peak = 0
  for (let i = 0; i < total; i += 1) {
    const t = i / SHAPE_RATE
    // Three cycles in, then nothing, which is what makes the second half of the picture worth
    // drawing: it is where a body rings and a comb repeats and everything else is a flat line.
    const gate = i < half ? Math.min(1, (half - i) / (SHAPE_RATE * 0.003)) : 0
    const input = Math.sin(2 * Math.PI * tone * t) * gate
    const value = insertSample(state, slot, input, tone, SHAPE_RATE)
    raw[i] = value
    peak = Math.max(peak, Math.abs(value))
  }
  // Every cell fills its own box: the point of the picture is the shape, and a comb drawn at the
  // level it actually comes back at would be a flat line beside a drive.
  const scale = peak > 0 ? 1 / peak : 1
  const out = new Float64Array(SHAPE_POINTS)
  for (let at = 0; at < SHAPE_POINTS; at += 1) {
    out[at] = (raw[Math.round((at / (SHAPE_POINTS - 1)) * (total - 1))] ?? 0) * scale
  }
  return out
}

const shapes = new Map<InsertKind, Float64Array>()

/** Drawn once per kind and kept, since a picker opens more often than a model changes. */
export function insertResponse(kind: InsertKind): Float64Array {
  const known = shapes.get(kind)
  if (known) return known
  const made = insertShape(kind)
  shapes.set(kind, made)
  return made
}
