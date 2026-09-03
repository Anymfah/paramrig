import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, scale, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam, type OperatorContext, type OperatorParams } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * The three operators that cut across an edge ring: loop cut, offset edge loop, subdivide edge ring.
 *
 * A ring is the chain of edges you meet stepping across quad after quad, always leaving by the edge
 * facing the one you came in on. Cutting across it — splitting every edge of the ring and joining
 * the new vertices face by face — is what puts a fresh loop round a cylinder or across a limb, and
 * it is the one modelling gesture that a person performs by pointing rather than by selecting. So
 * two things run through this file.
 *
 * The first is that the ring has to be *turned the same way round* before anything is cut. Ring
 * edges come back as slots, and a slot's two vertices are stored low-to-high, which says nothing
 * about which side of the ring each one is on. `orientRing` walks the quads between them and
 * decides, once, which end of each edge counts as the start — without which a cut at 0.2 would
 * zig-zag from one rail to the other.
 *
 * The second is that the viewport draws the cut before the document knows anything about it.
 * `loopCutPreview` is the pure half of the operator: same walk, same arithmetic, no mutation, and
 * a cost proportional to the ring rather than to the mesh, because it is called on every pointer
 * move over meshes of ten thousand faces.
 */

/* ------------------------------------------------------------------ refusals */

const POINT_AT_AN_EDGE = 'Point at an edge: a loop cut follows the ring of the edge under the pointer.'
const NO_RING = 'This edge has no ring of quads to cut across.'
const NO_LOOP = 'This edge’s loop has no quad beside it to offset into.'

/** How close to an end of an edge a new vertex may land before it would sit on top of an old one. */
const EDGE_MARGIN = 1e-4

/** Blender's own ceiling on a loop cut, and enough that the redo field cannot build a million faces. */
const MAX_CUTS = 64

/* --------------------------------------------------------------- reading params */

/**
 * Reading a redo-panel field. The panel hands back whatever a person typed into it, so every
 * operator clamps rather than trusts; `subdivide.ts` reads its fields through the same two.
 */
export function wholeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function realNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/* ------------------------------------------------------------------- the ring */

/**
 * A ring of edges walked in order, every edge turned the same way round, and the quads between them.
 *
 * `from[i]` and `to[i]` are the two ends of ring edge `i`, chosen so that every `from` sits on one
 * rail of the ring and every `to` on the other. `faces[i]` is the quad between edges `i` and
 * `i + 1`; a closed ring has as many faces as edges, an open one has one fewer.
 */
type OrientedRing = {
  edges: number[]
  from: number[]
  to: number[]
  faces: number[]
  closed: boolean
}

/**
 * Steps from one ring edge to the next across the quad they share, and says which end of the next
 * edge lies on which rail. In a quad `L`, an edge spanning `L[m]`–`L[m + 1]` faces the edge
 * spanning `L[m + 2]`–`L[m + 3]`, and the rails join `L[m + 1]` to `L[m + 2]` and `L[m + 3]` to
 * `L[m]` — which is the whole of the correspondence.
 */
function crossQuad(
  mesh: EditMesh,
  edge: number,
  from: number,
  to: number,
  next: number,
  exclude: number,
): { face: number; from: number; to: number } | null {
  for (const face of mesh.edgeFaces(edge)) {
    if (face === exclude) continue
    const loop = mesh.faceVertices(face)
    if (loop.length !== 4) continue
    if (!mesh.faceEdges(face).includes(next)) continue
    for (let corner = 0; corner < 4; corner += 1) {
      const here = loop[corner]!
      const ahead = loop[(corner + 1) % 4]!
      const far = loop[(corner + 2) % 4]!
      const behind = loop[(corner + 3) % 4]!
      if (here === from && ahead === to) return { face, from: behind, to: far }
      if (here === to && ahead === from) return { face, from: far, to: behind }
    }
  }
  return null
}

/** A ring of edge slots turned the same way round, or null when the walk does not hold together. */
function orientRing(mesh: EditMesh, ring: number[]): OrientedRing | null {
  if (ring.length < 2) return null
  const [head, tail] = mesh.edgeVertices(ring[0]!)
  if (head < 0 || tail < 0) return null
  const from = [head]
  const to = [tail]
  const faces: number[] = []
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const step = crossQuad(mesh, ring[index]!, from[index]!, to[index]!, ring[index + 1]!, faces[index - 1] ?? -1)
    if (!step) return null
    faces.push(step.face)
    from.push(step.from)
    to.push(step.to)
  }
  const last = ring.length - 1
  const closing = crossQuad(mesh, ring[last]!, from[last]!, to[last]!, ring[0]!, faces[last - 1] ?? -1)
  // A ring that comes back to its first edge the other way round is a Möbius band; it is walked as
  // an open ring rather than cut into a surface that crosses itself.
  const closed = closing !== null && !faces.includes(closing.face) && closing.from === from[0] && closing.to === to[0]
  if (closed && closing) faces.push(closing.face)
  return { edges: ring, from, to, faces, closed }
}

/* ------------------------------------------------------------ where the cuts sit */

/**
 * Where the cuts sit along a ring edge, ascending.
 *
 * `cuts` loops start out evenly spaced. `factor` slides the whole set towards one end and squeezes
 * it as it goes — at ±1 they would all land on an existing loop — and `flipped` decides which end
 * "towards one end" means, because the rail a ring is walked from is an accident of which edge the
 * pointer was over.
 */
function cutFactors(cuts: number, factor: number, flipped: boolean): number[] {
  const factors: number[] = []
  for (let index = 1; index <= cuts; index += 1) {
    const even = index / (cuts + 1)
    const slid = even + factor * (factor > 0 ? 1 - even : even)
    const placed = flipped ? 1 - slid : slid
    factors.push(Math.min(1 - EDGE_MARGIN, Math.max(EDGE_MARGIN, placed)))
  }
  return factors.sort((a, b) => a - b)
}

/**
 * The same cuts measured in metres rather than in fractions, which is what "even" means: the new
 * loop keeps its distance from the edge it was dragged from instead of following the ring's
 * proportions, so a cut 20 cm in stays 20 cm in where the ring's edges are of different lengths.
 */
function evenFactors(factors: number[], reference: number, edgeLength: number): number[] {
  if (reference <= 0 || edgeLength <= 0) return factors
  return factors.map((factor) =>
    Math.min(1 - EDGE_MARGIN, Math.max(EDGE_MARGIN, (factor * reference) / edgeLength)))
}

/* ------------------------------------------------------------------ smoothing */

/**
 * The Catmull–Clark edge point: where a subdivision surface would put the middle of this edge.
 * `subdivide.ts` shares this, which is why it is exported — the two families have to agree, or a
 * loop cut and a subdivide across the same edge would leave the surface with a crease in it.
 */
export function edgeLimitPoint(mesh: EditMesh, edge: number): Vec3 {
  const [a, b] = mesh.edgeVertices(edge)
  if (a < 0 || b < 0) return [0, 0, 0]
  const ends = add(mesh.position(a), mesh.position(b))
  const faces = mesh.edgeFaces(edge)
  if (faces.length !== 2) return scale(ends, 0.5)
  return scale(add(ends, add(mesh.faceCentre(faces[0]!), mesh.faceCentre(faces[1]!))), 0.25)
}

/**
 * A point along an edge, pulled `smoothness` of the way onto the curve the surface would follow.
 *
 * The curve is the quadratic through `a` and `b` whose middle is the smoothed edge point, so a
 * single cut lands exactly on the limit and several cuts spread along the same arc. At smoothness
 * zero the control point is the midpoint and the whole thing collapses back to a straight line.
 */
export function pointAlongSmoothEdge(a: Vec3, b: Vec3, limit: Vec3, t: number, smoothness: number): Vec3 {
  const midpoint = scale(add(a, b), 0.5)
  const target = add(midpoint, scale(subtract(limit, midpoint), smoothness))
  const control = subtract(scale(target, 2), midpoint)
  const rest = 1 - t
  return [
    rest * rest * a[0] + 2 * t * rest * control[0] + t * t * b[0],
    rest * rest * a[1] + 2 * t * rest * control[1] + t * t * b[1],
    rest * rest * a[2] + 2 * t * rest * control[2] + t * t * b[2],
  ]
}

/* ------------------------------------------------------------------- cutting */

/** What a cut left behind: the new vertices, edge by edge of the ring, and the loops they made. */
type RingCut = { points: number[][]; edges: number[] }

/**
 * Splits every edge of a ring and joins the new vertices across each quad.
 *
 * The splits are done one round at a time rather than all at once because `splitEdges` puts a
 * single vertex on an edge: the second cut of a round of three is a split of what is left of the
 * edge after the first, which is why each round rescales its parameter into the remaining span.
 * Vertex slots survive all of it — only edges are removed — so the rows of new vertices stay valid
 * to the end.
 */
function cutAcrossRing(mesh: EditMesh, ring: OrientedRing, factors: number[][]): RingCut | null {
  const cuts = factors[0]?.length ?? 0
  if (cuts === 0 || ring.faces.length === 0) return null
  const points: number[][] = ring.edges.map(() => [])
  const heads = ring.from.slice()
  const consumed = ring.edges.map(() => 0)
  for (let round = 0; round < cuts; round += 1) {
    const requests: Array<{ edge: number; t: number }> = []
    for (let index = 0; index < ring.edges.length; index += 1) {
      const wanted = factors[index]?.[round] ?? 0.5
      const already = consumed[index]!
      const local = (wanted - already) / (1 - already)
      const edge = mesh.edgeSlot(heads[index]!, ring.to[index]!)
      if (edge < 0) return null
      // `splitEdges` measures along the edge as it is stored, low slot first, which has nothing to
      // do with which end of it the ring was walked from; the parameter is turned round to match.
      const forward = mesh.edgeVertices(edge)[0] === heads[index]
      const along = Math.min(1 - EDGE_MARGIN, Math.max(EDGE_MARGIN, local))
      requests.push({ edge, t: forward ? along : 1 - along })
    }
    const created = mesh.splitEdges(requests)
    if (created.length !== requests.length) return null
    for (let index = 0; index < created.length; index += 1) {
      points[index]!.push(created[index]!)
      heads[index] = created[index]!
      consumed[index] = factors[index]?.[round] ?? consumed[index]!
    }
  }
  const edges: number[] = []
  for (let index = 0; index < ring.faces.length; index += 1) {
    const ahead = (index + 1) % ring.edges.length
    let piece = ring.faces[index]!
    for (let cut = 0; cut < cuts; cut += 1) {
      const here = points[index]![cut]!
      const there = points[ahead]![cut]!
      const added = mesh.splitFace(piece, here, there)
      if (added < 0) return null
      const edge = mesh.edgeSlot(here, there)
      if (edge >= 0) edges.push(edge)
      const next = points[index]![cut + 1]
      if (next !== undefined && mesh.faceVertices(added).includes(next)) piece = added
    }
  }
  return { points, edges }
}

/* ---------------------------------------------------------------- the preview */

/**
 * The polylines the viewport draws under the pointer, one per cut, a point per edge of the ring.
 *
 * It touches nothing: the mesh is read, never written, so the overlay can call it on every pointer
 * move without a transaction. The work is proportional to the ring — a hundred or so edges on a
 * mesh of ten thousand faces — not to the mesh, which is what keeps the hover under 4 ms.
 */
export function loopCutPreview(mesh: EditMesh, edge: number, cuts: number, factor: number): Vec3[][] {
  if (!mesh.hasEdge(edge)) return []
  const ring = orientRing(mesh, mesh.edgeRing(edge))
  if (!ring || ring.faces.length === 0) return []
  const factors = cutFactors(wholeNumber(cuts, 1, 1, MAX_CUTS), realNumber(factor, 0, -1, 1), false)
  const lines: Vec3[][] = []
  for (const t of factors) {
    const line: Vec3[] = []
    for (let index = 0; index < ring.edges.length; index += 1) {
      const a = mesh.position(ring.from[index]!)
      const b = mesh.position(ring.to[index]!)
      line.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
    }
    lines.push(line)
  }
  return lines
}

/* --------------------------------------------------------------- shared plumbing */

/**
 * The edge a ring operator works from: the one the viewport passed as an index, else the active
 * edge, else the lowest selected one. Blender's loop cut is driven by the pointer and its redo
 * panel replays the index it was over, which is why the parameter is an index and not a selection.
 */
function pointedEdge(target: EditTarget, wanted: number): number {
  if (Number.isInteger(wanted) && wanted >= 0) return target.mesh.hasEdge(wanted) ? wanted : -1
  if (target.active?.kind === 'edge' && target.mesh.hasEdge(target.active.slot)) return target.active.slot
  let lowest = -1
  for (const slot of target.edges) if (lowest < 0 || slot < lowest) lowest = slot
  return lowest
}

/** An operator pointed at one edge index runs on the object that edge belongs to, and no other. */
function pointedTarget(context: OperatorContext, target: EditTarget, wanted: number): boolean {
  if (!Number.isInteger(wanted) || wanted < 0) return true
  const active = context.selection.activeObjectId
  return !active || target.object.id === active
}

/** Where the new loops end up, in slots, which is what Blender leaves selected after a cut. */
function selectionOfCut(cut: RingCut): { vertices: number[]; edges: number[] } {
  return { vertices: cut.points.flat(), edges: cut.edges }
}

/* --------------------------------------------------------------------- loop cut */

type LoopCutParams = OperatorParams & {
  edge: number
  cuts: number
  factor: number
  smoothness: number
  even: boolean
  flipped: boolean
}

function runLoopCut(target: EditTarget, params: LoopCutParams): EditOutcome {
  const mesh = target.mesh
  const edge = pointedEdge(target, wholeNumber(params.edge, -1, -1, Number.MAX_SAFE_INTEGER))
  if (edge < 0) return POINT_AT_AN_EDGE
  const ring = orientRing(mesh, mesh.edgeRing(edge))
  if (!ring || ring.faces.length === 0) return NO_RING
  const cuts = wholeNumber(params.cuts, 1, 1, MAX_CUTS)
  const smoothness = realNumber(params.smoothness, 0, -1, 1)
  const base = cutFactors(cuts, realNumber(params.factor, 0, -1, 1), params.flipped === true)
  const reference = mesh.edgeLength(edge)
  const factors = ring.edges.map((slot) =>
    params.even === true ? evenFactors(base, reference, mesh.edgeLength(slot)) : base)
  // The limit points have to be read before anything is split: afterwards the ring's edges are
  // gone and the faces either side of them are no longer the faces the surface was smoothed from.
  const rails = ring.edges.map((slot, index) => ({
    a: mesh.position(ring.from[index]!),
    b: mesh.position(ring.to[index]!),
    limit: edgeLimitPoint(mesh, slot),
  }))
  const cut = cutAcrossRing(mesh, ring, factors)
  if (!cut) return NO_RING
  if (smoothness !== 0) {
    for (let index = 0; index < cut.points.length; index += 1) {
      const rail = rails[index]!
      for (let step = 0; step < cut.points[index]!.length; step += 1) {
        const t = factors[index]?.[step] ?? 0.5
        mesh.setPosition(cut.points[index]![step]!, pointAlongSmoothEdge(rail.a, rail.b, rail.limit, t, smoothness))
      }
    }
  }
  const selection = selectionOfCut(cut)
  const active = selection.edges[0]
  return {
    select: selection,
    ...(active === undefined ? {} : { active: { kind: 'edge' as const, slot: active } }),
  }
}

registerOperator<LoopCutParams>({
  id: 'mesh.loopCut',
  label: 'Loop cut',
  section: 'Edge',
  shortcut: '⌃R',
  icon: 'knife',
  description: 'Cut new edge loops across the ring of the edge under the pointer.',
  params: [
    numberParam('edge', 'Edge', { min: -1, max: 1e7, step: 1, defaultValue: -1, view: 'stepper' }),
    numberParam('cuts', 'Cuts', { min: 1, max: MAX_CUTS, step: 1, defaultValue: 1, view: 'stepper' }),
    numberParam('factor', 'Factor', { min: -1, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    numberParam('smoothness', 'Smoothness', { min: -1, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    switchParam('even', 'Even', false),
    switchParam('flipped', 'Flipped', false),
  ],
  defaults: { edge: -1, cuts: 1, factor: 0, smoothness: 0, even: false, flipped: false },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(
    context,
    (target) => (pointedTarget(context, target, wholeNumber(params.edge, -1, -1, Number.MAX_SAFE_INTEGER))
      ? runLoopCut(target, params)
      : null),
    { label: 'Loop cut' },
  ),
})

/* ------------------------------------------------------------- offset edge loop */

type OffsetEdgeLoopParams = OperatorParams & { edge: number; factor: number; capEndpoint: boolean }

/** One face beside the loop: the quad, and the two rails leading away from the loop across it. */
type LoopSide = { face: number; near: number; far: number }

/**
 * The rails an offset runs along: every edge of a quad beside the loop that leaves the loop, keyed
 * by the loop vertex it leaves from, so the split can be measured from the loop outwards.
 *
 * `degrees` counts how many of the loop's own edges each loop vertex carries, which is how an end
 * of an open loop is told apart from a vertex the loop merely passed through — the one place the
 * cap has anything to do.
 */
function offsetRails(mesh: EditMesh, loop: number[]): {
  rails: Map<number, number>
  sides: LoopSide[]
  degrees: Map<number, number>
} | null {
  const inLoop = new Set(loop)
  const rails = new Map<number, number>()
  const degrees = new Map<number, number>()
  const sides: LoopSide[] = []
  const taken = new Set<number>()
  for (const edge of loop) {
    const [a, b] = mesh.edgeVertices(edge)
    if (a < 0 || b < 0) continue
    degrees.set(a, (degrees.get(a) ?? 0) + 1)
    degrees.set(b, (degrees.get(b) ?? 0) + 1)
    for (const face of mesh.edgeFaces(edge)) {
      // A face carrying two of the loop's edges would be cut twice, the second time through a
      // loop that the first cut had already rewritten; it is left alone rather than torn.
      if (taken.has(face)) continue
      const corners = mesh.faceVertices(face)
      if (corners.length !== 4) continue
      const near = mesh.edgeSlot(a, mesh.loopNext(face, a) === b ? mesh.loopPrev(face, a) : mesh.loopNext(face, a))
      const far = mesh.edgeSlot(b, mesh.loopNext(face, b) === a ? mesh.loopPrev(face, b) : mesh.loopNext(face, b))
      if (near < 0 || far < 0 || near === far || inLoop.has(near) || inLoop.has(far)) continue
      taken.add(face)
      rails.set(near, a)
      rails.set(far, b)
      sides.push({ face, near, far })
    }
  }
  return sides.length === 0 ? null : { rails, sides, degrees }
}

/**
 * Closes an open loop's ends. The two new loops stop on the last rail either side of the endpoint;
 * where a single face bridges those two rails — the ordinary case at a three-valence corner — it is
 * cut from one to the other, which is the triangle Blender's cap endpoint leaves behind.
 */
function capEnds(mesh: EditMesh, ends: Array<[number, number]>): number[] {
  const edges: number[] = []
  for (const [first, second] of ends) {
    for (const face of mesh.vertexFaces(first)) {
      const corners = mesh.faceVertices(face)
      if (!corners.includes(second)) continue
      const added = mesh.splitFace(face, first, second)
      if (added < 0) continue
      const edge = mesh.edgeSlot(first, second)
      if (edge >= 0) edges.push(edge)
      break
    }
  }
  return edges
}

function runOffsetEdgeLoop(target: EditTarget, params: OffsetEdgeLoopParams): EditOutcome {
  const mesh = target.mesh
  const edge = pointedEdge(target, wholeNumber(params.edge, -1, -1, Number.MAX_SAFE_INTEGER))
  if (edge < 0) return POINT_AT_AN_EDGE
  const loop = mesh.edgeLoop(edge)
  const found = offsetRails(mesh, loop)
  if (!found) return NO_LOOP
  const factor = realNumber(params.factor, 0.5, EDGE_MARGIN, 1 - EDGE_MARGIN)
  const rails = [...found.rails.entries()]
  const requests = rails.map(([rail, anchor]) => {
    const [a] = mesh.edgeVertices(rail)
    return { edge: rail, t: a === anchor ? factor : 1 - factor }
  })
  const created = mesh.splitEdges(requests)
  if (created.length !== requests.length) return NO_LOOP
  const points = new Map<number, number>()
  for (let index = 0; index < created.length; index += 1) points.set(rails[index]![0]!, created[index]!)
  const edges: number[] = []
  const ends: Array<[number, number]> = []
  for (const side of found.sides) {
    const near = points.get(side.near)
    const far = points.get(side.far)
    if (near === undefined || far === undefined) continue
    if (mesh.splitFace(side.face, near, far) < 0) continue
    const cut = mesh.edgeSlot(near, far)
    if (cut >= 0) edges.push(cut)
  }
  if (params.capEndpoint === true) {
    // An endpoint carries one edge of the loop, where a vertex the loop ran through carries two.
    const byAnchor = new Map<number, number[]>()
    for (const [rail, anchor] of found.rails) {
      const list = byAnchor.get(anchor) ?? []
      list.push(rail)
      byAnchor.set(anchor, list)
    }
    for (const [anchor, list] of byAnchor) {
      if (list.length !== 2 || found.degrees.get(anchor) !== 1) continue
      const first = points.get(list[0]!)
      const second = points.get(list[1]!)
      if (first !== undefined && second !== undefined) ends.push([first, second])
    }
    edges.push(...capEnds(mesh, ends))
  }
  if (edges.length === 0) return NO_LOOP
  return { select: { vertices: created, edges }, active: { kind: 'edge', slot: edges[0]! } }
}

registerOperator<OffsetEdgeLoopParams>({
  id: 'mesh.offsetEdgeLoop',
  label: 'Offset edge loop',
  section: 'Edge',
  shortcut: '⇧⌃R',
  icon: 'knife',
  description: 'Add a loop either side of the loop under the pointer, without cutting it.',
  params: [
    numberParam('edge', 'Edge', { min: -1, max: 1e7, step: 1, defaultValue: -1, view: 'stepper' }),
    numberParam('factor', 'Factor', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' }),
    switchParam('capEndpoint', 'Cap endpoint', false),
  ],
  defaults: { edge: -1, factor: 0.5, capEndpoint: false },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(
    context,
    (target) => (pointedTarget(context, target, wholeNumber(params.edge, -1, -1, Number.MAX_SAFE_INTEGER))
      ? runOffsetEdgeLoop(target, params)
      : null),
    { label: 'Offset edge loop' },
  ),
})

/* ---------------------------------------------------------- subdivide edge ring */

type SubdivideEdgeRingParams = OperatorParams & { cuts: number; smoothness: number }

function runSubdivideEdgeRing(target: EditTarget, params: SubdivideEdgeRingParams): EditOutcome {
  const mesh = target.mesh
  if (target.edges.size === 0) return 'No edges are selected.'
  const cuts = wholeNumber(params.cuts, 1, 1, MAX_CUTS)
  const smoothness = realNumber(params.smoothness, 0, -1, 1)
  const factors = cutFactors(cuts, 0, false)
  // Edges are named by their ends here, not by their slots: cutting one ring renumbers every edge
  // of the mesh, and the rings still to come would otherwise be walked from the wrong ones.
  const wanted = [...target.edges].sort((a, b) => a - b).map((slot) => mesh.edgeVertices(slot))
  const vertices: number[] = []
  const edges: number[] = []
  for (const [a, b] of wanted) {
    const slot = mesh.edgeSlot(a, b)
    if (slot < 0) continue
    const ring = orientRing(mesh, mesh.edgeRing(slot))
    if (!ring || ring.faces.length === 0) continue
    const rails = ring.edges.map((edge, index) => ({
      a: mesh.position(ring.from[index]!),
      b: mesh.position(ring.to[index]!),
      limit: edgeLimitPoint(mesh, edge),
    }))
    const cut = cutAcrossRing(mesh, ring, ring.edges.map(() => factors))
    if (!cut) continue
    if (smoothness !== 0) {
      for (let index = 0; index < cut.points.length; index += 1) {
        const rail = rails[index]!
        for (let step = 0; step < cut.points[index]!.length; step += 1) {
          mesh.setPosition(cut.points[index]![step]!, pointAlongSmoothEdge(rail.a, rail.b, rail.limit, factors[step]!, smoothness))
        }
      }
    }
    vertices.push(...cut.points.flat())
    edges.push(...cut.edges)
  }
  if (vertices.length === 0) return NO_RING
  return { select: { vertices, edges } }
}

registerOperator<SubdivideEdgeRingParams>({
  id: 'mesh.subdivideEdgeRing',
  label: 'Subdivide edge ring',
  section: 'Edge',
  icon: 'knife',
  description: 'Cut evenly spaced loops across the ring of every selected edge.',
  params: [
    numberParam('cuts', 'Cuts', { min: 1, max: MAX_CUTS, step: 1, defaultValue: 1, view: 'stepper' }),
    numberParam('smoothness', 'Smoothness', { min: -1, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
  ],
  defaults: { cuts: 1, smoothness: 0 },
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context, params) => runOnMeshes(context, (target) => runSubdivideEdgeRing(target, params), {
    label: 'Subdivide edge ring',
  }),
})
