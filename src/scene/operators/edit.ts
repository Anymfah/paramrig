import { curveCage } from '@/scene/curve/cage'
import { meshOf, withMesh } from '@/scene/document'
import { edgeKey } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { remapShapeKeys } from '@/scene/mesh/shapeKeys'
import { editedObjectIds, fromElements, selectNone, toElements, type ElementSelection } from '@/scene/mesh/selection'
import type { Availability, OperatorContext, OperatorResult } from '@/scene/operators/types'
import type { CurveData, ElementRef, MeshData, SceneDocument, SceneObject, SceneSelection, SelectMode } from '@/scene/types'

/**
 * What every mesh operator stands on.
 *
 * A mesh operator is written against slots, because slots are what an adjacency query answers with
 * and what a mutation takes. A document is written in ids, because ids survive a mutation somewhere
 * else in the mesh. Everything in this module is the crossing between the two: it resolves the
 * document's selection to slots on the way in, and the operator's answer back to ids on the way
 * out, once, in one place — so that eighty operators do not each write the conversion, and each get
 * it slightly wrong.
 *
 * It is also where multi-object edit mode lives. Blender runs a modelling operator on every object
 * that is open for editing, each with its own selection, and answers with what it managed; an
 * operator written here gets one target at a time and never has to know how many there were.
 */

/** One object open for editing, its mesh built, its selection resolved to slots. */
export type EditTarget = {
  object: SceneObject
  /** Empty for a curve: its cage belongs to no mesh in the document. */
  meshId: string
  /** The curve the cage was built from, when the object open for editing is one. */
  curve?: CurveData
  mesh: EditMesh
  /** The selection as slots in `mesh`. Faces and edges do not imply their vertices here. */
  vertices: Set<number>
  edges: Set<number>
  faces: Set<number>
  /** The active element as a slot, when the active element belongs to this object. */
  active: { kind: SelectMode; slot: number } | null
  /**
   * The same selection as ids, read before the operator touched anything. Slots renumber under a
   * removal and ids do not, so this is what a selection survives on.
   */
  vertexIds: number[]
  edgeKeys: string[]
  faceIds: number[]
}

/** What an operator selects afterwards, as slots in the mesh as it leaves it. */
export type SlotSelection = {
  vertices?: Iterable<number>
  edges?: Iterable<number>
  faces?: Iterable<number>
}

/**
 * What an operator did to one target.
 *
 * A string is a refusal with the reason in it, which the status bar shows; `null` means the
 * operator had nothing to do here and the object is left exactly as it was. Anything else keeps the
 * mutated mesh and takes the new selection from `select` — and `select: undefined` means the
 * selection is unchanged, which is not the same as `select: {}`, an empty selection.
 */
export type EditOutcome =
  | { select?: SlotSelection; active?: { kind: SelectMode; slot: number } | null; message?: string }
  | string
  | null

/* --------------------------------------------------------------- the targets */

/** Whether the editor is in edit mode at all, which is what an edit-mode operator asks first. */
export function inEditMode(context: OperatorContext): boolean {
  return requireEdit(context) === true
}

/**
 * Every mesh open for editing, active first. An object whose mesh is missing, or which is not a
 * mesh at all, is not a target: an operator never has to check what kind of object it was handed.
 */
export function editTargets(context: OperatorContext, options: { curves?: boolean } = {}): EditTarget[] {
  const ids = editedObjectIds(context.selection)
  const targets: EditTarget[] = []
  for (const id of ids) {
    const object = context.document.objects.find((candidate) => candidate.id === id)
    if (!object) continue
    /*
     * A curve open for editing wears a cage: a mesh of its knots and handles, so that the selection
     * operators — click, box, ⌘A, invert — work on it without a second copy of themselves. Only the
     * operators that ask for it see one, because an operator that changes geometry would otherwise
     * be handed a mesh that no document holds and would quietly write it nowhere.
     */
    const curve = object.data.kind === 'curve' ? object.data : null
    if (curve && !options.curves) continue
    if (!curve && object.data.kind !== 'mesh') continue
    const data = curve ? curveCage(curve) : meshOf(context.document, object)
    if (!data) continue
    const mesh = EditMesh.from(data)
    const elements = toElements(context.selection, id)
    targets.push({
      object,
      meshId: object.data.kind === 'mesh' ? object.data.meshId : '',
      ...(curve ? { curve } : {}),
      mesh,
      vertices: slotsOfVertices(mesh, elements),
      edges: slotsOfEdges(mesh, elements),
      faces: slotsOfFaces(mesh, elements),
      active: activeSlot(mesh, context.selection.active, id),
      vertexIds: [...elements.vertices],
      edgeKeys: [...elements.edges],
      faceIds: [...elements.faces],
    })
  }
  return targets
}

/** Every vertex the selection covers, a selected edge's and face's corners included. */
export function selectedVertices(target: EditTarget): Set<number> {
  const slots = new Set(target.vertices)
  for (const edge of target.edges) for (const end of target.mesh.edgeVertices(edge)) if (end >= 0) slots.add(end)
  for (const face of target.faces) for (const corner of target.mesh.faceVertices(face)) slots.add(corner)
  return slots
}

/** Whether anything at all is selected on a target, in any of the three kinds. */
export function hasSelection(target: EditTarget): boolean {
  return target.vertices.size > 0 || target.edges.size > 0 || target.faces.size > 0
}

/* ------------------------------------------------------------ availability */

/**
 * The answer an edit-mode operator gives to `available`. The reasons are written out rather than
 * folded into one, because “Nothing is selected” and “This works on faces” send a person to two
 * different places.
 */
export function requireEdit(context: OperatorContext, needs?: SelectMode | 'any', options: { curves?: boolean } = {}): Availability {
  if (context.mode !== 'edit') return 'This works in edit mode. Press Tab.'
  /*
   * Answered from the document and the selection, without building a single adjacency.
   *
   * Every menu, the palette and the command list ask every operator whether it can run, on every
   * render — two hundred questions a keystroke. Building a mesh's adjacency to answer one of them
   * turned Tab on a twenty-thousand-vertex grid into ten seconds of nothing happening. Nothing here
   * needs the topology: whether a mesh is open, and whether anything is selected, are both written
   * down already.
   */
  const objects = editedObjectIds(context.selection).filter((id) => {
    const object = context.document.objects.find((candidate) => candidate.id === id)
    if (options.curves && object?.data.kind === 'curve') return true
    return object?.data.kind === 'mesh' && context.document.meshes[object.data.meshId] !== undefined
  })
  if (objects.length === 0) return options.curves ? 'Open a mesh or a curve for editing first.' : 'Open a mesh for editing first.'
  if (!needs) return true
  const some = objects.some((id) => {
    const stored = context.selection.elements?.[id]
    if (!stored) return false
    // A selected face or edge carries its corners, so anything selected is vertices selected.
    if (needs === 'vertex' || needs === 'any') {
      return stored.vertices.length > 0 || stored.edges.length > 0 || stored.faces.length > 0
    }
    return needs === 'edge' ? stored.edges.length > 0 : stored.faces.length > 0
  })
  if (some) return true
  if (needs === 'any') return 'Nothing is selected.'
  return needs === 'vertex' ? 'No vertices are selected.' : needs === 'edge' ? 'No edges are selected.' : 'No faces are selected.'
}

/* ------------------------------------------------------------- running them */

/**
 * Runs one piece of work against every mesh open for editing and gathers the result.
 *
 * Every target refusing is the operator refusing, with the first reason given — a person who
 * pressed a key wants to know why nothing happened. One target refusing among several is not:
 * the ones that could act have acted, and the reason goes to the status bar as a message.
 */
/** Every object drawing this mesh, with its shape keys tidied of the vertices the edit removed. */
function withRemappedShapeKeys(document: SceneDocument, meshId: string, mesh: MeshData): SceneDocument {
  let changed = false
  const objects = document.objects.map((object) => {
    if (object.data.kind !== 'mesh' || object.data.meshId !== meshId || !object.shapeKeys) return object
    const kept = remapShapeKeys(object.shapeKeys, mesh)
    if (kept === object.shapeKeys) return object
    changed = true
    return { ...object, shapeKeys: kept }
  })
  return changed ? { ...document, objects } : document
}

export function runOnMeshes(
  context: OperatorContext,
  work: (target: EditTarget) => EditOutcome,
  options: { label?: string; curves?: boolean } = {},
): OperatorResult {
  const targets = editTargets(context, { curves: options.curves === true })
  if (targets.length === 0) return { error: 'Open a mesh for editing first.' }
  let document = context.document
  let selection = context.selection
  const refusals: string[] = []
  const messages: string[] = []
  let changed = false
  for (const target of targets) {
    const outcome = work(target)
    if (typeof outcome === 'string') {
      refusals.push(outcome)
      continue
    }
    if (outcome === null) continue
    changed = true
    if (target.curve) {
      // A cage is not a mesh the document holds: what an operator says about the *selection* stands,
      // and what it says about the geometry is dropped, because there is nowhere to put it.
      selection = writeSelection(selection, target, outcome.select, outcome.active)
      continue
    }
    const built = target.mesh.toData()
    document = withMesh(document, target.meshId, built)
    /*
     * An edit that removed vertices leaves the shape keys holding offsets for vertices that are no
     * longer there. They do nothing — an offset is applied by id, and the id is not found — but a
     * file that keeps them grows for ever, so they go here, at the one place every mesh edit passes
     * through. A vertex the edit *made* gets no offset: it belongs to the basis until somebody
     * shapes it, and a cut has no way of knowing what it should have been in a shape it was never
     * part of.
     */
    document = withRemappedShapeKeys(document, target.meshId, built)
    if (outcome.message) messages.push(outcome.message)
    if (outcome.select !== undefined || outcome.active !== undefined) {
      selection = writeSelection(selection, target, outcome.select, outcome.active)
    } else {
      /*
       * The operator changed the mesh and said nothing about the selection, so the selection is
       * kept by *id*. Keeping it by slot would be worse than useless: removing geometry renumbers
       * every slot after it, so slot 7 after a delete is different geometry from slot 7 before it,
       * and a selection filtered by range alone would quietly re-point at a neighbour.
       */
      selection = writeSelection(selection, target, {
        vertices: liveSlots(target.mesh, [...target.vertexIds], (mesh, id) => mesh.slotOfVertex(id)),
        edges: liveSlots(target.mesh, [...target.edgeKeys], (mesh, key) => elementSlot(mesh, 'edge', key)),
        faces: liveSlots(target.mesh, [...target.faceIds], (mesh, id) => mesh.slotOfFace(id)),
      }, undefined)
    }
  }
  if (!changed) return { error: refusals[0] ?? 'Nothing to do here.' }
  const result: OperatorResult = { document, selection }
  const note = [...messages, ...refusals].filter(Boolean)[0]
  if (note) result.label = options.label ? `${options.label} — ${note}` : note
  else if (options.label) result.label = options.label
  return result
}

/** One target's selection written back into the document's form. */
export function writeSelection(
  selection: SceneSelection,
  target: EditTarget,
  slots: SlotSelection | undefined,
  active: { kind: SelectMode; slot: number } | null | undefined,
): SceneSelection {
  const elements = slots ? elementsFromSlots(target.mesh, slots) : toElements(selection, target.object.id)
  const next: SceneSelection = {
    ...selection,
    elements: { ...(selection.elements ?? {}), [target.object.id]: fromElements(elements) },
  }
  if (active !== undefined) {
    next.active = active ? elementRef(target, active) : null
    const ref = next.active
    if (ref) next.elementHistory = [...(selection.elementHistory ?? []).filter((entry) => !same(entry, ref)), ref].slice(-64)
  }
  return next
}

/** Slots to ids, for one mesh. Slots the mesh has not got are dropped rather than written as holes. */
export function elementsFromSlots(mesh: EditMesh, slots: SlotSelection): ElementSelection {
  const elements = selectNone()
  for (const slot of slots.vertices ?? []) {
    if (mesh.hasVertex(slot)) elements.vertices.add(mesh.vertexId(slot))
  }
  for (const slot of slots.edges ?? []) {
    if (!mesh.hasEdge(slot)) continue
    const [a, b] = mesh.edgeVertices(slot)
    if (a >= 0 && b >= 0) elements.edges.add(edgeKey(mesh.vertexId(a), mesh.vertexId(b)))
  }
  for (const slot of slots.faces ?? []) {
    if (mesh.hasFace(slot)) elements.faces.add(mesh.faceId(slot))
  }
  return elements
}

/** The id of an element, in the form a selection and the active element are written in. */
export function elementId(mesh: EditMesh, kind: SelectMode, slot: number): string | null {
  if (kind === 'vertex') return mesh.hasVertex(slot) ? String(mesh.vertexId(slot)) : null
  if (kind === 'face') return mesh.hasFace(slot) ? String(mesh.faceId(slot)) : null
  if (!mesh.hasEdge(slot)) return null
  const [a, b] = mesh.edgeVertices(slot)
  return a >= 0 && b >= 0 ? edgeKey(mesh.vertexId(a), mesh.vertexId(b)) : null
}

/** The slot an element id names, or -1 when the mesh has not got it any more. */
export function elementSlot(mesh: EditMesh, kind: SelectMode, id: string): number {
  if (kind === 'vertex') return mesh.slotOfVertex(Number(id))
  if (kind === 'face') return mesh.slotOfFace(Number(id))
  const parts = id.split(':')
  if (parts.length !== 2) return -1
  const a = mesh.slotOfVertex(Number(parts[0]))
  const b = mesh.slotOfVertex(Number(parts[1]))
  return a < 0 || b < 0 ? -1 : mesh.edgeSlot(a, b)
}

/** The document that a set of already-mutated targets makes, for an operator that writes its own. */
export function withMeshes(document: SceneDocument, targets: EditTarget[]): SceneDocument {
  let next = document
  for (const target of targets) next = withMesh(next, target.meshId, target.mesh.toData())
  return next
}

/* ----------------------------------------------------------------- internals */

function elementRef(target: EditTarget, active: { kind: SelectMode; slot: number }): ElementRef | null {
  const id = elementId(target.mesh, active.kind, active.slot)
  return id === null ? null : { kind: active.kind, objectId: target.object.id, id }
}

function same(a: ElementRef, b: ElementRef): boolean {
  return a.kind === b.kind && a.objectId === b.objectId && a.id === b.id
}

/** The slots some ids name in the mesh as it now stands; the ones it no longer holds are dropped. */
function liveSlots<Id>(mesh: EditMesh, ids: Id[], find: (mesh: EditMesh, id: Id) => number): number[] {
  const slots: number[] = []
  for (const id of ids) {
    const slot = find(mesh, id)
    if (slot >= 0) slots.push(slot)
  }
  return slots
}

function slotsOfVertices(mesh: EditMesh, elements: ElementSelection): Set<number> {
  const slots = new Set<number>()
  for (const id of elements.vertices) {
    const slot = mesh.slotOfVertex(id)
    if (slot >= 0) slots.add(slot)
  }
  return slots
}

function slotsOfEdges(mesh: EditMesh, elements: ElementSelection): Set<number> {
  const slots = new Set<number>()
  for (const key of elements.edges) {
    const slot = elementSlot(mesh, 'edge', key)
    if (slot >= 0) slots.add(slot)
  }
  return slots
}

function slotsOfFaces(mesh: EditMesh, elements: ElementSelection): Set<number> {
  const slots = new Set<number>()
  for (const id of elements.faces) {
    const slot = mesh.slotOfFace(id)
    if (slot >= 0) slots.add(slot)
  }
  return slots
}

function activeSlot(mesh: EditMesh, active: ElementRef | null | undefined, objectId: string): EditTarget['active'] {
  if (!active || active.objectId !== objectId) return null
  const slot = elementSlot(mesh, active.kind, active.id)
  return slot < 0 ? null : { kind: active.kind, slot }
}
