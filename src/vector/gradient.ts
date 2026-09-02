import { sampleGradient } from '@/ui/gradient-ops'
import type { VectorGradientStop, VectorPaint, VectorPoint } from '@/vector/types'

/** How far off the line a stop has to be dragged before it is thrown away, in screen pixels. */
export const STOP_DROP_PX = 28
export const MIN_STOPS = 2
export const MAX_STOPS = 8

/**
 * The two ends of a linear gradient in normalised box coordinates. Paints that only carry an
 * angle are read the way the renderer has always read them.
 */
export function gradientLine(paint: Pick<VectorPaint, 'from' | 'to' | 'angle'>): { from: VectorPoint; to: VectorPoint } {
  if (paint.from && paint.to) return { from: paint.from, to: paint.to }
  const radians = ((paint.angle ?? 0) * Math.PI) / 180
  const dx = Math.cos(radians) / 2
  const dy = Math.sin(radians) / 2
  return { from: { x: 0.5 - dx, y: 0.5 - dy }, to: { x: 0.5 + dx, y: 0.5 + dy } }
}

/** Centre and radius of a radial gradient in normalised box coordinates. */
export function gradientCircle(paint: Pick<VectorPaint, 'center' | 'radius'>): { center: VectorPoint; radius: number } {
  return {
    center: paint.center ?? { x: 0.5, y: 0.5 },
    radius: typeof paint.radius === 'number' && paint.radius > 0 ? paint.radius : 0.5,
  }
}

/** Where a point falls along a line: `t` from 0 at `from` to 1 at `to`, plus its distance off it. */
export function projectOnLine(from: VectorPoint, to: VectorPoint, point: VectorPoint): { t: number; distance: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = dx * dx + dy * dy
  if (length < 1e-12) return { t: 0, distance: Math.hypot(point.x - from.x, point.y - from.y) }
  const t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / length
  const clamped = Math.min(1, Math.max(0, t))
  const nearest = { x: from.x + dx * clamped, y: from.y + dy * clamped }
  return { t, distance: Math.hypot(point.x - nearest.x, point.y - nearest.y) }
}

export function pointAt(from: VectorPoint, to: VectorPoint, t: number): VectorPoint {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

/** Stops sorted by position, so a dragged stop keeps its place in the ramp. */
export function sortStops(stops: VectorGradientStop[]): VectorGradientStop[] {
  return [...stops].sort((a, b) => a.t - b.t)
}

/** Moves one stop along the ramp and returns the list plus where that stop ended up. */
export function moveStop(stops: VectorGradientStop[], index: number, t: number): { stops: VectorGradientStop[]; index: number } {
  const stop = stops[index]
  if (!stop) return { stops, index }
  const moved = stops.map((item, position) => position === index ? { ...item, t: Math.min(1, Math.max(0, t)) } : item)
  const sorted = sortStops(moved)
  return { stops: sorted, index: sorted.indexOf(moved[index]!) }
}

/** Adds a stop at `t`, coloured by what the ramp already shows there. */
export function addStop(stops: VectorGradientStop[], t: number): { stops: VectorGradientStop[]; index: number } {
  if (stops.length >= MAX_STOPS) return { stops, index: -1 }
  const position = Math.min(1, Math.max(0, t))
  const stop = { t: position, color: sampleGradient(stops, position) }
  const sorted = sortStops([...stops, stop])
  return { stops: sorted, index: sorted.indexOf(stop) }
}

/** Drops a stop, unless the ramp would be left with fewer than two. */
export function dropStop(stops: VectorGradientStop[], index: number): VectorGradientStop[] {
  if (stops.length <= MIN_STOPS || index < 0 || index >= stops.length) return stops
  return stops.filter((_, position) => position !== index)
}

/** Patch for a linear gradient whose ends have moved; the angle is kept in step for older readers. */
export function linearPatch(from: VectorPoint, to: VectorPoint): Partial<VectorPaint> {
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
  return { from: round(from), to: round(to), angle: Math.round((((angle % 360) + 360) % 360) * 100) / 100 }
}

export function radialPatch(center: VectorPoint, radius: number): Partial<VectorPaint> {
  return { center: round(center), radius: Math.round(Math.min(4, Math.max(0.01, radius)) * 10000) / 10000 }
}

export function sanitizePoint(value: unknown): VectorPoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<VectorPoint>
  const finite = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate) && Math.abs(candidate) <= 10
  return finite(source.x) && finite(source.y) ? { x: source.x, y: source.y } : undefined
}

function round(point: VectorPoint): VectorPoint {
  return { x: Math.round(point.x * 10000) / 10000, y: Math.round(point.y * 10000) / 10000 }
}
