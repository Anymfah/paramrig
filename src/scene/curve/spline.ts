import type { CurvePoint, CurveSpline, Vec3 } from '@/scene/types'

/**
 * A spline, read.
 *
 * Everything a curve becomes — a line in the viewport, a swept tube, a filled face, a mesh — starts
 * from the same walk along it, so the walk lives here on its own and the geometry lives next door.
 * The knots are Blender's: two handles held in the object's own space rather than as offsets, which
 * is what lets a handle be dragged without arithmetic and what a `.blend` itself stores.
 */

/** Blender's own defaults, so a curve made here and a curve made there agree. */
export const DEFAULT_RESOLUTION = 12
export const MIN_RESOLUTION = 1
export const MAX_RESOLUTION = 64

export type SampledSpline = {
  points: Vec3[]
  /** Degrees, one per point, so a swept profile can be turned along the length. */
  tilts: number[]
  /** One per point; the bevel profile is scaled by it. */
  radii: number[]
  closed: boolean
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function scaled(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor]
}

export function length3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}

export function normalized(a: Vec3): Vec3 {
  const size = length3(a)
  return size > 1e-9 ? scaled(a, 1 / size) : [0, 0, 0]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** A fresh knot with both handles a third of `reach` away along X, which is what Add gives you. */
export function curvePoint(co: Vec3, reach = 0.5, type: CurvePoint['leftType'] = 'aligned'): CurvePoint {
  return {
    co,
    left: [co[0] - reach, co[1], co[2]],
    right: [co[0] + reach, co[1], co[2]],
    leftType: type,
    rightType: type,
  }
}

/** How many spans a spline is drawn in: one fewer than its knots, or one per knot when it closes. */
export function splineSegments(spline: CurveSpline): number {
  const count = spline.points.length
  if (count < 2) return 0
  return spline.cyclic ? count : count - 1
}

/**
 * The handles as the evaluator sees them.
 *
 * A `vector` handle points at its neighbour and an `auto` one is computed from both, so neither is
 * worth storing: they are derived every time the curve is read, which is exactly what makes them
 * follow when a neighbouring knot moves. `aligned` is held to its line here too — a document that
 * says aligned should look aligned however it was written.
 */
export function resolveHandles(spline: CurveSpline): CurvePoint[] {
  const points = spline.points
  const count = points.length
  if (count === 0) return []
  return points.map((point, index) => {
    const previous = points[spline.cyclic ? (index + count - 1) % count : Math.max(0, index - 1)]!
    const next = points[spline.cyclic ? (index + 1) % count : Math.min(count - 1, index + 1)]!
    let left = point.left
    let right = point.right
    if (point.leftType === 'vector') left = towards(point.co, previous.co)
    if (point.rightType === 'vector') right = towards(point.co, next.co)
    if (point.leftType === 'auto' || point.rightType === 'auto') {
      const auto = autoHandles(previous.co, point.co, next.co)
      if (point.leftType === 'auto') left = auto[0]
      if (point.rightType === 'auto') right = auto[1]
    }
    /*
     * Alignment is one-sided on purpose: the handle whose type says `aligned` follows the other,
     * and if both say so the right one leads. Two handles that each chase the other have no
     * answer, and Blender resolves it the same way — the one you are not dragging moves.
     */
    if (point.rightType === 'aligned' && point.leftType !== 'aligned') right = mirrorHandle(point.co, left, right)
    else if (point.leftType === 'aligned') left = mirrorHandle(point.co, right, left)
    return { ...point, left, right }
  })
}

/** A third of the way from a knot to its neighbour: a vector handle, and a straight span. */
function towards(from: Vec3, to: Vec3): Vec3 {
  return [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3, from[2] + (to[2] - from[2]) / 3]
}

/**
 * Both handles of an automatic knot: along the line through its neighbours, each a third of the
 * way to the neighbour it faces. It is the classic Catmull-Rom tangent, which is what Blender's
 * "Automatic" gives on an unclamped curve.
 */
export function autoHandles(previous: Vec3, co: Vec3, next: Vec3): [Vec3, Vec3] {
  const direction = normalized(subtract(next, previous))
  if (length3(direction) < 1e-9) return [co, co]
  const back = length3(subtract(co, previous)) / 3
  const forward = length3(subtract(next, co)) / 3
  return [add(co, scaled(direction, -back)), add(co, scaled(direction, forward))]
}

/** `handle` put opposite `lead` about the knot, keeping the length it had. */
function mirrorHandle(co: Vec3, lead: Vec3, handle: Vec3): Vec3 {
  const direction = normalized(subtract(co, lead))
  if (length3(direction) < 1e-9) return handle
  return add(co, scaled(direction, length3(subtract(handle, co))))
}

/** A point on the cubic between two knots, at `t` from 0 to 1. */
export function bezierAt(a: CurvePoint, b: CurvePoint, t: number): Vec3 {
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  return [
    a.co[0] * w0 + a.right[0] * w1 + b.left[0] * w2 + b.co[0] * w3,
    a.co[1] * w0 + a.right[1] * w1 + b.left[1] * w2 + b.co[1] * w3,
    a.co[2] * w0 + a.right[2] * w1 + b.left[2] * w2 + b.co[2] * w3,
  ]
}

/**
 * The spline as a polyline.
 *
 * `resolution` is Blender's resolution_u: the number of straight pieces a span is drawn with, so a
 * two-knot curve at 12 comes back as 13 points. A cyclic spline comes back without repeating its
 * first point — the caller closes the ring, because a ring drawn as a line and a ring swept into a
 * tube want that last piece in different places.
 */
export function sampleSpline(spline: CurveSpline, resolution = DEFAULT_RESOLUTION): SampledSpline {
  const steps = Math.max(MIN_RESOLUTION, Math.min(MAX_RESOLUTION, Math.round(resolution)))
  const knots = resolveHandles(spline)
  const points: Vec3[] = []
  const tilts: number[] = []
  const radii: number[] = []
  if (knots.length === 0) return { points, tilts, radii, closed: false }
  if (knots.length === 1) {
    const only = knots[0]!
    return { points: [only.co], tilts: [only.tilt ?? 0], radii: [only.radius ?? 1], closed: false }
  }
  const spans = splineSegments(spline)
  const straight = spline.kind === 'poly'
  for (let span = 0; span < spans; span += 1) {
    const a = knots[span]!
    const b = knots[(span + 1) % knots.length]!
    const pieces = straight ? 1 : steps
    for (let step = 0; step < pieces; step += 1) {
      const t = step / pieces
      points.push(straight ? lerp3(a.co, b.co, t) : bezierAt(a, b, t))
      tilts.push(mix(a.tilt ?? 0, b.tilt ?? 0, t))
      radii.push(mix(a.radius ?? 1, b.radius ?? 1, t))
    }
  }
  if (!spline.cyclic) {
    const last = knots[knots.length - 1]!
    points.push(last.co)
    tilts.push(last.tilt ?? 0)
    radii.push(last.radius ?? 1)
  }
  return { points, tilts, radii, closed: spline.cyclic }
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * How long the spline is, measured on the polyline the given resolution draws.
 *
 * There is no closed form for the length of a cubic, and the chord sum is what every renderer uses;
 * at the default resolution it is short of the true length by well under a thousandth, and it is
 * exactly the length the drawn curve has, which is the more useful of the two answers.
 */
export function splineLength(spline: CurveSpline, resolution = DEFAULT_RESOLUTION): number {
  const sampled = sampleSpline(spline, resolution)
  let total = 0
  for (let index = 1; index < sampled.points.length; index += 1) {
    total += length3(subtract(sampled.points[index]!, sampled.points[index - 1]!))
  }
  if (sampled.closed && sampled.points.length > 1) {
    total += length3(subtract(sampled.points[0]!, sampled.points[sampled.points.length - 1]!))
  }
  return total
}

/** The area a closed spline encloses on XY, signed: positive when it winds counter-clockwise. */
export function signedArea(points: readonly Vec3[]): number {
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    total += a[0] * b[1] - b[0] * a[1]
  }
  return total / 2
}

/** Whether a point lies inside a closed polyline on XY, by counting crossings of a ray. */
export function pointInPolygon(point: readonly [number, number], polygon: readonly Vec3[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!
    const b = polygon[previous]!
    const crosses = (a[1] > point[1]) !== (b[1] > point[1])
    if (!crosses) continue
    const at = a[0] + ((point[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0])
    if (point[0] < at) inside = !inside
  }
  return inside
}
