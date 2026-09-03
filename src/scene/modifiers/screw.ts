import { length, normalize } from '@/scene/mesh/normals'
import { applyDirection, applyMatrix } from '@/scene/modifiers/matrix'
import { registerModifier, chosenOf, numberOf, switchOf, wholeOf } from '@/scene/modifiers/types'
import { weldVertices, withinDistance } from '@/scene/operators/merge'
import { sweep, type SweepTarget } from '@/scene/operators/spin'
import { numberParam, selectParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Screw: a profile lathed about an axis, climbing as it turns.
 *
 * The sweep is the operator's, `sweep` in `operators/spin.ts`, handed the whole mesh instead of a
 * selection — Spin, the Screw operator and this modifier are one algorithm, and a bolt thread that
 * came out differently from the modifier and from the F9 panel would be a bug nobody could find.
 *
 * Blender multiplies both the angle and the rise by the iteration count, so `screw` is what one
 * turn climbs and not what the whole thread does; the tests say so out loud. A whole turn that
 * climbs nowhere closes onto its own first ring whatever Merge says, which is Blender's `close`,
 * and Merge is left to do what it is actually for: welding a profile that touches the axis, or two
 * turns that land on each other.
 */

const AXES = ['x', 'y', 'z'] as const

const DIRECTIONS: Record<(typeof AXES)[number], Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

const NEEDS_PROFILE = 'Screw needs a profile; this mesh has no vertices.'
const NEEDS_SWEEP = 'Give Screw an angle to turn through or a rise to climb; with neither there is nothing to sweep.'
const NO_AXIS_OBJECT = 'Screw turns about an object that is not in the scene any more; choose another for Axis object.'

/** As many steps as a viewport can be asked to draw at once, however many turns were asked for. */
const STEP_CEILING = 1024

/** A whole mesh as a selection: what a modifier hands the sweep in place of what a person picked. */
function everySlot(count: number): Set<number> {
  const slots = new Set<number>()
  for (let slot = 0; slot < count; slot += 1) slots.add(slot)
  return slots
}

registerModifier({
  kind: 'screw',
  label: 'Screw',
  category: 'generate',
  description: 'Lathe the mesh about an axis, climbing along it by the rise on every turn.',
  icon: 'modifier-screw',
  defaults: {
    angle: 360,
    screw: 0,
    iterations: 1,
    axis: 'z',
    axisObject: '',
    steps: 16,
    renderSteps: 16,
    merge: false,
    mergeDistance: 0.01,
    smooth: true,
    calcOrder: true,
  },
  schema: [
    numberParam('angle', 'Angle', { min: -3600, max: 3600, step: 1, defaultValue: 360, unit: '°', view: 'angle' }),
    numberParam('screw', 'Screw', { min: -1000, max: 1000, step: 0.01, defaultValue: 0, unit: 'm' }),
    numberParam('iterations', 'Iterations', { min: 1, max: 64, step: 1, defaultValue: 1, view: 'stepper' }),
    selectParam('axis', 'Axis', [
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'z', label: 'Z' },
    ], 'z'),
    selectParam('axisObject', 'Axis object', [], ''),
    numberParam('steps', 'Steps', { min: 1, max: 512, step: 1, defaultValue: 16, view: 'stepper' }),
    numberParam('renderSteps', 'Render steps', { min: 1, max: 512, step: 1, defaultValue: 16, view: 'stepper' }),
    switchParam('merge', 'Merge vertices', false),
    numberParam('mergeDistance', 'Merge distance', { min: 0, max: 10, step: 0.001, defaultValue: 0.01, unit: 'm' }),
    switchParam('smooth', 'Smooth shading', true),
    switchParam('calcOrder', 'Calculate order', true),
  ],
  objectInputs: ['axisObject'],
  apply: (mesh, params, context) => {
    if (mesh.vertexCount === 0) return NEEDS_PROFILE
    const named = typeof params.axisObject === 'string' ? params.axisObject : ''
    const other = context.inputs.axisObject ?? null
    if (named !== '' && !other) return NO_AXIS_OBJECT

    const iterations = wholeOf(params.iterations, 1, 1, 64)
    const angle = ((numberOf(params.angle, 360, -3600, 3600) * Math.PI) / 180) * iterations
    const rise = numberOf(params.screw, 0, -1000, 1000) * iterations
    if (Math.abs(angle) < 1e-9 && Math.abs(rise) < 1e-9) return NEEDS_SWEEP

    // An object standing in for the axis lends both its direction and its origin: turning about a
    // named empty has to follow it when it is moved, which is the whole point of naming one.
    const chosen = DIRECTIONS[chosenOf(params.axis, AXES, 'z')]
    const axis = other ? applyDirection(other.matrix, chosen) : chosen
    if (length(axis) < 1e-9) return 'Screw cannot turn about an axis object that has been flattened to nothing.'
    const centre: Vec3 = other ? applyMatrix(other.matrix, [0, 0, 0]) : [0, 0, 0]

    const perTurn = wholeOf(context.forRender ? params.renderSteps : params.steps, 16, 1, 512)
    const steps = Math.min(STEP_CEILING, perTurn * iterations)
    const target: SweepTarget = {
      mesh,
      vertices: everySlot(mesh.vertexCount),
      edges: everySlot(mesh.edgeCount),
      faces: everySlot(mesh.faceCount),
    }
    const before = mesh.faceCount
    const outcome = sweep(target, {
      steps,
      angle,
      axis: normalize(axis),
      centre,
      rise,
      duplicates: false,
      autoMerge: true,
      calcOrder: switchOf(params.calcOrder, true),
    })
    // The sweep's only refusal is an empty selection, which a whole mesh with vertices in it cannot
    // be; it is said again here in the words a modifier panel should use rather than passed through.
    if (typeof outcome === 'string') return NEEDS_PROFILE

    if (switchOf(params.smooth, true)) {
      for (let face = before; face < mesh.faceCount; face += 1) mesh.setFaceSmooth(face, true)
    }
    if (switchOf(params.merge, false)) {
      const distance = numberOf(params.mergeDistance, 0.01, 0, 10)
      // Merge by distance over the whole result, which is what welds a profile that touches the
      // axis into one point and what closes two turns that came to rest on each other.
      if (distance > 0) weldVertices(mesh, withinDistance(mesh, everySlot(mesh.vertexCount), distance, false))
    }
  },
})
