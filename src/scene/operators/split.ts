import { uniqueName, withMesh } from '@/scene/document'
import { EditMesh } from '@/scene/mesh/editMesh'
import { dot, subtract } from '@/scene/mesh/normals'
import { editTargets, requireEdit, runOnMeshes, selectedVertices, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { selectParam, switchParam, vectorParam, type OperatorContext, type OperatorResult } from '@/scene/operators/types'
import type { ElementIds, MeshData, SceneObject, Vec3 } from '@/scene/types'

/**
 * Taking geometry apart: Split (⌥M), Rip (V) and Separate (P).
 *
 * All three answer the same question — which faces stop sharing a vertex — and differ only in how
 * far apart the pieces end up. Split leaves them in the same mesh, touching but no longer joined;
 * Rip does the same and moves one side away; Separate moves a piece out of the mesh altogether and
 * into an object of its own. So the tearing is written once, in `tearApart`, and each operator only
 * has to say which faces belong to which side.
 *
 * The rule for which side keeps the original vertex is fixed rather than clever: the side holding
 * the lowest face slot keeps it, and every other side gets a copy. Any rule would do topologically,
 * and a fixed one means the same mesh always tears the same way, which is what makes the F9 panel
 * able to replay a rip with a different direction and get a comparable answer.
 */

const NO_FACES = 'No faces are selected.'
const NO_EDGES = 'No edges are selected.'
const NO_VERTICES = 'No vertices are selected.'

/* ------------------------------------------------------------- the tearing */

type Tear = {
  /** Which vertex slot a face should use where it used a torn one, keyed `vertex:face`. */
  use: Map<string, number>
  /** The vertices minted, in the order they were minted. */
  copies: number[]
  /** Edges that carried a face before the tear, and may not carry one after it. */
  touched: Set<number>
}

/**
 * Gives every side of a torn vertex its own copy of it, and rewrites the faces to match.
 *
 * Nothing is removed here, so every slot the caller was holding is still good afterwards — the
 * edges the tear emptied are handed back rather than dropped, because a rip fills its gap with new
 * faces first and only then finds out which edges nothing is using.
 */
function tearApart(mesh: EditMesh, vertices: Iterable<number>, side: (vertex: number, face: number) => number): Tear {
  const use = new Map<string, number>()
  const copies: number[] = []
  const touched = new Set<number>()
  const rewrite = new Set<number>()
  for (const vertex of vertices) {
    const around = mesh.vertexFaces(vertex)
    if (around.length < 2) continue
    const sides = new Map<number, number[]>()
    for (const face of around) {
      const key = side(vertex, face)
      const group = sides.get(key)
      if (group) group.push(face)
      else sides.set(key, [face])
    }
    if (sides.size < 2) continue
    for (const edge of mesh.vertexEdges(vertex)) if (mesh.edgeFaces(edge).length > 0) touched.add(edge)
    const keys = [...sides.keys()].sort((a, b) => a - b)
    for (const key of keys.slice(1)) {
      const copy = mesh.addVertex(mesh.position(vertex))
      copies.push(copy)
      for (const face of sides.get(key)!) {
        use.set(`${vertex}:${face}`, copy)
        rewrite.add(face)
      }
    }
  }
  for (const face of rewrite) {
    mesh.setFaceLoop(face, mesh.faceVertices(face).map((slot) => use.get(`${slot}:${face}`) ?? slot))
  }
  return { use, copies, touched }
}

/**
 * Removes the edges a tear left with no face on either side.
 *
 * Only edges are removed, so vertex and face slots do not move: a caller that has just minted
 * copies can go on using them. A loose edge the mesh already carried is not touched, because only
 * the edges that had a face before the tear are ever offered here.
 */
function dropOrphans(mesh: EditMesh, edges: Iterable<number>): void {
  const orphans = new Set<number>()
  for (const edge of edges) if (mesh.hasEdge(edge) && mesh.edgeFaces(edge).length === 0) orphans.add(edge)
  if (orphans.size > 0) mesh.remove({ edges: orphans })
}

/** The faces around a vertex numbered by the piece they belong to, cut along the edges in `cuts`. */
function fanSides(mesh: EditMesh, vertex: number, cuts: Set<number>): Map<number, number> {
  const faces = mesh.vertexFaces(vertex)
  const sides = new Map<number, number>()
  let next = 0
  for (const start of faces) {
    if (sides.has(start)) continue
    sides.set(start, next)
    const queue = [start]
    for (let index = 0; index < queue.length; index += 1) {
      for (const edge of mesh.faceEdges(queue[index]!)) {
        if (cuts.has(edge)) continue
        const [a, b] = mesh.edgeVertices(edge)
        if (a !== vertex && b !== vertex) continue
        for (const other of mesh.edgeFaces(edge)) {
          if (sides.has(other) || !faces.includes(other)) continue
          sides.set(other, next)
          queue.push(other)
        }
      }
    }
    next += 1
  }
  return sides
}

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

/** Every edge the operator acts on: the selected ones, and any between two selected vertices. */
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

/** Tears every vertex whose fan is cut in two by these edges, and clears up after itself. */
function splitAlongEdges(mesh: EditMesh, cuts: Set<number>, vertices: Iterable<number>): number {
  const torn = [...vertices].sort((a, b) => a - b)
  const sides = new Map<string, number>()
  for (const vertex of torn) {
    for (const [face, group] of fanSides(mesh, vertex, cuts)) sides.set(`${vertex}:${face}`, group)
  }
  const tear = tearApart(mesh, torn, (vertex, face) => sides.get(`${vertex}:${face}`) ?? 0)
  dropOrphans(mesh, tear.touched)
  return tear.copies.length
}

/* --------------------------------------------------------------- the splits */

registerOperator({
  id: 'mesh.splitSelection',
  label: 'Split selection',
  section: 'Mesh',
  shortcut: '⌥M',
  icon: 'mesh',
  description: 'Take the selected faces away from the ones around them, still in the same mesh.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    const faces = targetFaces(target)
    if (faces.size === 0) return NO_FACES
    const cuts = new Set<number>()
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      const users = mesh.edgeFaces(edge)
      if (users.some((face) => faces.has(face)) && users.some((face) => !faces.has(face))) cuts.add(edge)
    }
    if (cuts.size === 0) return 'That part of the mesh is already on its own.'
    const corners = new Set<number>()
    for (const face of faces) for (const slot of mesh.faceVertices(face)) corners.add(slot)
    const rim = [...corners].filter((slot) => mesh.vertexFaces(slot).some((face) => !faces.has(face)))
    splitAlongEdges(mesh, cuts, rim)
    const vertices = new Set<number>()
    for (const face of faces) for (const slot of mesh.faceVertices(face)) vertices.add(slot)
    return { select: { faces, vertices }, active: null }
  }, { label: 'Split selection' }),
})

registerOperator({
  id: 'mesh.splitFacesByEdges',
  label: 'Split faces by edges',
  section: 'Mesh',
  icon: 'edge-mode',
  description: 'Part the faces that meet along the selected edges, so each keeps an edge of its own.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    const cuts = targetEdges(target)
    if (cuts.size === 0) return NO_EDGES
    const ends = new Set<number>()
    const kept: Array<[number, number]> = []
    for (const edge of cuts) {
      const [a, b] = mesh.edgeVertices(edge)
      if (a < 0 || b < 0) continue
      ends.add(a)
      ends.add(b)
      kept.push([mesh.vertexId(a), mesh.vertexId(b)])
    }
    const copies = splitAlongEdges(mesh, cuts, ends)
    if (copies === 0) return 'Those edges are already on a rim, with nothing to part.'
    // The edges are named again by id: parting them renumbered every edge slot the selection held.
    const edges = kept
      .map(([first, second]) => mesh.edgeSlot(mesh.slotOfVertex(first), mesh.slotOfVertex(second)))
      .filter((edge) => edge >= 0)
    return { select: { edges, vertices: ends }, active: null }
  }, { label: 'Split faces by edges' }),
})

registerOperator({
  id: 'mesh.splitEdgesFaces',
  label: 'Split faces & edges by vertices',
  section: 'Mesh',
  icon: 'vertex-mode',
  description: 'Give every face at the selected vertices its own copy of them, parting them all.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context) => runOnMeshes(context, (target) => {
    const vertices = [...selectedVertices(target)].sort((a, b) => a - b)
    if (vertices.length === 0) return NO_VERTICES
    // Every face its own side: at these vertices nothing is left sharing anything.
    const tear = tearApart(target.mesh, vertices, (_vertex, face) => face)
    if (tear.copies.length === 0) return 'Those vertices are used by one face each, so there is nothing to part.'
    dropOrphans(target.mesh, tear.touched)
    return { select: { vertices: [...vertices, ...tear.copies] }, active: null }
  }, { label: 'Split faces & edges by vertices' }),
})

/* ------------------------------------------------------------------- rip */

type RipParams = { direction: Vec3; fill: boolean }

const RIP_DIRECTION = vectorParam('direction', 'Direction', { defaultValue: [0, 0, 0], step: 0.01, unit: 'm' })

/** One opening a rip made: the lip that stayed, the face that moved, and which way they are wound. */
type Gap = { from: number; to: number; stayed: number; moved: number }

/**
 * V, and ⌥V with the fill on.
 *
 * The direction is where the pointer was: it says which side of the selection comes away, and it is
 * also how far that side moves, so the operator is a whole function of its parameters and the F9
 * panel can replay the same rip a metre further along. A direction of nothing rips nothing, which
 * is exactly the state a rip is in before the pointer has moved.
 */
function ripRun(context: OperatorContext, fill: boolean, direction: Vec3): OperatorResult {
  return runOnMeshes(context, (target) => {
    const mesh = target.mesh
    if (dot(direction, direction) === 0) return 'Drag towards the side to rip away.'
    const edges = targetEdges(target)
    const vertices = edges.size > 0
      ? [...new Set([...edges].flatMap((edge) => mesh.edgeVertices(edge)))].filter((slot) => slot >= 0)
      : [...selectedVertices(target)]
    if (vertices.length === 0) return 'Select a vertex or an edge to rip.'
    const torn = vertices.sort((a, b) => a - b)
    const side = (vertex: number, face: number): number =>
      dot(subtract(mesh.faceCentre(face), mesh.position(vertex)), direction) > 0 ? 1 : 0
    // The gaps are read before the tear: afterwards the two faces of a cut edge no longer share it,
    // which is the whole point of the tear and would leave nothing to measure the gap against.
    const gaps = new Map<number, Gap>()
    for (const vertex of torn) {
      for (const edge of mesh.vertexEdges(vertex)) {
        if (gaps.has(edge)) continue
        const users = mesh.edgeFaces(edge)
        if (users.length !== 2) continue
        const stayed = users.find((face) => side(vertex, face) === 0)
        const moved = users.find((face) => side(vertex, face) !== 0)
        if (stayed === undefined || moved === undefined) continue
        const [a, b] = mesh.edgeVertices(edge)
        const [from, to] = mesh.loopNext(stayed, a) === b ? [a, b] : [b, a]
        gaps.set(edge, { from, to, stayed, moved })
      }
    }
    const tear = tearApart(mesh, torn, side)
    if (tear.copies.length === 0) return 'Every face is on that side of the selection, so there is nothing to rip.'
    for (const copy of tear.copies) {
      const [x, y, z] = mesh.position(copy)
      mesh.setPosition(copy, [x + direction[0], y + direction[1], z + direction[2]])
    }
    if (fill) fillGaps(mesh, [...gaps.values()], tear.use)
    const ids = tear.copies.map((slot) => mesh.vertexId(slot))
    dropOrphans(mesh, tear.touched)
    const kept = ids.map((id) => mesh.slotOfVertex(id)).filter((slot) => slot >= 0)
    return { select: { vertices: kept }, active: null }
  }, { label: fill ? 'Rip fill' : 'Rip' })
}

/**
 * Closes each gap the rip opened with one face.
 *
 * A cut edge has the side that stayed on one lip and the side that moved on the other, so the gap
 * is bounded by four corners at most — three when only one end of the edge was torn. The winding
 * follows the face that stayed: two faces that share an edge run along it in opposite directions,
 * and the fill has to keep that true on both of its lips or the new face faces backwards.
 */
function fillGaps(mesh: EditMesh, gaps: Gap[], use: Map<string, number>): void {
  for (const gap of gaps) {
    const movedFrom = use.get(`${gap.from}:${gap.moved}`) ?? gap.from
    const movedTo = use.get(`${gap.to}:${gap.moved}`) ?? gap.to
    if (movedFrom === gap.from && movedTo === gap.to) continue
    const loop: number[] = []
    for (const slot of [gap.to, gap.from, movedFrom, movedTo]) if (!loop.includes(slot)) loop.push(slot)
    const face = mesh.addFace(loop)
    if (face >= 0) mesh.copyFaceAttributes(gap.stayed, face)
  }
}

registerOperator<RipParams>({
  id: 'mesh.rip',
  label: 'Rip',
  section: 'Vertex',
  shortcut: 'V',
  icon: 'rip',
  description: 'Tear the selection open along the side the pointer is on, and move that side away.',
  params: [RIP_DIRECTION, switchParam('fill', 'Fill', false)],
  defaults: { direction: [0, 0, 0], fill: false },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => ripRun(context, params.fill, params.direction),
})

registerOperator<RipParams>({
  id: 'mesh.ripFill',
  label: 'Rip fill',
  section: 'Vertex',
  shortcut: '⌥V',
  icon: 'rip',
  description: 'Rip the selection open and close the gap it leaves with new faces.',
  params: [RIP_DIRECTION, switchParam('fill', 'Fill', true)],
  defaults: { direction: [0, 0, 0], fill: true },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => ripRun(context, params.fill, params.direction),
})

/* -------------------------------------------------------------- separate */

type SeparateParams = { mode: string }

/** One piece on its way out: the faces that leave, and the vertices that leave with them. */
type Piece = { faces: Set<number>; vertices: Set<number> }

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function cornersOf(mesh: EditMesh, faces: Iterable<number>): Set<number> {
  const vertices = new Set<number>()
  for (const face of faces) for (const slot of mesh.faceVertices(face)) vertices.add(slot)
  return vertices
}

/**
 * Which pieces leave the mesh, by the mode asked for. The piece that stays is the first one: the
 * selection stays where it is not selected, the lowest material slot keeps the object, and the
 * first loose part keeps it too — so P never leaves an object with nothing in it.
 */
function piecesOf(target: EditTarget, mode: string): Piece[] | string {
  const mesh = target.mesh
  if (mode === 'material') {
    const byMaterial = new Map<number, Set<number>>()
    for (let face = 0; face < mesh.faceCount; face += 1) {
      const material = mesh.faceMaterial(face)
      const group = byMaterial.get(material)
      if (group) group.add(face)
      else byMaterial.set(material, new Set([face]))
    }
    if (byMaterial.size < 2) return 'This mesh uses one material, so there is nothing to separate.'
    return [...byMaterial.keys()].sort((a, b) => a - b).slice(1)
      .map((material) => ({ faces: byMaterial.get(material)!, vertices: cornersOf(mesh, byMaterial.get(material)!) }))
  }
  if (mode === 'loose') {
    const parts = mesh.looseParts()
    if (parts.length < 2) return 'This mesh is all one piece, so there is nothing to separate.'
    return parts.slice(1).map((part) => {
      const vertices = new Set(part)
      const faces = new Set<number>()
      for (const slot of part) for (const face of mesh.vertexFaces(slot)) faces.add(face)
      return { faces, vertices }
    })
  }
  const faces = targetFaces(target)
  if (faces.size === 0) return NO_FACES
  return [{ faces, vertices: cornersOf(mesh, faces) }]
}

/** A mesh holding one piece and nothing else, which is what the new object points at. */
function meshOfPiece(mesh: EditMesh, piece: Piece): MeshData {
  const copy = mesh.clone()
  const faces = new Set<number>()
  for (let face = 0; face < copy.faceCount; face += 1) if (!piece.faces.has(face)) faces.add(face)
  const vertices = new Set<number>()
  for (let slot = 0; slot < copy.vertexCount; slot += 1) if (!piece.vertices.has(slot)) vertices.add(slot)
  copy.remove({ faces, vertices })
  return copy.toData()
}

/** An object over the same frame as the one the geometry came from, pointing at the new mesh. */
function objectOfPiece(source: SceneObject, name: string, meshId: string): SceneObject {
  const object: SceneObject = {
    id: newId('object'),
    name,
    kind: 'mesh',
    collectionId: source.collectionId,
    transform: {
      ...source.transform,
      position: [...source.transform.position],
      rotation: [...source.transform.rotation],
      scale: [...source.transform.scale],
    },
    visible: source.visible,
    selectable: source.selectable,
    renderable: source.renderable,
    data: { kind: 'mesh', meshId },
    modifiers: source.modifiers.map((modifier) => ({
      ...modifier,
      id: newId('modifier'),
      enabled: { ...modifier.enabled },
      params: { ...modifier.params },
    })),
    materialSlots: source.materialSlots.slice(),
  }
  if (source.parentId) object.parentId = source.parentId
  if (source.origin) object.origin = [...source.origin]
  return object
}

/**
 * P: geometry leaves the mesh and becomes objects of its own.
 *
 * This is the one operator in the family that `runOnMeshes` cannot carry, because it writes objects
 * as well as meshes; the walk over the objects open for editing is done here instead. What leaves
 * takes only the vertices nothing else is drawn on — separating the lid of a cube does not take the
 * corners of its walls with it.
 */
function separateRun(context: OperatorContext, mode: string): OperatorResult {
  const targets = editTargets(context)
  if (targets.length === 0) return { error: 'Open a mesh for editing first.' }
  let document = context.document
  const names = new Set(document.objects.map((object) => object.name))
  const elements: Record<string, ElementIds> = { ...(context.selection.elements ?? {}) }
  const created: SceneObject[] = []
  const refusals: string[] = []
  for (const target of targets) {
    const pieces = piecesOf(target, mode)
    if (typeof pieces === 'string') {
      refusals.push(pieces)
      continue
    }
    const meshes: Record<string, MeshData> = {}
    for (const piece of pieces) {
      const meshId = newId('mesh')
      meshes[meshId] = meshOfPiece(target.mesh, piece)
      const name = uniqueName(names, target.object.name)
      names.add(name)
      created.push(objectOfPiece(target.object, name, meshId))
    }
    const gone = new Set<number>()
    const corners = new Set<number>()
    for (const piece of pieces) {
      for (const face of piece.faces) gone.add(face)
      for (const slot of piece.vertices) corners.add(slot)
    }
    const ids = [...corners].map((slot) => target.mesh.vertexId(slot))
    target.mesh.remove({ faces: gone })
    const stranded = new Set<number>()
    for (const id of ids) {
      const slot = target.mesh.slotOfVertex(id)
      if (slot >= 0 && target.mesh.vertexFaces(slot).length === 0) stranded.add(slot)
    }
    target.mesh.remove({ vertices: stranded })
    document = withMesh(document, target.meshId, target.mesh.toData())
    document = { ...document, meshes: { ...document.meshes, ...meshes } }
    elements[target.object.id] = { vertices: [], edges: [], faces: [] }
  }
  if (created.length === 0) return { error: refusals[0] ?? 'There is nothing here to separate.' }
  const ids = created.map((object) => object.id)
  return {
    document: { ...document, objects: [...document.objects, ...created] },
    selection: {
      ...context.selection,
      objectIds: [...new Set([...context.selection.objectIds, ...ids])],
      activeObjectId: ids.at(-1) ?? context.selection.activeObjectId,
      elements,
      active: null,
    },
    label: created.length === 1 ? 'Separate' : `Separate ${created.length} objects`,
  }
}

registerOperator<SeparateParams>({
  id: 'mesh.separate',
  label: 'Separate',
  section: 'Mesh',
  shortcut: 'P',
  icon: 'mesh',
  description: 'Move geometry out of this mesh and into an object of its own.',
  params: [
    selectParam('mode', 'Separate', [
      { value: 'selection', label: 'Selection' },
      { value: 'material', label: 'By material' },
      { value: 'loose', label: 'By loose parts' },
    ], 'selection'),
  ],
  defaults: { mode: 'selection' },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => separateRun(context, params.mode),
})
