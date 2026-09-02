import { rotatePoint } from '@/vector/directTransform'
import type { RunPoint } from '@/vector/network'
import type { VectorElement, VectorPoint } from '@/vector/types'

const KAPPA = 0.5522847498

export function cornerRadii(element: Pick<VectorElement, 'cornerRadius' | 'width' | 'height'>): [number, number, number, number] {
  const raw = element.cornerRadius
  const values: [number, number, number, number] = typeof raw === 'number' ? [raw, raw, raw, raw] : raw ? [...raw] : [0, 0, 0, 0]
  const limit = Math.min(element.width, element.height) / 2
  return values.map((value) => Math.max(0, Math.min(limit, value))) as [number, number, number, number]
}

/** Rectangle outline as a run, expanding rounded corners into arcs. */
export function rectangleRun(element: Pick<VectorElement, 'x' | 'y' | 'width' | 'height' | 'cornerRadius' | 'cornerSmoothing'>): RunPoint[] {
  const radii = cornerRadii(element)
  const corners: RunPoint[] = [
    { anchor: { x: element.x, y: element.y }, radius: radii[0] },
    { anchor: { x: element.x + element.width, y: element.y }, radius: radii[1] },
    { anchor: { x: element.x + element.width, y: element.y + element.height }, radius: radii[2] },
    { anchor: { x: element.x, y: element.y + element.height }, radius: radii[3] },
  ]
  return roundCorners(corners, true, element.cornerSmoothing ?? 0)
}

/**
 * Replaces every corner point that carries a radius with an arc. Smoothing stretches the arc's
 * tangent handles along the edges so the transition eases in, close to the iOS "continuous" corner.
 */
export function roundCorners(points: RunPoint[], closed: boolean, smoothing = 0): RunPoint[] {
  const count = points.length
  if (count < 3 || !points.some((point) => point.radius)) return points.map(({ radius: _radius, ...plain }) => plain)
  const result: RunPoint[] = []
  const half = (index: number, other: number) => {
    const a = points[index]!.anchor
    const b = points[other]!.anchor
    return Math.hypot(b.x - a.x, b.y - a.y) / 2
  }
  points.forEach((point, index) => {
    const previousIndex = index === 0 ? (closed ? count - 1 : -1) : index - 1
    const nextIndex = index === count - 1 ? (closed ? 0 : -1) : index + 1
    const radius = point.radius ?? 0
    const { radius: _radius, ...plain } = point
    if (radius <= 0 || point.in || point.out || previousIndex < 0 || nextIndex < 0) {
      result.push(plain)
      return
    }
    const previous = points[previousIndex]!.anchor
    const next = points[nextIndex]!.anchor
    const toPrevious = unit(previous, point.anchor)
    const toNext = unit(next, point.anchor)
    const angle = Math.acos(Math.max(-1, Math.min(1, toPrevious.x * toNext.x + toPrevious.y * toNext.y)))
    if (!Number.isFinite(angle) || angle < 1e-3 || Math.abs(angle - Math.PI) < 1e-3) {
      result.push(plain)
      return
    }
    const cut = Math.min(radius / Math.tan(angle / 2), half(index, previousIndex), half(index, nextIndex))
    const start: VectorPoint = { x: point.anchor.x + toPrevious.x * cut, y: point.anchor.y + toPrevious.y * cut }
    const end: VectorPoint = { x: point.anchor.x + toNext.x * cut, y: point.anchor.y + toNext.y * cut }
    const chordHandle = cut * KAPPA * (1 + smoothing * 0.6)
    const eased = smoothing * Math.min(cut, half(index, previousIndex) - cut, half(index, nextIndex) - cut) * 0.8
    result.push({ anchor: tidy({ x: start.x + toPrevious.x * eased, y: start.y + toPrevious.y * eased }), out: tidy({ x: start.x - toPrevious.x * chordHandle, y: start.y - toPrevious.y * chordHandle }) })
    result.push({ anchor: tidy({ x: end.x + toNext.x * eased, y: end.y + toNext.y * eased }), in: tidy({ x: end.x - toNext.x * chordHandle, y: end.y - toNext.y * chordHandle }) })
  })
  return result
}

function tidy(point: VectorPoint): VectorPoint {
  return { x: Math.round(point.x * 10000) / 10000, y: Math.round(point.y * 10000) / 10000 }
}

function unit(to: VectorPoint, from: VectorPoint): VectorPoint {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return { x: dx / length, y: dy / length }
}

export const CORNERS = ['nw', 'ne', 'se', 'sw'] as const
export type CornerName = (typeof CORNERS)[number]

/** Smallest inset a corner handle keeps from the corner, so it stays grabbable at radius zero. */
const MIN_INSET = 10

type CornerBox = Pick<VectorElement, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'cornerRadius'>

/** The largest radius a box can carry before its corners meet. */
export function maxCornerRadius(box: Pick<VectorElement, 'width' | 'height'>): number {
  return Math.max(0, Math.min(box.width, box.height) / 2)
}

/** Where a corner handle sits in world space: inset along both edges by the radius it shows. */
export function cornerHandlePoint(box: CornerBox, corner: CornerName, zoom: number): VectorPoint {
  const radii = cornerRadii(box)
  const radius = radii[CORNERS.indexOf(corner)]!
  const inset = Math.min(maxCornerRadius(box), Math.max(radius, MIN_INSET / zoom))
  const local = {
    x: corner === 'nw' || corner === 'sw' ? box.x + inset : box.x + box.width - inset,
    y: corner === 'nw' || corner === 'ne' ? box.y + inset : box.y + box.height - inset,
  }
  if (!box.rotation) return local
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  return rotatePoint(local, center, box.rotation)
}

/** The radius a drag to `point` asks for: how far in it went, averaged over the two edges. */
export function cornerRadiusAt(box: CornerBox, corner: CornerName, point: VectorPoint): number {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const local = box.rotation ? rotatePoint(point, center, -box.rotation) : point
  const dx = corner === 'nw' || corner === 'sw' ? local.x - box.x : box.x + box.width - local.x
  const dy = corner === 'nw' || corner === 'ne' ? local.y - box.y : box.y + box.height - local.y
  return Math.min(maxCornerRadius(box), Math.max(0, (dx + dy) / 2))
}

/** Patch that sets one corner, or all four when the drag is not asking for just one. */
export function cornerRadiusPatch(box: CornerBox, corner: CornerName, radius: number, alone: boolean): Pick<VectorElement, 'cornerRadius'> {
  const rounded = Math.round(Math.min(maxCornerRadius(box), Math.max(0, radius)) * 100) / 100
  if (!alone) return { cornerRadius: rounded > 0 ? rounded : undefined }
  const radii = cornerRadii(box)
  radii[CORNERS.indexOf(corner)] = rounded
  return { cornerRadius: radii.some(Boolean) ? radii : undefined }
}

/**
 * A corner of a path, read from the two neighbours around it. `bisector` points into the corner,
 * `halfAngle` is half the turn it makes, and `reach` is how far the nearer neighbour is — which is
 * what caps how round the corner can get before it eats its own edges.
 */
export type NodeCorner = { bisector: VectorPoint; halfAngle: number; reach: number }

export function nodeCorner(previous: VectorPoint, anchor: VectorPoint, next: VectorPoint): NodeCorner | null {
  const toPrevious = unit(previous, anchor)
  const toNext = unit(next, anchor)
  const dot = Math.max(-1, Math.min(1, toPrevious.x * toNext.x + toPrevious.y * toNext.y))
  const angle = Math.acos(dot)
  // A node whose neighbours line up straight through it, or double back on it, has no corner.
  if (!Number.isFinite(angle) || angle < 1e-3 || Math.abs(angle - Math.PI) < 1e-3) return null
  const sum = { x: toPrevious.x + toNext.x, y: toPrevious.y + toNext.y }
  const length = Math.hypot(sum.x, sum.y)
  if (length < 1e-6) return null
  return {
    bisector: { x: sum.x / length, y: sum.y / length },
    halfAngle: angle / 2,
    reach: Math.min(
      Math.hypot(previous.x - anchor.x, previous.y - anchor.y),
      Math.hypot(next.x - anchor.x, next.y - anchor.y),
    ) / 2,
  }
}

/** The largest radius a corner of a path can take before its arc runs past its own edges. */
export function maxNodeRadius(corner: NodeCorner): number {
  return Math.max(0, corner.reach * Math.tan(corner.halfAngle))
}

/**
 * Where the handle that rounds a corner sits: on the bisector, as far in as the arc's own tangent
 * points, and never closer than a few screen pixels so it can still be grabbed at radius zero.
 */
export function nodeRadiusHandle(anchor: VectorPoint, corner: NodeCorner, radius: number, zoom: number): VectorPoint {
  const cut = Math.min(corner.reach, Math.max(radius, 0) / Math.tan(corner.halfAngle))
  const distance = Math.max(cut, MIN_INSET / zoom)
  return { x: anchor.x + corner.bisector.x * distance, y: anchor.y + corner.bisector.y * distance }
}

/** The radius a drag to `point` asks of a corner: how far along the bisector it went. */
export function nodeRadiusAt(anchor: VectorPoint, corner: NodeCorner, point: VectorPoint): number {
  const along = (point.x - anchor.x) * corner.bisector.x + (point.y - anchor.y) * corner.bisector.y
  const cut = Math.min(corner.reach, Math.max(0, along))
  return Math.round(cut * Math.tan(corner.halfAngle) * 100) / 100
}
