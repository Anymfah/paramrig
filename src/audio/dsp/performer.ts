import type { Performer, PerformerShape } from '../types.ts'
import { STEP_COUNT } from '../fields.ts'

/**
 * A row read at a phase of its cycle, 0..1 across the sixteen steps: held at the step, joined to
 * the next by a line, or eased into it. The plate draws the row with the same reading, so what
 * is seen is what is heard.
 */
export function patternAt(pattern: readonly number[], shape: PerformerShape, phase: number, curves?: readonly number[]): number {
  const wrapped = phase - Math.floor(phase)
  const position = wrapped * STEP_COUNT
  const index = Math.min(STEP_COUNT - 1, Math.floor(position))
  const here = pattern[index] ?? 0
  if (shape === 'step') return here
  const at = (index + 1) % STEP_COUNT
  const next = pattern[at] ?? 0
  const t = position - index
  const eased = shape === 'line' ? t : t * t * (3 - 2 * t)
  // The row says how two steps are joined; the step being arrived at says how much of that
  // joining happens. At nothing it is held to its own boundary whatever the row says.
  const joined = curves ? Math.min(1, Math.max(0, curves[at] ?? 1)) : 1
  return here + (next - here) * eased * joined
}

/**
 * Where a performer stands at a moment of the sound: its row read `rate` times over the sound's
 * length. Unipolar it rests on the floor; bipolar it rests at half height and swings both ways.
 */
export function performerAt(performer: Performer, pattern: readonly number[], curves: readonly number[] | undefined, clock: number, duration: number): number {
  const level = patternAt(pattern, performer.shape, duration > 0 ? (clock / duration) * performer.rate : 0, curves)
  return performer.bipolar ? level * 2 - 1 : level
}
