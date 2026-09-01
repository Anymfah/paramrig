import { describe, expect, it } from 'vitest'
import { scaleElementsToBounds, transformElement, transformElements } from '@/vector/transform'
import type { VectorElement } from '@/vector/types'

const element: VectorElement = {
  id: 'shape', kind: 'rectangle', name: 'Shape', x: 100, y: 80, width: 200, height: 100,
  rotation: 0, fill: '#000', stroke: '#000', strokeWidth: 0, opacity: 1, visible: true, locked: false,
}

describe('vector modal transforms', () => {
  it('moves freely or on one constrained axis', () => {
    expect(transformElement('move', null, element, { x: 10, y: 10 }, { x: 35, y: 50 })).toMatchObject({ x: 125, y: 120 })
    expect(transformElement('move', 'x', element, { x: 10, y: 10 }, { x: 35, y: 50 })).toMatchObject({ x: 125, y: 80 })
    expect(transformElement('move', 'y', element, { x: 10, y: 10 }, { x: 35, y: 50 })).toMatchObject({ x: 100, y: 120 })
  })

  it('rotates around the element center', () => {
    expect(transformElement('rotate', null, element, { x: 300, y: 130 }, { x: 200, y: 230 }).rotation).toBe(90)
  })

  it('scales uniformly or along X while preserving the center', () => {
    expect(transformElement('scale', null, element, { x: 300, y: 130 }, { x: 400, y: 130 })).toMatchObject({ x: 0, y: 30, width: 400, height: 200 })
    expect(transformElement('scale', 'x', element, { x: 300, y: 130 }, { x: 400, y: 130 })).toMatchObject({ x: 0, y: 80, width: 400, height: 100 })
    expect(transformElement('scale', 'y', element, { x: 200, y: 180 }, { x: 200, y: 230 })).toMatchObject({ x: 100, y: 30, width: 200, height: 200 })
  })

  it('moves and rotates a multi-selection as one group', () => {
    const second = { ...element, id: 'second', x: 400 }
    expect(transformElements('move', 'x', [element, second], { x: 0, y: 0 }, { x: 25, y: 80 })).toEqual([
      { id: 'shape', patch: { x: 125, y: 80 } },
      { id: 'second', patch: { x: 425, y: 80 } },
    ])
    const rotated = transformElements('rotate', null, [element, second], { x: 550, y: 130 }, { x: 350, y: 330 })
    expect(rotated[0]?.patch).toMatchObject({ x: 250, y: -70, rotation: 90 })
    expect(rotated[1]?.patch).toMatchObject({ x: 250, y: 230, rotation: 90 })
  })
})

describe('scaleElementsToBounds', () => {
  const base: VectorElement = {
    id: 'a', kind: 'rectangle', name: 'A', x: 0, y: 0, width: 100, height: 50,
    rotation: 0, fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false,
  }

  it('keeps the opposite anchor fixed and scales children proportionally', () => {
    const b = { ...base, id: 'b', x: 100, y: 50, width: 100, height: 50 }
    const from = { x: 0, y: 0, width: 200, height: 100 }
    const to = { x: 0, y: 0, width: 400, height: 100 }
    const patches = scaleElementsToBounds([base, b], from, to)
    expect(patches[0]?.patch).toEqual({ x: 0, y: 0, width: 200, height: 50 })
    expect(patches[1]?.patch).toEqual({ x: 200, y: 50, width: 200, height: 50 })
  })

  it('keeps rotation for rotated children under uniform scale', () => {
    const rotated = { ...base, rotation: 30 }
    const [patch] = scaleElementsToBounds([rotated], { x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 200, height: 100 })
    expect(patch?.patch.width).toBeCloseTo(200)
    expect(patch?.patch.height).toBeCloseTo(100)
    expect(patch?.patch.rotation ?? 30).toBeCloseTo(30)
  })
})
