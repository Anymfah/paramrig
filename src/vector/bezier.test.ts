import { describe, expect, it } from 'vitest'
import { cubicAt, insertNode, isSmoothNode, nearestPointOnCubic, nearestSegment, placeNodeAt, splitCubic, toggleNodeType, type Cubic } from '@/vector/bezier'
import type { VectorElement } from '@/vector/types'
import { nodeWorldPosition, vectorPathData } from '@/vector/vectorPath'

const curve: Cubic = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }]

const square: VectorElement = {
  id: 'square', kind: 'path', name: 'Path', x: 0, y: 0, width: 100, height: 100, rotation: 0,
  fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, opacity: 1, visible: true, locked: false,
  vectorNodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
}

describe('bezier helpers', () => {
  it('splits a cubic so both halves meet on the curve with matching tangents', () => {
    const mid = cubicAt(curve, 0.5)
    const { left, right } = splitCubic(curve, 0.5)
    expect(left[3]).toEqual(mid)
    expect(right[0]).toEqual(mid)
    expect(left[0]).toEqual(curve[0])
    expect(right[3]).toEqual(curve[3])
    const tangentLeft = { x: left[3].x - left[2].x, y: left[3].y - left[2].y }
    const tangentRight = { x: right[1].x - right[0].x, y: right[1].y - right[0].y }
    expect(tangentLeft).toEqual(tangentRight)
    expect(cubicAt(left, 1)).toEqual(cubicAt(right, 0))
  })

  it('finds the nearest point on straight and curved segments', () => {
    const line: Cubic = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }]
    const near = nearestPointOnCubic(line, { x: 40, y: 5 })
    expect(near.point.x).toBeCloseTo(40, 1)
    expect(near.distance).toBeCloseTo(5, 1)
    const top = nearestPointOnCubic(curve, { x: 50, y: 80 })
    expect(top.t).toBeCloseTo(0.5, 2)
    expect(top.point.y).toBeCloseTo(75, 1)
  })

  it('reports the nearest segment of an element outline', () => {
    const hit = nearestSegment(square, square.vectorNodes!, { x: 50, y: 103 })
    expect(hit?.index).toBe(2)
    expect(hit?.distance).toBeCloseTo(3, 1)
    expect(hit?.point.x).toBeCloseTo(50, 1)
  })

  it('inserts a corner on a straight segment without disturbing the shape', () => {
    const result = insertNode(square, square.vectorNodes!, 0, 0.25)
    expect(result.insertedIndex).toBe(1)
    expect(result.vectorNodes).toHaveLength(5)
    expect(result.vectorNodes[1]).toEqual({ x: 0.25, y: 0 })
    expect(vectorPathData({ ...square, ...result })).toBe('M 0 0 L 25 0 L 100 0 L 100 100 L 0 100 L 0 0 Z')
  })

  it('inserts a smooth node on a curved segment and keeps the outline', () => {
    const curved: VectorElement = { ...square, vectorNodes: [{ x: 0, y: 0, out: { x: 0, y: 1 } }, { x: 1, y: 0, in: { x: 0, y: 1 } }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
    const before = nearestSegment(curved, curved.vectorNodes!, { x: 50, y: 75 })!.point
    const result = insertNode(curved, curved.vectorNodes!, 0, 0.5)
    const next = { ...curved, ...result }
    const inserted = result.vectorNodes[1]!
    expect(isSmoothNode(inserted)).toBe(true)
    const anchor = nodeWorldPosition(next, inserted)
    expect(anchor.x).toBeCloseTo(before.x, 1)
    expect(anchor.y).toBeCloseTo(before.y, 1)
    const after = nearestSegment(next, result.vectorNodes, { x: 25, y: 60 })!
    expect(after.distance).toBeCloseTo(nearestSegment(curved, curved.vectorNodes!, { x: 25, y: 60 })!.distance, 1)
  })

  it('toggles between corner and smooth nodes', () => {
    const smooth = toggleNodeType(square, square.vectorNodes!, 1)
    expect(isSmoothNode(smooth.vectorNodes[1]!)).toBe(true)
    const node = smooth.vectorNodes[1]!
    expect(node.in!.x).toBeCloseTo(-node.out!.x, 3)
    expect(node.in!.y).toBeCloseTo(-node.out!.y, 3)
    const corner = toggleNodeType({ ...square, ...smooth }, smooth.vectorNodes, 1)
    expect(isSmoothNode(corner.vectorNodes[1]!)).toBe(false)
  })

  it('moves an anchor to a world position with its handles', () => {
    const result = placeNodeAt(square, square.vectorNodes!, 2, { x: 150, y: 120 })
    const next = { ...square, ...result }
    expect(nodeWorldPosition(next, result.vectorNodes[2]!)).toEqual({ x: 150, y: 120 })
    expect(result.width).toBe(150)
  })
})
