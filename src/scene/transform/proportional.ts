import { clamp } from '@/scene/transform/math'

/**
 * Proportional editing's falloff curves.
 *
 * Every curve takes the same argument — the distance to the nearest selected element over the
 * radius, clamped to nought and one — and returns the share of the transform that reaches that far.
 * All of them fall to nothing at the edge of the circle, and all but one are whole at its centre:
 * random scatters the weight on purpose, which is why it is only ever asked about elements that
 * were not selected in the first place.
 */

export type FalloffKind =
  | 'smooth' | 'sphere' | 'root' | 'inverse-square' | 'sharp' | 'linear' | 'constant' | 'random'

export const FALLOFF_KINDS: FalloffKind[] = [
  'smooth', 'sphere', 'root', 'inverse-square', 'sharp', 'linear', 'constant', 'random',
]

/**
 * A stable pseudo-random number for a seed.
 *
 * The random falloff has to give the same answer every time the session recomputes, or a vertex
 * would jitter under a still cursor and undo would not land where the screen said it would.
 */
function pseudoRandom(seed: number): number {
  let value = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}

export function falloff(kind: FalloffKind, t: number, seed = 0): number {
  const distance = clamp(t, 0, 1)
  const near = 1 - distance
  switch (kind) {
    case 'smooth':
      return near * near * (3 - 2 * near)
    case 'sphere':
      return Math.sqrt(1 - distance * distance)
    case 'root':
      return Math.sqrt(near)
    case 'inverse-square':
      return near * (2 - near)
    case 'sharp':
      return near * near
    case 'linear':
      return near
    case 'constant':
      return distance < 1 ? 1 : 0
    case 'random':
      return near * pseudoRandom(seed)
  }
}

export type ProportionalPoint = {
  id: string
  /** Distance to the nearest selected element, euclidean or along the surface. */
  distance: number
}

export type ProportionalWeight = { id: string; weight: number }

/**
 * How much of the transform each unselected element receives.
 *
 * Anything beyond the radius weighs nothing and is dropped, so the caller can hand over every
 * vertex in the mesh and get back only the ones the circle reaches.
 */
export function proportionalWeights(
  points: ProportionalPoint[],
  radius: number,
  kind: FalloffKind,
  seed = 0,
): ProportionalWeight[] {
  if (!(radius > 0)) return []
  const weights: ProportionalWeight[] = []
  points.forEach((point, index) => {
    if (point.distance > radius) return
    const weight = falloff(kind, point.distance / radius, seed + index)
    if (weight > 0) weights.push({ id: point.id, weight })
  })
  return weights
}
