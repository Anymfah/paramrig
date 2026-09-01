import { describe, expect, it } from 'vitest'
import { insertNode, nearestSegment, toggleNodeType } from '@/vector/bezier'
import { createVectorElement, sanitizeVectorDocument, createVectorDocument } from '@/vector/document'
import { breakSegment, combineElements, deleteNodes, joinNodes, neighbours, openEndpoints, separateSubpaths, setClosed, splitAtNode, subpathRanges } from '@/vector/subpaths'
import type { VectorElement } from '@/vector/types'
import { nodeWorldPosition, vectorPathData } from '@/vector/vectorPath'

const two: VectorElement = {
  id: 'two', kind: 'path', name: 'Two', x: 0, y: 0, width: 100, height: 100, rotation: 0,
  fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, opacity: 1, visible: true, locked: false,
  vectorNodes: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  subpaths: [{ start: 0, closed: true }, { start: 3, closed: false }],
}

describe('sub-paths', () => {
  it('renders one M per sub-path and closes only closed ones', () => {
    expect(vectorPathData(two)).toBe('M 0 0 L 50 0 L 50 50 L 0 0 Z M 0 100 L 100 100')
    expect(subpathRanges(two, 5)).toEqual([{ start: 0, end: 3, closed: true }, { start: 3, end: 5, closed: false }])
    expect(neighbours(two, 5, 2)).toEqual({ previous: 1, next: 0 })
    expect(neighbours(two, 5, 4)).toEqual({ previous: 3, next: null })
    expect(neighbours(two, 5, 3)).toEqual({ previous: null, next: 4 })
  })

  it('lists free ends and deletes nodes per sub-path', () => {
    expect(openEndpoints(two).map((end) => `${end.subpath}:${end.end}@${end.index}`)).toEqual(['1:start@3', '1:end@4'])
    const result = deleteNodes(two, two.vectorNodes!, [4])!
    expect(result.vectorNodes).toHaveLength(3)
    expect(result.subpaths).toBeUndefined()
    expect(result.closed).toBeUndefined()
    expect(deleteNodes(two, two.vectorNodes!, [0, 1, 2, 3, 4])).toBeNull()
    const opened = deleteNodes(two, two.vectorNodes!, [0])!
    expect(opened.subpaths).toEqual([{ start: 0, closed: false }, { start: 2, closed: false }])
  })

  it('joins two open sub-paths end to start, reversing when needed', () => {
    const open: VectorElement = { ...two, vectorNodes: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0.5 }], subpaths: [{ start: 0, closed: false }, { start: 2, closed: false }] }
    const joined = joinNodes(open, open.vectorNodes!, 1, 3)!
    expect(joined.subpaths).toBeUndefined()
    expect(joined.closed).toBe(false)
    const world = joined.vectorNodes.map((node) => nodeWorldPosition({ ...open, ...joined }, node))
    expect(world).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }])
    const closed = joinNodes({ ...open, ...joined }, joined.vectorNodes, 0, 3)!
    expect(closed.closed).toBeUndefined()
    expect(vectorPathData({ ...open, ...closed })).toContain('Z')
    expect(joinNodes(open, open.vectorNodes!, 0, 0)).toBeNull()
  })

  it('splits closed paths open and cuts open paths in two', () => {
    const square: VectorElement = { ...two, subpaths: undefined, vectorNodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
    const split = splitAtNode(square, square.vectorNodes!, 2)!
    expect(split.closed).toBe(false)
    expect(split.vectorNodes).toHaveLength(5)
    expect(vectorPathData({ ...square, ...split })).toBe('M 100 100 L 0 100 L 0 0 L 100 0 L 100 100')
    const cut = splitAtNode({ ...square, ...split }, split.vectorNodes, 2)!
    expect(cut.subpaths).toEqual([{ start: 0, closed: false }, { start: 3, closed: false }])
    expect(cut.vectorNodes).toHaveLength(6)
    expect(splitAtNode({ ...square, ...split }, split.vectorNodes, 0)).toBeNull()
  })

  it('breaks a segment', () => {
    const square: VectorElement = { ...two, subpaths: undefined, vectorNodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
    const broken = breakSegment(square, square.vectorNodes!, 1)!
    expect(broken.closed).toBe(false)
    expect(vectorPathData({ ...square, ...broken })).toBe('M 100 100 L 0 100 L 0 0 L 100 0')
    const cut = breakSegment({ ...square, ...broken }, broken.vectorNodes, 1)!
    expect(cut.subpaths).toEqual([{ start: 0, closed: false }, { start: 2, closed: false }])
    expect(breakSegment({ ...square, ...broken }, broken.vectorNodes, 3)).toBeNull()
  })

  it('closes and opens a sub-path in place and refuses closing two nodes', () => {
    expect(setClosed(two, two.vectorNodes!, 4, true)).toBeNull()
    const opened = setClosed(two, two.vectorNodes!, 1, false)!
    expect(opened.subpaths).toEqual([{ start: 0, closed: false }, { start: 3, closed: false }])
  })

  it('combines rotated elements into one path and separates them again', () => {
    const a = createVectorElement('rectangle', { x: 0, y: 0, width: 100, height: 100 })
    const b = { ...createVectorElement('rectangle', { x: 200, y: 0, width: 100, height: 100 }), rotation: 90 }
    const combined = combineElements([a, b], (element) => element.vectorNodes ?? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])!
    expect(combined).toMatchObject({ x: 0, y: 0, width: 300, height: 100, fillRule: 'evenodd' })
    expect(combined.subpaths).toEqual([{ start: 0, closed: true }, { start: 4, closed: true }])
    const parts = separateSubpaths({ ...a, ...combined, kind: 'path' }, combined.vectorNodes)
    expect(parts).toHaveLength(2)
    expect(parts[1]!.x).toBeCloseTo(200, 1)
    expect(parts[1]!.width).toBeCloseTo(100, 1)
  })

  it('inserts and toggles nodes without crossing sub-path boundaries', () => {
    const hit = nearestSegment(two, two.vectorNodes!, { x: 50, y: 103 })!
    expect(hit.index).toBe(3)
    const inserted = insertNode(two, two.vectorNodes!, 3, 0.5)
    expect(inserted.insertedIndex).toBe(4)
    expect(inserted.subpaths).toEqual([{ start: 0, closed: true }, { start: 3, closed: false }])
    expect(vectorPathData({ ...two, ...inserted })).toBe('M 0 0 L 50 0 L 50 50 L 0 0 Z M 0 100 L 50 100 L 100 100')
    const smooth = toggleNodeType(two, two.vectorNodes!, 3)
    expect(smooth.vectorNodes[3]!.in).toBeUndefined()
    expect(smooth.vectorNodes[3]!.out).toBeDefined()
  })

  it('survives sanitising and exports the fill rule', () => {
    const document = createVectorDocument()
    const result = sanitizeVectorDocument({ ...document, elements: [{ ...two, fillRule: 'evenodd' }] })!
    expect(result.elements[0]?.subpaths).toEqual(two.subpaths)
    expect(result.elements[0]?.fillRule).toBe('evenodd')
    const bad = sanitizeVectorDocument({ ...document, elements: [{ ...two, subpaths: [{ start: 0, closed: true }, { start: 4, closed: true }] }] })!
    expect(bad.elements).toHaveLength(0)
  })
})
