import type { EditMesh } from '@/scene/mesh/editMesh'
import { applyMatrix } from '@/scene/modifiers/matrix'
import { chosenOf, numberOf, defineModifier, switchOf } from '@/scene/modifiers/types'
import { numberParam, selectParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Cast: every vertex part of the way towards where it would be on a sphere, a cylinder or a box.
 *
 * One rule runs through all three shapes. A vertex is read as an offset from the centre; the shape
 * says where that offset lands on it; the vertex is then blended by `factor` from where it is to
 * where that is, on the axes that are switched on. Nothing is added or removed, so a cast is a pure
 * deformation and the counts survive it.
 *
 * Two of Blender's parameters read alike and do not mean the same thing, so they are named here as
 * they behave. **Radius** is a limit: only the vertices within it of the centre are touched at all,
 * and zero means every vertex. **Size** is how big the shape being cast onto is, and zero means
 * "take it from the mesh" — the average distance of the vertices from the centre for a sphere, the
 * average distance from the axis for a cylinder, the mesh's own half-extents for a box. `Size from
 * radius` uses the radius for both, which is how one number gives a shape that fits what it limits.
 *
 * The centre is the object's own origin unless an object is named, in which case it is that
 * object's place. Blender can also take that object's rotation and scale, which this does not: the
 * cylinder's axis and the box's sides stay the mesh's own Z, X and Y.
 */

const CAST_TYPES = ['sphere', 'cylinder', 'cuboid'] as const

type CastType = (typeof CAST_TYPES)[number]

/** Below this a vertex sits on the centre — or on the axis, for a cylinder — and has no direction to be cast along. */
const TOO_CLOSE = 1e-12

/** How far a vertex counts as being from the centre, measured the way the shape is measured. */
function reachOf(type: CastType, offset: Vec3): number {
  if (type === 'cylinder') return Math.hypot(offset[0], offset[1])
  return Math.hypot(offset[0], offset[1], offset[2])
}

/**
 * The size to cast onto when none was asked for: the mesh's own, in the terms of the shape. A
 * sphere and a cylinder take the average of the offsets, as Blender does, so that a cast of factor
 * 1 lands on the shape the mesh already suggests rather than on one it has to grow into; a box
 * takes the largest offset on each axis, which is the smallest box the mesh fits in.
 */
function meshSize(type: CastType, offsets: Vec3[]): Vec3 {
  if (type === 'cuboid') {
    const half: Vec3 = [0, 0, 0]
    for (const offset of offsets) {
      for (let axis = 0; axis < 3; axis += 1) half[axis] = Math.max(half[axis]!, Math.abs(offset[axis]!))
    }
    return half
  }
  let total = 0
  for (const offset of offsets) total += reachOf(type, offset)
  const average = offsets.length === 0 ? 0 : total / offsets.length
  return [average, average, average]
}

/** Where an offset from the centre lands on the shape, or null when it has no direction to land along. */
function castOffset(type: CastType, offset: Vec3, size: Vec3): Vec3 | null {
  if (type === 'sphere') {
    const reach = Math.hypot(offset[0], offset[1], offset[2])
    if (reach < TOO_CLOSE) return null
    const stretch = size[0]! / reach
    return [offset[0] * stretch, offset[1] * stretch, offset[2] * stretch]
  }
  if (type === 'cylinder') {
    // The height is the vertex's own: a cylinder is a circle in X and Y and nothing at all in Z.
    const reach = Math.hypot(offset[0], offset[1])
    if (reach < TOO_CLOSE) return null
    const stretch = size[0]! / reach
    return [offset[0] * stretch, offset[1] * stretch, offset[2]]
  }
  // The box: the axis that reaches its side first decides how far the whole offset is stretched,
  // which puts the vertex on that side and leaves the direction it was seen from alone.
  let dominant = 0
  for (let axis = 0; axis < 3; axis += 1) {
    const half = size[axis]!
    const share = half < TOO_CLOSE ? (Math.abs(offset[axis]!) < TOO_CLOSE ? 0 : Infinity) : Math.abs(offset[axis]!) / half
    dominant = Math.max(dominant, share)
  }
  if (dominant < TOO_CLOSE || !Number.isFinite(dominant)) return null
  return [offset[0] / dominant, offset[1] / dominant, offset[2] / dominant]
}

/** Every vertex as an offset from the centre, in the order of the slots. */
function offsetsFrom(mesh: EditMesh, centre: Vec3): Vec3[] {
  const offsets: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    offsets.push([point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]])
  }
  return offsets
}

export const castModifier = defineModifier({
  kind: 'cast',
  label: 'Cast',
  category: 'deform',
  description: 'Blend the mesh towards a sphere, a cylinder or a box about its centre.',
  defaults: {
    castType: 'sphere',
    factor: 0.5,
    radius: 0,
    size: 0,
    useRadiusAsSize: false,
    axisX: true,
    axisY: true,
    axisZ: true,
    object: '',
  },
  schema: [
    selectParam('castType', 'Shape', [
      { value: 'sphere', label: 'Sphere' },
      { value: 'cylinder', label: 'Cylinder' },
      { value: 'cuboid', label: 'Cuboid' },
    ], 'sphere'),
    numberParam('factor', 'Factor', { min: -10, max: 10, step: 0.05, defaultValue: 0.5, view: 'bar' }),
    numberParam('radius', 'Radius', { min: 0, max: 1000, step: 0.01, defaultValue: 0, unit: 'm' }),
    numberParam('size', 'Size', { min: 0, max: 1000, step: 0.01, defaultValue: 0, unit: 'm' }),
    switchParam('useRadiusAsSize', 'Size from radius', false),
    switchParam('axisX', 'X', true),
    switchParam('axisY', 'Y', true),
    switchParam('axisZ', 'Z', true),
    selectParam('object', 'Object', [], ''),
  ],
  objectInputs: ['object'],
  apply: (mesh, params, context) => {
    const axes: [boolean, boolean, boolean] = [
      switchOf(params.axisX, true),
      switchOf(params.axisY, true),
      switchOf(params.axisZ, true),
    ]
    if (!axes[0] && !axes[1] && !axes[2]) return 'Leave at least one axis on, or nothing can move.'
    if (mesh.vertexCount === 0) return 'Cast needs vertices to move, and this mesh has none.'
    const type = chosenOf(params.castType, CAST_TYPES, 'sphere')
    const factor = numberOf(params.factor, 0.5, -10, 10)
    const radius = numberOf(params.radius, 0, 0, 1e6)
    const input = context.inputs.object ?? null
    const centre: Vec3 = input ? applyMatrix(input.matrix, [0, 0, 0]) : [0, 0, 0]
    const offsets = offsetsFrom(mesh, centre)
    const asked = switchOf(params.useRadiusAsSize, false) ? radius : numberOf(params.size, 0, 0, 1e6)
    const size: Vec3 = asked > 0 ? [asked, asked, asked] : meshSize(type, offsets)
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      const offset = offsets[slot]!
      // The limit is read in the shape's own terms too, so a radius around a cylinder is a distance
      // from its axis rather than from a point on it.
      if (radius > 0 && reachOf(type, offset) > radius) continue
      const landed = castOffset(type, offset, size)
      if (!landed) continue
      const here = mesh.position(slot)
      mesh.setPosition(slot, [
        axes[0] ? here[0] + (centre[0] + landed[0] - here[0]) * factor : here[0],
        axes[1] ? here[1] + (centre[1] + landed[1] - here[1]) * factor : here[1],
        axes[2] ? here[2] + (centre[2] + landed[2] - here[2]) * factor : here[2],
      ])
    }
    return undefined
  },
})
