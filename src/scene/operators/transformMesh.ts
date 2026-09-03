import { cameraBasis } from '@/scene/viewport/view'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam, type OperatorContext } from '@/scene/operators/types'
import {
  edgeSlideRails,
  pushPull,
  shear,
  shrinkFatten,
  slidePositions,
  toSphere,
  vertexSlide,
} from '@/scene/transform/slide'
import type { Vec3 } from '@/scene/types'

/**
 * The transforms that are about a mesh rather than about space.
 *
 * G, R and S move a selection anywhere; these move it somewhere particular — along its own edges,
 * along its own normals, onto a sphere of its own. Each is modal in the viewport and each is a
 * complete function of its parameters here, which is what lets the F9 panel replay one with a
 * number typed in rather than dragged.
 */

/** Writes new positions for some vertices and keeps the selection exactly as it was. */
function moved(target: EditTarget, points: Map<number, Vec3>): EditOutcome {
  if (points.size === 0) return 'Nothing here could be moved that way.'
  for (const [slot, point] of points) target.mesh.setPosition(slot, point)
  return {}
}

type SlideParams = { factor: number; even: boolean; flipped: boolean; clamp: boolean }

registerOperator<SlideParams>({
  id: 'mesh.edgeSlide',
  label: 'Edge slide',
  section: 'Edge',
  shortcut: 'G G',
  description: 'Slide the selected edges along the ones they cross, keeping them on the surface.',
  params: [
    numberParam('factor', 'Factor', { min: -1, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    switchParam('even', 'Even', false),
    switchParam('flipped', 'Flipped', false),
    switchParam('clamp', 'Clamp', true),
  ],
  defaults: { factor: 0, even: false, flipped: false, clamp: true },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context, params) => runOnMeshes(context, (target) => {
    if (target.edges.size === 0) return null
    const rails = edgeSlideRails(target.mesh, target.edges)
    if (typeof rails === 'string') return rails
    const points = slidePositions(rails, params.factor, {
      even: params.even,
      flipped: params.flipped,
      clamp: params.clamp,
    })
    return moved(target, points)
  }, { label: 'Edge slide' }),
})

type VertexSlideParams = { factor: number; edge: number; clamp: boolean }

registerOperator<VertexSlideParams>({
  id: 'mesh.vertexSlide',
  label: 'Vertex slide',
  section: 'Vertex',
  shortcut: '⇧V',
  description: 'Slide a vertex along one of the edges that meet at it.',
  params: [
    numberParam('factor', 'Factor', { min: 0, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    numberParam('edge', 'Edge', { min: -1, max: 1e9, step: 1, defaultValue: -1, view: 'stepper' }),
    switchParam('clamp', 'Clamp', true),
  ],
  defaults: { factor: 0, edge: -1, clamp: true },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const chosen = [...target.vertices]
    if (chosen.length !== 1) return 'Vertex slide works on one vertex at a time.'
    const slot = chosen[0]!
    const edge = params.edge >= 0 && target.mesh.hasEdge(params.edge)
      ? params.edge
      : target.mesh.vertexEdges(slot)[0] ?? -1
    const point = vertexSlide(target.mesh, slot, edge, params.factor, params.clamp)
    if (!point) return 'That vertex has no edge to slide along.'
    target.mesh.setPosition(slot, point)
    return {}
  }, { label: 'Vertex slide' }),
})

type ShrinkParams = { offset: number; even: boolean }

registerOperator<ShrinkParams>({
  id: 'mesh.shrinkFatten',
  label: 'Shrink or fatten',
  section: 'Mesh',
  shortcut: '⌥S',
  description: 'Move the selection along its own normals, so a shell keeps its thickness.',
  params: [
    numberParam('offset', 'Offset', { min: -100, max: 100, step: 0.01, defaultValue: 0, unit: 'm' }),
    switchParam('even', 'Even thickness', true),
  ],
  defaults: { offset: 0, even: true },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => (
    moved(target, shrinkFatten(target.mesh, selectedVertices(target), params.offset, params.even))
  ), { label: 'Shrink or fatten' }),
})

type SphereParams = { factor: number }

registerOperator<SphereParams>({
  id: 'mesh.toSphere',
  label: 'To sphere',
  section: 'Mesh',
  shortcut: '⇧⌥S',
  description: 'Round the selection towards the sphere through its own middle.',
  params: [numberParam('factor', 'Factor', { min: 0, max: 1, step: 0.01, defaultValue: 0, view: 'bar' })],
  defaults: { factor: 0 },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => (
    moved(target, toSphere(target.mesh, selectedVertices(target), params.factor))
  ), { label: 'To sphere' }),
})

type ShearParams = { offset: number }

/** The two axes of a shear come from the view: across the screen, and up it. */
function viewAxes(context: OperatorContext): { along: Vec3; across: Vec3 } {
  const basis = cameraBasis(context.view.yaw, context.view.pitch)
  return { along: basis.right, across: basis.up }
}

registerOperator<ShearParams>({
  id: 'mesh.shear',
  label: 'Shear',
  section: 'Mesh',
  shortcut: '⇧⌃⌥S',
  description: 'Lean the selection, each vertex moving in proportion to how far up the view it is.',
  params: [numberParam('offset', 'Offset', { min: -10, max: 10, step: 0.01, defaultValue: 0 })],
  defaults: { offset: 0 },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => {
    const axes = viewAxes(context)
    return runOnMeshes(context, (target) => (
      moved(target, shear(target.mesh, selectedVertices(target), axes.along, axes.across, params.offset))
    ), { label: 'Shear' })
  },
})

type PushParams = { offset: number }

registerOperator<PushParams>({
  id: 'mesh.pushPull',
  label: 'Push or pull',
  section: 'Mesh',
  description: 'Swell or shrink the selection about its own middle.',
  params: [numberParam('offset', 'Distance', { min: -100, max: 100, step: 0.01, defaultValue: 0, unit: 'm' })],
  defaults: { offset: 0 },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => (
    moved(target, pushPull(target.mesh, selectedVertices(target), params.offset))
  ), { label: 'Push or pull' }),
})
