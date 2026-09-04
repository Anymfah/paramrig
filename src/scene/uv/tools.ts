import { uvGeometry, type UvGeometry } from '@/scene/uv/geometry'
import { uvIslands } from '@/scene/uv/select'
import type { MeshData } from '@/scene/types'

/**
 * The UV menu's own tools: everything that moves a map without unwrapping it again.
 *
 * All of them are the same shape — a mesh, the map, and the corners that are selected, giving back
 * the map that should replace it — so the operators that call them are four lines each and the
 * arithmetic is testable without a document, a canvas or a pointer.
 *
 * They work in *points* rather than corners, for the reason the editor does: corners of one vertex
 * that sit on one spot are one thing to a person, and a tool that welded three of four corners of a
 * seam would leave a tear nobody asked for.
 */

/** Below this two numbers are the same number, in an image one texel of which is far larger. */
const NOTHING = 1e-9

/** The selected points of a map, and the geometry they were read from. */
function chosen(mesh: MeshData, uv: number[], loops: Iterable<number>): { geometry: UvGeometry; points: number[] } {
  const geometry = uvGeometry(mesh, uv)
  const points = new Set<number>()
  for (const loop of loops) {
    const point = geometry.loopPoint[loop]
    if (point !== undefined && point >= 0) points.add(point)
  }
  return { geometry, points: [...points] }
}

/** The map with these points put where `place` says, every corner of each of them following. */
function moved(
  uv: number[],
  geometry: UvGeometry,
  points: number[],
  place: (u: number, v: number, point: number) => [number, number],
): number[] {
  const next = uv.slice()
  for (const point of points) {
    const u = geometry.points[point * 2] ?? 0
    const v = geometry.points[point * 2 + 1] ?? 0
    const [toU, toV] = place(u, v, point)
    const start = geometry.pointStart[point] ?? 0
    for (let index = 0; index < (geometry.pointCount[point] ?? 0); index += 1) {
      const loop = geometry.pointLoops[start + index] ?? 0
      next[loop * 2] = toU
      next[loop * 2 + 1] = toV
    }
  }
  return next
}

/** The box the selected points sit in, which is what a mirror and an auto-align measure against. */
function extent(geometry: UvGeometry, points: number[]): { minU: number; minV: number; maxU: number; maxV: number; midU: number; midV: number } {
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const point of points) {
    const u = geometry.points[point * 2] ?? 0
    const v = geometry.points[point * 2 + 1] ?? 0
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  if (!Number.isFinite(minU)) return { minU: 0, minV: 0, maxU: 0, maxV: 0, midU: 0, midV: 0 }
  return { minU, minV, maxU, maxV, midU: (minU + maxU) / 2, midV: (minV + maxV) / 2 }
}

/** Every selected point onto their average: Blender's Weld. */
export function weldUvs(mesh: MeshData, uv: number[], loops: Iterable<number>): number[] {
  const { geometry, points } = chosen(mesh, uv, loops)
  if (points.length < 2) return uv
  let u = 0
  let v = 0
  for (const point of points) {
    u += geometry.points[point * 2] ?? 0
    v += geometry.points[point * 2 + 1] ?? 0
  }
  const centre: [number, number] = [u / points.length, v / points.length]
  return moved(uv, geometry, points, () => centre)
}

export type AlignAxis = 'u' | 'v' | 'auto'

/**
 * The selected points onto one line, across or down.
 *
 * 'auto' picks the shorter way, which is what makes it useful on a loop that is nearly straight
 * already: a row of points that spreads further across than down is meant to be a row, so it is
 * the heights that are levelled.
 */
export function alignUvs(mesh: MeshData, uv: number[], loops: Iterable<number>, axis: AlignAxis = 'auto'): number[] {
  const { geometry, points } = chosen(mesh, uv, loops)
  if (points.length < 2) return uv
  const box = extent(geometry, points)
  const wanted = axis === 'auto' ? (box.maxU - box.minU >= box.maxV - box.minV ? 'v' : 'u') : axis
  return moved(uv, geometry, points, (u, v) => (wanted === 'u' ? [box.midU, v] : [u, box.midV]))
}

/**
 * The selected points onto the line that fits them best.
 *
 * Blender's Straighten walks an edge loop and spaces the points along it by the lengths those edges
 * have on the surface. This one fits a line through the points by least squares and drops each
 * point onto it, which keeps them in the order and roughly the spacing they had — the difference
 * shows on a loop whose 3D lengths are very uneven, where Blender's spaces them evenly along the
 * line and this leaves them where they fell.
 */
export function straightenUvs(mesh: MeshData, uv: number[], loops: Iterable<number>): number[] {
  const { geometry, points } = chosen(mesh, uv, loops)
  if (points.length < 3) return uv
  let sumU = 0
  let sumV = 0
  for (const point of points) {
    sumU += geometry.points[point * 2] ?? 0
    sumV += geometry.points[point * 2 + 1] ?? 0
  }
  const midU = sumU / points.length
  const midV = sumV / points.length
  // The direction of the line is the principal axis of the points about their middle.
  let uu = 0
  let vv = 0
  let uvSum = 0
  for (const point of points) {
    const du = (geometry.points[point * 2] ?? 0) - midU
    const dv = (geometry.points[point * 2 + 1] ?? 0) - midV
    uu += du * du
    vv += dv * dv
    uvSum += du * dv
  }
  const angle = 0.5 * Math.atan2(2 * uvSum, uu - vv)
  const dirU = Math.cos(angle)
  const dirV = Math.sin(angle)
  if (Math.abs(dirU) < NOTHING && Math.abs(dirV) < NOTHING) return uv
  return moved(uv, geometry, points, (u, v) => {
    const along = (u - midU) * dirU + (v - midV) * dirV
    return [midU + dirU * along, midV + dirV * along]
  })
}

/** The selected points flipped about the middle of what is selected. */
export function mirrorUvs(mesh: MeshData, uv: number[], loops: Iterable<number>, axis: 'u' | 'v'): number[] {
  const { geometry, points } = chosen(mesh, uv, loops)
  if (points.length === 0) return uv
  const box = extent(geometry, points)
  return moved(uv, geometry, points, (u, v) => (axis === 'u' ? [2 * box.midU - u, v] : [u, 2 * box.midV - v]))
}

/**
 * The selected points onto the corners of an image's texels.
 *
 * It is what stops a hand-placed island bleeding half a pixel of its neighbour into itself, and it
 * is only meaningful against a size: 1/512 of the image is a texel of a 512-pixel one.
 */
export function snapUvsToPixels(mesh: MeshData, uv: number[], loops: Iterable<number>, pixels: number): number[] {
  const size = Math.max(1, Math.round(pixels))
  const { geometry, points } = chosen(mesh, uv, loops)
  if (points.length === 0) return uv
  return moved(uv, geometry, points, (u, v) => [Math.round(u * size) / size, Math.round(v * size) / size])
}

/**
 * Selected islands moved onto the ones they are cut from: Blender's Stitch.
 *
 * A seam is a vertex whose corners were put in two places, so the offset that closes it is the one
 * that takes a selected island's copy onto the unselected copy. An island has many such vertices
 * and they rarely agree — the two pieces are different shapes in the image — so the offsets are
 * averaged, which lays the piece where it fits best rather than where its first corner happens to
 * land. It moves the island; it does not weld it, and it does not rotate or scale it to fit.
 */
export function stitchUvs(mesh: MeshData, uv: number[], loops: Iterable<number>): number[] {
  const { geometry, points } = chosen(mesh, uv, loops)
  if (points.length === 0) return uv
  const islands = uvIslands(geometry)
  const wanted = new Set(points)
  const byVertex = new Map<number, number[]>()
  for (let point = 0; point < geometry.points.length / 2; point += 1) {
    const vertex = geometry.pointVertex[point] ?? -1
    const list = byVertex.get(vertex)
    if (list) list.push(point)
    else byVertex.set(vertex, [point])
  }
  /** Per island: the offset that would take its selected copies onto their unselected twins. */
  const offsets = new Map<number, { u: number; v: number; count: number }>()
  for (const twins of byVertex.values()) {
    if (twins.length < 2) continue
    for (const point of twins) {
      if (!wanted.has(point)) continue
      const island = islands[point] ?? -1
      for (const other of twins) {
        if (other === point || wanted.has(other)) continue
        const tally = offsets.get(island) ?? { u: 0, v: 0, count: 0 }
        tally.u += (geometry.points[other * 2] ?? 0) - (geometry.points[point * 2] ?? 0)
        tally.v += (geometry.points[other * 2 + 1] ?? 0) - (geometry.points[point * 2 + 1] ?? 0)
        tally.count += 1
        offsets.set(island, tally)
        break
      }
    }
  }
  if (offsets.size === 0) return uv
  return moved(uv, geometry, points, (u, v, point) => {
    const tally = offsets.get(islands[point] ?? -1)
    if (!tally || tally.count === 0) return [u, v]
    return [u + tally.u / tally.count, v + tally.v / tally.count]
  })
}

/** Every corner of the map inside the image, for "constrain to image bounds". */
export function clampUvsToImage(uv: number[]): number[] {
  return uv.map((value) => Math.min(1, Math.max(0, value)))
}
