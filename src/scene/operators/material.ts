import { DEFAULT_MATERIAL, meshOf, objectById, uniqueName, withMesh } from '@/scene/model'
import { cloneMesh } from '@/scene/mesh/data'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, type OperatorContext, type OperatorResult } from '@/scene/operators/types'
import type { Material, SceneDocument, SceneObject } from '@/scene/types'

/**
 * Materials, and the slots that point at them.
 *
 * Two indirections, both Blender's, and both worth keeping. A material is a thing in the document
 * that several objects can name, so changing it changes all of them at once — that is the point of
 * a material. And an object does not name a material directly: it has a list of slots, and every
 * face carries the *index of a slot* rather than the id of a material. Which means a face keeps its
 * slot when the material in it is swapped, and two objects can share a mesh and still be different
 * colours.
 *
 * Everything here is pure — a document in, a document out — so assigning a material to a selection
 * is replayable by F9 and testable without a viewport.
 */

const SELECT_MESH = 'Select a mesh first.'
const NO_SELECTION = 'Select some faces first.'

function activeMesh(context: OperatorContext): SceneObject | null {
  const active = context.active ?? (context.selection.activeObjectId ? objectById(context.document, context.selection.activeObjectId) : null)
  return active && active.data.kind === 'mesh' ? active : null
}

/** The slot a material action works on: the panel's active slot, or the first one. */
function activeSlot(context: OperatorContext, object: SceneObject): number {
  const slot = context.selection.activeMaterialSlot ?? 0
  return Math.max(0, Math.min(object.materialSlots.length - 1, Math.round(slot)))
}

function withObject(document: SceneDocument, id: string, patch: Partial<SceneObject>): SceneDocument {
  return { ...document, objects: document.objects.map((object) => (object.id === id ? { ...object, ...patch } : object)) }
}

/* ------------------------------------------------------------------- slots */

registerOperator<Record<string, never>>({
  id: 'material.addSlot',
  label: 'Add material slot',
  section: 'Material',
  description: 'Give the object another material slot, which its faces can then be assigned to.',
  params: [],
  defaults: {},
  available: (context) => (activeMesh(context) ? true : SELECT_MESH),
  run: (context) => {
    const object = activeMesh(context)
    if (!object) return { error: SELECT_MESH }
    // An empty slot is a real state in Blender — a slot with no material draws the default — and
    // this keeps it simple by pointing a new slot at the first material there is.
    const material = context.document.materials[0]?.id ?? DEFAULT_MATERIAL.id
    return { document: withObject(context.document, object.id, { materialSlots: [...object.materialSlots, material] }) }
  },
})

registerOperator<Record<string, never>>({
  id: 'material.removeSlot',
  label: 'Remove material slot',
  section: 'Material',
  description: 'Take the active slot off the object, and move the faces that used it to the first slot.',
  params: [],
  defaults: {},
  available: (context) => {
    const object = activeMesh(context)
    if (!object) return SELECT_MESH
    return object.materialSlots.length > 1 ? true : 'An object keeps at least one slot.'
  },
  run: (context) => {
    const object = activeMesh(context)
    if (!object || object.data.kind !== 'mesh') return { error: SELECT_MESH }
    if (object.materialSlots.length <= 1) return { error: 'An object keeps at least one slot.' }
    const index = activeSlot(context, object)
    const slots = object.materialSlots.filter((_, position) => position !== index)
    let document = withObject(context.document, object.id, { materialSlots: slots })
    const data = meshOf(document, object)
    if (data) {
      /*
       * Every face above the removed slot moves down one, and the faces that were in it fall back
       * to the first: a face pointing at a slot that no longer exists would draw as the default
       * material and no panel would say why.
       */
      const mesh = cloneMesh(data)
      const materials = mesh.attributes.face.material
      for (let face = 0; face < materials.length; face += 1) {
        const slot = materials[face] ?? 0
        materials[face] = slot === index ? 0 : slot > index ? slot - 1 : slot
      }
      document = withMesh(document, object.data.meshId, mesh)
    }
    return { document }
  },
})

registerOperator<{ step: number }>({
  id: 'material.moveSlot',
  label: 'Move material slot',
  section: 'Material',
  description: 'Move the active slot up or down the list, and move the faces with it.',
  params: [numberParam('step', 'Step', { min: -1, max: 1, step: 1, defaultValue: -1 })],
  defaults: { step: -1 },
  available: (context) => {
    const object = activeMesh(context)
    if (!object) return SELECT_MESH
    return object.materialSlots.length > 1 ? true : 'There is only one slot to move.'
  },
  run: (context, params) => {
    const object = activeMesh(context)
    if (!object || object.data.kind !== 'mesh') return { error: SELECT_MESH }
    const from = activeSlot(context, object)
    const to = from + (params.step < 0 ? -1 : 1)
    if (to < 0 || to >= object.materialSlots.length) return { error: 'That slot is already at the end of the list.' }
    const slots = [...object.materialSlots]
    const moved = slots[from]!
    slots[from] = slots[to]!
    slots[to] = moved
    let document = withObject(context.document, object.id, { materialSlots: slots })
    const data = meshOf(document, object)
    if (data) {
      const mesh = cloneMesh(data)
      const materials = mesh.attributes.face.material
      for (let face = 0; face < materials.length; face += 1) {
        const slot = materials[face] ?? 0
        materials[face] = slot === from ? to : slot === to ? from : slot
      }
      document = withMesh(document, object.data.meshId, mesh)
    }
    return { document, selection: { ...context.selection, activeMaterialSlot: to } }
  },
})

/* --------------------------------------------------------------- materials */

registerOperator<{ copyActive: boolean }>({
  id: 'material.new',
  label: 'New material',
  section: 'Material',
  description: 'Put a new material in the active slot, either fresh or a copy of the one there.',
  params: [],
  defaults: { copyActive: false },
  available: (context) => (activeMesh(context) ? true : SELECT_MESH),
  run: (context, params) => {
    const object = activeMesh(context)
    if (!object) return { error: SELECT_MESH }
    const index = activeSlot(context, object)
    const current = context.document.materials.find((entry) => entry.id === object.materialSlots[index])
    const source = params.copyActive && current ? current : DEFAULT_MATERIAL
    const material: Material = {
      ...source,
      id: `material-${crypto.randomUUID()}`,
      name: uniqueName(context.document.materials.map((entry) => entry.name), source.name),
    }
    const slots = object.materialSlots.length === 0 ? [material.id] : object.materialSlots.map((slot, position) => (position === index ? material.id : slot))
    return {
      document: withObject(
        { ...context.document, materials: [...context.document.materials, material] },
        object.id,
        { materialSlots: slots },
      ),
      label: params.copyActive ? `Duplicated ${source.name}` : 'New material',
    }
  },
})

registerOperator<{ materialId: string }>({
  id: 'material.delete',
  label: 'Delete material',
  section: 'Material',
  description: 'Take a material out of the document, and off every slot that named it.',
  params: [{ kind: 'text', id: 'materialId', label: 'Material', group: 'operator', defaultValue: '', maxLength: 80 }],
  defaults: { materialId: '' },
  available: (context) => (context.document.materials.length > 1 ? true : 'A document keeps at least one material.'),
  run: (context, params) => {
    const document = context.document
    if (document.materials.length <= 1) return { error: 'A document keeps at least one material.' }
    const material = document.materials.find((entry) => entry.id === params.materialId)
    if (!material) return { error: 'That material is not in this document any more.' }
    const fallback = document.materials.find((entry) => entry.id !== material.id)!.id
    return {
      document: {
        ...document,
        materials: document.materials.filter((entry) => entry.id !== material.id),
        // A slot that named it points at the first material left rather than at nothing: an object
        // whose slot is empty draws grey, which reads as a bug rather than as a deletion.
        objects: document.objects.map((object) => (
          object.materialSlots.includes(material.id)
            ? { ...object, materialSlots: object.materialSlots.map((slot) => (slot === material.id ? fallback : slot)) }
            : object
        )),
      },
      label: `Deleted ${material.name}`,
    }
  },
})

/* ---------------------------------------------------- assign, select, deselect */

registerOperator<Record<string, never>>({
  id: 'material.assign',
  label: 'Assign',
  section: 'Material',
  description: 'Put the selected faces in the active material slot.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => {
    const object = activeMesh(context)
    if (!object) return SELECT_MESH
    return (context.selection.elements?.[object.id]?.faces ?? []).length > 0 ? true : NO_SELECTION
  },
  run: (context) => {
    const object = activeMesh(context)
    if (!object || object.data.kind !== 'mesh') return { error: SELECT_MESH }
    const data = meshOf(context.document, object)
    if (!data) return { error: SELECT_MESH }
    // The selection names faces by their stable id as text; a mesh names them as numbers.
    const chosen = new Set((context.selection.elements?.[object.id]?.faces ?? []).map((id) => Number(id)))
    if (chosen.size === 0) return { error: NO_SELECTION }
    const index = activeSlot(context, object)
    const mesh = cloneMesh(data)
    let assigned = 0
    for (let face = 0; face < mesh.faceIds.length; face += 1) {
      if (!chosen.has(mesh.faceIds[face]!)) continue
      mesh.attributes.face.material[face] = index
      assigned += 1
    }
    return {
      document: withMesh(context.document, object.data.meshId, mesh),
      label: `Assigned ${assigned} ${assigned === 1 ? 'face' : 'faces'}`,
    }
  },
})

function facesInSlot(document: SceneDocument, object: SceneObject, slot: number): string[] {
  const data = meshOf(document, object)
  if (!data) return []
  const ids: string[] = []
  for (let face = 0; face < data.faceIds.length; face += 1) {
    if ((data.attributes.face.material[face] ?? 0) === slot) ids.push(String(data.faceIds[face]))
  }
  return ids
}

/** Adds the slot's faces to the selection, or takes them out of it. */
function selectSlot(context: OperatorContext, keep: boolean): OperatorResult {
  const object = activeMesh(context)
  if (!object) return { error: SELECT_MESH }
  const slot = activeSlot(context, object)
  const faces = facesInSlot(context.document, object, slot)
  if (faces.length === 0) return { error: 'No face is in this slot.' }
  const elements = { ...(context.selection.elements ?? {}) }
  const current = elements[object.id] ?? { vertices: [], edges: [], faces: [] }
  const chosen = new Set(current.faces)
  for (const id of faces) {
    if (keep) chosen.add(id)
    else chosen.delete(id)
  }
  elements[object.id] = { ...current, faces: [...chosen] }
  return {
    selection: { ...context.selection, elements },
    label: `${keep ? 'Selected' : 'Deselected'} ${faces.length} ${faces.length === 1 ? 'face' : 'faces'}`,
  }
}

registerOperator<Record<string, never>>({
  id: 'material.select',
  label: 'Select',
  section: 'Material',
  description: 'Add every face in the active slot to the selection.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => (activeMesh(context) ? true : SELECT_MESH),
  run: (context) => selectSlot(context, true),
})

registerOperator<Record<string, never>>({
  id: 'material.deselect',
  label: 'Deselect',
  section: 'Material',
  description: 'Take every face in the active slot out of the selection.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => (activeMesh(context) ? true : SELECT_MESH),
  run: (context) => selectSlot(context, false),
})

/**
 * Dropping a material onto something in the viewport.
 *
 * Two targets, and the difference is what a person was holding when they let go: on an object, it
 * goes into the active slot, which is how a whole object is painted in one gesture; on a face, it
 * goes into a slot of its own — added if the object does not already have one for that material —
 * because a face is a smaller thing than an object and should not repaint its neighbours.
 */
registerOperator<{ materialId: string; objectId: string; faceId: string }>({
  id: 'material.drop',
  label: 'Assign material',
  section: 'Material',
  description: 'Put a material on the object or the face it was dropped on.',
  params: [
    { kind: 'text', id: 'materialId', label: 'Material', group: 'operator', defaultValue: '', maxLength: 80 },
    { kind: 'text', id: 'objectId', label: 'Object', group: 'operator', defaultValue: '', maxLength: 80 },
    { kind: 'text', id: 'faceId', label: 'Face', group: 'operator', defaultValue: '', maxLength: 40 },
  ],
  defaults: { materialId: '', objectId: '', faceId: '' },
  available: (context) => (context.document.materials.length > 0 ? true : 'This document has no materials.'),
  run: (context, params) => {
    const document = context.document
    const material = document.materials.find((entry) => entry.id === params.materialId)
    if (!material) return { error: 'That material is not in this document any more.' }
    const object = objectById(document, params.objectId)
    if (!object || object.data.kind !== 'mesh') return { error: 'Drop a material on a mesh.' }

    if (!params.faceId) {
      const slot = activeSlot(context, object)
      const slots = object.materialSlots.length === 0
        ? [material.id]
        : object.materialSlots.map((current, index) => (index === slot ? material.id : current))
      return {
        document: withObject(document, object.id, { materialSlots: slots }),
        label: `${material.name} on ${object.name}`,
      }
    }

    const data = meshOf(document, object)
    if (!data) return { error: 'Drop a material on a mesh.' }
    const face = data.faceIds.indexOf(Number(params.faceId))
    if (face < 0) return { error: 'That face is not there any more.' }
    // A slot for this material, or a new one: painting one face must not repaint the others.
    let slots = object.materialSlots
    let index = slots.indexOf(material.id)
    if (index < 0) {
      slots = [...slots, material.id]
      index = slots.length - 1
    }
    const mesh = cloneMesh(data)
    mesh.attributes.face.material[face] = index
    return {
      document: withMesh(withObject(document, object.id, { materialSlots: slots }), object.data.meshId, mesh),
      label: `${material.name} on one face`,
    }
  },
})
