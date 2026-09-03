import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, cross, dot, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Blender's I: a border laid inside the selected faces.
 *
 * The whole operator is one idea. Every face of the selection keeps its identity and is pushed
 * inwards; the ring of quads between where its rim was and where it now is, is the inset. What
 * makes it worth writing carefully is the *region*: adjacent selected faces are inset as one, with
 * a single border round the outside of the patch, and none along the seams inside it — so a rim
 * vertex shared by two faces of the region has to land on one point that is right for both.
 *
 * That point is the shortest move which leaves the vertex the asked distance from each of the rim
 * edges meeting there, measured inside the face that edge belongs to. For a plain corner of one
 * face this is the bisector, longer than the thickness by one over the sine of the half-angle —
 * which is exactly what “offset even” means, and why turning it off shortens the move back down to
 * the thickness and lets the corners pinch. For a vertex on the crease between two faces of the
 * region it is the move along the crease, which is what keeps the border the same width on both.
 *
 * One decision is ours rather than Blender's, and it is written out in `patchesOf`: a selection
 * with no rim at all — every face of a closed mesh — is inset face by face, because a closed
 * surface has no outside edge to lay a border along and a frame on each face is the answer a person
 * asking for it wants.
 */

/** Two bounding lines this nearly parallel say one thing, and asking for their corner gives none. */
const PARALLEL = 1 - 1e-9

/** Under this a move has no direction left to keep, so an uneven offset leaves it as it is. */
const TINY = 1e-12

type InsetParams = {
  thickness: number
  depth: number
  individual: boolean
  boundary: boolean
  offsetEven: boolean
  offsetRelative: boolean
  outset: boolean
  selectOuter: boolean
}

/** A patch of faces inset together: its faces, and the edges that make up the single rim round it. */
type Patch = { faces: number[]; rim: Set<number> }

/** Everything read off the mesh before anything is written to it, so every patch reads it pristine. */
type Plan = {
  faces: number[]
  /** Each face's loop as it was, which is what the border quads are wound from. */
  loops: Map<number, number[]>
  /** Where the new rim vertex of each old one is minted — the rim the region's faces end up on. */
  moves: Map<number, Vec3>
  /** Where an outset slides the old rim vertex to, dragging the faces round the region with it. */
  slides: Map<number, Vec3>
  /** Vertices inside the patch, which the thickness does not touch and the depth does. */
  interior: Map<number, Vec3>
  /** One border quad per entry, wound the way its face's loop runs. */
  border: Array<{ face: number; from: number; to: number }>
  /** Every edge the patch used, so the seams the region swallowed can be found afterwards. */
  edges: number[]
}

/* ------------------------------------------------------------ the geometry */

/**
 * The shortest move that leaves a corner a given distance from each of the lines bounding it.
 *
 * One line gives the perpendicular. Two give the bisector, longer than the distance by one over the
 * sine of the half-angle, which is what holds a border's width round a corner. Both are the
 * least-norm solution of the same system, so the rare corner bounded by three edges of the region
 * is answered by the same lines rather than by a special case.
 */
function offsetCorner(constraints: Array<{ normal: Vec3; distance: number }>): Vec3 {
  const rows: Array<{ normal: Vec3; distance: number }> = []
  for (const constraint of constraints) {
    const same = rows.find((row) => dot(row.normal, constraint.normal) > PARALLEL)
    if (!same) {
      rows.push({ normal: constraint.normal, distance: constraint.distance })
      continue
    }
    if (Math.abs(constraint.distance) > Math.abs(same.distance)) same.distance = constraint.distance
  }
  if (rows.length === 0) return [0, 0, 0]
  const first = rows[0]!
  if (rows.length === 1) return scale(first.normal, first.distance)
  const gram = rows.map((row) => rows.map((other) => dot(row.normal, other.normal)))
  const weights = solve(gram, rows.map((row) => row.distance))
  if (!weights) {
    // Anti-parallel bounds meet nowhere; the mean of the perpendiculars is the honest answer.
    let mean: Vec3 = [0, 0, 0]
    for (const row of rows) mean = add(mean, scale(row.normal, row.distance / rows.length))
    return mean
  }
  let move: Vec3 = [0, 0, 0]
  for (let index = 0; index < rows.length; index += 1) move = add(move, scale(rows[index]!.normal, weights[index]!))
  return move
}

/** Gaussian elimination with partial pivoting on a system of two or three rows; null when singular. */
function solve(matrix: number[][], right: number[]): number[] | null {
  const size = right.length
  const rows = matrix.map((row, index) => [...row, right[index]!])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row
    }
    const head = rows[pivot]!
    if (Math.abs(head[column]!) < TINY) return null
    rows[pivot] = rows[column]!
    rows[column] = head
    for (let row = column + 1; row < size; row += 1) {
      const factor = rows[row]![column]! / head[column]!
      for (let term = column; term <= size; term += 1) {
        rows[row]![term] = rows[row]![term]! - factor * head[term]!
      }
    }
  }
  const answer = new Array<number>(size).fill(0)
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = rows[row]![size]!
    for (let column = row + 1; column < size; column += 1) sum -= rows[row]![column]! * answer[column]!
    answer[row] = sum / rows[row]![row]!
  }
  return answer
}

/** The inward perpendicular to one edge of a face, in that face's own plane. */
function inwardNormal(mesh: EditMesh, face: number, vertex: number, other: number): Vec3 {
  const forward = mesh.loopNext(face, vertex) === other
  const along = forward
    ? subtract(mesh.position(other), mesh.position(vertex))
    : subtract(mesh.position(vertex), mesh.position(other))
  return cross(mesh.faceNormal(face), normalize(along))
}

/** What “offset relative” scales the thickness by: the face's own edges, averaged. */
function faceScale(mesh: EditMesh, face: number): number {
  const corners = mesh.faceVertices(face).length
  return corners > 0 ? mesh.facePerimeter(face) / corners : 1
}

/* -------------------------------------------------------------- the patches */

/** The selected faces split into the groups that share one rim, in the order they were selected. */
function componentsOf(mesh: EditMesh, region: Set<number>): number[][] {
  const seen = new Set<number>()
  const components: number[][] = []
  for (const start of region) {
    if (seen.has(start)) continue
    const component: number[] = []
    const queue = [start]
    seen.add(start)
    while (queue.length > 0) {
      const face = queue.pop()!
      component.push(face)
      for (const edge of mesh.faceEdges(face)) {
        for (const neighbour of mesh.edgeFaces(edge)) {
          if (!region.has(neighbour) || seen.has(neighbour)) continue
          seen.add(neighbour)
          queue.push(neighbour)
        }
      }
    }
    components.push(component)
  }
  return components
}

function patchesOf(mesh: EditMesh, region: Set<number>, params: InsetParams): Patch[] {
  if (params.individual) {
    return [...region].map((face) => ({ faces: [face], rim: new Set(mesh.faceEdges(face)) }))
  }
  const patches: Patch[] = []
  for (const component of componentsOf(mesh, region)) {
    const rim = new Set<number>()
    for (const face of component) {
      for (const edge of mesh.faceEdges(face)) {
        if (mesh.edgeFaces(edge).filter((other) => region.has(other)).length === 1) rim.add(edge)
      }
    }
    if (rim.size === 0) {
      // Nothing borders this patch, because it is a whole closed surface: the selected faces of a
      // cube, of a sphere. There is no outside to lay one border along, so each face gets its own
      // and the mesh comes out framed, which is what the selection was asking for.
      for (const face of component) patches.push({ faces: [face], rim: new Set(mesh.faceEdges(face)) })
      continue
    }
    // “Boundary” off leaves the open edge of a mesh alone: the border stops where the surface does.
    if (!params.boundary) for (const edge of [...rim]) if (mesh.edgeFaces(edge).length < 2) rim.delete(edge)
    if (rim.size > 0) patches.push({ faces: component, rim })
  }
  return patches
}

/* ----------------------------------------------------------------- planning */

function planPatch(mesh: EditMesh, patch: Patch, params: InsetParams): Plan {
  const inPatch = new Set(patch.faces)
  const constraints = new Map<number, Array<{ normal: Vec3; distance: number }>>()
  const normals = new Map<number, Vec3>()
  for (const edge of patch.rim) {
    const face = mesh.edgeFaces(edge).find((candidate) => inPatch.has(candidate))
    if (face === undefined) continue
    const [a, b] = mesh.edgeVertices(edge)
    if (a < 0 || b < 0) continue
    const relative = params.offsetRelative ? faceScale(mesh, face) : 1
    const distance = params.thickness * relative * (params.outset ? -1 : 1)
    for (const vertex of [a, b]) {
      const other = vertex === a ? b : a
      const list = constraints.get(vertex) ?? []
      list.push({ normal: inwardNormal(mesh, face, vertex, other), distance })
      constraints.set(vertex, list)
    }
  }
  for (const face of patch.faces) {
    const normal = mesh.faceNormal(face)
    for (const vertex of mesh.faceVertices(face)) {
      normals.set(vertex, add(normals.get(vertex) ?? [0, 0, 0], normal))
    }
  }
  const moves = new Map<number, Vec3>()
  const slides = new Map<number, Vec3>()
  for (const [vertex, list] of constraints) {
    let move = offsetCorner(list)
    if (!params.offsetEven) {
      // Even off is Blender's plain bisector: the same direction, walked exactly the thickness.
      const wanted = list.reduce((total, row) => total + Math.abs(row.distance), 0) / list.length
      const size = length(move)
      if (size > TINY) move = scale(move, wanted / size)
    }
    const along = params.depth === 0 ? [0, 0, 0] as Vec3 : scale(normalize(normals.get(vertex) ?? [0, 0, 1]), params.depth)
    const here = mesh.position(vertex)
    if (params.outset) {
      // Outsetting is the same ring the other way about: the rim the region already had is where
      // the new one is minted, and the old vertex — which the faces around the region hold on to —
      // is the one that travels, so the region keeps its size and the border grows outside it.
      slides.set(vertex, add(here, move))
      moves.set(vertex, add(here, along))
      continue
    }
    moves.set(vertex, add(here, add(move, along)))
  }
  const interior = new Map<number, Vec3>()
  if (params.depth !== 0) {
    for (const [vertex, normal] of normals) {
      if (moves.has(vertex)) continue
      interior.set(vertex, add(mesh.position(vertex), scale(normalize(normal), params.depth)))
    }
  }
  const loops = new Map<number, number[]>()
  const border: Plan['border'] = []
  const edges = new Set<number>()
  for (const face of patch.faces) {
    const loop = mesh.faceVertices(face)
    loops.set(face, loop)
    for (const edge of mesh.faceEdges(face)) edges.add(edge)
    for (let index = 0; index < loop.length; index += 1) {
      const from = loop[index]!
      const to = loop[(index + 1) % loop.length]!
      if (patch.rim.has(mesh.edgeSlot(from, to))) border.push({ face, from, to })
    }
  }
  return { faces: patch.faces, loops, moves, slides, interior, border, edges: [...edges] }
}

/* ------------------------------------------------------------- the mutation */

function applyPlan(mesh: EditMesh, plan: Plan, inner: number[], outer: number[]): void {
  const minted = new Map<number, number>()
  for (const [vertex, point] of plan.moves) minted.set(vertex, mesh.addVertex(point))
  for (const [vertex, point] of plan.slides) mesh.setPosition(vertex, point)
  for (const [vertex, point] of plan.interior) mesh.setPosition(vertex, point)
  for (const face of plan.faces) {
    const loop = plan.loops.get(face) ?? []
    mesh.setFaceLoop(face, loop.map((vertex) => minted.get(vertex) ?? vertex))
    inner.push(mesh.faceId(face))
  }
  for (const { face, from, to } of plan.border) {
    const start = minted.get(from)
    const end = minted.get(to)
    if (start === undefined || end === undefined) continue
    // Walked the way the face's own loop runs, so the border faces the same way the face does.
    const added = mesh.addFace([from, to, end, start])
    if (added < 0) continue
    mesh.copyFaceAttributes(face, added)
    outer.push(mesh.faceId(added))
  }
}

/* ------------------------------------------------------------- the operator */

function insetFaces(target: EditTarget, params: InsetParams): EditOutcome {
  const mesh = target.mesh
  if (target.faces.size === 0) return null
  const patches = patchesOf(mesh, new Set(target.faces), params)
  if (patches.length === 0) return null
  const plans = patches.map((patch) => planPatch(mesh, patch, params))
  const inner: number[] = []
  const outer: number[] = []
  const touched = new Set<number>()
  for (const plan of plans) for (const edge of plan.edges) touched.add(edge)
  for (const plan of plans) applyPlan(mesh, plan, inner, outer)
  // A seam inside a region is used by nothing once both its faces have pulled back off it.
  const dead = [...touched].filter((edge) => mesh.edgeFaces(edge).length === 0)
  if (dead.length > 0) mesh.remove({ edges: dead })
  const chosen = (params.selectOuter ? outer : inner)
    .map((id) => mesh.slotOfFace(id))
    .filter((slot) => slot >= 0)
  return { select: { faces: chosen } }
}

registerOperator<InsetParams>({
  id: 'mesh.inset',
  label: 'Inset faces',
  section: 'Face',
  shortcut: 'I',
  icon: 'inset',
  description: 'Lay a border inside the selected faces, as one region or face by face.',
  params: [
    numberParam('thickness', 'Thickness', { min: -1000, max: 1000, step: 0.01, defaultValue: 0, unit: 'm' }),
    numberParam('depth', 'Depth', { min: -1000, max: 1000, step: 0.01, defaultValue: 0, unit: 'm' }),
    switchParam('individual', 'Individual', false),
    switchParam('boundary', 'Boundary', true),
    switchParam('offsetEven', 'Offset even', true),
    switchParam('offsetRelative', 'Offset relative', false),
    switchParam('outset', 'Outset', false),
    switchParam('selectOuter', 'Select outer', false),
  ],
  defaults: {
    thickness: 0,
    depth: 0,
    individual: false,
    boundary: true,
    offsetEven: true,
    offsetRelative: false,
    outset: false,
    selectOuter: false,
  },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => runOnMeshes(context, (target) => insetFaces(target, params), { label: 'Inset faces' }),
})
