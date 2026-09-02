import { describe, expect, it } from 'vitest'
import { BAR_CLEARANCE, selectionAnchorFor } from '@/vector/selectionAnchor'

const base = {
  tool: 'select' as const,
  busy: false,
  bounds: { x: 300, y: 200, width: 200, height: 100 },
  viewport: { width: 900, height: 600 },
  zoom: 1,
  pan: { x: 0, y: 0 },
  page: { width: 800, height: 600 },
}

describe('the selection bar anchor', () => {
  it('sits over the middle of the selection', () => {
    const anchor = selectionAnchorFor(base)
    // 900/2 + 1 * (400 − 400) = 450; 600/2 + (200 − 300) = 200.
    expect(anchor).toEqual({ x: 450, y: 200, placement: 'above', mode: 'objects' })
  })

  it('drops under the box when there is no room over it', () => {
    // The top of the box lands 20 pixels down the canvas; the bar needs BAR_CLEARANCE.
    const anchor = selectionAnchorFor({ ...base, bounds: { x: 300, y: 20, width: 200, height: 100 } })
    expect(anchor?.placement).toBe('below')
    expect(anchor?.y).toBe(120)
  })

  it('stands back for the whole of a gesture', () => {
    expect(selectionAnchorFor({ ...base, busy: true })).toBeNull()
  })

  it('says nothing when nothing is selected', () => {
    expect(selectionAnchorFor({ ...base, bounds: null })).toBeNull()
  })

  it('only shows under the tools that leave a selection alone', () => {
    expect(selectionAnchorFor({ ...base, tool: 'pen' })).toBeNull()
    expect(selectionAnchorFor({ ...base, tool: 'bucket' })).toBeNull()
    expect(selectionAnchorFor({ ...base, tool: 'node' })?.mode).toBe('nodes')
    expect(selectionAnchorFor({ ...base, tool: 'transform' })?.mode).toBe('objects')
  })

  it('follows the zoom and the pan', () => {
    const anchor = selectionAnchorFor({ ...base, zoom: 2, pan: { x: 40, y: -20 } })
    expect(anchor).toEqual({ x: 490, y: 80, placement: 'above', mode: 'objects' })
  })

  it('keeps its middle away from the edges of the canvas', () => {
    const left = selectionAnchorFor({ ...base, bounds: { x: -600, y: 200, width: 20, height: 20 } })
    expect(left?.x).toBeGreaterThan(0)
    const right = selectionAnchorFor({ ...base, bounds: { x: 1400, y: 200, width: 20, height: 20 } })
    expect(right?.x).toBeLessThan(base.viewport.width)
  })

  it('says nothing when the selection has scrolled out of sight', () => {
    expect(selectionAnchorFor({ ...base, pan: { x: 0, y: -2000 } })).toBeNull()
    expect(selectionAnchorFor({ ...base, pan: { x: 0, y: 2000 } })).toBeNull()
  })

  it('leaves room for the bar it carries', () => {
    // The top of the box lands BAR_CLEARANCE − 1 pixels down the canvas: one short of enough.
    const tight = selectionAnchorFor({ ...base, bounds: { x: 300, y: BAR_CLEARANCE - 1, width: 200, height: 100 } })
    expect(tight?.placement).toBe('below')
  })
})
