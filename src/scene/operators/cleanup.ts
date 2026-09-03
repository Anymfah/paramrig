import type { EditMesh } from '@/scene/mesh/editMesh'
import { cross, dot, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import { triangulateFace } from '@/scene/mesh/triangulate'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Blender's Clean up menu: delete loose, decimate, degenerate dissolve, make planar, split
 * non-planar and split concave.
 *
 * Two decisions run through the family. Each of these works on the selection when there is one and
 * on the whole mesh when there is not — which is how a person uses a clean-up: on the part they are
 * fixing, or on everything before an export. Decimate is the exception and says so: a quadric
 * collapse held inside a selected patch needs boundary quadrics this does not build, so it takes
 * the whole mesh.
 *
 * And decimate is an approximation of Blender's, deliberately. It is Garland and Heckbert's
 * quadric error collapse: the mesh is cut into triangles, each vertex carries the sum of the
 * fundamental error quadrics of the planes of its faces, and the cheapest edge is pulled to a point
 * over and over until the face count reaches the ratio. Blender's is the same family but places the
 * survivor at the position that minimises the error, weighs boundaries, and keeps the shape of the
 * silhouette; this one puts the survivor at the midpoint, because that is where `collapseEdge`
 * puts it. Expect the same face count and a slightly worse surface.
 */

/** Below this a length is rounding noise rather than a distance. */
const NEARLY_ZERO = 1e-9

/* ------------------------------------------------------- what to work on */

/** The faces a clean-up acts on: the selected ones, or all of them when nothing is selected. */
function workingFaces(target: EditTarget): number[] {
  if (target.faces.size > 0) return [...target.faces]
  const vertices = selectedVertices(target)
  const faces: number[] = []
  if (vertices.size === 0) {
    for (let face = 0; face < target.mesh.faceCount; face += 1) faces.push(face)
    return faces
  }
  for (let face = 0; face < target.mesh.faceCount; face += 1) {
    if (target.mesh.faceVertices(face).every((slot) => vertices.has(slot))) faces.push(face)
  }
  return faces
}

/** The unnormalised Newell sum of a loop: its direction, and twice its area as a length. */
function loopSum(points: Vec3[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const here = points[index]!
    const ahead = points[(index + 1) % points.length]!
    x += (here[1] - ahead[1]) * (here[2] + ahead[2])
    y += (here[2] - ahead[2]) * (here[0] + ahead[0])
    z += (here[0] - ahead[0]) * (here[1] + ahead[1])
  }
  return [x, y, z]
}

/** Cuts one face into triangles in place. Nothing is removed, so no slot anybody holds moves. */
function cutIntoTriangles(mesh: EditMesh, face: number): number[] {
  const triangles = triangulateFace(mesh.toData(), face)
  if (triangles.length < 2) return [face]
  mesh.setFaceLoop(face, triangles[0]!)
  const made = [face]
  for (let index = 1; index < triangles.length; index += 1) {
    const added = mesh.addFace(triangles[index]!)
    if (added < 0) continue
    mesh.copyFaceAttributes(face, added)
    made.push(added)
  }
  return made
}

/* ------------------------------------------------------------ delete loose */

type LooseParams = { vertices: boolean; edges: boolean; faces: boolean }

/**
 * Loose geometry, in the order it comes apart: a face no other face touches, then an edge no
 * surviving face uses, then a vertex no surviving edge uses. Doing it in that order in one pass is
 * what lets deleting a loose wire loop take its vertices with it.
 */
function deleteLoose(target: EditTarget, params: LooseParams): EditOutcome {
  const mesh = target.mesh
  const chosen = workingFaces(target)
  const vertices = selectedVertices(target)
  const everything = vertices.size === 0 && target.edges.size === 0 && target.faces.size === 0
  const deadFaces = new Set<number>()
  if (params.faces) {
    for (const face of chosen) {
      const joined = mesh.faceEdges(face).some((edge) => mesh.edgeFaces(edge).length > 1)
      if (!joined) deadFaces.add(face)
    }
  }
  const deadEdges = new Set<number>()
  if (params.edges) {
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      const [a, b] = mesh.edgeVertices(edge)
      if (a < 0 || b < 0) continue
      if (!everything && !(vertices.has(a) && vertices.has(b))) continue
      if (mesh.edgeFaces(edge).every((face) => deadFaces.has(face))) deadEdges.add(edge)
    }
  }
  const deadVertices = new Set<number>()
  if (params.vertices) {
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      if (!everything && !vertices.has(slot)) continue
      if (!mesh.vertexEdges(slot).every((edge) => deadEdges.has(edge))) continue
      if (!mesh.vertexFaces(slot).every((face) => deadFaces.has(face))) continue
      deadVertices.add(slot)
    }
  }
  if (deadFaces.size + deadEdges.size + deadVertices.size === 0) return 'There is no loose geometry here.'
  mesh.remove({ faces: deadFaces, edges: deadEdges, vertices: deadVertices })
  return {}
}

registerOperator<LooseParams>({
  id: 'mesh.deleteLoose',
  label: 'Delete loose',
  section: 'Mesh',
  description: 'Remove vertices, edges and faces that nothing else is attached to.',
  params: [
    switchParam('vertices', 'Vertices', true),
    switchParam('edges', 'Edges', true),
    switchParam('faces', 'Faces', false),
  ],
  defaults: { vertices: true, edges: true, faces: false },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(context, (target) => deleteLoose(target, params), { label: 'Delete loose' }),
})

/* ---------------------------------------------------------------- decimate */

type DecimateParams = { ratio: number; symmetry: boolean; triangulate: boolean }

/** A symmetric 4×4 as its ten distinct entries, which is the whole of a fundamental error quadric. */
type Quadric = number[]

function planeQuadric(normal: Vec3, offset: number): Quadric {
  const [x, y, z] = normal
  return [x * x, x * y, x * z, x * offset, y * y, y * z, y * offset, z * z, z * offset, offset * offset]
}

function addQuadrics(one: Quadric, other: Quadric): Quadric {
  return one.map((value, index) => value + (other[index] ?? 0))
}

function quadricError(quadric: Quadric, point: Vec3): number {
  const [x, y, z] = point
  return (
    quadric[0]! * x * x + 2 * quadric[1]! * x * y + 2 * quadric[2]! * x * z + 2 * quadric[3]! * x +
    quadric[4]! * y * y + 2 * quadric[5]! * y * z + 2 * quadric[6]! * y +
    quadric[7]! * z * z + 2 * quadric[8]! * z +
    quadric[9]!
  )
}

/** A cheapest-first queue of candidate collapses, held by the ids of the two ends so it survives a renumbering. */
class CollapseQueue {
  private readonly costs: number[] = []
  private readonly pairs: Array<[number, number]> = []

  get size(): number {
    return this.costs.length
  }

  push(cost: number, pair: [number, number]): void {
    this.costs.push(cost)
    this.pairs.push(pair)
    let index = this.costs.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.costs[parent]! <= this.costs[index]!) break
      this.swap(parent, index)
      index = parent
    }
  }

  pop(): { cost: number; pair: [number, number] } | null {
    if (this.costs.length === 0) return null
    const top = { cost: this.costs[0]!, pair: this.pairs[0]! }
    const cost = this.costs.pop()!
    const pair = this.pairs.pop()!
    if (this.costs.length > 0) {
      this.costs[0] = cost
      this.pairs[0] = pair
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < this.costs.length && this.costs[left]! < this.costs[smallest]!) smallest = left
        if (right < this.costs.length && this.costs[right]! < this.costs[smallest]!) smallest = right
        if (smallest === index) break
        this.swap(smallest, index)
        index = smallest
      }
    }
    return top
  }

  private swap(one: number, other: number): void {
    const cost = this.costs[one]!
    const pair = this.pairs[one]!
    this.costs[one] = this.costs[other]!
    this.pairs[one] = this.pairs[other]!
    this.costs[other] = cost
    this.pairs[other] = pair
  }
}

function midpointOf(mesh: EditMesh, edge: number): Vec3 {
  const [a, b] = mesh.edgeVertices(edge)
  const from = mesh.position(a)
  const to = mesh.position(b)
  return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2]
}

function farEnd(mesh: EditMesh, edge: number, from: number): number {
  const [a, b] = mesh.edgeVertices(edge)
  return a === from ? b : a
}

/**
 * Whether pulling an edge to a point leaves a mesh a person could still hold.
 *
 * Two things are checked. The link condition — the two ends may share exactly the tips of the
 * triangles they already share — is what stops the surface being folded onto itself at a place
 * where two rims happen to pass close by. And no face may turn over: a collapse that flips a
 * neighbour inside out is cheap by the quadric and wrong by the eye.
 */
function collapsible(mesh: EditMesh, edge: number, trianglesOnly: boolean): boolean {
  const faces = mesh.edgeFaces(edge)
  if (faces.length === 0 || faces.length > 2) return false
  for (const face of faces) if (mesh.faceVertices(face).length !== 3) return false
  const [a, b] = mesh.edgeVertices(edge)
  if (a < 0 || b < 0) return false
  const near = new Set(mesh.vertexEdges(a).map((other) => farEnd(mesh, other, a)))
  let shared = 0
  for (const other of mesh.vertexEdges(b)) if (near.has(farEnd(mesh, other, b))) shared += 1
  if (shared !== faces.length) return false
  const midpoint = midpointOf(mesh, edge)
  for (const face of new Set([...mesh.vertexFaces(a), ...mesh.vertexFaces(b)])) {
    if (faces.includes(face)) continue
    if (trianglesOnly && mesh.faceVertices(face).length !== 3) return false
    const loop = mesh.faceVertices(face)
    const before = loopSum(loop.map((slot) => mesh.position(slot)))
    const after = loopSum(loop.map((slot) => (slot === a || slot === b ? midpoint : mesh.position(slot))))
    if (length(after) <= NEARLY_ZERO) return false
    if (dot(normalize(before), normalize(after)) <= 0) return false
  }
  return true
}

function decimate(target: EditTarget, params: DecimateParams): EditOutcome {
  const mesh = target.mesh
  const ratio = Math.min(1, Math.max(0, params.ratio))
  let changed = false
  if (params.triangulate) {
    const before = mesh.faceCount
    for (let face = 0; face < before; face += 1) if (mesh.faceVertices(face).length > 3) cutIntoTriangles(mesh, face)
    changed = mesh.faceCount !== before
  }
  const wanted = Math.max(1, Math.round(mesh.faceCount * ratio))
  if (mesh.faceCount <= wanted) {
    return changed ? {} : 'Set a ratio below 1 for decimate to have anything to collapse.'
  }

  const quadrics = new Map<number, Quadric>()
  const empty: Quadric = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const normal = mesh.faceNormal(face)
    const plane = planeQuadric(normal, -dot(normal, mesh.faceCentre(face)))
    for (const slot of mesh.faceVertices(face)) {
      const id = mesh.vertexId(slot)
      quadrics.set(id, addQuadrics(quadrics.get(id) ?? empty, plane))
    }
  }
  const quadricOf = (id: number): Quadric => quadrics.get(id) ?? empty
  const pairOf = (edge: number): [number, number] => {
    const [a, b] = mesh.edgeVertices(edge)
    return [mesh.vertexId(a), mesh.vertexId(b)]
  }
  const costOf = (edge: number): number => {
    const [a, b] = pairOf(edge)
    return quadricError(addQuadrics(quadricOf(a), quadricOf(b)), midpointOf(mesh, edge))
  }
  const edgeOf = (pair: [number, number]): number => {
    const a = mesh.slotOfVertex(pair[0])
    const b = mesh.slotOfVertex(pair[1])
    return a < 0 || b < 0 ? -1 : mesh.edgeSlot(a, b)
  }

  const queue = new CollapseQueue()
  const offer = (edge: number): void => {
    if (collapsible(mesh, edge, !params.triangulate)) queue.push(costOf(edge), pairOf(edge))
  }
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) offer(edge)

  const pull = (edge: number): void => {
    const [idA, idB] = pairOf(edge)
    const merged = addQuadrics(quadricOf(idA), quadricOf(idB))
    const survivor = mesh.collapseEdge(edge)
    if (survivor < 0) return
    quadrics.delete(idA)
    quadrics.delete(idB)
    quadrics.set(mesh.vertexId(survivor), merged)
    for (const around of mesh.vertexEdges(survivor)) offer(around)
    changed = true
  }

  while (mesh.faceCount > wanted && queue.size > 0) {
    const next = queue.pop()
    if (!next) break
    const edge = edgeOf(next.pair)
    if (edge < 0 || !collapsible(mesh, edge, !params.triangulate)) continue
    // Costs only ever grow as quadrics are summed, so a stale entry is re-filed rather than acted
    // on: that is what keeps the queue honest without having to find and rewrite entries in place.
    const fresh = costOf(edge)
    if (fresh > next.cost + NEARLY_ZERO) {
      queue.push(fresh, next.pair)
      continue
    }
    if (!params.symmetry) {
      pull(edge)
      continue
    }
    const twin = mirrorEdge(mesh, edge)
    if (twin === edge) {
      pull(edge)
      continue
    }
    if (twin < 0 || !collapsible(mesh, twin, !params.triangulate)) continue
    // The two collapses have to be independent, or the second would land on a neighbourhood the
    // first has just rewritten and the halves would stop matching.
    if (touching(mesh, edge, twin)) continue
    const twinPair = pairOf(twin)
    pull(edge)
    const again = edgeOf(twinPair)
    if (again >= 0 && collapsible(mesh, again, !params.triangulate)) pull(again)
  }
  if (!changed) return 'None of these edges can be collapsed without tearing the mesh.'
  return {}
}

/** Whether two edges share a vertex or a face, and so cannot be collapsed one after the other. */
function touching(mesh: EditMesh, one: number, other: number): boolean {
  const ends = new Set(mesh.edgeVertices(one))
  if (mesh.edgeVertices(other).some((slot) => ends.has(slot))) return true
  const faces = new Set([...mesh.edgeVertices(one)].flatMap((slot) => mesh.vertexFaces(slot)))
  return mesh.edgeFaces(other).some((face) => faces.has(face))
}

/**
 * The edge that mirrors this one across x = 0, or the edge itself when it lies in the plane or
 * crosses it — both of which are their own mirror and collapse to a point still on the plane.
 */
function mirrorEdge(mesh: EditMesh, edge: number): number {
  const index = new Map<string, number>()
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) index.set(positionKey(mesh.position(slot)), slot)
  const [a, b] = mesh.edgeVertices(edge)
  const one = index.get(positionKey(mirrored(mesh.position(a))))
  const other = index.get(positionKey(mirrored(mesh.position(b))))
  if (one === undefined || other === undefined) return -1
  return mesh.edgeSlot(one, other)
}

function mirrored(point: Vec3): Vec3 {
  return [-point[0], point[1], point[2]]
}

function positionKey(point: Vec3): string {
  // Six decimals: finer than any modelling tolerance, and coarse enough that a coordinate reached
  // the long way round still lands on the twin it should.
  const round = (value: number): number => Math.round(value * 1e6) / 1e6
  return `${round(point[0])}|${round(point[1])}|${round(point[2])}`
}

registerOperator<DecimateParams>({
  id: 'mesh.decimate',
  label: 'Decimate geometry',
  section: 'Mesh',
  description: 'Collapse the cheapest edges until the mesh is down to the ratio of faces asked for.',
  params: [
    numberParam('ratio', 'Ratio', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' }),
    switchParam('symmetry', 'Symmetry', false),
    switchParam('triangulate', 'Triangulate', true),
  ],
  defaults: { ratio: 0.5, symmetry: false, triangulate: true },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(context, (target) => decimate(target, params), { label: 'Decimate geometry' }),
})

/* ----------------------------------------------------- degenerate dissolve */

type DegenerateParams = { threshold: number }

/**
 * Geometry with no size in it: an edge shorter than the threshold is pulled to a point, and a face
 * whose area has gone with it is deleted. The area is measured against the threshold squared, since
 * the field a person sets is a distance and a face with two sides that short has no area to speak of.
 */
function degenerateDissolve(target: EditTarget, threshold: number): EditOutcome {
  const mesh = target.mesh
  const limit = Math.max(0, threshold)
  // The faces to measure are named by id: every collapse below renumbers the slots under them.
  const watched = workingFaces(target).map((face) => mesh.faceId(face))
  let changed = false
  for (let guard = mesh.edgeCount; guard >= 0; guard -= 1) {
    let shortest = -1
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      if (mesh.edgeLength(edge) > limit) continue
      shortest = edge
      break
    }
    if (shortest < 0) break
    mesh.collapseEdge(shortest)
    changed = true
  }
  const dead = new Set<number>()
  for (const id of watched) {
    const face = mesh.slotOfFace(id)
    if (face >= 0 && mesh.faceArea(face) <= limit * limit) dead.add(face)
  }
  if (dead.size > 0) {
    mesh.remove({ faces: dead })
    changed = true
  }
  return changed ? {} : 'Nothing here is degenerate at that threshold.'
}

registerOperator<DegenerateParams>({
  id: 'mesh.degenerateDissolve',
  label: 'Degenerate dissolve',
  section: 'Mesh',
  description: 'Remove edges with no length and faces with no area.',
  params: [numberParam('threshold', 'Threshold', { min: 0, max: 1, step: 0.0001, defaultValue: 0.0001, unit: 'm' })],
  defaults: { threshold: 0.0001 },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(
    context,
    (target) => degenerateDissolve(target, params.threshold),
    { label: 'Degenerate dissolve' },
  ),
})

/* ------------------------------------------------------- make planar faces */

type PlanarParams = { factor: number; iterations: number }

/**
 * Each face pulls its own corners onto its best-fit plane, and a corner shared by several faces
 * goes to the average of what they asked for. One pass at full strength flattens a lone face
 * exactly; repeating is for a shared corner, where each pass is a step towards agreement.
 */
function makePlanar(target: EditTarget, params: PlanarParams): EditOutcome {
  const mesh = target.mesh
  const faces = workingFaces(target).filter((face) => mesh.faceVertices(face).length > 3)
  if (faces.length === 0) return 'No face here has more than three corners, so they are planar already.'
  const rounds = Math.max(1, Math.round(params.iterations))
  for (let pass = 0; pass < rounds; pass += 1) {
    const shifts = new Map<number, Vec3>()
    const counts = new Map<number, number>()
    for (const face of faces) {
      const normal = mesh.faceNormal(face)
      const centre = mesh.faceCentre(face)
      for (const slot of mesh.faceVertices(face)) {
        const drift = dot(subtract(mesh.position(slot), centre), normal)
        const shift = shifts.get(slot) ?? [0, 0, 0]
        const step = scale(normal, -drift * params.factor)
        shifts.set(slot, [shift[0] + step[0], shift[1] + step[1], shift[2] + step[2]])
        counts.set(slot, (counts.get(slot) ?? 0) + 1)
      }
    }
    for (const [slot, shift] of shifts) {
      const share = counts.get(slot) ?? 1
      const point = mesh.position(slot)
      mesh.setPosition(slot, [point[0] + shift[0] / share, point[1] + shift[1] / share, point[2] + shift[2] / share])
    }
  }
  return {}
}

registerOperator<PlanarParams>({
  id: 'mesh.makePlanar',
  label: 'Make planar faces',
  section: 'Mesh',
  description: 'Flatten each face onto the plane that fits its corners best.',
  params: [
    numberParam('factor', 'Factor', { min: -10, max: 10, step: 0.05, defaultValue: 1 }),
    numberParam('iterations', 'Iterations', { min: 1, max: 200, step: 1, defaultValue: 1, view: 'stepper' }),
  ],
  defaults: { factor: 1, iterations: 1 },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(context, (target) => makePlanar(target, params), { label: 'Make planar faces' }),
})

/* --------------------------------------------------- split non-planar faces */

type NonPlanarParams = { angle: number }

/** How far a face bends, in radians: the widest angle between the whole face and any of its corners. */
function bend(mesh: EditMesh, face: number): number {
  const loop = mesh.faceVertices(face)
  if (loop.length < 4) return 0
  const normal = mesh.faceNormal(face)
  let widest = 0
  for (let index = 0; index < loop.length; index += 1) {
    const before = mesh.position(loop[(index + loop.length - 1) % loop.length]!)
    const here = mesh.position(loop[index]!)
    const after = mesh.position(loop[(index + 1) % loop.length]!)
    const corner = cross(subtract(here, before), subtract(after, here))
    if (length(corner) <= NEARLY_ZERO) continue
    widest = Math.max(widest, Math.acos(Math.min(1, Math.max(-1, dot(normalize(corner), normal)))))
  }
  return widest
}

function splitNonPlanar(target: EditTarget, angle: number): EditOutcome {
  const mesh = target.mesh
  const limit = (Math.max(0, angle) * Math.PI) / 180
  const faces: number[] = []
  for (const face of workingFaces(target)) {
    if (mesh.faceVertices(face).length < 4 || bend(mesh, face) <= limit) continue
    faces.push(...cutIntoTriangles(mesh, face))
  }
  if (faces.length === 0) return 'Every face here is flat enough to leave alone.'
  return { select: { faces } }
}

registerOperator<NonPlanarParams>({
  id: 'mesh.splitNonPlanar',
  label: 'Split non-planar faces',
  section: 'Mesh',
  description: 'Cut into triangles every face that bends further than the angle allows.',
  params: [numberParam('angle', 'Angle', { min: 0, max: 180, step: 0.5, defaultValue: 5, unit: '°', view: 'angle' })],
  defaults: { angle: 5 },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(
    context,
    (target) => splitNonPlanar(target, params.angle),
    { label: 'Split non-planar faces' },
  ),
})

/* ------------------------------------------------------ split concave faces */

/** Whether a corner of a face turns back on itself, seen from the side the face faces. */
function isConcave(mesh: EditMesh, face: number): boolean {
  const loop = mesh.faceVertices(face)
  if (loop.length < 4) return false
  const normal = mesh.faceNormal(face)
  for (let index = 0; index < loop.length; index += 1) {
    const before = mesh.position(loop[(index + loop.length - 1) % loop.length]!)
    const here = mesh.position(loop[index]!)
    const after = mesh.position(loop[(index + 1) % loop.length]!)
    if (dot(cross(subtract(here, before), subtract(after, here)), normal) < -NEARLY_ZERO) return true
  }
  return false
}

function splitConcave(target: EditTarget): EditOutcome {
  const mesh = target.mesh
  const faces: number[] = []
  for (const face of workingFaces(target)) {
    if (!isConcave(mesh, face)) continue
    faces.push(...cutIntoTriangles(mesh, face))
  }
  if (faces.length === 0) return 'Every face here is convex already.'
  return { select: { faces } }
}

registerOperator({
  id: 'mesh.splitConcave',
  label: 'Split concave faces',
  section: 'Mesh',
  description: 'Cut every face that turns back on itself into triangles.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context) => runOnMeshes(context, splitConcave, { label: 'Split concave faces' }),
})
