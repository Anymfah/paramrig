import type { BezierCurve } from '../../rigs/types.ts'

/**
 * The same cubic the CurveField edits, sampled by time rather than drawn. Keeping the workbench's
 * own curve type here is what lets a slide shape come straight off the control with no conversion.
 */

const ITERATIONS = 8

/** Cubic Bézier on one axis, p0 and p3 being the anchors. */
function axis(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

function slope(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t
  return 3 * u * u * (b - a) + 6 * u * t * (c - b) + 3 * t * t * (d - c)
}

/**
 * y for a given x. The curve is a function of the parameter, not of x, so x is inverted first —
 * Newton, then a bisection fallback for the flat stretches where Newton stalls.
 */
export function curveAt(curve: BezierCurve, x: number): number {
  const at = x <= 0 ? 0 : x >= 1 ? 1 : x
  const [x0, y0] = curve.p0
  const [x1, y1] = curve.p1
  const [x2, y2] = curve.p2
  const [x3, y3] = curve.p3
  let t = at
  for (let i = 0; i < ITERATIONS; i += 1) {
    const dx = axis(t, x0, x1, x2, x3) - at
    if (Math.abs(dx) < 1e-6) break
    const d = slope(t, x0, x1, x2, x3)
    if (Math.abs(d) < 1e-6) break
    t -= dx / d
  }
  if (t < 0 || t > 1 || !Number.isFinite(t)) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 24; i += 1) {
      t = (lo + hi) / 2
      if (axis(t, x0, x1, x2, x3) < at) lo = t
      else hi = t
    }
  }
  return axis(t, y0, y1, y2, y3)
}

export const LINEAR: BezierCurve = { type: 'cubic-bezier', p0: [0, 0], p1: [0.33, 0.33], p2: [0.67, 0.67], p3: [1, 1] }
export const EASE_OUT: BezierCurve = { type: 'cubic-bezier', p0: [0, 0], p1: [0, 0.6], p2: [0.3, 1], p3: [1, 1] }
export const EASE_IN: BezierCurve = { type: 'cubic-bezier', p0: [0, 0], p1: [0.7, 0], p2: [1, 0.4], p3: [1, 1] }
