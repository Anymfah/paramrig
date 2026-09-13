import type { ParameterDef } from '@/rigs/types'
import { meshOf, meshUsers, objectById, withMesh } from '@/scene/model'
import { EditMesh } from '@/scene/mesh/editMesh'
import { keyFromShape } from '@/scene/mesh/shapeKeys'
import { modifierInputs } from '@/scene/modifiers/stack'
import { getModifier, withModifierDefaults } from '@/scene/modifiers/types'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, type OperatorContext } from '@/scene/operators/types'
import type { Modifier, SceneObject } from '@/scene/types'

/**
 * The two things a modifier can be asked to do that a panel edit cannot.
 *
 * Everything else about a stack — adding one, reordering, switching it off — is a change to the
 * object, and the panel writes it straight into the document. These two change the mesh, so they
 * are operators: they take a document and give one back, they say why when they refuse, and F9
 * replays them against the document as it was.
 *
 * Apply is deliberately strict in one place. A mesh used by more than one object is one piece of
 * data with several users, and baking a modifier into it would change every one of them — so it is
 * refused with the count in the sentence, exactly as Blender refuses it.
 */

const NO_OBJECT = 'Select a mesh first.'

function activeMesh(context: OperatorContext): SceneObject | null {
  const active = context.active ?? (context.selection.activeObjectId ? objectById(context.document, context.selection.activeObjectId) : null)
  return active && active.data.kind === 'mesh' ? active : null
}

/** Which modifier, by id. Not a select: the panel knows the id, and the list changes under it. */
const MODIFIER_ID: ParameterDef = { kind: 'text', id: 'modifierId', label: 'Modifier', group: 'operator', defaultValue: '', maxLength: 80 }

registerOperator<{ modifierId: string }>({
  id: 'modifier.applyAsShapeKey',
  label: 'Apply as shape key',
  section: 'Object',
  description: 'Keep the modifier, and store what it does as a shape key of its own.',
  icon: 'modifier',
  params: [MODIFIER_ID],
  defaults: { modifierId: '' },
  mode: 'object',
  available: (context) => {
    const object = activeMesh(context)
    if (!object) return NO_OBJECT
    if (object.modifiers.length === 0) return 'This object has no modifiers to store.'
    return true
  },
  run: (context, params) => {
    const document = context.document
    const object = activeMesh(context)
    if (!object || object.data.kind !== 'mesh') return { error: NO_OBJECT }
    const modifier = object.modifiers.find((entry) => (params.modifierId ? entry.id === params.modifierId : true))
    if (!modifier) return { error: 'That modifier is not on this object any more.' }
    const module = getModifier(modifier.kind)
    if (!module) return { error: `“${modifier.kind}” is not a modifier this build has.` }
    const data = meshOf(document, object)
    if (!data) return { error: NO_OBJECT }
    const mesh = EditMesh.from(data)
    const outcome = module.apply(mesh, withModifierDefaults(modifier), {
      inputs: modifierInputs(document, object, modifier, module.objectInputs ?? []),
      forRender: false,
      editing: false,
    })
    if (typeof outcome === 'string') return { error: outcome }
    const shape = mesh.toData()
    /*
     * A shape key is a set of offsets against the vertices that are there, so a modifier that adds
     * or removes any cannot become one: a subdivision has no offset to give the mesh it came from.
     * Blender refuses these too, and for the same reason.
     */
    if (shape.vertexIds.length !== data.vertexIds.length) {
      return { error: `“${modifier.name}” changes how many vertices there are, so it cannot be a shape key.` }
    }
    const keys = object.shapeKeys ?? []
    const key = keyFromShape(data, shape, modifier.name, keys)
    if (Object.keys(key.offsets).length === 0) {
      return { error: `“${modifier.name}” moves nothing here, so there is no shape to store.` }
    }
    return {
      document: {
        ...document,
        objects: document.objects.map((entry) => (entry.id === object.id
          ? { ...entry, shapeKeys: [...keys, key], activeShapeKey: keys.length }
          : entry)),
      },
      label: 'Apply as shape key',
    }
  },
})

registerOperator<{ modifierId: string }>({
  id: 'modifier.apply',
  label: 'Apply modifier',
  section: 'Object',
  description: 'Write a modifier’s result into the mesh and take it off the stack.',
  icon: 'modifier',
  params: [MODIFIER_ID],
  defaults: { modifierId: '' },
  mode: 'object',
  available: (context) => {
    const object = activeMesh(context)
    if (!object) return NO_OBJECT
    if (object.modifiers.length === 0) return 'This object has no modifiers to apply.'
    return true
  },
  run: (context, params) => {
    const document = context.document
    const object = activeMesh(context)
    if (!object || object.data.kind !== 'mesh') return { error: NO_OBJECT }
    const index = object.modifiers.findIndex((entry) => (
      params.modifierId ? entry.id === params.modifierId : true
    ))
    const modifier = object.modifiers[index]
    if (!modifier) return { error: 'That modifier is not on this object any more.' }
    /*
     * The stack runs in order, so applying anything but the first would bake a result the ones
     * above it never saw. Blender warns and applies anyway; refusing says the same thing earlier.
     */
    if (index > 0) return { error: `Apply “${object.modifiers[0]!.name}” first: a stack is applied from the top.` }
    const users = meshUsers(document, object.data.meshId)
    if (users > 1) {
      return { error: `This mesh is used by ${users} objects, so applying a modifier would change all of them.` }
    }
    const module = getModifier(modifier.kind)
    if (!module) return { error: `“${modifier.kind}” is not a modifier this build has.` }
    const data = meshOf(document, object)
    if (!data) return { error: NO_OBJECT }

    const mesh = EditMesh.from(data)
    const outcome = module.apply(mesh, withModifierDefaults(modifier), {
      inputs: modifierInputs(document, object, modifier, module.objectInputs ?? []),
      forRender: false,
      editing: false,
    })
    if (typeof outcome === 'string') return { error: outcome }
    const next = withMesh(document, object.data.meshId, mesh.toData())
    return {
      document: {
        ...next,
        objects: next.objects.map((entry) => (
          entry.id === object.id ? { ...entry, modifiers: entry.modifiers.filter((one) => one.id !== modifier.id) } : entry
        )),
      },
      // Named rather than left to the operator's own label: an operator that names its step puts
      // that sentence in the status bar, which is where a confirmation belongs.
      label: `${modifier.name} applied to ${object.name}`,
    }
  },
})

/**
 * Blender's ⌃1 to ⌃5: the subdivision level of the selection, with the modifier added if it is
 * missing and removed at level nought. It is one keystroke because it is the one modifier setting a
 * person changes constantly — coarse to model, fine to look.
 */
registerOperator<{ level: number }>({
  id: 'modifier.subdivisionSet',
  label: 'Set subdivision level',
  section: 'Object',
  description: 'Set the subdivision level of the selected meshes, adding or removing the modifier as needed.',
  icon: 'modifier-subsurf',
  params: [numberParam('level', 'Level', { min: 0, max: 6, step: 1, defaultValue: 1 })],
  defaults: { level: 1 },
  mode: 'object',
  available: (context) => (
    context.document.objects.some((object) => (
      object.data.kind === 'mesh' && context.selection.objectIds.includes(object.id)
    )) ? true : NO_OBJECT
  ),
  run: (context, params) => {
    const level = Math.max(0, Math.min(6, Math.round(params.level)))
    const chosen = new Set(context.selection.objectIds)
    let touched = 0
    const objects = context.document.objects.map((object) => {
      if (object.data.kind !== 'mesh' || !chosen.has(object.id)) return object
      touched += 1
      const existing = object.modifiers.find((modifier) => modifier.kind === 'subsurf')
      if (level === 0) {
        return existing ? { ...object, modifiers: object.modifiers.filter((modifier) => modifier !== existing) } : object
      }
      if (existing) {
        return {
          ...object,
          modifiers: object.modifiers.map((modifier) => (
            modifier === existing ? { ...modifier, params: { ...modifier.params, levels: level } } : modifier
          )),
        }
      }
      const module = getModifier('subsurf')
      const added: Modifier = {
        id: `modifier-${crypto.randomUUID()}`,
        kind: 'subsurf',
        name: module?.label ?? 'Subdivision',
        enabled: { viewport: true, render: true, editMode: true, onCage: false },
        params: { ...(module?.defaults ?? {}), levels: level },
      }
      return { ...object, modifiers: [...object.modifiers, added] }
    })
    if (touched === 0) return { error: NO_OBJECT }
    return {
      document: { ...context.document, objects },
      label: level === 0 ? 'Subdivision removed' : `Subdivision level ${level}`,
    }
  },
})
