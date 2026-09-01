import { describe, expect, it } from 'vitest'
import { createVectorElement } from '@/vector/document'
import {
  ancestorIds,
  buildTree,
  descendantIds,
  flattenForLayers,
  groupElements,
  leafElements,
  moveInTree,
  resolveSelection,
  sanitizeParents,
  syncGroupBounds,
  ungroupElements,
} from '@/vector/tree'
import type { VectorElement } from '@/vector/types'

function shape(id: string, x: number, parentId?: string): VectorElement {
  return { ...createVectorElement('rectangle', { x, y: 0, width: 10, height: 10 }), id, name: id, ...(parentId ? { parentId } : {}) }
}

function group(id: string, parentId?: string): VectorElement {
  return { ...createVectorElement('group', { x: 0, y: 0, width: 1, height: 1 }), id, name: id, ...(parentId ? { parentId } : {}) }
}

describe('vector element tree', () => {
  it('groups elements where the topmost member sat and keeps descendants contiguous', () => {
    const elements = [shape('a', 0), shape('b', 100), shape('c', 200), shape('d', 300)]
    const grouped = groupElements(elements, ['a', 'c'], group('g'))
    expect(grouped.map((element) => element.id)).toEqual(['b', 'a', 'c', 'g', 'd'])
    expect(grouped.find((element) => element.id === 'a')?.parentId).toBe('g')
    const g = grouped.find((element) => element.id === 'g')!
    expect(g).toMatchObject({ x: 0, y: 0, width: 210, height: 10, rotation: 0 })
  })

  it('ungroups back to the parent level at the group position', () => {
    const grouped = groupElements([shape('a', 0), shape('b', 100), shape('c', 200)], ['a', 'b'], group('g'))
    const ungrouped = ungroupElements(grouped, 'g')
    expect(ungrouped.map((element) => element.id)).toEqual(['a', 'b', 'c'])
    expect(ungrouped.every((element) => !element.parentId)).toBe(true)
  })

  it('walks descendants, ancestors and leaves through nested groups', () => {
    const elements = [shape('a', 0, 'inner'), group('inner', 'outer'), shape('b', 50, 'outer'), group('outer'), shape('c', 500)]
    expect(descendantIds(elements, 'outer').sort()).toEqual(['a', 'b', 'inner'])
    expect(ancestorIds(elements, 'a')).toEqual(['inner', 'outer'])
    expect(leafElements(elements, ['outer', 'c']).map((element) => element.id)).toEqual(['a', 'b', 'c'])
    expect(buildTree(elements).map((node) => node.element.id)).toEqual(['outer', 'c'])
  })

  it('resolves clicks to the outermost group unless entered or forced deep', () => {
    const elements = [shape('a', 0, 'inner'), group('inner', 'outer'), shape('b', 50, 'outer'), group('outer')]
    expect(resolveSelection(elements, 'a', null)).toBe('outer')
    expect(resolveSelection(elements, 'a', 'outer')).toBe('inner')
    expect(resolveSelection(elements, 'a', 'inner')).toBe('a')
    expect(resolveSelection(elements, 'a', null, true)).toBe('a')
    expect(resolveSelection(elements, 'b', 'inner')).toBe('outer')
  })

  it('moves elements between parents without breaking contiguity and rejects cycles', () => {
    const elements = [shape('a', 0, 'g'), shape('b', 10, 'g'), group('g'), shape('c', 20)]
    const moved = moveInTree(elements, 'c', { parentId: 'g', index: 0 })
    expect(moved.map((element) => element.id)).toEqual(['c', 'a', 'b', 'g'])
    expect(moved[0]!.parentId).toBe('g')
    const out = moveInTree(moved, 'a', { parentId: null, index: 1 })
    expect(out.map((element) => element.id)).toEqual(['c', 'b', 'g', 'a'])
    expect(out.find((element) => element.id === 'a')?.parentId).toBeUndefined()
    expect(moveInTree(elements, 'g', { parentId: 'g', index: 0 })).toBe(elements)
  })

  it('recomputes group boxes from leaves and drops broken parents', () => {
    const elements = [shape('a', 0, 'g'), shape('b', 100, 'g'), { ...group('g'), x: 999, width: 1 }]
    const synced = syncGroupBounds(elements)
    expect(synced.find((element) => element.id === 'g')).toMatchObject({ x: 0, width: 110, height: 10 })
    const cleaned = sanitizeParents([shape('a', 0, 'missing'), shape('b', 0, 'b'), group('empty'), shape('c', 0, 'g'), group('g')])
    expect(cleaned.map((element) => element.id)).toEqual(['a', 'b', 'c', 'g'])
    expect(cleaned[0]!.parentId).toBeUndefined()
    expect(cleaned[1]!.parentId).toBeUndefined()
  })

  it('flattens rows for the layers panel with collapsed groups', () => {
    const elements = [shape('a', 0, 'g'), shape('b', 10, 'g'), group('g'), shape('c', 20)]
    expect(flattenForLayers(elements, new Set()).map((row) => `${row.depth}:${row.element.id}`)).toEqual(['0:c', '0:g', '1:b', '1:a'])
    expect(flattenForLayers(elements, new Set(['g'])).map((row) => row.element.id)).toEqual(['c', 'g'])
  })
})
