import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION, type CSGOperation } from 'three-bvh-csg'
import { meshOf, objectById, withMesh } from '@/scene/document'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { cross, dot, length, normalize, subtract } from '@/scene/mesh/normals'
import { triangulateFace, triangulateMesh } from '@/scene/mesh/triangulate'
import { worldMatrix } from '@/scene/objects'
import { requireEdit, runOnMeshes, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import {
  switchParam,
  type Availability,
  type OperatorContext,
  type OperatorResult,
} from '@/scene/operators/types'
import type { MeshData, SceneDocument, SceneObject, Vec3 } from '@/scene/types'

/**
 * Booleans: one solid cut out of another, and one part of a mesh cut by the rest.
 *
 * Everything here crosses a boundary twice. A document holds polygon meshes of any corner count;
 * the solver — `three-bvh-csg`, built on the `three-mesh-bvh` this project already carries —
 * holds nothing but triangles in a `BufferGeometry`. So this file owns both directions of that
 * crossing, and it owns the honest statement of what is lost on the way back.
 *
 * **The result is triangulated geometry recovered approximately, not Blender's topology.** The
 * solver hands back a triangle soup with a fresh corner per triangle. Coming home, corners that
 * land within a hundredth of a millimetre of each other are welded into one vertex, triangles with
 * no area are dropped, the corners one side of a cut has and the other side has not are given to
 * both, and adjacent triangles whose shared edge folds by less than a thousandth of a radian are
 * dissolved into the flat n-gon they cover. That recovers a cube's square faces and an L-shaped
 * offcut, which is what a person looks at first; it does not recover the quad grid of a sphere, and
 * every vertex and face id in the result is new, so a selection made before the boolean does not
 * survive it. Blender pays the same price and says so in its own manual.
 */

/* ------------------------------------------------------- crossing the boundary */

/** Corners nearer than this are one vertex: a hundredth of a millimetre, well under a modelling unit. */
const WELD = 1e-5

/** Under this fold, two faces are one flat surface and the edge between them is an artefact. */
const FLAT = 1e-3

/** A triangle thinner than this is a line drawn twice, and carries no surface with it. */
const MINIMUM_AREA = 1e-12

/**
 * A mesh as the triangles the solver wants, in world space.
 *
 * The triangulation is the editor's own rather than the solver's: the same table that decides which
 * triangles a face is drawn and picked as decides which triangles it is cut as, so a boolean never
 * disagrees with the picture a person clicked on.
 */
function meshGeometry(mesh: MeshData, matrix: Matrix4): BufferGeometry {
  const { indices } = triangulateMesh(mesh)
  const positions = new Float32Array(indices.length * 3)
  const point = new Vector3()
  for (let corner = 0; corner < indices.length; corner += 1) {
    const slot = indices[corner]!
    point.set(mesh.vertices[slot * 3] ?? 0, mesh.vertices[slot * 3 + 1] ?? 0, mesh.vertices[slot * 3 + 2] ?? 0)
    point.applyMatrix4(matrix)
    positions[corner * 3] = point.x
    positions[corner * 3 + 1] = point.y
    positions[corner * 3 + 2] = point.z
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  // The evaluator interpolates whichever attributes it is told to carry, and it is told to carry
  // normals, so the brushes have to have them even though nothing downstream reads them back.
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Points snapped onto a grid of `WELD`, so that two corners the solver wrote separately become one
 * vertex. The twenty-seven cells around a point are probed rather than only its own: two corners a
 * nanometre apart still fall either side of a cell boundary often enough to matter.
 */
class Welder {
  private readonly cells = new Map<string, number[]>()
  readonly points: Vec3[] = []

  add(point: Vec3): number {
    const cell = point.map((value) => Math.round(value / WELD)) as Vec3
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const near = this.cells.get(`${cell[0] + dx}|${cell[1] + dy}|${cell[2] + dz}`)
          if (!near) continue
          for (const slot of near) {
            if (length(subtract(this.points[slot]!, point)) <= WELD) return slot
          }
        }
      }
    }
    const slot = this.points.length
    this.points.push(point)
    const key = `${cell[0]}|${cell[1]}|${cell[2]}`
    const bucket = this.cells.get(key)
    if (bucket) bucket.push(slot)
    else this.cells.set(key, [slot])
    return slot
  }
}

/** The evaluated geometry as a mesh again, welded, with the degenerate triangles left behind. */
function geometryMesh(geometry: BufferGeometry, matrix: Matrix4): MeshData {
  const attribute = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const corners = index ? index.count : (attribute?.count ?? 0)
  if (!attribute) return meshFromPolygons([], [])
  const welder = new Welder()
  const point = new Vector3()
  const slots: number[] = []
  for (let corner = 0; corner < corners; corner += 1) {
    const read = index ? index.getX(corner) : corner
    point.set(attribute.getX(read), attribute.getY(read), attribute.getZ(read)).applyMatrix4(matrix)
    slots.push(welder.add([point.x, point.y, point.z]))
  }
  const faces: number[][] = []
  for (let triangle = 0; triangle + 2 < slots.length; triangle += 3) {
    const a = slots[triangle]!
    const b = slots[triangle + 1]!
    const c = slots[triangle + 2]!
    if (a === b || b === c || c === a) continue
    const points = welder.points
    const area = length(cross(subtract(points[b]!, points[a]!), subtract(points[c]!, points[a]!))) / 2
    if (area <= MINIMUM_AREA) continue
    faces.push([a, b, c])
  }
  healTJunctions(welder.points, faces)
  return meshFromPolygons(welder.points, faces)
}

/**
 * The corners one side of a cut has and the other side has not, given to both.
 *
 * The solver cuts a triangle along the whole plane of whatever it met, so a cut that stops inside a
 * face still leaves a vertex on the rim of the triangle beside it — and the triangle on the other
 * side of that rim knows nothing about it. The result is watertight to look at and open to count:
 * one long edge on one side, two short ones on the other. Every edge with a single face is checked
 * against the vertices lying on it, and the face that owns it is given them, which closes the mesh
 * without moving anything. Only single-face edges are checked, and a boolean between solids leaves
 * few of them, so the pass costs nothing on the meshes it is reached for.
 */
function healTJunctions(points: Vec3[], faces: number[][]): void {
  for (let pass = 0; pass < 4; pass += 1) {
    const uses = new Map<string, number>()
    for (const loop of faces) {
      for (let corner = 0; corner < loop.length; corner += 1) {
        const key = pairKey(loop[corner]!, loop[(corner + 1) % loop.length]!)
        uses.set(key, (uses.get(key) ?? 0) + 1)
      }
    }
    let inserted = 0
    for (let index = 0; index < faces.length; index += 1) {
      const loop = faces[index]!
      const grown: number[] = []
      for (let corner = 0; corner < loop.length; corner += 1) {
        const from = loop[corner]!
        const to = loop[(corner + 1) % loop.length]!
        grown.push(from)
        if ((uses.get(pairKey(from, to)) ?? 0) !== 1) continue
        const between = pointsOnSegment(points, from, to)
        grown.push(...between)
        inserted += between.length
      }
      if (grown.length !== loop.length) faces[index] = grown
    }
    if (inserted === 0) return
  }
}

/** The vertices sitting on a segment, strictly between its ends, in the order they are met. */
function pointsOnSegment(points: Vec3[], from: number, to: number): number[] {
  const start = points[from]!
  const along = subtract(points[to]!, start)
  const span = dot(along, along)
  if (span <= MINIMUM_AREA) return []
  const margin = WELD / Math.sqrt(span)
  const found: Array<{ slot: number; t: number }> = []
  for (let slot = 0; slot < points.length; slot += 1) {
    if (slot === from || slot === to) continue
    const point = points[slot]!
    const t = dot(subtract(point, start), along) / span
    if (t <= margin || t >= 1 - margin) continue
    const offset: Vec3 = [
      point[0] - (start[0] + along[0] * t),
      point[1] - (start[1] + along[1] * t),
      point[2] - (start[2] + along[2] * t),
    ]
    if (length(offset) > WELD) continue
    found.push({ slot, t })
  }
  return found.sort((one, two) => one.t - two.t).map((hit) => hit.slot)
}

/**
 * Flat neighbours merged back into one face. This stands in for Blender's “tris to quads” followed
 * by a limited dissolve: those are another family's operators, and a boolean that leaves a cube
 * looking like a cube is worth more here than a boolean that waits for them.
 */
function recoverFaces(mesh: MeshData): MeshData {
  const edit = EditMesh.from(mesh)
  const flat: number[] = []
  for (let edge = 0; edge < edit.edgeCount; edge += 1) {
    if (edit.edgeFaces(edge).length !== 2) continue
    if (edit.dihedral(edge) < FLAT) flat.push(edge)
  }
  if (flat.length === 0) return mesh
  // A patch that cannot become one face — one that pinches, or has a hole — is refused by
  // `dissolveEdges` and stays as its triangles, which is the right way to fail here.
  edit.dissolveEdges(flat)
  return edit.toData()
}

function brushOf(mesh: MeshData, matrix: Matrix4): Brush {
  const brush = new Brush(meshGeometry(mesh, matrix))
  brush.updateMatrixWorld()
  return brush
}

/* --------------------------------------------------------------- the solver */

/** The three the solver can do, named in the editor's words rather than in `three-bvh-csg`'s. */
export type BooleanOperation = 'union' | 'difference' | 'intersect'

const OPERATIONS: Record<BooleanOperation, CSGOperation> = {
  union: ADDITION,
  difference: SUBTRACTION,
  intersect: INTERSECTION,
}

/** A mesh and where it stands; the matrix is left out by anyone whose meshes are already in one frame. */
export type BooleanBrush = { mesh: MeshData; matrix?: Matrix4 }

/**
 * The solver's half of a boolean, on meshes alone: the base against each of the others in turn, the
 * result brought back through `into` and its flat triangles gathered up into faces again.
 *
 * The object operators hand it world matrices; the Boolean modifier hands it meshes already in the
 * modified object's frame and no matrices at all. An empty mesh comes back empty rather than as a
 * refusal, because what to say about it is the caller's to decide.
 */
export function booleanMeshes(
  base: BooleanBrush,
  others: BooleanBrush[],
  operation: BooleanOperation,
  into?: Matrix4,
): MeshData {
  const evaluator = new Evaluator()
  // Material groups would carry the operands' slots into the result, and the result keeps the
  // base's material list; one surface with one slot is the honest thing to hand back.
  evaluator.useGroups = false
  // The evaluator interpolates every attribute it is told about and throws on one a brush has
  // not got; UVs are rebuilt from the faces later in this prompt, so they are not carried here.
  evaluator.attributes = ['position', 'normal']
  let brush = brushOf(base.mesh, base.matrix ?? new Matrix4())
  for (const other of others) {
    brush = evaluator.evaluate(brush, brushOf(other.mesh, other.matrix ?? new Matrix4()), OPERATIONS[operation])
    brush.updateMatrixWorld()
  }
  const built = geometryMesh(brush.geometry, into ?? new Matrix4())
  return built.faces.length === 0 ? built : recoverFaces(built)
}

/* --------------------------------------------------------- the object booleans */

type BooleanKind = {
  id: string
  label: string
  operation: BooleanOperation
  description: string
  /** What is said when the operands leave nothing behind, which is a refusal and not an empty mesh. */
  empty: string
}

const KINDS: BooleanKind[] = [
  {
    id: 'mesh.booleanUnion',
    label: 'Boolean union',
    operation: 'union',
    description: 'Fuse the selected meshes into the active one, keeping everything either encloses.',
    empty: 'The union came out empty, which means neither object encloses a volume.',
  },
  {
    id: 'mesh.booleanDifference',
    label: 'Boolean difference',
    operation: 'difference',
    description: 'Cut the other selected meshes out of the active one.',
    empty: 'The other objects cover this one completely, so nothing would be left of it.',
  },
  {
    id: 'mesh.booleanIntersect',
    label: 'Boolean intersect',
    operation: 'intersect',
    description: 'Keep only the part the active mesh and the other selected meshes share.',
    empty: 'The selected objects do not overlap, so there is nothing to intersect.',
  },
]

const NEEDS_ACTIVE = 'Click the object to keep last, so it is the active one.'
const NEEDS_OTHERS = 'Select a second mesh: a boolean needs something to work against.'

function activeMeshObject(context: OperatorContext): SceneObject | null {
  const candidate = context.active
    ?? (context.selection.activeObjectId ? objectById(context.document, context.selection.activeObjectId) : null)
  if (!candidate || candidate.data.kind !== 'mesh') return null
  return meshOf(context.document, candidate) ? candidate : null
}

function otherMeshObjects(context: OperatorContext, active: SceneObject): SceneObject[] {
  return context.document.objects.filter((object) => (
    object.id !== active.id
    && object.data.kind === 'mesh'
    && context.selection.objectIds.includes(object.id)
    && meshOf(context.document, object) !== null
  ))
}

function booleanAvailable(context: OperatorContext): Availability {
  const active = activeMeshObject(context)
  if (!active) return NEEDS_ACTIVE
  return otherMeshObjects(context, active).length > 0 ? true : NEEDS_OTHERS
}

/** A mesh nothing points at any more is dead weight, and an object that is gone points at nothing. */
function withoutUnusedMeshes(document: SceneDocument): SceneDocument {
  const used = new Set(document.objects.flatMap((object) => (object.data.kind === 'mesh' ? [object.data.meshId] : [])))
  const meshes: Record<string, MeshData> = {}
  for (const [id, mesh] of Object.entries(document.meshes)) if (used.has(id)) meshes[id] = mesh
  return Object.keys(meshes).length === Object.keys(document.meshes).length ? document : { ...document, meshes }
}

for (const kind of KINDS) {
  registerOperator<{ keepOthers: boolean }>({
    id: kind.id,
    label: kind.label,
    section: 'Object',
    icon: 'modifier-boolean',
    description: kind.description,
    params: [switchParam('keepOthers', 'Keep the other objects', false)],
    defaults: { keepOthers: false },
    available: booleanAvailable,
    run: (context, params): OperatorResult => {
      const active = activeMeshObject(context)
      if (!active) return { error: NEEDS_ACTIVE }
      const activeData = meshOf(context.document, active)
      const others = otherMeshObjects(context, active)
      if (!activeData || others.length === 0) return { error: NEEDS_OTHERS }
      const operands: BooleanBrush[] = []
      for (const other of others) {
        const data = meshOf(context.document, other)
        if (data) operands.push({ mesh: data, matrix: worldMatrix(context.document, other) })
      }
      const built = booleanMeshes(
        { mesh: activeData, matrix: worldMatrix(context.document, active) },
        operands,
        kind.operation,
        worldMatrix(context.document, active).invert(),
      )
      if (built.faces.length === 0) return { error: kind.empty }
      const meshId = active.data.kind === 'mesh' ? active.data.meshId : ''
      let document = withMesh(context.document, meshId, built)
      if (!params.keepOthers) {
        const gone = new Set(others.map((object) => object.id))
        document = withoutUnusedMeshes({
          ...document,
          objects: document.objects.filter((object) => !gone.has(object.id)),
        })
      }
      return {
        document,
        selection: { objectIds: [active.id], activeObjectId: active.id },
        label: kind.label,
      }
    },
  })
}

/* ---------------------------------------------------------- intersect (knife) */

/**
 * Blender offers two solvers here, Fast and Exact, and this editor has neither of them: it has one
 * knife, written below, which cuts a selected face along the line where the plane of a face it
 * really touches crosses it. Where the cutter passes clean through a face — the case the knife is
 * reached for — that line is exactly Blender's. Where the cutter stops inside a face, this cut runs
 * on to the face's rim instead of stopping with it, because a cut that ends in the middle of a
 * polygon needs a vertex fan the rest of this family does not build yet. No solver parameter is
 * offered for a choice that does not exist; when a second solver is written, it earns one.
 */

const NEEDS_UNSELECTED = 'Leave some faces unselected: they are what does the cutting.'
const NOTHING_CROSSES = 'The selected faces do not cross the rest of the mesh.'

type Plane = { normal: Vec3; offset: number }

/** Where a triangle stands against a plane, as the signed distance of each corner. */
function signedDistances(points: Vec3[], plane: Plane): number[] {
  return points.map((point) => dot(plane.normal, point) - plane.offset)
}

/** The plane a triangle lies in, or null when it has no area to give one. */
function trianglePlane(a: Vec3, b: Vec3, c: Vec3): Plane | null {
  const normal = cross(subtract(b, a), subtract(c, a))
  if (length(normal) <= MINIMUM_AREA) return null
  const unit = normalize(normal)
  return { normal: unit, offset: dot(unit, a) }
}

/**
 * Whether two triangles pass through each other, rather than merely touching along an edge or
 * lying in the same plane. Both must straddle the other's plane with something to spare, and the
 * two stretches of the line their planes share must overlap — so two faces of a cube, which meet
 * along an edge and cut nothing, answer no, and only a real crossing gets a knife.
 */
function trianglesMeet(first: Vec3[], second: Vec3[]): boolean {
  const planeA = trianglePlane(first[0]!, first[1]!, first[2]!)
  const planeB = trianglePlane(second[0]!, second[1]!, second[2]!)
  if (!planeA || !planeB) return false
  const againstB = signedDistances(first, planeB)
  const againstA = signedDistances(second, planeA)
  if (!straddles(againstB) || !straddles(againstA)) return false
  const direction = cross(planeA.normal, planeB.normal)
  if (length(direction) <= MINIMUM_AREA) return false
  const spanA = crossingSpan(first, againstB, direction)
  const spanB = crossingSpan(second, againstA, direction)
  if (!spanA || !spanB) return false
  return spanA[0] < spanB[1] - WELD && spanB[0] < spanA[1] - WELD
}

/** Corners on both sides of a plane, and not merely resting on it. */
function straddles(distances: number[]): boolean {
  return distances.some((value) => value > WELD) && distances.some((value) => value < -WELD)
}

/** The stretch of the shared line a triangle covers, as the two ends of its crossing segment. */
function crossingSpan(points: Vec3[], distances: number[], direction: Vec3): [number, number] | null {
  const hits: number[] = []
  for (let corner = 0; corner < points.length; corner += 1) {
    const here = distances[corner]!
    const ahead = distances[(corner + 1) % points.length]!
    if (Math.abs(here) <= WELD) hits.push(dot(direction, points[corner]!))
    if ((here > 0) === (ahead > 0) || Math.abs(here) <= WELD || Math.abs(ahead) <= WELD) continue
    const t = here / (here - ahead)
    const from = points[corner]!
    const to = points[(corner + 1) % points.length]!
    hits.push(dot(direction, [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ]))
  }
  if (hits.length === 0) return null
  return [Math.min(...hits), Math.max(...hits)]
}

/** A face's triangles as world points, for the meeting test. */
function facePoints(data: MeshData, faceSlot: number): Vec3[][] {
  return triangulateFace(data, faceSlot).map((triple) => triple.map((slot): Vec3 => [
    data.vertices[slot * 3] ?? 0,
    data.vertices[slot * 3 + 1] ?? 0,
    data.vertices[slot * 3 + 2] ?? 0,
  ]))
}

/**
 * Cuts one face along a plane, in ids rather than slots: splitting the two rim edges the plane
 * crosses removes them, which renumbers everything, so the face has to be found again afterwards.
 * Answers the face the cut created and the chord it was cut along, or null when the plane misses
 * the face's rim.
 */
function cutFace(mesh: EditMesh, faceId: number, plane: Plane): { face: number; chord: string } | null {
  const faceSlot = mesh.slotOfFace(faceId)
  if (faceSlot < 0) return null
  const loop = mesh.faceVertices(faceSlot)
  const distances = loop.map((slot) => dot(plane.normal, mesh.position(slot)) - plane.offset)
  const onPlane: number[] = []
  const cuts: Array<{ edge: number; t: number }> = []
  for (let corner = 0; corner < loop.length; corner += 1) {
    const here = distances[corner]!
    const ahead = distances[(corner + 1) % loop.length]!
    if (Math.abs(here) <= WELD) {
      onPlane.push(mesh.vertexId(loop[corner]!))
      continue
    }
    if (Math.abs(ahead) <= WELD || (here > 0) === (ahead > 0)) continue
    const edge = mesh.edgeSlot(loop[corner]!, loop[(corner + 1) % loop.length]!)
    if (edge >= 0) cuts.push({ edge, t: cutParameter(mesh, edge, loop[corner]!, here / (here - ahead)) })
  }
  if (onPlane.length + cuts.length !== 2) return null
  const minted = mesh.splitEdges(cuts).map((slot) => mesh.vertexId(slot))
  const ends = [...onPlane, ...minted]
  const slot = mesh.slotOfFace(faceId)
  const first = mesh.slotOfVertex(ends[0]!)
  const second = mesh.slotOfVertex(ends[1]!)
  if (slot < 0 || first < 0 || second < 0) return null
  const added = mesh.splitFace(slot, first, second)
  return added < 0 ? null : { face: mesh.faceId(added), chord: pairKey(ends[0]!, ends[1]!) }
}

/** Two vertex ids as one key, so an edge can be recognised again after a renumbering. */
function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** `splitEdges` measures `t` from the edge's own first vertex, which is not the loop's direction. */
function cutParameter(mesh: EditMesh, edge: number, from: number, t: number): number {
  return mesh.edgeVertices(edge)[0] === from ? t : 1 - t
}

/**
 * The selected faces torn apart along the cuts, so each piece comes away on its own. The pieces are
 * found by walking the selection without ever stepping over an edge the knife made; every piece but
 * the first gets its own copy of the vertices on those edges, which is what disconnects them.
 */
function tearAlong(mesh: EditMesh, faceIds: Set<number>, cutEdgeIds: Set<string>): void {
  const faces = [...faceIds].map((id) => mesh.slotOfFace(id)).filter((slot) => slot >= 0)
  const wanted = new Set(faces)
  const isCut = (edge: number): boolean => {
    const [a, b] = mesh.edgeVertices(edge)
    return a >= 0 && b >= 0 && cutEdgeIds.has(pairKey(mesh.vertexId(a), mesh.vertexId(b)))
  }
  const seen = new Set<number>()
  const pieces: number[][] = []
  for (const start of faces) {
    if (seen.has(start)) continue
    const piece = [start]
    seen.add(start)
    for (let index = 0; index < piece.length; index += 1) {
      for (const edge of mesh.faceEdges(piece[index]!)) {
        if (isCut(edge)) continue
        for (const face of mesh.edgeFaces(edge)) {
          if (!wanted.has(face) || seen.has(face)) continue
          seen.add(face)
          piece.push(face)
        }
      }
    }
    pieces.push(piece)
  }
  for (const piece of pieces.slice(1)) {
    const copies = new Map<number, number>()
    for (const face of piece) {
      const loop = mesh.faceVertices(face)
      const onCut = loop.filter((slot) => mesh.vertexEdges(slot).some((edge) => isCut(edge)))
      if (onCut.length === 0) continue
      const replaced = loop.map((slot) => {
        if (!onCut.includes(slot)) return slot
        const already = copies.get(slot)
        if (already !== undefined) return already
        const copy = mesh.addVertex(mesh.position(slot))
        copies.set(slot, copy)
        return copy
      })
      mesh.setFaceLoop(face, replaced)
    }
  }
  mesh.dropLoose()
}

function knife(target: EditTarget, separate: boolean): string | { select: { faces: number[] } } {
  const data = target.mesh.toData()
  const others: number[] = []
  for (let face = 0; face < target.mesh.faceCount; face += 1) if (!target.faces.has(face)) others.push(face)
  if (others.length === 0) return NEEDS_UNSELECTED
  const cutterTriangles = others.flatMap((face) => facePoints(data, face))
  const cutters = new Map<number, Plane[]>()
  for (const face of target.faces) {
    const mine = facePoints(data, face)
    const planes: Plane[] = []
    for (const triangle of cutterTriangles) {
      const plane = trianglePlane(triangle[0]!, triangle[1]!, triangle[2]!)
      if (!plane || planes.some((known) => samePlane(known, plane))) continue
      if (mine.some((own) => trianglesMeet(own, triangle))) planes.push(plane)
    }
    if (planes.length > 0) cutters.set(target.mesh.faceId(face), planes)
  }
  if (cutters.size === 0) return NOTHING_CROSSES
  const touched = new Set<number>()
  const cutEdges = new Set<string>()
  for (const [faceId, planes] of cutters) {
    let pieces = [faceId]
    touched.add(faceId)
    for (const plane of planes) {
      const grown: number[] = []
      for (const piece of pieces) {
        grown.push(piece)
        const cut = cutFace(target.mesh, piece, plane)
        if (cut === null) continue
        grown.push(cut.face)
        touched.add(cut.face)
        cutEdges.add(cut.chord)
      }
      pieces = grown
    }
  }
  if (cutEdges.size === 0) return NOTHING_CROSSES
  if (separate) tearAlong(target.mesh, touched, cutEdges)
  const faces = [...touched].map((id) => target.mesh.slotOfFace(id)).filter((slot) => slot >= 0)
  return { select: { faces } }
}

/** Two planes are one when they face the same way, or exactly the other way, at the same distance. */
function samePlane(one: Plane, two: Plane): boolean {
  const alignment = dot(one.normal, two.normal)
  if (Math.abs(alignment) < 1 - 1e-9) return false
  return Math.abs(one.offset - (alignment > 0 ? two.offset : -two.offset)) <= WELD
}

registerOperator<{ separate: boolean }>({
  id: 'mesh.intersectKnife',
  label: 'Intersect (knife)',
  section: 'Face',
  icon: 'knife',
  description: 'Cut the selected faces where the rest of the mesh passes through them.',
  params: [switchParam('separate', 'Separate the pieces', false)],
  defaults: { separate: false },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => runOnMeshes(
    context,
    (target) => (target.faces.size === 0 ? 'No faces are selected.' : knife(target, params.separate)),
    { label: 'Intersect (knife)' },
  ),
})
