import type { UvGeometry } from '@/scene/uv/geometry'
import type { Vec2 } from '@/scene/types'

/**
 * What a click in the UV editor lands on, and what selecting it means.
 *
 * The selection itself is kept as corners — loop indices — rather than as points, because a point
 * is worked out from the map and the map changes under it, while a corner is a place in the mesh
 * that survives everything short of an edit to the faces. So every one of these takes a click and
 * answers with corners, and the drawing turns corners back into points when it needs to.
 *
 * The four modes are Blender's: a vertex is a point of the map, an edge is a side of a face, a face
 * is a face, and an island is everything joined to it without crossing a cut. The rule that makes
 * them agree is the one Blender uses too — an edge or a face counts as selected when every corner
 * of it is — so switching modes never loses what was chosen.
 */

export type UvSelectMode = 'vertex' | 'edge' | 'face' | 'island'

/** How a pick joins what is already selected. */
export type UvPickMode = 'new' | 'extend' | 'toggle'

/** Nothing was under the pointer. */
export const NOTHING = -1

/** The point nearest this place in the image, within `radius`, or −1. */
export function nearestPoint(geometry: UvGeometry, at: Vec2, radius: number): number {
  let best = NOTHING
  let nearest = radius * radius
  for (let point = 0; point < geometry.points.length / 2; point += 1) {
    const du = (geometry.points[point * 2] ?? 0) - at[0]
    const dv = (geometry.points[point * 2 + 1] ?? 0) - at[1]
    const distance = du * du + dv * dv
    if (distance <= nearest) {
      nearest = distance
      best = point
    }
  }
  return best
}

/** The drawn edge nearest this place, within `radius`, as an index into `geometry.edges` pairs. */
export function nearestEdge(geometry: UvGeometry, at: Vec2, radius: number): number {
  let best = NOTHING
  let nearest = radius * radius
  for (let edge = 0; edge < geometry.edges.length / 2; edge += 1) {
    const a = geometry.edges[edge * 2] ?? 0
    const b = geometry.edges[edge * 2 + 1] ?? 0
    const distance = segmentDistanceSquared(
      at,
      [geometry.points[a * 2] ?? 0, geometry.points[a * 2 + 1] ?? 0],
      [geometry.points[b * 2] ?? 0, geometry.points[b * 2 + 1] ?? 0],
    )
    if (distance <= nearest) {
      nearest = distance
      best = edge
    }
  }
  return best
}

/**
 * The face this place is inside, or −1.
 *
 * The last one found wins, which is what a person expects where islands overlap: the face drawn
 * last is the face on top, and the face on top is the one a click means.
 */
export function faceAt(geometry: UvGeometry, at: Vec2): number {
  let found = NOTHING
  for (let face = 0; face < geometry.faceStart.length; face += 1) {
    if (insideFace(geometry, face, at)) found = face
  }
  return found
}

/**
 * Which island each point belongs to: the pieces the map falls into.
 *
 * This is connectivity in the *image* rather than on the surface. Two faces either side of a seam
 * are joined on the mesh and apart here, which is exactly what an island is — so it is read off the
 * drawn edges rather than off the mesh's own.
 */
export function uvIslands(geometry: UvGeometry): Int32Array {
  const count = geometry.points.length / 2
  const island = new Int32Array(count).fill(-1)
  const neighbours: number[][] = Array.from({ length: count }, () => [])
  for (let edge = 0; edge < geometry.edges.length; edge += 2) {
    const a = geometry.edges[edge] ?? 0
    const b = geometry.edges[edge + 1] ?? 0
    neighbours[a]!.push(b)
    neighbours[b]!.push(a)
  }
  let next = 0
  for (let point = 0; point < count; point += 1) {
    if (island[point] !== -1) continue
    const queue = [point]
    island[point] = next
    while (queue.length > 0) {
      const current = queue.pop()!
      for (const other of neighbours[current] ?? []) {
        if (island[other] !== -1) continue
        island[other] = next
        queue.push(other)
      }
    }
    next += 1
  }
  return island
}

/** Every point inside a box drawn in the image. */
export function pointsInBox(geometry: UvGeometry, box: { minU: number; minV: number; maxU: number; maxV: number }): number[] {
  const found: number[] = []
  for (let point = 0; point < geometry.points.length / 2; point += 1) {
    const u = geometry.points[point * 2] ?? 0
    const v = geometry.points[point * 2 + 1] ?? 0
    if (u >= box.minU && u <= box.maxU && v >= box.minV && v <= box.maxV) found.push(point)
  }
  return found
}

/** The corners a set of points carries: what a selection of points is, written down. */
export function loopsOfPoints(geometry: UvGeometry, points: Iterable<number>): number[] {
  const loops: number[] = []
  for (const point of points) {
    const start = geometry.pointStart[point]
    const count = geometry.pointCount[point]
    if (start === undefined || count === undefined) continue
    for (let index = 0; index < count; index += 1) loops.push(geometry.pointLoops[start + index] ?? 0)
  }
  return loops
}

/** The corners of a face. */
export function loopsOfFace(geometry: UvGeometry, face: number): number[] {
  const start = geometry.faceStart[face] ?? 0
  const length = geometry.faceLength[face] ?? 0
  return Array.from({ length }, (_, corner) => start + corner)
}

/** The corners of an island, given the island each point belongs to. */
export function loopsOfIsland(geometry: UvGeometry, islands: Int32Array, island: number): number[] {
  const points: number[] = []
  for (let point = 0; point < islands.length; point += 1) if (islands[point] === island) points.push(point)
  return loopsOfPoints(geometry, points)
}

/**
 * What a click leaves selected.
 *
 * A plain click replaces, shift extends, and control-click — `toggle` — takes out what was already
 * there. A plain click on nothing clears, which is the one case worth stating: it is how a person
 * puts a selection down.
 */
export function applyPick(selected: ReadonlySet<number>, loops: number[], mode: UvPickMode): Set<number> {
  if (mode === 'new') return new Set(loops)
  const next = new Set(selected)
  if (mode === 'extend') {
    for (const loop of loops) next.add(loop)
    return next
  }
  const allIn = loops.length > 0 && loops.every((loop) => next.has(loop))
  for (const loop of loops) {
    if (allIn) next.delete(loop)
    else next.add(loop)
  }
  return next
}

/** Whether every corner of a face is selected, which is what makes the face selected. */
export function faceSelected(geometry: UvGeometry, selected: ReadonlySet<number>, face: number): boolean {
  const loops = loopsOfFace(geometry, face)
  return loops.length > 0 && loops.every((loop) => selected.has(loop))
}

/** The points a corner selection marks: a point is selected when any of its corners is. */
export function selectedPoints(geometry: UvGeometry, selected: ReadonlySet<number>): Uint8Array {
  const marks = new Uint8Array(geometry.points.length / 2)
  for (const loop of selected) {
    const point = geometry.loopPoint[loop]
    if (point !== undefined) marks[point] = 1
  }
  return marks
}

function insideFace(geometry: UvGeometry, face: number, at: Vec2): boolean {
  const start = geometry.faceStart[face] ?? 0
  const length = geometry.faceLength[face] ?? 0
  if (length < 3) return false
  let inside = false
  for (let corner = 0; corner < length; corner += 1) {
    const a = geometry.loopPoint[start + corner] ?? 0
    const b = geometry.loopPoint[start + ((corner + 1) % length)] ?? 0
    const au = geometry.points[a * 2] ?? 0
    const av = geometry.points[a * 2 + 1] ?? 0
    const bu = geometry.points[b * 2] ?? 0
    const bv = geometry.points[b * 2 + 1] ?? 0
    if ((av > at[1]) !== (bv > at[1]) && at[0] < ((bu - au) * (at[1] - av)) / (bv - av) + au) inside = !inside
  }
  return inside
}

function segmentDistanceSquared(point: Vec2, from: Vec2, to: Vec2): number {
  const du = to[0] - from[0]
  const dv = to[1] - from[1]
  const lengthSquared = du * du + dv * dv
  const along = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0,
    ((point[0] - from[0]) * du + (point[1] - from[1]) * dv) / lengthSquared))
  const u = from[0] + du * along - point[0]
  const v = from[1] + dv * along - point[1]
  return u * u + v * v
}
