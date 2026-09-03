import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { EulerOrder, Transform, Vec3 } from '@/scene/types'

/**
 * The geometry the modal transform stands on: turning pointer pixels into world movement, keeping
 * an angle that may sweep well past half a turn, and composing rotations without letting the Euler
 * angles the document stores jump at ±180 degrees.
 *
 * Everything here is a plain function of numbers and tuples. three.js supplies the matrix and
 * quaternion arithmetic and nothing else: no object in this module belongs to a scene graph, so the
 * whole of it is testable without a browser.
 */

/** What a typed or snapped number means, which decides its increment, its unit and its wording. */
export type TransformUnit = 'length' | 'angle' | 'factor'

/** Three orthonormal directions in world space: the frame a constraint is expressed in. */
export type Basis = { x: Vec3; y: Vec3; z: Vec3 }

export const GLOBAL_BASIS: Basis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }

/** Everything the session needs to know about the camera, without holding a camera. */
export type ViewBasis = {
  /** Camera basis in world space, all unit vectors; `forward` points away from the viewer. */
  right: Vec3
  up: Vec3
  forward: Vec3
  /** World units per screen pixel at the pivot's depth; a move of one pixel is this far. */
  unitsPerPixel: number
  /** Where the pivot lands on screen, in pixels, for rotation angles and scale ratios. */
  pivotScreen: [number, number]
}

export type QuaternionValue = [number, number, number, number]

/**
 * How nearly edge-on an axis may be before the cursor stops driving it.
 *
 * Movement along an axis is recovered by dividing the cursor's travel by the axis's length on
 * screen, so an axis pointing at the camera would divide by nothing and send the object to
 * infinity. Below this the division is capped, which costs a little tracking accuracy on an axis
 * the person can barely see anyway.
 */
const EDGE_ON_LIMIT = 0.04

/** Below this the least-squares solve for a plane is singular and plain projection is used. */
const SINGULAR_LIMIT = 1e-6

/* ---------------------------------------------------------------- vectors */

export function addVectors(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function subtractVectors(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function scaleVector(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor]
}

export function dotProduct(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function crossProduct(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function vectorLength(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** A unit vector, or the zero vector when there is no direction to speak of. */
export function normalizeVector(a: Vec3): Vec3 {
  const length = vectorLength(a)
  if (length === 0) return [0, 0, 0]
  return [a[0] / length, a[1] / length, a[2] / length]
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/* ------------------------------------------------------------------ rays */

/** Where a ray meets a plane, or null when it runs parallel to it. */
export function rayPlanePoint(origin: Vec3, direction: Vec3, planePoint: Vec3, planeNormal: Vec3): Vec3 | null {
  const denominator = dotProduct(direction, planeNormal)
  if (Math.abs(denominator) < SINGULAR_LIMIT) return null
  const distance = dotProduct(subtractVectors(planePoint, origin), planeNormal) / denominator
  return addVectors(origin, scaleVector(direction, distance))
}

/**
 * The point on an infinite line closest to a ray, or null when the two are parallel.
 *
 * This is how a gizmo handle tracks the cursor: the line is the arrow, the ray is the pick ray, and
 * the answer is where the arrow's tip should sit.
 */
export function closestPointOnLine(
  lineOrigin: Vec3,
  lineDirection: Vec3,
  rayOrigin: Vec3,
  rayDirection: Vec3,
): Vec3 | null {
  const line = normalizeVector(lineDirection)
  const ray = normalizeVector(rayDirection)
  const between = subtractVectors(lineOrigin, rayOrigin)
  const lineRay = dotProduct(line, ray)
  const denominator = 1 - lineRay * lineRay
  if (Math.abs(denominator) < SINGULAR_LIMIT) return null
  const alongLine = (lineRay * dotProduct(between, ray) - dotProduct(between, line)) / denominator
  return addVectors(lineOrigin, scaleVector(line, alongLine))
}

/* ---------------------------------------------------------------- angles */

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

/** The angle of a screen point around a pivot, in degrees, growing clockwise because y grows down. */
export function screenAngle(pivot: [number, number], point: [number, number]): number {
  return toDegrees(Math.atan2(point[1] - pivot[1], point[0] - pivot[0]))
}

/**
 * `angle` shifted by whole turns until it is the reading nearest `previous`.
 *
 * Rotation is accumulated one step at a time rather than taken from a single difference of
 * arc-tangents, which is what lets a sweep pass 180 degrees and carry on to 400 instead of folding
 * back to −320.
 */
export function unwrapAngle(previous: number, angle: number): number {
  return angle + 360 * Math.round((previous - angle) / 360)
}

/** The shortest signed way round from one angle to another, in degrees. */
export function angleDelta(from: number, to: number): number {
  return unwrapAngle(from, to) - from
}

/* ----------------------------------------------------------------- screen */

/** How far the cursor's travel reaches across the plane of the screen, in world units. */
export function viewPlaneDelta(pixels: [number, number], view: ViewBasis): Vec3 {
  const across = scaleVector(view.right, pixels[0] * view.unitsPerPixel)
  const down = scaleVector(view.up, -pixels[1] * view.unitsPerPixel)
  return addVectors(across, down)
}

/** How long one world unit along an axis is on screen, squared, in units of a screen pixel. */
function screenSquare(axis: Vec3, view: ViewBasis): number {
  const across = dotProduct(axis, view.right)
  const down = dotProduct(axis, view.up)
  return across * across + down * down
}

/**
 * How far to move along each of `axes` so that the object follows the cursor as closely as it can.
 *
 * With one axis this is the travel divided by the axis's length on screen, so an axis seen almost
 * edge-on moves further per pixel — the behaviour that makes a constrained drag feel as though the
 * cursor were pinned to the object. With two it is the same idea solved as a pair of normal
 * equations. With none or with three, the free movement across the screen already answers it and
 * the projections are exact.
 */
export function screenAxisAmounts(axes: Vec3[], pixels: [number, number], view: ViewBasis): number[] {
  const free = viewPlaneDelta(pixels, view)
  const first = axes[0]
  const second = axes[1]
  if (!first) return []
  if (!second) return [dotProduct(free, first) / Math.max(screenSquare(first, view), EDGE_ON_LIMIT)]
  if (axes.length > 2) return axes.map((axis) => dotProduct(free, axis))

  const alongFirst = screenSquare(first, view)
  const alongSecond = screenSquare(second, view)
  const between =
    dotProduct(first, view.right) * dotProduct(second, view.right) +
    dotProduct(first, view.up) * dotProduct(second, view.up)
  const determinant = alongFirst * alongSecond - between * between
  const toFirst = dotProduct(free, first)
  const toSecond = dotProduct(free, second)
  if (Math.abs(determinant) < SINGULAR_LIMIT) return [toFirst, toSecond]
  return [
    (toFirst * alongSecond - between * toSecond) / determinant,
    (alongFirst * toSecond - between * toFirst) / determinant,
  ]
}

/** How much bigger the cursor's distance from the pivot is now than it was when the session opened. */
export function scaleRatio(pivot: [number, number], start: [number, number], current: [number, number]): number {
  const before = Math.hypot(start[0] - pivot[0], start[1] - pivot[1])
  if (before < SINGULAR_LIMIT) return 1
  return Math.hypot(current[0] - pivot[0], current[1] - pivot[1]) / before
}

/* ------------------------------------------------------------ quaternions */

/** The Euler order a transform is read in; a quaternion transform still reports one for its Euler. */
export function transformOrder(transform: Transform): EulerOrder {
  const mode = transform.rotationMode
  return mode && mode !== 'quaternion' ? mode : 'XYZ'
}

export function quaternionFromEuler(rotation: Vec3, order: EulerOrder): QuaternionValue {
  const euler = new Euler(toRadians(rotation[0]), toRadians(rotation[1]), toRadians(rotation[2]), order)
  const quaternion = new Quaternion().setFromEuler(euler)
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
}

/** A transform's rotation as a quaternion, reading the stored one only when the mode asks for it. */
export function quaternionOf(transform: Transform): QuaternionValue {
  const stored = transform.quaternion
  if (transform.rotationMode === 'quaternion' && stored) {
    const quaternion = new Quaternion(stored[0], stored[1], stored[2], stored[3]).normalize()
    return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
  }
  return quaternionFromEuler(transform.rotation, transformOrder(transform))
}

export function quaternionFromAxisAngle(axis: Vec3, degrees: number): QuaternionValue {
  const unit = normalizeVector(axis)
  if (vectorLength(unit) === 0) return [0, 0, 0, 1]
  const quaternion = new Quaternion().setFromAxisAngle(new Vector3(...unit), toRadians(degrees))
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
}

/** `a` applied after `b`, the order a world-space rotation is composed onto an object's own. */
export function multiplyQuaternions(a: QuaternionValue, b: QuaternionValue): QuaternionValue {
  const result = new Quaternion(a[0], a[1], a[2], a[3]).multiply(new Quaternion(b[0], b[1], b[2], b[3]))
  return [result.x, result.y, result.z, result.w]
}

function eulerMatches(candidate: Vec3, order: EulerOrder, quaternion: Quaternion): boolean {
  const value = quaternionFromEuler(candidate, order)
  const dot = value[0] * quaternion.x + value[1] * quaternion.y + value[2] * quaternion.z + value[3] * quaternion.w
  // A quaternion and its negation are the same rotation, so only the size of the dot product counts.
  return Math.abs(dot) > 0.9999
}

function nearestTurn(candidate: Vec3, previous: Vec3): Vec3 {
  return [
    candidate[0] + 360 * Math.round((previous[0] - candidate[0]) / 360),
    candidate[1] + 360 * Math.round((previous[1] - candidate[1]) / 360),
    candidate[2] + 360 * Math.round((previous[2] - candidate[2]) / 360),
  ]
}

function angleDistance(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

const AXIS_SLOT: Record<string, 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 }

/**
 * The second Euler reading of the same rotation: half a turn on the outer and inner angles, and the
 * middle one reflected through a quarter turn.
 *
 * Which component is outer, middle and inner is the order's business, not the tuple's — for 'XZY'
 * the middle angle is z — which is why this is indexed through the order string rather than written
 * out as a formula on x, y and z.
 */
function eulerTwin(canonical: Vec3, order: EulerOrder): Vec3 {
  const outer = AXIS_SLOT[order[0] ?? 'X'] ?? 0
  const middle = AXIS_SLOT[order[1] ?? 'Y'] ?? 1
  const inner = AXIS_SLOT[order[2] ?? 'Z'] ?? 2
  const twin: Vec3 = [canonical[0], canonical[1], canonical[2]]
  twin[outer] = canonical[outer] + 180
  twin[middle] = 180 - canonical[middle]
  twin[inner] = canonical[inner] + 180
  return twin
}

/**
 * The Euler triple, in degrees, that reads a quaternion as continuously as it can from `previous`.
 *
 * Every rotation has two Euler readings and each of those repeats every full turn, so the naive
 * conversion snaps from 179 to −179 in the middle of a sweep and the number in the sidebar leaps.
 * Both readings are generated, wound to the turn nearest the angles the object already had, checked
 * against the quaternion in case the second reading does not hold for this order, and the nearest
 * one wins.
 */
export function eulerFromQuaternion(value: QuaternionValue, order: EulerOrder, previous?: Vec3): Vec3 {
  const quaternion = new Quaternion(value[0], value[1], value[2], value[3]).normalize()
  const euler = new Euler().setFromQuaternion(quaternion, order)
  const canonical: Vec3 = [toDegrees(euler.x), toDegrees(euler.y), toDegrees(euler.z)]
  if (!previous) return canonical

  const candidates = [canonical, eulerTwin(canonical, order)]
    .map((candidate) => nearestTurn(candidate, previous))
    .filter((candidate) => eulerMatches(candidate, order, quaternion))
  const best = candidates.reduce<Vec3 | null>((chosen, candidate) => {
    if (!chosen) return candidate
    return angleDistance(candidate, previous) < angleDistance(chosen, previous) ? candidate : chosen
  }, null)
  return best ?? canonical
}

/** A point turned about a pivot by a quaternion. */
export function rotatePointAround(point: Vec3, pivot: Vec3, quaternion: QuaternionValue): Vec3 {
  const offset = new Vector3(...subtractVectors(point, pivot))
  offset.applyQuaternion(new Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]))
  return addVectors(pivot, [offset.x, offset.y, offset.z])
}

/* --------------------------------------------------------------- matrices */

export type DecomposedTransform = { position: Vec3; rotation: Vec3; scale: Vec3 }

/** A transform as a column-major 4×4, the form a composition has to pass through. */
export function matrixFromTransform(transform: Transform): number[] {
  const quaternion = quaternionOf(transform)
  const matrix = new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
    new Vector3(...transform.scale),
  )
  return matrix.toArray()
}

/**
 * A column-major 4×4 split back into position, Euler degrees and scale.
 *
 * Shear cannot be stored in a transform and is dropped here, which is the one place the editor
 * quietly parts company with Blender: scaling along an axis a rotated object does not own produces
 * a sheared matrix there and an orthonormalised one here.
 */
export function decomposeMatrix(elements: number[], order: EulerOrder = 'XYZ', previous?: Vec3): DecomposedTransform {
  const matrix = new Matrix4().fromArray(elements)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  return {
    position: [position.x, position.y, position.z],
    rotation: eulerFromQuaternion([quaternion.x, quaternion.y, quaternion.z, quaternion.w], order, previous),
    scale: [scale.x, scale.y, scale.z],
  }
}

/** The rotation of a transform as a row-major 3×3, for taking a frame apart by hand. */
export function rotationMatrix3(transform: Transform): number[] {
  const quaternion = quaternionOf(transform)
  const matrix = new Matrix4().makeRotationFromQuaternion(
    new Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
  )
  const m = matrix.elements
  return [m[0] ?? 1, m[4] ?? 0, m[8] ?? 0, m[1] ?? 0, m[5] ?? 1, m[9] ?? 0, m[2] ?? 0, m[6] ?? 0, m[10] ?? 1]
}

/** The three world directions a transform's own axes point along. */
export function transformAxes(transform: Transform): Basis {
  const rows = rotationMatrix3(transform)
  return {
    x: [rows[0] ?? 1, rows[3] ?? 0, rows[6] ?? 0],
    y: [rows[1] ?? 0, rows[4] ?? 1, rows[7] ?? 0],
    z: [rows[2] ?? 0, rows[5] ?? 0, rows[8] ?? 1],
  }
}

/* -------------------------------------------------------------- 3x3 work */

export function identityMatrix3(): number[] {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1]
}

export function multiplyMatrix3(a: number[], b: number[]): number[] {
  const out = identityMatrix3()
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let total = 0
      for (let step = 0; step < 3; step += 1) total += (a[row * 3 + step] ?? 0) * (b[step * 3 + column] ?? 0)
      out[row * 3 + column] = total
    }
  }
  return out
}

export function transposeMatrix3(a: number[]): number[] {
  return [a[0] ?? 0, a[3] ?? 0, a[6] ?? 0, a[1] ?? 0, a[4] ?? 0, a[7] ?? 0, a[2] ?? 0, a[5] ?? 0, a[8] ?? 0]
}

export function applyMatrix3(rows: number[], vector: Vec3): Vec3 {
  return [
    (rows[0] ?? 0) * vector[0] + (rows[1] ?? 0) * vector[1] + (rows[2] ?? 0) * vector[2],
    (rows[3] ?? 0) * vector[0] + (rows[4] ?? 0) * vector[1] + (rows[5] ?? 0) * vector[2],
    (rows[6] ?? 0) * vector[0] + (rows[7] ?? 0) * vector[1] + (rows[8] ?? 0) * vector[2],
  ]
}

/** The world matrix that stretches by a factor along each of a set of orthonormal axes. */
export function axisScaleMatrix(axes: Vec3[], factors: number[]): number[] {
  const rows = identityMatrix3()
  axes.forEach((axis, index) => {
    const extra = (factors[index] ?? 1) - 1
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        rows[row * 3 + column] = (rows[row * 3 + column] ?? 0) + extra * (axis[row] ?? 0) * (axis[column] ?? 0)
      }
    }
  })
  return rows
}

/**
 * A transform with a 3×3 world matrix applied about a pivot, taken apart again.
 *
 * This is the general path for scaling: it is right for every orientation and every pivot, and it
 * pays for that generality by losing shear and by letting the decomposition choose which axis wears
 * a mirror's minus sign. The session takes a shorter, exact route whenever it can.
 */
export function applyMatrixAbout(transform: Transform, pivot: Vec3, rows: number[], previous?: Vec3): DecomposedTransform {
  const matrix = new Matrix4().set(
    rows[0] ?? 1, rows[1] ?? 0, rows[2] ?? 0, 0,
    rows[3] ?? 0, rows[4] ?? 1, rows[5] ?? 0, 0,
    rows[6] ?? 0, rows[7] ?? 0, rows[8] ?? 1, 0,
    0, 0, 0, 1,
  )
  const result = new Matrix4()
    .makeTranslation(pivot[0], pivot[1], pivot[2])
    .multiply(matrix)
    .multiply(new Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]))
    .multiply(new Matrix4().fromArray(matrixFromTransform(transform)))
  return decomposeMatrix(result.toArray(), transformOrder(transform), previous)
}
