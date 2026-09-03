import { applyMatrix, invert } from '@/scene/modifiers/matrix'
import { chosenOf, numberOf, registerModifier, switchOf } from '@/scene/modifiers/types'
import { numberParam, selectParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Simple deform: the four bends of a mesh that need nothing but its own coordinates.
 *
 * All four are one shape of calculation. A vertex is read in the frame of the deformation — the
 * object's own, or an origin object's when one is named — and split into how far it is *along* the
 * axis and where it is *across* it. The along part drives the deformation and the across part is
 * what the deformation moves: twist turns it, bend curls it, taper scales it, stretch pulls the
 * mesh out along the axis and thins the middle of it. Nothing is added or removed, so the counts
 * come out exactly as they went in.
 *
 * Two decisions run through the whole file and are worth stating rather than reading back out of
 * the arithmetic:
 *
 * **The deformation is anchored at the frame's origin, not at the band.** A vertex at the origin
 * does not move, whatever the limits say; a mesh standing on the origin is therefore untouched at
 * its foot and fully deformed at its head, and a mesh centred on the origin is deformed by half as
 * much each way. That is Blender's behaviour, and it is what makes the origin object worth having:
 * moving it moves where the deformation acts from.
 *
 * **The limits are a band along the axis, and what is beyond them is carried rigidly.** A vertex
 * past the top of the band is deformed as though it sat at the top, and the distance it really had
 * beyond it is added back afterwards — turned with the bend, so the far end of a bent mesh leaves
 * along the tangent rather than pointing at where it used to be.
 *
 * Where this differs from Blender, in the two places worth naming: the angle and the factor are
 * divided by the length of the band, so the same number means the same deformation whatever the
 * mesh's size, which is Blender's own normalisation; and stretch measures its pinch across the band
 * rather than from one metre either side of the origin, so a stretched mesh keeps the girth it had
 * at the ends of the band whatever its size — Blender's formula only does that on a mesh two metres
 * long.
 */

const MODES = ['twist', 'bend', 'taper', 'stretch'] as const
const AXES = ['x', 'y', 'z'] as const

type DeformAxis = (typeof AXES)[number]

const AXIS_LABELS = ['X', 'Y', 'Z']

/**
 * The three coordinates in the order the deformation reads them: across, across, along. The two
 * across axes follow the along one in the cycle X → Y → Z, so a twist about Z turns X into Y, which
 * is the direction a positive angle turns in everywhere else in the editor.
 */
const FRAMES: Record<DeformAxis, [number, number, number]> = {
  x: [1, 2, 0],
  y: [2, 0, 1],
  z: [0, 1, 2],
}

/** Below this an angle is no angle: a bend of it would ask for a circle of infinite radius. */
const NO_ANGLE = 1e-6

/** Below this the two limits are at the same place and the band between them cannot be divided by. */
const NO_BAND = 1e-6

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

registerModifier({
  kind: 'simpleDeform',
  label: 'Simple deform',
  category: 'deform',
  description: 'Twist, bend, taper or stretch the mesh along one of its axes.',
  icon: 'modifier-simple-deform',
  defaults: {
    mode: 'twist',
    angle: 45,
    factor: 0.5,
    axis: 'z',
    origin: '',
    limitLow: 0,
    limitHigh: 1,
    lockX: false,
    lockY: false,
  },
  schema: [
    selectParam('mode', 'Mode', [
      { value: 'twist', label: 'Twist' },
      { value: 'bend', label: 'Bend' },
      { value: 'taper', label: 'Taper' },
      { value: 'stretch', label: 'Stretch' },
    ], 'twist'),
    numberParam('angle', 'Angle', { min: -3600, max: 3600, step: 1, defaultValue: 45, unit: '°', view: 'angle' }),
    numberParam('factor', 'Factor', { min: -10, max: 10, step: 0.05, defaultValue: 0.5, view: 'bar' }),
    selectParam('axis', 'Axis', [
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'z', label: 'Z' },
    ], 'z'),
    selectParam('origin', 'Origin', [], ''),
    numberParam('limitLow', 'Limit low', { min: 0, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    numberParam('limitHigh', 'Limit high', { min: 0, max: 1, step: 0.01, defaultValue: 1, view: 'bar' }),
    switchParam('lockX', 'Lock X', false),
    switchParam('lockY', 'Lock Y', false),
  ],
  objectInputs: ['origin'],
  apply: (mesh, params, context) => {
    if (mesh.vertexCount === 0) return 'Simple deform needs vertices to move, and this mesh has none.'
    const mode = chosenOf(params.mode, MODES, 'twist')
    const axis = chosenOf(params.axis, AXES, 'z')
    const [across, sideways, along] = FRAMES[axis]
    // Bend lays the mesh along the axis that follows the one it turns about, so its limits — and
    // the length they are fractions of — are measured along that one instead.
    const measured = mode === 'bend' ? across : along
    const angle = (numberOf(params.angle, 45, -3600, 3600) * Math.PI) / 180
    const factor = numberOf(params.factor, 0.5, -10, 10)
    const lockAcross = switchOf(params.lockX, false)
    const lockSideways = switchOf(params.lockY, false)

    const input = context.inputs.origin ?? null
    const into = input ? invert(input.matrix) : null
    const local: Vec3[] = []
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      const point = mesh.position(slot)
      local.push(into ? applyMatrix(into, point) : point)
    }

    let lowest = Infinity
    let highest = -Infinity
    for (const point of local) {
      lowest = Math.min(lowest, point[measured]!)
      highest = Math.max(highest, point[measured]!)
    }
    const reach = highest - lowest
    if (reach < NO_BAND) return `The mesh has no length along ${AXIS_LABELS[measured]}; deform it about another axis.`

    const asked: [number, number] = [numberOf(params.limitLow, 0, 0, 1), numberOf(params.limitHigh, 1, 0, 1)]
    const low = lowest + reach * Math.min(asked[0], asked[1])
    const high = lowest + reach * Math.max(asked[0], asked[1])
    const band = high - low
    if (band < NO_BAND) return 'The two limits are at the same place; move them apart to leave a band to deform.'
    if ((mode === 'twist' || mode === 'bend') && Math.abs(angle) < NO_ANGLE) return undefined

    const middle = (low + high) / 2
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      const point = local[slot]!
      const a = point[across]!
      const b = point[sideways]!
      const deformed: Vec3 = [point[0], point[1], point[2]]
      if (mode === 'twist') {
        const turn = clamp(point[along]!, low, high) * (angle / band)
        const cosine = Math.cos(turn)
        const sine = Math.sin(turn)
        deformed[across] = a * cosine - b * sine
        deformed[sideways] = a * sine + b * cosine
      } else if (mode === 'bend') {
        // The mesh wraps onto a circle whose radius is what the band needs to cover the angle, so
        // its arc is exactly as long as the mesh was and nothing is stretched by the curving.
        const held = clamp(a, low, high)
        const beyond = a - held
        const turn = held * (angle / band)
        const radius = band / angle
        const cosine = Math.cos(turn)
        const sine = Math.sin(turn)
        deformed[across] = -(b - radius) * sine + cosine * beyond
        deformed[sideways] = (b - radius) * cosine + radius + sine * beyond
      } else if (mode === 'taper') {
        const stretch = 1 + clamp(point[along]!, low, high) * (factor / band)
        deformed[across] = a * stretch
        deformed[sideways] = b * stretch
      } else {
        const held = clamp(point[along]!, low, high)
        // Nought at the middle of the band and one at either end of it, so the ends keep the girth
        // they had and the waist between them is what the factor thins.
        const share = (held - middle) / (band / 2)
        const thin = 1 + factor * (share * share - 1)
        deformed[across] = a * thin
        deformed[sideways] = b * thin
        deformed[along] = held * (1 + factor) + (point[along]! - held)
      }
      if (lockAcross) deformed[across] = a
      if (lockSideways) deformed[sideways] = b
      mesh.setPosition(slot, input ? applyMatrix(input.matrix, deformed) : deformed)
    }
    return undefined
  },
})
