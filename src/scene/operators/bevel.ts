import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, cross, dot, length, newellNormal, normalize, scale, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, selectParam, switchParam, type ParamSchema } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Blender's ⌃B and ⇧⌃B: an edge or a corner opened out into a strip of faces.
 *
 * Both operators are the same act seen from two sides. A vertex the bevel touches is *opened*: it
 * stops being one point and becomes one point per side of the corner, pulled back along the faces
 * that meet there. Everything else follows from that. Each bevelled edge becomes a strip of quads
 * between the two points its ends were opened into, following the profile across; each face that
 * had a corner at the vertex takes the new points in its place; and where several bevelled edges
 * meet, the hole they leave over the vertex is closed by a cap.
 *
 * Three rules decide where the new points go, and they are the whole of the geometry:
 *
 * — A corner with two bevelled edges puts its point where the two offset lines meet, inside the
 *   face's own plane. That is the corner of the shrunken face.
 * — A corner with one bevelled edge slides its point along the *other* edge instead of striking off
 *   perpendicular to it, far enough that the offset from the bevelled edge is still the one asked
 *   for. Blender calls that the edge rail, and it is what keeps the neighbouring face flat.
 * — A corner with no bevelled edge mints nothing: it is bounded by the points its two edges already
 *   carry, and the vertex drops out of it. That is why a single bevelled edge of a cube leaves a
 *   pentagon on the face beside it rather than a notch.
 *
 * A vertex all of whose edges are resolved that way is removed. One with an edge that no bevel
 * reaches keeps it — the bevel has to run out somewhere, and the cap over the vertex is what
 * closes it.
 *
 * Non-manifold input is refused by name rather than bevelled into a broken mesh, and both operators
 * are pure functions of their parameters, so the F9 panel replays a bevel with more segments by
 * running the same code again.
 */

/** Blender's ceiling on the segment count, and the reason the field is a stepper. */
const MAX_SEGMENTS = 32

/** Two bounds this nearly parallel meet nowhere useful, so the corner falls back to one of them. */
const PARALLEL = 1 - 1e-9

/** Under this there is no direction left to normalise, and the fallback is used instead. */
const TINY = 1e-9

/**
 * A profile of zero is Blender's square shoulder, where every point of the arc sits on the corner
 * itself. Held a hair above zero the points stay distinct, which is what keeps the faces between
 * them from collapsing to nothing.
 */
const MIN_PROFILE = 0.02

const AFFECT = ['edges', 'vertices'] as const
const OFFSET_TYPES = ['offset', 'width', 'depth', 'percent', 'absolute'] as const

type BevelParams = {
  width: number
  segments: number
  profile: number
  affect: string
  clampOverlap: boolean
  offsetType: string
  miterOuter: string
  miterInner: string
  markSeam: boolean
  markSharp: boolean
  material: number
  harden: boolean
}

/** The faces and edges around one vertex in order: `faces[i]` sits between `edges[i]` and `edges[i + 1]`. */
type Fan = { edges: number[]; faces: number[] }

/** What the bevel does to one vertex, in the fan's own direction. */
type VertexPlan = {
  vertex: number
  /** What replaces the vertex inside each face, and which edge the chain starts from. */
  chains: Map<number, { fromEdge: number; slots: number[] }>
  /** The rim of the hole left over the vertex, or fewer than three slots when there is no hole. */
  cycle: number[]
  /** Which way the cap faces, read off the mesh before any loop was rewritten. */
  outward: Vec3
  /** A face to take the material and the shading from. */
  source: number
}

/* ------------------------------------------------------- reading a parameter */

function chosen<Value extends string>(value: string, options: readonly Value[], fallback: Value): Value {
  return options.find((option) => option === value) ?? fallback
}

function segmentsOf(params: BevelParams): number {
  const asked = Math.round(Number(params.segments))
  if (!Number.isFinite(asked)) return 1
  return Math.min(MAX_SEGMENTS, Math.max(1, asked))
}

function profileOf(params: BevelParams): number {
  const asked = Number(params.profile)
  return Number.isFinite(asked) ? Math.min(1, Math.max(0, asked)) : 0.5
}

/* -------------------------------------------------------------- the geometry */

function otherEnd(mesh: EditMesh, edge: number, vertex: number): number {
  const [a, b] = mesh.edgeVertices(edge)
  return a === vertex ? b : a
}

function towards(mesh: EditMesh, from: number, to: number): Vec3 {
  return normalize(subtract(mesh.position(to), mesh.position(from)))
}

/** The inward perpendicular to one edge of a face, in that face's own plane. */
function inwardNormal(mesh: EditMesh, face: number, vertex: number, other: number): Vec3 {
  const forward = mesh.loopNext(face, vertex) === other
  const along = forward
    ? subtract(mesh.position(other), mesh.position(vertex))
    : subtract(mesh.position(vertex), mesh.position(other))
  return cross(mesh.faceNormal(face), normalize(along))
}

/** Where two offset lines meet inside a face: the corner of the shrunken face. */
function meetingPoint(
  mesh: EditMesh,
  face: number,
  vertex: number,
  first: { other: number; offset: number },
  second: { other: number; offset: number },
): Vec3 {
  const here = mesh.position(vertex)
  const normalA = inwardNormal(mesh, face, vertex, first.other)
  const normalB = inwardNormal(mesh, face, vertex, second.other)
  const cosine = dot(normalA, normalB)
  if (Math.abs(cosine) > PARALLEL) return add(here, scale(normalA, first.offset))
  const scaleA = (first.offset - cosine * second.offset) / (1 - cosine * cosine)
  const scaleB = (second.offset - cosine * first.offset) / (1 - cosine * cosine)
  return add(here, add(scale(normalA, scaleA), scale(normalB, scaleB)))
}

/**
 * How far along the unbevelled edge the point slides so that it is still the asked offset away from
 * the bevelled one. The sine of the angle between the two is what makes a shallow corner reach
 * further, and a corner with no angle at all falls back to the offset itself.
 */
function railDistance(mesh: EditMesh, face: number, vertex: number, cut: number, rail: number, offset: number): number {
  const normal = inwardNormal(mesh, face, vertex, otherEnd(mesh, cut, vertex))
  const along = towards(mesh, vertex, otherEnd(mesh, rail, vertex))
  const lean = dot(along, normal)
  return lean > TINY ? offset / lean : offset
}

/**
 * Blender's superellipse: a point at `t` is (cos²ᵖ, sin²ᵖ) in the frame whose axes reach the two
 * ends of the profile, and whose origin is the *inner* corner — the fourth corner of the
 * parallelogram, opposite the one being cut off. That origin is what makes the three interesting
 * profiles fall out of the one formula: a half gives cos and sin, a circular arc tangent to both
 * faces; one gives cos² and sin², which sum to one and lay the points on the straight line of a
 * flat chamfer; and nought puts every point back on the corner itself, a square shoulder.
 */
function profilePoint(apex: Vec3, from: Vec3, to: Vec3, t: number, profile: number): Vec3 {
  const inner = subtract(add(from, to), apex)
  const power = 2 * Math.max(profile, MIN_PROFILE)
  const angle = (t * Math.PI) / 2
  const across = Math.pow(Math.cos(angle), power)
  const along = Math.pow(Math.sin(angle), power)
  return add(inner, add(scale(subtract(from, inner), across), scale(subtract(to, inner), along)))
}

/** The profile between two points that already exist; only what lies between them is minted. */
function profileRow(mesh: EditMesh, apex: Vec3, from: number, to: number, segments: number, profile: number): number[] {
  const slots = [from]
  const start = mesh.position(from)
  const end = mesh.position(to)
  for (let step = 1; step < segments; step += 1) {
    slots.push(mesh.addVertex(profilePoint(apex, start, end, step / segments, profile)))
  }
  slots.push(to)
  return slots
}

/* ------------------------------------------------------------------ the fan */

/**
 * The faces round a vertex in one turn, or null when they do not make one: an open rim, an edge
 * with three faces, two cones meeting at a point. A bevel opens the corner out, and a corner that
 * is not a single closed ring has no “out” to open into.
 */
function fanAround(mesh: EditMesh, vertex: number): Fan | null {
  const start = mesh.vertexEdges(vertex)[0]
  if (start === undefined) return null
  const edges = [start]
  const faces: number[] = []
  let edge = start
  let face = mesh.edgeFaces(edge)[0]
  const valence = mesh.vertexEdges(vertex).length
  for (;;) {
    if (face === undefined || faces.length > valence) return null
    faces.push(face)
    const ahead = mesh.loopNext(face, vertex)
    const behind = mesh.loopPrev(face, vertex)
    const first = mesh.edgeSlot(vertex, ahead)
    const second = mesh.edgeSlot(vertex, behind)
    const next = first === edge ? second : first
    if (next < 0) return null
    if (next === start) break
    const pair = mesh.edgeFaces(next)
    if (pair.length !== 2) return null
    edges.push(next)
    edge = next
    face = pair[0] === face ? pair[1] : pair[0]
  }
  if (edges.length !== valence || faces.length !== mesh.vertexFaces(vertex).length) return null
  return { edges, faces }
}

/* --------------------------------------------------------------- the offsets */

/** The width this vertex may use: Blender's clamp is half the shortest edge meeting there. */
function widthAt(mesh: EditMesh, vertex: number, params: BevelParams): number {
  const asked = Number.isFinite(params.width) ? Math.max(0, Number(params.width)) : 0
  if (!params.clampOverlap) return asked
  let shortest = Infinity
  for (const edge of mesh.vertexEdges(vertex)) shortest = Math.min(shortest, mesh.edgeLength(edge))
  return Number.isFinite(shortest) ? Math.min(asked, shortest / 2) : asked
}

/** The mean of the two corner angles at one end of an edge, and of the edges they run along. */
function railsAt(mesh: EditMesh, edge: number, vertex: number): { sine: number; span: number } {
  const along = towards(mesh, vertex, otherEnd(mesh, edge, vertex))
  let sine = 0
  let span = 0
  let count = 0
  for (const face of mesh.edgeFaces(edge)) {
    const ahead = mesh.loopNext(face, vertex)
    const behind = mesh.loopPrev(face, vertex)
    const other = mesh.edgeSlot(vertex, ahead) === edge ? behind : ahead
    if (other < 0) continue
    sine += length(cross(along, towards(mesh, vertex, other)))
    span += length(subtract(mesh.position(other), mesh.position(vertex)))
    count += 1
  }
  return count === 0 ? { sine: 1, span: 0 } : { sine: sine / count, span: span / count }
}

/**
 * The offset the corner points are placed at, in metres measured across the faces at the edge.
 *
 * Blender's five offset types all end up as that one number. Width and depth are the chord and the
 * height of the same wedge, so both are trigonometry on the angle the faces make. Percent and
 * absolute are measured *along* the edges running away from the bevel instead, so they are turned
 * into an offset through the angle those edges leave at — an approximation where the two corners of
 * an edge lean differently, since one offset has to serve both.
 */
function offsetFor(mesh: EditMesh, edge: number, vertex: number, params: BevelParams): number {
  const width = widthAt(mesh, vertex, params)
  const half = (Math.PI - mesh.dihedral(edge)) / 2
  const type = chosen(params.offsetType, OFFSET_TYPES, 'offset')
  if (type === 'width') {
    const sine = Math.sin(half)
    return sine > TINY ? width / (2 * sine) : width
  }
  if (type === 'depth') {
    const cosine = Math.cos(half)
    return cosine > TINY ? width / cosine : width
  }
  if (type === 'percent' || type === 'absolute') {
    const rails = railsAt(mesh, edge, vertex)
    const along = type === 'percent' ? (width / 100) * rails.span : width
    return along * rails.sine
  }
  return width
}

/* --------------------------------------------------------- applying the plans */

/** A face the bevel minted takes its look from the face it grew out of, and then the parameters. */
function dress(mesh: EditMesh, face: number, source: number, params: BevelParams): void {
  mesh.copyFaceAttributes(source, face)
  const material = Math.round(Number(params.material))
  if (Number.isFinite(material) && material >= 0) mesh.setFaceMaterial(face, material)
  // Hardening normals is a shading job the renderer does not read yet; smooth is what it can honour.
  if (params.harden) mesh.setFaceSmooth(face, true)
}

function markEdge(mesh: EditMesh, a: number, b: number, params: BevelParams): void {
  const edge = mesh.edgeSlot(a, b)
  if (edge < 0) return
  if (params.markSeam) mesh.setEdgeFlag(edge, 'seam', true)
  if (params.markSharp) mesh.setEdgeFlag(edge, 'sharp', true)
}

/** Consecutive repeats taken out of a cycle, the wrap-around one included. */
function tighten(cycle: number[]): number[] {
  const kept: number[] = []
  for (const slot of cycle) if (kept[kept.length - 1] !== slot) kept.push(slot)
  while (kept.length > 1 && kept[0] === kept[kept.length - 1]) kept.pop()
  return kept
}

/** Where the middle of a rounded corner sits: on the profile, not on the chord between its edges. */
function cornerCentre(mesh: EditMesh, vertex: number, rim: number[]): Vec3 {
  const here = mesh.position(vertex)
  let mean: Vec3 = [0, 0, 0]
  let radius = 0
  for (const slot of rim) {
    const point = mesh.position(slot)
    mean = add(mean, scale(point, 1 / rim.length))
    radius += length(subtract(point, here)) / rim.length
  }
  const direction = subtract(mean, here)
  return length(direction) > TINY ? add(here, scale(normalize(direction), radius)) : mean
}

/**
 * The cap over an opened vertex. One segment leaves the n-gon Blender leaves; more than one and an
 * even rim is quartered into a ring of quads around a centre raised onto the profile, which is the
 * grid a rounded corner wants. An odd rim — three segments on a three-valence corner — is left as
 * the n-gon, and is the one place this is flatter than Blender's own vertex mesh.
 */
function closeCorner(mesh: EditMesh, plan: VertexPlan, params: BevelParams, created: number[]): void {
  const rim = plan.cycle
  if (rim.length < 3) return
  const wound = dot(newellNormal(rim.map((slot) => mesh.position(slot))), plan.outward) >= 0 ? rim : [...rim].reverse()
  const segments = segmentsOf(params)
  if (segments < 2 || wound.length < 4 || wound.length % 2 === 1) {
    const face = mesh.addFace(wound)
    if (face < 0) return
    dress(mesh, face, plan.source, params)
    created.push(mesh.faceId(face))
    return
  }
  const centre = mesh.addVertex(cornerCentre(mesh, plan.vertex, wound))
  for (let index = 0; index < wound.length; index += 2) {
    const face = mesh.addFace([
      wound[index]!,
      wound[(index + 1) % wound.length]!,
      wound[(index + 2) % wound.length]!,
      centre,
    ])
    if (face < 0) continue
    dress(mesh, face, plan.source, params)
    created.push(mesh.faceId(face))
  }
}

/** The faces around every opened vertex take the new points, and then the holes are capped. */
function applyPlans(mesh: EditMesh, plans: VertexPlan[], params: BevelParams, created: number[]): void {
  const byVertex = new Map(plans.map((plan) => [plan.vertex, plan]))
  const faces = new Set<number>()
  for (const plan of plans) for (const face of mesh.vertexFaces(plan.vertex)) faces.add(face)
  for (const face of faces) {
    const loop = mesh.faceVertices(face)
    const next: number[] = []
    for (const corner of loop) {
      const chain = byVertex.get(corner)?.chains.get(face)
      if (!chain) {
        next.push(corner)
        continue
      }
      const behind = mesh.edgeSlot(corner, mesh.loopPrev(face, corner))
      next.push(...(chain.fromEdge === behind ? chain.slots : [...chain.slots].reverse()))
    }
    mesh.setFaceLoop(face, next)
  }
  for (const plan of plans) closeCorner(mesh, plan, params, created)
}

/** Everything the bevel left standing on its own: the vertices it opened, and the edges they held. */
function clearAway(mesh: EditMesh, opened: number[], touched: Iterable<number>): void {
  const dead = [...touched].filter((edge) => mesh.hasEdge(edge) && mesh.edgeFaces(edge).length === 0)
  if (dead.length === 0 && opened.length === 0) return
  mesh.remove({ edges: dead, vertices: opened })
}

/* ------------------------------------------------------------- bevelling edges */

function bevelEdges(target: EditTarget, params: BevelParams): EditOutcome {
  const mesh = target.mesh
  const bevelled = [...target.edges].filter((edge) => mesh.hasEdge(edge))
  if (bevelled.length === 0) return null
  const inBevel = new Set(bevelled)
  for (const edge of bevelled) {
    if (mesh.edgeFaces(edge).length === 2) continue
    const [a, b] = mesh.edgeVertices(edge)
    return `Deselect the edge between vertices ${mesh.vertexId(a)} and ${mesh.vertexId(b)}: a bevel needs every edge it opens to have a face on each side.`
  }
  const corners = new Set<number>()
  for (const edge of bevelled) for (const end of mesh.edgeVertices(edge)) corners.add(end)
  const fans = new Map<number, Fan>()
  for (const vertex of corners) {
    const fan = fanAround(mesh, vertex)
    if (!fan) {
      return `Deselect the edges meeting at vertex ${mesh.vertexId(vertex)}: a bevel opens a corner out, and the faces there do not close a ring around it.`
    }
    fans.set(vertex, fan)
  }

  const segments = segmentsOf(params)
  const profile = profileOf(params)
  const cornerSlots = new Map<string, number>()
  const railSlots = new Map<string, number>()
  const opened: number[] = []
  const touched = new Set<number>()

  for (const [vertex, fan] of fans) {
    for (const edge of fan.edges) touched.add(edge)
    const count = fan.edges.length
    const rails = new Map<number, number>()
    const kinds: Array<{ face: number; rail: number } | { face: number; before: number; after: number } | null> = []
    for (let index = 0; index < count; index += 1) {
      const face = fan.faces[index]!
      const before = fan.edges[index]!
      const after = fan.edges[(index + 1) % count]!
      const cutBefore = inBevel.has(before)
      const cutAfter = inBevel.has(after)
      if (cutBefore && cutAfter) {
        kinds.push({ face, before, after })
        continue
      }
      if (!cutBefore && !cutAfter) {
        kinds.push(null)
        continue
      }
      const cut = cutBefore ? before : after
      const rail = cutBefore ? after : before
      const reach = railDistance(mesh, face, vertex, cut, rail, offsetFor(mesh, cut, vertex, params))
      rails.set(rail, Math.max(rails.get(rail) ?? 0, reach))
      kinds.push({ face, rail })
    }
    for (const [edge, reach] of rails) {
      const point = add(mesh.position(vertex), scale(towards(mesh, vertex, otherEnd(mesh, edge, vertex)), reach))
      railSlots.set(`${vertex}:${edge}`, mesh.addVertex(point))
    }
    for (const kind of kinds) {
      if (!kind) continue
      if ('rail' in kind) {
        cornerSlots.set(`${kind.face}:${vertex}`, railSlots.get(`${vertex}:${kind.rail}`)!)
        continue
      }
      const point = meetingPoint(
        mesh,
        kind.face,
        vertex,
        { other: otherEnd(mesh, kind.before, vertex), offset: offsetFor(mesh, kind.before, vertex, params) },
        { other: otherEnd(mesh, kind.after, vertex), offset: offsetFor(mesh, kind.after, vertex, params) },
      )
      cornerSlots.set(`${kind.face}:${vertex}`, mesh.addVertex(point))
    }
    // The bevel has to stop somewhere: a vertex with an edge no bevel reached stays where it is,
    // and the cap closes the wedge around it.
    const runsOut = fan.edges.some((edge) => !inBevel.has(edge) && !rails.has(edge))
    if (!runsOut) opened.push(vertex)
  }

  /* The strip along each bevelled edge: a row of profile points at either end, joined across. */
  const strips = new Map<number, { ends: [number, number]; left: number; right: number; rows: Map<number, number[]> }>()
  for (const edge of bevelled) {
    const [first, second] = mesh.edgeVertices(edge)
    const sides = mesh.edgeFaces(edge)
    const left = sides.find((face) => mesh.loopNext(face, first) === second) ?? sides[0]!
    const right = sides.find((face) => face !== left) ?? sides[1]!
    const rows = new Map<number, number[]>()
    for (const vertex of [first, second]) {
      const from = cornerSlots.get(`${left}:${vertex}`)
      const to = cornerSlots.get(`${right}:${vertex}`)
      if (from === undefined || to === undefined) continue
      rows.set(vertex, profileRow(mesh, mesh.position(vertex), from, to, segments, profile))
    }
    strips.set(edge, { ends: [first, second], left, right, rows })
  }

  /* What replaces the vertex in each face, and the rim of the hole left over it. */
  const plans: VertexPlan[] = []
  for (const [vertex, fan] of fans) {
    const count = fan.edges.length
    const sideOf = (face: number, edge: number): number => {
      if (inBevel.has(edge)) return cornerSlots.get(`${face}:${vertex}`) ?? vertex
      return railSlots.get(`${vertex}:${edge}`) ?? vertex
    }
    const chains = new Map<number, { fromEdge: number; slots: number[] }>()
    const cycle: number[] = []
    let outward: Vec3 = [0, 0, 0]
    for (let index = 0; index < count; index += 1) {
      const face = fan.faces[index]!
      const before = fan.edges[index]!
      const after = fan.edges[(index + 1) % count]!
      chains.set(face, { fromEdge: before, slots: tighten([sideOf(face, before), sideOf(face, after)]) })
      outward = add(outward, mesh.faceNormal(face))
      const strip = strips.get(before)
      if (strip) {
        const row = strip.rows.get(vertex) ?? []
        // The row runs from the left face to the right one; the fan may be turning the other way.
        cycle.push(...(strip.left === fan.faces[(index + count - 1) % count] ? row : [...row].reverse()))
      } else {
        cycle.push(railSlots.get(`${vertex}:${before}`) ?? vertex)
      }
      const own = cornerSlots.get(`${face}:${vertex}`)
      if (own !== undefined) cycle.push(own)
    }
    plans.push({ vertex, chains, cycle: tighten(cycle), outward, source: fan.faces[0]! })
  }

  const created: number[] = []
  for (const strip of strips.values()) {
    const [first, second] = strip.ends
    const near = strip.rows.get(first)
    const far = strip.rows.get(second)
    if (!near || !far) continue
    for (let step = 0; step < segments; step += 1) {
      const face = mesh.addFace([far[step]!, near[step]!, near[step + 1]!, far[step + 1]!])
      if (face < 0) continue
      dress(mesh, face, strip.left, params)
      created.push(mesh.faceId(face))
    }
    markEdge(mesh, near[0]!, far[0]!, params)
    markEdge(mesh, near[segments]!, far[segments]!, params)
  }
  applyPlans(mesh, plans, params, created)
  clearAway(mesh, opened, touched)
  return { select: { faces: created.map((id) => mesh.slotOfFace(id)).filter((slot) => slot >= 0) } }
}

/* ---------------------------------------------------------- bevelling vertices */

function bevelVertices(target: EditTarget, params: BevelParams): EditOutcome {
  const mesh = target.mesh
  const wanted = [...selectedVertices(target)].filter((vertex) => mesh.hasVertex(vertex))
  if (wanted.length === 0) return null
  const fans = new Map<number, Fan>()
  for (const vertex of wanted) {
    const fan = fanAround(mesh, vertex)
    if (!fan) {
      return `Deselect vertex ${mesh.vertexId(vertex)}: a bevel rounds a corner off, and the faces there do not close a ring around it.`
    }
    fans.set(vertex, fan)
  }
  const segments = segmentsOf(params)
  const profile = profileOf(params)
  const type = chosen(params.offsetType, OFFSET_TYPES, 'offset')
  const created: number[] = []
  const plans: VertexPlan[] = []
  const touched = new Set<number>()

  for (const [vertex, fan] of fans) {
    const width = widthAt(mesh, vertex, params)
    const rails = new Map<number, number>()
    for (const edge of fan.edges) {
      touched.add(edge)
      // A corner bevel is measured along the edges themselves, so only percent has to be converted.
      const reach = type === 'percent' ? (width / 100) * mesh.edgeLength(edge) : width
      const point = add(mesh.position(vertex), scale(towards(mesh, vertex, otherEnd(mesh, edge, vertex)), reach))
      rails.set(edge, mesh.addVertex(point))
    }
    const chains = new Map<number, { fromEdge: number; slots: number[] }>()
    const cycle: number[] = []
    let outward: Vec3 = [0, 0, 0]
    const count = fan.edges.length
    for (let index = 0; index < count; index += 1) {
      const face = fan.faces[index]!
      const before = fan.edges[index]!
      const after = fan.edges[(index + 1) % count]!
      const row = profileRow(mesh, mesh.position(vertex), rails.get(before)!, rails.get(after)!, segments, profile)
      chains.set(face, { fromEdge: before, slots: row })
      outward = add(outward, mesh.faceNormal(face))
      cycle.push(...row.slice(0, row.length - 1))
      markEdge(mesh, row[0]!, row[1]!, params)
    }
    plans.push({ vertex, chains, cycle: tighten(cycle), outward, source: fan.faces[0]! })
  }
  applyPlans(mesh, plans, params, created)
  clearAway(mesh, [...fans.keys()], touched)
  return { select: { faces: created.map((id) => mesh.slotOfFace(id)).filter((slot) => slot >= 0) } }
}

/* ---------------------------------------------------------------- the operators */

function bevel(target: EditTarget, params: BevelParams): EditOutcome {
  return chosen(params.affect, AFFECT, 'edges') === 'vertices' ? bevelVertices(target, params) : bevelEdges(target, params)
}

/**
 * The two entries share every parameter, because in Blender they are one operator under two
 * keystrokes: ⇧⌃B is ⌃B with Affect already set to vertices, and the F9 panel can turn either into
 * the other.
 */
function bevelParams(affect: (typeof AFFECT)[number]): ParamSchema {
  return [
    numberParam('width', 'Width', { min: 0, max: 1000, step: 0.01, defaultValue: 0, unit: 'm' }),
    numberParam('segments', 'Segments', { min: 1, max: MAX_SEGMENTS, step: 1, defaultValue: 1, view: 'stepper' }),
    numberParam('profile', 'Shape', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' }),
    selectParam('affect', 'Affect', [
      { value: 'edges', label: 'Edges' },
      { value: 'vertices', label: 'Vertices' },
    ], affect),
    switchParam('clampOverlap', 'Clamp overlap', true),
    selectParam('offsetType', 'Width type', [
      { value: 'offset', label: 'Offset' },
      { value: 'width', label: 'Width' },
      { value: 'depth', label: 'Depth' },
      { value: 'percent', label: 'Per cent' },
      { value: 'absolute', label: 'Absolute' },
    ], 'offset'),
    // The two miters are declared because the panel and the keymap are generated from this list and
    // a field that appears later would move every one below it. Only sharp is built: patch and arc
    // reshape the vertex mesh where a bevel runs out, and that is a piece of work of its own.
    selectParam('miterOuter', 'Outer miter', [
      { value: 'sharp', label: 'Sharp' },
      { value: 'patch', label: 'Patch' },
      { value: 'arc', label: 'Arc' },
    ], 'sharp'),
    selectParam('miterInner', 'Inner miter', [
      { value: 'sharp', label: 'Sharp' },
      { value: 'arc', label: 'Arc' },
    ], 'sharp'),
    switchParam('markSeam', 'Mark seams', false),
    switchParam('markSharp', 'Mark sharp', false),
    numberParam('material', 'Material', { min: -1, max: 32, step: 1, defaultValue: -1, view: 'stepper' }),
    switchParam('harden', 'Harden normals', false),
  ]
}

function bevelDefaults(affect: (typeof AFFECT)[number]): BevelParams {
  return {
    width: 0,
    segments: 1,
    profile: 0.5,
    affect,
    clampOverlap: true,
    offsetType: 'offset',
    miterOuter: 'sharp',
    miterInner: 'sharp',
    markSeam: false,
    markSharp: false,
    material: -1,
    harden: false,
  }
}

registerOperator<BevelParams>({
  id: 'mesh.bevelEdges',
  label: 'Bevel edges',
  section: 'Edge',
  shortcut: '⌃B',
  icon: 'bevel',
  description: 'Open the selected edges out into strips of faces along a profile.',
  params: bevelParams('edges'),
  defaults: bevelDefaults('edges'),
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context, params) => runOnMeshes(context, (target) => bevel(target, params), { label: 'Bevel edges' }),
})

registerOperator<BevelParams>({
  id: 'mesh.bevelVertices',
  label: 'Bevel vertices',
  section: 'Vertex',
  shortcut: '⇧⌃B',
  icon: 'bevel',
  description: 'Round each selected corner off into a face of its own.',
  params: bevelParams('vertices'),
  defaults: bevelDefaults('vertices'),
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'vertex'),
  run: (context, params) => runOnMeshes(context, (target) => bevel(target, params), { label: 'Bevel vertices' }),
})
