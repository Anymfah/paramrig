import type { VectorPoint } from '@/vector/types'
import type { RunPoint } from '@/vector/network'

type AbsoluteNode = RunPoint

/** Ramer–Douglas–Peucker simplification with a distance tolerance in document units. */
export function simplifyPolyline(points: VectorPoint[], tolerance: number): VectorPoint[] {
  if (points.length <= 2) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [from, to] = stack.pop()!
    let farthest = -1
    let distance = tolerance
    for (let index = from + 1; index < to; index += 1) {
      const d = pointToSegment(points[index]!, points[from]!, points[to]!)
      if (d > distance) {
        distance = d
        farthest = index
      }
    }
    if (farthest >= 0) {
      keep[farthest] = true
      stack.push([from, farthest], [farthest, to])
    }
  }
  return points.filter((_, index) => keep[index])
}

/** Removes samples closer than `spacing` to the previous kept sample. */
export function thinPolyline(points: VectorPoint[], spacing: number): VectorPoint[] {
  const result: VectorPoint[] = []
  for (const point of points) {
    const last = result[result.length - 1]
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= spacing) result.push(point)
  }
  const last = points[points.length - 1]
  if (last && result[result.length - 1] !== last) result.push(last)
  return result
}

/**
 * Fits smooth Bézier nodes through a polyline using Catmull-Rom tangents.
 * Corners sharper than `cornerAngle` degrees stay as corner nodes.
 */
export function fitSmoothNodes(points: VectorPoint[], closed = false, cornerAngle = 60): AbsoluteNode[] {
  if (points.length < 2) return points.map((point) => ({ anchor: point }))
  const count = points.length
  return points.map((point, index) => {
    const previous = points[index - 1] ?? (closed ? points[count - 1] : null)
    const next = points[index + 1] ?? (closed ? points[0] : null)
    if (!previous || !next) {
      const neighbour = previous ?? next!
      const direction = previous ? { x: point.x - previous.x, y: point.y - previous.y } : { x: next!.x - point.x, y: next!.y - point.y }
      const length = Math.hypot(direction.x, direction.y) || 1
      const reach = Math.hypot(neighbour.x - point.x, neighbour.y - point.y) / 3
      const handle = { x: direction.x / length * reach, y: direction.y / length * reach }
      return previous
        ? { anchor: point, in: { x: point.x - handle.x, y: point.y - handle.y } }
        : { anchor: point, out: { x: point.x + handle.x, y: point.y + handle.y } }
    }
    const incoming = { x: point.x - previous.x, y: point.y - previous.y }
    const outgoing = { x: next.x - point.x, y: next.y - point.y }
    const angle = Math.abs(angleBetween(incoming, outgoing))
    if (angle > cornerAngle) return { anchor: point }
    const tangent = { x: next.x - previous.x, y: next.y - previous.y }
    const length = Math.hypot(tangent.x, tangent.y) || 1
    const unit = { x: tangent.x / length, y: tangent.y / length }
    const inLength = Math.hypot(incoming.x, incoming.y) / 3
    const outLength = Math.hypot(outgoing.x, outgoing.y) / 3
    return {
      anchor: point,
      in: { x: point.x - unit.x * inLength, y: point.y - unit.y * inLength },
      out: { x: point.x + unit.x * outLength, y: point.y + unit.y * outLength },
      handles: 'asymmetric',
    }
  })
}

/** Full pencil pipeline: thin, simplify, then fit. Tolerance grows as zoom shrinks. */
export function pencilNodes(points: VectorPoint[], zoom: number, options: { smoothing?: number } = {}): AbsoluteNode[] {
  const smoothing = options.smoothing ?? 1
  const tolerance = (1.5 * smoothing) / Math.max(0.1, zoom)
  const spacing = 2 / Math.max(0.1, zoom)
  const thinned = thinPolyline(points, spacing)
  const simplified = simplifyPolyline(thinned, tolerance)
  return fitSmoothNodes(simplified)
}

function pointToSegment(point: VectorPoint, a: VectorPoint, b: VectorPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t))
}

function angleBetween(a: VectorPoint, b: VectorPoint): number {
  const dot = a.x * b.x + a.y * b.y
  const cross = a.x * b.y - a.y * b.x
  return Math.atan2(cross, dot) * 180 / Math.PI
}
