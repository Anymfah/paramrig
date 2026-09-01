import { describe, expect, it } from 'vitest'
import { booleanOperation, flattenElement, outlineStroke, toPaperItem } from '@/vector/booleans'
import { createVectorElement } from '@/vector/document'
import type { VectorElement } from '@/vector/types'

const rect = (x: number, y: number, size = 100): VectorElement => createVectorElement('rectangle', { x, y, width: size, height: size })

describe('boolean geometry', () => {
  it('unites overlapping rectangles into one outline', () => {
    const result = booleanOperation('unite', [rect(0, 0), rect(50, 50)])!
    expect(result).toMatchObject({ x: 0, y: 0, width: 150, height: 150 })
    expect(result.vectorNodes).toHaveLength(8)
    expect(result.subpaths).toBeUndefined()
  })

  it('subtracts, intersects and excludes', () => {
    const subtract = booleanOperation('subtract', [rect(0, 0), rect(50, 50)])!
    expect(subtract.vectorNodes).toHaveLength(6)
    const intersect = booleanOperation('intersect', [rect(0, 0), rect(50, 50)])!
    expect(intersect).toMatchObject({ x: 50, y: 50, width: 50, height: 50 })
    const exclude = booleanOperation('exclude', [rect(0, 0), rect(50, 50)])!
    expect(exclude.subpaths).toHaveLength(2)
    expect(booleanOperation('unite', [rect(0, 0)])).toBeNull()
  })

  it('keeps curves when uniting ellipses and bakes rotation', () => {
    const a = createVectorElement('ellipse', { x: 0, y: 0, width: 100, height: 100 })
    const b = { ...createVectorElement('ellipse', { x: 60, y: 0, width: 100, height: 100 }), rotation: 45 }
    const result = booleanOperation('unite', [a, b])!
    expect(result.vectorNodes!.some((node) => node.in || node.out)).toBe(true)
    expect(result.width).toBeGreaterThan(150)
    const item = toPaperItem(b)
    expect(item.bounds.width).toBeCloseTo(100, 0)
    item.remove()
  })

  it('flattens sub-paths into one union', () => {
    const element: VectorElement = {
      ...createVectorElement('path', { x: 0, y: 0, width: 150, height: 150 }),
      vectorNodes: [{ x: 0, y: 0 }, { x: 0.6667, y: 0 }, { x: 0.6667, y: 0.6667 }, { x: 0, y: 0.6667 }, { x: 0.3333, y: 0.3333 }, { x: 1, y: 0.3333 }, { x: 1, y: 1 }, { x: 0.3333, y: 1 }],
      subpaths: [{ start: 0, closed: true }, { start: 4, closed: true }],
    }
    const result = flattenElement(element)!
    expect(result.subpaths).toBeUndefined()
    expect(result.vectorNodes).toHaveLength(8)
  })

  it('outlines a stroke into filled geometry', () => {
    const line = createVectorElement('path', { x: 0, y: 0, width: 100, height: 1 }, { vectorNodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: false, strokeWidth: 10 })
    const result = outlineStroke(line)!
    expect(result.width).toBeCloseTo(100, 0)
    expect(result.height).toBeCloseTo(10, 0)
    const inside = outlineStroke({ ...rect(0, 0), stroke: '#FFFFFF', strokeWidth: 10, strokeAlign: 'inside' })!
    expect(inside).toMatchObject({ x: 0, y: 0, width: 100, height: 100 })
    expect(inside.subpaths).toHaveLength(2)
    expect(outlineStroke({ ...rect(0, 0), strokeWidth: 0 })).toBeNull()
  })
})
