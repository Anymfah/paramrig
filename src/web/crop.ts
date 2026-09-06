/**
 * The crop rectangle, in percentages of the captured frame — exactly the numbers the saved image
 * is cut with, so what a drag produces and what the fields produce are the same picture.
 */
export type Crop = { x: number; y: number; width: number; height: number }
export const FULL: Crop = { x: 0, y: 0, width: 100, height: 100 }
export const MIN = 5
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The eight corners and edges, named for a person and for the arithmetic below. */
export const HANDLES = [
  { id: 'nw', label: 'Top left', x: 0, y: 0 }, { id: 'n', label: 'Top', x: .5, y: 0 }, { id: 'ne', label: 'Top right', x: 1, y: 0 },
  { id: 'w', label: 'Left', x: 0, y: .5 }, { id: 'e', label: 'Right', x: 1, y: .5 },
  { id: 'sw', label: 'Bottom left', x: 0, y: 1 }, { id: 's', label: 'Bottom', x: .5, y: 1 }, { id: 'se', label: 'Bottom right', x: 1, y: 1 },
] as const
export type Handle = typeof HANDLES[number]['id']

/** Where a handle drag leaves the rectangle. Each edge stops the opposite one from crossing it. */
export function resize(crop: Crop, handle: Handle, point: { x: number; y: number }): Crop {
  const left = clamp(point.x, 0, 100)
  const top = clamp(point.y, 0, 100)
  const right = crop.x + crop.width
  const bottom = crop.y + crop.height
  const next = { ...crop }
  if (handle.includes('w')) { next.x = clamp(left, 0, right - MIN); next.width = right - next.x }
  if (handle.includes('e')) next.width = clamp(left, crop.x + MIN, 100) - crop.x
  if (handle.includes('n')) { next.y = clamp(top, 0, bottom - MIN); next.height = bottom - next.y }
  if (handle.includes('s')) next.height = clamp(top, crop.y + MIN, 100) - crop.y
  return next
}

/** Where a move leaves it: the whole rectangle travels, and stops at the edges of the frame. */
export function move(crop: Crop, delta: { x: number; y: number }): Crop {
  return { ...crop, x: clamp(crop.x + delta.x, 0, 100 - crop.width), y: clamp(crop.y + delta.y, 0, 100 - crop.height) }
}
