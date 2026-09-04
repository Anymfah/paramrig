import { describe, expect, it } from 'vitest'
import { cageId } from '@/scene/curve/cage'
import { bezierCircleData, bezierCurveData, pathData } from '@/scene/curve/data'
import { sampleSpline } from '@/scene/curve/spline'
import { createSceneDocument, objectById, ROOT_COLLECTION_ID } from '@/scene/document'
import '@/scene/operators/curveEdit'
import { operatorAvailability, runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams } from '@/scene/operators/types'
import type { CurveData, SceneDocument, SceneObject } from '@/scene/types'

/**
 * Editing a curve: the operators that change what the knots are, rather than where they are.
 *
 * Moving is the cage's business and is tested with it. What is asserted here is that a cut leaves
 * the curve where it was, that a closed spline closes, and that every operator says what the
 * selection becomes — a knot put in the middle renumbers everything after it, and a selection that
 * is not moved with it points at the wrong knots.
 */

function curveObject(data: CurveData): SceneObject {
  return {
    id: 'curve-1',
    name: 'Curve',
    kind: 'curve',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data,
    modifiers: [],
    materialSlots: [],
  }
}

function scene(data: CurveData, selected: number[]): { document: SceneDocument; context: OperatorContext } {
  const document: SceneDocument = {
    ...createSceneDocument(),
    objects: [curveObject(data)],
    meshes: {},
    view: { ...createSceneDocument().view, mode: 'edit' },
  }
  const context: OperatorContext = {
    document,
    selection: {
      objectIds: ['curve-1'],
      activeObjectId: 'curve-1',
      editObjectIds: ['curve-1'],
      elements: { 'curve-1': { vertices: selected.map(String), edges: [], faces: [] } },
    },
    mode: 'edit',
    view: document.view,
    cursor: document.cursor,
    active: document.objects[0]!,
  }
  return { document, context }
}

function run(data: CurveData, selected: number[], id: string, params: OperatorParams = {}) {
  const { context } = scene(data, selected)
  return runOperator(id, context, params)
}

function curveOf(document: SceneDocument | undefined): CurveData {
  const object = objectById(document!, 'curve-1')!
  if (object.data.kind !== 'curve') throw new Error('not a curve')
  return object.data
}

/** Both knots of the first span, with their handles: what a cut needs to have hold of. */
const SPAN = [
  cageId(0, 0, 'knot'), cageId(0, 0, 'left'), cageId(0, 0, 'right'),
  cageId(0, 1, 'knot'), cageId(0, 1, 'left'), cageId(0, 1, 'right'),
]

describe('curve.subdivide', () => {
  it('puts a knot in the middle and leaves the curve exactly where it was', () => {
    const data = bezierCurveData()
    const before = sampleSpline(data.splines[0]!, 24).points
    const result = run(data, SPAN, 'curve.subdivide')
    const after = curveOf(result.document)
    expect(after.splines[0]!.points).toHaveLength(3)
    // The two halves of a cubic are cubics: de Casteljau's cut moves nothing on the curve itself.
    const walked = sampleSpline(after.splines[0]!, 12).points
    for (const point of walked) {
      const nearest = Math.min(...before.map((other) => Math.hypot(other[0] - point[0], other[1] - point[1], other[2] - point[2])))
      expect(nearest).toBeLessThan(1e-6)
    }
  })

  it('selects the knots it kept and the one it made', () => {
    const result = run(bezierCurveData(), SPAN, 'curve.subdivide')
    const selected = new Set(result.selection?.elements?.['curve-1']?.vertices ?? [])
    // Three knots at 0, 1 and 2 — the new one is in the middle, and the old second is now third.
    for (const point of [0, 1, 2]) expect(selected.has(String(cageId(0, point, 'knot')))).toBe(true)
    expect(selected.size).toBe(9)
  })

  it('cuts twice when it is asked to', () => {
    const result = run(bezierCurveData(), SPAN, 'curve.subdivide', { cuts: 2 })
    expect(curveOf(result.document).splines[0]!.points).toHaveLength(5)
  })

  it('refuses when the selected knots are not next to each other', () => {
    const result = run(bezierCircleData(), [cageId(0, 0, 'knot'), cageId(0, 2, 'knot')], 'curve.subdivide')
    expect(result.error).toContain('not next to each other')
  })

  it('cuts the closing span of a ring as readily as any other', () => {
    const circle = bezierCircleData()
    const all = circle.splines[0]!.points.flatMap((_, index) => [cageId(0, index, 'knot')])
    const result = run(circle, all, 'curve.subdivide')
    expect(curveOf(result.document).splines[0]!.points).toHaveLength(8)
  })
})

describe('curve.toggleCyclic', () => {
  it('closes an open spline and opens a closed one', () => {
    const closed = curveOf(run(pathData(), [cageId(0, 0, 'knot')], 'curve.toggleCyclic').document)
    expect(closed.splines[0]!.cyclic).toBe(true)
    const opened = curveOf(run(bezierCircleData(), [cageId(0, 0, 'knot')], 'curve.toggleCyclic').document)
    expect(opened.splines[0]!.cyclic).toBe(false)
  })
})

describe('curve.setHandleType', () => {
  it('sets both handles of a selected knot', () => {
    const result = run(bezierCurveData(), [cageId(0, 0, 'knot')], 'curve.setHandleType', { type: 'vector' })
    const point = curveOf(result.document).splines[0]!.points[0]!
    expect(point.leftType).toBe('vector')
    expect(point.rightType).toBe('vector')
  })

  it('sets only the handle that was selected', () => {
    const result = run(bezierCurveData(), [cageId(0, 1, 'left')], 'curve.setHandleType', { type: 'free' })
    const point = curveOf(result.document).splines[0]!.points[1]!
    expect(point.leftType).toBe('free')
    expect(point.rightType).toBe('aligned')
  })
})

describe('curve.extrude', () => {
  it('grows the spline from its last knot and selects the new one', () => {
    const result = run(bezierCurveData(), [cageId(0, 1, 'knot')], 'curve.extrude')
    const after = curveOf(result.document)
    expect(after.splines[0]!.points).toHaveLength(3)
    expect(after.splines[0]!.points[2]!.co).toEqual(after.splines[0]!.points[1]!.co)
    expect(result.selection?.elements?.['curve-1']?.vertices).toContain(String(cageId(0, 2, 'knot')))
  })

  it('grows from the first knot when that is what is held', () => {
    const result = run(bezierCurveData(), [cageId(0, 0, 'knot')], 'curve.extrude')
    expect(curveOf(result.document).splines[0]!.points).toHaveLength(3)
    expect(result.selection?.elements?.['curve-1']?.vertices).toContain(String(cageId(0, 0, 'knot')))
  })

  it('refuses in the middle of a spline, and says where to hold it', () => {
    const result = run(pathData(), [cageId(0, 2, 'knot')], 'curve.extrude')
    expect(result.error).toContain('first or the last knot')
  })
})

describe('curve.switchDirection', () => {
  it('runs the spline the other way and swaps each knot’s handles with it', () => {
    const data = bezierCurveData()
    const result = curveOf(run(data, [cageId(0, 0, 'knot')], 'curve.switchDirection').document)
    expect(result.splines[0]!.points[0]!.co).toEqual(data.splines[0]!.points[1]!.co)
    expect(result.splines[0]!.points[0]!.left).toEqual(data.splines[0]!.points[1]!.right)
  })

  it('leaves the drawn curve where it was', () => {
    const data = bezierCurveData()
    const before = sampleSpline(data.splines[0]!, 12).points
    const after = sampleSpline(curveOf(run(data, [cageId(0, 0, 'knot')], 'curve.switchDirection').document).splines[0]!, 12).points
    expect(after.map((point) => point.map((value) => Math.round(value * 1e6) / 1e6))).toEqual(
      [...before].reverse().map((point) => point.map((value) => Math.round(value * 1e6) / 1e6)),
    )
  })
})

describe('curve.delete', () => {
  it('removes the selected knots', () => {
    const result = curveOf(run(pathData(), [cageId(0, 1, 'knot'), cageId(0, 3, 'knot')], 'curve.delete').document)
    expect(result.splines[0]!.points).toHaveLength(3)
  })

  it('takes the spline with them when fewer than two are left', () => {
    const data = pathData()
    const all = data.splines[0]!.points.map((_, index) => cageId(0, index, 'knot'))
    expect(curveOf(run(data, all, 'curve.delete').document).splines).toHaveLength(0)
  })
})

describe('curve.tilt and curve.setRadius', () => {
  it('writes the angle and the radius on the selected knots only', () => {
    const tilted = curveOf(run(pathData(), [cageId(0, 1, 'knot')], 'curve.tilt', { angle: 45 }).document)
    expect(tilted.splines[0]!.points[1]!.tilt).toBe(45)
    expect(tilted.splines[0]!.points[0]!.tilt).toBeUndefined()
    const sized = curveOf(run(pathData(), [cageId(0, 1, 'knot')], 'curve.setRadius', { radius: 0.25 }).document)
    expect(sized.splines[0]!.points[1]!.radius).toBe(0.25)
  })
})

describe('curve.smooth', () => {
  it('pulls a knot towards the line between its neighbours', () => {
    const data = pathData()
    const bumped: CurveData = {
      ...data,
      splines: [{ ...data.splines[0]!, points: data.splines[0]!.points.map((point, index) => (
        index === 2 ? { ...point, co: [point.co[0], 2, 0] as [number, number, number] } : point
      )) }],
    }
    const smoothed = curveOf(run(bumped, [cageId(0, 2, 'knot')], 'curve.smooth', { factor: 0.5 }).document)
    expect(smoothed.splines[0]!.points[2]!.co[1]).toBeCloseTo(1, 6)
  })
})

describe('availability', () => {
  it('is out of reach in object mode', () => {
    const { context } = scene(bezierCurveData(), [])
    const objectMode = { ...context, mode: 'object' as const }
    expect(operatorAvailability('curve.subdivide', objectMode)).toBe('This works in edit mode. Press Tab.')
  })

  it('says so when nothing is selected', () => {
    const { context } = scene(bezierCurveData(), [])
    expect(operatorAvailability('curve.subdivide', context)).toBe('No curve points are selected.')
  })
})
