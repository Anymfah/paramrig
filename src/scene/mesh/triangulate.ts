import { ShapeUtils, Vector2 } from 'three'
import { meshFingerprint, vertexPosition } from '@/scene/mesh/data'
import { cross, dot, faceArea, faceNormal, length, subtract } from '@/scene/mesh/normals'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * Triangles for drawing and for picking, and nothing else.
 *
 * A face in this document is a polygon of any length, but a GPU and a ray cast both want triangles.
 * So the mesh is handed over as a triangle buffer together with the table that says which face —
 * and which corner of it — each triangle came from: everything downstream has to get from a
 * triangle back to the thing a person actually clicked on, or to the UV of a corner.
 */

export type Triangulation = {
  /** Vertex slots, three per triangle. */
  indices: Uint32Array
  /** Face slot each triangle came from, one per triangle. */
  triangleFace: Int32Array
  /** Corner index within its face for each of the three vertices of each triangle, for UVs later. */
  triangleCorner: Uint32Array
  triangleCount: number
}

/** Under this area a face is a line drawn twice, and a line has no triangles to give. */
const MINIMUM_AREA = 1e-12

/** Enough for every mesh a scene shows at once, small enough that a busy scene cannot grow it. */
const CACHE_LIMIT = 32

const cache = new Map<string, Triangulation>()

export function triangulateMesh(mesh: MeshData): Triangulation {
  const indices: number[] = []
  const triangleFace: number[] = []
  const triangleCorner: number[] = []
  for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
    const face = mesh.faces[faceSlot]!
    for (const triple of cornerTriples(mesh, faceSlot)) {
      for (const corner of triple) {
        indices.push(face[corner]!)
        triangleCorner.push(corner)
      }
      triangleFace.push(faceSlot)
    }
  }
  return {
    indices: Uint32Array.from(indices),
    triangleFace: Int32Array.from(triangleFace),
    triangleCorner: Uint32Array.from(triangleCorner),
    triangleCount: triangleFace.length,
  }
}

/** The vertex slots of one face's triangles, three per triangle, wound the way the face is wound. */
export function triangulateFace(mesh: MeshData, faceSlot: number): number[][] {
  const face = mesh.faces[faceSlot]
  if (!face) return []
  return cornerTriples(mesh, faceSlot).map((triple) => triple.map((corner) => face[corner]!))
}

/**
 * The same triangulation as `triangulateMesh`, memoised by `meshFingerprint`. The viewport asks for
 * this every frame, and two meshes that stamp the same draw the same, so a linked duplicate and an
 * undone edit both come back without any work at all.
 */
export function cachedTriangulation(mesh: MeshData): Triangulation {
  const key = meshFingerprint(mesh)
  const hit = cache.get(key)
  if (hit) {
    // Re-inserting moves the entry to the end, so the eviction below always takes the least used one.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const built = triangulateMesh(mesh)
  cache.set(key, built)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return built
}

export function clearTriangulationCache(): void {
  cache.clear()
}

/**
 * One face's triangles as corner indices rather than vertex slots: the caller wants both, and only
 * the face knows which corner a slot sits at once a slot appears in several faces.
 */
function cornerTriples(mesh: MeshData, faceSlot: number): number[][] {
  const face = mesh.faces[faceSlot]
  if (!face || face.length < 3) return []
  // A face with no area — every corner on one line — gives no triangles rather than broken ones.
  if (faceArea(mesh, faceSlot) <= MINIMUM_AREA) return []
  const points = face.map((slot) => vertexPosition(mesh, slot))
  if (points.length === 3) return [[0, 1, 2]]
  const normal = faceNormal(mesh, faceSlot)
  if (points.length === 4 && isConvex(points, normal)) return quadTriples(points)
  return ngonTriples(points, normal)
}

/**
 * A quad splits along its shorter diagonal. A fixed diagonal cuts a stretched quad into two
 * slivers, and a sliver shades badly, picks badly and gives a useless normal.
 */
function quadTriples(points: Vec3[]): number[][] {
  const across = length(subtract(points[2]!, points[0]!))
  const other = length(subtract(points[3]!, points[1]!))
  return across <= other ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]]
}

/** Convex when the loop turns the same way at every corner, judged against the face's own normal. */
function isConvex(points: Vec3[], normal: Vec3): boolean {
  const count = points.length
  for (let index = 0; index < count; index += 1) {
    const current = points[index]!
    const incoming = subtract(current, points[(index + count - 1) % count]!)
    const outgoing = subtract(points[(index + 1) % count]!, current)
    if (dot(cross(incoming, outgoing), normal) < 0) return false
  }
  return true
}

/**
 * An n-gon is flattened onto the plane of its normal and cut into ears by three.js. The two axes
 * kept are chosen from the largest component of the normal, so a face standing on its edge never
 * collapses to a line in the projection. The ear clipper's own winding convention is not relied on:
 * the triples come back turned either with the flattened contour or against it, and are turned back
 * when they disagree, so a triangle always faces the way its face does.
 */
function ngonTriples(points: Vec3[], normal: Vec3): number[][] {
  const [first, second] = projectionAxes(normal)
  const contour = points.map((point) => new Vector2(point[first]!, point[second]!))
  const wanted = ShapeUtils.area(contour)
  const kept: number[][] = []
  let produced = 0
  for (const triple of ShapeUtils.triangulateShape(contour, [])) {
    const [a, b, c] = triple
    if (a === undefined || b === undefined || c === undefined) continue
    const cornerA = contour[a]
    const cornerB = contour[b]
    const cornerC = contour[c]
    if (!cornerA || !cornerB || !cornerC) continue
    produced += (cornerB.x - cornerA.x) * (cornerC.y - cornerA.y) - (cornerB.y - cornerA.y) * (cornerC.x - cornerA.x)
    kept.push([a, b, c])
  }
  if ((wanted < 0) !== (produced < 0)) return kept.map((triple) => [triple[0]!, triple[2]!, triple[1]!])
  return kept
}

/**
 * The pair of axes to keep when flattening, in the cyclic order that leaves the projection turning
 * the same way as the loop does around its normal.
 */
function projectionAxes(normal: Vec3): [number, number] {
  const x = Math.abs(normal[0])
  const y = Math.abs(normal[1])
  const z = Math.abs(normal[2])
  if (z >= x && z >= y) return [0, 1]
  if (x >= y) return [1, 2]
  return [2, 0]
}
