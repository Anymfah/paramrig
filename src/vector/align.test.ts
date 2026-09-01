import { describe, expect, it } from 'vitest'
import { alignElements, distributeElements } from '@/vector/align'
import type { VectorElement } from '@/vector/types'

function shape(id: string, x: number, y: number, width = 100, height = 50, rotation = 0): VectorElement {
  return { id, kind: 'rectangle', name: id, x, y, width, height, rotation, fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false }
}

describe('align and distribute', () => {
  const target = { x: 0, y: 0, width: 800, height: 600 }

  it('aligns each element by its rotated bounding box', () => {
    const rotated = shape('r', 100, 100, 200, 100, 90)
    const [left] = alignElements([rotated], 'left', target)
    expect(left?.patch.x).toBe(-50)
    const [right] = alignElements([shape('a', 10, 10)], 'right', target)
    expect(right?.patch.x).toBe(700)
    const [centerY] = alignElements([shape('a', 10, 10)], 'centerY', target)
    expect(centerY?.patch.y).toBe(275)
    expect(alignElements([shape('a', 0, 0)], 'top', target)).toEqual([])
  })

  it('covers all six modes', () => {
    const element = shape('a', 10, 20)
    expect(alignElements([element], 'centerX', target)[0]?.patch.x).toBe(350)
    expect(alignElements([element], 'bottom', target)[0]?.patch.y).toBe(550)
    expect(alignElements([element], 'top', target)[0]?.patch.y).toBe(0)
    expect(alignElements([element], 'left', target)[0]?.patch.x).toBe(0)
  })

  it('distributes middle elements so the gaps are equal', () => {
    const elements = [shape('a', 0, 0), shape('b', 120, 0), shape('c', 400, 0)]
    const [patch] = distributeElements(elements, 'x')
    expect(patch).toEqual({ id: 'b', patch: { x: 200 } })
    expect(distributeElements(elements.slice(0, 2), 'x')).toEqual([])
    const vertical = [shape('a', 0, 0), shape('b', 0, 300), shape('c', 0, 90)]
    expect(distributeElements(vertical, 'y')).toEqual([{ id: 'c', patch: { y: 150 } }])
  })
})
