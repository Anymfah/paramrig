import { loopCount } from '@/scene/mesh/uv'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * The projections: a UV map computed from where a face is, rather than from how it unfolds.
 *
 * Blender's UV menu offers cube, cylinder and sphere projection beside the real unwrappers because
 * on a shape that is already a box, a tube or a ball they give the answer an unwrapper would work
 * hard to approximate — and they cost nothing. They are also what a primitive is born with, which
 * is why they live here rather than inside the unwrapper.
 *
 * Every one returns a flat array of two floats per corner, in loop order, ready to be a UV map.
 */

export type ProjectionOptions = {
  /** The size one unit of the image covers, in metres. Larger means the image repeats less. */
  scale?: number
  /** What the projection is centred on; the mesh's own centre by default. */
  centre?: Vec3
}

/** Which of the three axes a face looks along, and which way. */
export type Axis = 0 | 1 | 2

/**
 * Cube projection: each face takes the plane it faces most.
 *
 * The two coordinates are chosen so that the image is never mirrored — a texture that reads
 * backwards on three faces of a box is the one thing everybody notices.
 */
export function cubeProjection(mesh: MeshData, options: ProjectionOptions = {}): number[] {
  const centre = options.centre ?? meshCentre(mesh)
  const size = meshSize(mesh)
  /*
   * The image covers the mesh's longest side, so a box of any size is one image across rather than
   * one metre across. A projection measured in metres would make a small object a fleck of the
   * image and a large one a hundred repeats of it, and neither is what anybody means by "cube".
   */
  const span = Math.max(1e-6, Math.max(size[0], size[1], size[2])) * (options.scale ?? 1)
  const data = new Array<number>(loopCount(mesh) * 2).fill(0)
  let loop = 0
  for (const face of mesh.faces) {
    const normal = faceNormal(mesh, face)
    const axis = dominantAxis(normal)
    const sign = normal[axis] >= 0 ? 1 : -1
    for (const slot of face) {
      const point = vertexAt(mesh, slot)
      const [u, v] = planeOf(point, centre, axis, sign)
      data[loop * 2] = u / span + 0.5
      data[loop * 2 + 1] = v / span + 0.5
      loop += 1
    }
  }
  return data
}

/**
 * Cylinder projection: the angle around Z is u, the height is v.
 *
 * A face that straddles the seam at the back — where the angle wraps from one to nought — would
 * otherwise be stretched right across the image. Its corners on the far side are pushed past one
 * instead, which puts the face back together at the cost of leaving the [0, 1] square; that is what
 * Blender does too, and Pack islands is what brings it back.
 */
export function cylinderProjection(mesh: MeshData, options: ProjectionOptions = {}): number[] {
  const scale = options.scale ?? 1
  const centre = options.centre ?? meshCentre(mesh)
  const height = Math.max(1e-6, meshSize(mesh)[2])
  return perFace(mesh, (point) => {
    const angle = Math.atan2(point[1] - centre[1], point[0] - centre[0])
    return [(angle / (Math.PI * 2)) + 0.5, ((point[2] - centre[2]) / height) / scale + 0.5]
  })
}

/**
 * Sphere projection: longitude is u, latitude is v, with the same seam repair — and the poles.
 *
 * A vertex sitting exactly on the axis has no longitude: every meridian passes through it. Left
 * alone it would take the angle of nothing, which puts the pole of a triangle at the middle of the
 * image and stretches that triangle across half of it. So a corner on the axis is marked as having
 * no answer of its own, and takes the average of the corners that do — which is where a person
 * would put it.
 */
export function sphereProjection(mesh: MeshData, options: ProjectionOptions = {}): number[] {
  const centre = options.centre ?? meshCentre(mesh)
  return perFace(mesh, (point) => {
    const x = point[0] - centre[0]
    const y = point[1] - centre[1]
    const z = point[2] - centre[2]
    const radius = Math.hypot(x, y, z)
    const angle = Math.atan2(y, x)
    const polar = radius < 1e-9 ? Math.PI / 2 : Math.acos(Math.min(1, Math.max(-1, z / radius)))
    const onAxis = Math.hypot(x, y) < radius * 1e-6
    return [(angle / (Math.PI * 2)) + 0.5, 1 - polar / Math.PI, onAxis]
  })
}

/** A torus around Z: the major angle is u, the angle around the tube is v. */
export function torusProjection(mesh: MeshData, majorRadius: number, options: ProjectionOptions = {}): number[] {
  const centre = options.centre ?? meshCentre(mesh)
  return perFace(mesh, (point) => {
    const x = point[0] - centre[0]
    const y = point[1] - centre[1]
    const z = point[2] - centre[2]
    const major = Math.atan2(y, x)
    const radial = Math.hypot(x, y) - majorRadius
    const minor = Math.atan2(z, radial)
    return [(major / (Math.PI * 2)) + 0.5, (minor / (Math.PI * 2)) + 0.5]
  })
}

/**
 * A flat projection along one axis, which is what a plane, a grid and a circle are born with, and
 * what Project from view does once the view has been turned into an axis.
 */
export function planarProjection(mesh: MeshData, axis: Axis = 2, options: ProjectionOptions = {}): number[] {
  const centre = options.centre ?? meshCentre(mesh)
  const size = meshSize(mesh)
  const [a, b] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1]
  const span = Math.max(1e-6, Math.max(size[a]!, size[b]!)) * (options.scale ?? 1)
  const data = new Array<number>(loopCount(mesh) * 2).fill(0)
  let loop = 0
  for (const face of mesh.faces) {
    for (const slot of face) {
      const point = vertexAt(mesh, slot)
      data[loop * 2] = (point[a]! - centre[a]!) / span + 0.5
      data[loop * 2 + 1] = (point[b]! - centre[b]!) / span + 0.5
      loop += 1
    }
  }
  return data
}

/** Every face on the whole of the image: what Blender's Reset gives, and a box's own map. */
export function resetProjection(mesh: MeshData): number[] {
  const data = new Array<number>(loopCount(mesh) * 2).fill(0)
  let loop = 0
  for (const face of mesh.faces) {
    for (let corner = 0; corner < face.length; corner += 1) {
      // A quad takes the corners of the square; anything else is laid round the same square evenly.
      const [u, v] = face.length === 4
        ? [[0, 0], [1, 0], [1, 1], [0, 1]][corner]!
        : cornerOnCircle(corner, face.length)
      data[loop * 2] = u!
      data[loop * 2 + 1] = v!
      loop += 1
    }
  }
  return data
}

function cornerOnCircle(corner: number, count: number): [number, number] {
  const angle = (corner / count) * Math.PI * 2
  return [0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5]
}

/**
 * A projection applied face by face, with the wrap repaired.
 *
 * The repair is the whole reason this is not a simple map over corners: a projection that goes
 * round an axis has a seam, and a face lying across it has corners at both ends of the image.
 * Every face is looked at whole, and the corners on the near side of the seam are pushed past the
 * far edge so that the face stays in one piece.
 */
function perFace(mesh: MeshData, project: (point: Vec3) => [number, number, boolean?]): number[] {
  const data = new Array<number>(loopCount(mesh) * 2).fill(0)
  let loop = 0
  for (const face of mesh.faces) {
    const corners = face.map((slot) => project(vertexAt(mesh, slot)))
    const answered = corners.filter((corner) => corner[2] !== true)
    const us = answered.map(([u]) => u)
    const spread = us.length === 0 ? 0 : Math.max(...us) - Math.min(...us)
    if (spread > 0.5) {
      for (const corner of answered) if (corner[0] < 0.5) corner[0] += 1
    }
    // A corner with no longitude of its own sits between the ones that have one.
    if (answered.length > 0 && answered.length < corners.length) {
      const mean = answered.reduce((total, corner) => total + corner[0], 0) / answered.length
      for (const corner of corners) if (corner[2] === true) corner[0] = mean
    }
    for (const [u, v] of corners) {
      data[loop * 2] = u
      data[loop * 2 + 1] = v
      loop += 1
    }
  }
  return data
}

function planeOf(point: Vec3, centre: Vec3, axis: Axis, sign: number): [number, number] {
  const x = point[0] - centre[0]
  const y = point[1] - centre[1]
  const z = point[2] - centre[2]
  if (axis === 0) return [sign > 0 ? -y : y, z]
  if (axis === 1) return [sign > 0 ? x : -x, z]
  return [x, sign > 0 ? y : -y]
}

export function dominantAxis(normal: Vec3): Axis {
  const [x, y, z] = [Math.abs(normal[0]), Math.abs(normal[1]), Math.abs(normal[2])]
  if (x >= y && x >= z) return 0
  return y >= z ? 1 : 2
}

function vertexAt(mesh: MeshData, slot: number): Vec3 {
  return [mesh.vertices[slot * 3] ?? 0, mesh.vertices[slot * 3 + 1] ?? 0, mesh.vertices[slot * 3 + 2] ?? 0]
}

/** Newell's normal, which is right for an n-gon that is not quite flat. */
function faceNormal(mesh: MeshData, face: number[]): Vec3 {
  let nx = 0
  let ny = 0
  let nz = 0
  for (let index = 0; index < face.length; index += 1) {
    const a = vertexAt(mesh, face[index]!)
    const b = vertexAt(mesh, face[(index + 1) % face.length]!)
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  const length = Math.hypot(nx, ny, nz)
  return length < 1e-12 ? [0, 0, 1] : [nx / length, ny / length, nz / length]
}

function meshCentre(mesh: MeshData): Vec3 {
  const { min, max } = extent(mesh)
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

function meshSize(mesh: MeshData): Vec3 {
  const { min, max } = extent(mesh)
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
}

function extent(mesh: MeshData): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.vertices[index + axis] ?? 0
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] }
  return { min, max }
}
