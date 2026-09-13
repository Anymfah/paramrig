import { describe, expect, it } from 'vitest'
import { createSceneDocument, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { initializeBuiltinModifiers } from '@/scene/modifiers'
initializeBuiltinModifiers()
import { resolveSceneValues, sceneRigDefaults } from '@/scene/rig'
import { addControl, bindExisting, exposeProperty, removeControl, unbindProperty, updateControl } from '@/scene/rigEdits'
import type { SceneDocument, SceneObject } from '@/scene/types'

/**
 * What a person does to a rig: expose a field, unbind it, add a control, rename it, delete it.
 *
 * Every one is a document in and a document out, so they are tested the way an operator is — by
 * what the document says afterwards — and the last test closes the loop: a field exposed here is a
 * field the resolver then drives.
 */

const MESH = 'mesh-1'

function object(patch: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'object-1',
    name: 'Cube',
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 1.5], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: MESH },
    modifiers: [],
    materialSlots: ['material-default'],
    ...patch,
  }
}

function scene(objects: SceneObject[] = [object()]): SceneDocument {
  return { ...createSceneDocument(), objects, meshes: { [MESH]: boxMesh(2) } }
}

const subdivided = object({
  modifiers: [{
    id: 'modifier-1',
    kind: 'subsurf',
    name: 'Subdivision',
    enabled: { viewport: true, render: true, editMode: true, onCage: false },
    params: { levels: 2 },
  }],
})

describe('exposing a field', () => {
  it('makes a control that starts where the scene already is', () => {
    const result = exposeProperty(scene(), {
      objectId: 'object-1',
      property: 'transform.position.z',
      label: 'Cube · Location Z',
      group: 'main',
    })
    const rig = result!.document.rig!
    expect(rig.parameters).toHaveLength(1)
    expect(rig.parameters[0]).toMatchObject({ kind: 'number', label: 'Cube · Location Z', group: 'main', defaultValue: 1.5 })
    expect(rig.bindings[0]).toMatchObject({ objectId: 'object-1', property: 'transform.position.z', parameterId: result!.parameterId })
  })

  it('takes a modifier’s own bounds rather than inventing some', () => {
    const result = exposeProperty(scene([subdivided]), {
      objectId: 'object-1',
      property: 'modifiers[modifier-1].levels',
      label: 'Detail',
      group: 'main',
    })
    expect(result!.document.rig!.parameters[0]).toMatchObject({ min: 0, max: 6, step: 1, defaultValue: 2 })
  })

  it('makes the group a request names, when it is a new one', () => {
    const result = exposeProperty(scene(), {
      objectId: 'object-1',
      property: 'visible',
      label: 'Shown',
      group: 'shape',
      newGroupLabel: 'Shape',
    })
    expect(result!.document.rig!.groups.map((group) => group.id)).toEqual(['main', 'shape'])
    expect(result!.document.rig!.groups[1]!.label).toBe('Shape')
  })

  it('replaces the binding on a property rather than stacking a second', () => {
    const first = exposeProperty(scene(), { objectId: 'object-1', property: 'transform.position.z', label: 'Lift', group: 'main' })!
    const second = exposeProperty(first.document, { objectId: 'object-1', property: 'transform.position.z', label: 'Height', group: 'main' })!
    expect(second.document.rig!.bindings).toHaveLength(1)
    expect(second.document.rig!.bindings[0]!.parameterId).toBe(second.parameterId)
    // The control that was there is kept: it may drive something else, and it holds a value.
    expect(second.document.rig!.parameters).toHaveLength(2)
  })

  it('gives two controls of the same name ids of their own', () => {
    const first = exposeProperty(scene(), { objectId: 'object-1', property: 'transform.position.x', label: 'Slide', group: 'main' })!
    const second = exposeProperty(first.document, { objectId: 'object-1', property: 'transform.position.y', label: 'Slide', group: 'main' })!
    expect(second.parameterId).not.toBe(first.parameterId)
  })

  it('refuses a property that is not a property, and one with no object', () => {
    expect(exposeProperty(scene(), { objectId: 'object-1', property: 'transform.wobble', label: 'No', group: 'main' })).toBeNull()
    expect(exposeProperty(scene(), { property: 'transform.position.x', label: 'No', group: 'main' })).toBeNull()
  })

  it('exposes a scene-wide property with no object at all', () => {
    const result = exposeProperty(scene(), { property: 'world.strength', label: 'Sky', group: 'main' })
    expect(result!.document.rig!.bindings[0]).toMatchObject({ property: 'world.strength' })
    expect(result!.document.rig!.bindings[0]!.objectId).toBeUndefined()
  })
})

describe('what else a rig’s author does', () => {
  it('unbinds a field and keeps the control', () => {
    const exposed = exposeProperty(scene(), { objectId: 'object-1', property: 'visible', label: 'Shown', group: 'main' })!
    const next = unbindProperty(exposed.document, exposed.document.rig!.bindings[0]!.id)
    expect(next.rig!.bindings).toEqual([])
    expect(next.rig!.parameters).toHaveLength(1)
  })

  it('adds a control that drives nothing yet', () => {
    const next = addControl(scene(), { kind: 'number', id: 'amount', label: 'Amount', group: 'main', min: 0, max: 1, step: 0.1, defaultValue: 0.5 })
    expect(next.rig!.parameters[0]).toMatchObject({ id: 'amount', label: 'Amount' })
    expect(next.rig!.bindings).toEqual([])
  })

  it('renames one, and moves it to another group', () => {
    const added = addControl(scene(), { kind: 'switch', id: 'shown', label: 'Shown', group: 'main', defaultValue: true })
    const renamed = updateControl(added, 'shown', { label: 'Visible' })
    expect(renamed.rig!.parameters[0]!.label).toBe('Visible')
    const moved = updateControl(renamed, 'shown', { group: 'shape' })
    expect(moved.rig!.parameters[0]!.group).toBe('shape')
    expect(moved.rig!.groups.map((group) => group.id)).toContain('shape')
  })

  it('takes every binding with a control that is deleted', () => {
    const exposed = exposeProperty(scene(), { objectId: 'object-1', property: 'transform.position.z', label: 'Lift', group: 'main' })!
    const next = removeControl(exposed.document, exposed.parameterId)
    expect(next.rig!.parameters).toEqual([])
    expect(next.rig!.bindings).toEqual([])
  })

  it('binds an existing control to a field it was dropped on', () => {
    const added = addControl(scene(), { kind: 'number', id: 'lift', label: 'Lift', group: 'main', min: 0, max: 4, step: 0.1, defaultValue: 1 })
    const bound = bindExisting(added, 'lift', { objectId: 'object-1', property: 'transform.position.z' })
    expect(bound.rig!.bindings[0]).toMatchObject({ parameterId: 'lift', property: 'transform.position.z' })
  })

  it('refuses to bind a control the document does not have', () => {
    const document = scene()
    expect(bindExisting(document, 'nobody', { objectId: 'object-1', property: 'transform.position.z' })).toBe(document)
  })
})

describe('the loop closing', () => {
  it('drives the scene from the control it was just given', () => {
    const exposed = exposeProperty(scene([subdivided]), {
      objectId: 'object-1',
      property: 'modifiers[modifier-1].levels',
      label: 'Detail',
      group: 'main',
    })!
    const document = exposed.document
    const values = sceneRigDefaults(document.rig!)
    expect(values[exposed.parameterId]).toBe(2)

    const turned = resolveSceneValues(document, { ...values, [exposed.parameterId]: 4 })
    expect(turned.objects[0]!.modifiers[0]!.params.levels).toBe(4)
    // And the document it was resolved from is untouched, which is the whole point.
    expect(document.objects[0]!.modifiers[0]!.params.levels).toBe(2)
  })
})
