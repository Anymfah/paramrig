import type { VectorTool } from '@/vector/types'

/** Which set of actions the bar offers: the ones for objects, or the ones for nodes. */
export type SelectionBarMode = 'objects' | 'nodes'

/** The tools that act on a selection, and so have something to put in the bar. */
const BAR_TOOLS: VectorTool[] = ['select', 'transform', 'scale', 'node']

/**
 * Whether the bar has anything to offer. It used to hide during every drag, because it stood over
 * the selection and would have covered what was being dragged; parked at the edge of the canvas it
 * covers nothing, so it stays put — a bar that blinks out on every gesture is harder to find than
 * one that does not move.
 */
export function selectionBarMode({ tool, hasSelection, busy }: {
  tool: VectorTool
  hasSelection: boolean
  /** Set while the canvas is doing something that owns the whole surface: text, cropping, a drop. */
  busy: boolean
}): SelectionBarMode | null {
  if (busy || !hasSelection || !BAR_TOOLS.includes(tool)) return null
  return tool === 'node' ? 'nodes' : 'objects'
}

/**
 * Where the bar sits, as a nudge away from where it starts. Zero is the bottom middle of the
 * canvas; dragging it stores the nudge, so it comes back where it was left however the window is
 * resized in between.
 */
export type BarOffset = { dx: number; dy: number }

export const DEFAULT_BAR_OFFSET: BarOffset = { dx: 0, dy: 0 }

/** How close to the edge of the canvas the bar is allowed to come. */
export const BAR_MARGIN = 16

export type Size = { width: number; height: number }
export type Viewport = { width: number; height: number }

/**
 * The bar's anchor in canvas pixels: the middle of its bottom edge. The nudge is clamped first, so
 * a bar left in a corner of a wide window still lands inside a narrow one.
 */
export function barPosition(offset: BarOffset, viewport: Viewport, size: Size): { x: number; y: number } {
  const clamped = clampBarOffset(offset, viewport, size)
  return {
    x: viewport.width / 2 + clamped.dx,
    y: viewport.height - BAR_MARGIN + clamped.dy,
  }
}

/** The nudge, held to what the canvas can actually show. */
export function clampBarOffset(offset: BarOffset, viewport: Viewport, size: Size): BarOffset {
  const half = size.width / 2
  // A bar wider than the canvas is centred rather than pushed off one side or the other.
  const room = Math.max(0, viewport.width / 2 - BAR_MARGIN - half)
  const lowest = 0
  const highest = -Math.max(0, viewport.height - BAR_MARGIN * 2 - size.height)
  return {
    dx: Math.min(room, Math.max(-room, offset.dx)),
    dy: Math.min(lowest, Math.max(highest, offset.dy)),
  }
}

export function parseBarOffset(raw: unknown): BarOffset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Partial<BarOffset>
  if (typeof value.dx !== 'number' || typeof value.dy !== 'number') return null
  if (!Number.isFinite(value.dx) || !Number.isFinite(value.dy)) return null
  return { dx: value.dx, dy: value.dy }
}
