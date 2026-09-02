import type { Bounds } from '@/vector/geometry'
import type { VectorTool } from '@/vector/types'

/**
 * Where a chip that belongs to the selection should sit, in the canvas's own pixels: the middle of
 * the selection box, above it, or below it when there is no room above.
 */
export type SelectionAnchor = {
  x: number
  y: number
  placement: 'above' | 'below'
  mode: 'objects' | 'nodes'
}

/** How much room the bar needs over the selection before it agrees to sit there. */
export const BAR_CLEARANCE = 56
/** How close to the edge of the canvas the bar's middle is allowed to come. */
const EDGE_PAD = 140

/** The tools that leave the selection alone long enough for a bar to stand over it. */
const BAR_TOOLS: VectorTool[] = ['select', 'transform', 'scale', 'node']

export function selectionAnchorFor({ tool, busy, bounds, viewport, zoom, pan, page }: {
  tool: VectorTool
  busy: boolean
  bounds: Bounds | null
  viewport: { width: number; height: number }
  zoom: number
  pan: { x: number; y: number }
  page: { width: number; height: number }
}): SelectionAnchor | null {
  if (busy || !bounds || !BAR_TOOLS.includes(tool)) return null
  if (!viewport.width || !viewport.height) return null
  const toCanvasX = (x: number) => viewport.width / 2 + pan.x + zoom * (x - page.width / 2)
  const toCanvasY = (y: number) => viewport.height / 2 + pan.y + zoom * (y - page.height / 2)
  const top = toCanvasY(bounds.y)
  const bottom = toCanvasY(bounds.y + bounds.height)
  // A selection scrolled entirely out of sight carries no bar: it would point at nothing.
  if (bottom < 0 || top > viewport.height) return null
  const above = top - BAR_CLEARANCE >= 0
  const centre = toCanvasX(bounds.x + bounds.width / 2)
  const pad = Math.min(EDGE_PAD, viewport.width / 2)
  return {
    x: Math.round(Math.min(Math.max(centre, pad), viewport.width - pad)),
    y: Math.round(above ? top : Math.min(bottom, viewport.height - BAR_CLEARANCE)),
    placement: above ? 'above' : 'below',
    mode: tool === 'node' ? 'nodes' : 'objects',
  }
}
