import type { InsertSlot } from '../types.ts'
import { createShaper, crushSample, saturate, type ShaperState } from './shaper.ts'
import { createModal, modalSample, type ModalState } from './modal.ts'
import { line, readAt, write, type Line } from './delayline.ts'

/**
 * The three effects a layer runs through, one slot at a time.
 *
 * Every kind here is a true bypass at no amount, and the crossfade is the same one everywhere: the
 * treated sound against the untreated, never a level change. That is what makes a slot safe to
 * leave switched on and turned down, and it is why a patch that has never touched its slots comes
 * out of this file bit for bit as it went in.
 *
 * The state is built once per layer per channel and handed back on every sample. Nothing here
 * allocates inside the loop, and every branch sees the same shape of object — which is the whole
 * reason a slot is a kind on a record rather than seven classes with a `process` method.
 */

export type InsertState = {
  shaper: ShaperState
  body: ModalState[] | null
  line: Line | null
  /** The ring modulator's own oscillator, in cycles. */
  phase: number
}

const MAX_COMB_SECONDS = 0.05

export function createInsert(slot: InsertSlot, sampleRate: number): InsertState {
  return {
    shaper: createShaper(),
    body: slot.kind === 'body' ? createModal(Math.min(6, Math.max(1, Math.round(slot.partials)))) : null,
    line: slot.kind === 'comb' ? line(Math.ceil(MAX_COMB_SECONDS * sampleRate) + 2) : null,
    phase: 0,
  }
}

/**
 * Reflects what leaves the rails back inside them, as many times as it takes.
 *
 * A clipper flattens the top of a wave and a folder turns it round, and the difference is the
 * whole character: clipping adds the harmonics that were nearly there already, folding adds ones
 * that were not, which is why a folded sine sounds like an instrument nobody has and a clipped one
 * sounds like a broken amplifier.
 */
function fold(x: number): number {
  let value = x
  for (let guard = 0; guard < 8 && (value > 1 || value < -1); guard += 1) {
    value = value > 1 ? 2 - value : -2 - value
  }
  return Math.min(1, Math.max(-1, value))
}

/**
 * One slot on one sample. `frequency` is what the layer is playing at this instant, which the ring
 * modulator needs: a fixed ring tone against a sliding pitch is a bell that will not follow.
 */
export function insertSample(
  state: InsertState,
  slot: InsertSlot,
  input: number,
  frequency: number,
  sampleRate: number,
  /** How much of it is heard, when something is moving that: the slot's own figure otherwise. */
  heard = slot.amount,
): number {
  if (slot.kind === 'off') return input
  const amount = Math.min(1, Math.max(0, heard))
  if (amount <= 0) return input

  let wet = input
  if (slot.kind === 'drive') {
    wet = saturate(input, slot.drive)
  } else if (slot.kind === 'crusher') {
    wet = crushSample(state.shaper, slot.bitDepth, slot.crush, input)
  } else if (slot.kind === 'ring') {
    const step = (frequency * Math.min(16, Math.max(0.01, slot.ratio))) / sampleRate
    state.phase = (state.phase + step) % 1
    wet = input * Math.sin(state.phase * Math.PI * 2)
  } else if (slot.kind === 'fold') {
    wet = fold(input * (1 + Math.min(1, Math.max(0, slot.drive)) * 15))
  } else if (slot.kind === 'body' && state.body) {
    wet = modalSample(state.body, input, slot.frequency, slot.spread, slot.decay, sampleRate)
  } else if (slot.kind === 'comb' && state.line) {
    const delay = Math.max(1, Math.min(MAX_COMB_SECONDS, slot.time / 1000) * sampleRate)
    const back = readAt(state.line, delay)
    const feedback = Math.min(0.95, Math.max(0, slot.feedback))
    write(state.line, input + back * feedback)
    wet = back
  }
  return input * (1 - amount) + wet * amount
}
