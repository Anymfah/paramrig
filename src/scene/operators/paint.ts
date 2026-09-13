import { meshOf, withMesh } from '@/scene/model'
import { colourDomain } from '@/scene/paint/attribute'
import { PaintSession, DEFAULT_PAINT_STATE, rgbOf } from '@/scene/paint/session'
import { registerOperator } from '@/scene/operators/registry'
import { colorParam, switchParam, type OperatorContext, type OperatorResult } from '@/scene/operators/types'
import type { PaintState, SceneObject } from '@/scene/types'

/**
 * Vertex paint's operators: the ones that act on the whole mesh rather than under the brush.
 *
 * A stroke is not one of these — it is a gesture, and it lives in `paintTool` with the pointer.
 * What is here is Blender's Paint menu: fill the lot, smooth the lot, and take the colour off
 * again, each one step of history and each refusing out loud when there is nothing to act on.
 */

function target(context: OperatorContext): SceneObject | null {
  const id = context.selection.activeObjectId
  const object = context.document.objects.find((candidate) => candidate.id === id)
  return object?.data.kind === 'mesh' ? object : null
}

function paintState(context: OperatorContext): PaintState {
  return context.document.view.paint ?? DEFAULT_PAINT_STATE
}

function requirePaint(context: OperatorContext) {
  if (context.mode !== 'vertex-paint') return 'This works in vertex paint mode.'
  return target(context) ? true : 'Select a mesh to paint first.'
}

registerOperator({
  id: 'paint.fill',
  label: 'Fill colour',
  section: 'Paint',
  shortcut: '⇧K',
  icon: 'sculpt-fill',
  description: 'Set every value of the colour attribute to the brush colour.',
  params: [colorParam('colour', 'Colour', DEFAULT_PAINT_STATE.colour)],
  defaults: { colour: DEFAULT_PAINT_STATE.colour },
  mode: 'vertex-paint',
  available: requirePaint,
  run: (context, params): OperatorResult => {
    const object = target(context)
    if (!object || object.data.kind !== 'mesh') return { error: 'Select a mesh to paint first.' }
    const mesh = meshOf(context.document, object)
    if (!mesh) return { error: 'Select a mesh to paint first.' }
    const state = paintState(context)
    const session = new PaintSession(mesh, colourDomain(mesh) ?? state.domain)
    session.fill(rgbOf(typeof params.colour === 'string' ? params.colour : state.colour))
    return { document: withMesh(context.document, object.data.meshId, session.toMeshData()), label: 'Fill colour' }
  },
})

registerOperator({
  id: 'paint.smooth',
  label: 'Smooth colours',
  section: 'Paint',
  icon: 'sculpt-smooth',
  description: 'Pull every value towards the average of its neighbours, once over the whole mesh.',
  params: [switchParam('twice', 'Twice', false)],
  defaults: { twice: false },
  mode: 'vertex-paint',
  available: requirePaint,
  run: (context, params): OperatorResult => {
    const object = target(context)
    if (!object || object.data.kind !== 'mesh') return { error: 'Select a mesh to paint first.' }
    const mesh = meshOf(context.document, object)
    if (!mesh) return { error: 'Select a mesh to paint first.' }
    if (!colourDomain(mesh)) return { error: 'This mesh carries no colour yet: paint on it, or fill it first.' }
    const session = new PaintSession(mesh, colourDomain(mesh) ?? paintState(context).domain)
    /*
     * A pass over the whole mesh rather than a dab: the radius is made larger than anything the
     * mesh can be, so every value is inside the brush and every one is averaged with its
     * neighbours. It is the cheapest honest way to say "everywhere".
     */
    const passes = params.twice ? 2 : 1
    for (let pass = 0; pass < passes; pass += 1) {
      session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, {
        colour: [1, 1, 1],
        radius: Number.MAX_SAFE_INTEGER,
        strength: 1,
        falloff: 'constant',
        blend: 'mix',
        smoothing: true,
        symmetry: { x: false, y: false, z: false },
      })
    }
    return { document: withMesh(context.document, object.data.meshId, session.toMeshData()), label: 'Smooth colours' }
  },
})

registerOperator({
  id: 'paint.clear',
  label: 'Remove colour',
  section: 'Paint',
  icon: 'sculpt-mask',
  description: 'Take the colour attribute off the mesh, leaving the material to say what colour it is.',
  params: [],
  defaults: {},
  mode: 'vertex-paint',
  available: (context) => {
    const availability = requirePaint(context)
    if (availability !== true) return availability
    const object = target(context)
    const mesh = object ? meshOf(context.document, object) : null
    return mesh && colourDomain(mesh) ? true : 'This mesh carries no colour to remove.'
  },
  run: (context): OperatorResult => {
    const object = target(context)
    if (!object || object.data.kind !== 'mesh') return { error: 'Select a mesh to paint first.' }
    const mesh = meshOf(context.document, object)
    if (!mesh) return { error: 'Select a mesh to paint first.' }
    const attributes = {
      ...mesh.attributes,
      vertex: { ...mesh.attributes.vertex },
      loop: { ...mesh.attributes.loop },
    }
    delete attributes.vertex.color
    delete attributes.loop.color
    return {
      document: withMesh(context.document, object.data.meshId, { ...mesh, attributes }),
      label: 'Remove colour',
    }
  },
})
