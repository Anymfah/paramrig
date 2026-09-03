import { describe, expect, it } from 'vitest'
import { DEFAULT_MATERIAL, DEFAULT_UNITS, DEFAULT_VIEW, DEFAULT_WORLD, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import '@/scene/operators/collection'
import { runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
import type { Collection, SceneDocument, SceneObject, SceneSelection } from '@/scene/types'

function object(id: string, patch: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    name: id,
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: 'mesh-a' },
    modifiers: [],
    materialSlots: [DEFAULT_MATERIAL.id],
    ...patch,
  }
}

function scene(objects: SceneObject[], collections: Collection[] = [], cursor: SceneDocument['cursor'] = { position: [0, 0, 0], rotation: [0, 0, 0] }): SceneDocument {
  return {
    version: 1,
    id: 'scene-test',
    name: 'Test',
    objects,
    meshes: { 'mesh-a': boxMesh(2) },
    collections: [{ id: ROOT_COLLECTION_ID, name: 'Scene Collection' }, ...collections],
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

/**
 * The invariant every operator in the family owes: nothing points at a collection that is not
 * there. It is asserted after each change rather than reasoned about, because the failure it
 * catches — an object filed nowhere — is invisible in the outliner.
 */
function expectNothingDangling(document: SceneDocument | undefined): SceneDocument {
  expect(document).toBeDefined()
  const present = new Set(document!.collections.map((collection) => collection.id))
  for (const object of document!.objects) {
    expect(present.has(object.collectionId)).toBe(true)
    if (object.data.kind === 'empty' && object.data.instanceCollectionId) {
      expect(present.has(object.data.instanceCollectionId)).toBe(true)
    }
    if (object.parentId) expect(document!.objects.some((entry) => entry.id === object.parentId)).toBe(true)
  }
  for (const collection of document!.collections.slice(1)) {
    expect(present.has(collection.parentId ?? '')).toBe(true)
  }
  return document!
}

const PROPS: Collection = { id: 'collection-props', name: 'Props', parentId: ROOT_COLLECTION_ID }
const CRATES: Collection = { id: 'collection-crates', name: 'Crates', parentId: PROPS.id }

function names(document: SceneDocument): string[] {
  return document.collections.map((collection) => collection.name)
}

function collectionOf(document: SceneDocument, id: string): Collection {
  const found = document.collections.find((collection) => collection.id === id)
  expect(found).toBeDefined()
  return found!
}

describe('making and naming a collection', () => {
  it('adds an empty collection under the one it was given', () => {
    const document = expectNothingDangling(run('collection.new', context(scene([], [PROPS])), { name: 'Crates', parentId: PROPS.id }).document)

    expect(names(document)).toEqual(['Scene Collection', 'Props', 'Crates'])
    expect(document.collections.at(-1)?.parentId).toBe(PROPS.id)
  })

  it('files it under the active object’s collection when the caller names none', () => {
    const document = scene([object('crate', { collectionId: PROPS.id })], [PROPS])
    const made = expectNothingDangling(run('collection.new', context(document, { activeObjectId: 'crate' }), { name: 'Lids' }).document)

    expect(made.collections.at(-1)?.parentId).toBe(PROPS.id)
  })

  it('keeps a name unique in the document, the way Blender’s suffix does', () => {
    const document = expectNothingDangling(run('collection.new', context(scene([], [PROPS])), { name: 'Props' }).document)

    expect(names(document)).toEqual(['Scene Collection', 'Props', 'Props.001'])
  })

  it('refuses a name that is nothing at all', () => {
    expect(run('collection.new', context(scene([])), { name: '   ' }).error).toBe('A collection needs a name.')
    expect(run('collection.rename', context(scene([], [PROPS])), { collectionId: PROPS.id, name: '' }).error)
      .toBe('A collection needs a name.')
  })

  it('renames a collection, and refuses one that is not in the document', () => {
    const renamed = expectNothingDangling(run('collection.rename', context(scene([], [PROPS])), { collectionId: PROPS.id, name: 'Set dressing' }).document)
    expect(names(renamed)).toEqual(['Scene Collection', 'Set dressing'])

    expect(run('collection.rename', context(scene([], [PROPS])), { collectionId: 'collection-gone', name: 'Anything' }).error)
      .toBe('That collection is not in this document.')
  })

  it('suffixes a rename onto a name another collection already has', () => {
    const document = expectNothingDangling(run('collection.rename', context(scene([], [PROPS, CRATES])), { collectionId: CRATES.id, name: 'Props' }).document)

    expect(names(document)).toEqual(['Scene Collection', 'Props', 'Props.001'])
  })
})

describe('deleting a collection', () => {
  const document = scene(
    [object('crate', { collectionId: CRATES.id }), object('prop', { collectionId: PROPS.id }), object('loose')],
    [PROPS, CRATES],
  )

  it('moves the objects and the collections under it up to its parent', () => {
    const after = expectNothingDangling(run('collection.delete', context(document), { collectionId: PROPS.id, keepObjects: true }).document)

    expect(names(after)).toEqual(['Scene Collection', 'Crates'])
    expect(collectionOf(after, CRATES.id).parentId).toBe(ROOT_COLLECTION_ID)
    expect(after.objects.find((entry) => entry.id === 'prop')?.collectionId).toBe(ROOT_COLLECTION_ID)
    // The crate was in the collection below and stays there; only its ancestor moved.
    expect(after.objects.find((entry) => entry.id === 'crate')?.collectionId).toBe(CRATES.id)
  })

  it('takes the objects and everything nested with it when it is told not to keep them', () => {
    const result = run('collection.delete', context(document, { objectIds: ['crate', 'loose'], activeObjectId: 'crate' }), { collectionId: PROPS.id, keepObjects: false })
    const after = expectNothingDangling(result.document)

    expect(names(after)).toEqual(['Scene Collection'])
    expect(after.objects.map((entry) => entry.id)).toEqual(['loose'])
    expect(result.selection?.objectIds).toEqual(['loose'])
    expect(result.selection?.activeObjectId).toBe('loose')
  })

  it('unparents a child that outlives the object it hung from', () => {
    const parented = scene(
      [object('rig', { collectionId: PROPS.id }), object('hanging', { parentId: 'rig' })],
      [PROPS],
    )
    const after = expectNothingDangling(run('collection.delete', context(parented), { collectionId: PROPS.id, keepObjects: false }).document)

    expect(after.objects.map((entry) => entry.id)).toEqual(['hanging'])
    expect(after.objects[0]?.parentId).toBeUndefined()
  })

  it('stops an empty from standing in for a collection that has gone', () => {
    const instanced = scene(
      [object('stand-in', { kind: 'empty', data: { kind: 'empty', display: 'plain-axes', size: 1, instanceCollectionId: PROPS.id }, materialSlots: [] })],
      [PROPS],
    )
    const after = expectNothingDangling(run('collection.delete', context(instanced), { collectionId: PROPS.id, keepObjects: false }).document)

    expect(after.objects[0]?.data).toEqual({ kind: 'empty', display: 'plain-axes', size: 1 })
  })

  it('refuses to delete the scene collection, and refuses one it cannot find', () => {
    expect(run('collection.delete', context(document), { collectionId: ROOT_COLLECTION_ID }).error)
      .toBe('The scene collection cannot be deleted.')
    expect(run('collection.delete', context(document), { collectionId: 'collection-gone' }).error)
      .toBe('That collection is not in this document.')
    expect(run('collection.delete', context(scene([])), { collectionId: ROOT_COLLECTION_ID }).error)
      .toBe('The scene collection cannot be deleted.')
  })
})

describe('nesting a collection', () => {
  const document = scene([], [PROPS, CRATES, { id: 'collection-sets', name: 'Sets', parentId: ROOT_COLLECTION_ID }])

  it('moves a collection under another one', () => {
    const after = expectNothingDangling(run('collection.nest', context(document), { collectionId: CRATES.id, intoId: 'collection-sets' }).document)

    expect(collectionOf(after, CRATES.id).parentId).toBe('collection-sets')
  })

  it('brings a collection back to the top when it is given no target', () => {
    const after = expectNothingDangling(run('collection.nest', context(document), { collectionId: CRATES.id }).document)

    expect(collectionOf(after, CRATES.id).parentId).toBe(ROOT_COLLECTION_ID)
  })

  it('refuses to nest the scene collection, a collection in itself, or one in its own descendant', () => {
    expect(run('collection.nest', context(document), { collectionId: ROOT_COLLECTION_ID, intoId: PROPS.id }).error)
      .toBe('The scene collection is the top of the tree; it cannot be nested inside another.')
    expect(run('collection.nest', context(document), { collectionId: PROPS.id, intoId: PROPS.id }).error)
      .toBe('A collection cannot be nested inside itself.')
    expect(run('collection.nest', context(document), { collectionId: PROPS.id, intoId: CRATES.id }).error)
      .toBe('A collection cannot be nested inside one of its own descendants.')
  })
})

describe('excluding, hiding and locking', () => {
  const document = scene([], [PROPS])

  it('turns each restriction on and takes the key back off again', () => {
    for (const [id, key] of [['collection.toggleExclude', 'excluded'], ['collection.toggleHide', 'hidden']] as const) {
      const on = expectNothingDangling(run(id, context(document), { collectionId: PROPS.id }).document)
      expect(collectionOf(on, PROPS.id)[key]).toBe(true)

      const off = expectNothingDangling(run(id, context(on), { collectionId: PROPS.id }).document)
      expect(key in collectionOf(off, PROPS.id)).toBe(false)
    }
  })

  it('writes selectable only when selection is off, because absent means it is on', () => {
    const locked = expectNothingDangling(run('collection.toggleSelectable', context(document), { collectionId: PROPS.id }).document)
    expect(collectionOf(locked, PROPS.id).selectable).toBe(false)

    const unlocked = expectNothingDangling(run('collection.toggleSelectable', context(locked), { collectionId: PROPS.id }).document)
    expect('selectable' in collectionOf(unlocked, PROPS.id)).toBe(false)
  })

  it('names the step after what it did, so the history reads as a sentence', () => {
    expect(run('collection.toggleExclude', context(document), { collectionId: PROPS.id }).label).toBe('Exclude collection')
    expect(run('collection.toggleHide', context(document), { collectionId: PROPS.id }).label).toBe('Hide collection')
  })

  it('refuses to exclude the scene collection', () => {
    expect(run('collection.toggleExclude', context(document), { collectionId: ROOT_COLLECTION_ID }).error)
      .toBe('The scene collection cannot be excluded from the view.')
    expect(run('collection.toggleExclude', context(scene([])), { collectionId: ROOT_COLLECTION_ID }).error)
      .toBe('The scene collection cannot be excluded from the view.')
  })

  it('lets the scene collection be hidden, which the outliner does offer', () => {
    const after = expectNothingDangling(run('collection.toggleHide', context(document), { collectionId: ROOT_COLLECTION_ID }).document)

    expect(collectionOf(after, ROOT_COLLECTION_ID).hidden).toBe(true)
  })
})

describe('the colour of a collection', () => {
  const document = scene([], [PROPS])

  it('tags a collection and takes the tag back off', () => {
    const tagged = expectNothingDangling(run('collection.setColour', context(document), { collectionId: PROPS.id, colour: '#6ea84f' }).document)
    expect(collectionOf(tagged, PROPS.id).color).toBe('#6ea84f')

    const cleared = expectNothingDangling(run('collection.setColour', context(tagged), { collectionId: PROPS.id, colour: 'none' }).document)
    expect('color' in collectionOf(cleared, PROPS.id)).toBe(false)
  })

  it('refuses a colour that is not one of the tags', () => {
    expect(run('collection.setColour', context(document), { collectionId: PROPS.id, colour: '#123456' }).error)
      .toBe('That is not one of the collection colours.')
  })
})

describe('instancing a collection', () => {
  it('adds an empty at the cursor that stands in for the collection, selected and active', () => {
    const document = scene([object('loose')], [PROPS], { position: [1, 2, 3], rotation: [0, 0, 0] })
    const result = run('collection.instance', context(document, { activeObjectId: 'loose' }), { collectionId: PROPS.id })
    const after = expectNothingDangling(result.document)
    const added = after.objects.at(-1)

    expect(added?.kind).toBe('empty')
    expect(added?.name).toBe('Props')
    expect(added?.transform.position).toEqual([1, 2, 3])
    expect(added?.data).toEqual({ kind: 'empty', display: 'plain-axes', size: 1, instanceCollectionId: PROPS.id })
    expect(result.selection?.objectIds).toEqual([added?.id])
    expect(result.selection?.activeObjectId).toBe(added?.id)
  })

  it('refuses to put the stand-in inside the collection it stands in for', () => {
    const document = scene([object('crate', { collectionId: CRATES.id })], [PROPS, CRATES])

    expect(run('collection.instance', context(document, { activeObjectId: 'crate' }), { collectionId: PROPS.id }).error)
      .toBe('A collection cannot be instanced inside itself.')
    expect(run('collection.instance', context(document, { activeObjectId: 'crate' }), { collectionId: ROOT_COLLECTION_ID }).error)
      .toBe('A collection cannot be instanced inside itself.')
  })

  it('refuses when the document has nothing but the scene collection', () => {
    expect(run('collection.instance', context(scene([]))).error).toBe('There is no collection to instance.')
  })
})
