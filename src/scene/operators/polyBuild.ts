import { requireEdit, runOnMeshes } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, selectParam, vectorParam } from '@/scene/operators/types'
import type { SelectMode, Vec3 } from '@/scene/types'

/**
 * Poly build: making a surface a face at a time.
 *
 * It is the retopology tool, and the whole of it is four verbs on whatever the pointer is over. A
 * click on a border edge pulls a face out of it towards the pointer; a click on nothing puts a
 * vertex there; shift takes an element away; control dissolves it into its neighbours. Blender's
 * own version also drags a *quad* out of an edge by moving the two new corners independently — that
 * needs two points and this takes one, so what comes out here is the triangle between the edge and
 * where the pointer was. It is written down rather than glossed over.
 *
 * The point arrives in the mesh's own space. A mesh operator may not import three.js — these are
 * tested without a renderer — so the viewport, which is the only thing holding a camera, converts
 * before it calls.
 */

type PolyBuildParams = {
  action: string
  kind: string
  slot: number
  point: Vec3
}

const ACTIONS = [
  { value: 'extend', label: 'Extend' },
  { value: 'add', label: 'Add a vertex' },
  { value: 'delete', label: 'Delete' },
  { value: 'dissolve', label: 'Dissolve' },
]

const KINDS = [
  { value: 'vertex', label: 'Vertex' },
  { value: 'edge', label: 'Edge' },
  { value: 'face', label: 'Face' },
  { value: 'none', label: 'Nothing' },
]

registerOperator<PolyBuildParams>({
  id: 'mesh.polyBuild',
  label: 'Poly build',
  section: 'Mesh',
  icon: 'poly-build',
  description: 'Build a surface a face at a time: pull one out of a border edge, or place a vertex.',
  params: [
    selectParam('action', 'Action', ACTIONS, 'extend'),
    selectParam('kind', 'Under the pointer', KINDS, 'none'),
    numberParam('slot', 'Element', { min: -1, max: 1e9, step: 1, defaultValue: -1, view: 'stepper' }),
    vectorParam('point', 'Point', { defaultValue: [0, 0, 0], unit: 'm' }),
  ],
  defaults: { action: 'extend', kind: 'none', slot: -1, point: [0, 0, 0] },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(context, (target) => {
    if (target.object.id !== context.selection.activeObjectId) return null
    const mesh = target.mesh
    const kind = params.kind as SelectMode | 'none'
    const slot = Math.round(Number(params.slot))
    const point = params.point

    if (params.action === 'add') {
      const added = mesh.addVertex(point)
      return { select: { vertices: [added] }, active: { kind: 'vertex', slot: added } }
    }

    if (params.action === 'delete' || params.action === 'dissolve') {
      if (kind === 'none' || slot < 0) return 'Put the pointer over something to take away.'
      if (params.action === 'delete') {
        if (kind === 'vertex') mesh.remove({ vertices: [slot] })
        else if (kind === 'edge') mesh.remove({ edges: [slot] })
        else mesh.remove({ faces: [slot] })
        return { select: {}, active: null }
      }
      const outcome = kind === 'vertex'
        ? mesh.dissolveVertices([slot])
        : kind === 'edge' ? mesh.dissolveEdges([slot]) : mesh.dissolveFaces([slot])
      if (outcome.dissolved === 0) return 'That cannot be dissolved into what is around it.'
      return { select: {}, active: null }
    }

    /* extend */
    if (kind === 'edge') {
      if (!mesh.hasEdge(slot)) return 'That edge is no longer there.'
      if (!mesh.isBoundaryEdge(slot) && mesh.edgeFaces(slot).length > 0) {
        return 'Poly build pulls a face out of a border edge; this one already has faces on both sides.'
      }
      const [a, b] = mesh.edgeVertices(slot)
      const tip = mesh.addVertex(point)
      /*
       * The corners are taken in the order that leaves the new face wound like the one already on
       * the edge, so a surface built this way faces the same way all over.
       */
      const neighbour = mesh.edgeFaces(slot)[0]
      const loop = neighbour === undefined ? [a, b, tip] : orientedLoop(mesh.faceVertices(neighbour), a, b, tip)
      const face = mesh.addFace(loop)
      if (face < 0) return 'That would not make a face.'
      if (neighbour !== undefined) mesh.copyFaceAttributes(neighbour, face)
      return { select: { faces: [face], vertices: [tip] }, active: { kind: 'face', slot: face } }
    }

    if (kind === 'vertex') {
      if (!mesh.hasVertex(slot)) return 'That vertex is no longer there.'
      const tip = mesh.addVertex(point)
      const edge = mesh.addEdge(slot, tip)
      if (edge < 0) return 'That would not make an edge.'
      return { select: { vertices: [tip], edges: [edge] }, active: { kind: 'vertex', slot: tip } }
    }

    const added = mesh.addVertex(point)
    return { select: { vertices: [added] }, active: { kind: 'vertex', slot: added } }
  }, { label: 'Poly build' }),
})

/**
 * The new face's corners, wound against the face already on the edge.
 *
 * Two faces on one edge agree when they traverse it in opposite directions. The neighbour is read
 * for which way it goes, and the new one is given the other.
 */
function orientedLoop(neighbour: number[], a: number, b: number, tip: number): number[] {
  const at = neighbour.indexOf(a)
  const forward = at >= 0 && neighbour[(at + 1) % neighbour.length] === b
  return forward ? [b, a, tip] : [a, b, tip]
}
