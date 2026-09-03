import type { ParameterDef, ParamValue } from '@/rigs/types'
import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, dot, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import { propagateUp } from '@/scene/mesh/selection'
import {
  elementSlot,
  elementsFromSlots,
  requireEdit,
  runOnMeshes,
  selectedVertices,
  type EditOutcome,
  type EditTarget,
} from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam, vectorParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Every extrusion Blender has: E, the ⌥E menu, and ⌃ right click.
 *
 * One thing happens in all of them. The selection is *copied*, the copies are moved, the selected
 * faces are re-pointed at the copies, and walls are built from the rim of what was selected to the
 * rim of the copies — so the surface stays closed across the seam and the region stays one shell.
 * An edge between two selected faces gets no wall, because both of its faces went up together;
 * `boundaryLoops` hands back exactly the rim and hands it back wound the way the faces are, which
 * is what lets a wall be built facing outwards without a normal ever being measured.
 *
 * What the extrusions differ in is one function: how far each copy moves. Extrude region moves them
 * all by the same vector, along normals moves each by the average of the faces meeting there,
 * individual gives every face copies of its own. So the eight operators here are one algorithm and
 * eight displacements, and the interesting reading is `extrudeFaces` and the four displacements
 * below it.
 *
 * Every `run` is a whole function of its parameters and never of the pointer: the viewport calls it
 * once the drag is confirmed, and the F9 panel calls it again with other numbers. What is selected
 * afterwards is the new geometry, which is what makes E and then G one gesture.
 */

/* ------------------------------------------------------------ the vocabulary */

const NOTHING_SELECTED = 'Nothing is selected.'

const CROOKED_RIM =
  'Only some of the faces around the selection run along this offset. Extrude region instead, or offset along the region’s own normal.'

/** Under this, an offset lies in a face's plane and a wall built on it would land inside that face. */
const ALONG_A_FACE = 1e-6

/** A corner folded back this far would send an even offset to infinity; Blender clamps it too. */
const FLATTEST_CORNER = 0.01

/** Slots, in the three kinds: what is being extruded, and what is selected once it has been. */
type Chosen = { vertices: Set<number>; edges: Set<number>; faces: Set<number> }

/** What an extrusion made, named by id — the tidy-up at the end of one renumbers every slot. */
type Extruded = { vertices: number[]; faces: number[] }

/** How far the copy of a vertex moves. The whole family differs in this and in nothing else. */
type Displace = (vertexSlot: number) => Vec3

/* ------------------------------------------------------ reading the parameters */

function numberOf(value: ParamValue | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** A parameter is data and may say anything at all; an offset that is not three numbers is none. */
function vectorOf(value: ParamValue | undefined): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const x = Number(value[0])
  const y = Number(value[1])
  const z = Number(value[2])
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [x, y, z]
}

/* --------------------------------------------------------------- the selection */

/**
 * The selection as E reads it: an edge whose two ends are selected is selected, and a face whose
 * edges all are. That is why picking the four corners of a face in vertex mode and pressing E
 * extrudes the face rather than four lonely vertices, and it is the only place this file has to
 * know what the select modes are up to.
 */
function extrudable(target: EditTarget): Chosen {
  const mesh = target.mesh
  const elements = propagateUp(mesh, elementsFromSlots(mesh, {
    vertices: selectedVertices(target),
    edges: target.edges,
    faces: target.faces,
  }))
  const vertices = new Set<number>()
  for (const id of elements.vertices) {
    const slot = mesh.slotOfVertex(id)
    if (slot >= 0) vertices.add(slot)
  }
  const edges = new Set<number>()
  for (const key of elements.edges) {
    const slot = elementSlot(mesh, 'edge', key)
    if (slot >= 0) edges.add(slot)
  }
  const faces = new Set<number>()
  for (const id of elements.faces) {
    const slot = mesh.slotOfFace(id)
    if (slot >= 0) faces.add(slot)
  }
  return { vertices, edges, faces }
}

function isEmpty(chosen: Chosen): boolean {
  return chosen.vertices.size === 0 && chosen.edges.size === 0 && chosen.faces.size === 0
}

/** The new geometry as slots in the mesh as it now stands, which is what stays selected. */
function afterwards(mesh: EditMesh, extruded: Extruded): Chosen {
  const vertices = new Set<number>()
  for (const id of extruded.vertices) {
    const slot = mesh.slotOfVertex(id)
    if (slot >= 0) vertices.add(slot)
  }
  const faces = new Set<number>()
  for (const id of extruded.faces) {
    const slot = mesh.slotOfFace(id)
    if (slot >= 0) faces.add(slot)
  }
  // An edge between two copies belongs to the extrusion; one that still has an end on the old
  // geometry is a wall's upright, which Blender leaves unselected.
  const edges = new Set<number>()
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    const [a, b] = mesh.edgeVertices(edge)
    if (vertices.has(a) && vertices.has(b)) edges.add(edge)
  }
  return { vertices, edges, faces }
}

function selecting(chosen: Chosen): EditOutcome {
  return { select: { vertices: chosen.vertices, edges: chosen.edges, faces: chosen.faces } }
}

/* ------------------------------------------------------------- the ingredients */

function regionVertices(mesh: EditMesh, faces: Iterable<number>): Set<number> {
  const slots = new Set<number>()
  for (const face of faces) for (const corner of mesh.faceVertices(face)) slots.add(corner)
  return slots
}

/**
 * Every edge that already carries a face and touches the region. These are the candidates for the
 * tidy-up: an edge the mesh had before with nothing on it is somebody's wire, not our leavings.
 */
function loadedEdgesAround(mesh: EditMesh, vertices: Iterable<number>): number[] {
  const edges = new Set<number>()
  for (const vertex of vertices) {
    for (const edge of mesh.vertexEdges(vertex)) if (mesh.edgeFaces(edge).length > 0) edges.add(edge)
  }
  return [...edges]
}

/** The rim of a patch as directed pairs, wound the way the faces are. */
function rimEdges(mesh: EditMesh, faces: Iterable<number>): Array<[number, number]> {
  const rim: Array<[number, number]> = []
  for (const loop of mesh.boundaryLoops(faces)) {
    for (let index = 0; index < loop.length; index += 1) {
      const from = loop[index]!
      const to = loop[(index + 1) % loop.length]!
      // A rim that could not be walked all the way round ends on a pair that is no edge, and a wall
      // built across it would be a face over thin air.
      if (mesh.edgeSlot(from, to) >= 0) rim.push([from, to])
    }
  }
  return rim
}

/** Which face of the patch each rim corner came from, so its wall can take that face's material. */
function rimOwners(mesh: EditMesh, faces: Iterable<number>): Map<string, number> {
  const owners = new Map<string, number>()
  for (const face of faces) {
    const loop = mesh.faceVertices(face)
    for (let index = 0; index < loop.length; index += 1) {
      owners.set(`${loop[index]}>${loop[(index + 1) % loop.length]}`, face)
    }
  }
  return owners
}

/** Each vertex copied once and moved, and the way back from the original to its copy. */
function duplicated(mesh: EditMesh, slots: Iterable<number>, displace: Displace): Map<number, number> {
  const copies = new Map<number, number>()
  for (const slot of slots) {
    if (copies.has(slot) || !mesh.hasVertex(slot)) continue
    copies.set(slot, mesh.addVertex(add(mesh.position(slot), displace(slot))))
  }
  return copies
}

/**
 * The wall over one rim edge. The corner runs `from → to` in the face being lifted, so the wall
 * runs `from → to` along the old geometry and back along the copies: that puts it the other way
 * round from the lifted face on the seam they share, and the other way round from the face left
 * behind on the seam *they* share, which is what facing outwards means.
 */
function addWall(mesh: EditMesh, from: number, to: number, copies: Map<number, number>, source: number): number {
  const fromCopy = copies.get(from)
  const toCopy = copies.get(to)
  if (fromCopy === undefined || toCopy === undefined) return -1
  const wall = mesh.addFace([from, to, toCopy, fromCopy])
  if (wall >= 0 && source >= 0) mesh.copyFaceAttributes(source, wall)
  return wall
}

/** Seams, sharpness, creases and bevel weights follow the geometry they were drawn on. */
function carryEdge(mesh: EditMesh, from: number, to: number): void {
  if (from < 0 || to < 0 || from === to) return
  // Written only where there is something to write: a mesh that carries no seams should not come
  // back from an extrusion carrying an array of them.
  if (mesh.edgeFlag(from, 'seam')) mesh.setEdgeFlag(to, 'seam', true)
  if (mesh.edgeFlag(from, 'sharp')) mesh.setEdgeFlag(to, 'sharp', true)
  const crease = mesh.edgeNumber(from, 'crease')
  if (crease > 0) mesh.setEdgeNumber(to, 'crease', crease)
  const bevel = mesh.edgeNumber(from, 'bevelWeight')
  if (bevel > 0) mesh.setEdgeNumber(to, 'bevelWeight', bevel)
}

/** Slots as ids, taken before a removal renumbers them. */
function named(mesh: EditMesh, vertices: Iterable<number>, faces: Iterable<number>): Extruded {
  const ids: number[] = []
  for (const slot of vertices) ids.push(mesh.vertexId(slot))
  const faceIds: number[] = []
  for (const slot of faces) faceIds.push(mesh.faceId(slot))
  return { vertices: ids, faces: faceIds }
}

/**
 * What the lifted region left behind. A rim edge keeps its old face and gains a wall, but an edge
 * between two faces that both went up now belongs to nothing, and neither does a vertex whose every
 * face went with it. Blender removes exactly this, which is why extruding all six faces of a cube
 * moves the cube rather than leaving a second one inside it.
 */
function tidy(mesh: EditMesh, candidates: Iterable<number>, vertices: Iterable<number>): void {
  const deadEdges = new Set<number>()
  for (const edge of candidates) if (mesh.edgeFaces(edge).length === 0) deadEdges.add(edge)
  const deadVertices = new Set<number>()
  for (const vertex of vertices) {
    if (mesh.vertexFaces(vertex).length > 0) continue
    // A wire somebody drew from this corner is not the extrusion's to remove, and neither is the
    // corner it hangs from.
    if (!mesh.vertexEdges(vertex).every((edge) => deadEdges.has(edge))) continue
    deadVertices.add(vertex)
  }
  if (deadEdges.size === 0 && deadVertices.size === 0) return
  mesh.remove({ edges: deadEdges, vertices: deadVertices })
}

/* ------------------------------------------------------------ the three shapes */

/**
 * A patch of faces lifted off the surface: the one extrusion the rest are written in terms of.
 * The faces keep their ids and their materials and are re-pointed at the copies, so a selection, a
 * shape key or a rig binding that named one of them still names it afterwards.
 */
function extrudeFaces(mesh: EditMesh, faces: number[], displace: Displace): Extruded {
  const rim = rimEdges(mesh, faces)
  const owners = rimOwners(mesh, faces)
  const corners = regionVertices(mesh, faces)
  const candidates = loadedEdgesAround(mesh, corners)
  const copies = duplicated(mesh, corners, displace)
  for (const face of faces) {
    mesh.setFaceLoop(face, mesh.faceVertices(face).map((slot) => copies.get(slot) ?? slot))
  }
  for (const [from, to] of rim) addWall(mesh, from, to, copies, owners.get(`${from}>${to}`) ?? -1)
  carryRegionEdges(mesh, candidates, copies)
  const extruded = named(mesh, copies.values(), faces)
  tidy(mesh, candidates, corners)
  return extruded
}

/** Every edge whose two ends were copied has a copy of its own, and inherits what it was carrying. */
function carryRegionEdges(mesh: EditMesh, edges: Iterable<number>, copies: Map<number, number>): void {
  for (const edge of edges) {
    const [a, b] = mesh.edgeVertices(edge)
    const first = copies.get(a)
    const second = copies.get(b)
    if (first === undefined || second === undefined) continue
    carryEdge(mesh, edge, mesh.edgeSlot(first, second))
  }
}

/** The way round to build a wall on an edge so that it agrees with the face already there. */
function wallDirection(mesh: EditMesh, edge: number): [number, number] {
  const [a, b] = mesh.edgeVertices(edge)
  for (const face of mesh.edgeFaces(edge)) {
    if (mesh.loopNext(face, a) === b) return [b, a]
    if (mesh.loopNext(face, b) === a) return [a, b]
  }
  return [a, b]
}

/** Each selected edge becomes a quad, and a chain of them becomes one strip: the ends are shared. */
function extrudeEdges(mesh: EditMesh, edges: number[], displace: Displace): Extruded {
  const ends = new Set<number>()
  for (const edge of edges) for (const end of mesh.edgeVertices(edge)) if (end >= 0) ends.add(end)
  const copies = duplicated(mesh, ends, displace)
  for (const edge of edges) {
    const [from, to] = wallDirection(mesh, edge)
    // Read before the wall is built, or the wall is the face it copies its material from.
    const source = mesh.edgeFaces(edge)[0] ?? -1
    addWall(mesh, from, to, copies, source)
  }
  carryRegionEdges(mesh, edges, copies)
  return named(mesh, copies.values(), [])
}

/** Each selected vertex becomes an edge: the polyline case, and what ⌃ right click draws with. */
function extrudeVertices(mesh: EditMesh, vertices: number[], displace: Displace): Extruded {
  const copies = duplicated(mesh, vertices, displace)
  for (const [from, to] of copies) mesh.addEdge(from, to)
  return named(mesh, copies.values(), [])
}

/** E, which is all three: faces if any are selected, else edges, else vertices. */
function extrudeChosen(mesh: EditMesh, chosen: Chosen, displace: Displace): Extruded | null {
  if (chosen.faces.size > 0) return extrudeFaces(mesh, [...chosen.faces], displace)
  if (chosen.edges.size > 0) return extrudeEdges(mesh, [...chosen.edges], displace)
  if (chosen.vertices.size > 0) return extrudeVertices(mesh, [...chosen.vertices], displace)
  return null
}

/* -------------------------------------------------------- the displacements */

/** The same vector for every copy: E, and every extrusion the pointer drives. */
function by(offset: Vec3): Displace {
  return () => offset
}

/**
 * Each face along its own normal, with the region still one shell: a vertex two selected faces
 * share moves along the average of the two.
 *
 * With “offset even” the average is stretched by one over the cosine of the angle it makes with
 * those faces, which puts each face exactly `offset` from where it was however the corner folds —
 * so a bevelled shell comes out the same thickness all the way round instead of pinching at the
 * bevels. It is the option Blender ships on, and the reason ⌥E is not just E along a normal.
 */
function alongNormals(mesh: EditMesh, faces: Iterable<number>, offset: number, even: boolean): Displace {
  const around = new Map<number, Vec3[]>()
  for (const face of faces) {
    const normal = mesh.faceNormal(face)
    for (const corner of mesh.faceVertices(face)) {
      const list = around.get(corner)
      if (list) list.push(normal)
      else around.set(corner, [normal])
    }
  }
  return (slot) => {
    const normals = around.get(slot)
    if (!normals || normals.length === 0) return [0, 0, 0]
    let sum: Vec3 = [0, 0, 0]
    for (const normal of normals) sum = add(sum, normal)
    const average = normalize(sum)
    if (length(average) === 0) return [0, 0, 0]
    if (!even) return scale(average, offset)
    let cosine = 0
    for (const normal of normals) cosine += dot(average, normal)
    return scale(average, offset / Math.max(FLATTEST_CORNER, cosine / normals.length))
  }
}

/**
 * Each face lifted on its own, sharing nothing with its neighbour: six faces of a cube give six
 * lids and twenty-four walls. It is the one extrusion that cannot go through `extrudeFaces`,
 * because there the copies are shared and here the whole point is that they are not.
 */
function extrudeIndividualFaces(mesh: EditMesh, faces: number[], offset: number): Extruded {
  const lifted: number[] = []
  const lids: number[] = []
  for (const face of faces) {
    const loop = mesh.faceVertices(face)
    if (loop.length < 3) continue
    const shift = scale(mesh.faceNormal(face), offset)
    const copies = loop.map((slot) => mesh.addVertex(add(mesh.position(slot), shift)))
    for (let index = 0; index < loop.length; index += 1) {
      const next = (index + 1) % loop.length
      const wall = mesh.addFace([loop[index]!, loop[next]!, copies[next]!, copies[index]!])
      if (wall >= 0) mesh.copyFaceAttributes(face, wall)
      carryEdge(mesh, mesh.edgeSlot(loop[index]!, loop[next]!), mesh.edgeSlot(copies[index]!, copies[next]!))
    }
    mesh.setFaceLoop(face, copies)
    for (const copy of copies) lifted.push(copy)
    lids.push(face)
  }
  // Nothing is left behind to tidy: every old corner still carries the walls that were built on it.
  return named(mesh, lifted, lids)
}

/**
 * Blender 2.9's extrude manifold. Where the face beside the rim runs along the offset, a wall built
 * there would lie in that face's plane, one skin on top of the other, inside the solid; so the
 * neighbour takes the new rim as its own corners instead and no wall is built at all. A face pushed
 * into a cube then gives a shorter cube rather than a cube with a lid loose inside it.
 *
 * Where no neighbour runs along the offset there is nothing to dissolve and this is extrude region.
 * Where only some do, the two halves would not meet: that is refused by name rather than answered
 * with a hole.
 */
function extrudeManifold(mesh: EditMesh, faces: number[], offset: Vec3): Extruded | string {
  if (length(offset) === 0) return extrudeFaces(mesh, faces, by(offset))
  const direction = normalize(offset)
  const rim = rimEdges(mesh, faces)
  const region = new Set(faces)
  const swallowed = new Set<number>()
  let absorbed = 0
  for (const [from, to] of rim) {
    const edge = mesh.edgeSlot(from, to)
    const beside = mesh.edgeFaces(edge).filter((face) => !region.has(face))
    const other = beside.length === 1 ? beside[0]! : -1
    if (other < 0 || Math.abs(dot(direction, mesh.faceNormal(other))) > ALONG_A_FACE) continue
    swallowed.add(other)
    absorbed += 1
  }
  if (absorbed === 0) return extrudeFaces(mesh, faces, by(offset))
  if (absorbed !== rim.length) return CROOKED_RIM

  const corners = regionVertices(mesh, faces)
  const candidates = loadedEdgesAround(mesh, corners)
  const copies = duplicated(mesh, corners, by(offset))
  for (const face of [...faces, ...swallowed]) {
    mesh.setFaceLoop(face, mesh.faceVertices(face).map((slot) => copies.get(slot) ?? slot))
  }
  carryRegionEdges(mesh, candidates, copies)
  const extruded = named(mesh, copies.values(), faces)
  tidy(mesh, candidates, corners)
  return extruded
}

/* ---------------------------------------------------------------- the operators */

const OFFSET_VECTOR = vectorParam('offset', 'Move', { defaultValue: [0, 0, 0], step: 0.01, unit: 'm' })

function offsetNumber(label: string): ParameterDef {
  return numberParam('offset', label, { min: -1000, max: 1000, step: 0.01, defaultValue: 0, unit: 'm' })
}

type OffsetParams = { offset: Vec3 }

registerOperator<OffsetParams>({
  id: 'mesh.extrudeRegion',
  label: 'Extrude region',
  section: 'Mesh',
  shortcut: 'E',
  icon: 'extrude',
  description: 'Lift the selection and build the walls that join it to what it left behind.',
  params: [OFFSET_VECTOR],
  defaults: { offset: [0, 0, 0] },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => {
    const offset = vectorOf(params.offset) ?? [0, 0, 0]
    return runOnMeshes(context, (target) => {
      const chosen = extrudable(target)
      const extruded = extrudeChosen(target.mesh, chosen, by(offset))
      if (!extruded) return NOTHING_SELECTED
      return selecting(afterwards(target.mesh, extruded))
    }, { label: 'Extrude region' })
  },
})

registerOperator<{ offset: number; offsetEven: boolean }>({
  id: 'mesh.extrudeAlongNormals',
  label: 'Extrude faces along normals',
  section: 'Face',
  icon: 'extrude',
  description: 'Lift each selected face along its own normal, keeping the region one shell.',
  params: [offsetNumber('Offset'), switchParam('offsetEven', 'Offset even', true)],
  defaults: { offset: 0, offsetEven: true },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => {
    const offset = numberOf(params.offset, 0)
    const even = params.offsetEven !== false
    return runOnMeshes(context, (target) => {
      const faces = [...target.faces]
      if (faces.length === 0) return 'No faces are selected.'
      const extruded = extrudeFaces(target.mesh, faces, alongNormals(target.mesh, faces, offset, even))
      return selecting(afterwards(target.mesh, extruded))
    }, { label: 'Extrude faces along normals' })
  },
})

registerOperator<{ offset: number }>({
  id: 'mesh.extrudeIndividual',
  label: 'Extrude individual faces',
  section: 'Face',
  icon: 'extrude',
  description: 'Lift each selected face on its own, so no two of them share a wall.',
  params: [offsetNumber('Offset')],
  defaults: { offset: 0 },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => {
    const offset = numberOf(params.offset, 0)
    return runOnMeshes(context, (target) => {
      const faces = [...target.faces]
      if (faces.length === 0) return 'No faces are selected.'
      const extruded = extrudeIndividualFaces(target.mesh, faces, offset)
      return selecting(afterwards(target.mesh, extruded))
    }, { label: 'Extrude individual faces' })
  },
})

registerOperator<OffsetParams>({
  id: 'mesh.extrudeManifold',
  label: 'Extrude manifold',
  section: 'Mesh',
  icon: 'extrude',
  description: 'Lift the selection and dissolve the faces it is pushed into, leaving no skin inside the solid.',
  params: [OFFSET_VECTOR],
  defaults: { offset: [0, 0, 0] },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => {
    const offset = vectorOf(params.offset) ?? [0, 0, 0]
    return runOnMeshes(context, (target) => {
      const faces = [...target.faces]
      if (faces.length === 0) return 'No faces are selected.'
      const extruded = extrudeManifold(target.mesh, faces, offset)
      if (typeof extruded === 'string') return extruded
      return selecting(afterwards(target.mesh, extruded))
    }, { label: 'Extrude manifold' })
  },
})

registerOperator<OffsetParams>({
  id: 'mesh.extrudeEdges',
  label: 'Extrude edges only',
  section: 'Edge',
  icon: 'extrude',
  description: 'Turn each selected edge into a face, whatever else is selected.',
  params: [OFFSET_VECTOR],
  defaults: { offset: [0, 0, 0] },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context, params) => {
    const offset = vectorOf(params.offset) ?? [0, 0, 0]
    return runOnMeshes(context, (target) => {
      const edges = [...target.edges]
      if (edges.length === 0) return 'No edges are selected.'
      const extruded = extrudeEdges(target.mesh, edges, by(offset))
      return selecting(afterwards(target.mesh, extruded))
    }, { label: 'Extrude edges only' })
  },
})

registerOperator<OffsetParams>({
  id: 'mesh.extrudeVertices',
  label: 'Extrude vertices only',
  section: 'Vertex',
  icon: 'extrude',
  description: 'Turn each selected vertex into an edge, whatever else is selected.',
  params: [OFFSET_VECTOR],
  defaults: { offset: [0, 0, 0] },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context, params) => {
    const offset = vectorOf(params.offset) ?? [0, 0, 0]
    return runOnMeshes(context, (target) => {
      const vertices = [...selectedVertices(target)]
      if (vertices.length === 0) return 'No vertices are selected.'
      const extruded = extrudeVertices(target.mesh, vertices, by(offset))
      return selecting(afterwards(target.mesh, extruded))
    }, { label: 'Extrude vertices only' })
  },
})

registerOperator<{ target: Vec3 }>({
  id: 'mesh.extrudeToCursor',
  label: 'Extrude to cursor',
  section: 'Mesh',
  shortcut: '⌃ Right click',
  icon: 'extrude',
  description: 'Extrude the selection and drop the new geometry on a point.',
  // The point is in the object's own space, as the offsets are: the viewport turns the click into
  // a place on the mesh before it calls, because only the viewport knows where the camera is.
  params: [vectorParam('target', 'Target', { defaultValue: [0, 0, 0], step: 0.01, unit: 'm' })],
  defaults: { target: [0, 0, 0] },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => {
    const point = vectorOf(params.target) ?? [0, 0, 0]
    return runOnMeshes(context, (target) => {
      const chosen = extrudable(target)
      if (isEmpty(chosen)) return NOTHING_SELECTED
      // The whole selection travels together, so a single vertex lands on the point exactly and a
      // face lands with its middle there: that is what draws a polyline a click at a time.
      const offset = subtract(point, target.mesh.median(chosen.vertices))
      const extruded = extrudeChosen(target.mesh, chosen, by(offset))
      if (!extruded) return NOTHING_SELECTED
      return selecting(afterwards(target.mesh, extruded))
    }, { label: 'Extrude to cursor' })
  },
})

registerOperator<{ offset: Vec3; steps: number }>({
  id: 'mesh.extrudeRepeat',
  label: 'Extrude repeat',
  section: 'Mesh',
  icon: 'extrude',
  description: 'Extrude the selection again and again, one step of the offset at a time.',
  params: [
    OFFSET_VECTOR,
    numberParam('steps', 'Steps', { min: 1, max: 200, step: 1, defaultValue: 4, view: 'stepper' }),
  ],
  // Not the zero of the other extrusions: this one is chosen from a menu rather than dragged, so
  // its defaults have to draw something a person can then adjust in the redo panel.
  defaults: { offset: [0, 0, 1], steps: 4 },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => {
    const offset = vectorOf(params.offset) ?? [0, 0, 1]
    const steps = Math.max(1, Math.min(200, Math.round(numberOf(params.steps, 1))))
    return runOnMeshes(context, (target) => {
      let chosen = extrudable(target)
      if (isEmpty(chosen)) return NOTHING_SELECTED
      for (let step = 0; step < steps; step += 1) {
        const extruded = extrudeChosen(target.mesh, chosen, by(offset))
        if (!extruded) break
        chosen = afterwards(target.mesh, extruded)
      }
      return selecting(chosen)
    }, { label: steps === 1 ? 'Extrude repeat' : `Extrude repeat, ${steps} steps` })
  },
})
