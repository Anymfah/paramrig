import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, dot, length, newellNormal, scale, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { bandBetween, fillableEdges, lerp3, loopsOf, pairRims } from '@/scene/operators/fill'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Joining two rims: bridge edge loops, and welding loose edges into the faces they cross.
 *
 * A bridge is the band of quads that fill.ts already knows how to lay; everything here is about the
 * shape of it. Two rims are paired on their closest vertices, walked in opposite directions so each
 * face runs both of its rim edges the way that rim is wound, and the rings in between leave each rim
 * along that rim's own direction rather than cutting straight across — which is what smoothness
 * means, and why a bridge between two ends of a tube comes out as a bend and not as a wedge.
 *
 * `profile` and `mergeFactor` are read against Blender's own: the first swells the intermediate
 * rings away from the axis, the second decides where between the rims those rings sit. Neither is
 * Blender's arithmetic — that is written down here rather than implied.
 */

/** Below this a length is rounding noise rather than a distance. */
const NEARLY_ZERO = 1e-9

const NEEDS_TWO = 'Select two rims of edges to bridge.'
const UNEQUAL = 'The two rims must have the same number of edges.'

type BridgeParams = {
  cuts: number
  smoothness: number
  profile: number
  twist: number
  mergeFactor: number
  loopPairs: boolean
}

/* ------------------------------------------------------------ the profile */

/** The Hermite weights of the two end tangents. Both are zero at t = 0 and t = 1: the rims do not move. */
function leavingWeight(t: number): number {
  return t * t * t - 2 * t * t + t
}

function arrivingWeight(t: number): number {
  return t * t * t - t * t
}

/**
 * Where the rings sit between the rims. 0.5 spaces them evenly, and anything else pulls them
 * towards one rim — Blender's merge factor decides the same thing, though it reaches it by welding
 * the two rims together rather than by moving the rings.
 */
function biased(t: number, factor: number): number {
  const balance = Math.min(1, Math.max(0, factor))
  return t <= 0.5 ? t * 2 * balance : balance + (t - 0.5) * 2 * (1 - balance)
}

/**
 * The direction a rim's own surface faces, which is the direction the bridge has to leave it in.
 *
 * A rim wound for filling faces away from the mesh it belongs to, so its own normal is the way out
 * of it — the top of a tube points upwards, the underside of a lid points downwards. A rim of wire
 * has no surface to read, and its winding could be either way round, so it is settled by the
 * fallback direction the caller knows: out of the band at one end, into it at the other.
 */
function rimDirection(mesh: EditMesh, rim: number[], fallback: Vec3): Vec3 {
  const points = rim.map((slot) => mesh.position(slot))
  const normal = newellNormal(points)
  const attached = rim.some((slot, index) => {
    const edge = mesh.edgeSlot(slot, rim[(index + 1) % rim.length]!)
    return edge >= 0 && mesh.edgeFaces(edge).length > 0
  })
  if (attached) return normal
  return dot(normal, fallback) < 0 ? scale(normal, -1) : normal
}

/* ------------------------------------------------------------- the bridge */

function bridgeRims(mesh: EditMesh, first: number[], second: number[], params: BridgeParams): number[] | string {
  if (first.length !== second.length) return UNEQUAL
  const paired = pairRims(mesh, first, second, params.twist)
  const from = first.map((slot) => mesh.position(slot))
  const to = paired.map((slot) => mesh.position(slot))
  const nearCentre = mesh.median(first)
  const farCentre = mesh.median(second)
  const travel = subtract(farCentre, nearCentre)
  // The second rim is read in its own winding, not in the paired order: reversing a loop reverses
  // the normal with it, and this is the one place the rim's own direction is what matters.
  const leaving = rimDirection(mesh, first, travel)
  const arriving = rimDirection(mesh, second, scale(travel, -1))
  const rows = Math.max(1, Math.round(params.cuts) + 1)

  const place = (index: number, step: number): Vec3 => {
    const t = biased(step, params.mergeFactor)
    const near = from[index]!
    const far = to[index]!
    const chord = subtract(far, near)
    const span = length(chord)
    // The bulge is what the two end directions add on top of the straight line, so smoothness 0
    // spaces the rings evenly along it and smoothness 1 leaves each rim the way its surface points.
    const bulge = add(
      scale(subtract(scale(leaving, span), chord), params.smoothness * leavingWeight(t)),
      scale(subtract(scale(arriving, -span), chord), params.smoothness * arrivingWeight(t)),
    )
    const point = add(lerp3(near, far, t), bulge)
    if (Math.abs(params.profile) < NEARLY_ZERO) return point
    // The profile swells the ring away from the axis of the bridge, hardest half way along, which
    // is where a person dragging the field expects to see it move.
    const axis = lerp3(nearCentre, farCentre, t)
    return add(axis, scale(subtract(point, axis), 1 + params.profile * Math.sin(Math.PI * t)))
  }
  return bandBetween(mesh, first, paired, rows, place)
}

/** The rims paired off by how near their centres are, which is what “loop pairs” means. */
function nearestPairs(mesh: EditMesh, rims: number[][]): Array<[number[], number[]]> {
  const left = rims.map((rim) => ({ rim, centre: mesh.median(rim), taken: false }))
  const pairs: Array<[number[], number[]]> = []
  for (;;) {
    let best = Number.POSITIVE_INFINITY
    let one = -1
    let other = -1
    for (let index = 0; index < left.length; index += 1) {
      if (left[index]!.taken) continue
      for (let candidate = index + 1; candidate < left.length; candidate += 1) {
        if (left[candidate]!.taken) continue
        const span = length(subtract(left[candidate]!.centre, left[index]!.centre))
        if (span >= best) continue
        best = span
        one = index
        other = candidate
      }
    }
    if (one < 0 || other < 0) return pairs
    left[one]!.taken = true
    left[other]!.taken = true
    pairs.push([left[one]!.rim, left[other]!.rim])
  }
}

function bridge(target: EditTarget, params: BridgeParams): EditOutcome {
  const mesh = target.mesh
  const rims = loopsOf(mesh, fillableEdges(target))
  if (rims.length < 2) return NEEDS_TWO
  if (rims.length > 2 && !params.loopPairs) return 'More than two rims are selected; turn Loop pairs on to bridge them in pairs.'
  const pairs = rims.length === 2 ? [[rims[0]!, rims[1]!] as [number[], number[]]] : nearestPairs(mesh, rims)
  const faces: number[] = []
  let refusal = ''
  for (const [first, second] of pairs) {
    const made = bridgeRims(mesh, first, second, params)
    if (typeof made === 'string') {
      refusal = made
      continue
    }
    faces.push(...made)
  }
  if (faces.length === 0) return refusal === '' ? NEEDS_TWO : refusal
  return { select: { faces } }
}

registerOperator<BridgeParams>({
  id: 'mesh.bridgeEdgeLoops',
  label: 'Bridge edge loops',
  section: 'Edge',
  description: 'Join two rims of edges with a band of quads.',
  params: [
    numberParam('cuts', 'Cuts', { min: 0, max: 256, step: 1, defaultValue: 0, view: 'stepper' }),
    numberParam('smoothness', 'Smoothness', { min: 0, max: 4, step: 0.05, defaultValue: 1 }),
    numberParam('profile', 'Profile', { min: -2, max: 2, step: 0.05, defaultValue: 0 }),
    numberParam('twist', 'Twist', { min: -256, max: 256, step: 1, defaultValue: 0, view: 'stepper' }),
    numberParam('mergeFactor', 'Merge factor', { min: 0, max: 1, step: 0.01, defaultValue: 0.5 }),
    switchParam('loopPairs', 'Loop pairs', false),
  ],
  defaults: { cuts: 0, smoothness: 1, profile: 0, twist: 0, mergeFactor: 0.5, loopPairs: false },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => bridge(target, params), { label: 'Bridge edge loops' }),
})

/* ---------------------------------------------------- weld edges into faces */

/**
 * Blender's “weld edges into faces”: a loose edge whose two ends are corners of the same face cuts
 * that face in two. The pass repeats because one face can be crossed by several edges, and each cut
 * leaves two smaller faces for the next edge to land in.
 */
function weldEdges(target: EditTarget): EditOutcome {
  const mesh = target.mesh
  const vertices = selectedVertices(target)
  const wires: number[] = []
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    if (mesh.edgeFaces(edge).length !== 0) continue
    const [a, b] = mesh.edgeVertices(edge)
    if (a < 0 || b < 0) continue
    if (vertices.has(a) && vertices.has(b)) wires.push(edge)
  }
  if (wires.length === 0) return 'Select loose edges that run across a face.'
  const faces = new Set<number>()
  for (;;) {
    let cut = false
    for (const edge of wires) {
      if (mesh.edgeFaces(edge).length !== 0) continue
      const [a, b] = mesh.edgeVertices(edge)
      const across = mesh.vertexFaces(a).find((face) => mesh.faceVertices(face).includes(b))
      if (across === undefined) continue
      const added = mesh.splitFace(across, a, b)
      if (added < 0) continue
      faces.add(across)
      faces.add(added)
      cut = true
    }
    if (!cut) break
  }
  if (faces.size === 0) return 'None of the selected loose edges runs across a face.'
  return { select: { faces: [...faces] } }
}

registerOperator({
  id: 'mesh.weldEdges',
  label: 'Weld edges into faces',
  section: 'Face',
  description: 'Cut each face along the loose edges that cross it.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context) => runOnMeshes(context, weldEdges, { label: 'Weld edges into faces' }),
})
