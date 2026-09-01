import { describe, expect, it } from 'vitest'
import { resizeCursor, resizeElement } from '@/vector/directTransform'
import type { VectorElement } from '@/vector/types'

const element: VectorElement = {
  id: 'shape', kind: 'rectangle', name: 'Rectangle', x: 100, y: 80, width: 200, height: 100,
  rotation: 0, fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false,
}

describe('direct vector transforms', () => {
  it('resizes corners and edges without changing the opposite side', () => {
    expect(resizeElement(element, 'e', { x: 400, y: 130 })).toEqual({ x: 100, y: 80, width: 300, height: 100 })
    expect(resizeElement(element, 'nw', { x: 50, y: 30 })).toEqual({ x: 50, y: 30, width: 250, height: 150 })
  })

  it('supports proportional and centered resizing', () => {
    expect(resizeElement(element, 'se', { x: 400, y: 180 }, { lockRatio: true })).toEqual({ x: 100, y: 80, width: 300, height: 150 })
    expect(resizeElement(element, 'e', { x: 350, y: 130 }, { fromCenter: true })).toEqual({ x: 50, y: 80, width: 300, height: 100 })
  })

  it('keeps the opposite world anchor fixed for rotated elements', () => {
    const rotated = { ...element, rotation: 90 }
    expect(resizeElement(rotated, 'e', { x: 200, y: 280 })).toEqual({ x: 75, y: 105, width: 250, height: 100 })
  })

  it('rotates resize cursors with the element', () => {
    expect(resizeCursor('e', 0)).toBe('ew-resize')
    expect(resizeCursor('e', 90)).toBe('ns-resize')
    expect(resizeCursor('nw', 45)).toBe('ns-resize')
  })
})
