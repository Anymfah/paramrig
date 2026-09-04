import { loopStarts } from '@/scene/mesh/uv'
import type { UvBounds } from '@/scene/uv/view'
import type { MeshData } from '@/scene/types'

/**
 * The mesh as the UV editor sees it: points, edges and faces in the image rather than in space.
 *
 * A UV map is two floats per face corner, which is the right shape for a graphics card and the
 * wrong one for an editor: dragging a corner of a cube would tear the square it is a corner of,
 * because the four faces meeting there each hold their own copy. So the corners are merged first.
 * Corners of the same vertex that sit on the same spot in the image are one *point*, and a point is
 * what is drawn, hit and moved — which is exactly Blender's rule, and why a seam is visible in the
 * UV editor as two points where the surface has one vertex.
 *
 * Everything is typed arrays and indices. A twenty-thousand-face mesh has eighty thousand corners,
 * and an editor that allocated an object per corner would spend its frame in the garbage collector
 * rather than on the picture.
 */

/** Nearer than this in the image, two corners of one vertex are the same point. */
const MERGE_TOLERANCE = 1e-6

export type UvGeometry = {
  /** How many corners the mesh has; the length of the map divided by two. */
  loops: number
  /** Which point each corner sits on. */
  loopPoint: Int32Array
  /** Which face each corner belongs to. */
  loopFace: Int32Array
  /** Where each face's corners start, and how many it has. */
  faceStart: Int32Array
  faceLength: Int32Array
  /** Two floats per point: where it is in the image. */
  points: Float64Array
  /** The mesh vertex slot each point came from. */
  pointVertex: Int32Array
  /** The corners each point carries, as a range into `pointLoops`. */
  pointStart: Int32Array
  pointCount: Int32Array
  pointLoops: Int32Array
  /** Point pairs, one per drawn edge, with no edge drawn twice. */
  edges: Int32Array
  /** The box every point fits in, or null for a mesh with no faces. */
  bounds: UvBounds | null
}

export function uvGeometry(mesh: MeshData, uv: number[]): UvGeometry {
  const starts = loopStarts(mesh)
  const loops = starts[mesh.faces.length] ?? 0
  const loopPoint = new Int32Array(loops)
  const loopFace = new Int32Array(loops)
  const faceStart = new Int32Array(mesh.faces.length)
  const faceLength = new Int32Array(mesh.faces.length)

  /*
   * The merge, one vertex at a time. A vertex has a handful of corners, so the search for a point
   * already at this spot is a walk down that handful rather than a lookup in a map of strings —
   * the map would cost more to build than the walk costs to run.
   */
  const byVertex = new Map<number, number[]>()
  const pointU: number[] = []
  const pointV: number[] = []
  const pointVertexList: number[] = []
  const pointLoopLists: number[][] = []

  for (let face = 0; face < mesh.faces.length; face += 1) {
    const corners = mesh.faces[face]!
    const start = starts[face] ?? 0
    faceStart[face] = start
    faceLength[face] = corners.length
    for (let corner = 0; corner < corners.length; corner += 1) {
      const loop = start + corner
      const vertex = corners[corner] ?? 0
      const u = uv[loop * 2] ?? 0
      const v = uv[loop * 2 + 1] ?? 0
      loopFace[loop] = face
      const candidates = byVertex.get(vertex)
      let found = -1
      if (candidates) {
        for (const point of candidates) {
          if (Math.abs(pointU[point]! - u) <= MERGE_TOLERANCE && Math.abs(pointV[point]! - v) <= MERGE_TOLERANCE) {
            found = point
            break
          }
        }
      }
      if (found < 0) {
        found = pointU.length
        pointU.push(u)
        pointV.push(v)
        pointVertexList.push(vertex)
        pointLoopLists.push([])
        if (candidates) candidates.push(found)
        else byVertex.set(vertex, [found])
      }
      loopPoint[loop] = found
      pointLoopLists[found]!.push(loop)
    }
  }

  const count = pointU.length
  const points = new Float64Array(count * 2)
  const pointVertex = new Int32Array(count)
  const pointStart = new Int32Array(count)
  const pointCount = new Int32Array(count)
  let total = 0
  for (let point = 0; point < count; point += 1) {
    points[point * 2] = pointU[point]!
    points[point * 2 + 1] = pointV[point]!
    pointVertex[point] = pointVertexList[point]!
    pointStart[point] = total
    pointCount[point] = pointLoopLists[point]!.length
    total += pointLoopLists[point]!.length
  }
  const pointLoops = new Int32Array(total)
  for (let point = 0; point < count; point += 1) {
    const list = pointLoopLists[point]!
    for (let index = 0; index < list.length; index += 1) pointLoops[pointStart[point]! + index] = list[index]!
  }

  return {
    loops,
    loopPoint,
    loopFace,
    faceStart,
    faceLength,
    points,
    pointVertex,
    pointStart,
    pointCount,
    pointLoops,
    edges: uvEdges(mesh, loopPoint, faceStart, faceLength, count),
    bounds: boundsOf(points),
  }
}

/**
 * The edges as the editor draws them: each face's own boundary, with a shared edge drawn once.
 *
 * Two faces that meet across a seam land in different places in the image, so the edge between them
 * is two edges here and both are drawn — which is what makes an island's outline visible. Two faces
 * that meet inside an island share both their points, so the pair is the same and one of the two is
 * dropped.
 */
function uvEdges(
  mesh: MeshData,
  loopPoint: Int32Array,
  faceStart: Int32Array,
  faceLength: Int32Array,
  points: number,
): Int32Array {
  const seen = new Set<number>()
  const pairs: number[] = []
  for (let face = 0; face < mesh.faces.length; face += 1) {
    const length = faceLength[face] ?? 0
    const start = faceStart[face] ?? 0
    for (let corner = 0; corner < length; corner += 1) {
      const a = loopPoint[start + corner] ?? 0
      const b = loopPoint[start + ((corner + 1) % length)] ?? 0
      if (a === b) continue
      const key = a < b ? a * points + b : b * points + a
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push(a, b)
    }
  }
  return Int32Array.from(pairs)
}

function boundsOf(points: Float64Array): UvBounds | null {
  if (points.length === 0) return null
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (let index = 0; index < points.length; index += 2) {
    const u = points[index]!
    const v = points[index + 1]!
    if (u < minU) minU = u
    if (v < minV) minV = v
    if (u > maxU) maxU = u
    if (v > maxV) maxV = v
  }
  return { minU, minV, maxU, maxV }
}
