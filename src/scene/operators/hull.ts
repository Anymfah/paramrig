import type { EditMesh } from '@/scene/mesh/editMesh'
import { cross, dot, length, normalize, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Convex hull: the smallest closed shape that holds every selected vertex.
 *
 * The hull is built by quickhull — start from a tetrahedron of four extreme points, then take each
 * remaining point in turn, throw away every facet it can see, and stretch new facets from it to the
 * horizon those facets left behind. Nothing is added to the mesh but faces: a hull is made of
 * vertices that were already there, which is why the operator can hand back the same ids.
 *
 * What happens to the geometry inside is Blender's choice, kept here: the faces that lay entirely
 * within the selection are replaced by the hull, and “delete unused” takes the selected vertices and
 * edges the hull did not need with it. The facets come out as triangles; “join triangles” welds the
 * neighbouring pairs that lie flat against each other back into n-gons, which is what makes the hull
 * of a box read as six faces instead of twelve.
 */

/** Below this a length is rounding noise rather than a distance. */
const NEARLY_ZERO = 1e-9

type Facet = [number, number, number]

/* ----------------------------------------------------------------- the hull */

function facetNormal(points: Vec3[], facet: Facet): Vec3 {
  const a = points[facet[0]]!
  const b = points[facet[1]]!
  const c = points[facet[2]]!
  return normalize(cross(subtract(b, a), subtract(c, a)))
}

/** How far a point stands outside a facet's plane; negative is inside. */
function outside(points: Vec3[], facet: Facet, point: Vec3): number {
  return dot(facetNormal(points, facet), subtract(point, points[facet[0]]!))
}

/** The four points a hull can be started from, or null when they all lie in one plane. */
function seedTetrahedron(points: Vec3[], tolerance: number): [number, number, number, number] | null {
  const extremes = new Set<number>()
  for (let axis = 0; axis < 3; axis += 1) {
    let low = 0
    let high = 0
    for (let index = 1; index < points.length; index += 1) {
      if (points[index]![axis]! < points[low]![axis]!) low = index
      if (points[index]![axis]! > points[high]![axis]!) high = index
    }
    extremes.add(low)
    extremes.add(high)
  }
  const candidates = [...extremes]
  let first = -1
  let second = -1
  let widest = 0
  for (const one of candidates) {
    for (const other of candidates) {
      const span = length(subtract(points[other]!, points[one]!))
      if (span <= widest) continue
      widest = span
      first = one
      second = other
    }
  }
  if (first < 0 || second < 0 || widest <= tolerance) return null

  const along = normalize(subtract(points[second]!, points[first]!))
  let third = -1
  let furthest = 0
  for (let index = 0; index < points.length; index += 1) {
    const offset = subtract(points[index]!, points[first]!)
    const away = length(cross(offset, along))
    if (away <= furthest) continue
    furthest = away
    third = index
  }
  if (third < 0 || furthest <= tolerance) return null

  const normal = facetNormal(points, [first, second, third])
  let fourth = -1
  let deepest = 0
  for (let index = 0; index < points.length; index += 1) {
    const away = Math.abs(dot(subtract(points[index]!, points[first]!), normal))
    if (away <= deepest) continue
    deepest = away
    fourth = index
  }
  if (fourth < 0 || deepest <= tolerance) return null
  return [first, second, third, fourth]
}

/** A facet wound so that its normal looks away from the point given. */
function facingAwayFrom(points: Vec3[], facet: Facet, inside: number): Facet {
  return outside(points, facet, points[inside]!) > 0 ? [facet[0], facet[2], facet[1]] : facet
}

/**
 * Quickhull. The horizon is read off the facets a point can see: a directed edge of a visible facet
 * whose reverse is not also visible is on the rim between what is thrown away and what stays, and
 * every one of those rim edges becomes a facet with the new point at its tip.
 */
function convexHullOf(points: Vec3[]): Facet[] | null {
  if (points.length < 4) return null
  let scale = 0
  for (const point of points) scale = Math.max(scale, Math.abs(point[0]), Math.abs(point[1]), Math.abs(point[2]))
  const tolerance = Math.max(NEARLY_ZERO, scale * 1e-9)
  const seed = seedTetrahedron(points, tolerance)
  if (!seed) return null
  const [a, b, c, d] = seed
  let facets: Facet[] = [
    facingAwayFrom(points, [a, b, c], d),
    facingAwayFrom(points, [a, b, d], c),
    facingAwayFrom(points, [a, c, d], b),
    facingAwayFrom(points, [b, c, d], a),
  ]
  const placed = new Set(seed)
  for (let index = 0; index < points.length; index += 1) {
    if (placed.has(index)) continue
    const point = points[index]!
    const seen: Facet[] = []
    const kept: Facet[] = []
    for (const facet of facets) {
      if (outside(points, facet, point) > tolerance) seen.push(facet)
      else kept.push(facet)
    }
    if (seen.length === 0) continue
    const directed = new Set<string>()
    for (const facet of seen) {
      directed.add(`${facet[0]}>${facet[1]}`)
      directed.add(`${facet[1]}>${facet[2]}`)
      directed.add(`${facet[2]}>${facet[0]}`)
    }
    const horizon: Array<[number, number]> = []
    for (const key of directed) {
      const [from, to] = key.split('>').map(Number) as [number, number]
      if (!directed.has(`${to}>${from}`)) horizon.push([from, to])
    }
    if (horizon.length === 0) continue
    facets = kept
    for (const [from, to] of horizon) facets.push([from, to, index])
    placed.add(index)
  }
  return facets
}

/* ------------------------------------------------------------- the operator */

type HullParams = { deleteUnused: boolean; joinTriangles: boolean; maxAngle: number }

function pairKey(one: number, other: number): string {
  return one < other ? `${one}|${other}` : `${other}|${one}`
}

/**
 * Neighbouring triangles that lie flat against each other become one face. The pass restarts after
 * each weld because merging renumbers everything; the faces are followed by id across it.
 */
function joinFlatTriangles(mesh: EditMesh, faces: number[], maxAngle: number): number[] {
  const limit = (Math.max(0, maxAngle) * Math.PI) / 180
  let ids = faces.map((face) => mesh.faceId(face))
  for (;;) {
    let welded = false
    for (const id of ids) {
      const face = mesh.slotOfFace(id)
      if (face < 0 || mesh.faceVertices(face).length !== 3) continue
      for (const edge of mesh.faceEdges(face)) {
        const other = mesh.edgeFaces(edge).find((candidate) => candidate !== face)
        if (other === undefined || mesh.faceVertices(other).length !== 3) continue
        const otherId = mesh.faceId(other)
        if (!ids.includes(otherId)) continue
        if (mesh.dihedral(edge) > limit) continue
        const gone = face < other ? otherId : id
        if (mesh.joinFaces([face, other]) < 0) continue
        ids = ids.filter((entry) => entry !== gone)
        welded = true
        break
      }
      if (welded) break
    }
    if (!welded) break
  }
  return ids.map((id) => mesh.slotOfFace(id)).filter((face) => face >= 0)
}

function convexHull(target: EditTarget, params: HullParams): EditOutcome {
  const mesh = target.mesh
  const chosen = [...selectedVertices(target)]
  if (chosen.length < 4) return 'Select at least four vertices to build a hull.'
  const facets = convexHullOf(chosen.map((slot) => mesh.position(slot)))
  if (!facets || facets.length === 0) {
    return 'The selected vertices all lie in one plane, so there is no hull to build.'
  }

  const triangles = facets.map((facet) => facet.map((corner) => chosen[corner]!))
  const onHull = new Set<number>()
  const hullEdges = new Set<string>()
  for (const triangle of triangles) {
    for (let index = 0; index < triangle.length; index += 1) {
      onHull.add(triangle[index]!)
      hullEdges.add(pairKey(triangle[index]!, triangle[(index + 1) % triangle.length]!))
    }
  }
  // The hull is named by ids from here on: the removal below renumbers every slot in the mesh.
  const wanted = triangles.map((triangle) => triangle.map((slot) => mesh.vertexId(slot)))

  const selected = new Set(chosen)
  const deadFaces = new Set<number>()
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (mesh.faceVertices(face).every((slot) => selected.has(slot))) deadFaces.add(face)
  }
  const deadEdges = new Set<number>()
  const deadVertices = new Set<number>()
  if (params.deleteUnused) {
    for (const slot of chosen) if (!onHull.has(slot)) deadVertices.add(slot)
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      const [one, other] = mesh.edgeVertices(edge)
      if (one < 0 || other < 0) continue
      if (!selected.has(one) || !selected.has(other)) continue
      if (!hullEdges.has(pairKey(one, other))) deadEdges.add(edge)
    }
  }
  mesh.remove({ faces: deadFaces, edges: deadEdges, vertices: deadVertices })

  const faces: number[] = []
  for (const triangle of wanted) {
    const loop = triangle.map((id) => mesh.slotOfVertex(id))
    if (loop.some((slot) => slot < 0)) continue
    const face = mesh.addFace(loop)
    if (face >= 0) faces.push(face)
  }
  if (faces.length === 0) return 'The selected vertices all lie in one plane, so there is no hull to build.'
  const left = params.joinTriangles ? joinFlatTriangles(mesh, faces, params.maxAngle) : faces
  return { select: { faces: left } }
}

registerOperator<HullParams>({
  id: 'mesh.convexHull',
  label: 'Convex hull',
  section: 'Mesh',
  description: 'Wrap the selected vertices in the smallest closed shape that holds them all.',
  params: [
    switchParam('deleteUnused', 'Delete unused', true),
    switchParam('joinTriangles', 'Join triangles', true),
    numberParam('maxAngle', 'Max angle', { min: 0, max: 180, step: 0.5, defaultValue: 40, unit: '°', view: 'angle' }),
  ],
  defaults: { deleteUnused: true, joinTriangles: true, maxAngle: 40 },
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context, params) => runOnMeshes(context, (target) => convexHull(target, params), { label: 'Convex hull' }),
})
