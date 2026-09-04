import { meshOf, withMesh } from '@/scene/document'
import { setVertexPosition, vertexPosition } from '@/scene/mesh/data'
import { readOnlyAdjacency } from '@/scene/mesh/adjacency'
import { EditMesh } from '@/scene/mesh/editMesh'
import { applyMatrix, IDENTITY, invert, multiply as multiplyMatrices } from '@/scene/modifiers/matrix'
import { add, cross, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import { editedObjectIds, toElements } from '@/scene/mesh/selection'
import { elementSlot } from '@/scene/operators/edit'
import { localFromWorldPoint, worldMatrix, worldPointOf } from '@/scene/objects'
import { symmetryMap } from '@/scene/operators/symmetry'
import { proportionalWeights, type FalloffKind } from '@/scene/transform/proportional'
import type { Basis } from '@/scene/transform/math'
import { curveCage, writeCagePositions } from '@/scene/curve/cage'
import type { TransformResult, TransformTarget } from '@/scene/transform/session'
import type { SceneDocument, SceneObject, SceneSelection, Vec3 } from '@/scene/types'

/**
 * What G, R and S move in edit mode.
 *
 * A transform session knows how to move targets around a pivot and nothing else; in object mode a
 * target is an object, and here it is a vertex. Everything an edge or a face does is a consequence
 * of its corners moving, so the whole of edit-mode transforming is expressed as a list of vertices
 * with their world positions, and comes back the same way.
 *
 * Two things only this module can work out. Proportional editing's weights, because the falloff is
 * measured from the *nearest selected vertex* and that is a question about a mesh. And the normal
 * orientation, because Blender's normal frame is the average normal of what is selected with the
 * active edge as its tangent — which is a question about a mesh as well.
 */

/** How near the plane two vertices have to be to count as each other's mirror, in metres. */
const SYMMETRY_TOLERANCE = 1e-4

/** A target's id: which object, and which vertex of it, by stable id. */
export function elementTargetId(objectId: string, vertexId: number): string {
  return `${objectId}|${vertexId}`
}

export function parseElementTargetId(id: string): { objectId: string; vertexId: number } | null {
  const cut = id.lastIndexOf('|')
  if (cut <= 0) return null
  const vertexId = Number(id.slice(cut + 1))
  if (!Number.isInteger(vertexId)) return null
  return { objectId: id.slice(0, cut), vertexId }
}

export type ProportionalOptions = {
  enabled: boolean
  size: number
  falloff: FalloffKind
  /** Measure the distance through the edges rather than across space, which is Blender's ⌥O. */
  connected: boolean
}

export type ElementTargets = {
  targets: TransformTarget[]
  /** The frame of the selection's average normal, for the Normal orientation. */
  normalBasis: Basis | null
  /** The median of each island of selection, for the individual-origins pivot. */
  islands: Map<string, Vec3>
}

/**
 * Every vertex a transform should move, in world space, with its share of the movement.
 *
 * A vertex that is not selected is included only when proportional editing reaches it, and then
 * with the weight the falloff gives it. A vertex selected outright always weighs one.
 */
export function elementTargets(
  document: SceneDocument,
  selection: SceneSelection,
  proportional: ProportionalOptions = { enabled: false, size: 1, falloff: 'smooth', connected: false },
): ElementTargets {
  const targets: TransformTarget[] = []
  const islands = new Map<string, Vec3>()
  const normals: Vec3[] = []
  let tangent: Vec3 | null = null
  for (const objectId of editedObjectIds(selection)) {
    const object = document.objects.find((candidate) => candidate.id === objectId)
    if (!object) continue
    // A curve is moved by its cage: the knots and the handles are the vertices, so G, R and S and
    // everything that reaches them — a typed number, the sidebar, snapping — need no second version.
    const data = object.data.kind === 'curve' ? curveCage(object.data) : meshOf(document, object)
    if (!data) continue
    // Nothing selected here means nothing to move, and asking that of the *selection* rather than
    // of the mesh is what keeps opening a hundred thousand vertices from building their adjacency
    // to find out there was nothing to do.
    const stored = selection.elements?.[objectId]
    if (!stored || (stored.vertices.length === 0 && stored.edges.length === 0 && stored.faces.length === 0)) continue
    // Read only: the targets are measured from the mesh, never written to it.
    const mesh = readOnlyAdjacency(data)
    const elements = toElements(selection, objectId)
    const chosen = new Set<number>()
    for (const id of elements.vertices) {
      const slot = mesh.slotOfVertex(id)
      if (slot >= 0) chosen.add(slot)
    }
    for (const key of elements.edges) {
      const slot = elementSlot(mesh, 'edge', key)
      if (slot < 0) continue
      for (const end of mesh.edgeVertices(slot)) if (end >= 0) chosen.add(end)
    }
    for (const id of elements.faces) {
      const slot = mesh.slotOfFace(id)
      if (slot < 0) continue
      for (const corner of mesh.faceVertices(slot)) chosen.add(corner)
    }
    if (chosen.size === 0) continue
    const matrix = worldMatrix(document, object)
    const weights = new Map<number, number>()
    for (const slot of chosen) weights.set(slot, 1)
    if (proportional.enabled && proportional.size > 0) {
      for (const [slot, weight] of reach(mesh, chosen, proportional)) {
        if (!weights.has(slot)) weights.set(slot, weight)
      }
    }
    for (const [slot, weight] of weights) {
      const world = worldPointOf(matrix, mesh.position(slot))
      targets.push({
        id: elementTargetId(objectId, mesh.vertexId(slot)),
        transform: { position: world, rotation: [0, 0, 0], scale: [1, 1, 1] },
        centre: world,
        weight,
      })
    }
    // Islands are the connected runs of what is selected: what "individual origins" turns around.
    for (const part of islandsOf(mesh, chosen)) {
      const median = mesh.median(part)
      const world = worldPointOf(matrix, median)
      for (const slot of part) islands.set(elementTargetId(objectId, mesh.vertexId(slot)), world)
    }
    // The normal frame: the average of the selected faces' normals, or of the selected vertices'
    // when no face is chosen, with the active edge as the tangent so a bevel runs the right way.
    for (const id of elements.faces) {
      const slot = mesh.slotOfFace(id)
      if (slot >= 0) normals.push(directionOf(matrix, mesh.faceNormal(slot)))
    }
    if (normals.length === 0) {
      for (const slot of chosen) normals.push(directionOf(matrix, mesh.vertexNormal(slot)))
    }
    if (!tangent && selection.active?.kind === 'edge' && selection.active.objectId === objectId) {
      const slot = elementSlot(mesh, 'edge', selection.active.id)
      if (slot >= 0) {
        const [a, b] = mesh.edgeVertices(slot)
        tangent = directionOf(matrix, subtract(mesh.position(b), mesh.position(a)))
      }
    }
  }
  return { targets, normalBasis: basisOf(normals, tangent), islands }
}

/**
 * The document with every moved vertex written back, in the object's own space.
 *
 * Mirror editing happens here, at the last moment, because it is a rule about *positions* rather
 * than about the transform: whatever moved a vertex — a drag, a typed number, a field in the
 * sidebar — its partner across the plane follows it, and doing it in one place means every one of
 * those routes gets it.
 */
export function applyElementTargets(
  document: SceneDocument,
  results: TransformResult[],
  symmetry?: { x: boolean; y: boolean; z: boolean },
): SceneDocument {
  const byObject = new Map<string, Array<{ vertexId: number; point: Vec3 }>>()
  for (const result of results) {
    const parsed = parseElementTargetId(result.id)
    if (!parsed) continue
    const list = byObject.get(parsed.objectId) ?? []
    list.push({ vertexId: parsed.vertexId, point: result.transform.position })
    byObject.set(parsed.objectId, list)
  }
  let next = document
  for (const [objectId, points] of byObject) {
    const object = next.objects.find((candidate) => candidate.id === objectId)
    if (!object) continue
    if (object.data.kind === 'curve') {
      const curve = object.data
      const matrix = worldMatrix(next, object)
      /*
       * A knot carries its handles, and the cage writes that rule; symmetry and the mirror clipping
       * do not apply — they are about a mesh's own topology, and a curve has none of it.
       */
      const moved = points.map(({ vertexId, point }) => ({ vertexId, point: localFromWorldPoint(matrix, point) }))
      const written = writeCagePositions(curve, moved)
      next = { ...next, objects: next.objects.map((entry) => (entry.id === objectId ? { ...entry, data: written } : entry)) }
      continue
    }
    if (object.data.kind !== 'mesh') continue
    const data = meshOf(next, object)
    if (!data) continue
    const mesh = { ...data, vertices: [...data.vertices] }
    const slotOf = new Map<number, number>()
    for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) slotOf.set(mesh.vertexIds[slot]!, slot)
    const matrix = worldMatrix(next, object)
    const planes = clippingPlanes(next, object)
    const moved = new Map<number, Vec3>()
    for (const { vertexId, point } of points) {
      const slot = slotOf.get(vertexId)
      if (slot === undefined) continue
      const local = clipToPlanes(planes, vertexPosition(data, slot), localFromWorldPoint(matrix, point))
      setVertexPosition(mesh, slot, local)
      moved.set(slot, local)
    }
    const axes: Array<0 | 1 | 2> = []
    if (symmetry?.x) axes.push(0)
    if (symmetry?.y) axes.push(1)
    if (symmetry?.z) axes.push(2)
    for (const axis of axes) {
      // The map is built from the mesh as it was, so a partner is found by where it started rather
      // than by where the drag has just put it — which is what keeps a pair together.
      const partners = symmetryMap(EditMesh.from(data), axis, SYMMETRY_TOLERANCE)
      for (const [slot, local] of moved) {
        const partner = partners.get(slot)
        if (partner === undefined || moved.has(partner)) continue
        const mirrored: Vec3 = [...local]
        mirrored[axis] = -mirrored[axis]
        setVertexPosition(mesh, partner, mirrored)
      }
    }
    next = withMesh(next, object.data.meshId, mesh)
  }
  return next
}

/**
 * A mirror's clipping plane, in the object's own space.
 *
 * `into` takes a point into the frame the plane is flat in — the object's own, or the mirror
 * object's when one is named — and `back` returns it. `axis` is which of that frame's axes the
 * plane is perpendicular to, and `tolerance` how near it a vertex has to start to be held on it.
 */
type ClipPlane = { axis: 0 | 1 | 2; into: number[]; back: number[]; tolerance: number }

/**
 * The planes a vertex of this object may not cross.
 *
 * Clipping is Blender's answer to the one thing that makes mirrored modelling unpleasant: a vertex
 * on the seam, dragged sideways, leaves a crack down the middle of the model that is invisible
 * until it is rendered. With it on, a vertex that started on the plane stays on it and no other one
 * may cross — so the seam is welded by construction rather than repaired afterwards.
 *
 * It is a rule about positions, so it lives beside the other one, and it is read from the modifier
 * stack rather than kept in state: switching the modifier off has to stop the clipping with it.
 */
function clippingPlanes(document: SceneDocument, object: SceneObject): ClipPlane[] {
  const planes: ClipPlane[] = []
  for (const modifier of object.modifiers) {
    if (modifier.kind !== 'mirror' || modifier.params.clipping !== true) continue
    if (modifier.enabled.editMode === false) continue
    const tolerance = typeof modifier.params.mergeDistance === 'number' && Number.isFinite(modifier.params.mergeDistance)
      ? Math.max(SYMMETRY_TOLERANCE, modifier.params.mergeDistance)
      : SYMMETRY_TOLERANCE
    const named = typeof modifier.params.mirrorObject === 'string' ? modifier.params.mirrorObject : ''
    const other = named ? document.objects.find((candidate) => candidate.id === named) : undefined
    // The mirror object's frame, brought into this object's — the same composition the stack does.
    const there = other
      ? multiplyMatrices(invert(worldMatrix(document, object).toArray()), worldMatrix(document, other).toArray())
      : [...IDENTITY]
    const axes: Array<[0 | 1 | 2, string]> = [[0, 'axisX'], [1, 'axisY'], [2, 'axisZ']]
    for (const [axis, key] of axes) {
      if (modifier.params[key] !== true) continue
      planes.push({ axis, into: invert(there), back: there, tolerance })
    }
  }
  return planes
}

/** The nearest position to `wanted` that no plane forbids, given where the vertex started. */
function clipToPlanes(planes: ClipPlane[], started: Vec3, wanted: Vec3): Vec3 {
  if (planes.length === 0) return wanted
  let point = wanted
  for (const plane of planes) {
    const from = applyMatrix(plane.into, started)
    const to = applyMatrix(plane.into, point)
    const side = from[plane.axis]
    const held = Math.abs(side) <= plane.tolerance
      ? 0
      : side > 0 ? Math.max(0, to[plane.axis]) : Math.min(0, to[plane.axis])
    if (held === to[plane.axis]) continue
    const clipped: Vec3 = [...to]
    clipped[plane.axis] = held
    point = applyMatrix(plane.back, clipped)
  }
  return point
}

/** Where a set of vertices sits now, so a caller can put them back exactly. */
export function readElementPositions(document: SceneDocument, ids: string[]): TransformResult[] {
  const results: TransformResult[] = []
  for (const id of ids) {
    const parsed = parseElementTargetId(id)
    if (!parsed) continue
    const object = document.objects.find((candidate) => candidate.id === parsed.objectId)
    const data = object ? meshOf(document, object) : null
    if (!object || !data) continue
    const slot = data.vertexIds.indexOf(parsed.vertexId)
    if (slot < 0) continue
    const world = worldPointOf(worldMatrix(document, object), vertexPosition(data, slot))
    results.push({ id, transform: { position: world, rotation: [0, 0, 0], scale: [1, 1, 1] } })
  }
  return results
}

/* ----------------------------------------------------------------- internals */

/**
 * The unselected vertices proportional editing reaches, and by how much.
 *
 * Connected mode measures along the edges rather than across the air, so that the far side of a
 * finger is not dragged when the near side moves — which is the whole reason Blender has the
 * option.
 */
function reach(mesh: EditMesh, chosen: Set<number>, options: ProportionalOptions): Map<number, number> {
  const distances = new Map<number, number>()
  if (options.connected) {
    // Dijkstra from every selected vertex at once, over edge lengths.
    const settled = new Uint8Array(mesh.vertexCount)
    const best = new Float64Array(mesh.vertexCount).fill(Number.POSITIVE_INFINITY)
    const queue: Array<{ slot: number; distance: number }> = []
    for (const slot of chosen) {
      best[slot] = 0
      queue.push({ slot, distance: 0 })
    }
    while (queue.length > 0) {
      queue.sort((a, b) => b.distance - a.distance)
      const here = queue.pop()!
      if (settled[here.slot]) continue
      settled[here.slot] = 1
      if (here.distance > options.size) continue
      for (const edge of mesh.vertexEdges(here.slot)) {
        const [a, b] = mesh.edgeVertices(edge)
        const other = a === here.slot ? b : a
        if (other < 0 || settled[other]) continue
        const step = here.distance + mesh.edgeLength(edge)
        if (step >= (best[other] ?? Number.POSITIVE_INFINITY)) continue
        best[other] = step
        queue.push({ slot: other, distance: step })
      }
    }
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      if (chosen.has(slot)) continue
      const distance = best[slot]!
      if (Number.isFinite(distance)) distances.set(slot, distance)
    }
  } else {
    const seeds = [...chosen].map((slot) => mesh.position(slot))
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      if (chosen.has(slot)) continue
      const here = mesh.position(slot)
      let nearest = Number.POSITIVE_INFINITY
      for (const seed of seeds) {
        const distance = length(subtract(here, seed))
        if (distance < nearest) nearest = distance
      }
      distances.set(slot, nearest)
    }
  }
  const points = [...distances].map(([slot, distance]) => ({ id: String(slot), distance }))
  const weights = new Map<number, number>()
  for (const weight of proportionalWeights(points, options.size, options.falloff)) {
    weights.set(Number(weight.id), weight.weight)
  }
  return weights
}

/** The selection split into the runs that touch each other through edges. */
function islandsOf(mesh: EditMesh, chosen: Set<number>): number[][] {
  const seen = new Set<number>()
  const parts: number[][] = []
  for (const start of chosen) {
    if (seen.has(start)) continue
    const part = [start]
    seen.add(start)
    for (let index = 0; index < part.length; index += 1) {
      for (const edge of mesh.vertexEdges(part[index]!)) {
        const [a, b] = mesh.edgeVertices(edge)
        const other = a === part[index] ? b : a
        if (other < 0 || !chosen.has(other) || seen.has(other)) continue
        seen.add(other)
        part.push(other)
      }
    }
    parts.push(part)
  }
  return parts
}

/** A right-handed frame from an average normal and, when there is one, an edge to align to. */
function basisOf(normals: Vec3[], tangent: Vec3 | null): Basis | null {
  if (normals.length === 0) return null
  let sum: Vec3 = [0, 0, 0]
  for (const normal of normals) sum = add(sum, normal)
  if (length(sum) < 1e-9) return null
  const z = normalize(sum)
  const hint = tangent && length(tangent) > 1e-9 ? normalize(tangent) : Math.abs(z[2]) > 0.9 ? [1, 0, 0] as Vec3 : [0, 0, 1] as Vec3
  let x = subtract(hint, scale(z, hint[0] * z[0] + hint[1] * z[1] + hint[2] * z[2]))
  if (length(x) < 1e-9) x = Math.abs(z[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]
  x = normalize(x)
  return { x, y: cross(z, x), z }
}

function directionOf(matrix: ReturnType<typeof worldMatrix>, vector: Vec3): Vec3 {
  const origin = worldPointOf(matrix, [0, 0, 0])
  const tip = worldPointOf(matrix, vector)
  const direction = subtract(tip, origin)
  return length(direction) < 1e-12 ? [0, 0, 1] : normalize(direction)
}
