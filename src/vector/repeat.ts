import { composeAffine, flipAffine, rotationAffine, scaleAffine, translationAffine, transformElementAffine, IDENTITY, type Affine } from '@/vector/affine'
import type { Bounds } from '@/vector/geometry'
import type { VectorElement, VectorPoint } from '@/vector/types'

/** A transform expressed the way a dialog asks for it, rather than as a matrix. */
export type NumericTransform = {
  dx: number
  dy: number
  /** Percentages: 100 leaves the size alone. */
  scaleX: number
  scaleY: number
  rotation: number
  flipX: boolean
  flipY: boolean
}

export const IDENTITY_TRANSFORM: NumericTransform = { dx: 0, dy: 0, scaleX: 100, scaleY: 100, rotation: 0, flipX: false, flipY: false }

export function isIdentityTransform(transform: NumericTransform): boolean {
  return Math.abs(transform.dx) < 0.005 && Math.abs(transform.dy) < 0.005
    && Math.abs(transform.scaleX - 100) < 0.005 && Math.abs(transform.scaleY - 100) < 0.005
    && Math.abs(transform.rotation) < 0.005 && !transform.flipX && !transform.flipY
}

/**
 * The matrix a numeric transform stands for: flips, then scale, then rotation — all about
 * `center` — and the translation last, so the fields read independently of one another.
 */
export function numericAffine(transform: NumericTransform, center: VectorPoint): Affine {
  let map = IDENTITY
  if (transform.flipX) map = composeAffine(map, flipAffine('x', center))
  if (transform.flipY) map = composeAffine(map, flipAffine('y', center))
  map = composeAffine(map, scaleAffine(transform.scaleX / 100, transform.scaleY / 100, center))
  if (transform.rotation) map = composeAffine(map, rotationAffine(transform.rotation, center))
  return composeAffine(map, translationAffine(transform.dx, transform.dy))
}

export function transformPatches(elements: VectorElement[], map: Affine): Array<{ id: string; patch: Partial<VectorElement> }> {
  return elements.map((element) => ({ id: element.id, patch: transformElementAffine(element, map) }))
}

/** Applies a numeric transform to a set of elements, about the pivot or their common centre. */
export function numericPatches(
  elements: VectorElement[],
  transform: NumericTransform,
  pivot?: VectorPoint | null,
): Array<{ id: string; patch: Partial<VectorElement> }> {
  if (elements.length === 0) return []
  const center = pivot ?? boxCenter(boxBounds(elements))
  return transformPatches(elements, numericAffine(transform, center))
}

/**
 * The transform that took `before` to `after`, as a repeatable step. Returns null when nothing
 * moved, so a duplicate followed by no gesture does not arm the repeat.
 */
export function stepBetween(before: VectorElement[], after: VectorElement[]): NumericTransform | null {
  if (before.length === 0 || before.length !== after.length) return null
  // Read the plain boxes, not the rotated hulls: a turn would otherwise read as a growth.
  const from = boxBounds(before)
  const to = boxBounds(after)
  if (from.width <= 0 || from.height <= 0) return null
  const step: NumericTransform = {
    dx: round(boxCenter(to).x - boxCenter(from).x),
    dy: round(boxCenter(to).y - boxCenter(from).y),
    scaleX: round((to.width / from.width) * 100),
    scaleY: round((to.height / from.height) * 100),
    rotation: round(after[0]!.rotation - before[0]!.rotation),
    flipX: false,
    flipY: false,
  }
  return isIdentityTransform(step) ? null : step
}

/**
 * Angles for a set of rotated copies: `count` copies spread over `total` degrees. A full turn
 * lands them evenly without putting a copy back on the original.
 */
export function copyAngles(count: number, total: number): number[] {
  const copies = Math.max(1, Math.min(180, Math.round(count)))
  const full = Math.abs(Math.abs(total) - 360) < 0.001
  const span = full ? total / (copies + 1) : total / copies
  return Array.from({ length: copies }, (_, index) => round(span * (index + 1)))
}

/** Patches placing one rotated copy about a pivot. */
export function rotatedCopyPatches(elements: VectorElement[], angle: number, pivot: VectorPoint): Array<{ id: string; patch: Partial<VectorElement> }> {
  return transformPatches(elements, rotationAffine(angle, pivot))
}

/** The union of the element boxes, ignoring their rotation. */
export function boxBounds(elements: VectorElement[]): Bounds {
  const left = Math.min(...elements.map((element) => element.x))
  const top = Math.min(...elements.map((element) => element.y))
  const right = Math.max(...elements.map((element) => element.x + element.width))
  const bottom = Math.max(...elements.map((element) => element.y + element.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function boxCenter(bounds: Bounds): VectorPoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
