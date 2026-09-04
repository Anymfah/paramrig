import { describe, expect, it } from 'vitest'
import { bezierCircleData, bezierCurveData, pathData } from '@/scene/curve/data'
import { cageId, curveCage, knotsOf, readCageId, writeCagePositions } from '@/scene/curve/cage'
import type { Vec3 } from '@/scene/types'

describe('cage ids', () => {
  it('reads back what it wrote', () => {
    for (const slot of ['knot', 'left', 'right'] as const) {
      expect(readCageId(cageId(3, 17, slot))).toEqual({ spline: 3, point: 17, slot })
    }
  })

  it('gives every point of every spline a different id', () => {
    const ids = new Set<number>()
    for (let spline = 0; spline < 4; spline += 1) {
      for (let point = 0; point < 200; point += 1) {
        for (const slot of ['knot', 'left', 'right'] as const) ids.add(cageId(spline, point, slot))
      }
    }
    expect(ids.size).toBe(4 * 200 * 3)
  })

  it('refuses what is not one', () => {
    expect(readCageId(-1)).toBeNull()
    expect(readCageId(1.5)).toBeNull()
  })
})

describe('curveCage', () => {
  it('gives a Bézier knot three points and two arms', () => {
    const cage = curveCage(bezierCurveData())
    expect(cage.vertexIds).toHaveLength(6)
    expect(cage.edges).toHaveLength(4)
    expect(cage.faces).toHaveLength(0)
    expect(cage.vertexIds[0]).toBe(cageId(0, 0, 'knot'))
    expect([cage.vertices[0], cage.vertices[1], cage.vertices[2]]).toEqual([-1, 0, 0])
  })

  it('joins a poly spline knot to knot, and closes it when it is cyclic', () => {
    const open = curveCage(pathData())
    expect(open.vertexIds).toHaveLength(5)
    expect(open.edges).toHaveLength(4)
    const closed = curveCage({ ...pathData(), splines: [{ ...pathData().splines[0]!, cyclic: true }] })
    expect(closed.edges).toHaveLength(5)
  })

  it('shows the handles where the evaluator would put them', () => {
    // A vector handle is not stored: it is a third of the way to the neighbour, and the cage has
    // to show it there or a person would drag a point that is not where it is drawn.
    const cage = curveCage(pathData())
    expect(cage.vertexIds).toHaveLength(5)
    const circle = curveCage(bezierCircleData())
    expect(circle.vertexIds).toHaveLength(12)
  })
})

describe('writeCagePositions', () => {
  const at = (data: ReturnType<typeof bezierCurveData>, spline: number, point: number) => data.splines[spline]!.points[point]!

  it('carries a knot’s handles with it', () => {
    const data = bezierCurveData()
    const moved = writeCagePositions(data, [{ vertexId: cageId(0, 0, 'knot'), point: [-1, 2, 0] as Vec3 }])
    expect(at(moved, 0, 0).co).toEqual([-1, 2, 0])
    expect(at(moved, 0, 0).left).toEqual([-1.5, 1.5, 0])
    expect(at(moved, 0, 0).right).toEqual([-0.5, 2.5, 0])
    // The other knot is exactly where it was.
    expect(at(moved, 0, 1)).toEqual(at(data, 0, 1))
  })

  it('leaves a handle dragged in the same gesture where the gesture put it', () => {
    const data = bezierCurveData()
    const moved = writeCagePositions(data, [
      { vertexId: cageId(0, 0, 'knot'), point: [-1, 2, 0] as Vec3 },
      { vertexId: cageId(0, 0, 'right'), point: [0, 0, 0] as Vec3 },
    ])
    expect(at(moved, 0, 0).right).toEqual([0, 0, 0])
    expect(at(moved, 0, 0).left).toEqual([-1.5, 1.5, 0])
  })

  it('makes a dragged automatic handle aligned, so it stops being recomputed', () => {
    const data = pathData()
    expect(at(data, 0, 1).rightType).toBe('vector')
    const moved = writeCagePositions(data, [{ vertexId: cageId(0, 1, 'right'), point: [-1, 1, 0] as Vec3 }])
    expect(at(moved, 0, 1).rightType).toBe('aligned')
    expect(at(moved, 0, 1).leftType).toBe('vector')
  })

  it('gives the curve straight back when nothing it knows about moved', () => {
    const data = bezierCurveData()
    expect(writeCagePositions(data, [{ vertexId: -5, point: [0, 0, 0] }])).toBe(data)
  })
})

describe('knotsOf', () => {
  it('names each knot once, however many of its points are in the list', () => {
    const data = bezierCircleData()
    const found = knotsOf(data, [cageId(0, 2, 'knot'), cageId(0, 2, 'left'), cageId(0, 0, 'right')])
    expect(found).toEqual([{ spline: 0, point: 0 }, { spline: 0, point: 2 }])
  })

  it('drops an id no knot answers to', () => {
    expect(knotsOf(bezierCurveData(), [cageId(4, 9, 'knot')])).toEqual([])
  })
})
