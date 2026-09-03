import { describe, expect, it } from 'vitest'
import { DEFAULT_MATERIAL, DEFAULT_UNITS, DEFAULT_VIEW, DEFAULT_WORLD, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { worldPosition } from '@/scene/objects'
import { SNAP_PIE } from '@/scene/operators/cursor'
import { getOperator, runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
import type { SceneDocument, SceneObject, SceneSelection, Vec3 } from '@/scene/types'

function object(id: string, position: Vec3, patch: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    name: id,
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: 'mesh-a' },
    modifiers: [],
    materialSlots: [DEFAULT_MATERIAL.id],
    ...patch,
  }
}

function scene(objects: SceneObject[], cursor: SceneDocument['cursor'] = { position: [0, 0, 0], rotation: [0, 0, 0] }): SceneDocument {
  return {
    version: 1,
    id: 'scene-test',
    name: 'Test',
    objects,
    meshes: { 'mesh-a': boxMesh(2) },
    collections: [{ id: ROOT_COLLECTION_ID, name: 'Scene Collection' }],
    materials: [{ ...DEFAULT_MATERIAL }],
    world: { ...DEFAULT_WORLD },
    cursor,
    view: structuredClone(DEFAULT_VIEW),
    units: { ...DEFAULT_UNITS },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function context(document: SceneDocument, selection: Partial<SceneSelection> = {}): OperatorContext {
  const full: SceneSelection = { objectIds: [], activeObjectId: null, ...selection }
  return {
    document,
    selection: full,
    mode: 'object',
    view: document.view,
    cursor: document.cursor,
    active: document.objects.find((entry) => entry.id === full.activeObjectId) ?? null,
  }
}

function run(id: string, ctx: OperatorContext, params: Partial<OperatorParams> = {}): OperatorResult {
  return runOperator(id, ctx, params)
}

function positionOf(result: OperatorResult, id: string): Vec3 {
  const found = result.document?.objects.find((entry) => entry.id === id)
  expect(found).toBeDefined()
  return found!.transform.position
}

function worldOf(result: OperatorResult, id: string): Vec3 {
  const document = result.document
  expect(document).toBeDefined()
  const found = document!.objects.find((entry) => entry.id === id)
  expect(found).toBeDefined()
  return worldPosition(document!, found!)
}

function expectNear(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 10)
  expect(actual[1]).toBeCloseTo(expected[1], 10)
  expect(actual[2]).toBeCloseTo(expected[2], 10)
}

describe('putting the cursor somewhere', () => {
  it('sends the cursor home, angles and all', () => {
    const document = scene([], { position: [3, 4, 5], rotation: [10, 20, 30] })

    for (const id of ['cursor.reset', 'cursor.toWorldOrigin']) {
      expect(run(id, context(document)).document?.cursor).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0] })
    }
  })

  it('puts the cursor at the middle of what is selected', () => {
    const document = scene([object('a', [0, 0, 0]), object('b', [2, 0, 0]), object('c', [4, 3, 0]), object('d', [100, 100, 100])])
    const result = run('cursor.toSelected', context(document, { objectIds: ['a', 'b', 'c'] }))

    expectNear(result.document!.cursor.position, [2, 1, 0])
  })

  it('measures that middle in the world, not inside a parent', () => {
    const document = scene([object('parent', [10, 0, 0]), object('child', [1, 0, 0], { parentId: 'parent' })])
    const result = run('cursor.toSelected', context(document, { objectIds: ['child'] }))

    expectNear(result.document!.cursor.position, [11, 0, 0])
  })

  it('puts the cursor on the active object and leaves the cursor’s angles alone', () => {
    const document = scene([object('a', [0, 0, 0]), object('b', [7, 8, 9])], { position: [0, 0, 0], rotation: [0, 0, 45] })
    const result = run('cursor.toActive', context(document, { objectIds: ['a', 'b'], activeObjectId: 'b' }))

    expect(result.document?.cursor).toEqual({ position: [7, 8, 9], rotation: [0, 0, 45] })
  })

  it('moves the cursor to the nearest point of the grid it is given', () => {
    const document = scene([], { position: [1.2, -0.6, 2.6], rotation: [0, 0, 0] })

    expect(run('cursor.toGrid', context(document)).document?.cursor.position).toEqual([1, -1, 3])
    expect(run('cursor.toGrid', context(document), { increment: 0.25 }).document?.cursor.position).toEqual([1.25, -0.5, 2.5])
  })

  it('takes a position and an orientation from whatever placed it', () => {
    const result = run('cursor.place', context(scene([])), { position: [1, 2, 3], rotation: [0, 45, 0] })

    expect(result.document?.cursor).toEqual({ position: [1, 2, 3], rotation: [0, 45, 0] })
  })

  it('says why it will not run', () => {
    expect(run('cursor.toSelected', context(scene([object('a', [0, 0, 0])]))).error).toBe('Nothing is selected.')
    expect(run('cursor.toActive', context(scene([object('a', [0, 0, 0])]))).error).toBe('Nothing is active.')
  })
})

describe('moving the selection onto the cursor', () => {
  const document = scene([object('a', [0, 0, 0]), object('b', [2, 0, 0]), object('c', [4, 0, 0])], { position: [5, 1, 0], rotation: [0, 0, 0] })
  const all = { objectIds: ['a', 'b', 'c'] }

  it('stacks everything on the cursor when the offset is not kept', () => {
    const result = run('cursor.selectionToCursor', context(document, all), { keepOffset: false })

    for (const id of ['a', 'b', 'c']) expectNear(positionOf(result, id), [5, 1, 0])
  })

  it('lands only the middle on the cursor when the offset is kept', () => {
    const result = run('cursor.selectionToCursor', context(document, all), { keepOffset: true })

    // The median of 0, 2 and 4 is 2; the cursor is at 5, so everything shifts by three.
    expectNear(positionOf(result, 'a'), [3, 1, 0])
    expectNear(positionOf(result, 'b'), [5, 1, 0])
    expectNear(positionOf(result, 'c'), [7, 1, 0])
  })

  it('leaves an unselected object where it was', () => {
    const result = run('cursor.selectionToCursor', context(document, { objectIds: ['a'] }), { keepOffset: false })

    expectNear(positionOf(result, 'b'), [2, 0, 0])
  })

  it('does not move a selected object twice because its parent is selected too', () => {
    const family = scene([object('parent', [0, 0, 0]), object('child', [1, 0, 0], { parentId: 'parent' })], { position: [5, 0, 0], rotation: [0, 0, 0] })
    const result = run('cursor.selectionToCursor', context(family, { objectIds: ['parent', 'child'] }), { keepOffset: false })

    expectNear(positionOf(result, 'parent'), [5, 0, 0])
    // The child keeps its place inside the parent and rides along, which is what a parent is for.
    expectNear(positionOf(result, 'child'), [1, 0, 0])
    expectNear(worldOf(result, 'child'), [6, 0, 0])
  })

  it('writes a child’s new position in its parent’s space, turned and scaled', () => {
    const family = scene([
      object('parent', [10, 0, 0], { transform: { position: [10, 0, 0], rotation: [0, 0, 90], scale: [2, 2, 2] } }),
      object('child', [1, 0, 0], { parentId: 'parent' }),
    ])
    expectNear(worldPosition(family, family.objects[1]!), [10, 2, 0])

    const result = run('cursor.selectionToCursor', context(family, { objectIds: ['child'] }), { keepOffset: false })

    expectNear(worldOf(result, 'child'), [0, 0, 0])
    expectNear(positionOf(result, 'child'), [0, 5, 0])
  })

  it('refuses with nothing selected', () => {
    expect(run('cursor.selectionToCursor', context(document)).error).toBe('Nothing is selected to move.')
    expect(run('cursor.selectionToGrid', context(document)).error).toBe('Nothing is selected to move.')
  })
})

describe('moving the selection onto the grid and onto the active object', () => {
  it('sends each object to its own nearest grid point', () => {
    const document = scene([object('a', [1.2, 0, 0]), object('b', [-0.6, 2.4, 0])])
    const result = run('cursor.selectionToGrid', context(document, { objectIds: ['a', 'b'] }))

    expectNear(positionOf(result, 'a'), [1, 0, 0])
    expectNear(positionOf(result, 'b'), [-1, 2, 0])
  })

  it('stacks the selection on the active object, which does not move', () => {
    const document = scene([object('a', [0, 0, 0]), object('b', [1, 1, 1]), object('c', [5, 5, 5])])
    const result = run('cursor.selectionToActive', context(document, { objectIds: ['a', 'b', 'c'], activeObjectId: 'c' }))

    expectNear(positionOf(result, 'a'), [5, 5, 5])
    expectNear(positionOf(result, 'b'), [5, 5, 5])
    expectNear(positionOf(result, 'c'), [5, 5, 5])
  })

  it('refuses when there is no active object, and when the active object is all there is', () => {
    const document = scene([object('a', [0, 0, 0])])

    expect(run('cursor.selectionToActive', context(document, { objectIds: ['a'] })).error).toBe('Nothing is active to move onto.')
    expect(run('cursor.selectionToActive', context(document, { objectIds: ['a'], activeObjectId: 'a' })).error)
      .toBe('Nothing but the active object is selected.')
  })
})

describe('the snap pie', () => {
  it('offers eight slices, and every one of them is an operator this build has', () => {
    expect(SNAP_PIE).toHaveLength(8)
    for (const id of SNAP_PIE) expect(getOperator(id)).toBeDefined()
  })

  it('lays them out in the order Blender lays them out', () => {
    expect(SNAP_PIE).toEqual([
      'cursor.toGrid',
      'cursor.selectionToGrid',
      'cursor.toSelected',
      'cursor.selectionToCursor',
      'cursor.selectionToActive',
      'cursor.toWorldOrigin',
      'cursor.toActive',
      'cursor.selectionToCursor',
    ])
  })
})
