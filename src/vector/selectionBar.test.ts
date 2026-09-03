import { describe, expect, it } from 'vitest'
import {
  BAR_MARGIN, barPosition, clampBarOffset, DEFAULT_BAR_OFFSET, parseBarOffset, selectionBarMode,
} from '@/vector/selectionBar'

const viewport = { width: 900, height: 600 }
const size = { width: 400, height: 44 }

describe('whether the bar has anything to offer', () => {
  const base = { tool: 'select' as const, hasSelection: true, busy: false }

  it('offers the object actions under the tools that act on a selection', () => {
    expect(selectionBarMode(base)).toBe('objects')
    expect(selectionBarMode({ ...base, tool: 'transform' })).toBe('objects')
    expect(selectionBarMode({ ...base, tool: 'scale' })).toBe('objects')
  })

  it('swaps to the node actions with the node tool out', () => {
    expect(selectionBarMode({ ...base, tool: 'node' })).toBe('nodes')
  })

  it('says nothing under a tool that draws', () => {
    expect(selectionBarMode({ ...base, tool: 'pen' })).toBeNull()
    expect(selectionBarMode({ ...base, tool: 'bucket' })).toBeNull()
  })

  it('says nothing with an empty selection, or while the canvas is busy elsewhere', () => {
    expect(selectionBarMode({ ...base, hasSelection: false })).toBeNull()
    expect(selectionBarMode({ ...base, busy: true })).toBeNull()
  })
})

describe('where the bar sits', () => {
  it('starts at the bottom middle of the canvas', () => {
    expect(barPosition(DEFAULT_BAR_OFFSET, viewport, size)).toEqual({ x: 450, y: 600 - BAR_MARGIN })
  })

  it('follows the nudge it was dragged by', () => {
    expect(barPosition({ dx: -120, dy: -200 }, viewport, size)).toEqual({ x: 330, y: 384 })
  })

  it('holds the nudge inside the canvas', () => {
    // Half the bar plus the margin is as far as its middle can go.
    expect(clampBarOffset({ dx: 10000, dy: 0 }, viewport, size).dx).toBe(900 / 2 - BAR_MARGIN - 200)
    expect(clampBarOffset({ dx: -10000, dy: 0 }, viewport, size).dx).toBe(-(900 / 2 - BAR_MARGIN - 200))
    expect(clampBarOffset({ dx: 0, dy: 200 }, viewport, size).dy).toBe(0)
    expect(clampBarOffset({ dx: 0, dy: -10000 }, viewport, size).dy).toBe(-(600 - BAR_MARGIN * 2 - 44))
  })

  it('centres a bar too wide for the canvas rather than pushing it off one side', () => {
    expect(clampBarOffset({ dx: 300, dy: 0 }, { width: 300, height: 600 }, size).dx).toBe(0)
  })

  it('brings a bar left in a wide window back into a narrow one', () => {
    const left = clampBarOffset({ dx: -260, dy: 0 }, { width: 1600, height: 900 }, size)
    expect(left.dx).toBe(-260)
    expect(clampBarOffset(left, viewport, size).dx).toBe(-234)
  })

  it('reads back only a nudge it recognises', () => {
    expect(parseBarOffset({ dx: 4, dy: -8 })).toEqual({ dx: 4, dy: -8 })
    expect(parseBarOffset({ dx: 4 })).toBeNull()
    expect(parseBarOffset({ dx: Number.NaN, dy: 0 })).toBeNull()
    expect(parseBarOffset(null)).toBeNull()
    expect(parseBarOffset([1, 2])).toBeNull()
  })
})
