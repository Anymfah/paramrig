import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import { clearModifierCache, evaluateObject, modifierCacheSize } from '@/scene/modifiers/stack'
import { registerModifier, resetModifiers } from '@/scene/modifiers/types'
import { editContext } from '@/scene/operators/editHarness'
import type { Modifier, SceneDocument, SceneObject } from '@/scene/types'

/*
 * The stack is tested with a modifier of its own rather than with a real one: what is being checked
 * is the ordering, the switches, the cache and what happens to a refusal — none of which should
 * change when a modifier does.
 */

function scene(modifiers: Modifier[], others: SceneObject[] = []): SceneDocument {
  const context = editContext({ mesh: boxMesh(2), mode: 'object' })
  return {
    ...context.document,
    objects: [{ ...context.document.objects[0]!, modifiers }, ...others],
  }
}

function modifier(patch: Partial<Modifier> = {}): Modifier {
  return {
    id: `modifier-${patch.kind ?? 'lift'}-${Math.round((patch.params?.height as number) ?? 0)}`,
    kind: 'smooth',
    name: 'Lift',
    enabled: { viewport: true, render: true, editMode: true, onCage: false },
    params: { height: 1 },
    ...patch,
  }
}

/** Moves every vertex up by `height`, so a test can see the order the stack ran in. */
const lift = vi.fn()

beforeEach(() => {
  resetModifiers()
  clearModifierCache()
  lift.mockClear()
  registerModifier({
    kind: 'smooth',
    label: 'Lift',
    category: 'deform',
    description: 'Moves every vertex up, for the tests of the stack.',
    defaults: { height: 1 },
    schema: [],
    apply: (mesh, params) => {
      lift()
      const height = Number(params.height) || 0
      if (height < 0) return 'A lift cannot be negative.'
      for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
        const point = mesh.position(slot)
        mesh.setPosition(slot, [point[0], point[1], point[2] + height])
      }
      return undefined
    },
  })
})

describe('the modifier stack', () => {
  it('gives an object with no modifiers its own mesh back, untouched', () => {
    const document = scene([])
    const object = document.objects[0]!

    const evaluated = evaluateObject(document, object)!

    expect(evaluated.mesh).toBe(document.meshes[(object.data as { meshId: string }).meshId])
    expect(evaluated.applied).toBe(0)
    expect(lift).not.toHaveBeenCalled()
  })

  it('applies the stack in order, and leaves the document alone', () => {
    const document = scene([modifier({ params: { height: 1 } }), modifier({ params: { height: 3 } })])
    const object = document.objects[0]!

    const evaluated = evaluateObject(document, object)!

    expect(evaluated.applied).toBe(2)
    // Four metres up: one modifier then the next, on the output of the first.
    expect(evaluated.mesh.vertices[2]).toBeCloseTo(-1 + 4, 10)
    const stored = document.meshes[(object.data as { meshId: string }).meshId]!
    expect(stored.vertices[2]).toBeCloseTo(-1, 10)
  })

  it('skips a modifier switched off for the viewport, and keeps it for the render', () => {
    const off = modifier({ params: { height: 2 }, enabled: { viewport: false, render: true, editMode: true, onCage: false } })
    const document = scene([off])
    const object = document.objects[0]!

    expect(evaluateObject(document, object)!.applied).toBe(0)
    expect(evaluateObject(document, object, { forRender: true })!.applied).toBe(1)
  })

  it('stands aside in edit mode when it was asked to', () => {
    const off = modifier({ params: { height: 2 }, enabled: { viewport: true, render: true, editMode: false, onCage: false } })
    const document = scene([off])

    expect(evaluateObject(document, document.objects[0]!, { editing: true })!.applied).toBe(0)
    expect(evaluateObject(document, document.objects[0]!)!.applied).toBe(1)
  })

  it('shows the cage a modifier asked for, and the stored mesh otherwise', () => {
    const onCage = modifier({ params: { height: 2 }, enabled: { viewport: true, render: true, editMode: true, onCage: true } })
    const document = scene([onCage])
    const object = document.objects[0]!

    const caged = evaluateObject(document, object, { editing: true })!
    expect(caged.cage.vertices[2]).toBeCloseTo(1, 10)

    const other = scene([modifier({ params: { height: 2 } })])
    const plain = evaluateObject(other, other.objects[0]!, { editing: true })!
    expect(plain.cage.vertices[2]).toBeCloseTo(-1, 10)
  })

  it('carries on past a refusal, and says what it was', () => {
    const document = scene([modifier({ id: 'bad', params: { height: -1 } }), modifier({ params: { height: 2 } })])

    const evaluated = evaluateObject(document, document.objects[0]!)!

    expect(evaluated.applied).toBe(1)
    expect(evaluated.errors).toEqual([{ modifierId: 'bad', message: 'A lift cannot be negative.' }])
    expect(evaluated.mesh.vertices[2]).toBeCloseTo(1, 10)
  })

  it('says so when a modifier is not in this build', () => {
    const document = scene([modifier({ id: 'unknown', kind: 'cast' })])

    const evaluated = evaluateObject(document, document.objects[0]!)!

    expect(evaluated.applied).toBe(0)
    expect(evaluated.errors[0]!.message).toContain('not a modifier this build has')
  })

  it('answers the second time from the cache, without running anything', () => {
    const document = scene([modifier({ params: { height: 2 } })])
    const object = document.objects[0]!

    const first = evaluateObject(document, object)!
    const second = evaluateObject(document, object)!

    expect(second).toBe(first)
    expect(lift).toHaveBeenCalledTimes(1)
    expect(modifierCacheSize()).toBe(1)
  })

  it('runs again when a parameter changes, and not when something else does', () => {
    const document = scene([modifier({ params: { height: 2 } })])
    evaluateObject(document, document.objects[0]!)

    const moved = { ...document, view: { ...document.view, yaw: 45 } }
    evaluateObject(moved, moved.objects[0]!)
    expect(lift).toHaveBeenCalledTimes(1)

    const changed = scene([modifier({ params: { height: 5 } })])
    evaluateObject(changed, changed.objects[0]!)
    expect(lift).toHaveBeenCalledTimes(2)
  })

  it('runs again when an object a modifier reads has moved', () => {
    resetModifiers()
    const reader = vi.fn()
    registerModifier({
      kind: 'mirror',
      label: 'Reader',
      category: 'generate',
      description: 'Reads another object, for the tests of the cache.',
      defaults: { target: null },
      schema: [],
      objectInputs: ['target'],
      apply: (_mesh, _params, context) => {
        reader(context.inputs.target?.matrix[12])
      },
    })
    const empty: SceneObject = {
      ...editContext({ mesh: planeMesh(1) }).document.objects[0]!,
      id: 'empty', name: 'Empty', data: { kind: 'empty', display: 'plain-axes', size: 1 }, modifiers: [],
    }
    const document = scene([modifier({ kind: 'mirror', params: { target: 'empty' } })], [empty])

    evaluateObject(document, document.objects[0]!)
    evaluateObject(document, document.objects[0]!)
    expect(reader).toHaveBeenCalledTimes(1)

    const shifted = {
      ...document,
      objects: document.objects.map((object) => (
        object.id === 'empty' ? { ...object, transform: { ...object.transform, position: [4, 0, 0] as [number, number, number] } } : object
      )),
    }
    evaluateObject(shifted, shifted.objects[0]!)
    expect(reader).toHaveBeenCalledTimes(2)
    expect(reader).toHaveBeenLastCalledWith(4)
  })
})
