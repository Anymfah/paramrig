import type { Vec3 } from '@/scene/types'

/**
 * Just enough four-by-four for a modifier.
 *
 * A modifier module may not import three.js — that is what keeps every one of them testable against
 * a cube rather than against a renderer — but several of them need to place another object's shape
 * in this one's frame: a mirror about an empty, an array offset by an object, a boolean against a
 * cube somewhere else. Sixteen numbers and three functions cover all of it.
 *
 * The layout is three's own, column-major: `m[12]`, `m[13]`, `m[14]` are the translation. The stack
 * hands the numbers over exactly as `Matrix4.toArray` wrote them, so nothing has to be transposed
 * on the way in or out.
 */

export const IDENTITY: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** A point through a matrix, with the perspective divide a projection would need. */
export function applyMatrix(matrix: number[], point: Vec3): Vec3 {
  const [x, y, z] = point
  const w = (matrix[3] ?? 0) * x + (matrix[7] ?? 0) * y + (matrix[11] ?? 0) * z + (matrix[15] ?? 1)
  const divisor = Math.abs(w) < 1e-12 ? 1 : w
  return [
    ((matrix[0] ?? 1) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0)) / divisor,
    ((matrix[1] ?? 0) * x + (matrix[5] ?? 1) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0)) / divisor,
    ((matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 1) * z + (matrix[14] ?? 0)) / divisor,
  ]
}

/** A direction through a matrix: the translation is left out, because a direction has no place. */
export function applyDirection(matrix: number[], vector: Vec3): Vec3 {
  const [x, y, z] = vector
  return [
    (matrix[0] ?? 1) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z,
    (matrix[1] ?? 0) * x + (matrix[5] ?? 1) * y + (matrix[9] ?? 0) * z,
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 1) * z,
  ]
}

export function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0
      for (let index = 0; index < 4; index += 1) sum += (a[index * 4 + row] ?? 0) * (b[column * 4 + index] ?? 0)
      out[column * 4 + row] = sum
    }
  }
  return out
}

/** The inverse, or the identity when the matrix flattens space and has none. */
export function invert(matrix: number[]): number[] {
  const m = matrix
  const inv = new Array<number>(16).fill(0)
  inv[0] = m[5]! * m[10]! * m[15]! - m[5]! * m[11]! * m[14]! - m[9]! * m[6]! * m[15]!
    + m[9]! * m[7]! * m[14]! + m[13]! * m[6]! * m[11]! - m[13]! * m[7]! * m[10]!
  inv[4] = -m[4]! * m[10]! * m[15]! + m[4]! * m[11]! * m[14]! + m[8]! * m[6]! * m[15]!
    - m[8]! * m[7]! * m[14]! - m[12]! * m[6]! * m[11]! + m[12]! * m[7]! * m[10]!
  inv[8] = m[4]! * m[9]! * m[15]! - m[4]! * m[11]! * m[13]! - m[8]! * m[5]! * m[15]!
    + m[8]! * m[7]! * m[13]! + m[12]! * m[5]! * m[11]! - m[12]! * m[7]! * m[9]!
  inv[12] = -m[4]! * m[9]! * m[14]! + m[4]! * m[10]! * m[13]! + m[8]! * m[5]! * m[14]!
    - m[8]! * m[6]! * m[13]! - m[12]! * m[5]! * m[10]! + m[12]! * m[6]! * m[9]!
  inv[1] = -m[1]! * m[10]! * m[15]! + m[1]! * m[11]! * m[14]! + m[9]! * m[2]! * m[15]!
    - m[9]! * m[3]! * m[14]! - m[13]! * m[2]! * m[11]! + m[13]! * m[3]! * m[10]!
  inv[5] = m[0]! * m[10]! * m[15]! - m[0]! * m[11]! * m[14]! - m[8]! * m[2]! * m[15]!
    + m[8]! * m[3]! * m[14]! + m[12]! * m[2]! * m[11]! - m[12]! * m[3]! * m[10]!
  inv[9] = -m[0]! * m[9]! * m[15]! + m[0]! * m[11]! * m[13]! + m[8]! * m[1]! * m[15]!
    - m[8]! * m[3]! * m[13]! - m[12]! * m[1]! * m[11]! + m[12]! * m[3]! * m[9]!
  inv[13] = m[0]! * m[9]! * m[14]! - m[0]! * m[10]! * m[13]! - m[8]! * m[1]! * m[14]!
    + m[8]! * m[2]! * m[13]! + m[12]! * m[1]! * m[10]! - m[12]! * m[2]! * m[9]!
  inv[2] = m[1]! * m[6]! * m[15]! - m[1]! * m[7]! * m[14]! - m[5]! * m[2]! * m[15]!
    + m[5]! * m[3]! * m[14]! + m[13]! * m[2]! * m[7]! - m[13]! * m[3]! * m[6]!
  inv[6] = -m[0]! * m[6]! * m[15]! + m[0]! * m[7]! * m[14]! + m[4]! * m[2]! * m[15]!
    - m[4]! * m[3]! * m[14]! - m[12]! * m[2]! * m[7]! + m[12]! * m[3]! * m[6]!
  inv[10] = m[0]! * m[5]! * m[15]! - m[0]! * m[7]! * m[13]! - m[4]! * m[1]! * m[15]!
    + m[4]! * m[3]! * m[13]! + m[12]! * m[1]! * m[7]! - m[12]! * m[3]! * m[5]!
  inv[14] = -m[0]! * m[5]! * m[14]! + m[0]! * m[6]! * m[13]! + m[4]! * m[1]! * m[14]!
    - m[4]! * m[2]! * m[13]! - m[12]! * m[1]! * m[6]! + m[12]! * m[2]! * m[5]!
  inv[3] = -m[1]! * m[6]! * m[11]! + m[1]! * m[7]! * m[10]! + m[5]! * m[2]! * m[11]!
    - m[5]! * m[3]! * m[10]! - m[9]! * m[2]! * m[7]! + m[9]! * m[3]! * m[6]!
  inv[7] = m[0]! * m[6]! * m[11]! - m[0]! * m[7]! * m[10]! - m[4]! * m[2]! * m[11]!
    + m[4]! * m[3]! * m[10]! + m[8]! * m[2]! * m[7]! - m[8]! * m[3]! * m[6]!
  inv[11] = -m[0]! * m[5]! * m[11]! + m[0]! * m[7]! * m[9]! + m[4]! * m[1]! * m[11]!
    - m[4]! * m[3]! * m[9]! - m[8]! * m[1]! * m[7]! + m[8]! * m[3]! * m[5]!
  inv[15] = m[0]! * m[5]! * m[10]! - m[0]! * m[6]! * m[9]! - m[4]! * m[1]! * m[10]!
    + m[4]! * m[2]! * m[9]! + m[8]! * m[1]! * m[6]! - m[8]! * m[2]! * m[5]!

  const determinant = m[0]! * inv[0]! + m[1]! * inv[4]! + m[2]! * inv[8]! + m[3]! * inv[12]!
  if (Math.abs(determinant) < 1e-12) return [...IDENTITY]
  return inv.map((value) => value / determinant)
}

/** A rotation of `angle` radians about an axis through the origin. */
export function rotation(axis: Vec3, angle: number): number[] {
  const length = Math.hypot(axis[0], axis[1], axis[2])
  if (length < 1e-12) return [...IDENTITY]
  const [x, y, z] = [axis[0] / length, axis[1] / length, axis[2] / length]
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const t = 1 - cosine
  return [
    t * x * x + cosine, t * x * y + sine * z, t * x * z - sine * y, 0,
    t * x * y - sine * z, t * y * y + cosine, t * y * z + sine * x, 0,
    t * x * z + sine * y, t * y * z - sine * x, t * z * z + cosine, 0,
    0, 0, 0, 1,
  ]
}

export function translation(offset: Vec3): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], offset[2], 1]
}

export function scaling(factors: Vec3): number[] {
  return [factors[0], 0, 0, 0, 0, factors[1], 0, 0, 0, 0, factors[2], 0, 0, 0, 0, 1]
}
