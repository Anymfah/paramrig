import { meshOf, objectById } from '@/scene/model'
import { EditMesh } from '@/scene/mesh/editMesh'
import { add, cross, dot, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { switchParam, type OperatorContext, type OperatorParams } from '@/scene/operators/types'
import { cameraDirection } from '@/scene/viewport/view'
import type { ParameterDef } from '@/rigs/types'
import type { SceneDocument, SceneObject, Transform, Vec3 } from '@/scene/types'

/**
 * Blender's knife, as a pure cut.
 *
 * K in the viewport is a gesture — a polyline drawn over the mesh, snapped to whatever is under the
 * pointer — and none of that is here. What is here is the half that has to be a function: a line, a
 * direction to look along, and the geometry that comes out. That is what the viewport calls once
 * the gesture is confirmed, and what the “Adjust last operation” panel calls to replay it, so it
 * must produce the finished cut from its parameters alone.
 *
 * The cut happens in the projection perpendicular to the view direction, because that is where the
 * line was drawn and the only place where “the line crosses this edge” means anything at all: a
 * knife line has no depth. Every crossing becomes a split of the edge it landed on — unless it
 * landed on a vertex, which is used as it is — and every face the line entered and left again is
 * cut between the two.
 *
 * A list of vectors is not something the parameter schema can describe, so the line travels through
 * the parameters as JSON: `path` reads `[[x, y, z], …]`, in world metres, in the order it was drawn.
 */

/* ------------------------------------------------------------ the object's frame */

/**
 * Where an object's geometry sits in the world: the linear map and the offset that take a point out
 * of the mesh's own space.
 *
 * The knife is handed a line in world metres and cuts a mesh whose vertices are written in the
 * object's space, so one of the two has to move. `@/scene/objects` answers the same question with a
 * three.js matrix; a mesh operator stays clear of three.js, so the composition is written out here
 * as the three columns of the map and the point it lands the origin on. It lives in this file until
 * a third family wants it, and `bisect.ts` — which has a plane to move the same way — imports it.
 */
export type ObjectFrame = { columns: [Vec3, Vec3, Vec3]; translation: Vec3 }

const IDENTITY_COLUMNS: [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

function rotationColumns(transform: Transform): [Vec3, Vec3, Vec3] {
  if (transform.rotationMode === 'quaternion' && transform.quaternion) {
    const [x, y, z, w] = transform.quaternion
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
      [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
      [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
    ]
  }
  // An Euler order names its rotations left to right, and they compose in that order.
  const order = transform.rotationMode && transform.rotationMode !== 'quaternion' ? transform.rotationMode : 'XYZ'
  let columns = IDENTITY_COLUMNS
  for (const axis of order) {
    const angle = ((axis === 'X' ? transform.rotation[0] : axis === 'Y' ? transform.rotation[1] : transform.rotation[2]) * Math.PI) / 180
    columns = multiplyColumns(columns, axisColumns(axis, angle))
  }
  return columns
}

function axisColumns(axis: string, angle: number): [Vec3, Vec3, Vec3] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  if (axis === 'X') return [[1, 0, 0], [0, c, s], [0, -s, c]]
  if (axis === 'Y') return [[c, 0, -s], [0, 1, 0], [s, 0, c]]
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]]
}

function multiplyColumns(left: [Vec3, Vec3, Vec3], right: [Vec3, Vec3, Vec3]): [Vec3, Vec3, Vec3] {
  const apply = (v: Vec3): Vec3 => add(add(scale(left[0], v[0]), scale(left[1], v[1])), scale(left[2], v[2]))
  return [apply(right[0]), apply(right[1]), apply(right[2])]
}

/** One object's own frame, its origin offset folded into the translation. */
function localFrame(object: SceneObject): ObjectFrame {
  const rotation = rotationColumns(object.transform)
  const [sx, sy, sz] = object.transform.scale
  // A scale of zero would make the map singular and nothing could be carried back through it.
  const columns: [Vec3, Vec3, Vec3] = [
    scale(rotation[0], sx || 1e-6),
    scale(rotation[1], sy || 1e-6),
    scale(rotation[2], sz || 1e-6),
  ]
  const origin = object.origin ?? [0, 0, 0]
  const shift = add(add(scale(columns[0], origin[0]), scale(columns[1], origin[1])), scale(columns[2], origin[2]))
  return { columns, translation: subtract(object.transform.position, shift) }
}

/** An object's frame with every parent above it applied, which is where its geometry really is. */
export function objectFrame(document: SceneDocument, object: SceneObject): ObjectFrame {
  let frame = localFrame(object)
  let parent = object.parentId ? objectById(document, object.parentId) : null
  const seen = new Set<string>([object.id])
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id)
    const above = localFrame(parent)
    frame = {
      columns: multiplyColumns(above.columns, frame.columns),
      translation: add(applyColumns(above.columns, frame.translation), above.translation),
    }
    parent = parent.parentId ? objectById(document, parent.parentId) : null
  }
  return frame
}

function applyColumns(columns: [Vec3, Vec3, Vec3], v: Vec3): Vec3 {
  return add(add(scale(columns[0], v[0]), scale(columns[1], v[1])), scale(columns[2], v[2]))
}

/** The rows of the inverse map, by the adjugate; null for a frame nothing can be carried back through. */
function inverseRows(frame: ObjectFrame): [Vec3, Vec3, Vec3] | null {
  const [c0, c1, c2] = frame.columns
  const determinant = dot(c0, cross(c1, c2))
  if (Math.abs(determinant) < 1e-18) return null
  return [
    scale(cross(c1, c2), 1 / determinant),
    scale(cross(c2, c0), 1 / determinant),
    scale(cross(c0, c1), 1 / determinant),
  ]
}

export function worldPoint(frame: ObjectFrame, point: Vec3): Vec3 {
  return add(applyColumns(frame.columns, point), frame.translation)
}

export function localPoint(frame: ObjectFrame, point: Vec3): Vec3 {
  const rows = inverseRows(frame)
  if (!rows) return point
  const offset = subtract(point, frame.translation)
  return [dot(rows[0], offset), dot(rows[1], offset), dot(rows[2], offset)]
}

/**
 * A direction carried into the object's space. A direction is a difference of two points, so it
 * goes through the inverse map — which is not what a plane's normal does, three lines below.
 */
export function localDirection(frame: ObjectFrame, direction: Vec3): Vec3 {
  const rows = inverseRows(frame)
  if (!rows) return normalize(direction)
  return normalize([dot(rows[0], direction), dot(rows[1], direction), dot(rows[2], direction)])
}

/**
 * A plane's normal carried into the object's space. `dot(p − q, n)` has to keep its sign, and
 * substituting the map into it leaves the transpose behind — so a normal is multiplied by the scale
 * where a direction is divided by it. The two coincide only when the scale is uniform.
 */
export function localNormal(frame: ObjectFrame, normal: Vec3): Vec3 {
  const [c0, c1, c2] = frame.columns
  return normalize([dot(c0, normal), dot(c1, normal), dot(c2, normal)])
}

/* ---------------------------------------------------------------- the projection */

type Point2 = [number, number]

/** The plane the line was drawn on: two axes across the view, and the direction through it. */
type Frame = { u: Vec3; v: Vec3; direction: Vec3 }

/** How close to an existing vertex a crossing lands before it uses that vertex rather than a new one. */
const SNAP_FRACTION = 1e-4

/** Under this share of the mesh's projection, a face is edge-on to the view and has nothing to cut. */
const FLAT_AREA_FRACTION = 1e-9

const NEEDS_DIRECTION = 'The knife needs a direction to look along.'
const NEEDS_TWO_POINTS = 'The knife line needs at least two points.'
const NO_FACE = 'The knife line crosses no face; draw it across the geometry to cut it.'
const STOPS_INSIDE = 'The knife line stops inside a face; take it right across the face to cut it.'
const TURNED_AWAY = 'Every face here is turned away from the view; switch on cut through to cut them.'
const ALONG_AN_EDGE = 'The knife line runs along an edge, so there is nothing to cut.'

function projectionFrame(direction: Vec3): Frame | null {
  const forward = normalize(direction)
  if (length(forward) === 0) return null
  // Any axis that is not the view itself gives a first tangent; the second follows from the two.
  const seed: Vec3 = Math.abs(forward[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = normalize(cross(seed, forward))
  return { u, v: cross(forward, u), direction: forward }
}

function project(point: Vec3, frame: Frame): Point2 {
  return [dot(point, frame.u), dot(point, frame.v)]
}

function fromFrame(u: number, v: number, alongView: number, frame: Frame): Vec3 {
  return add(add(scale(frame.u, u), scale(frame.v, v)), scale(frame.direction, alongView))
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function signedArea(loop: Point2[]): number {
  let total = 0
  for (let index = 0; index < loop.length; index += 1) {
    const here = loop[index]!
    const next = loop[(index + 1) % loop.length]!
    total += here[0] * next[1] - next[0] * here[1]
  }
  return total / 2
}

function contains(loop: Point2[], point: Point2): boolean {
  let inside = false
  for (let index = 0; index < loop.length; index += 1) {
    const here = loop[index]!
    const next = loop[(index + 1) % loop.length]!
    const straddles = here[1] > point[1] !== next[1] > point[1]
    if (!straddles) continue
    const span = next[1] - here[1]
    if (span === 0) continue
    if (point[0] < here[0] + ((point[1] - here[1]) / span) * (next[0] - here[0])) inside = !inside
  }
  return inside
}

/**
 * Where two segments meet, as the share along each of them, or null when they run parallel or miss.
 * The denominator is compared against the lengths it came from, so the test means the same thing on
 * a mesh a millimetre across as on one a kilometre across.
 */
function segmentCross(p: Point2, q: Point2, a: Point2, b: Point2): { along: number; t: number } | null {
  const rx = q[0] - p[0]
  const ry = q[1] - p[1]
  const sx = b[0] - a[0]
  const sy = b[1] - a[1]
  const denominator = rx * sy - ry * sx
  if (Math.abs(denominator) <= 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null
  const dx = a[0] - p[0]
  const dy = a[1] - p[1]
  const along = (dx * sy - dy * sx) / denominator
  const t = (dx * ry - dy * rx) / denominator
  if (along < 0 || along > 1 || t < 0 || t > 1) return null
  return { along, t }
}

/* -------------------------------------------------------------------- the cut */

/** Where the line meets the rim of a face: a corner it went through, or a point along an edge. */
type Crossing =
  | { kind: 'vertex'; along: number; vertex: number }
  | { kind: 'edge'; along: number; a: number; b: number; t: number }

/** The same point, named by vertex ids, so that it survives the splits that come before it. */
type Anchor = { kind: 'vertex'; id: number } | { kind: 'edge'; a: number; b: number; t: number }

export type KnifeCut = {
  /** The line, in the mesh's own space, in the order it was drawn. */
  path: Vec3[]
  /** What it was drawn looking along; the projection it is cut in is perpendicular to this. */
  direction: Vec3
  /** Cut the faces turned away from the view as well as the ones facing it. */
  cutThrough: boolean
  /** Where two faces overlap, cut only the front-most one. Meaningless while cutting through. */
  occlude?: boolean
  /** Put every crossing that is not on a vertex at the middle of the edge it crosses. */
  midpointSnap?: boolean
  /** Turn each leg of the line to the nearest multiple of 45°, in the projection. */
  angleConstrain?: boolean
}

/**
 * Cuts a mesh along a line, and answers the vertices the cut runs through and the edges it drew —
 * which is what the viewport highlights and what the operator leaves selected.
 *
 * A refusal is a sentence. It is decided before anything is cut, with one exception: a line whose
 * every crossing turns out to lie on one edge of a face is only known to cut nothing once the edges
 * have been split, and the mesh is left with those splits in it. `runOnMeshes` throws a refused
 * target's mesh away, so the document never sees them, and a caller working on a mesh of its own
 * should do the same.
 */
export function knifeCut(mesh: EditMesh, cut: KnifeCut): { vertices: number[]; edges: number[] } | string {
  const frame = projectionFrame(cut.direction)
  if (!frame) return NEEDS_DIRECTION
  const drawn = cut.angleConstrain === true ? constrainAngles(cut.path, frame) : cut.path
  const line: Point2[] = []
  for (const point of drawn) {
    const flat = project(point, frame)
    const last = line[line.length - 1]
    if (!last || distance(last, flat) > 0) line.push(flat)
  }
  if (line.length < 2) return NEEDS_TWO_POINTS

  const projected: Point2[] = []
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const flat = project(mesh.position(slot), frame)
    projected.push(flat)
    minU = Math.min(minU, flat[0])
    maxU = Math.max(maxU, flat[0])
    minV = Math.min(minV, flat[1])
    maxV = Math.max(maxV, flat[1])
  }
  const reach = mesh.vertexCount > 0 ? Math.max(Math.hypot(maxU - minU, maxV - minV), 1e-9) : 1
  const tolerance = reach * SNAP_FRACTION

  const candidates: number[] = []
  let turnedAway = 0
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    if (loop.length < 3) continue
    // A face seen edge-on projects to a line: there is no inside of it for the cut to run through.
    if (Math.abs(signedArea(loop.map((slot) => projected[slot]!))) <= reach * reach * FLAT_AREA_FRACTION) continue
    if (!cut.cutThrough && dot(mesh.faceNormal(face), frame.direction) >= 0) {
      turnedAway += 1
      continue
    }
    candidates.push(face)
  }
  if (candidates.length === 0) return turnedAway > 0 ? TURNED_AWAY : NO_FACE

  let stopped = false
  let plans: Array<{ face: number; crossings: Crossing[] }> = []
  for (const face of candidates) {
    const crossings = faceCrossings(mesh, face, projected, line, tolerance, cut.midpointSnap === true)
    if (crossings.length % 2 === 1) stopped = true
    if (crossings.length < 2) continue
    plans.push({ face, crossings })
  }
  if (!cut.cutThrough && cut.occlude !== false) plans = frontMost(mesh, projected, plans, frame)
  if (plans.length === 0) return stopped ? STOPS_INSIDE : NO_FACE

  return applyCut(mesh, plans)
}

/** Every crossing of one face's rim, in the order the line meets them. */
function faceCrossings(
  mesh: EditMesh,
  face: number,
  projected: Point2[],
  line: Point2[],
  tolerance: number,
  midpointSnap: boolean,
): Crossing[] {
  const loop = mesh.faceVertices(face)
  const found: Crossing[] = []
  const seen = new Set<string>()
  for (let corner = 0; corner < loop.length; corner += 1) {
    const a = loop[corner]!
    const b = loop[(corner + 1) % loop.length]!
    const from = projected[a]!
    const to = projected[b]!
    for (let step = 0; step + 1 < line.length; step += 1) {
      const hit = segmentCross(line[step]!, line[step + 1]!, from, to)
      if (!hit) continue
      const along = step + hit.along
      const point: Point2 = [from[0] + (to[0] - from[0]) * hit.t, from[1] + (to[1] - from[1]) * hit.t]
      // A crossing that lands on a corner uses it: the knife should not leave two vertices a
      // millionth of a metre apart where a person aimed at one.
      const crossing: Crossing = distance(point, from) <= tolerance
        ? { kind: 'vertex', along, vertex: a }
        : distance(point, to) <= tolerance
          ? { kind: 'vertex', along, vertex: b }
          : { kind: 'edge', along, a, b, t: midpointSnap ? 0.5 : hit.t }
      // Two edges of the face meet at a corner, so a line through one is found twice.
      const key = crossing.kind === 'vertex'
        ? `v${crossing.vertex}`
        : `e${Math.min(crossing.a, crossing.b)}|${Math.max(crossing.a, crossing.b)}|${crossing.t.toFixed(9)}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push(crossing)
    }
  }
  return found.sort((a, b) => a.along - b.along)
}

/**
 * The plans left once the faces hidden behind another are dropped, which is Blender's “occlude
 * geometry”. A cut's middle is carried along the view onto every other candidate face; landing on
 * one of them on the camera's side of where it started means this face is behind that one.
 */
function frontMost(
  mesh: EditMesh,
  projected: Point2[],
  plans: Array<{ face: number; crossings: Crossing[] }>,
  frame: Frame,
): Array<{ face: number; crossings: Crossing[] }> {
  if (plans.length < 2) return plans
  const loops = new Map<number, Point2[]>()
  for (const plan of plans) loops.set(plan.face, mesh.faceVertices(plan.face).map((slot) => projected[slot]!))
  return plans.filter((plan) => {
    const middle = cutMiddle(mesh, plan.crossings)
    if (!middle) return true
    return !plans.some((other) => other !== plan && hides(mesh, loops.get(other.face) ?? [], other.face, middle, frame))
  })
}

/** Where the first cut of a face runs through, in three dimensions: the middle of its first chord. */
function cutMiddle(mesh: EditMesh, crossings: Crossing[]): Vec3 | null {
  const first = crossings[0]
  const second = crossings[1]
  if (!first || !second) return null
  return scale(add(crossingPoint(mesh, first), crossingPoint(mesh, second)), 0.5)
}

function crossingPoint(mesh: EditMesh, crossing: Crossing): Vec3 {
  if (crossing.kind === 'vertex') return mesh.position(crossing.vertex)
  const from = mesh.position(crossing.a)
  const to = mesh.position(crossing.b)
  return add(from, scale(subtract(to, from), crossing.t))
}

/** Whether a face stands between the point and the camera, along the view. */
function hides(mesh: EditMesh, loop: Point2[], face: number, point: Vec3, frame: Frame): boolean {
  const normal = mesh.faceNormal(face)
  const facing = dot(frame.direction, normal)
  if (Math.abs(facing) < 1e-9) return false
  if (!contains(loop, project(point, frame))) return false
  // Negative means the face is met going backwards along the view, which is towards the camera.
  return dot(subtract(mesh.faceCentre(face), point), normal) / facing < -1e-9
}

/** Turns each leg of the line to the nearest multiple of 45° in the projection, as C does. */
function constrainAngles(path: Vec3[], frame: Frame): Vec3[] {
  if (path.length < 2) return path
  const step = Math.PI / 4
  const constrained: Vec3[] = [path[0]!]
  for (let index = 1; index < path.length; index += 1) {
    const previous = project(constrained[index - 1]!, frame)
    const current = project(path[index]!, frame)
    const du = current[0] - previous[0]
    const dv = current[1] - previous[1]
    const reach = Math.hypot(du, dv)
    const angle = Math.round(Math.atan2(dv, du) / step) * step
    constrained.push(fromFrame(
      previous[0] + Math.cos(angle) * reach,
      previous[1] + Math.sin(angle) * reach,
      dot(path[index]!, frame.direction),
      frame,
    ))
  }
  return constrained
}

/**
 * Splits every edge the line crossed, then cuts every face between the points it entered and left
 * by. The two halves are separate passes because a split renumbers the edges: everything is named
 * by vertex id in between, and resolved back to a slot only when it is about to be used.
 */
function applyCut(
  mesh: EditMesh,
  plans: Array<{ face: number; crossings: Crossing[] }>,
): { vertices: number[]; edges: number[] } | string {
  const anchored = plans.map((plan) => ({
    faceId: mesh.faceId(plan.face),
    anchors: plan.crossings.map((crossing) => anchorOf(mesh, crossing)),
  }))

  const groups = new Map<string, { a: number; b: number; ts: number[]; made: number[] }>()
  for (const plan of anchored) {
    for (const anchor of plan.anchors) {
      if (anchor.kind !== 'edge') continue
      const key = `${anchor.a}|${anchor.b}`
      const group = groups.get(key) ?? { a: anchor.a, b: anchor.b, ts: [], made: [] }
      if (!group.ts.some((t) => Math.abs(t - anchor.t) < 1e-9)) group.ts.push(anchor.t)
      groups.set(key, group)
    }
  }
  for (const group of groups.values()) group.ts.sort((a, b) => a - b)

  const made = new Map<string, number>()
  for (let round = 0; ; round += 1) {
    const cuts: Array<{ edge: number; t: number }> = []
    const rows: Array<{ key: string; group: { a: number; b: number; ts: number[]; made: number[] } }> = []
    for (const [key, group] of groups) {
      const t = group.ts[round]
      if (t === undefined) continue
      // Each further crossing of one edge sits on the piece the last one left behind.
      const startId = round === 0 ? group.a : group.made[round - 1]
      const consumed = round === 0 ? 0 : group.ts[round - 1]!
      if (startId === undefined || consumed >= 1) continue
      const from = mesh.slotOfVertex(startId)
      const to = mesh.slotOfVertex(group.b)
      if (from < 0 || to < 0) continue
      const edge = mesh.edgeSlot(from, to)
      if (edge < 0) continue
      const local = (t - consumed) / (1 - consumed)
      // A split runs from the lower of the two slots, whichever way round the pair was named.
      cuts.push({ edge, t: from < to ? local : 1 - local })
      rows.push({ key, group })
    }
    if (cuts.length === 0) break
    const slots = mesh.splitEdges(cuts)
    for (let index = 0; index < rows.length; index += 1) {
      const slot = slots[index]
      const row = rows[index]!
      if (slot === undefined) continue
      const id = mesh.vertexId(slot)
      row.group.made[round] = id
      made.set(`${row.key}|${row.group.ts[round]!.toFixed(9)}`, id)
    }
  }

  const vertices = new Set<number>()
  const edges: number[] = []
  for (const plan of anchored) {
    const start = mesh.slotOfFace(plan.faceId)
    if (start < 0) continue
    const parts = [start]
    for (let index = 0; index + 1 < plan.anchors.length; index += 2) {
      const a = anchorSlot(mesh, plan.anchors[index]!, made)
      const b = anchorSlot(mesh, plan.anchors[index + 1]!, made)
      if (a < 0 || b < 0 || a === b) continue
      const host = parts.find((face) => {
        const loop = mesh.faceVertices(face)
        return loop.includes(a) && loop.includes(b)
      })
      if (host === undefined) continue
      const added = mesh.splitFace(host, a, b)
      if (added < 0) continue
      parts.push(added)
      vertices.add(a)
      vertices.add(b)
      const edge = mesh.edgeSlot(a, b)
      if (edge >= 0) edges.push(edge)
    }
  }
  if (edges.length === 0) return ALONG_AN_EDGE
  return { vertices: [...vertices], edges }
}

function anchorOf(mesh: EditMesh, crossing: Crossing): Anchor {
  if (crossing.kind === 'vertex') return { kind: 'vertex', id: mesh.vertexId(crossing.vertex) }
  const a = mesh.vertexId(crossing.a)
  const b = mesh.vertexId(crossing.b)
  // One key per edge whichever face named it, with the share measured from the lower id.
  return a < b ? { kind: 'edge', a, b, t: crossing.t } : { kind: 'edge', a: b, b: a, t: 1 - crossing.t }
}

function anchorSlot(mesh: EditMesh, anchor: Anchor, made: Map<string, number>): number {
  if (anchor.kind === 'vertex') return mesh.slotOfVertex(anchor.id)
  const id = made.get(`${anchor.a}|${anchor.b}|${anchor.t.toFixed(9)}`)
  return id === undefined ? -1 : mesh.slotOfVertex(id)
}

/* --------------------------------------------------------------- the operators */

/**
 * A text field. `operators/types.ts` has a helper for every parameter kind the families before this
 * one needed, and none for text, because none of them asked for one. The knife's line and the list
 * of objects to project are both text, so the helper lives here until it earns a move.
 */
function textParam(id: string, label: string, defaultValue: string, maxLength = 4000): ParameterDef {
  return { kind: 'text', id, label, group: 'operator', defaultValue, maxLength }
}

const PATH = textParam('path', 'Line', '[]')
const OBJECTS = textParam('objectIds', 'Objects', '[]', 2000)

type KnifeParams = OperatorParams & {
  path: string
  cutThrough: boolean
  occlude: boolean
  midpointSnap: boolean
  angleConstrain: boolean
}

type KnifeProjectParams = OperatorParams & { objectIds: string; cutThrough: boolean }

/** The line as the parameter carries it: `[[x, y, z], …]`, in world metres, in the order drawn. */
function parsePath(source: unknown): Vec3[] | string {
  const read = parseJson(source)
  if ('error' in read) return read.error
  const raw = read.value
  if (!Array.isArray(raw)) return 'The knife line reads [[x, y, z], …], a list of points.'
  const path: Vec3[] = []
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 3) return 'Every point of the knife line needs three numbers.'
    const [x, y, z] = entry as unknown[]
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
      return 'Every point of the knife line needs three numbers.'
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return 'Every point of the knife line needs three numbers.'
    }
    path.push([x, y, z])
  }
  return path
}

function parseIds(source: unknown): string[] | string {
  const read = parseJson(source)
  if ('error' in read) return read.error
  const raw = read.value
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
    return 'The objects to project read ["object-id", …], a list of names.'
  }
  return raw as string[]
}

/** Answered as one or the other rather than as a union, or a parsed string would read as a refusal. */
function parseJson(source: unknown): { value: unknown } | { error: string } {
  if (typeof source !== 'string') return { error: 'That parameter reads as JSON text.' }
  try {
    return { value: JSON.parse(source || 'null') as unknown }
  } catch {
    return { error: 'That parameter is not valid JSON.' }
  }
}

function viewDirection(context: OperatorContext): Vec3 {
  return cameraDirection(context.view.yaw, context.view.pitch)
}

/** One target's cut, with the line and the view carried into the mesh's own space first. */
function cutTarget(
  context: OperatorContext,
  target: EditTarget,
  paths: Vec3[][],
  options: { cutThrough: boolean; occlude: boolean; midpointSnap: boolean; angleConstrain: boolean },
): { vertices: number[]; edges: number[] } | string {
  const frame = objectFrame(context.document, target.object)
  const direction = localDirection(frame, viewDirection(context))
  const vertices = new Set<number>()
  const edges = new Set<number>()
  let refusal = ''
  for (const path of paths) {
    const outcome = knifeCut(target.mesh, {
      path: path.map((point) => localPoint(frame, point)),
      direction,
      cutThrough: options.cutThrough,
      occlude: options.occlude,
      midpointSnap: options.midpointSnap,
      angleConstrain: options.angleConstrain,
    })
    if (typeof outcome === 'string') {
      if (!refusal) refusal = outcome
      continue
    }
    for (const slot of outcome.vertices) vertices.add(slot)
    for (const slot of outcome.edges) edges.add(slot)
  }
  if (vertices.size === 0) return refusal || NO_FACE
  return { vertices: [...vertices], edges: [...edges] }
}

registerOperator<KnifeParams>({
  id: 'mesh.knife',
  label: 'Knife',
  section: 'Mesh',
  shortcut: 'K',
  icon: 'knife',
  description: 'Cut every face a drawn line crosses, splitting the edges it passes through.',
  params: [
    PATH,
    switchParam('cutThrough', 'Cut through', false),
    switchParam('occlude', 'Occlude geometry', true),
    switchParam('midpointSnap', 'Snap to midpoints', false),
    switchParam('angleConstrain', 'Angle constrain', false),
  ],
  defaults: { path: '[]', cutThrough: false, occlude: true, midpointSnap: false, angleConstrain: false },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => {
    const path = parsePath(params.path)
    if (typeof path === 'string') return { error: path }
    if (path.length < 2) return { error: NEEDS_TWO_POINTS }
    return runOnMeshes(context, (target) => {
      const outcome = cutTarget(context, target, [path], {
        cutThrough: params.cutThrough,
        occlude: params.occlude,
        midpointSnap: params.midpointSnap,
        angleConstrain: params.angleConstrain,
      })
      if (typeof outcome === 'string') return outcome
      return { select: { vertices: outcome.vertices, edges: outcome.edges } }
    }, { label: 'Knife' })
  },
})

/* ------------------------------------------------------------- knife project */

/**
 * The outline of a mesh as the view sees it: every edge with a face turned towards the view on one
 * side and away on the other, plus the rim of an open mesh. It is the silhouette an edge at a time
 * rather than an outline in one piece — the union of the projected faces would be the whole truth,
 * and needs a polygon library this editor has not got — so a mesh that folds over itself projects
 * its inner folds as well as its outline. Both are cuts Blender would also make.
 */
function silhouetteChains(mesh: EditMesh, direction: Vec3): number[][] {
  const facing: boolean[] = []
  for (let face = 0; face < mesh.faceCount; face += 1) facing.push(dot(mesh.faceNormal(face), direction) < 0)
  const links = new Map<number, number[]>()
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    const faces = mesh.edgeFaces(edge)
    if (faces.length === 0) continue
    const front = faces.filter((face) => facing[face] === true).length
    if (faces.length > 1 && (front === 0 || front === faces.length)) continue
    const [a, b] = mesh.edgeVertices(edge)
    if (a < 0 || b < 0) continue
    links.set(a, [...(links.get(a) ?? []), b])
    links.set(b, [...(links.get(b) ?? []), a])
  }
  const used = new Set<string>()
  const key = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const ends = [...links.keys()].filter((vertex) => (links.get(vertex) ?? []).length !== 2)
  const chains: number[][] = []
  for (const start of [...ends, ...links.keys()]) {
    for (const first of links.get(start) ?? []) {
      if (used.has(key(start, first))) continue
      const walk = [start]
      let from = start
      let to = first
      for (;;) {
        used.add(key(from, to))
        walk.push(to)
        if (to === start) break
        const onward = (links.get(to) ?? []).find((next) => !used.has(key(to, next)))
        if (onward === undefined) break
        from = to
        to = onward
      }
      if (walk.length >= 2) chains.push(walk)
    }
  }
  return chains
}

/** Every mesh that could be projected: the selected objects that are not the ones being edited. */
function projectableObjects(context: OperatorContext, wanted: string[] = []): SceneObject[] {
  const editing = new Set(context.selection.editObjectIds ?? [])
  return context.document.objects.filter((object) => {
    if (object.data.kind !== 'mesh' || editing.has(object.id)) return false
    if (wanted.length > 0) return wanted.includes(object.id)
    return context.selection.objectIds.includes(object.id)
  })
}

const NO_SOURCE = 'Select another object to project onto this one.'

registerOperator<KnifeProjectParams>({
  id: 'mesh.knifeProject',
  label: 'Knife project',
  section: 'Mesh',
  shortcut: '⇧K',
  icon: 'knife',
  description: 'Cut this mesh along the outline the other selected objects cast through the view.',
  params: [OBJECTS, switchParam('cutThrough', 'Cut through', false)],
  defaults: { objectIds: '[]', cutThrough: false },
  mode: 'edit',
  available: (context) => {
    const edit = requireEdit(context)
    if (edit !== true) return edit
    return projectableObjects(context).length > 0 ? true : NO_SOURCE
  },
  run: (context, params) => {
    const wanted = parseIds(params.objectIds)
    if (typeof wanted === 'string') return { error: wanted }
    const sources = projectableObjects(context, wanted)
    if (sources.length === 0) return { error: NO_SOURCE }
    const direction = viewDirection(context)
    const paths: Vec3[][] = []
    for (const source of sources) {
      const data = meshOf(context.document, source)
      if (!data) continue
      const mesh = EditMesh.from(data)
      const frame = objectFrame(context.document, source)
      for (const chain of silhouetteChains(mesh, localDirection(frame, direction))) {
        paths.push(chain.map((slot) => worldPoint(frame, mesh.position(slot))))
      }
    }
    if (paths.length === 0) return { error: 'Those objects cast no outline through this view.' }
    return runOnMeshes(context, (target) => {
      const outcome = cutTarget(context, target, paths, {
        cutThrough: params.cutThrough,
        occlude: true,
        midpointSnap: false,
        angleConstrain: false,
      })
      if (typeof outcome === 'string') return outcome
      return { select: { vertices: outcome.vertices, edges: outcome.edges } }
    }, { label: 'Knife project' })
  },
})
