import type { Performer, PerformerShape } from '../types.ts'
import { STEP_COUNT } from '../fields.ts'

/**
 * A row read at a phase of its cycle, 0..1 across the sixteen steps: held at the step, joined to
 * the next by a line, or eased into it. The plate draws the row with the same reading, so what
 * is seen is what is heard.
 */
export function patternAt(pattern: readonly number[], shape: PerformerShape, phase: number): number {
  const wrapped = phase - Math.floor(phase)
  const position = wrapped * STEP_COUNT
  const index = Math.min(STEP_COUNT - 1, Math.floor(position))
  const here = pattern[index] ?? 0
  if (shape === 'step') return here
  const next = pattern[(index + 1) % STEP_COUNT] ?? 0
  const t = position - index
  const eased = shape === 'line' ? t : t * t * (3 - 2 * t)
  return here + (next - here) * eased
}

/**
 * Where a performer stands at a moment of the sound: its row read `rate` times over the sound's
 * length. Unipolar it rests on the floor; bipolar it rests at half height and swings both ways.
 */
export function performerAt(performer: Performer, pattern: readonly number[], clock: number, duration: number): number {
  const level = patternAt(pattern, performer.shape, duration > 0 ? (clock / duration) * performer.rate : 0)
  return performer.bipolar ? level * 2 - 1 : level
}
