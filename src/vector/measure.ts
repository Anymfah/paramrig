import type { VectorPoint } from '@/vector/types'

/** A measurement laid on the canvas: two points, and nothing written to the document. */
export type Measurement = { id: string; from: VectorPoint; to: VectorPoint }

/** Zoom steps the zoom tool walks through. */
export const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.8, 1, 1.5, 2, 3, 4, 6, 8] as const

export function nextZoom(current: number, direction: -1 | 1): number {
  if (direction > 0) return ZOOM_LEVELS.find((level) => level > current + 0.001) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!
  return [...ZOOM_LEVELS].reverse().find((level) => level < current - 0.001) ?? ZOOM_LEVELS[0]!
}

/** Length and angle of a measurement, in the same convention the rest of the editor reads angles. */
export function measurementReading(from: VectorPoint, to: VectorPoint): { length: number; angle: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI
  return { length: Math.hypot(dx, dy), angle: ((angle % 360) + 360) % 360 }
}

export function measurementLabel(from: VectorPoint, to: VectorPoint): string {
  const reading = measurementReading(from, to)
  return `${round(reading.length)} px · ${round(reading.angle)}°`
}

/**
 * The zoom and pan that bring a dragged box into view, keeping it whole with a little room.
 * A box smaller than a few pixels means the drag was a click, and the caller steps instead.
 */
export function zoomToBox(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  page: { width: number; height: number },
  padding = 24,
): { zoom: number; pan: VectorPoint } {
  const zoom = Math.min(8, Math.max(0.1, Math.min(
    (viewport.width - padding * 2) / Math.max(1, box.width),
    (viewport.height - padding * 2) / Math.max(1, box.height),
  )))
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  return { zoom, pan: { x: -(center.x - page.width / 2) * zoom, y: -(center.y - page.height / 2) * zoom } }
}

/** Pan that keeps the document point under the pointer where it is while the zoom changes. */
export function zoomAround(
  at: VectorPoint,
  pan: VectorPoint,
  from: number,
  to: number,
  page: { width: number; height: number },
): VectorPoint {
  const offset = { x: at.x - page.width / 2, y: at.y - page.height / 2 }
  return { x: pan.x + offset.x * (from - to), y: pan.y + offset.y * (from - to) }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
