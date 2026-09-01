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
