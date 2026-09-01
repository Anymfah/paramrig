import { rotatePoint } from '@/vector/directTransform'
import type { VectorElement, VectorPoint } from '@/vector/types'

export type Bounds = { x: number; y: number; width: number; height: number }

/** Axis-aligned bounds of one or more elements, honouring rotation. */
export function selectionBounds(elements: VectorElement[]): Bounds {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const points = elements.flatMap((element) => elementCorners(element))
  const left = Math.min(...points.map((value) => value.x))
  const top = Math.min(...points.map((value) => value.y))
  const right = Math.max(...points.map((value) => value.x))
  const bottom = Math.max(...points.map((value) => value.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function elementCorners(element: VectorElement): VectorPoint[] {
  const center = elementCenter(element)
  return [
    { x: element.x, y: element.y },
    { x: element.x + element.width, y: element.y },
    { x: element.x + element.width, y: element.y + element.height },
    { x: element.x, y: element.y + element.height },
  ].map((corner) => rotatePoint(corner, center, element.rotation))
}

export function elementCenter(element: Pick<VectorElement, 'x' | 'y' | 'width' | 'height'>): VectorPoint {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 }
}

export function boundsBetween(start: VectorPoint, end: VectorPoint, square: boolean): Bounds {
  let width = Math.abs(end.x - start.x)
  let height = Math.abs(end.y - start.y)
  if (square) width = height = Math.max(width, height)
  return {
    x: round(end.x >= start.x ? start.x : start.x - width),
    y: round(end.y >= start.y ? start.y : start.y - height),
    width: round(width),
    height: round(height),
  }
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

export function containsPoint(bounds: Bounds, point: VectorPoint): boolean {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height
}

/** Ruler tick spacing in document units so ticks stay about 72 screen px apart. */
export function rulerStep(zoom: number): number {
  const target = 72 / zoom
  const power = 10 ** Math.floor(Math.log10(target))
  const normalized = target / power
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power
}

export function rulerTicks(start: number, end: number, step: number): number[] {
  const first = Math.floor(start / step) * step
  const count = Math.min(200, Math.ceil((end - first) / step) + 1)
  return Array.from({ length: Math.max(0, count) }, (_, index) => round(first + index * step))
}

export function snapBounds(bounds: Bounds): Bounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  }
}

/** Rounds x/y/width/height of a patch to whole pixels; other keys pass through. */
export function snapGeometryPatch<Patch extends Partial<VectorElement>>(patch: Patch): Patch {
  const next = { ...patch }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = next[key]
    if (typeof value !== 'number') continue
    Object.assign(next, { [key]: key === 'width' || key === 'height' ? Math.max(1, Math.round(value)) : Math.round(value) })
  }
  return next
}

/** Snaps an angle in degrees to the nearest multiple of `step`. */
export function snapAngle(degrees: number, step = 15): number {
  return Math.round(degrees / step) * step
}

export function round(value: number): number {
  return Math.round(value * 100) / 100
}
