import { dot, length, newellNormal, normalize, scale, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, selectedVertices, type EditTarget } from '@/scene/operators/edit'
import { localNormal, localPoint, objectFrame } from '@/scene/operators/knife'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam, vectorParam, type OperatorParams } from '@/scene/operators/types'
import type { EditMesh } from '@/scene/mesh/editMesh'
import type { Vec3 } from '@/scene/types'

/**
 * Bisect: one plane through the selection, and what to do with the two halves.
 *
 * It is the knife's straight cousin, and it is written apart from it because it needs no view at
 * all. Every edge that crosses the plane is split where it crosses, every face is cut between the
 * two points the plane entered and left it by, and what is left is a mesh with a seam running
 * exactly along the plane. From there, `fill` closes that seam with an n-gon and `clearInner` and
 * `clearOuter` throw away one side or the other — the three of them together being how a person
 * chops a model in half and keeps it watertight.
 *
 * The plane arrives in world metres, because that is what the panel shows and what a gizmo would
 * drag; it is carried into the mesh's own space here. A point and a normal do not move the same
 * way under a scale, which is why `knife.ts` offers two functions for it rather than one.
 */

const NEEDS_NORMAL = 'The plane needs a normal that is not zero.'
const MISSES = 'The plane misses the mesh; move it so that it crosses the geometry.'
const NOTHING_SELECTED = 'Nothing is selected.'

export type BisectPlane = { point: Vec3; normal: Vec3 }

export type BisectOptions = {
  /** Close the seam the cut leaves with an n-gon. */
  fill: boolean
  /** Remove the faces behind the plane, on the side the normal points away from. */
  clearInner: boolean
  /** Remove the faces in front of the plane. */
  clearOuter: boolean
  /** How far from the plane a vertex still counts as being on it, in metres. */
  threshold: number
}

/**
 * Cuts a set of faces along a plane, and answers the vertices left sitting on it and the edges the
 * cut drew — which is what the operator leaves selected. A plane that touches nothing refuses, and
 * refuses before anything has been split.
 */
export function bisectFaces(
  mesh: EditMesh,
  faceSlots: Iterable<number>,
  plane: BisectPlane,
  options: BisectOptions,
): { vertices: number[]; edges: number[] } | string {
  const normal = normalize(plane.normal)
  if (length(normal) === 0) return NEEDS_NORMAL
  const threshold = Math.max(options.threshold, 0)
  const faces: number[] = []
  for (const slot of faceSlots) if (mesh.hasFace(slot)) faces.push(slot)
  if (faces.length === 0) return NOTHING_SELECTED

  const distances: number[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    distances.push(dot(subtract(mesh.position(slot), plane.point), normal))
  }
  const sideOf = (slot: number): number => {
    const away = distances[slot] ?? 0
    return away > threshold ? 1 : away < -threshold ? -1 : 0
  }

  const cuts: Array<{ edge: number; t: number }> = []
  const measured = new Set<number>()
  for (const face of faces) {
    for (const edge of mesh.faceEdges(face)) {
      if (measured.has(edge)) continue
      measured.add(edge)
      const [a, b] = mesh.edgeVertices(edge)
      if (a < 0 || b < 0 || sideOf(a) * sideOf(b) >= 0) continue
      const from = distances[a]!
      const to = distances[b]!
      // The share of the edge is where its two distances cancel, which is where the plane is.
      cuts.push({ edge, t: from / (from - to) })
    }
  }

  const onPlane = new Set<number>()
  for (const face of faces) {
    for (const slot of mesh.faceVertices(face)) if (sideOf(slot) === 0) onPlane.add(mesh.vertexId(slot))
  }
  const faceIds = faces.map((face) => mesh.faceId(face))
  if (cuts.length === 0 && onPlane.size < 2) return MISSES

  for (const slot of mesh.splitEdges(cuts)) onPlane.add(mesh.vertexId(slot))

  const rim: Array<[number, number]> = []
  const cutFaceIds = [...faceIds]
  for (const id of faceIds) {
    const face = mesh.slotOfFace(id)
    if (face < 0) continue
    const loop = mesh.faceVertices(face)
    const corners = loop.filter((slot) => onPlane.has(mesh.vertexId(slot)))
    // Anything other than two points on the plane is not a face the plane passes through: it either
    // misses it, grazes a corner, or lies in it, and none of those is a cut.
    if (corners.length !== 2) continue
    const [a, b] = corners as [number, number]
    const apart = Math.abs(loop.indexOf(a) - loop.indexOf(b))
    rim.push([mesh.vertexId(a), mesh.vertexId(b)])
    // The two already share an edge when the plane runs along the face's rim; the seam is there.
    if (apart === 1 || apart === loop.length - 1) continue
    const added = mesh.splitFace(face, a, b)
    if (added >= 0) cutFaceIds.push(mesh.faceId(added))
  }
  if (cuts.length === 0 && rim.length === 0) return MISSES

  if (options.fill) {
    // The cap closes the side that is kept, so it faces away from the half that is thrown out.
    const capNormal = options.clearOuter ? normal : scale(normal, -1)
    for (const cycle of rimCycles(rim)) fillCycle(mesh, cycle, capNormal)
  }

  if (options.clearInner || options.clearOuter) {
    const dead = new Set<number>()
    for (const id of cutFaceIds) {
      const face = mesh.slotOfFace(id)
      if (face < 0) continue
      const side = faceSide(mesh, face, plane.point, normal, threshold)
      if ((side < 0 && options.clearInner) || (side > 0 && options.clearOuter)) dead.add(face)
    }
    if (dead.size > 0) {
      mesh.remove({ faces: dead })
      // What the cleared faces alone were holding up goes with them, as Blender's bisect does.
      mesh.dropLoose()
    }
  }

  const vertices: number[] = []
  for (const id of onPlane) {
    const slot = mesh.slotOfVertex(id)
    if (slot >= 0) vertices.push(slot)
  }
  const edges: number[] = []
  for (const [a, b] of rim) {
    const from = mesh.slotOfVertex(a)
    const to = mesh.slotOfVertex(b)
    if (from < 0 || to < 0) continue
    const edge = mesh.edgeSlot(from, to)
    if (edge >= 0) edges.push(edge)
  }
  return { vertices, edges }
}

/** Which side of the plane a face is on, read from the corner furthest away from it. */
function faceSide(mesh: EditMesh, face: number, point: Vec3, normal: Vec3, threshold: number): number {
  let furthest = 0
  for (const slot of mesh.faceVertices(face)) {
    const away = dot(subtract(mesh.position(slot), point), normal)
    if (Math.abs(away) > Math.abs(furthest)) furthest = away
  }
  return furthest > threshold ? 1 : furthest < -threshold ? -1 : 0
}

/**
 * The closed loops of the seam, as cycles of vertex ids. A seam that does not close — the plane ran
 * out at a boundary — has nothing an n-gon could fill, and is left as the open cut it is.
 */
function rimCycles(rim: Array<[number, number]>): number[][] {
  const links = new Map<number, number[]>()
  for (const [a, b] of rim) {
    if (a === b) continue
    links.set(a, [...(links.get(a) ?? []), b])
    links.set(b, [...(links.get(b) ?? []), a])
  }
  const key = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const used = new Set<string>()
  const cycles: number[][] = []
  for (const start of links.keys()) {
    for (const first of links.get(start) ?? []) {
      if (used.has(key(start, first))) continue
      const walk = [start]
      let from = start
      let to = first
      let closed = false
      for (;;) {
        used.add(key(from, to))
        if (to === start) {
          closed = true
          break
        }
        walk.push(to)
        const onward = (links.get(to) ?? []).find((next) => !used.has(key(to, next)))
        if (onward === undefined) break
        from = to
        to = onward
      }
      if (closed && walk.length >= 3) cycles.push(walk)
    }
  }
  return cycles
}

/** One n-gon across a closed seam, wound to face the way the cap should, and shaded like its rim. */
function fillCycle(mesh: EditMesh, cycle: number[], capNormal: Vec3): void {
  const slots: number[] = []
  for (const id of cycle) {
    const slot = mesh.slotOfVertex(id)
    if (slot < 0) return
    slots.push(slot)
  }
  // A plane that ran exactly along the rim of an existing face has nothing to close: filling it
  // would lay a second face on top of the first, which no later operator could tell apart.
  const corners = new Set(slots)
  for (const face of mesh.vertexFaces(slots[0]!)) {
    const loop = mesh.faceVertices(face)
    if (loop.length === corners.size && loop.every((slot) => corners.has(slot))) return
  }
  const wound = dot(newellNormal(slots.map((slot) => mesh.position(slot))), capNormal) < 0 ? [...slots].reverse() : slots
  const added = mesh.addFace(wound)
  if (added < 0) return
  const first = wound[0]!
  const second = wound[1]!
  const along = mesh.edgeSlot(first, second)
  const neighbour = along < 0 ? -1 : (mesh.edgeFaces(along).find((face) => face !== added) ?? -1)
  if (neighbour >= 0) mesh.copyFaceAttributes(neighbour, added)
}

/* ---------------------------------------------------------------- the operator */

/** The faces the cut runs on: the selected ones, or the ones every corner of which is selected. */
function targetFaces(target: EditTarget): number[] {
  if (target.faces.size > 0) return [...target.faces]
  const vertices = selectedVertices(target)
  if (vertices.size === 0) return []
  const faces: number[] = []
  for (let face = 0; face < target.mesh.faceCount; face += 1) {
    const loop = target.mesh.faceVertices(face)
    if (loop.length > 0 && loop.every((slot) => vertices.has(slot))) faces.push(face)
  }
  return faces
}

function vectorOf(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value)) return fallback
  const [x, y, z] = value as unknown[]
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return fallback
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return fallback
  return [x, y, z]
}

type BisectParams = OperatorParams & {
  planePoint: Vec3
  planeNormal: Vec3
  fill: boolean
  clearInner: boolean
  clearOuter: boolean
  threshold: number
}

registerOperator<BisectParams>({
  id: 'mesh.bisect',
  label: 'Bisect',
  section: 'Mesh',
  icon: 'bisect',
  description: 'Cut the selection along a plane, and fill or clear either side of it.',
  params: [
    vectorParam('planePoint', 'Plane point', { defaultValue: [0, 0, 0], unit: 'm' }),
    vectorParam('planeNormal', 'Plane normal', { defaultValue: [0, 0, 1], step: 0.01, view: 'direction' }),
    switchParam('fill', 'Fill', false),
    switchParam('clearInner', 'Clear inner', false),
    switchParam('clearOuter', 'Clear outer', false),
    numberParam('threshold', 'Threshold', { min: 0, max: 1, step: 0.0001, defaultValue: 0.0001, unit: 'm' }),
  ],
  defaults: {
    planePoint: [0, 0, 0],
    planeNormal: [0, 0, 1],
    fill: false,
    clearInner: false,
    clearOuter: false,
    threshold: 0.0001,
  },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const frame = objectFrame(context.document, target.object)
    const plane: BisectPlane = {
      point: localPoint(frame, vectorOf(params.planePoint, [0, 0, 0])),
      normal: localNormal(frame, vectorOf(params.planeNormal, [0, 0, 1])),
    }
    const outcome = bisectFaces(target.mesh, targetFaces(target), plane, {
      fill: params.fill,
      clearInner: params.clearInner,
      clearOuter: params.clearOuter,
      threshold: Number.isFinite(params.threshold) ? params.threshold : 0.0001,
    })
    if (typeof outcome === 'string') return outcome
    return { select: { vertices: outcome.vertices, edges: outcome.edges } }
  }, { label: 'Bisect' }),
})
