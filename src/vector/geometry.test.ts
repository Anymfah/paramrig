import { describe, expect, it } from 'vitest'
import { boundsBetween, rulerStep, selectionBounds, snapAngle, snapGeometryPatch } from '@/vector/geometry'
import type { VectorElement } from '@/vector/types'

const base: VectorElement = {
  id: 'a', kind: 'rectangle', name: 'A', x: 100, y: 100, width: 200, height: 100,
  rotation: 0, fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false,
}

describe('vector geometry', () => {
  it('bounds a rotated element by its corners', () => {
    const rotated = { ...base, rotation: 90 }
    const bounds = selectionBounds([rotated])
    expect(bounds.x).toBeCloseTo(150)
    expect(bounds.y).toBeCloseTo(50)
    expect(bounds.width).toBeCloseTo(100)
    expect(bounds.height).toBeCloseTo(200)
  })

  it('unions several elements', () => {
    expect(selectionBounds([base, { ...base, id: 'b', x: 400, y: 50, width: 10, height: 10 }])).toEqual({ x: 100, y: 50, width: 310, height: 150 })
    expect(selectionBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('keeps ruler ticks about 72 px apart at every zoom', () => {
    for (const zoom of [0.1, 0.25, 0.5, 0.8, 1, 2, 4, 8]) {
      const px = rulerStep(zoom) * zoom
      expect(px).toBeGreaterThanOrEqual(36)
      expect(px).toBeLessThanOrEqual(144)
    }
    expect(rulerStep(1)).toBe(100)
  })

  it('builds square bounds from any drag direction', () => {
    expect(boundsBetween({ x: 10, y: 10 }, { x: -20, y: 40 }, true)).toEqual({ x: -20, y: 10, width: 30, height: 30 })
  })

  it('rounds geometry patches to whole pixels', () => {
    expect(snapGeometryPatch({ x: 1.4, width: 0.2, rotation: 12.5 })).toEqual({ x: 1, width: 1, rotation: 12.5 })
    expect(snapAngle(22)).toBe(15)
    expect(snapAngle(-97)).toBe(-90)
  })
})
