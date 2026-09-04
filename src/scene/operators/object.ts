import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import type { ParameterDef } from '@/rigs/types'
import {
  descendantObjectIds,
  meshOf,
  meshUsers,
  objectById,
  ROOT_COLLECTION_ID,
  ROOT_COLLECTION_NAME,
  sanitizeSceneDocument,
  uniqueName,
} from '@/scene/document'
import { cloneMesh } from '@/scene/mesh/data'
import { faceArea, faceCentre } from '@/scene/mesh/normals'
import { decomposeMatrix, localMatrix, objectBounds, unionBounds, worldMatrix, type Box } from '@/scene/objects'
import { DEFAULT_SCENE_GROUP, parseSceneProperty, sanitizeSceneRig, sceneRigTargets, type SceneBinding, type SceneRig } from '@/scene/rig'
import { registerOperator } from '@/scene/operators/registry'
import {
  numberParam,
  selectParam,
  switchParam,
  type Availability,
  type OperatorContext,
  type OperatorResult,
} from '@/scene/operators/types'
import type {
  Collection,
  Material,
  MeshData,
  ObjectData,
  SceneDocument,
  SceneObject,
  SceneSelection,
  Transform,
  Vec3,
} from '@/scene/types'

/**
 * Blender's Object menu.
 *
 * Everything here works on whole objects rather than on the geometry inside one: duplicating,
 * joining, parenting, applying a transform, moving an origin, hiding, and the clipboard. The whole
 * family is pure — a document and some parameters in, a document and a selection out — so the F9
 * panel can replay any of it against the document as it was, and so every one of these behaviours
 * is tested without a viewport.
 *
 * Two rules run through the file. An operator that changes an object's own frame — apply, set
 * origin — must leave the world alone: the geometry is moved the opposite way and the children are
 * corrected, because a person who applies a scale expects nothing on screen to twitch. And an
 * operator that cannot run says why in a sentence rather than greying out in silence.
 */

const SELECT_FIRST = 'Select an object first.'

/** Blender's Object menu carries these under Object → Snap, and they read as one family here too. */
const NO_MESH_SELECTED = 'Select a mesh: there is no geometry here to work on.'

/* --------------------------------------------------------------- the basics */

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

/**
 * A text field. `operators/types.ts` has a helper for every parameter kind the earlier families
 * needed and none for text, because none of them asked for one. Rename and paste do, so the helper
 * lives here until a second family wants it and it earns a move.
 */
function textParam(id: string, label: string, defaultValue: string, maxLength = 120): ParameterDef {
  return { kind: 'text', id, label, group: 'operator', defaultValue, maxLength }
}

function selectedObjects(context: OperatorContext): SceneObject[] {
  // Document order, not click order: a duplicate or a delete has to behave the same however the
  // selection was built up.
  return context.document.objects.filter((object) => context.selection.objectIds.includes(object.id))
}

function activeObject(context: OperatorContext): SceneObject | null {
  if (context.active) return context.active
  const id = context.selection.activeObjectId
  return id ? objectById(context.document, id) : null
}

function meshObjects(objects: SceneObject[]): SceneObject[] {
  return objects.filter((object) => object.data.kind === 'mesh')
}

function needsSelection(context: OperatorContext): Availability {
  return context.selection.objectIds.length > 0 ? true : SELECT_FIRST
}

function needsMeshSelection(context: OperatorContext): Availability {
  if (context.selection.objectIds.length === 0) return SELECT_FIRST
  return meshObjects(selectedObjects(context)).length > 0 ? true : NO_MESH_SELECTED
}

function selectionOf(ids: string[], active: string | null): SceneSelection {
  // A fresh selection, never a spread of the old one: the vertex, edge and face lists belong to
  // whichever object was active, and carrying them onto another object would point at nothing.
  return { objectIds: ids, activeObjectId: active }
}

function withObjects(document: SceneDocument, objects: SceneObject[]): SceneDocument {
  return { ...document, objects }
}

/** The same document with the objects named replaced, and everything else shared rather than copied. */
function replacing(document: SceneDocument, replacements: Map<string, SceneObject>): SceneDocument {
  return withObjects(document, document.objects.map((object) => replacements.get(object.id) ?? object))
}

/** A mesh nothing points at any more is dead weight, and a linked twin keeps its mesh alive. */
function withoutUnusedMeshes(document: SceneDocument): SceneDocument {
  const used = new Set(document.objects.flatMap((object) => (object.data.kind === 'mesh' ? [object.data.meshId] : [])))
  const meshes: Record<string, MeshData> = {}
  for (const [id, mesh] of Object.entries(document.meshes)) if (used.has(id)) meshes[id] = mesh
  return Object.keys(meshes).length === Object.keys(document.meshes).length ? document : { ...document, meshes }
}

/* ------------------------------------------------------------ world matrices */

const IDENTITY = new Matrix4()

function parentMatrix(document: SceneDocument, object: SceneObject): Matrix4 {
  const parent = object.parentId ? objectById(document, object.parentId) : null
  return parent ? worldMatrix(document, parent) : new Matrix4()
}

/** Where the object's origin sits in the world: what the gizmo hangs on, and what a snap moves. */
function originInWorld(document: SceneDocument, object: SceneObject): Vec3 {
  const point = new Vector3(...object.transform.position).applyMatrix4(parentMatrix(document, object))
  return [point.x, point.y, point.z]
}

/** A matrix read back as this object's transform, keeping the rotation order it was already using. */
function transformFromMatrix(object: SceneObject, matrix: Matrix4): Transform {
  if (object.transform.rotationMode !== 'quaternion') {
    return decomposeMatrix(matrix, object.transform.rotationMode ?? 'XYZ')
  }
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  return {
    position: [position.x, position.y, position.z],
    rotation: [...object.transform.rotation],
    scale: [scale.x, scale.y, scale.z],
    rotationMode: 'quaternion',
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
  }
}

/**
 * The transform that gives an object the local matrix asked for. `localMatrix` folds the origin
 * offset in at the end, so writing a matrix back has to take it out again first.
 */
function transformForLocalMatrix(object: SceneObject, local: Matrix4): Transform {
  const matrix = local.clone()
  if (object.origin) matrix.multiply(new Matrix4().makeTranslation(object.origin[0], object.origin[1], object.origin[2]))
  return transformFromMatrix(object, matrix)
}

function sameMatrix(a: Matrix4, b: Matrix4): boolean {
  for (let index = 0; index < 16; index += 1) {
    if (Math.abs((a.elements[index] ?? 0) - (b.elements[index] ?? 0)) > 1e-12) return false
  }
  return true
}

/** Parents before children, so a correction that flows down the hierarchy can be made in one pass. */
function parentsFirst(objects: SceneObject[]): SceneObject[] {
  const byId = new Map(objects.map((object) => [object.id, object] as const))
  const ordered: SceneObject[] = []
  const placed = new Set<string>()
  const visit = (object: SceneObject, seen: Set<string>): void => {
    if (placed.has(object.id) || seen.has(object.id)) return
    seen.add(object.id)
    const parent = object.parentId ? byId.get(object.parentId) : undefined
    if (parent) visit(parent, seen)
    if (placed.has(object.id)) return
    placed.add(object.id)
    ordered.push(object)
  }
  for (const object of objects) visit(object, new Set())
  return ordered
}

/**
 * The whole object list with the replacements in it, and every child of a replaced object moved so
 * that nothing in the world moves.
 *
 * `SceneObject` carries a `parentInverse`, which is where Blender keeps this correction, but
 * `worldMatrix` does not read it — so the correction goes into the child's own transform instead,
 * where it is visible in the sidebar and survives a round trip through storage.
 */
function keepChildrenInPlace(document: SceneDocument, replacements: Map<string, SceneObject>): SceneObject[] {
  const before = new Map(document.objects.map((object) => [object.id, worldMatrix(document, object)] as const))
  const after = new Map<string, Matrix4>()
  const settled = new Map<string, SceneObject>()
  for (const object of parentsFirst(document.objects)) {
    const current = replacements.get(object.id) ?? object
    let local = localMatrix(current)
    const parentBefore = current.parentId ? before.get(current.parentId) : undefined
    const parentAfter = current.parentId ? after.get(current.parentId) : undefined
    let next = current
    if (parentBefore && parentAfter && !sameMatrix(parentBefore, parentAfter)) {
      local = new Matrix4().copy(parentAfter).invert().multiply(parentBefore).multiply(local)
      next = { ...current, transform: transformForLocalMatrix(current, local) }
    }
    settled.set(object.id, next)
    after.set(object.id, parentAfter ? new Matrix4().multiplyMatrices(parentAfter, local) : local)
  }
  return document.objects.map((object) => settled.get(object.id) ?? object)
}

/** An object put under another parent, or under none, without moving in the world. */
function reparented(object: SceneObject, world: Matrix4, parentWorld: Matrix4, parentId: string | undefined): SceneObject {
  const local = new Matrix4().copy(parentWorld).invert().multiply(world)
  const next: SceneObject = { ...object, transform: transformForLocalMatrix(object, local) }
  if (parentId) next.parentId = parentId
  else delete next.parentId
  return next
}

/** An object moved by a world-space vector, expressed as the change to its own position. */
function movedInWorld(document: SceneDocument, object: SceneObject, delta: Vec3): SceneObject {
  if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return object
  const basis = new Matrix3().setFromMatrix4(parentMatrix(document, object)).invert()
  const local = new Vector3(delta[0], delta[1], delta[2]).applyMatrix3(basis)
  const [x, y, z] = object.transform.position
  return { ...object, transform: { ...object.transform, position: [x + local.x, y + local.y, z + local.z] } }
}

/* ------------------------------------------------------------------- meshes */

function transformedMesh(mesh: MeshData, matrix: Matrix4): MeshData {
  const next = cloneMesh(mesh)
  const point = new Vector3()
  for (let slot = 0; slot < next.vertexIds.length; slot += 1) {
    point.set(next.vertices[slot * 3] ?? 0, next.vertices[slot * 3 + 1] ?? 0, next.vertices[slot * 3 + 2] ?? 0)
    point.applyMatrix4(matrix)
    next.vertices[slot * 3] = point.x
    next.vertices[slot * 3 + 1] = point.y
    next.vertices[slot * 3 + 2] = point.z
  }
  // A mirroring matrix turns every face inside out; reversing the loops puts the outside back out.
  if (matrix.determinant() < 0) reverseWinding(next)
  return next
}

function reverseWinding(mesh: MeshData): void {
  const uv = mesh.attributes.vertex.uv
  for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
    mesh.faces[faceSlot] = mesh.faces[faceSlot]!.slice().reverse()
    const row = uv?.[faceSlot]
    if (!row) continue
    const corners = Math.floor(row.length / 2)
    const flipped: number[] = []
    for (let corner = corners - 1; corner >= 0; corner -= 1) flipped.push(row[corner * 2] ?? 0, row[corner * 2 + 1] ?? 0)
    uv[faceSlot] = flipped
  }
}

function movedMesh(mesh: MeshData, offset: Vec3): MeshData {
  const next = cloneMesh(mesh)
  for (let slot = 0; slot < next.vertexIds.length; slot += 1) {
    next.vertices[slot * 3] = (next.vertices[slot * 3] ?? 0) + offset[0]
    next.vertices[slot * 3 + 1] = (next.vertices[slot * 3 + 1] ?? 0) + offset[1]
    next.vertices[slot * 3 + 2] = (next.vertices[slot * 3 + 2] ?? 0) + offset[2]
  }
  return next
}

/**
 * The same object with its origin offset folded into the mesh.
 *
 * Apply and set origin both rewrite the object's own matrix, and an offset kept in a second place
 * would have to be threaded through every step of both. Folding it in first costs one pass over the
 * vertices, moves nothing in the world, and removes the special case everywhere downstream.
 */
function withoutOriginOffset(object: SceneObject, mesh: MeshData): { object: SceneObject; mesh: MeshData } {
  const origin = object.origin
  if (!origin || (origin[0] === 0 && origin[1] === 0 && origin[2] === 0)) return { object, mesh }
  const next = { ...object }
  delete next.origin
  return { object: next, mesh: movedMesh(mesh, [-origin[0], -origin[1], -origin[2]]) }
}

/** The median of the vertices, which is where Blender puts an origin sent to the geometry. */
function vertexMedian(mesh: MeshData): Vec3 {
  const count = mesh.vertexIds.length
  if (count === 0) return [0, 0, 0]
  let x = 0
  let y = 0
  let z = 0
  for (let slot = 0; slot < count; slot += 1) {
    x += mesh.vertices[slot * 3] ?? 0
    y += mesh.vertices[slot * 3 + 1] ?? 0
    z += mesh.vertices[slot * 3 + 2] ?? 0
  }
  return [x / count, y / count, z / count]
}

/**
 * The centroid of the surface: each face's centre weighted by its area. It is the surface centre of
 * mass rather than the volume one, which is what Blender's "Origin to Center of Mass (Surface)"
 * computes and what a mesh with an open boundary can answer at all.
 */
function areaCentroid(mesh: MeshData): Vec3 {
  let total = 0
  let x = 0
  let y = 0
  let z = 0
  for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
    const area = faceArea(mesh, faceSlot)
    if (area <= 0) continue
    const centre = faceCentre(mesh, faceSlot)
    total += area
    x += centre[0] * area
    y += centre[1] * area
    z += centre[2] * area
  }
  if (total === 0) return vertexMedian(mesh)
  return [x / total, y / total, z / total]
}

/* --------------------------------------------------------------- duplicating */

function copyData(data: ObjectData): ObjectData {
  if (data.kind === 'light') return { ...data, areaSize: [data.areaSize[0], data.areaSize[1]] }
  if (data.kind === 'camera') {
    // A copy of the scene camera is not a second scene camera; the document allows only one.
    const copy = { ...data, ...(data.depthOfField ? { depthOfField: { ...data.depthOfField } } : {}) }
    delete copy.active
    return copy
  }
  return { ...data }
}

function copyObject(source: SceneObject, id: string, name: string, data: ObjectData): SceneObject {
  return {
    ...source,
    id,
    name,
    data,
    transform: {
      ...source.transform,
      position: [...source.transform.position],
      rotation: [...source.transform.rotation],
      scale: [...source.transform.scale],
      ...(source.transform.quaternion ? { quaternion: [...source.transform.quaternion] as [number, number, number, number] } : {}),
    },
    ...(source.origin ? { origin: [...source.origin] as Vec3 } : {}),
    modifiers: source.modifiers.map((modifier) => ({ ...modifier, id: newId('modifier'), enabled: { ...modifier.enabled }, params: { ...modifier.params } })),
    materialSlots: source.materialSlots.slice(),
    ...(source.shapeKeys ? { shapeKeys: source.shapeKeys.map((key) => ({ ...key, offsets: { ...key.offsets } })) } : {}),
  }
}

/**
 * ⇧D and ⌥D, which differ in one thing: whether the copy points at a new mesh or at the same one.
 *
 * A parent that is being duplicated as well is repointed at its own copy, so duplicating a rig
 * gives a second rig rather than a second set of limbs hanging off the first body. A parent that is
 * not in the selection is kept as it was.
 */
function duplicateSelection(context: OperatorContext, linked: boolean): OperatorResult {
  const sources = selectedObjects(context)
  const names = new Set(context.document.objects.map((object) => object.name))
  const meshes = { ...context.document.meshes }
  const copyIds = new Map<string, string>()
  const meshCopies = new Map<string, string>()
  const copies: SceneObject[] = []
  for (const source of sources) {
    const id = newId('object')
    copyIds.set(source.id, id)
    const name = uniqueName(names, source.name)
    names.add(name)
    let data = copyData(source.data)
    if (source.data.kind === 'mesh' && !linked) {
      // Two selected objects that already shared a mesh keep sharing, one copy between them: a
      // linked pair duplicated together should still be a linked pair.
      const meshId = meshCopies.get(source.data.meshId) ?? newId('mesh')
      if (!meshCopies.has(source.data.meshId)) {
        meshCopies.set(source.data.meshId, meshId)
        const mesh = context.document.meshes[source.data.meshId]
        if (mesh) meshes[meshId] = cloneMesh(mesh)
      }
      data = { kind: 'mesh', meshId }
    }
    copies.push(copyObject(source, id, name, data))
  }
  for (const copy of copies) {
    const parentCopy = copy.parentId ? copyIds.get(copy.parentId) : undefined
    if (parentCopy) copy.parentId = parentCopy
  }
  const active = activeObject(context)
  const activeCopy = (active ? copyIds.get(active.id) : undefined) ?? copies.at(-1)?.id ?? null
  return {
    document: { ...context.document, objects: [...context.document.objects, ...copies], meshes },
    selection: selectionOf(copies.map((copy) => copy.id), activeCopy),
    label: linked ? 'Duplicate linked' : 'Duplicate',
  }
}

registerOperator({
  id: 'object.duplicate',
  label: 'Duplicate objects',
  section: 'Object',
  shortcut: '⇧D',
  icon: 'mesh',
  description: 'Copy the selection, data and all, and select the copies.',
  params: [],
  defaults: {},
  mode: 'object',
  available: needsSelection,
  run: (context) => duplicateSelection(context, false),
})

registerOperator({
  id: 'object.duplicateLinked',
  label: 'Duplicate linked',
  section: 'Object',
  shortcut: '⌥D',
  icon: 'mesh',
  description: 'Copy the selection but share its data, so editing one copy edits them all.',
  params: [],
  defaults: {},
  mode: 'object',
  available: needsSelection,
  run: (context) => duplicateSelection(context, true),
})

registerOperator({
  id: 'object.makeSingleUser',
  label: 'Make single user',
  section: 'Object',
  icon: 'mesh',
  description: 'Give each selected object a mesh of its own, so editing it no longer edits its twin.',
  params: [],
  defaults: {},
  mode: 'object',
  available: (context) => {
    if (context.selection.objectIds.length === 0) return SELECT_FIRST
    const shared = meshObjects(selectedObjects(context)).some((object) =>
      object.data.kind === 'mesh' && meshUsers(context.document, object.data.meshId) > 1)
    return shared ? true : 'Every selected object already has data of its own.'
  },
  run: (context) => {
    const meshes = { ...context.document.meshes }
    const replacements = new Map<string, SceneObject>()
    for (const object of meshObjects(selectedObjects(context))) {
      if (object.data.kind !== 'mesh') continue
      if (meshUsers(context.document, object.data.meshId) < 2) continue
      const mesh = context.document.meshes[object.data.meshId]
      if (!mesh) continue
      const meshId = newId('mesh')
      meshes[meshId] = cloneMesh(mesh)
      replacements.set(object.id, { ...object, data: { kind: 'mesh', meshId } })
    }
    return { document: { ...replacing(context.document, replacements), meshes }, label: 'Make single user' }
  },
})

/* -------------------------------------------------------------------- join */

type EdgeFlags = { seam: boolean[]; sharp: boolean[]; crease: number[]; bevelWeight: number[] }

function fitBooleans(values: boolean[] | undefined, count: number): boolean[] {
  const list = new Array<boolean>(count).fill(false)
  if (values) for (let index = 0; index < Math.min(count, values.length); index += 1) list[index] = !!values[index]
  return list
}

function fitNumbers(values: number[] | undefined, count: number): number[] {
  const list = new Array<number>(count).fill(0)
  if (values) for (let index = 0; index < Math.min(count, values.length); index += 1) list[index] = values[index] ?? 0
  return list
}

/** Every edge flag as a full-length array, so two meshes can be appended without holes. */
function edgeFlags(mesh: MeshData): EdgeFlags {
  const count = mesh.edges.length
  return {
    seam: fitBooleans(mesh.attributes.edge.seam, count),
    sharp: fitBooleans(mesh.attributes.edge.sharp, count),
    crease: fitNumbers(mesh.attributes.edge.crease, count),
    bevelWeight: fitNumbers(mesh.attributes.edge.bevelWeight, count),
  }
}

function faceUv(mesh: MeshData, faceSlot: number, corners: number): number[] {
  const row = mesh.attributes.vertex.uv?.[faceSlot]
  if (row && row.length >= corners * 2) return row.slice(0, corners * 2)
  return new Array<number>(corners * 2).fill(0)
}

/** A material id's place in the merged list, appended if the joined object brought a new one. */
function materialIndex(merged: string[], id: string | undefined): number {
  if (!id) return 0
  const found = merged.indexOf(id)
  if (found >= 0) return found
  merged.push(id)
  return merged.length - 1
}

type JoinState = { mesh: MeshData; edges: EdgeFlags; uv: number[][] | null; materials: string[] }

function appendMesh(state: JoinState, source: MeshData, matrix: Matrix4, slots: string[]): void {
  const target = state.mesh
  const offset = target.vertexIds.length
  const point = new Vector3()
  for (let slot = 0; slot < source.vertexIds.length; slot += 1) {
    point.set(source.vertices[slot * 3] ?? 0, source.vertices[slot * 3 + 1] ?? 0, source.vertices[slot * 3 + 2] ?? 0)
    point.applyMatrix4(matrix)
    target.vertices.push(point.x, point.y, point.z)
    // Ids are handed out afresh rather than carried over: two meshes numbered from zero would
    // collide on every id, and a selection that survives an edit is worth more than a stable name.
    target.vertexIds.push(target.nextVertexId)
    target.nextVertexId += 1
  }
  const flags = edgeFlags(source)
  for (let index = 0; index < source.edges.length; index += 1) {
    const edge = source.edges[index]!
    const a = edge[0] + offset
    const b = edge[1] + offset
    target.edges.push(a < b ? [a, b] : [b, a])
    state.edges.seam.push(flags.seam[index] ?? false)
    state.edges.sharp.push(flags.sharp[index] ?? false)
    state.edges.crease.push(flags.crease[index] ?? 0)
    state.edges.bevelWeight.push(flags.bevelWeight[index] ?? 0)
  }
  // A source with a negative determinant — an odd number of mirrored axes — arrives inside out.
  const flip = matrix.determinant() < 0
  for (let faceSlot = 0; faceSlot < source.faces.length; faceSlot += 1) {
    const loop = source.faces[faceSlot]!.map((slot) => slot + offset)
    const corners = loop.length
    target.faces.push(flip ? loop.slice().reverse() : loop)
    target.faceIds.push(target.nextFaceId)
    target.nextFaceId += 1
    target.attributes.face.smooth.push(source.attributes.face.smooth[faceSlot] ?? false)
    target.attributes.face.material.push(materialIndex(state.materials, slots[source.attributes.face.material[faceSlot] ?? 0]))
    if (!state.uv) continue
    const row = faceUv(source, faceSlot, corners)
    if (!flip) {
      state.uv.push(row)
      continue
    }
    const flipped: number[] = []
    for (let corner = corners - 1; corner >= 0; corner -= 1) flipped.push(row[corner * 2] ?? 0, row[corner * 2 + 1] ?? 0)
    state.uv.push(flipped)
  }
}

registerOperator({
  id: 'object.join',
  label: 'Join',
  section: 'Object',
  shortcut: '⌃J',
  icon: 'mesh',
  description: 'Merge the selected meshes into the active one, in place.',
  params: [],
  defaults: {},
  mode: 'object',
  available: (context) => {
    if (context.selection.objectIds.length === 0) return SELECT_FIRST
    const active = activeObject(context)
    if (!active) return 'Click the object to join into last, so it is the active one.'
    if (active.data.kind !== 'mesh') return `“${active.name}” is not a mesh, so nothing can be joined into it.`
    const meshes = meshObjects(selectedObjects(context)).filter((object) => object.id !== active.id)
    return meshes.length > 0 ? true : 'Select at least one other mesh to join in.'
  },
  run: (context) => {
    const document = context.document
    const active = activeObject(context)
    const activeMesh = active ? meshOf(document, active) : null
    if (!active || !activeMesh) return { error: 'Click the object to join into last, so it is the active one.' }
    const sources = meshObjects(selectedObjects(context)).filter((object) => object.id !== active.id)
    const merged = cloneMesh(activeMesh)
    const wantsUv = merged.attributes.vertex.uv !== undefined
      || sources.some((object) => meshOf(document, object)?.attributes.vertex.uv !== undefined)
    const state: JoinState = {
      mesh: merged,
      edges: edgeFlags(merged),
      uv: wantsUv ? merged.faces.map((face, faceSlot) => faceUv(merged, faceSlot, face.length)) : null,
      materials: active.materialSlots.slice(),
    }
    const toActive = worldMatrix(document, active).invert()
    const removed = new Set<string>()
    for (const source of sources) {
      const mesh = meshOf(document, source)
      if (!mesh) continue
      appendMesh(state, mesh, toActive.clone().multiply(worldMatrix(document, source)), source.materialSlots)
      removed.add(source.id)
    }
    merged.attributes.edge = state.edges
    if (state.uv) merged.attributes.vertex.uv = state.uv
    // Vertex colours are stored flat with no stride the join can read, so a merged mesh drops them
    // rather than carrying an array whose length no longer matches anything.
    delete merged.attributes.vertex.color

    const worlds = new Map(document.objects.map((object) => [object.id, worldMatrix(document, object)] as const))
    const activeWorld = worlds.get(active.id) ?? IDENTITY
    const objects = document.objects.flatMap((object): SceneObject[] => {
      if (removed.has(object.id)) return []
      if (object.id === active.id) {
        return [{ ...object, materialSlots: state.materials }]
      }
      // A child of a joined object would otherwise be orphaned; Blender hands it to the active one.
      if (object.parentId && removed.has(object.parentId)) {
        return [reparented(object, worlds.get(object.id) ?? IDENTITY, activeWorld, active.id)]
      }
      return [object]
    })
    const meshId = active.data.kind === 'mesh' ? active.data.meshId : null
    const joined = withoutUnusedMeshes({
      ...withObjects(document, objects),
      meshes: meshId ? { ...document.meshes, [meshId]: merged } : document.meshes,
    })
    return { document: joined, selection: selectionOf([active.id], active.id), label: 'Join' }
  },
})

/* ------------------------------------------------------------------- apply */

const APPLY_WHAT = selectParam('what', 'Apply', [
  { value: 'location', label: 'Location' },
  { value: 'rotation', label: 'Rotation' },
  { value: 'scale', label: 'Scale' },
  { value: 'rotation-scale', label: 'Rotation and scale' },
  { value: 'all', label: 'All transforms' },
], 'rotation-scale')

/** The object's rotation alone, in whichever Euler order it names, with no position and no scale. */
function rotationMatrix(object: SceneObject): Matrix4 {
  return localMatrix({ transform: { ...object.transform, position: [0, 0, 0], scale: [1, 1, 1] } })
}

function scaleMatrix(object: SceneObject): Matrix4 {
  const [sx, sy, sz] = object.transform.scale
  return new Matrix4().makeScale(sx || 1e-6, sy || 1e-6, sz || 1e-6)
}

/**
 * The matrix an apply bakes into the mesh, following Blender to the letter.
 *
 * Applying only the location is the case worth reading twice: the vertices move by the location
 * seen from inside the object, which is the location put back through the rotation and scale that
 * are staying behind. Applying only the rotation of a non-uniformly scaled object shears it, in
 * Blender and here; that is the price of leaving the scale on the object, and Blender pays it too.
 */
function applyMatrix(object: SceneObject, location: boolean, rotation: boolean, scale: boolean): Matrix4 {
  const basis = new Matrix4().multiplyMatrices(rotationMatrix(object), scaleMatrix(object))
  let matrix = new Matrix4()
  if (rotation && scale) matrix = basis.clone()
  else if (scale) matrix = scaleMatrix(object)
  else if (rotation) matrix = rotationMatrix(object)
  if (!location) return matrix
  const offset = new Vector3(...object.transform.position)
  if (!(rotation && scale)) offset.applyMatrix4(new Matrix4().multiplyMatrices(matrix, basis.clone().invert()))
  return matrix.setPosition(offset)
}

registerOperator({
  id: 'object.applyTransform',
  label: 'Apply transform',
  section: 'Object',
  shortcut: '⌃A',
  icon: 'transform',
  description: 'Bake the transform into the mesh and set it back to nothing, leaving the object where it looks.',
  params: [APPLY_WHAT],
  defaults: { what: 'rotation-scale' },
  mode: 'object',
  available: needsMeshSelection,
  run: (context, params) => {
    const what = String(params.what)
    const location = what === 'location' || what === 'all'
    const rotation = what === 'rotation' || what === 'rotation-scale' || what === 'all'
    const scale = what === 'scale' || what === 'rotation-scale' || what === 'all'
    if (!location && !rotation && !scale) return { error: 'Choose which part of the transform to apply.' }

    const document = context.document
    const meshes = { ...document.meshes }
    const replacements = new Map<string, SceneObject>()
    for (const object of meshObjects(selectedObjects(context))) {
      if (object.data.kind !== 'mesh') continue
      const meshId = object.data.meshId
      if (meshUsers(document, meshId) > 1) {
        return { error: `“${object.name}” shares its mesh with another object. Make it single user before applying a transform.` }
      }
      const source = document.meshes[meshId]
      if (!source) continue
      const folded = withoutOriginOffset(object, source)
      const matrix = applyMatrix(folded.object, location, rotation, scale)
      meshes[meshId] = transformedMesh(folded.mesh, matrix)
      const transform: Transform = {
        ...folded.object.transform,
        position: location ? [0, 0, 0] : [...folded.object.transform.position],
        rotation: rotation ? [0, 0, 0] : [...folded.object.transform.rotation],
        scale: scale ? [1, 1, 1] : [...folded.object.transform.scale],
        ...(rotation && folded.object.transform.rotationMode === 'quaternion' ? { quaternion: [0, 0, 0, 1] as [number, number, number, number] } : {}),
      }
      replacements.set(object.id, { ...folded.object, transform })
    }
    if (replacements.size === 0) return { error: NO_MESH_SELECTED }
    return {
      document: { ...withObjects(document, keepChildrenInPlace(document, replacements)), meshes },
      label: 'Apply transform',
    }
  },
})

/* -------------------------------------------------------------- set origin */

const ORIGIN_TO = selectParam('to', 'Set origin', [
  { value: 'origin-to-geometry', label: 'Origin to geometry' },
  { value: 'cursor', label: 'Origin to 3D cursor' },
  { value: 'centre-of-mass', label: 'Origin to centre of mass' },
  { value: 'geometry', label: 'Geometry to origin' },
], 'origin-to-geometry')

registerOperator({
  id: 'object.setOrigin',
  label: 'Set origin',
  section: 'Object',
  icon: 'cursor',
  description: 'Move the point the object turns and scales around, leaving the geometry where it is.',
  params: [ORIGIN_TO],
  defaults: { to: 'origin-to-geometry' },
  mode: 'object',
  available: needsMeshSelection,
  run: (context, params) => {
    const to = String(params.to)
    const document = context.document
    const meshes = { ...document.meshes }
    const replacements = new Map<string, SceneObject>()
    for (const object of meshObjects(selectedObjects(context))) {
      if (object.data.kind !== 'mesh') continue
      const meshId = object.data.meshId
      if (meshUsers(document, meshId) > 1) {
        return { error: `“${object.name}” shares its mesh with another object. Make it single user before moving its origin.` }
      }
      const source = document.meshes[meshId]
      if (!source) continue
      const folded = withoutOriginOffset(object, source)
      if (to === 'geometry') {
        // The one direction that moves the geometry rather than the origin: Blender's "Geometry to
        // origin" slides the mesh until its median sits on the object's own centre.
        const median = vertexMedian(folded.mesh)
        meshes[meshId] = movedMesh(folded.mesh, [-median[0], -median[1], -median[2]])
        replacements.set(object.id, folded.object)
        continue
      }
      const target = new Vector3()
      if (to === 'cursor') target.set(...context.cursor.position)
      else {
        const local = to === 'centre-of-mass' ? areaCentroid(folded.mesh) : vertexMedian(folded.mesh)
        target.set(...local).applyMatrix4(worldMatrix(document, folded.object))
      }
      const position = target.clone().applyMatrix4(parentMatrix(document, folded.object).invert())
      const moved: SceneObject = {
        ...folded.object,
        transform: { ...folded.object.transform, position: [position.x, position.y, position.z] },
      }
      // Between the two frames, so every vertex comes out exactly where it went in.
      const shift = localMatrix(moved).invert().multiply(localMatrix(folded.object))
      meshes[meshId] = transformedMesh(folded.mesh, shift)
      replacements.set(object.id, moved)
    }
    if (replacements.size === 0) return { error: NO_MESH_SELECTED }
    return {
      document: { ...withObjects(document, keepChildrenInPlace(document, replacements)), meshes },
      label: 'Set origin',
    }
  },
})

/* --------------------------------------------------------------- parenting */

const KEEP_TRANSFORM = switchParam('keepTransform', 'Keep transform', true)

/**
 * The parameter types are written out rather than inferred from `defaults`, here and below.
 * Inference reads `true` as the literal type `true`, and an operator whose switch can only ever
 * be true is an operator whose switch does nothing.
 */
type KeepTransformParams = { keepTransform: boolean }

registerOperator<KeepTransformParams>({
  id: 'object.parent',
  label: 'Parent',
  section: 'Object',
  shortcut: '⌃P',
  description: 'Put the selection under the active object, so it follows wherever that goes.',
  params: [KEEP_TRANSFORM],
  defaults: { keepTransform: true },
  mode: 'object',
  available: (context) => {
    if (context.selection.objectIds.length === 0) return SELECT_FIRST
    const active = activeObject(context)
    if (!active) return 'Click the parent last, so it is the active object.'
    return selectedObjects(context).some((object) => object.id !== active.id)
      ? true
      : 'Select the children as well, then the parent last.'
  },
  run: (context, params) => {
    const document = context.document
    const active = activeObject(context)
    if (!active) return { error: 'Click the parent last, so it is the active object.' }
    const children = selectedObjects(context).filter((object) => object.id !== active.id)
    if (children.length === 0) return { error: 'Select the children as well, then the parent last.' }
    for (const child of children) {
      if (descendantObjectIds(document, child.id).includes(active.id)) {
        return { error: `“${active.name}” is already under “${child.name}”, so parenting them would make a loop.` }
      }
    }
    const keep = params.keepTransform !== false
    const parentWorld = worldMatrix(document, active)
    const replacements = new Map<string, SceneObject>()
    for (const child of children) {
      replacements.set(child.id, keep
        ? reparented(child, worldMatrix(document, child), parentWorld, active.id)
        : { ...child, parentId: active.id })
    }
    return { document: replacing(document, replacements), label: 'Parent' }
  },
})

registerOperator<KeepTransformParams>({
  id: 'object.clearParent',
  label: 'Clear parent',
  section: 'Object',
  shortcut: '⌥P',
  description: 'Take the selection out from under its parent.',
  params: [KEEP_TRANSFORM],
  defaults: { keepTransform: true },
  mode: 'object',
  available: (context) => {
    if (context.selection.objectIds.length === 0) return SELECT_FIRST
    return selectedObjects(context).some((object) => object.parentId) ? true : 'Nothing selected has a parent.'
  },
  run: (context, params) => {
    const document = context.document
    const keep = params.keepTransform !== false
    const replacements = new Map<string, SceneObject>()
    for (const object of selectedObjects(context)) {
      if (!object.parentId) continue
      if (keep) {
        replacements.set(object.id, reparented(object, worldMatrix(document, object), IDENTITY, undefined))
      } else {
        const next = { ...object }
        delete next.parentId
        replacements.set(object.id, next)
      }
    }
    if (replacements.size === 0) return { error: 'Nothing selected has a parent.' }
    return { document: replacing(document, replacements), label: 'Clear parent' }
  },
})

/* ------------------------------------------------------------- collections */

/**
 * The schema carries only the scene collection, because a schema is written once at import and a
 * document's collections are not. The Object menu builds its submenu from the document and passes
 * the id it wants; the F9 panel then shows the one entry it can name for certain.
 */
const COLLECTION_PARAM = selectParam('collectionId', 'Collection', [
  { value: ROOT_COLLECTION_ID, label: ROOT_COLLECTION_NAME },
], ROOT_COLLECTION_ID)

registerOperator({
  id: 'object.moveToCollection',
  label: 'Move to collection',
  section: 'Collection',
  shortcut: 'M',
  icon: 'collection',
  description: 'Move the selection into another collection.',
  params: [COLLECTION_PARAM],
  defaults: { collectionId: ROOT_COLLECTION_ID },
  mode: 'object',
  available: needsSelection,
  run: (context, params) => {
    const collectionId = String(params.collectionId)
    const collection = context.document.collections.find((entry) => entry.id === collectionId)
    if (!collection) return { error: 'That collection is not in this scene.' }
    const replacements = new Map<string, SceneObject>()
    for (const object of selectedObjects(context)) {
      if (object.collectionId === collectionId) continue
      replacements.set(object.id, { ...object, collectionId })
    }
    if (replacements.size === 0) return { error: `Everything selected is already in “${collection.name}”.` }
    return { document: replacing(context.document, replacements), label: `Move to “${collection.name}”` }
  },
})

registerOperator({
  id: 'object.linkToCollection',
  label: 'Link to collection',
  section: 'Collection',
  shortcut: '⇧M',
  icon: 'collection',
  description: 'Put a linked copy of the selection in another collection, sharing its data.',
  params: [COLLECTION_PARAM],
  defaults: { collectionId: ROOT_COLLECTION_ID },
  mode: 'object',
  available: needsSelection,
  run: (context, params) => {
    const collectionId = String(params.collectionId)
    const collection = context.document.collections.find((entry) => entry.id === collectionId)
    if (!collection) return { error: 'That collection is not in this scene.' }
    // An object in this document belongs to exactly one collection, so Blender's link — the same
    // object appearing in two — is expressed as a linked copy: same mesh, second collection.
    const result = duplicateSelection(context, true)
    if (!result.document) return result
    const linkedIds = new Set(result.selection?.objectIds ?? [])
    const objects = result.document.objects.map((object) => (linkedIds.has(object.id) ? { ...object, collectionId } : object))
    return {
      document: withObjects(result.document, objects),
      selection: result.selection,
      label: `Link to “${collection.name}”`,
    }
  },
})

/* ------------------------------------------------------------- visibility */

registerOperator({
  id: 'object.hide',
  label: 'Hide selected',
  section: 'Object',
  shortcut: 'H',
  icon: 'eye-closed',
  description: 'Hide the selection in the viewport.',
  params: [],
  defaults: {},
  mode: 'object',
  available: needsSelection,
  run: (context) => {
    const replacements = new Map<string, SceneObject>()
    for (const object of selectedObjects(context)) replacements.set(object.id, { ...object, visible: false })
    // A hidden object that stayed selected would still take a transform it could not be seen to take.
    return { document: replacing(context.document, replacements), selection: selectionOf([], null), label: 'Hide selected' }
  },
})

registerOperator({
  id: 'object.hideUnselected',
  label: 'Hide unselected',
  section: 'Object',
  shortcut: '⇧H',
  icon: 'eye-closed',
  description: 'Hide everything except the selection.',
  params: [],
  defaults: {},
  mode: 'object',
  available: needsSelection,
  run: (context) => {
    const replacements = new Map<string, SceneObject>()
    for (const object of context.document.objects) {
      if (context.selection.objectIds.includes(object.id) || !object.visible) continue
      replacements.set(object.id, { ...object, visible: false })
    }
    if (replacements.size === 0) return { error: 'Everything visible is already selected.' }
    return { document: replacing(context.document, replacements), label: 'Hide unselected' }
  },
})

registerOperator<{ select: boolean }>({
  id: 'object.revealHidden',
  label: 'Reveal hidden',
  section: 'Object',
  shortcut: '⌥H',
  icon: 'eye-open',
  description: 'Show everything that was hidden.',
  params: [switchParam('select', 'Select them', true)],
  defaults: { select: true },
  mode: 'object',
  // The one operator in the family that needs no selection: nothing selected is the usual way to
  // arrive here, having hidden the thing you now want back.
  available: (context) => (context.document.objects.some((object) => !object.visible) ? true : 'Nothing is hidden.'),
  run: (context, params) => {
    const revealed: string[] = []
    const replacements = new Map<string, SceneObject>()
    for (const object of context.document.objects) {
      if (object.visible) continue
      revealed.push(object.id)
      replacements.set(object.id, { ...object, visible: true })
    }
    if (revealed.length === 0) return { error: 'Nothing is hidden.' }
    const select = params.select !== false
    return {
      document: replacing(context.document, replacements),
      ...(select ? { selection: selectionOf(revealed, revealed.at(-1) ?? null) } : {}),
      label: 'Reveal hidden',
    }
  },
})

/* ------------------------------------------------------------------ naming */

registerOperator({
  id: 'object.rename',
  label: 'Rename',
  section: 'Object',
  shortcut: 'F2',
  description: 'Give the active object another name.',
  params: [textParam('name', 'Name', '')],
  defaults: { name: '' },
  mode: 'object',
  available: (context) => (activeObject(context) ? true : SELECT_FIRST),
  run: (context, params) => {
    const active = activeObject(context)
    if (!active) return { error: SELECT_FIRST }
    const wanted = String(params.name ?? '').trim()
    if (!wanted) return { error: 'Type a name for the object.' }
    const taken = context.document.objects.filter((object) => object.id !== active.id).map((object) => object.name)
    const name = uniqueName(taken, wanted.slice(0, 120))
    if (name === active.name) return { error: `It is already called “${name}”.` }
    return {
      document: replacing(context.document, new Map([[active.id, { ...active, name }]])),
      label: `Rename to “${name}”`,
    }
  },
})

/* -------------------------------------------------------------- the delete */

registerOperator<{ hierarchy: boolean }>({
  id: 'object.delete',
  label: 'Delete',
  section: 'Object',
  shortcut: 'Delete',
  description: 'Remove the selection from the scene.',
  params: [switchParam('hierarchy', 'Children too', false)],
  defaults: { hierarchy: false },
  mode: 'object',
  available: needsSelection,
  run: (context, params) => {
    const document = context.document
    const hierarchy = params.hierarchy === true
    const doomed = new Set(context.selection.objectIds)
    if (hierarchy) {
      for (const id of context.selection.objectIds) for (const child of descendantObjectIds(document, id)) doomed.add(child)
    }
    const worlds = new Map(document.objects.map((object) => [object.id, worldMatrix(document, object)] as const))
    /** The first ancestor that is staying, which is where an orphan goes. */
    const survivor = (id: string | undefined): string | undefined => {
      let cursor = id
      const seen = new Set<string>()
      while (cursor && doomed.has(cursor) && !seen.has(cursor)) {
        seen.add(cursor)
        cursor = objectById(document, cursor)?.parentId
      }
      return cursor && !doomed.has(cursor) ? cursor : undefined
    }
    const objects = document.objects.flatMap((object): SceneObject[] => {
      if (doomed.has(object.id)) return []
      if (!object.parentId || !doomed.has(object.parentId)) return [object]
      const parentId = survivor(object.parentId)
      const parentWorld = parentId ? worlds.get(parentId) ?? IDENTITY : IDENTITY
      return [reparented(object, worlds.get(object.id) ?? IDENTITY, parentWorld, parentId)]
    })
    return {
      document: withoutUnusedMeshes(withObjects(document, objects)),
      selection: selectionOf([], null),
      label: doomed.size === 1 ? 'Delete' : `Delete ${doomed.size} objects`,
    }
  },
})

/* --------------------------------------------------------------- clipboard */

const CLIPBOARD_KIND = 'paramrig.scene.objects'

/**
 * What copy puts on the clipboard: the objects, the meshes they need, the collections they sat in
 * and the materials their slots point at, plus where the selection was so that paste can land it
 * somewhere sensible. It is JSON because it travels through the system clipboard, which carries
 * text and nothing else.
 */
export type ObjectClipboard = {
  kind: typeof CLIPBOARD_KIND
  version: 1
  origin: Vec3
  objects: SceneObject[]
  meshes: Record<string, MeshData>
  collections: Collection[]
  materials: Material[]
  /**
   * The controls that were writing to what was copied, carried along so that pasting into a rig
   * that has the same controls keeps them working. Only the bindings that belong to an object
   * travel: a material's binding belongs to the material, which is shared rather than copied.
   */
  bindings?: SceneBinding[]
}

/** An operator result that also carries something for the editor's own clipboard. */
/** `OperatorResult` carries `clipboard` itself now; the alias is kept for the tests' clarity. */
export type ClipboardResult = OperatorResult

export function serializeObjects(document: SceneDocument, ids: string[]): string {
  const objects = document.objects.filter((object) => ids.includes(object.id))
  const bindings = (document.rig?.bindings ?? []).filter((binding) => binding.objectId && ids.includes(binding.objectId))
  const meshIds = new Set(objects.flatMap((object) => (object.data.kind === 'mesh' ? [object.data.meshId] : [])))
  const meshes: Record<string, MeshData> = {}
  for (const id of meshIds) {
    const mesh = document.meshes[id]
    if (mesh) meshes[id] = mesh
  }
  const collectionIds = new Set(objects.map((object) => object.collectionId))
  const slots = new Set(objects.flatMap((object) => object.materialSlots))
  let origin: Vec3 = [0, 0, 0]
  if (objects.length > 0) {
    let x = 0
    let y = 0
    let z = 0
    for (const object of objects) {
      const point = originInWorld(document, object)
      x += point[0]
      y += point[1]
      z += point[2]
    }
    origin = [x / objects.length, y / objects.length, z / objects.length]
  }
  const payload: ObjectClipboard = {
    kind: CLIPBOARD_KIND,
    version: 1,
    origin,
    objects,
    meshes,
    collections: document.collections.filter((collection) => collectionIds.has(collection.id)),
    materials: document.materials.filter((material) => slots.has(material.id)),
    ...(bindings.length > 0 ? { bindings } : {}),
  }
  return JSON.stringify(payload)
}

/**
 * The clipboard read back, through the document sanitiser rather than a reader of its own: a
 * payload arrives from outside the editor, and the one place that knows every invariant a document
 * has to satisfy is the place that reads documents.
 */
function readClipboard(payload: string): ObjectClipboard | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const source = parsed as Partial<ObjectClipboard>
  if (source.kind !== CLIPBOARD_KIND) return null
  const collections = Array.isArray(source.collections) && source.collections.length > 0
    ? source.collections
    : [{ id: ROOT_COLLECTION_ID, name: ROOT_COLLECTION_NAME }]
  const read = sanitizeSceneDocument({
    version: 1,
    id: 'clipboard',
    name: 'Clipboard',
    objects: source.objects,
    meshes: source.meshes,
    collections,
    materials: source.materials,
    world: {},
    cursor: {},
    view: {},
    units: {},
    createdAt: '',
    updatedAt: '',
  })
  if (!read) return null
  const origin = Array.isArray(source.origin) && source.origin.length === 3
    ? source.origin.map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0)) as Vec3
    : [0, 0, 0] as Vec3
  /*
   * The bindings are read through the same sanitiser the rest of the payload goes through, against
   * the clipboard's own objects: a payload naming an object it does not carry is refused here
   * rather than after it has been pasted. The parameter ids are checked later, against the document
   * being pasted into — which is the only place that knows them.
   */
  const parameterIds = new Set((Array.isArray(source.bindings) ? source.bindings : []).flatMap((binding) => (
    binding && typeof binding === 'object' && typeof (binding as SceneBinding).parameterId === 'string'
      ? [(binding as SceneBinding).parameterId]
      : []
  )))
  const bindings = sanitizeSceneRig(
    {
      groups: [DEFAULT_SCENE_GROUP],
      parameters: [...parameterIds].map((id) => ({ kind: 'number', id, label: id, group: 'main', min: 0, max: 1, step: 1, defaultValue: 0 })),
      bindings: source.bindings ?? [],
    },
    sceneRigTargets(read),
  )?.bindings ?? []
  return {
    kind: CLIPBOARD_KIND,
    version: 1,
    origin,
    objects: read.objects,
    meshes: read.meshes,
    collections: read.collections,
    materials: read.materials,
    ...(bindings.length > 0 ? { bindings } : {}),
  }
}

/**
 * Objects from a clipboard payload dropped into a document at the cursor.
 *
 * Everything is renumbered: ids, mesh ids, names. Sharing inside the payload survives — two objects
 * that pointed at one mesh still point at one mesh — because a linked pair copied together and
 * pasted apart would otherwise stop being a pair.
 */
export function pasteObjects(document: SceneDocument, payload: string, cursor: Vec3): OperatorResult {
  const clipboard = readClipboard(payload)
  if (!clipboard) return { error: 'That is not something the scene editor can paste.' }
  if (clipboard.objects.length === 0) return { error: 'There are no objects on the clipboard.' }

  const meshes = { ...document.meshes }
  const meshIds = new Map<string, string>()
  for (const [id, mesh] of Object.entries(clipboard.meshes)) {
    const fresh = newId('mesh')
    meshIds.set(id, fresh)
    meshes[fresh] = mesh
  }
  const materials = [...document.materials]
  const known = new Set(materials.map((material) => material.id))
  for (const material of clipboard.materials) {
    if (known.has(material.id)) continue
    known.add(material.id)
    materials.push(material)
  }
  const collectionIds = new Set(document.collections.map((collection) => collection.id))
  const rootId = document.collections[0]?.id ?? ROOT_COLLECTION_ID
  const names = new Set(document.objects.map((object) => object.name))
  const objectIds = new Map<string, string>()
  const modifierIds = new Map<string, string>()
  const pasted: SceneObject[] = []
  for (const source of clipboard.objects) {
    const id = newId('object')
    objectIds.set(source.id, id)
    const name = uniqueName(names, source.name)
    names.add(name)
    const data = source.data.kind === 'mesh'
      ? { kind: 'mesh' as const, meshId: meshIds.get(source.data.meshId) ?? source.data.meshId }
      : copyData(source.data)
    const object = copyObject(source, id, name, data)
    object.collectionId = collectionIds.has(source.collectionId) ? source.collectionId : rootId
    // A copy gets fresh modifier ids, so any binding that named one has to be told the new name.
    source.modifiers.forEach((modifier, index) => {
      const fresh = object.modifiers[index]
      if (fresh) modifierIds.set(`${source.id}|${modifier.id}`, fresh.id)
    })
    pasted.push(object)
  }
  const delta: Vec3 = [cursor[0] - clipboard.origin[0], cursor[1] - clipboard.origin[1], cursor[2] - clipboard.origin[2]]
  for (const object of pasted) {
    const parentId = object.parentId ? objectIds.get(object.parentId) : undefined
    if (parentId) {
      object.parentId = parentId
      continue
    }
    // A parent left behind in the other document is dropped, and only the objects that ended up at
    // the top level are moved: a child's position is read in its parent's frame, not the world's.
    delete object.parentId
    const [x, y, z] = object.transform.position
    object.transform = { ...object.transform, position: [x + delta[0], y + delta[1], z + delta[2]] }
  }
  const ids = pasted.map((object) => object.id)
  const rig = pastedBindings(document, clipboard, objectIds, modifierIds)
  return {
    document: { ...document, objects: [...document.objects, ...pasted], meshes, materials, ...(rig ? { rig } : {}) },
    selection: selectionOf(ids, ids.at(-1) ?? null),
    label: pasted.length === 1 ? 'Paste object' : `Paste ${pasted.length} objects`,
  }
}

/**
 * The rig after a paste: the copied bindings re-pointed at the objects that were just made.
 *
 * A binding is kept only when the control it names is in *this* document — the same rule the file
 * reader keeps. Pasting a rigged object into a document with no rig therefore pastes geometry and
 * nothing else, which is the honest answer: the control it was driven by is not there.
 */
function pastedBindings(
  document: SceneDocument,
  clipboard: ObjectClipboard,
  objectIds: Map<string, string>,
  modifierIds: Map<string, string>,
): SceneRig | null {
  const rig = document.rig
  const carried = clipboard.bindings ?? []
  if (!rig || carried.length === 0) return null
  const known = new Set(rig.parameters.map((parameter) => parameter.id))
  const added = carried.flatMap((binding): SceneBinding[] => {
    const objectId = binding.objectId ? objectIds.get(binding.objectId) : undefined
    if (!objectId || !known.has(binding.parameterId)) return []
    const path = parseSceneProperty(binding.property)
    if (!path) return []
    const property = path.kind === 'modifier'
      ? `modifiers[${modifierIds.get(`${binding.objectId}|${path.modifierId}`) ?? path.modifierId}].${path.param}`
      : binding.property
    return [{ ...binding, id: newId('binding'), objectId, property }]
  })
  return added.length > 0 ? { ...rig, bindings: [...rig.bindings, ...added] } : null
}

registerOperator({
  id: 'object.copy',
  label: 'Copy objects',
  section: 'Object',
  shortcut: '⌃C',
  description: 'Put the selection on the clipboard, data and all.',
  params: [],
  defaults: {},
  mode: 'object',
  available: needsSelection,
  run: (context): ClipboardResult => ({
    clipboard: serializeObjects(context.document, context.selection.objectIds),
    label: 'Copy objects',
  }),
})

registerOperator({
  id: 'object.paste',
  label: 'Paste objects',
  section: 'Object',
  shortcut: '⌃V',
  description: 'Drop the clipboard into the scene at the 3D cursor.',
  // The payload is handed in by the editor, which owns the clipboard; it is not a field a person
  // types into, so it is a default without a schema entry rather than a text field in the F9 panel.
  params: [],
  defaults: { payload: '' },
  mode: 'object',
  available: () => true,
  run: (context, params) => {
    const payload = String(params.payload ?? '')
    if (!payload) return { error: 'There is nothing on the clipboard.' }
    return pasteObjects(context.document, payload, context.cursor.position)
  },
})

/* ---------------------------------------------------- clearing a transform */

function clearTransform(context: OperatorContext, part: 'position' | 'rotation' | 'scale', label: string): OperatorResult {
  const replacements = new Map<string, SceneObject>()
  for (const object of selectedObjects(context)) {
    const transform: Transform = { ...object.transform }
    if (part === 'position') transform.position = [0, 0, 0]
    if (part === 'scale') transform.scale = [1, 1, 1]
    if (part === 'rotation') {
      transform.rotation = [0, 0, 0]
      if (transform.rotationMode === 'quaternion') transform.quaternion = [0, 0, 0, 1]
    }
    replacements.set(object.id, { ...object, transform })
  }
  return { document: replacing(context.document, replacements), label }
}

registerOperator({
  id: 'object.clearLocation',
  label: 'Clear location',
  section: 'Object',
  shortcut: '⌥G',
  icon: 'move',
  description: 'Send the selection back to its own origin.',
  params: [],
  defaults: {},
  mode: 'object',
  available: needsSelection,
  run: (context) => clearTransform(context, 'position', 'Clear location'),
})

registerOperator({
  id: 'object.clearRotation',
  label: 'Clear rotation',
  section: 'Object',
  shortcut: '⌥R',
  icon: 'rotate',
  description: 'Turn the selection back to no rotation at all.',
  params: [],
  defaults: {},
  mode: 'object',
  available: needsSelection,
  run: (context) => clearTransform(context, 'rotation', 'Clear rotation'),
})

registerOperator({
  id: 'object.clearScale',
  label: 'Clear scale',
  section: 'Object',
  shortcut: '⌥S',
  icon: 'scale',
  description: 'Put the selection back to its true size.',
  params: [],
  defaults: {},
  mode: 'object',
  available: needsSelection,
  run: (context) => clearTransform(context, 'scale', 'Clear scale'),
})

/* ---------------------------------------------------------------- shading */

function shade(context: OperatorContext, smooth: boolean, autoSmooth: boolean, angle: number): OperatorResult {
  const meshes = { ...context.document.meshes }
  let touched = 0
  for (const object of meshObjects(selectedObjects(context))) {
    if (object.data.kind !== 'mesh') continue
    const source = context.document.meshes[object.data.meshId]
    if (!source) continue
    // Shading is mesh data, so a linked twin is shaded too. That is Blender's behaviour and the
    // point of a linked duplicate.
    const mesh = cloneMesh(source)
    mesh.attributes.face.smooth = mesh.faces.map(() => smooth)
    if (smooth && autoSmooth) mesh.autoSmooth = { enabled: true, angle }
    else delete mesh.autoSmooth
    meshes[object.data.meshId] = mesh
    touched += 1
  }
  if (touched === 0) return { error: NO_MESH_SELECTED }
  return { document: { ...context.document, meshes }, label: smooth ? 'Shade smooth' : 'Shade flat' }
}

registerOperator<{ autoSmooth: boolean; angle: number }>({
  id: 'object.shadeSmooth',
  label: 'Shade smooth',
  section: 'Object',
  icon: 'smooth',
  description: 'Blend the shading across every face of the selection.',
  params: [
    switchParam('autoSmooth', 'Keep sharp edges', false),
    numberParam('angle', 'Angle', { min: 0, max: 180, step: 1, defaultValue: 30, unit: '°', view: 'angle' }),
  ],
  defaults: { autoSmooth: false, angle: 30 },
  mode: 'object',
  available: needsMeshSelection,
  run: (context, params) => shade(context, true, params.autoSmooth === true, Number(params.angle) || 30),
})

registerOperator({
  id: 'object.shadeFlat',
  label: 'Shade flat',
  section: 'Object',
  icon: 'face-mode',
  description: 'Give every face of the selection its own flat shading.',
  params: [],
  defaults: {},
  mode: 'object',
  available: needsMeshSelection,
  run: (context) => shade(context, false, false, 30),
})

/* ---------------------------------------------------------------- snapping */

/*
 * Snapping the selection to the cursor, and the cursor to the selection, lives in
 * `src/scene/operators/cursor.ts` under the `cursor.*` ids: it is one family, and the ⇧S pie is
 * built from it. Registering a second set here under `object.*` would have put every one of those
 * actions in the palette twice, saying the same thing.
 */

/* ------------------------------------------------- aligning and randomising */

const AXIS = selectParam('axis', 'Axis', [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
], 'x')

const ALIGN_MODE = selectParam('mode', 'Side', [
  { value: 'min', label: 'Negative side' },
  { value: 'centre', label: 'Centre' },
  { value: 'max', label: 'Positive side' },
], 'centre')

const ALIGN_TO = selectParam('relativeTo', 'Relative to', [
  { value: 'selection', label: 'The selection' },
  { value: 'cursor', label: 'The 3D cursor' },
  { value: 'world', label: 'The world origin' },
], 'selection')

function edgeOf(box: Box, axis: number, mode: string): number {
  const min = box.min[axis] ?? 0
  const max = box.max[axis] ?? 0
  if (mode === 'min') return min
  if (mode === 'max') return max
  return (min + max) / 2
}

registerOperator({
  id: 'object.align',
  label: 'Align objects',
  section: 'Object',
  icon: 'transform',
  description: 'Line the selection up along one axis.',
  params: [AXIS, ALIGN_MODE, ALIGN_TO],
  defaults: { axis: 'x', mode: 'centre', relativeTo: 'selection' },
  mode: 'object',
  available: (context) => {
    if (context.selection.objectIds.length === 0) return SELECT_FIRST
    return context.selection.objectIds.length > 1 ? true : 'Select at least two objects to line up.'
  },
  run: (context, params) => {
    const axis = ['x', 'y', 'z'].indexOf(String(params.axis))
    if (axis < 0) return { error: 'Choose an axis to line the objects up along.' }
    const mode = String(params.mode)
    const relativeTo = String(params.relativeTo)
    const objects = selectedObjects(context)
    const boxes = new Map<string, Box>()
    let union: Box | null = null
    for (const object of objects) {
      const box = objectBounds(context.document, object)
      if (!box) continue
      boxes.set(object.id, box)
      union = unionBounds(union, box)
    }
    if (!union) return { error: 'There is nothing here with a size to line up.' }
    const target = relativeTo === 'cursor'
      ? context.cursor.position[axis] ?? 0
      : relativeTo === 'world' ? 0 : edgeOf(union, axis, mode)
    const replacements = new Map<string, SceneObject>()
    for (const object of objects) {
      const box = boxes.get(object.id)
      if (!box) continue
      const delta: Vec3 = [0, 0, 0]
      delta[axis] = target - edgeOf(box, axis, mode)
      replacements.set(object.id, movedInWorld(context.document, object, delta))
    }
    return { document: replacing(context.document, replacements), label: 'Align objects' }
  },
})

/**
 * A small deterministic generator, so that the same seed gives the same scatter every time. The F9
 * panel replays the operator against the document as it was, and a scatter that came out different
 * on each replay would make the panel useless for exactly the operator that most needs it.
 */
function randomNumbers(seed: number): () => number {
  let state = Math.floor(seed) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

type RandomizeParams = { seed: number; location: number; rotation: number; scale: number; uniformScale: boolean }

registerOperator<RandomizeParams>({
  id: 'object.randomizeTransform',
  label: 'Randomize transform',
  section: 'Object',
  icon: 'transform',
  description: 'Scatter the selection a little, by the same amount every time for a given seed.',
  params: [
    numberParam('seed', 'Seed', { min: 0, max: 9999, step: 1, defaultValue: 0, view: 'seed' }),
    numberParam('location', 'Location', { min: 0, max: 100, step: 0.01, defaultValue: 1, unit: 'm' }),
    numberParam('rotation', 'Rotation', { min: 0, max: 180, step: 1, defaultValue: 0, unit: '°', view: 'angle' }),
    numberParam('scale', 'Scale', { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
    switchParam('uniformScale', 'Same on every axis', true),
  ],
  defaults: { seed: 0, location: 1, rotation: 0, scale: 0, uniformScale: true },
  mode: 'object',
  available: needsSelection,
  run: (context, params) => {
    const seed = Math.floor(Number(params.seed) || 0)
    const location = Math.max(0, Number(params.location) || 0)
    const rotation = Math.max(0, Number(params.rotation) || 0)
    const scale = Math.min(1, Math.max(0, Number(params.scale) || 0))
    const uniform = params.uniformScale !== false
    const replacements = new Map<string, SceneObject>()
    const objects = selectedObjects(context)
    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index]!
      const random = randomNumbers(seed + index * 2654435761)
      const spread = (amount: number) => (random() * 2 - 1) * amount
      const factor = uniform ? 1 + spread(scale) : 0
      const transform: Transform = {
        ...object.transform,
        position: [
          object.transform.position[0] + spread(location),
          object.transform.position[1] + spread(location),
          object.transform.position[2] + spread(location),
        ],
        rotation: [
          object.transform.rotation[0] + spread(rotation),
          object.transform.rotation[1] + spread(rotation),
          object.transform.rotation[2] + spread(rotation),
        ],
        scale: [
          object.transform.scale[0] * Math.max(1e-3, uniform ? factor : 1 + spread(scale)),
          object.transform.scale[1] * Math.max(1e-3, uniform ? factor : 1 + spread(scale)),
          object.transform.scale[2] * Math.max(1e-3, uniform ? factor : 1 + spread(scale)),
        ],
      }
      replacements.set(object.id, { ...object, transform })
    }
    return { document: replacing(context.document, replacements), label: 'Randomize transform' }
  },
})
