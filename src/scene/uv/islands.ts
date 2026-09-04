import { loopStarts } from '@/scene/mesh/uv'
import type { MeshData } from '@/scene/types'

/**
 * Islands: the pieces a mesh falls into when it is cut along its seams.
 *
 * Unwrapping a closed surface is impossible — a sphere cannot be flattened — so the surface is cut
 * first, and every unwrapper works on one piece at a time. A seam is where the cut goes, and an
 * island is what the cutting leaves: a set of faces joined to each other by edges that are not
 * seams. An edge shared by more than two faces is treated as a cut too, because a surface that
 * folds back on itself there has no flattening either.
 *
 * The same idea runs the other way: given a map somebody has made, the seams are the edges whose
 * two faces disagree about where their shared corners are in the image. That is `seamsFromIslands`,
 * and it is how a map imported from elsewhere gets the seams it was drawn with.
 */

export type UvIsland = {
  /** Face slots, in the order they were reached. */
  faces: number[]
}

/**
 * The islands of a mesh, given the seams it carries.
 *
 * Faces reached from each other without crossing a seam are one island. A face that touches
 * nothing — a loose triangle — is an island of its own, which is what an unwrapper wants: it has a
 * flattening, and a trivial one.
 */
export function islandsFromSeams(mesh: MeshData, options: { selection?: Set<number> } = {}): UvIsland[] {
  const neighbours = faceNeighbours(mesh)
  const seam = mesh.attributes.edge.seam ?? []
  const wanted = options.selection ?? null
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
        if (seen.has(other) || seam[edge] === true) continue
        if (wanted && !wanted.has(other)) continue
        seen.add(other)
        queue.push(other)
      }
    }
    islands.push({ faces: island.sort((a, b) => a - b) })
  }
  return islands
}

/**
 * The edges a map is cut along: those whose two faces put their shared corners in different places.
 *
 * The comparison is by distance rather than by equality because a map that has been through a file,
 * a pack and a rounding is never exactly equal to itself; a thousandth of the image is far below
 * anything a person would call the same point and far above the rounding.
 */
export function seamsFromIslands(mesh: MeshData, uv: number[], tolerance = 1e-3): boolean[] {
  const starts = loopStarts(mesh)
  const seams = new Array<boolean>(mesh.edges.length).fill(false)
  const byEdge = edgeFaces(mesh)
  for (let edge = 0; edge < mesh.edges.length; edge += 1) {
    const faces = byEdge[edge] ?? []
    if (faces.length !== 2) {
      /*
       * A boundary edge has nothing on the other side to disagree with, so it is not marked: it is
       * already the end of the piece, and marking it would fill a mesh with seams that mean
       * nothing. An edge with three or more faces is another matter — there is no unfolding across
       * it at all — so that one is a cut.
       */
      seams[edge] = faces.length > 2
      continue
    }
    const [a, b] = mesh.edges[edge]!
    const first = cornerUvs(mesh, starts, uv, faces[0]!, a, b)
    const second = cornerUvs(mesh, starts, uv, faces[1]!, a, b)
    if (!first || !second) continue
    const apart = Math.hypot(first[0] - second[0], first[1] - second[1])
      + Math.hypot(first[2] - second[2], first[3] - second[3])
    if (apart > tolerance) seams[edge] = true
  }
  return seams
}

/** Where a face puts the two ends of one of its edges, as [ua, va, ub, vb]. */
function cornerUvs(
  mesh: MeshData,
  starts: number[],
  uv: number[],
  face: number,
  a: number,
  b: number,
): [number, number, number, number] | null {
  const loop = mesh.faces[face]
  const start = starts[face]
  if (!loop || start === undefined) return null
  const cornerA = loop.indexOf(a)
  const cornerB = loop.indexOf(b)
  if (cornerA < 0 || cornerB < 0) return null
  return [
    uv[(start + cornerA) * 2] ?? 0,
    uv[(start + cornerA) * 2 + 1] ?? 0,
    uv[(start + cornerB) * 2] ?? 0,
    uv[(start + cornerB) * 2 + 1] ?? 0,
  ]
}

/** Which faces meet at each edge, by edge slot. */
export function edgeFaces(mesh: MeshData): number[][] {
  const byEdge: number[][] = mesh.edges.map(() => [])
  const index = edgeIndex(mesh)
  for (let face = 0; face < mesh.faces.length; face += 1) {
    const loop = mesh.faces[face]!
    for (let corner = 0; corner < loop.length; corner += 1) {
      const edge = index.get(edgeKey(loop[corner]!, loop[(corner + 1) % loop.length]!))
      if (edge !== undefined) byEdge[edge]!.push(face)
    }
  }
  return byEdge
}

/** For each face, the faces across each of its edges, with the edge between them. */
function faceNeighbours(mesh: MeshData): Array<Array<{ face: number; edge: number }>> {
  const byEdge = edgeFaces(mesh)
  const neighbours: Array<Array<{ face: number; edge: number }>> = mesh.faces.map(() => [])
  for (let edge = 0; edge < byEdge.length; edge += 1) {
    const faces = byEdge[edge]!
    // Three faces on one edge is not a surface; nothing is joined across it.
    if (faces.length !== 2) continue
    const [a, b] = faces as [number, number]
    neighbours[a]!.push({ face: b, edge })
    neighbours[b]!.push({ face: a, edge })
  }
  return neighbours
}

function edgeIndex(mesh: MeshData): Map<string, number> {
  const index = new Map<string, number>()
  for (let edge = 0; edge < mesh.edges.length; edge += 1) {
    const [a, b] = mesh.edges[edge]!
    index.set(edgeKey(a, b), edge)
  }
  return index
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** The corners of an island, in the order the unwrapper will number them. */
export function islandLoops(mesh: MeshData, island: UvIsland): number[] {
  const starts = loopStarts(mesh)
  const loops: number[] = []
  for (const face of island.faces) {
    const start = starts[face]!
    const length = mesh.faces[face]!.length
    for (let corner = 0; corner < length; corner += 1) loops.push(start + corner)
  }
  return loops
}

/**
 * The vertices of an island, and where each corner of it sits in that list.
 *
 * An unwrapper solves for vertices rather than for corners: two corners of two faces that meet at a
 * vertex, inside one island, are the same point of the image. The map is written back per corner
 * afterwards, which is what lets two islands give the same vertex two different places.
 */
export function islandVertices(mesh: MeshData, island: UvIsland): { slots: number[]; cornerVertex: number[] } {
  const slots: number[] = []
  const seen = new Map<number, number>()
  const cornerVertex: number[] = []
  for (const face of island.faces) {
    for (const slot of mesh.faces[face]!) {
      let index = seen.get(slot)
      if (index === undefined) {
        index = slots.length
        seen.set(slot, index)
        slots.push(slot)
      }
      cornerVertex.push(index)
    }
  }
  return { slots, cornerVertex }
}
