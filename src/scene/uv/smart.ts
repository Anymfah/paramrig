import { loopStarts } from '@/scene/mesh/uv'
import { edgeFaces, type UvIsland } from '@/scene/uv/islands'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * Smart UV project: cut where the surface turns, then flatten each piece the flat way.
 *
 * It is the unwrapper for a mesh nobody has put seams on — a machine part, an imported model, a
 * scan. Instead of asking a person where to cut, it cuts wherever two neighbouring faces disagree
 * about which way they look by more than an angle, which on anything with edges puts the seams
 * exactly where the edges are. Each piece is then projected along its own average normal, which is
 * right because a piece whose faces all look the same way is nearly flat by construction.
 *
 * What it is not: it is not conformal. A piece that is nearly flat projects with almost no
 * distortion, and a piece that is not — a smoothly curving one, where the angle limit never trips
 * — projects with all of it. That is the trade Blender's own Smart UV project makes, and the answer
 * to a curved surface is `lscmUnwrap`.
 */

export type SmartOptions = {
  /** How far two faces may look apart and stay in one piece, in degrees. Blender's default is 66. */
  angleLimit?: number
  /** Faces to unwrap; the whole mesh when absent. */
  selection?: Set<number>
  /** Whether a piece's size in the image follows its size on the surface. */
  areaWeight?: boolean
}

export type SmartResult = {
  islands: UvIsland[]
  /** Two floats per corner of the mesh, in loop order. Corners outside the selection are left at 0. */
  uv: number[]
}

/**
 * The islands and their flat projections, before packing.
 *
 * Packing is deliberately not done here: an operator packs the islands it has just made together
 * with the ones that were already there, and a function that packed its own output would have to
 * be undone first.
 */
export function smartProject(mesh: MeshData, options: SmartOptions = {}): SmartResult {
  const limit = Math.cos((Math.min(180, Math.max(1, options.angleLimit ?? 66)) * Math.PI) / 180)
  const wanted = options.selection ?? null
  const normals = faceNormals(mesh)
  const neighbours = faceNeighbours(mesh)
  const seam = mesh.attributes.edge.seam ?? []

  const seen = new Set<number>()
  const islands: UvIsland[] = []
  for (let face = 0; face < mesh.faces.length; face += 1) {
    if (seen.has(face) || (wanted && !wanted.has(face))) continue
    const island: number[] = []
    const queue = [face]
    seen.add(face)
    while (queue.length > 0) {
      const current = queue.pop()!
      island.push(current)
      for (const { face: other, edge } of neighbours[current] ?? []) {
        if (seen.has(other) || (wanted && !wanted.has(other))) continue
        // A seam somebody has drawn is obeyed as well: the angle is a suggestion, a seam is not.
        if (seam[edge] === true) continue
        if (dot(normals[current]!, normals[other]!) < limit) continue
        seen.add(other)
        queue.push(other)
      }
    }
    islands.push({ faces: island.sort((a, b) => a - b) })
  }

  const starts = loopStarts(mesh)
  const total = starts[mesh.faces.length] ?? 0
  const uv = new Array<number>(total * 2).fill(0)
  for (const island of islands) {
    project(mesh, island, normals, starts, uv, options.areaWeight ?? true)
  }
  return { islands, uv }
}

/**
 * One island laid on the plane it faces.
 *
 * The two axes across that plane are chosen from the world rather than from the island, so that two
 * pieces of the same object come out the same way up — a projection whose axes depend on the piece
 * makes a set of islands nobody can read.
 */
function project(
  mesh: MeshData,
  island: UvIsland,
  normals: Vec3[],
  starts: number[],
  uv: number[],
  areaWeight: boolean,
): void {
  const normal: Vec3 = [0, 0, 0]
  for (const face of island.faces) {
    const own = normals[face]!
    normal[0] += own[0]
    normal[1] += own[1]
    normal[2] += own[2]
  }
  const length = Math.hypot(normal[0], normal[1], normal[2])
  const axis: Vec3 = length < 1e-9 ? [0, 0, 1] : [normal[0] / length, normal[1] / length, normal[2] / length]
  const { right, up } = basisFor(axis)

  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  const points: Array<[number, number]> = []
  for (const face of island.faces) {
    for (const slot of mesh.faces[face]!) {
      const point = vertexAt(mesh, slot)
      const u = dot(point, right)
      const v = dot(point, up)
      points.push([u, v])
      if (u < minU) minU = u
      if (v < minV) minV = v
      if (u > maxU) maxU = u
      if (v > maxV) maxV = v
    }
  }
  /*
   * Each island is laid in its own [0, 1] box unless area weighting is on, in which case it keeps
   * its size on the surface and the packer scales everything together. Weighting is the default
   * because a texel should be the same size everywhere on an object.
   */
  const span = Math.max(1e-6, Math.max(maxU - minU, maxV - minV))
  const scale = areaWeight ? 1 : 1 / span
  let index = 0
  for (const face of island.faces) {
    const start = starts[face]!
    const loop = mesh.faces[face]!
    for (let corner = 0; corner < loop.length; corner += 1) {
      const [u, v] = points[index]!
      uv[(start + corner) * 2] = (u - minU) * scale
      uv[(start + corner) * 2 + 1] = (v - minV) * scale
      index += 1
    }
  }
}

/** Two axes across a normal, chosen so that a normal near one world axis gives a stable pair. */
function basisFor(normal: Vec3): { right: Vec3; up: Vec3 } {
  const helper: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const right = normalise(cross(helper, normal))
  const up = normalise(cross(normal, right))
  return { right, up }
}

function faceNormals(mesh: MeshData): Vec3[] {
  return mesh.faces.map((face) => {
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
    return normalise([nx, ny, nz])
  })
}

function faceNeighbours(mesh: MeshData): Array<Array<{ face: number; edge: number }>> {
  const byEdge = edgeFaces(mesh)
  const neighbours: Array<Array<{ face: number; edge: number }>> = mesh.faces.map(() => [])
  for (let edge = 0; edge < byEdge.length; edge += 1) {
    const faces = byEdge[edge]!
    if (faces.length !== 2) continue
    const [a, b] = faces as [number, number]
    neighbours[a]!.push({ face: b, edge })
    neighbours[b]!.push({ face: a, edge })
  }
  return neighbours
}

function vertexAt(mesh: MeshData, slot: number): Vec3 {
  return [mesh.vertices[slot * 3] ?? 0, mesh.vertices[slot * 3 + 1] ?? 0, mesh.vertices[slot * 3 + 2] ?? 0]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalise(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  return length < 1e-12 ? [0, 0, 1] : [vector[0] / length, vector[1] / length, vector[2] / length]
}
