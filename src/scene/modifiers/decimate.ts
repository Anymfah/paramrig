import type { EditMesh } from '@/scene/mesh/editMesh'
import { dot, normalize, subtract } from '@/scene/mesh/normals'
import {
  chosenOf,
  numberOf,
  defineModifier,
  switchOf,
  wholeOf,
  type ModifierOutcome,
} from '@/scene/modifiers/types'
import { decimateMesh } from '@/scene/operators/cleanup'
import { unsubdivideOnce } from '@/scene/operators/subdivide'
import { numberParam, selectParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * The Decimate modifier: fewer faces for the same shape, three ways, as Blender groups them.
 *
 * — **Collapse** is the operator's own quadric walk (`decimateMesh` in `operators/cleanup.ts`):
 *   the mesh is cut into triangles and the cheapest edge is pulled to a point until the ratio of
 *   faces is reached. It inherits that operator's approximation — the survivor lands at the
 *   midpoint of the edge rather than at the position that minimises the error — so the count is
 *   Blender's and the surface is a little worse.
 * — **Planar** merges the faces that lie flat against each other: every edge folding less than the
 *   angle is dissolved, and then the vertices that were holding nothing but a straight run go too,
 *   which is what turns a subdivided plane back into one face rather than into one face with a
 *   dozen corners on its rim.
 * — **Un-subdivide** is the operator's own (`unsubdivideOnce` in `operators/subdivide.ts`), one
 *   level per iteration.
 *
 * None of the three treats “there was nothing to do” as an error: a mesh already flat enough, or
 * already at the ratio, carries on down the stack untouched. Only a mesh with no faces at all is
 * refused, because there is no reading of decimate that does anything to a wire.
 */

const MODES = ['collapse', 'planar', 'unsubdivide'] as const
const AXES = ['x', 'y', 'z'] as const

const DEGREES = Math.PI / 180

const NO_FACES = 'Decimate needs faces; this mesh has none.'

type DecimateModifierParams = {
  mode: string
  ratio: number
  angleLimit: number
  iterations: number
  symmetry: boolean
  symmetryAxis: string
  triangulate: boolean
}

/**
 * The chosen axis swapped into X, because the operator's symmetric collapse pairs each edge with
 * its mirror about x = 0 and nothing else. Swapping two coordinates is a reflection, which the
 * collapse does not mind: it reads the quadrics, which are squared distances, and compares each
 * face's winding against its own before and after. The swap is its own inverse, so the same call
 * puts the mesh back.
 */
function swapAxis(mesh: EditMesh, axis: (typeof AXES)[number]): void {
  if (axis === 'x') return
  const other = axis === 'y' ? 1 : 2
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    const swapped: Vec3 = [point[0], point[1], point[2]]
    swapped[0] = point[other]!
    swapped[other] = point[0]
    mesh.setPosition(slot, swapped)
  }
}

/** Whether the two edges at a vertex carry on in the same direction, to within `limit` radians. */
function isStraight(mesh: EditMesh, vertex: number, limit: number): boolean {
  const edges = mesh.vertexEdges(vertex)
  if (edges.length !== 2) return false
  const here = mesh.position(vertex)
  const directions = edges.map((edge) => {
    const [a, b] = mesh.edgeVertices(edge)
    return normalize(subtract(mesh.position(a === vertex ? b : a), here))
  })
  const first = directions[0]
  const second = directions[1]
  if (!first || !second) return false
  return dot(first, second) <= -Math.cos(limit)
}

/**
 * Planar: the flat edges dissolved, then the vertices they left behind.
 *
 * A vertex that was inside the patch loses every edge it had and is deleted; one on the rim of the
 * patch keeps two, and is taken out of the loop when what it holds is a straight run. Both are
 * followed by id rather than by slot, since each dissolve renumbers everything under them.
 */
function dissolveFlat(mesh: EditMesh, limit: number): ModifierOutcome {
  const flat: number[] = []
  const watched = new Set<number>()
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    if (mesh.edgeFaces(edge).length !== 2 || mesh.dihedral(edge) > limit) continue
    flat.push(edge)
    for (const end of mesh.edgeVertices(edge)) watched.add(mesh.vertexId(end))
  }
  if (flat.length === 0) return undefined
  if (mesh.dissolveEdges(flat).dissolved === 0) return undefined
  for (const id of watched) {
    const slot = mesh.slotOfVertex(id)
    if (slot < 0) continue
    if (mesh.vertexEdges(slot).length === 0 && mesh.vertexFaces(slot).length === 0) {
      mesh.remove({ vertices: [slot] })
      continue
    }
    if (isStraight(mesh, slot, limit)) mesh.dissolveVertices([slot])
  }
  return undefined
}

export const decimateModifier = defineModifier<DecimateModifierParams>({
  kind: 'decimate',
  label: 'Decimate',
  category: 'generate',
  description: 'Bring the face count down by collapsing edges, merging flat faces or taking a level of subdivision off.',
  icon: 'modifier-decimate',
  defaults: {
    mode: 'collapse',
    ratio: 1,
    angleLimit: 5,
    iterations: 1,
    symmetry: false,
    symmetryAxis: 'x',
    triangulate: true,
  },
  schema: [
    selectParam('mode', 'Mode', [
      { value: 'collapse', label: 'Collapse' },
      { value: 'planar', label: 'Planar' },
      { value: 'unsubdivide', label: 'Un-subdivide' },
    ], 'collapse'),
    numberParam('ratio', 'Ratio', { min: 0, max: 1, step: 0.01, defaultValue: 1, view: 'bar' }),
    numberParam('angleLimit', 'Angle limit', { min: 0, max: 180, step: 1, defaultValue: 5, unit: '°', view: 'angle' }),
    numberParam('iterations', 'Iterations', { min: 1, max: 8, step: 1, defaultValue: 1, view: 'stepper' }),
    switchParam('symmetry', 'Symmetry', false),
    selectParam('symmetryAxis', 'Axis', [
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'z', label: 'Z' },
    ], 'x'),
    switchParam('triangulate', 'Triangulate', true),
  ],
  apply: (mesh, params) => {
    if (mesh.faceCount === 0) return NO_FACES
    const mode = chosenOf(params.mode, MODES, 'collapse')
    if (mode === 'planar') return dissolveFlat(mesh, numberOf(params.angleLimit, 5, 0, 180) * DEGREES)
    if (mode === 'unsubdivide') {
      const rounds = wholeOf(params.iterations, 1, 1, 8)
      for (let round = 0; round < rounds; round += 1) if (!unsubdivideOnce(mesh)) break
      return undefined
    }
    const ratio = numberOf(params.ratio, 1, 0, 1)
    if (ratio >= 1) return undefined
    const axis = chosenOf(params.symmetryAxis, AXES, 'x')
    const symmetry = switchOf(params.symmetry, false)
    if (symmetry) swapAxis(mesh, axis)
    // A walk that runs out of legal collapses has done what it could, which is a coarser mesh and
    // not a refusal; the operator says so in a sentence meant for the status bar, and it is dropped.
    decimateMesh(mesh, { ratio, symmetry, triangulate: switchOf(params.triangulate, true) })
    if (symmetry) swapAxis(mesh, axis)
    return undefined
  },
})
