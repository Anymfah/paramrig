import { describe, expect, it } from 'vitest'
import { createSceneDocument, meshOf, objectById, ROOT_COLLECTION_ID } from '@/scene/document'
import { KEYMAP } from '@/scene/keymap'
import { meshCounts } from '@/scene/mesh/data'
import { boxMesh, gridMesh } from '@/scene/mesh/primitives'
import '@/scene/modifiers'
import '@/scene/operators/modifier'
import { operatorAvailability, runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams } from '@/scene/operators/types'
import type { Modifier, SceneDocument, SceneObject } from '@/scene/types'

/**
 * Applying a modifier and setting a subdivision level: the two things about a stack that change a
 * document rather than an object, and therefore the two that are operators.
 */

function meshObject(id: string, meshId: string, modifiers: Modifier[] = []): SceneObject {
  return {
    id,
    name: id,
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId },
    modifiers,
    materialSlots: [],
  }
}

function scene(objects: SceneObject[], meshes: Record<string, ReturnType<typeof boxMesh>>): SceneDocument {
  return { ...createSceneDocument(), objects, meshes }
}

function modifier(patch: Partial<Modifier> = {}): Modifier {
  return {
    id: 'modifier-1',
    kind: 'mirror',
    name: 'Mirror',
    enabled: { viewport: true, render: true, editMode: true, onCage: false },
    params: { axisX: true, merge: true, mergeDistance: 0.001 },
    ...patch,
  }
}

function contextFor(document: SceneDocument, ids: string[]): OperatorContext {
  const active = ids.at(-1) ?? null
  return {
    document,
    selection: { objectIds: ids, activeObjectId: active },
    mode: 'object',
    view: document.view,
    cursor: document.cursor,
    active: active ? objectById(document, active) : null,
  }
}

function run(document: SceneDocument, id: string, ids: string[], params: OperatorParams = {}) {
  return runOperator(id, contextFor(document, ids), params)
}

describe('applying a modifier as a shape key', () => {
  it('keeps the modifier and stores what it does as a key', () => {
    /*
     * A cast, because it moves the vertices that are there. A mirror or a subdivision makes new
     * ones, and a shape key is a set of offsets against the vertices a mesh has — there is nothing
     * to offset a vertex that did not exist.
     */
    const cast = modifier({ id: 'modifier-cast', kind: 'cast', name: 'Cast', params: { castType: 'sphere', factor: 1 } })
    /*
     * A grid rather than a cube: every corner of a cube is the same distance from its centre, so
     * casting one onto a sphere moves nothing at all and the test would be measuring that instead.
     */
    const document = scene([meshObject('cube', 'mesh-1', [cast])], { 'mesh-1': gridMesh({ xSubdivisions: 3, ySubdivisions: 3 }) })
    const result = run(document, 'modifier.applyAsShapeKey', ['cube'], { modifierId: 'modifier-cast' })
    expect(result.error).toBeUndefined()
    const object = objectById(result.document!, 'cube')!
    expect(object.modifiers).toHaveLength(1)
    expect(object.shapeKeys).toHaveLength(1)
    expect(object.shapeKeys![0]!.name).toBe('Cast')
    expect(Object.keys(object.shapeKeys![0]!.offsets).length).toBeGreaterThan(0)
    // And the mesh is untouched: the key is a difference, not a bake.
    expect(meshOf(result.document!, object)!.vertices).toEqual(document.meshes['mesh-1']!.vertices)
  })

  it('refuses a modifier that changes how many vertices there are, and says why', () => {
    const document = scene([meshObject('cube', 'mesh-1', [modifier()])], { 'mesh-1': boxMesh(2) })
    const result = run(document, 'modifier.applyAsShapeKey', ['cube'], { modifierId: 'modifier-1' })
    expect(result.error).toMatch(/changes how many vertices/)
  })
})

describe('applying a modifier', () => {
  it('writes the result into the mesh and takes the modifier off', () => {
    // Half a cube, so mirroring it is visible in the counts rather than only in the positions.
    const document = scene([meshObject('cube', 'mesh-1', [modifier()])], { 'mesh-1': boxMesh(2) })
    const before = meshCounts(document.meshes['mesh-1']!)
    const result = run(document, 'modifier.apply', ['cube'], { modifierId: 'modifier-1' })
    expect(result.error).toBeUndefined()
    const next = result.document!
    expect(objectById(next, 'cube')!.modifiers).toEqual([])
    const after = meshCounts(meshOf(next, objectById(next, 'cube')!)!)
    expect(after.faces).toBeGreaterThan(before.faces)
    // The label is what the status bar reads out and what the history entry is called.
    expect(result.label).toBe('Mirror applied to cube')
  })

  it('refuses a mesh that several objects share, with the count in the sentence', () => {
    const document = scene(
      [meshObject('one', 'mesh-1', [modifier()]), meshObject('two', 'mesh-1')],
      { 'mesh-1': boxMesh(2) },
    )
    const result = run(document, 'modifier.apply', ['one'], { modifierId: 'modifier-1' })
    expect(result.error).toBe('This mesh is used by 2 objects, so applying a modifier would change all of them.')
    expect(result.document).toBeUndefined()
  })

  it('refuses to apply out of order, naming the one to apply first', () => {
    const stack = [modifier(), modifier({ id: 'modifier-2', kind: 'subsurf', name: 'Subdivision', params: { levels: 1 } })]
    const document = scene([meshObject('cube', 'mesh-1', stack)], { 'mesh-1': boxMesh(2) })
    const result = run(document, 'modifier.apply', ['cube'], { modifierId: 'modifier-2' })
    expect(result.error).toBe('Apply “Mirror” first: a stack is applied from the top.')
  })

  it('passes a refusal from the modifier through rather than baking a broken mesh', () => {
    const named = modifier({ params: { axisX: true, mirrorObject: 'gone' } })
    const document = scene([meshObject('cube', 'mesh-1', [named])], { 'mesh-1': boxMesh(2) })
    const result = run(document, 'modifier.apply', ['cube'], { modifierId: 'modifier-1' })
    expect(result.error).toBe('The mirror object this modifier names is not in the scene any more.')
  })

  it('says there is nothing to apply when the stack is empty', () => {
    const document = scene([meshObject('cube', 'mesh-1')], { 'mesh-1': boxMesh(2) })
    expect(operatorAvailability('modifier.apply', contextFor(document, ['cube']))).toBe('This object has no modifiers to apply.')
  })
})

describe('the subdivision level', () => {
  it('adds the modifier when there is none, at the level asked for', () => {
    const document = scene([meshObject('cube', 'mesh-1')], { 'mesh-1': boxMesh(2) })
    const result = run(document, 'modifier.subdivisionSet', ['cube'], { level: 2 })
    const stack = objectById(result.document!, 'cube')!.modifiers
    expect(stack).toHaveLength(1)
    expect(stack[0]!.kind).toBe('subsurf')
    expect(stack[0]!.params.levels).toBe(2)
    // The rest of the module's defaults come with it, so the panel is not left with empty fields.
    expect(stack[0]!.params.renderLevels).toBe(2)
  })

  it('sets the level of the one already there instead of adding a second', () => {
    const subsurf = modifier({ id: 'modifier-s', kind: 'subsurf', name: 'Subdivision', params: { levels: 1, simple: true } })
    const document = scene([meshObject('cube', 'mesh-1', [subsurf])], { 'mesh-1': boxMesh(2) })
    const stack = objectById(run(document, 'modifier.subdivisionSet', ['cube'], { level: 3 }).document!, 'cube')!.modifiers
    expect(stack).toHaveLength(1)
    expect(stack[0]!.params.levels).toBe(3)
    // Everything else it was set to survives: the chord sets a level, not a whole modifier.
    expect(stack[0]!.params.simple).toBe(true)
  })

  it('takes the modifier off at level nought', () => {
    const subsurf = modifier({ id: 'modifier-s', kind: 'subsurf', name: 'Subdivision', params: { levels: 2 } })
    const document = scene([meshObject('cube', 'mesh-1', [subsurf])], { 'mesh-1': boxMesh(2) })
    expect(objectById(run(document, 'modifier.subdivisionSet', ['cube'], { level: 0 }).document!, 'cube')!.modifiers).toEqual([])
  })

  it('is bound to ⌃1 through ⌃5, and to ⌃0 for none', () => {
    const bound = KEYMAP.filter((binding) => (
      binding.action.kind === 'operator' && binding.action.id === 'modifier.subdivisionSet'
    ))
    expect(bound.map((binding) => binding.code)).toEqual(['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'])
    expect(bound.every((binding) => binding.ctrl && binding.mode === 'object')).toBe(true)
  })
})
