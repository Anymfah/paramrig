import type { EditMesh } from '@/scene/mesh/editMesh'
import {
  chosenOf,
  numberOf,
  registerModifier,
  switchOf,
  wholeOf,
  type ModifierOutcome,
} from '@/scene/modifiers/types'
import { bevelEdgeSet, type BevelParams } from '@/scene/operators/bevel'
import { numberParam, selectParam, switchParam } from '@/scene/operators/types'

/**
 * The Bevel modifier: ⌃B held over the whole mesh instead of over a selection.
 *
 * The geometry is the operator's — `bevelEdgeSet` in `operators/bevel.ts`, the same code the
 * keystroke runs — so a bevel a person tunes in the modifier panel and one they apply by hand open
 * a corner in exactly the same place. What the modifier adds is the *limit*: an operator is told
 * which edges to open by the selection, and a modifier has no selection, so it works them out.
 *
 * — None opens every edge that has a face on each side, which is Blender's own reading of it: an
 *   edge on a rim has nothing to bevel into.
 * — Angle opens the edges that fold further than the limit, which is why a cube at the default 30°
 *   is bevelled all over and at 100° is left alone.
 * — Weight opens the edges carrying a bevel weight, and scales the width by it.
 *
 * The vertex group limit Blender also offers is not here: this build has no vertex groups, and a
 * field that chooses between things that do not exist is worse than one that is missing.
 */

const LIMITS = ['none', 'angle', 'weight'] as const

const DEGREES = Math.PI / 180

const NO_FACES = 'Bevel needs faces to open an edge between; this mesh has none.'
const NO_WIDTH = 'Set a width above zero: a bevel of no width has nothing to open.'
const NOT_MANIFOLD = 'Bevel needs two faces at every edge it opens and a closed ring of faces at every corner, and this mesh has neither everywhere.'

type BevelModifierParams = {
  width: number
  segments: number
  profile: number
  limitMethod: string
  angleLimit: number
  clampOverlap: boolean
  harden: boolean
  materialIndex: number
  markSeams: boolean
  markSharp: boolean
}

/** The modifier's own numbers as the operator's, which is where the two meet. */
function settingsOf(params: BevelModifierParams, width: number): BevelParams {
  return {
    width,
    segments: wholeOf(params.segments, 1, 1, 32),
    profile: numberOf(params.profile, 0.5, 0, 1),
    affect: 'edges',
    clampOverlap: switchOf(params.clampOverlap, true),
    offsetType: 'offset',
    miterOuter: 'sharp',
    miterInner: 'sharp',
    markSeam: switchOf(params.markSeams, false),
    markSharp: switchOf(params.markSharp, false),
    material: wholeOf(params.materialIndex, -1, -1, 32),
    harden: switchOf(params.harden, false),
  }
}

/** Every edge with a face on each side: the most a bevel can ever open. */
function interiorEdges(mesh: EditMesh): number[] {
  const edges: number[] = []
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) if (mesh.edgeFaces(edge).length === 2) edges.push(edge)
  return edges
}

/**
 * The weight limit, one width at a time.
 *
 * Blender opens every weighted edge in a single pass, each at its own width. This opens one group
 * of equal weights at a time, widest first, because the operator carries one width for the whole
 * call. A mesh whose weights are all the same — which is what a bevel weight is nearly always used
 * for — comes out identical; a mesh with two different weights meeting at one corner does not,
 * since the second pass runs over what the first already opened.
 */
function bevelByWeight(mesh: EditMesh, params: BevelParams): ModifierOutcome {
  const groups = new Map<number, Array<[number, number]>>()
  for (const edge of interiorEdges(mesh)) {
    const weight = mesh.edgeNumber(edge, 'bevelWeight')
    if (weight <= 0) continue
    // Grouped on a rounded weight: two edges a person set to the same value have to be one pass,
    // and a slider writes them to the last bit rather than to the same float.
    const key = Math.round(weight * 1e6) / 1e6
    const [a, b] = mesh.edgeVertices(edge)
    const group = groups.get(key) ?? []
    group.push([mesh.vertexId(a), mesh.vertexId(b)])
    groups.set(key, group)
  }
  if (groups.size === 0) return undefined
  for (const weight of [...groups.keys()].sort((one, other) => other - one)) {
    const edges: number[] = []
    // By the ids of its ends: an earlier pass renumbered every slot this group was found under.
    for (const [first, second] of groups.get(weight) ?? []) {
      const a = mesh.slotOfVertex(first)
      const b = mesh.slotOfVertex(second)
      if (a < 0 || b < 0) continue
      const edge = mesh.edgeSlot(a, b)
      if (edge >= 0 && mesh.edgeFaces(edge).length === 2) edges.push(edge)
    }
    if (edges.length === 0) continue
    if (typeof bevelEdgeSet(mesh, edges, { ...params, width: params.width * weight }) === 'string') return NOT_MANIFOLD
  }
  return undefined
}

registerModifier<BevelModifierParams>({
  kind: 'bevel',
  label: 'Bevel',
  category: 'generate',
  description: 'Open the edges a limit picks out into strips of faces along a profile.',
  icon: 'bevel',
  defaults: {
    width: 0.1,
    segments: 1,
    profile: 0.5,
    limitMethod: 'angle',
    angleLimit: 30,
    clampOverlap: true,
    harden: false,
    materialIndex: -1,
    markSeams: false,
    markSharp: false,
  },
  schema: [
    numberParam('width', 'Amount', { min: 0, max: 1000, step: 0.01, defaultValue: 0.1, unit: 'm' }),
    numberParam('segments', 'Segments', { min: 1, max: 32, step: 1, defaultValue: 1, view: 'stepper' }),
    numberParam('profile', 'Shape', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' }),
    selectParam('limitMethod', 'Limit method', [
      { value: 'none', label: 'None' },
      { value: 'angle', label: 'Angle' },
      { value: 'weight', label: 'Weight' },
    ], 'angle'),
    numberParam('angleLimit', 'Angle', { min: 0, max: 180, step: 1, defaultValue: 30, unit: '°', view: 'angle' }),
    switchParam('clampOverlap', 'Clamp overlap', true),
    switchParam('harden', 'Harden normals', false),
    numberParam('materialIndex', 'Material index', { min: -1, max: 32, step: 1, defaultValue: -1, view: 'stepper' }),
    switchParam('markSeams', 'Mark seams', false),
    switchParam('markSharp', 'Mark sharp', false),
  ],
  apply: (mesh, params) => {
    if (mesh.faceCount === 0) return NO_FACES
    const width = numberOf(params.width, 0.1, 0, 1000)
    if (width <= 0) return NO_WIDTH
    const settings = settingsOf(params, width)
    const limit = chosenOf(params.limitMethod, LIMITS, 'angle')
    if (limit === 'weight') return bevelByWeight(mesh, settings)
    const fold = numberOf(params.angleLimit, 30, 0, 180) * DEGREES
    const wanted = limit === 'none'
      ? interiorEdges(mesh)
      : interiorEdges(mesh).filter((edge) => mesh.dihedral(edge) > fold)
    // A limit that picks nothing out is not an error: it is a mesh with no corner sharp enough,
    // and the stack hands the mesh on as it stands.
    if (wanted.length === 0) return undefined
    return typeof bevelEdgeSet(mesh, wanted, settings) === 'string' ? NOT_MANIFOLD : undefined
  },
})
