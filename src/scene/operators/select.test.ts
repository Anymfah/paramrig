import { describe, expect, it } from 'vitest'
import { DEFAULT_MATERIAL, DEFAULT_UNITS, DEFAULT_VIEW, DEFAULT_WORLD, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { runOperator } from '@/scene/operators/registry'
import { applySelectMode } from '@/scene/operators/select'
import type { OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
import type { Collection, SceneDocument, SceneObject, SceneSelection } from '@/scene/types'

/*
 * The scenes are built by hand rather than from `createSceneDocument` so that the names, the
 * collections and the shared meshes are the ones each behaviour is about.
 */

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

function scene(objects: SceneObject[], collections: Collection[] = []): SceneDocument {
  return {
    version: 1,
    id: 'scene-test',
    name: 'Test',
    objects,
    meshes: { 'mesh-a': boxMesh(2), 'mesh-b': boxMesh(1) },
    collections: [{ id: ROOT_COLLECTION_ID, name: 'Scene Collection' }, ...collections],
    materials: [{ ...DEFAULT_MATERIAL }],
    world: { ...DEFAULT_WORLD },
    cursor: { position: [0, 0, 0], rotation: [0, 0, 0] },
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

function selected(result: OperatorResult): string[] {
  return result.selection?.objectIds ?? []
}

const THREE_CUBES = [object('a'), object('b'), object('c')]

describe('folding a region into the selection', () => {
  it('replaces the selection with what the region covered', () => {
    expect(applySelectMode(['a'], ['b', 'c'], 'new')).toEqual(['b', 'c'])
  })

  it('keeps the order things were picked in, and never lists one twice', () => {
    expect(applySelectMode(['a', 'b'], ['b', 'c', 'c'], 'extend')).toEqual(['a', 'b', 'c'])
    expect(applySelectMode([], ['c', 'a', 'c'], 'new')).toEqual(['c', 'a'])
  })

  it('takes away only what the region covered', () => {
    expect(applySelectMode(['a', 'b', 'c'], ['b'], 'subtract')).toEqual(['a', 'c'])
    expect(applySelectMode(['a'], ['z'], 'subtract')).toEqual(['a'])
  })

  it('toggles both ways at once when inverting', () => {
    expect(applySelectMode(['a', 'b'], ['b', 'c'], 'invert')).toEqual(['a', 'c'])
  })

  it('keeps only the overlap when intersecting', () => {
    expect(applySelectMode(['a', 'b'], ['b', 'c'], 'intersect')).toEqual(['b'])
    expect(applySelectMode(['a'], [], 'intersect')).toEqual([])
  })
})

describe('box, circle and lasso', () => {
  for (const id of ['select.box', 'select.circle', 'select.lasso']) {
    it(`takes the ids ${id} is handed and applies the mode to them`, () => {
      const document = scene(THREE_CUBES)
      expect(selected(run(id, context(document, { objectIds: ['a'] }), { ids: ['b', 'c'] }))).toEqual(['b', 'c'])
      expect(selected(run(id, context(document, { objectIds: ['a'] }), { ids: ['b'], mode: 'extend' }))).toEqual(['a', 'b'])
      expect(selected(run(id, context(document, { objectIds: ['a', 'b'] }), { ids: ['b'], mode: 'subtract' }))).toEqual(['a'])
    })
  }

  it('never picks up an object the region covered but that cannot be selected', () => {
    const document = scene([object('a'), object('b', { visible: false }), object('c', { selectable: false })])

    expect(selected(run('select.box', context(document), { ids: ['a', 'b', 'c'] }))).toEqual(['a'])
  })

  it('drops an id of something that has gone, so replaying an old drag is still valid', () => {
    // The F9 panel replays the operator against the document as it was before, with the ids the
    // drag found; an object deleted in between must not come back into the selection.
    const document = scene([object('a')])

    expect(selected(run('select.box', context(document), { ids: ['a', 'deleted'] }))).toEqual(['a'])
  })

  it('leaves the active object inside the selection, or picks a new one', () => {
    const document = scene(THREE_CUBES)
    const kept = run('select.box', context(document, { objectIds: ['a', 'b'], activeObjectId: 'b' }), { ids: ['b', 'c'], mode: 'extend' })
    expect(kept.selection?.activeObjectId).toBe('b')

    const replaced = run('select.box', context(document, { objectIds: ['a'], activeObjectId: 'a' }), { ids: ['b', 'c'] })
    expect(replaced.selection?.activeObjectId).toBe('c')
  })

  it('refuses when the scene holds nothing that can be selected', () => {
    const document = scene([object('a', { visible: false })])

    expect(run('select.box', context(document), { ids: ['a'] }).error).toBe('There is nothing here to select.')
  })
})

describe('all, none and invert', () => {
  it('selects everything that can be selected, and nothing that cannot', () => {
    const document = scene([object('a'), object('b', { selectable: false }), object('c')])

    expect(selected(run('select.all', context(document)))).toEqual(['a', 'c'])
  })

  it('clears the selection and the active object together', () => {
    const document = scene(THREE_CUBES)
    const result = run('select.none', context(document, { objectIds: ['a'], activeObjectId: 'a' }))

    expect(selected(result)).toEqual([])
    expect(result.selection?.activeObjectId).toBeNull()
  })

  it('swaps what was selected for what was not', () => {
    const document = scene(THREE_CUBES)

    expect(selected(run('select.invert', context(document, { objectIds: ['b'] })))).toEqual(['a', 'c'])
  })

  it('says why when there is nothing to work on', () => {
    expect(run('select.none', context(scene(THREE_CUBES))).error).toBe('Nothing is selected.')
    expect(run('select.all', context(scene([]))).error).toBe('There is nothing here to select.')
  })
})

describe('what selection refuses to touch', () => {
  const hidden: Collection = { id: 'collection-hidden', name: 'Hidden', parentId: ROOT_COLLECTION_ID, hidden: true }
  const excluded: Collection = { id: 'collection-excluded', name: 'Excluded', parentId: ROOT_COLLECTION_ID, excluded: true }
  const locked: Collection = { id: 'collection-locked', name: 'Locked', parentId: ROOT_COLLECTION_ID, selectable: false }

  const document = scene(
    [
      object('visible'),
      object('invisible', { visible: false }),
      object('unselectable', { selectable: false }),
      object('in-hidden', { collectionId: hidden.id }),
      object('in-excluded', { collectionId: excluded.id }),
      object('in-locked', { collectionId: locked.id }),
    ],
    [hidden, excluded, locked],
  )

  it('leaves out the hidden, the unselectable and everything in a collection that is put away', () => {
    expect(selected(run('select.all', context(document)))).toEqual(['visible'])
  })

  it('leaves out everything the local view is not showing', () => {
    const pair = scene([object('a'), object('b')])
    const local = { ...pair, view: { ...pair.view, localObjectIds: ['a'] } }

    expect(selected(run('select.all', context(local)))).toEqual(['a'])
  })

  it('holds for the operators that grow a selection as well as for select all', () => {
    expect(selected(run('select.pattern', context(document), { pattern: '*' }))).toEqual(['visible'])
    expect(selected(run('select.random', context(document), { ratio: 1 }))).toEqual(['visible'])
    expect(selected(run('select.allByType', context(document), { kind: 'mesh' }))).toEqual(['visible'])
  })
})

describe('selecting what is similar to the active object', () => {
  const document = scene([
    object('cube', { data: { kind: 'mesh', meshId: 'mesh-a' } }),
    object('twin', { data: { kind: 'mesh', meshId: 'mesh-a' } }),
    object('other', { data: { kind: 'mesh', meshId: 'mesh-b' }, materialSlots: [] }),
    object('lamp', { kind: 'light', data: { kind: 'light', light: 'point', color: '#ffffff', power: 1000, radius: 0.1, spotAngle: 45, spotBlur: 0.15, areaShape: 'square', areaSize: [1, 1], shadow: true }, materialSlots: [] }),
  ])

  it('adds every object of the same kind', () => {
    expect(selected(run('select.similar', context(document, { objectIds: ['cube'], activeObjectId: 'cube' }), { trait: 'type' })))
      .toEqual(['cube', 'twin', 'other'])
  })

  it('adds every object sharing the active object’s mesh, and not those with another', () => {
    expect(selected(run('select.similar', context(document, { objectIds: ['cube'], activeObjectId: 'cube' }), { trait: 'data' })))
      .toEqual(['cube', 'twin'])
  })

  it('adds every object sharing a material slot', () => {
    expect(selected(run('select.similar', context(document, { objectIds: [], activeObjectId: 'cube' }), { trait: 'material' })))
      .toEqual(['cube', 'twin'])
  })

  it('adds every object filed in the same collection', () => {
    const filed = scene(
      [object('a'), object('b'), object('c', { collectionId: 'collection-props' })],
      [{ id: 'collection-props', name: 'Props', parentId: ROOT_COLLECTION_ID }],
    )

    expect(selected(run('select.similar', context(filed, { activeObjectId: 'a' }), { trait: 'collection' }))).toEqual(['a', 'b'])
  })

  it('grows the selection rather than replacing it', () => {
    const result = run('select.similar', context(document, { objectIds: ['lamp'], activeObjectId: 'cube' }), { trait: 'type' })

    expect(selected(result)).toEqual(['lamp', 'cube', 'twin', 'other'])
  })

  it('refuses without an active object, and refuses to match mesh data on something that has none', () => {
    expect(run('select.similar', context(document), { trait: 'type' }).error).toBe('Nothing is active to compare against.')
    expect(run('select.similar', context(document, { activeObjectId: 'lamp' }), { trait: 'data' }).error)
      .toBe('The active object has no mesh data to match.')
  })
})

describe('selecting what is grouped with the active object', () => {
  const props: Collection = { id: 'collection-props', name: 'Props', parentId: ROOT_COLLECTION_ID }
  const document = scene(
    [
      object('parent'),
      object('child', { parentId: 'parent' }),
      object('grandchild', { parentId: 'child' }),
      object('sibling'),
      object('prop', { collectionId: props.id }),
      object('lamp', { kind: 'light', data: { kind: 'light', light: 'sun', color: '#ffffff', power: 3, radius: 0.1, spotAngle: 45, spotBlur: 0.15, areaShape: 'square', areaSize: [1, 1], shadow: true }, materialSlots: [] }),
    ],
    [props],
  )

  it('finds the collection, the parent, the children, the siblings and the type', () => {
    const from = (id: string, by: string) => selected(run('select.grouped', context(document, { activeObjectId: id }), { by }))

    expect(from('parent', 'collection')).toEqual(['parent', 'child', 'grandchild', 'sibling', 'lamp'])
    expect(from('child', 'parent')).toEqual(['parent'])
    expect(from('parent', 'children')).toEqual(['child', 'grandchild'])
    expect(from('parent', 'siblings')).toEqual(['sibling', 'prop', 'lamp'])
    expect(from('lamp', 'type')).toEqual(['lamp'])
  })

  it('refuses when the active object has no parent, and when nothing is grouped that way', () => {
    expect(run('select.grouped', context(document, { activeObjectId: 'parent' }), { by: 'parent' }).error)
      .toBe('The active object has no parent.')
    expect(run('select.grouped', context(document, { activeObjectId: 'grandchild' }), { by: 'children' }).error)
      .toBe('Nothing is grouped with the active object that way.')
    expect(run('select.grouped', context(document), { by: 'type' }).error).toBe('Nothing is active to group from.')
  })
})

describe('selecting by name', () => {
  const document = scene([
    object('cube', { name: 'Cube' }),
    object('cube-001', { name: 'Cube.001' }),
    object('cubex', { name: 'CubeX001' }),
    object('bolt', { name: 'bolt+nut' }),
    object('bolts', { name: 'boltsnut' }),
  ])

  it('reads * as any run of characters and ? as exactly one', () => {
    const match = (pattern: string) => selected(run('select.pattern', context(document), { pattern }))

    expect(match('Cube*')).toEqual(['cube', 'cube-001', 'cubex'])
    expect(match('?ube')).toEqual(['cube'])
    expect(match('*nut')).toEqual(['bolt', 'bolts'])
    expect(match('*ube*0*1')).toEqual(['cube-001', 'cubex'])
  })

  it('treats a pattern as a name and not as a regular expression', () => {
    // A dot in a regular expression matches anything and a plus repeats; here both are ordinary
    // characters, so “Cube.001” matches one name and “bolt+nut” matches one name.
    expect(selected(run('select.pattern', context(document), { pattern: 'Cube.001' }))).toEqual(['cube-001'])
    expect(selected(run('select.pattern', context(document), { pattern: 'bolt+nut' }))).toEqual(['bolt'])
    expect(run('select.pattern', context(document), { pattern: 'bolt+' }).error).toBe('No name matches that pattern.')
  })

  it('ignores the case of a name unless it is asked not to', () => {
    expect(selected(run('select.pattern', context(document), { pattern: 'cube*' }))).toEqual(['cube', 'cube-001', 'cubex'])
    expect(run('select.pattern', context(document), { pattern: 'cube*', caseSensitive: true }).error)
      .toBe('No name matches that pattern.')
  })

  it('says why when the pattern is empty and when it matches nothing', () => {
    expect(run('select.pattern', context(document), { pattern: '  ' }).error).toBe('Type a pattern to match, such as “Cube*”.')
    expect(run('select.pattern', context(document), { pattern: 'Sphere*' }).error).toBe('No name matches that pattern.')
  })
})

describe('selecting at random', () => {
  const document = scene(Array.from({ length: 40 }, (_, index) => object(`object-${index}`)))

  it('gives the same objects every time it is run with the same seed', () => {
    const first = selected(run('select.random', context(document), { ratio: 0.5, seed: 7 }))
    const second = selected(run('select.random', context(document), { ratio: 0.5, seed: 7 }))

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThan(40)
  })

  it('gives another set for another seed', () => {
    const seven = selected(run('select.random', context(document), { ratio: 0.5, seed: 7 }))
    const eight = selected(run('select.random', context(document), { ratio: 0.5, seed: 8 }))

    expect(eight).not.toEqual(seven)
  })

  it('selects nothing at a ratio of nought and everything at a ratio of one', () => {
    expect(selected(run('select.random', context(document, { objectIds: ['object-0'] }), { ratio: 0, seed: 1 }))).toEqual(['object-0'])
    expect(selected(run('select.random', context(document), { ratio: 1, seed: 1 }))).toHaveLength(40)
  })
})

describe('selecting by type and by linked data', () => {
  const light = object('lamp', { kind: 'light', data: { kind: 'light', light: 'point', color: '#ffffff', power: 1000, radius: 0.1, spotAngle: 45, spotBlur: 0.15, areaShape: 'square', areaSize: [1, 1], shadow: true }, materialSlots: [] })
  const document = scene([object('cube'), object('twin'), light])

  it('adds every object of one kind', () => {
    expect(selected(run('select.allByType', context(document), { kind: 'light' }))).toEqual(['lamp'])
    expect(selected(run('select.allByType', context(document), { kind: 'mesh' }))).toEqual(['cube', 'twin'])
  })

  it('refuses a kind the scene has none of', () => {
    expect(run('select.allByType', context(document), { kind: 'camera' }).error).toBe('There is no camera object here to select.')
  })

  it('adds every object showing the active object’s mesh', () => {
    const linked = scene([
      object('cube'),
      object('twin'),
      object('other', { data: { kind: 'mesh', meshId: 'mesh-b' } }),
    ])

    expect(selected(run('select.linkedData', context(linked, { objectIds: ['cube'], activeObjectId: 'cube' })))).toEqual(['cube', 'twin'])
  })

  it('refuses when the active object carries no mesh', () => {
    expect(run('select.linkedData', context(document, { activeObjectId: 'lamp' })).error).toBe('The active object has no mesh data to match.')
    expect(run('select.linkedData', context(document)).error).toBe('Nothing is active to compare against.')
  })
})
