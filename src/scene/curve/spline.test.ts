import { describe, expect, it } from 'vitest'
import { bezierCircleData, bezierCurveData, pathData, sanitizeCurveData } from '@/scene/curve/data'
import {
  autoHandles, bezierAt, pointInPolygon, resolveHandles, sampleSpline, signedArea, splineLength, splineSegments,
} from '@/scene/curve/spline'
import type { CurvePoint, CurveSpline } from '@/scene/types'

function knot(x: number, y: number, reach = 0.5): CurvePoint {
  return { co: [x, y, 0], left: [x - reach, y, 0], right: [x + reach, y, 0], leftType: 'free', rightType: 'free' }
}

describe('sampleSpline', () => {
  it('gives one point per piece, plus the last knot, on an open spline', () => {
    const spline: CurveSpline = { id: 's', kind: 'bezier', cyclic: false, points: [knot(0, 0), knot(2, 0), knot(4, 0)] }
    expect(splineSegments(spline)).toBe(2)
    expect(sampleSpline(spline, 12).points).toHaveLength(2 * 12 + 1)
    expect(sampleSpline(spline, 4).points).toHaveLength(2 * 4 + 1)
  })

  it('does not repeat the first point of a ring', () => {
    const circle = bezierCircleData().splines[0]!
    const sampled = sampleSpline(circle, 8)
    expect(sampled.closed).toBe(true)
    expect(sampled.points).toHaveLength(4 * 8)
    expect(sampled.points[0]).toEqual([-1, 0, 0])
  })

  it('walks a poly spline straight from knot to knot whatever the resolution', () => {
    const path = pathData().splines[0]!
    expect(sampleSpline(path, 32).points).toHaveLength(5)
  })

  it('gives a single knot back as itself', () => {
    const spline: CurveSpline = { id: 's', kind: 'bezier', cyclic: false, points: [knot(1, 2)] }
    expect(sampleSpline(spline).points).toEqual([[1, 2, 0]])
  })
})

describe('splineLength', () => {
  it('measures a straight span exactly', () => {
    const spline: CurveSpline = {
      id: 's',
      kind: 'bezier',
      cyclic: false,
      points: [
        { co: [0, 0, 0], left: [-1, 0, 0], right: [1, 0, 0], leftType: 'free', rightType: 'free' },
        { co: [3, 0, 0], left: [2, 0, 0], right: [4, 0, 0], leftType: 'free', rightType: 'free' },
      ],
    }
    expect(splineLength(spline, 12)).toBeCloseTo(3, 6)
  })

  it('measures a Bézier circle to within a thousandth of its circumference', () => {
    const circle = bezierCircleData().splines[0]!
    // A chord sum is always short of the arc it cuts. At the default resolution the shortfall on a
    // unit circle is 3.6 mm in 6.28 m — under a part in a thousand, which is the drawn length.
    const measured = splineLength(circle, 12)
    expect(measured).toBeLessThan(2 * Math.PI)
    expect((2 * Math.PI - measured) / (2 * Math.PI)).toBeLessThan(0.001)
  })

  it('grows with resolution towards the true length', () => {
    const circle = bezierCircleData().splines[0]!
    expect(splineLength(circle, 24)).toBeGreaterThan(splineLength(circle, 2))
  })
})

describe('handles', () => {
  it('puts a vector handle a third of the way to its neighbour', () => {
    const spline: CurveSpline = {
      id: 's',
      kind: 'bezier',
      cyclic: false,
      points: [
        { ...knot(0, 0), rightType: 'vector' },
        { ...knot(3, 0), leftType: 'vector' },
      ],
    }
    const resolved = resolveHandles(spline)
    expect(resolved[0]!.right).toEqual([1, 0, 0])
    expect(resolved[1]!.left).toEqual([2, 0, 0])
  })

  it('lays an automatic knot along the line through its neighbours', () => {
    const [left, right] = autoHandles([-3, 0, 0], [0, 0, 0], [3, 3, 0])
    expect(left[1]).toBeLessThan(0)
    expect(right[1]).toBeGreaterThan(0)
    // Both are on one line through the knot, which is what makes the curve pass smoothly.
    expect(left[0] / left[1]).toBeCloseTo(right[0] / right[1], 6)
  })

  it('holds an aligned handle opposite its partner, keeping its own length', () => {
    const spline: CurveSpline = {
      id: 's',
      kind: 'bezier',
      cyclic: false,
      points: [
        { co: [0, 0, 0], left: [0, -2, 0], right: [1, 0.1, 0], leftType: 'free', rightType: 'aligned' },
        knot(3, 0),
      ],
    }
    const point = resolveHandles(spline)[0]!
    expect(point.right[0]).toBeCloseTo(0, 6)
    expect(point.right[1]).toBeCloseTo(1.004987, 5)
  })

  it('leaves a free handle exactly where it was put', () => {
    const spline: CurveSpline = { id: 's', kind: 'bezier', cyclic: false, points: [knot(0, 0), knot(2, 0)] }
    expect(resolveHandles(spline)[0]!.right).toEqual([0.5, 0, 0])
  })
})

describe('bezierAt', () => {
  it('passes through its knots at the ends', () => {
    const a = knot(0, 0)
    const b = knot(4, 1)
    expect(bezierAt(a, b, 0)).toEqual([0, 0, 0])
    expect(bezierAt(a, b, 1)).toEqual([4, 1, 0])
  })
})

describe('polygon helpers', () => {
  it('signs the area by the winding', () => {
    const square: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
    expect(signedArea(square)).toBeCloseTo(1, 9)
    expect(signedArea([...square].reverse())).toBeCloseTo(-1, 9)
  })

  it('knows inside from outside', () => {
    const square: Array<[number, number, number]> = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]
    expect(pointInPolygon([1, 1], square)).toBe(true)
    expect(pointInPolygon([3, 1], square)).toBe(false)
  })
})

describe('sanitizeCurveData', () => {
  it('keeps a curve it was given', () => {
    const data = sanitizeCurveData(bezierCurveData())
    expect(data.splines).toHaveLength(1)
    expect(data.splines[0]!.points).toHaveLength(2)
    expect(data.dimensions).toBe('2D')
  })

  it('refuses nonsense and falls back', () => {
    const data = sanitizeCurveData({ splines: 'no', resolution: 1000, fill: 'sideways', extrude: Number.NaN, bevelDepth: -4 })
    expect(data.splines).toEqual([])
    expect(data.resolution).toBe(64)
    expect(data.fill).toBe('both')
    expect(data.extrude).toBe(0)
    expect(data.bevelDepth).toBe(0)
  })

  it('drops a spline with no readable points and keeps the rest', () => {
    const data = sanitizeCurveData({ splines: [{ points: [] }, { kind: 'poly', cyclic: true, points: [{ co: [1, 2, 3] }] }] })
    expect(data.splines).toHaveLength(1)
    expect(data.splines[0]!.kind).toBe('poly')
    expect(data.splines[0]!.points[0]!.co).toEqual([1, 2, 3])
  })
})
