import { EditMesh } from '@/scene/mesh/editMesh'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam, type OperatorContext } from '@/scene/operators/types'
import type { EulerOrder, SceneObject, Vec3 } from '@/scene/types'

/**
 * Blender’s Merge menu (M), and the weld the rest of the edit-mode toolkit borrows.
 *
 * Every entry here is one idea seen from six directions: several vertices become one, and every
 * face, edge and attribute that named the ones that went has to be rewritten to name the one that
 * stayed. That rewrite is `weldVertices`, written once and exported, because an edge collapse and a
 * loop dissolve are the same weld under another name — and a weld written twice is a mesh broken in
 * two different ways.
 *
 * Two decisions run through the file. A survivor keeps its own position unless the operator says
 * otherwise, so “merge by distance” never nudges geometry a person did not ask it to move. And a
 * face left with fewer than three distinct corners is not repaired, it is removed: a triangle that
 * has lost an edge is not a shape, and leaving it behind would make every later operator guess.
 */

/** One weld: the vertices in `drop` become `keep`, which moves to `point` when one is given. */
export type WeldCluster = { keep: number; drop: Iterable<number>; point?: Vec3 }

const NEED_TWO = 'Select at least two vertices to merge.'
const NEED_ONE = 'Select at least one vertex to merge.'

/* ------------------------------------------------------------------ the weld */

/**
 * Welds vertices together and rewires everything that named them. Answers how many went.
 *
 * The order is fixed by how `EditMesh` renumbers: every face is rewritten and every edge minted
 * while the old slots are still valid, and the one removal comes last. Edge flags are carried
 * across by vertex id rather than by slot for the same reason — the slots they were read from do
 * not survive the removal that follows.
 */
export function weldVertices(mesh: EditMesh, clusters: WeldCluster[]): number {
  const remap = new Int32Array(mesh.vertexCount)
  for (let slot = 0; slot < remap.length; slot += 1) remap[slot] = slot
  for (const cluster of clusters) {
    if (!mesh.hasVertex(cluster.keep)) continue
    for (const slot of cluster.drop) {
      if (!mesh.hasVertex(slot) || slot === cluster.keep) continue
      remap[slot] = cluster.keep
    }
  }
  const resolve = (slot: number): number => {
    let walk = slot
    for (let step = 0; step < remap.length && remap[walk]! !== walk; step += 1) walk = remap[walk]!
    return walk
  }
  // The survivors move first, so that a merge of one vertex onto a point — “merge at cursor” with a
  // single vertex selected — still moves it, even though it welds nothing.
  for (const cluster of clusters) {
    if (!cluster.point || !mesh.hasVertex(cluster.keep)) continue
    mesh.setPosition(resolve(cluster.keep), cluster.point)
  }
  const dropped = new Set<number>()
  for (let slot = 0; slot < remap.length; slot += 1) if (resolve(slot) !== slot) dropped.add(slot)
  if (dropped.size === 0) return 0

  const dead = new Set<number>()
  const loops = new Map<string, number>()
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    const welded: number[] = []
    let moved = false
    for (const slot of loop) {
      const survivor = resolve(slot)
      if (survivor !== slot) moved = true
      if (!welded.includes(survivor)) welded.push(survivor)
    }
    if (welded.length < 3) {
      dead.add(face)
      continue
    }
    // Two faces welded onto the same corners are one face twice; the second is dropped, but only
    // when the weld is what made them equal — a mesh that arrived with a doubled face keeps it.
    const key = [...welded].sort((a, b) => a - b).join(',')
    const twin = loops.get(key)
    if (twin !== undefined && moved) {
      dead.add(face)
      continue
    }
    if (twin === undefined) loops.set(key, face)
    if (moved) mesh.setFaceLoop(face, welded)
  }

  const flags = new Map<string, { seam: boolean; sharp: boolean; crease: number; bevelWeight: number }>()
  const edgeCount = mesh.edgeCount
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const [a, b] = mesh.edgeVertices(edge)
    const ends: [number, number] = [resolve(a), resolve(b)]
    if (ends[0] === ends[1]) continue
    if (ends[0] !== a || ends[1] !== b) mesh.addEdge(ends[0], ends[1])
    const key = idKey(mesh, ends[0], ends[1])
    const carried = flags.get(key)
    const seam = mesh.edgeFlag(edge, 'seam')
    const sharp = mesh.edgeFlag(edge, 'sharp')
    const crease = mesh.edgeNumber(edge, 'crease')
    const bevelWeight = mesh.edgeNumber(edge, 'bevelWeight')
    if (!carried) flags.set(key, { seam, sharp, crease, bevelWeight })
    else {
      carried.seam ||= seam
      carried.sharp ||= sharp
      carried.crease = Math.max(carried.crease, crease)
      carried.bevelWeight = Math.max(carried.bevelWeight, bevelWeight)
    }
  }

  mesh.remove({ faces: dead, vertices: dropped })

  for (const [key, carried] of flags) {
    const edge = edgeOfKey(mesh, key)
    if (edge < 0) continue
    mesh.setEdgeFlag(edge, 'seam', carried.seam)
    mesh.setEdgeFlag(edge, 'sharp', carried.sharp)
    mesh.setEdgeNumber(edge, 'crease', carried.crease)
    mesh.setEdgeNumber(edge, 'bevelWeight', carried.bevelWeight)
  }
  return dropped.size
}

function idKey(mesh: EditMesh, a: number, b: number): string {
  const first = mesh.vertexId(a)
  const second = mesh.vertexId(b)
  return first < second ? `${first}:${second}` : `${second}:${first}`
}

function edgeOfKey(mesh: EditMesh, key: string): number {
  const [first, second] = key.split(':').map(Number) as [number, number]
  const a = mesh.slotOfVertex(first)
  const b = mesh.slotOfVertex(second)
  return a < 0 || b < 0 ? -1 : mesh.edgeSlot(a, b)
}

/** What the history entry says: the one number a person wants after pressing M. */
export function removedLabel(count: number): string {
  return count === 1 ? 'Removed 1 vertex' : `Removed ${count} vertices`
}

/* --------------------------------------------------------------- the cursor */

/**
 * The 3D cursor read in an object’s own frame, which is where the geometry lives.
 *
 * The transform is inverted by hand rather than through a matrix library: the mesh operators are
 * pure and are tested without a renderer, and one object’s own frame is all this needs. A parent’s
 * frame is not folded in — an object parented to another and edited at the same time would need the
 * whole chain, which is the lead’s `worldMatrix` and not this file’s business.
 */
function cursorInObject(object: SceneObject, cursor: Vec3): Vec3 {
  const transform = object.transform
  const [px, py, pz] = transform.position
  let point: Vec3 = [cursor[0] - px, cursor[1] - py, cursor[2] - pz]
  if (transform.rotationMode === 'quaternion' && transform.quaternion) {
    const [qx, qy, qz, qw] = transform.quaternion
    point = rotateByQuaternion(point, [-qx, -qy, -qz, qw])
  } else {
    const order: EulerOrder = transform.rotationMode && transform.rotationMode !== 'quaternion' ? transform.rotationMode : 'XYZ'
    for (const letter of order) {
      const axis = letter === 'X' ? 0 : letter === 'Y' ? 1 : 2
      point = rotateAxis(point, axis, (-transform.rotation[axis]! * Math.PI) / 180)
    }
  }
  const [sx, sy, sz] = transform.scale
  const origin = object.origin ?? [0, 0, 0]
  return [
    point[0] / (sx === 0 ? 1 : sx) - origin[0],
    point[1] / (sy === 0 ? 1 : sy) - origin[1],
    point[2] / (sz === 0 ? 1 : sz) - origin[2],
  ]
}

function rotateAxis(point: Vec3, axis: number, radians: number): Vec3 {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const [x, y, z] = point
  if (axis === 0) return [x, y * cos - z * sin, y * sin + z * cos]
  if (axis === 1) return [x * cos + z * sin, y, z * cos - x * sin]
  return [x * cos - y * sin, x * sin + y * cos, z]
}

function rotateByQuaternion(point: Vec3, [qx, qy, qz, qw]: [number, number, number, number]): Vec3 {
  const ix = qw * point[0] + qy * point[2] - qz * point[1]
  const iy = qw * point[1] + qz * point[0] - qx * point[2]
  const iz = qw * point[2] + qx * point[1] - qy * point[0]
  const iw = -qx * point[0] - qy * point[1] - qz * point[2]
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}

/* ------------------------------------------------------------- the merges */

/** The vertices the merge acts on: a selected edge’s and face’s corners count as selected. */
function mergeable(target: EditTarget): number[] {
  return [...selectedVertices(target)].sort((a, b) => a - b)
}

/** One weld of everything selected onto one point, and the selection that is left. */
function mergeOnto(target: EditTarget, keep: number, point: Vec3): EditOutcome {
  const vertices = mergeable(target)
  if (vertices.length === 0) return NEED_ONE
  const id = target.mesh.vertexId(keep)
  const removed = weldVertices(target.mesh, [{ keep, drop: vertices.filter((slot) => slot !== keep), point }])
  const survivor = target.mesh.slotOfVertex(id)
  return {
    select: { vertices: survivor < 0 ? [] : [survivor] },
    active: survivor < 0 ? null : { kind: 'vertex', slot: survivor },
    message: removedLabel(removed),
  }
}

/**
 * The vertices of this target in the order they were picked, newest last.
 *
 * “At first” and “at last” are the only two operators that care in which order a person clicked,
 * and the selection keeps that order in its element history. A history that names none of the
 * selected vertices is not guessed at: the operator says so instead.
 */
function pickOrder(context: OperatorContext, target: EditTarget): number[] {
  const selected = selectedVertices(target)
  const order: number[] = []
  for (const entry of context.selection.elementHistory ?? []) {
    if (entry.kind !== 'vertex' || entry.objectId !== target.object.id) continue
    const slot = target.mesh.slotOfVertex(Number(entry.id))
    if (slot < 0 || !selected.has(slot) || order.includes(slot)) continue
    order.push(slot)
  }
  return order
}

registerOperator({
  id: 'mesh.mergeAtCentre',
  label: 'Merge at centre',
  section: 'Vertex',
  shortcut: 'M',
  icon: 'vertex-mode',
  description: 'Weld the selected vertices into one, at the middle of them.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context) => runOnMeshes(context, (target) => {
    const vertices = mergeable(target)
    if (vertices.length < 2) return NEED_TWO
    return mergeOnto(target, vertices[0]!, target.mesh.median(vertices))
  }),
})

registerOperator({
  id: 'mesh.mergeAtCursor',
  label: 'Merge at cursor',
  section: 'Vertex',
  icon: 'cursor',
  description: 'Weld the selected vertices into one, at the 3D cursor.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context) => runOnMeshes(context, (target) => {
    const vertices = mergeable(target)
    if (vertices.length < 1) return NEED_ONE
    return mergeOnto(target, vertices[0]!, cursorInObject(target.object, context.cursor.position))
  }),
})

registerOperator({
  id: 'mesh.mergeCollapse',
  label: 'Merge collapse',
  section: 'Vertex',
  icon: 'vertex-mode',
  description: 'Weld each connected island of the selection into one vertex of its own.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context) => runOnMeshes(context, (target) => {
    const islands = selectionIslands(target)
    if (islands.length === 0) return NEED_TWO
    const clusters: WeldCluster[] = islands.map((island) => ({
      keep: island[0]!,
      drop: island.slice(1),
      point: target.mesh.median(island),
    }))
    const ids = clusters.map((cluster) => target.mesh.vertexId(cluster.keep))
    const removed = weldVertices(target.mesh, clusters)
    const survivors = ids.map((id) => target.mesh.slotOfVertex(id)).filter((slot) => slot >= 0)
    return { select: { vertices: survivors }, active: null, message: removedLabel(removed) }
  }),
})

/** The selection cut into pieces that touch: each becomes one vertex of its own. */
function selectionIslands(target: EditTarget): number[][] {
  const selected = selectedVertices(target)
  const seen = new Set<number>()
  const islands: number[][] = []
  for (const start of [...selected].sort((a, b) => a - b)) {
    if (seen.has(start)) continue
    const island = [start]
    seen.add(start)
    for (let index = 0; index < island.length; index += 1) {
      for (const edge of target.mesh.vertexEdges(island[index]!)) {
        for (const end of target.mesh.edgeVertices(edge)) {
          if (end < 0 || !selected.has(end) || seen.has(end)) continue
          seen.add(end)
          island.push(end)
        }
      }
    }
    if (island.length > 1) islands.push(island.sort((a, b) => a - b))
  }
  return islands
}

registerOperator({
  id: 'mesh.mergeAtFirst',
  label: 'Merge at first',
  section: 'Vertex',
  icon: 'vertex-mode',
  description: 'Weld the selected vertices onto the one that was picked first.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context) => runOnMeshes(context, (target) => {
    if (mergeable(target).length < 2) return NEED_TWO
    const first = pickOrder(context, target)[0]
    if (first === undefined) return 'Pick the vertices one at a time: this merges onto the first of them.'
    return mergeOnto(target, first, target.mesh.position(first))
  }),
})

registerOperator({
  id: 'mesh.mergeAtLast',
  label: 'Merge at last',
  section: 'Vertex',
  icon: 'vertex-mode',
  description: 'Weld the selected vertices onto the active one, the last that was picked.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context) => runOnMeshes(context, (target) => {
    if (mergeable(target).length < 2) return NEED_TWO
    const order = pickOrder(context, target)
    const active = target.active?.kind === 'vertex' ? target.active.slot : undefined
    const last = active ?? order.at(-1)
    if (last === undefined) return 'Pick the vertices one at a time: this merges onto the last of them.'
    return mergeOnto(target, last, target.mesh.position(last))
  }),
})

/* ------------------------------------------------------------ by distance */

/** Blender’s own default: a tenth of a millimetre, which welds a seam without moving a silhouette. */
const DEFAULT_DISTANCE = 0.0001

/** Below this fold, two faces meeting at an edge are the same surface and the edge is not a crease. */
const FLAT = 1e-4

type DistanceParams = { distance: number; sharpEdges: boolean; unselected: boolean }

registerOperator<DistanceParams>({
  id: 'mesh.mergeByDistance',
  label: 'Merge by distance',
  section: 'Vertex',
  icon: 'vertex-mode',
  description: 'Weld every selected vertex that sits within the distance of another.',
  params: [
    numberParam('distance', 'Distance', { min: 0, max: 10, step: 0.0001, defaultValue: DEFAULT_DISTANCE, unit: 'm' }),
    switchParam('sharpEdges', 'Sharp edges', false),
    switchParam('unselected', 'Unselected', false),
  ],
  defaults: { distance: DEFAULT_DISTANCE, sharpEdges: false, unselected: false },
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const selected = selectedVertices(target)
    if (selected.size === 0) return 'No vertices are selected.'
    const distance = Math.max(0, params.distance)
    const clusters = withinDistance(target.mesh, selected, distance, params.unselected)
    const survivorIds = clusters.map((cluster) => target.mesh.vertexId(cluster.keep))
    const removed = weldVertices(target.mesh, clusters)
    const survivors = survivorIds.map((id) => target.mesh.slotOfVertex(id)).filter((slot) => slot >= 0)
    if (params.sharpEdges) markFolds(target.mesh, survivors)
    const kept = [...selected].filter((slot) => target.mesh.hasVertex(slot))
    return {
      select: { vertices: survivors.length > 0 ? survivors : kept },
      message: removedLabel(removed),
    }
  }),
})

/**
 * The groups of vertices that sit within `distance` of each other, as welds.
 *
 * The search is over a grid of cells the size of the distance, so each vertex only ever looks at
 * the twenty-seven cells around it rather than at the whole mesh — a merge on a dense mesh is one
 * of the few edit-mode operators a person will run on every vertex at once.
 *
 * The survivor keeps its own position rather than moving to the middle of its group: Blender welds
 * onto a vertex, and a merge meant to close a seam should not move the seam.
 */
export function withinDistance(mesh: EditMesh, selected: Set<number>, distance: number, unselected: boolean): WeldCluster[] {
  const candidates: number[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    if (unselected || selected.has(slot)) candidates.push(slot)
  }
  const cell = Math.max(distance, 1e-9)
  const grid = new Map<string, number[]>()
  const parent = new Map<number, number>()
  for (const slot of candidates) parent.set(slot, slot)
  const find = (slot: number): number => {
    let root = slot
    while (parent.get(root)! !== root) root = parent.get(root)!
    let walk = slot
    while (parent.get(walk)! !== walk) {
      const next = parent.get(walk)!
      parent.set(walk, root)
      walk = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(Math.max(rootA, rootB), Math.min(rootA, rootB))
  }
  for (const slot of candidates) {
    const point = mesh.position(slot)
    const home = [Math.floor(point[0] / cell), Math.floor(point[1] / cell), Math.floor(point[2] / cell)]
    for (let x = -1; x <= 1; x += 1) {
      for (let y = -1; y <= 1; y += 1) {
        for (let z = -1; z <= 1; z += 1) {
          for (const other of grid.get(`${home[0]! + x}|${home[1]! + y}|${home[2]! + z}`) ?? []) {
            // Two unselected vertices are never welded to each other, whatever the option says:
            // “unselected” lets the selection fall onto the rest of the mesh, not the rest onto itself.
            if (!selected.has(slot) && !selected.has(other)) continue
            const there = mesh.position(other)
            const dx = there[0] - point[0]
            const dy = there[1] - point[1]
            const dz = there[2] - point[2]
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= distance) union(slot, other)
          }
        }
      }
    }
    const key = `${home[0]}|${home[1]}|${home[2]}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(slot)
    else grid.set(key, [slot])
  }
  const groups = new Map<number, number[]>()
  for (const slot of candidates) {
    const root = find(slot)
    const group = groups.get(root)
    if (group) group.push(slot)
    else groups.set(root, [slot])
  }
  const clusters: WeldCluster[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    // With “unselected” on, the vertex that stays is one the person did not select: the selection
    // is what moves, exactly as it does when a vertex is dragged onto another with snapping on.
    const keep = group.find((slot) => !selected.has(slot)) ?? group[0]!
    clusters.push({ keep, drop: group.filter((slot) => slot !== keep) })
  }
  return clusters
}

/**
 * Marks as sharp every fold the weld left behind around the vertices it welded onto.
 *
 * Blender decides this from custom split normals, which this mesh has not got yet; the fold itself
 * is the only evidence here, so an edge that carries two faces and bends at all is called sharp and
 * a seam welded shut inside a flat surface is not. It is an approximation, and it errs towards
 * keeping the shading a person could already see.
 */
function markFolds(mesh: EditMesh, survivors: number[]): void {
  const edges = new Set<number>()
  for (const slot of survivors) for (const edge of mesh.vertexEdges(slot)) edges.add(edge)
  for (const edge of edges) {
    if (mesh.edgeFaces(edge).length !== 2) continue
    if (mesh.dihedral(edge) > FLAT) mesh.setEdgeFlag(edge, 'sharp', true)
  }
}
