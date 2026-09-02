import type { DirectResizeHandle } from '@/vector/directTransform'
import type { Bounds } from '@/vector/geometry'

/** The part of the picture the box shows, in normalised image coordinates. */
export type Crop = { x: number; y: number; width: number; height: number }

export const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 }
const MIN_CROP = 0.02
const MIN_BOX = 4

export function isFullCrop(crop: Crop | undefined): boolean {
  if (!crop) return true
  return Math.abs(crop.x) < 1e-6 && Math.abs(crop.y) < 1e-6 && Math.abs(crop.width - 1) < 1e-6 && Math.abs(crop.height - 1) < 1e-6
}

/** Where the whole picture sits in world space for a given box and crop. */
export function displayRect(box: Bounds, crop: Crop = FULL_CROP): Bounds {
  const width = box.width / Math.max(MIN_CROP, crop.width)
  const height = box.height / Math.max(MIN_CROP, crop.height)
  return { x: box.x - crop.x * width, y: box.y - crop.y * height, width, height }
}

/** The crop a box describes over a picture placed at `display`. */
export function cropForBox(display: Bounds, box: Bounds): Crop {
  return clampCrop({
    x: (box.x - display.x) / display.width,
    y: (box.y - display.y) / display.height,
    width: box.width / display.width,
    height: box.height / display.height,
  })
}

/** Keeps a crop inside the picture and big enough to see. */
export function clampCrop(crop: Crop): Crop {
  const width = Math.min(1, Math.max(MIN_CROP, crop.width))
  const height = Math.min(1, Math.max(MIN_CROP, crop.height))
  return {
    x: Math.min(1 - width, Math.max(0, crop.x)),
    y: Math.min(1 - height, Math.max(0, crop.y)),
    width,
    height,
  }
}

/**
 * Drags one corner or edge of the crop window while the picture stays put in world space:
 * the box shrinks or grows and the crop follows it.
 */
export function resizeCrop(box: Bounds, crop: Crop, handle: DirectResizeHandle, point: { x: number; y: number }): { box: Bounds; crop: Crop } {
  const display = displayRect(box, crop)
  let left = box.x
  let right = box.x + box.width
  let top = box.y
  let bottom = box.y + box.height
  // Only the edges the handle owns move, each held inside the picture and short of the opposite edge.
  if (handle.includes('w')) left = Math.min(Math.max(display.x, point.x), right - MIN_BOX)
  if (handle.includes('e')) right = Math.max(Math.min(display.x + display.width, point.x), left + MIN_BOX)
  if (handle.includes('n')) top = Math.min(Math.max(display.y, point.y), bottom - MIN_BOX)
  if (handle.includes('s')) bottom = Math.max(Math.min(display.y + display.height, point.y), top + MIN_BOX)
  const limited = { x: left, y: top, width: right - left, height: bottom - top }
  return { box: limited, crop: cropForBox(display, limited) }
}

/** Slides the picture under a fixed box; the crop moves the other way. */
export function panCrop(box: Bounds, crop: Crop, delta: { x: number; y: number }): Crop {
  const display = displayRect(box, crop)
  return clampCrop({ ...crop, x: crop.x - delta.x / display.width, y: crop.y - delta.y / display.height })
}

/** Box that shows the whole picture again, keeping the visible part's top-left corner. */
export function resetCropBox(box: Bounds, crop: Crop): Bounds {
  const display = displayRect(box, crop)
  return { x: display.x, y: display.y, width: display.width, height: display.height }
}

export function sanitizeCrop(value: unknown): Crop | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<Crop>
  const finite = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate)
  if (!finite(source.x) || !finite(source.y) || !finite(source.width) || !finite(source.height)) return undefined
  const crop = clampCrop({ x: source.x, y: source.y, width: source.width, height: source.height })
  return isFullCrop(crop) ? undefined : crop
}

/** Box for a picture dropped on the canvas: its natural size, shrunk to fit, centred on the point. */
export function droppedImageBounds(natural: { width: number; height: number }, at: { x: number; y: number }, maxSide = 640): Bounds {
  const width = Math.max(1, natural.width)
  const height = Math.max(1, natural.height)
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const boxWidth = Math.round(width * scale)
  const boxHeight = Math.round(height * scale)
  return { x: Math.round(at.x - boxWidth / 2), y: Math.round(at.y - boxHeight / 2), width: boxWidth, height: boxHeight }
}
