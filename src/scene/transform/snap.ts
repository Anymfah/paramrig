import { distanceBetween, type TransformUnit } from '@/scene/transform/math'
import type { SnapMode, Vec3 } from '@/scene/types'

/**
 * Snapping, which today means rounding to an increment and tomorrow means landing on a vertex.
 *
 * `nearestSnapPoint` already takes the shape the geometric modes need — a list of candidate points
 * and a tolerance in world units — so that when the picking buffer starts handing over vertices,
 * edge midpoints and face centres, only the caller changes.
 */

export type SnapIncrement = { coarse: number; fine: number }

/**
 * What one press of control rounds to, and what holding shift as well rounds to instead.
 *
 * These are Blender's: a whole unit of movement, five degrees of rotation, a tenth of a scale.
 */
export const SNAP_INCREMENTS: Record<TransformUnit, SnapIncrement> = {
  length: { coarse: 1, fine: 0.1 },
  angle: { coarse: 5, fine: 1 },
  factor: { coarse: 0.1, fine: 0.01 },
}

export function snapIncrement(unit: TransformUnit, precise: boolean): number {
  const increment = SNAP_INCREMENTS[unit]
  return precise ? increment.fine : increment.coarse
}

export function snapToIncrement(value: number, increment: number): number {
  if (!(increment > 0)) return value
  return Math.round(value / increment) * increment
}

export function snapVector(vector: Vec3, increment: number): Vec3 {
  return [
    snapToIncrement(vector[0], increment),
    snapToIncrement(vector[1], increment),
    snapToIncrement(vector[2], increment),
  ]
}

export type SnapCandidate = {
  point: Vec3
  /** Which kind of element offered the point, for the indicator the overlay draws. */
  kind?: SnapMode
  /** The element's stable id, when it has one. */
  id?: string
}

/**
 * The candidate nearest a point, or null when none is within `tolerance`.
 *
 * Ties go to the first candidate in the list, so a caller that puts vertices before edge midpoints
 * before face centres gets Blender's own order of preference for free.
 */
export function nearestSnapPoint(point: Vec3, candidates: SnapCandidate[], tolerance: number): SnapCandidate | null {
  let best: SnapCandidate | null = null
  let bestDistance = tolerance
  for (const candidate of candidates) {
    const distance = distanceBetween(point, candidate.point)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}
