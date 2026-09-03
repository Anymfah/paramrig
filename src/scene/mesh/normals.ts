import { vertexPosition } from '@/scene/mesh/data'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * Face and vertex normals, the bounds of a mesh, and the vector arithmetic the rest of `mesh/`
 * leans on.
 *
 * A face normal is Newell's sum over the whole loop rather than one cross product of two edges: a
 * face here may have any number of corners and is nowhere promised to be planar, so Newell's sum
 * reads the best-fit plane of every corner where a cross product would only ever see three of
 * them. Nothing in this module returns NaN — a face with no area has no direction to report, so it
 * reports +Z and the caller carries on drawing.
 */

/** Under this, Newell's sum is rounding noise and the loop it came from has no direction at all. */
const MINIMUM_SUM = 1e-12

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}

/** A zero vector has no direction, so it stays zero; the callers who need a fallback pick their own. */
export function normalize(vector: Vec3): Vec3 {
  const size = length(vector)
  if (size === 0) return [0, 0, 0]
  return [vector[0] / size, vector[1] / size, vector[2] / size]
}

/** Every corner of a face, in loop order. A face slot nothing answers to has no corners. */
function facePoints(mesh: MeshData, faceSlot: number): Vec3[] {
  const face = mesh.faces[faceSlot]
  if (!face) return []
  return face.map((slot) => vertexPosition(mesh, slot))
}

/**
 * Newell's sum: a vector along the normal of the loop's best-fit plane, as long as twice the area
 * the loop projects onto that plane. Both halves of that are wanted here, so the sum is kept as it
 * comes and normalised only where a direction is what was asked for.
 */
function newellSum(points: Vec3[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    x += (current[1] - next[1]) * (current[2] + next[2])
    y += (current[2] - next[2]) * (current[0] + next[0])
    z += (current[0] - next[0]) * (current[1] + next[1])
  }
  return [x, y, z]
}

/** The unit normal of a loop of points, wound counter-clockwise seen from the side it faces. */
export function newellNormal(points: Vec3[]): Vec3 {
  if (points.length < 3) return [0, 0, 1]
  const sum = newellSum(points)
  if (length(sum) <= MINIMUM_SUM) return [0, 0, 1]
  return normalize(sum)
}

export function faceNormal(mesh: MeshData, faceSlot: number): Vec3 {
  return newellNormal(facePoints(mesh, faceSlot))
}

/** The median of a face's corners: where Blender puts the face dot, and where a gizmo hangs. */
export function faceCentre(mesh: MeshData, faceSlot: number): Vec3 {
  const points = facePoints(mesh, faceSlot)
  if (points.length === 0) return [0, 0, 0]
  let x = 0
  let y = 0
  let z = 0
  for (const point of points) {
    x += point[0]
    y += point[1]
    z += point[2]
  }
  return [x / points.length, y / points.length, z / points.length]
}

/** For a face that is not planar, this is the area of its shadow on its own best-fit plane. */
export function faceArea(mesh: MeshData, faceSlot: number): number {
  return length(newellSum(facePoints(mesh, faceSlot))) / 2
}

/**
 * The angle a loop turns through at one corner, which is how much that face counts towards the
 * normal of the vertex sitting there. Weighting by angle rather than by area stops a vertex shared
 * between one broad n-gon and a few narrow triangles from leaning towards the n-gon.
 */
function cornerAngle(points: Vec3[], corner: number): number {
  const count = points.length
  const current = points[corner]!
  const toPrevious = subtract(points[(corner + count - 1) % count]!, current)
  const toNext = subtract(points[(corner + 1) % count]!, current)
  const sizes = length(toPrevious) * length(toNext)
  if (sizes === 0) return 0
  return Math.acos(Math.min(1, Math.max(-1, dot(toPrevious, toNext) / sizes)))
}

export function vertexNormal(mesh: MeshData, vertexSlot: number): Vec3 {
  let sum: Vec3 = [0, 0, 0]
  for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
    const face = mesh.faces[faceSlot]!
    const corner = face.indexOf(vertexSlot)
    if (corner < 0) continue
    const points = facePoints(mesh, faceSlot)
    const raw = newellSum(points)
    // A face with no area would otherwise contribute its +Z fallback, which is a direction it never had.
    if (length(raw) <= MINIMUM_SUM) continue
    sum = add(sum, scale(normalize(raw), cornerAngle(points, corner)))
  }
  if (length(sum) <= MINIMUM_SUM) return [0, 0, 1]
  return normalize(sum)
}

/** Three floats per face slot, in slot order, ready for a buffer attribute. */
export function faceNormals(mesh: MeshData): Float32Array {
  const normals = new Float32Array(mesh.faces.length * 3)
  for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
    const normal = faceNormal(mesh, faceSlot)
    normals[faceSlot * 3] = normal[0]
    normals[faceSlot * 3 + 1] = normal[1]
    normals[faceSlot * 3 + 2] = normal[2]
  }
  return normals
}

/**
 * Three floats per vertex slot. One pass over the faces accumulates the weighted sums in place,
 * because the alternative — asking each vertex which faces touch it — walks the whole mesh once
 * per vertex.
 */
export function vertexNormals(mesh: MeshData): Float32Array {
  const count = mesh.vertexIds.length
  const normals = new Float32Array(count * 3)
  for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
    const face = mesh.faces[faceSlot]!
    const points = facePoints(mesh, faceSlot)
    const raw = newellSum(points)
    if (length(raw) <= MINIMUM_SUM) continue
    const normal = normalize(raw)
    for (let corner = 0; corner < face.length; corner += 1) {
      const slot = face[corner]!
      if (slot < 0 || slot >= count) continue
      const weight = cornerAngle(points, corner)
      const base = slot * 3
      normals[base] = normals[base]! + normal[0] * weight
      normals[base + 1] = normals[base + 1]! + normal[1] * weight
      normals[base + 2] = normals[base + 2]! + normal[2] * weight
    }
  }
  for (let slot = 0; slot < count; slot += 1) {
    const base = slot * 3
    const x = normals[base]!
    const y = normals[base + 1]!
    const z = normals[base + 2]!
    const size = Math.hypot(x, y, z)
    // A loose vertex is touched by no face; it still needs a direction the renderer can upload.
    if (size <= MINIMUM_SUM) {
      normals[base] = 0
      normals[base + 1] = 0
      normals[base + 2] = 1
      continue
    }
    normals[base] = x / size
    normals[base + 1] = y / size
    normals[base + 2] = z / size
  }
  return normals
}

/** The axis-aligned box around every vertex, and the two figures the sidebar shows from it. */
export function meshBounds(mesh: MeshData): { min: Vec3; max: Vec3; centre: Vec3; size: Vec3 } {
  const count = mesh.vertexIds.length
  if (count === 0) return { min: [0, 0, 0], max: [0, 0, 0], centre: [0, 0, 0], size: [0, 0, 0] }
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let slot = 0; slot < count; slot += 1) {
    const [x, y, z] = vertexPosition(mesh, slot)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    centre: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  }
}
