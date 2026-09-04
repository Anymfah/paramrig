import { cageId, knotsOf, readCageId } from '@/scene/curve/cage'
import { HANDLE_TYPES } from '@/scene/curve/data'
import { toElements } from '@/scene/mesh/selection'
import { registerOperator } from '@/scene/operators/registry'
import {
  numberParam, selectParam, type Availability, type OperatorContext, type OperatorResult,
} from '@/scene/operators/types'
import type { CurveData, CurveHandleType, CurvePoint, CurveSpline, SceneDocument, SceneObject, Vec3 } from '@/scene/types'

/**
 * The curve edit menu: everything that changes a curve's knots rather than moving them.
 *
 * Moving is the cage's job — G, R and S reach the knots through it and need nothing here. What is
 * left is the work that is particular to a curve: the four handle types, closing a spline, cutting
 * a span in two, growing one from its end, turning it round, and the tilt and radius that a bevel
 * reads. Each is one step of history, and each says what it did to the selection, because a knot
 * inserted in the middle of a spline renumbers every knot after it.
 */

type CurveTarget = { object: SceneObject; data: CurveData; ids: number[] }

/** Every curve open for editing, with what is selected on it, active first. */
function curveTargets(context: OperatorContext): CurveTarget[] {
  const ids = context.selection.editObjectIds ?? []
  const targets: CurveTarget[] = []
  for (const id of ids) {
    const object = context.document.objects.find((candidate) => candidate.id === id)
    if (!object || object.data.kind !== 'curve') continue
    targets.push({ object, data: object.data, ids: [...toElements(context.selection, id).vertices] })
  }
  return targets
}

function requireCurve(context: OperatorContext, needsSelection = true): Availability {
  if (context.mode !== 'edit') return 'This works in edit mode. Press Tab.'
  const targets = curveTargets(context)
  if (targets.length === 0) return 'Open a curve for editing first.'
  if (!needsSelection) return true
  return targets.some((target) => target.ids.length > 0) ? true : 'No curve points are selected.'
}

/** The document with one object's curve replaced. */
function withCurve(document: SceneDocument, objectId: string, data: CurveData): SceneDocument {
  return { ...document, objects: document.objects.map((entry) => (entry.id === objectId ? { ...entry, data } : entry)) }
}

/**
 * Runs the work on every curve being edited, and carries the answers back.
 *
 * A knot is named by where it is, so an operator that inserts or removes one has to say what the
 * selection becomes: `select` is the ids to hold afterwards, and leaving it out keeps what was
 * already selected, which is right for everything that only changes a knot in place.
 */
function runOnCurves(
  context: OperatorContext,
  work: (target: CurveTarget) => { data: CurveData; select?: number[] } | string | null,
  label: string,
): OperatorResult {
  const targets = curveTargets(context)
  if (targets.length === 0) return { error: 'Open a curve for editing first.' }
  let document = context.document
  let selection = context.selection
  const refusals: string[] = []
  let changed = false
  for (const target of targets) {
    const outcome = work(target)
    if (typeof outcome === 'string') {
      refusals.push(outcome)
      continue
    }
    if (outcome === null) continue
    changed = true
    document = withCurve(document, target.object.id, outcome.data)
    if (outcome.select) {
      selection = {
        ...selection,
        elements: { ...selection.elements, [target.object.id]: { vertices: outcome.select.map(String), edges: [], faces: [] } },
        active: null,
      }
    }
  }
  if (!changed) return { error: refusals[0] ?? 'Nothing to do here.' }
  return { document, selection, label }
}

/* ----------------------------------------------------------------- handles */

registerOperator({
  id: 'curve.setHandleType',
  label: 'Set handle type',
  section: 'Curve',
  shortcut: 'V',
  icon: 'curve',
  description: 'Free, aligned, vector or automatic, on the selected handles.',
  params: [selectParam('type', 'Type', HANDLE_TYPES.map((type) => ({
    value: type,
    label: type === 'free' ? 'Free' : type === 'aligned' ? 'Aligned' : type === 'vector' ? 'Vector' : 'Automatic',
  })), 'aligned')],
  defaults: { type: 'aligned' },
  mode: 'edit',
  available: (context) => requireCurve(context),
  run: (context, params) => {
    const type = HANDLE_TYPES.includes(params.type as CurveHandleType) ? params.type as CurveHandleType : 'aligned'
    return runOnCurves(context, (target) => {
      if (target.ids.length === 0) return null
      // A selected knot means both of its handles; a selected handle means only itself.
      const sides = new Map<string, { left: boolean; right: boolean }>()
      for (const id of target.ids) {
        const read = readCageId(id)
        if (!read) continue
        const key = `${read.spline}:${read.point}`
        const entry = sides.get(key) ?? { left: false, right: false }
        if (read.slot === 'knot') { entry.left = true; entry.right = true }
        else if (read.slot === 'left') entry.left = true
        else entry.right = true
        sides.set(key, entry)
      }
      if (sides.size === 0) return null
      return {
        data: {
          ...target.data,
          splines: target.data.splines.map((spline, splineIndex) => ({
            ...spline,
            points: spline.points.map((point, pointIndex) => {
              const entry = sides.get(`${splineIndex}:${pointIndex}`)
              if (!entry) return point
              return {
                ...point,
                leftType: entry.left ? type : point.leftType,
                rightType: entry.right ? type : point.rightType,
              }
            }),
          })),
        },
      }
    }, 'Set handle type')
  },
})

/* ------------------------------------------------------------------ splines */

/** Which splines the selection touches, and whether every knot of one is in it. */
function touchedSplines(target: CurveTarget): Set<number> {
  const splines = new Set<number>()
  for (const knot of knotsOf(target.data, target.ids)) splines.add(knot.spline)
  return splines
}

registerOperator({
  id: 'curve.toggleCyclic',
  label: 'Toggle cyclic',
  section: 'Curve',
  shortcut: '⌥C',
  icon: 'curve',
  description: 'Close the selected splines into a loop, or open them again.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireCurve(context),
  run: (context) => runOnCurves(context, (target) => {
    const touched = touchedSplines(target)
    if (touched.size === 0) return null
    return {
      data: {
        ...target.data,
        splines: target.data.splines.map((spline, index) => (
          touched.has(index) && spline.points.length > 2 ? { ...spline, cyclic: !spline.cyclic } : spline
        )),
      },
    }
  }, 'Toggle cyclic'),
})

registerOperator({
  id: 'curve.switchDirection',
  label: 'Switch direction',
  section: 'Curve',
  icon: 'curve',
  description: 'Run the selected splines the other way round, leaving the shape where it is.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireCurve(context),
  run: (context) => runOnCurves(context, (target) => {
    const touched = touchedSplines(target)
    if (touched.size === 0) return null
    return {
      data: {
        ...target.data,
        splines: target.data.splines.map((spline, index) => (
          touched.has(index) ? reversed(spline) : spline
        )),
      },
      // Every knot has moved to a new place in the spline, so what was selected is no longer where
      // it was; the whole of a turned spline is selected, which is what a person had in hand.
      select: [...touched].flatMap((splineIndex) => (
        (target.data.splines[splineIndex]?.points ?? []).flatMap((_, pointIndex) => [
          cageId(splineIndex, pointIndex, 'knot'),
          cageId(splineIndex, pointIndex, 'left'),
          cageId(splineIndex, pointIndex, 'right'),
        ])
      )),
    }
  }, 'Switch direction'),
})

/** The spline the other way round: the knots reversed, and each knot's handles swapped with them. */
function reversed(spline: CurveSpline): CurveSpline {
  return {
    ...spline,
    points: [...spline.points].reverse().map((point) => ({
      ...point,
      left: point.right,
      right: point.left,
      leftType: point.rightType,
      rightType: point.leftType,
    })),
  }
}

/* ---------------------------------------------------------------- the knots */

registerOperator({
  id: 'curve.subdivide',
  label: 'Subdivide',
  section: 'Curve',
  icon: 'curve',
  description: 'Put a knot in the middle of every selected span, leaving the shape exactly as it was.',
  params: [numberParam('cuts', 'Cuts', { min: 1, max: 10, step: 1, defaultValue: 1, view: 'stepper' })],
  defaults: { cuts: 1 },
  mode: 'edit',
  available: (context) => requireCurve(context),
  run: (context, params) => {
    const cuts = Math.max(1, Math.min(10, Math.round(Number(params.cuts ?? 1))))
    return runOnCurves(context, (target) => {
      let chosen = new Map<number, Set<number>>()
      for (const knot of knotsOf(target.data, target.ids)) {
        const set = chosen.get(knot.spline) ?? new Set<number>()
        set.add(knot.point)
        chosen.set(knot.spline, set)
      }
      if (chosen.size === 0) return null
      let data = target.data
      let anyCut = false
      for (let pass = 0; pass < cuts; pass += 1) {
        const splines: CurveSpline[] = []
        const next = new Map<number, Set<number>>()
        data.splines.forEach((spline, splineIndex) => {
          const wanted = chosen.get(splineIndex)
          if (!wanted || wanted.size === 0) {
            splines.push(spline)
            return
          }
          const outcome = subdivideSpline(spline, wanted)
          splines.push(outcome.spline)
          next.set(splineIndex, outcome.selected)
          if (outcome.spline !== spline) anyCut = true
        })
        data = { ...data, splines }
        chosen = next
      }
      if (!anyCut) return 'The selected knots are not next to each other, so there is no span to cut.'
      const select: number[] = []
      for (const [splineIndex, points] of chosen) {
        for (const point of points) {
          select.push(cageId(splineIndex, point, 'knot'), cageId(splineIndex, point, 'left'), cageId(splineIndex, point, 'right'))
        }
      }
      return { data, select }
    }, 'Subdivide')
  },
})

/**
 * One pass of cutting: every span whose two knots are both selected gets a knot in the middle.
 *
 * The cut is de Casteljau's, so the curve afterwards is the curve before it, to the last bit: the
 * two halves of a cubic are cubics, and their handles are the ones the construction gives. The
 * handles it touches become free, because an automatic or a vector handle is *computed* — leaving
 * one as it was would let it spring back and move the curve the cut was meant to leave alone.
 *
 * It answers with the knots to keep selected, by their new places: an insertion shifts everything
 * after it, and a selection that is not shifted with it points at the wrong knots on the next pass.
 */
function subdivideSpline(spline: CurveSpline, wanted: ReadonlySet<number>): { spline: CurveSpline; selected: Set<number> } {
  const count = spline.points.length
  const selected = new Set<number>()
  if (count < 2) return { spline, selected: new Set(wanted) }
  const spans = spline.cyclic ? count : count - 1
  const knots = spline.points.map((point) => ({ ...point }))
  const inserted = new Map<number, CurvePoint>()
  for (let index = 0; index < spans; index += 1) {
    const after = (index + 1) % count
    if (!wanted.has(index) || !wanted.has(after)) continue
    const a = knots[index]!
    const b = knots[after]!
    if (spline.kind === 'poly') {
      const centre = middle(a.co, b.co)
      inserted.set(index, { co: centre, left: centre, right: centre, leftType: 'vector', rightType: 'vector' })
      continue
    }
    const q0 = middle(a.co, a.right)
    const q1 = middle(a.right, b.left)
    const q2 = middle(b.left, b.co)
    const r0 = middle(q0, q1)
    const r1 = middle(q1, q2)
    const centre = middle(r0, r1)
    knots[index] = { ...a, right: q0, rightType: 'free' }
    knots[after] = { ...b, left: q2, leftType: 'free' }
    inserted.set(index, { co: centre, left: r0, right: r1, leftType: 'free', rightType: 'free' })
  }
  if (inserted.size === 0) return { spline, selected: new Set(wanted) }
  const points: CurvePoint[] = []
  for (let index = 0; index < count; index += 1) {
    if (wanted.has(index)) selected.add(points.length)
    points.push(knots[index]!)
    const made = inserted.get(index)
    if (made) {
      selected.add(points.length)
      points.push(made)
    }
  }
  return { spline: { ...spline, points }, selected }
}

function middle(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}

registerOperator({
  id: 'curve.extrude',
  label: 'Extrude curve',
  section: 'Curve',
  shortcut: 'E',
  icon: 'extrude',
  description: 'Grow the spline by one knot from the selected end, ready to be moved.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireCurve(context),
  run: (context) => runOnCurves(context, (target) => {
    const chosen = knotsOf(target.data, target.ids)
    if (chosen.length === 0) return null
    const select: number[] = []
    let grew = false
    const splines = target.data.splines.map((spline, splineIndex) => {
      if (spline.cyclic || spline.points.length === 0) return spline
      const last = spline.points.length - 1
      const wantsEnd = chosen.some((knot) => knot.spline === splineIndex && knot.point === last)
      const wantsStart = chosen.some((knot) => knot.spline === splineIndex && knot.point === 0)
      // Blender grows from the end you had hold of; with both ends selected, the end wins.
      if (wantsEnd) {
        grew = true
        const point = spline.points[last]!
        select.push(cageId(splineIndex, last + 1, 'knot'), cageId(splineIndex, last + 1, 'left'), cageId(splineIndex, last + 1, 'right'))
        return { ...spline, points: [...spline.points, { ...point }] }
      }
      if (wantsStart) {
        grew = true
        const point = spline.points[0]!
        select.push(cageId(splineIndex, 0, 'knot'), cageId(splineIndex, 0, 'left'), cageId(splineIndex, 0, 'right'))
        return { ...spline, points: [{ ...point }, ...spline.points] }
      }
      return spline
    })
    if (!grew) return 'Select the first or the last knot of an open spline to grow it.'
    return { data: { ...target.data, splines }, select }
  }, 'Extrude curve'),
})

registerOperator({
  id: 'curve.delete',
  label: 'Delete curve points',
  section: 'Curve',
  icon: 'curve',
  description: 'Remove the selected knots; a spline left with fewer than two goes with them.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireCurve(context),
  run: (context) => runOnCurves(context, (target) => {
    const chosen = new Set(knotsOf(target.data, target.ids).map((knot) => `${knot.spline}:${knot.point}`))
    if (chosen.size === 0) return null
    const splines = target.data.splines
      .map((spline, splineIndex) => ({
        ...spline,
        points: spline.points.filter((_, pointIndex) => !chosen.has(`${splineIndex}:${pointIndex}`)),
      }))
      .filter((spline) => spline.points.length >= 2)
    return { data: { ...target.data, splines }, select: [] }
  }, 'Delete curve points'),
})

/* ------------------------------------------------------------ tilt and size */

registerOperator({
  id: 'curve.tilt',
  label: 'Tilt',
  section: 'Curve',
  shortcut: '⌃T',
  icon: 'rotate',
  description: 'Turn the bevel profile about the curve at the selected knots.',
  params: [numberParam('angle', 'Angle', { min: -360, max: 360, step: 1, defaultValue: 0, unit: '°' })],
  defaults: { angle: 0 },
  mode: 'edit',
  available: (context) => requireCurve(context),
  run: (context, params) => {
    const angle = Number(params.angle ?? 0)
    return runOnCurves(context, (target) => atKnots(target, (point) => ({ ...point, tilt: angle })), 'Tilt')
  },
})

registerOperator({
  id: 'curve.setRadius',
  label: 'Set radius',
  section: 'Curve',
  shortcut: '⌥S',
  icon: 'scale',
  description: 'Scale the bevel profile at the selected knots; one is the bevel’s own size.',
  params: [numberParam('radius', 'Radius', { min: 0, max: 10, step: 0.05, defaultValue: 1 })],
  defaults: { radius: 1 },
  mode: 'edit',
  available: (context) => requireCurve(context),
  run: (context, params) => {
    const radius = Math.max(0, Number(params.radius ?? 1))
    return runOnCurves(context, (target) => atKnots(target, (point) => ({ ...point, radius })), 'Set radius')
  },
})

registerOperator({
  id: 'curve.smooth',
  label: 'Smooth curve',
  section: 'Curve',
  icon: 'smooth',
  description: 'Pull each selected knot halfway towards the middle of its neighbours.',
  params: [numberParam('factor', 'Factor', { min: 0, max: 1, step: 0.05, defaultValue: 0.5 })],
  defaults: { factor: 0.5 },
  mode: 'edit',
  available: (context) => requireCurve(context),
  run: (context, params) => {
    const factor = Math.max(0, Math.min(1, Number(params.factor ?? 0.5)))
    return runOnCurves(context, (target) => {
      const chosen = new Set(knotsOf(target.data, target.ids).map((knot) => `${knot.spline}:${knot.point}`))
      if (chosen.size === 0) return null
      return {
        data: {
          ...target.data,
          splines: target.data.splines.map((spline, splineIndex) => ({
            ...spline,
            points: spline.points.map((point, pointIndex) => {
              if (!chosen.has(`${splineIndex}:${pointIndex}`)) return point
              const count = spline.points.length
              const previous = spline.points[spline.cyclic ? (pointIndex + count - 1) % count : Math.max(0, pointIndex - 1)]!
              const next = spline.points[spline.cyclic ? (pointIndex + 1) % count : Math.min(count - 1, pointIndex + 1)]!
              const wanted = middle(previous.co, next.co)
              const co: Vec3 = [
                point.co[0] + (wanted[0] - point.co[0]) * factor,
                point.co[1] + (wanted[1] - point.co[1]) * factor,
                point.co[2] + (wanted[2] - point.co[2]) * factor,
              ]
              const drift: Vec3 = [co[0] - point.co[0], co[1] - point.co[1], co[2] - point.co[2]]
              return {
                ...point,
                co,
                left: [point.left[0] + drift[0], point.left[1] + drift[1], point.left[2] + drift[2]],
                right: [point.right[0] + drift[0], point.right[1] + drift[1], point.right[2] + drift[2]],
              }
            }),
          })),
        },
      }
    }, 'Smooth curve')
  },
})

/** The curve with a change made at every selected knot, leaving the rest alone. */
function atKnots(target: CurveTarget, change: (point: CurvePoint) => CurvePoint): { data: CurveData } | null {
  const chosen = new Set(knotsOf(target.data, target.ids).map((knot) => `${knot.spline}:${knot.point}`))
  if (chosen.size === 0) return null
  return {
    data: {
      ...target.data,
      splines: target.data.splines.map((spline, splineIndex) => ({
        ...spline,
        points: spline.points.map((point, pointIndex) => (
          chosen.has(`${splineIndex}:${pointIndex}`) ? change(point) : point
        )),
      })),
    },
  }
}
