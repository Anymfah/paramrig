import { EditMesh } from '@/scene/mesh/editMesh'
import { dot, normalize, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { removedLabel, weldVertices, type WeldCluster } from '@/scene/operators/merge'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam } from '@/scene/operators/types'

/**
 * Blender’s two ways of taking geometry away: X and ⌃X.
 *
 * Delete removes what is named and leaves a hole. Dissolve removes what is named and leaves the
 * surface: the faces around a dissolved edge become one face, and a dissolved vertex takes its
 * corner with it. That is the whole difference, and it is why they live in one file — the pair is
 * only understandable side by side, and half the bugs in either come from doing the other one.
 *
 * Two habits run through it. Nothing here reads a slot across a removal: `EditMesh` renumbers on
 * every removal, so anything that has to survive one is held as an id and looked up again. And the
 * three kinds of selection are read the way the person is working — a face whose every corner is
 * selected is a selected face, an edge between two selected vertices is a selected edge — so that X
 * does the same thing in vertex mode as it does in face mode.
 */

const NO_VERTICES = 'No vertices are selected.'
const NO_EDGES = 'No edges are selected.'
const NO_FACES = 'No faces are selected.'

const RADIANS = Math.PI / 180

/* -------------------------------------------------------- reading the selection */

/** Every face the operator acts on: the selected ones, and any whose corners are all selected. */
function targetFaces(target: EditTarget): Set<number> {
  const faces = new Set(target.faces)
  if (target.vertices.size > 0) {
    for (let face = 0; face < target.mesh.faceCount; face += 1) {
      if (target.mesh.faceVertices(face).every((slot) => target.vertices.has(slot))) faces.add(face)
    }
  }
  return faces
}

/** Every edge the operator acts on: the selected ones, a selected face’s, and any between two selected vertices. */
function targetEdges(target: EditTarget): Set<number> {
  const edges = new Set(target.edges)
  for (const face of target.faces) for (const edge of target.mesh.faceEdges(face)) edges.add(edge)
  if (target.vertices.size > 0) {
    for (let edge = 0; edge < target.mesh.edgeCount; edge += 1) {
      const [a, b] = target.mesh.edgeVertices(edge)
      if (target.vertices.has(a) && target.vertices.has(b)) edges.add(edge)
    }
  }
  return edges
}

function vertexIdsOfEdges(mesh: EditMesh, edges: Iterable<number>): number[] {
  const ids = new Set<number>()
  for (const edge of edges) for (const end of mesh.edgeVertices(edge)) if (end >= 0) ids.add(mesh.vertexId(end))
  return [...ids]
}

/* ------------------------------------------------------------------- delete */

registerOperator({
  id: 'mesh.deleteVertices',
  label: 'Delete vertices',
  section: 'Mesh',
  shortcut: 'X',
  icon: 'vertex-mode',
  description: 'Remove the selected vertices, and every edge and face that used one.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context) => runOnMeshes(context, (target) => {
    const vertices = selectedVertices(target)
    if (vertices.size === 0) return NO_VERTICES
    target.mesh.remove({ vertices })
    return { select: {}, active: null }
  }, { label: 'Delete vertices' }),
})

registerOperator({
  id: 'mesh.deleteEdges',
  label: 'Delete edges',
  section: 'Mesh',
  icon: 'edge-mode',
  description: 'Remove the selected edges, the faces that used them, and any vertex left with nothing.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context) => runOnMeshes(context, (target) => {
    const edges = targetEdges(target)
    if (edges.size === 0) return NO_EDGES
    const ends = vertexIdsOfEdges(target.mesh, edges)
    target.mesh.remove({ edges })
    dropStranded(target.mesh, ends)
    return { select: {}, active: null }
  }, { label: 'Delete edges' }),
})

registerOperator({
  id: 'mesh.deleteFaces',
  label: 'Delete faces',
  section: 'Mesh',
  icon: 'face-mode',
  description: 'Remove the selected faces, and the edges and vertices no other face was using.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context) => runOnMeshes(context, (target) => {
    const faces = targetFaces(target)
    if (faces.size === 0) return NO_FACES
    const mesh = target.mesh
    const vertexIds: number[] = []
    const edgeIds: Array<[number, number]> = []
    for (const face of faces) {
      for (const slot of mesh.faceVertices(face)) vertexIds.push(mesh.vertexId(slot))
      for (const edge of mesh.faceEdges(face)) {
        const [a, b] = mesh.edgeVertices(edge)
        edgeIds.push([mesh.vertexId(a), mesh.vertexId(b)])
      }
    }
    mesh.remove({ faces })
    // What the faces were drawn on goes with them, but only where nothing else is drawn on it: the
    // four corners of a cube’s lid are still four corners of its walls.
    const strayEdges = new Set<number>()
    for (const [first, second] of edgeIds) {
      const edge = mesh.edgeSlot(mesh.slotOfVertex(first), mesh.slotOfVertex(second))
      if (edge >= 0 && mesh.edgeFaces(edge).length === 0) strayEdges.add(edge)
    }
    const strayVertices = new Set<number>()
    for (const id of vertexIds) {
      const slot = mesh.slotOfVertex(id)
      if (slot >= 0 && mesh.vertexFaces(slot).length === 0) strayVertices.add(slot)
    }
    mesh.remove({ edges: strayEdges, vertices: strayVertices })
    return { select: {}, active: null }
  }, { label: 'Delete faces' }),
})

registerOperator({
  id: 'mesh.deleteOnlyEdgesFaces',
  label: 'Delete only edges & faces',
  section: 'Mesh',
  icon: 'edge-mode',
  description: 'Remove the selected edges and faces but keep every vertex where it is.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context) => runOnMeshes(context, (target) => {
    const edges = targetEdges(target)
    if (edges.size === 0) return NO_EDGES
    target.mesh.remove({ edges })
    return { select: {}, active: null }
  }, { label: 'Delete only edges & faces' }),
})

registerOperator({
  id: 'mesh.deleteOnlyFaces',
  label: 'Delete only faces',
  section: 'Mesh',
  icon: 'face-mode',
  description: 'Remove the selected faces but keep the edges and vertices they were drawn on.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context) => runOnMeshes(context, (target) => {
    const faces = targetFaces(target)
    if (faces.size === 0) return NO_FACES
    target.mesh.remove({ faces })
    return { select: {}, active: null }
  }, { label: 'Delete only faces' }),
})

/** Removes the vertices among these ids that nothing is attached to any more. */
function dropStranded(mesh: EditMesh, ids: Iterable<number>): void {
  const stranded = new Set<number>()
  for (const id of ids) {
    const slot = mesh.slotOfVertex(id)
    if (slot < 0) continue
    if (mesh.vertexEdges(slot).length === 0 && mesh.vertexFaces(slot).length === 0) stranded.add(slot)
  }
  if (stranded.size > 0) mesh.remove({ vertices: stranded })
}

/* ----------------------------------------------------------------- dissolve */

/**
 * Takes a vertex out of the faces around it, leaving each of them one corner shorter.
 *
 * This is the half of dissolving that does not merge anything: it is what a vertex on the rim of a
 * single face, a vertex left in the middle of a straight run, and a torn boundary all need.
 * `EditMesh.dissolveVertices` cannot do it — a vertex with only one face is removed there along
 * with the face — so the corner is rewritten here first and the vertex removed afterwards.
 */
function dropCorner(mesh: EditMesh, vertex: number): boolean {
  if (!mesh.hasVertex(vertex)) return false
  const neighbours = mesh.vertexEdges(vertex)
    .map((edge) => {
      const [a, b] = mesh.edgeVertices(edge)
      return a === vertex ? b : a
    })
    .filter((slot) => slot >= 0)
  const dead = new Set<number>()
  for (const face of mesh.vertexFaces(vertex)) {
    const loop = mesh.faceVertices(face).filter((slot) => slot !== vertex)
    if (loop.length < 3) dead.add(face)
    else mesh.setFaceLoop(face, loop)
  }
  // A vertex in the middle of a run of wire has no face to mend it, so the run is joined by hand.
  if (neighbours.length === 2) mesh.addEdge(neighbours[0]!, neighbours[1]!)
  mesh.remove({ faces: dead, vertices: [vertex] })
  return true
}

/**
 * One vertex dissolved: the faces around it become one, and its corner comes off that one.
 *
 * It is written as two steps rather than through `EditMesh.dissolveVertices` because that call
 * removes the merged face along with the vertex whenever the vertex is still on the face’s rim —
 * which is every vertex on a boundary. Merging across the interior edges first and taking the
 * corner off afterwards gives the same answer inside a surface and the right one at its edge.
 */
function dissolveFan(mesh: EditMesh, vertex: number): boolean {
  if (!mesh.hasVertex(vertex)) return false
  const id = mesh.vertexId(vertex)
  const inner = mesh.vertexEdges(vertex).filter((edge) => mesh.edgeFaces(edge).length === 2)
  if (inner.length > 0 && mesh.dissolveEdges(inner).dissolved === 0) return false
  return dropCorner(mesh, mesh.slotOfVertex(id))
}

/**
 * The tidy-up Blender calls “dissolve verts”: a vertex the operator has left with two edges is in
 * the middle of a straight run and is taken out, and one left with nothing at all goes too.
 */
function dissolveLeftovers(mesh: EditMesh, ids: Iterable<number>, boundaries: boolean, limit?: number): void {
  for (const id of ids) {
    const slot = mesh.slotOfVertex(id)
    if (slot < 0) continue
    const edges = mesh.vertexEdges(slot)
    if (edges.length === 0 && mesh.vertexFaces(slot).length === 0) {
      mesh.remove({ vertices: [slot] })
      continue
    }
    if (edges.length !== 2) continue
    if (!boundaries && edges.some((edge) => mesh.isBoundaryEdge(edge))) continue
    if (limit !== undefined && !isStraight(mesh, slot, limit)) continue
    dropCorner(mesh, slot)
  }
}

/** Whether the two edges at a vertex carry on in the same direction, to within `limit` radians. */
function isStraight(mesh: EditMesh, vertex: number, limit: number): boolean {
  const edges = mesh.vertexEdges(vertex)
  if (edges.length !== 2) return false
  const here = mesh.position(vertex)
  const directions = edges.map((edge) => {
    const [a, b] = mesh.edgeVertices(edge)
    return normalize(subtract(mesh.position(a === vertex ? b : a), here))
  })
  const first = directions[0]
  const second = directions[1]
  if (!first || !second) return false
  return dot(first, second) <= -Math.cos(limit)
}

type VertexParams = { faceSplit: boolean; tearBoundary: boolean }

registerOperator<VertexParams>({
  id: 'mesh.dissolveVertices',
  label: 'Dissolve vertices',
  section: 'Mesh',
  shortcut: '⌃X',
  icon: 'vertex-mode',
  description: 'Remove the selected vertices and join the faces around each of them into one.',
  params: [
    switchParam('faceSplit', 'Face split', false),
    switchParam('tearBoundary', 'Tear boundary', false),
  ],
  defaults: { faceSplit: false, tearBoundary: false },
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    const vertices = [...selectedVertices(target)].sort((a, b) => a - b)
    if (vertices.length === 0) return NO_VERTICES
    const torn: number[] = []
    const merged: number[] = []
    for (const vertex of vertices) {
      const faces = mesh.vertexFaces(vertex)
      if (faces.length === 0) continue
      const rim = mesh.vertexEdges(vertex).some((edge) => mesh.isBoundaryEdge(edge))
      // One face around the vertex is not a merge, it is a corner coming off; and that is also what
      // tearing a boundary asks for, face by face, instead of closing the two sides together.
      if (faces.length === 1 || (params.tearBoundary && rim)) torn.push(vertex)
      else merged.push(vertex)
    }
    if (torn.length === 0 && merged.length === 0) return 'Dissolving needs vertices that are part of a face.'
    const chords = params.faceSplit ? faceSplitChords(mesh, merged) : []
    const tornIds = torn.map((slot) => mesh.vertexId(slot))
    const mergedIds = merged.map((slot) => mesh.vertexId(slot))
    let dissolved = 0
    for (const id of mergedIds) if (dissolveFan(mesh, mesh.slotOfVertex(id))) dissolved += 1
    for (const id of tornIds) if (dropCorner(mesh, mesh.slotOfVertex(id))) dissolved += 1
    if (dissolved === 0) return 'These vertices cannot be dissolved without leaving a hole.'
    for (const [first, second] of chords) splitAlong(mesh, first, second)
    return { select: {}, active: null }
  }, { label: 'Dissolve vertices' }),
})

/**
 * The cuts that “face split” puts back afterwards, as vertex ids.
 *
 * Each face around the vertex is remembered by the two corners it had on either side of it. Once
 * the fan has become one face, cutting between those two corners gives each of the old faces its
 * own corner back, which is what keeps the surrounding geometry looking as it did.
 */
function faceSplitChords(mesh: EditMesh, vertices: number[]): Array<[number, number]> {
  const chords: Array<[number, number]> = []
  for (const vertex of vertices) {
    for (const face of mesh.vertexFaces(vertex)) {
      const before = mesh.loopPrev(face, vertex)
      const after = mesh.loopNext(face, vertex)
      if (before < 0 || after < 0 || before === after) continue
      chords.push([mesh.vertexId(before), mesh.vertexId(after)])
    }
  }
  return chords
}

/** Cuts the face that holds both of these vertices in two along the line between them. */
function splitAlong(mesh: EditMesh, first: number, second: number): void {
  const a = mesh.slotOfVertex(first)
  const b = mesh.slotOfVertex(second)
  if (a < 0 || b < 0) return
  const face = mesh.vertexFaces(a).find((candidate) => mesh.faceVertices(candidate).includes(b))
  if (face === undefined) return
  mesh.splitFace(face, a, b)
}

type EdgeParams = { dissolveVerts: boolean }

registerOperator<EdgeParams>({
  id: 'mesh.dissolveEdges',
  label: 'Dissolve edges',
  section: 'Mesh',
  icon: 'edge-mode',
  description: 'Remove the selected edges and merge the faces that met along them.',
  params: [switchParam('dissolveVerts', 'Dissolve verts', true)],
  defaults: { dissolveVerts: true },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => dissolveRun(target, targetEdges(target), params.dissolveVerts),
    { label: 'Dissolve edges' }),
})

registerOperator({
  id: 'mesh.dissolveEdgeLoops',
  label: 'Dissolve edge loops',
  section: 'Edge',
  icon: 'edge-mode',
  description: 'Follow each selected edge round its loop, and take the whole loop out of the surface.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context) => runOnMeshes(context, (target) => {
    const edges = targetEdges(target)
    if (edges.size === 0) return NO_EDGES
    const loops = new Set<number>()
    for (const edge of edges) for (const step of target.mesh.edgeLoop(edge)) loops.add(step)
    return dissolveRun(target, loops, true)
  }, { label: 'Dissolve edge loops' }),
})

/** The work both edge dissolves do: merge across the edges, then tidy the vertices they left. */
function dissolveRun(target: EditTarget, edges: Set<number>, dissolveVerts: boolean): EditOutcome {
  if (edges.size === 0) return NO_EDGES
  const mesh = target.mesh
  const ends = vertexIdsOfEdges(mesh, edges)
  const outcome = mesh.dissolveEdges(edges)
  if (outcome.dissolved === 0) return 'These edges have no two faces to merge.'
  if (dissolveVerts) dissolveLeftovers(mesh, ends, true)
  return { select: {}, active: null }
}

registerOperator({
  id: 'mesh.dissolveFaces',
  label: 'Dissolve faces',
  section: 'Mesh',
  icon: 'face-mode',
  description: 'Merge the selected faces into one, taking out the edges they shared.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context) => runOnMeshes(context, (target) => {
    const faces = targetFaces(target)
    if (faces.size === 0) return NO_FACES
    const outcome = target.mesh.dissolveFaces(faces)
    if (outcome.dissolved === 0) return 'Select faces that touch: dissolving them needs a region to merge.'
    return { select: {}, active: null }
  }, { label: 'Dissolve faces' }),
})

/* --------------------------------------------------------- limited dissolve */

type LimitedParams = { angle: number; allBoundaries: boolean }

registerOperator<LimitedParams>({
  id: 'mesh.dissolveLimited',
  label: 'Limited dissolve',
  section: 'Mesh',
  icon: 'mesh',
  description: 'Take out every edge and vertex that is not holding a shape, to within an angle.',
  params: [
    numberParam('angle', 'Max angle', { min: 0, max: 180, step: 1, defaultValue: 5, unit: '°', view: 'angle' }),
    switchParam('allBoundaries', 'All boundaries', false),
  ],
  defaults: { angle: 5, allBoundaries: false },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    const edges = targetEdges(target)
    const vertices = selectedVertices(target)
    if (edges.size === 0 && vertices.size === 0) return 'Nothing is selected.'
    const limit = Math.max(0, params.angle) * RADIANS
    const flat = [...edges].filter((edge) => mesh.edgeFaces(edge).length === 2 && mesh.dihedral(edge) <= limit)
    const ids = [...vertices].map((slot) => mesh.vertexId(slot))
    const before = mesh.faceCount + mesh.vertexCount
    if (flat.length > 0) mesh.dissolveEdges(flat)
    dissolveLeftovers(mesh, ids, params.allBoundaries, limit)
    if (mesh.faceCount + mesh.vertexCount === before) return { message: 'Nothing was flat enough to dissolve.' }
    return { select: {}, active: null }
  }, { label: 'Limited dissolve' }),
})

/* ----------------------------------------------------------- edge collapse */

registerOperator({
  id: 'mesh.dissolveEdgeCollapse',
  label: 'Edge collapse',
  section: 'Edge',
  icon: 'edge-mode',
  description: 'Pull each run of selected edges down to a single vertex at its middle.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context) => runOnMeshes(context, (target) => {
    const edges = targetEdges(target)
    if (edges.size === 0) return NO_EDGES
    const clusters = edgeIslands(target.mesh, edges)
    if (clusters.length === 0) return NO_EDGES
    const ids = clusters.map((cluster) => target.mesh.vertexId(cluster.keep))
    const removed = weldVertices(target.mesh, clusters)
    const survivors = ids.map((id) => target.mesh.slotOfVertex(id)).filter((slot) => slot >= 0)
    return { select: { vertices: survivors }, active: null, message: removedLabel(removed) }
  }, { label: 'Edge collapse' }),
})

/** Each run of edges that touch, as one weld onto the middle of that run. */
function edgeIslands(mesh: EditMesh, edges: Set<number>): WeldCluster[] {
  const links = new Map<number, number[]>()
  for (const edge of edges) {
    const [a, b] = mesh.edgeVertices(edge)
    if (a < 0 || b < 0) continue
    links.set(a, [...(links.get(a) ?? []), b])
    links.set(b, [...(links.get(b) ?? []), a])
  }
  const seen = new Set<number>()
  const clusters: WeldCluster[] = []
  for (const start of [...links.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue
    const island = [start]
    seen.add(start)
    for (let index = 0; index < island.length; index += 1) {
      for (const next of links.get(island[index]!) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        island.push(next)
      }
    }
    if (island.length < 2) continue
    island.sort((a, b) => a - b)
    clusters.push({ keep: island[0]!, drop: island.slice(1), point: mesh.median(island) })
  }
  return clusters
}
