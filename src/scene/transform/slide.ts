import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, dot, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import type { Vec3 } from '@/scene/types'

/**
 * Sliding: G G, and ⇧V.
 *
 * A slide is not a move. A moved vertex goes wherever the pointer says; a slid vertex stays on the
 * edges it already belongs to, which is what keeps a loop on the surface it was cut into. So each
 * vertex is given its two *rails* — the edges leaving it that are not part of what is being slid —
 * and a single factor between −1 and 1 walks every vertex along its own pair at once.
 *
 * Choosing which rail is the positive one is the whole difficulty. Taken vertex by vertex the
 * choice is arbitrary, and an arbitrary choice made twice along a loop tears it in half. The rails
 * are therefore chosen once, at the first vertex, and carried along the loop: each next vertex
 * takes the rail that points the same way as its neighbour's.
 */

export type VertexRails = {
  slot: number
  origin: Vec3
  /** Where the vertex lands at factor −1 and at factor 1. */
  negative: Vec3
  positive: Vec3
}

export type SlideOptions = {
  /**
   * Blender's "even": every vertex moves the same distance, taken from the vertex the pointer is
   * nearest, rather than each moving a share of its own rail. It keeps a loop parallel to the edge
   * it started from on a mesh whose rails are not all the same length.
   */
  even: boolean
  /** Swap which side is positive, which is Blender's F during a slide. */
  flipped: boolean
  /** Keep the factor inside the rails; off, a loop can be pushed past its neighbours. */
  clamp: boolean
}

export const DEFAULT_SLIDE: SlideOptions = { even: false, flipped: false, clamp: true }

/**
 * The rails for an edge slide, or the reason there are none.
 *
 * A vertex on the loop needs exactly two edges that are not on it. A vertex with one is at the end
 * of an open loop and slides along that one alone; a vertex with three or more is a pole, and
 * Blender refuses the slide there rather than guessing which way it should go.
 */
export function edgeSlideRails(mesh: EditMesh, edges: Set<number>): VertexRails[] | string {
  if (edges.size === 0) return 'Select an edge loop to slide.'
  const vertices = new Set<number>()
  for (const edge of edges) for (const end of mesh.edgeVertices(edge)) if (end >= 0) vertices.add(end)
  const order = [...vertices].sort((a, b) => a - b)
  const rails: VertexRails[] = []
  let reference: Vec3 | null = null
  for (const slot of order) {
    const origin = mesh.position(slot)
    const free = mesh.vertexEdges(slot).filter((edge) => !edges.has(edge))
    if (free.length === 0) return 'These edges have nothing to slide along.'
    if (free.length > 2) return 'A vertex where more than two other edges meet has no side to slide to.'
    const ends = free.map((edge) => {
      const [a, b] = mesh.edgeVertices(edge)
      return mesh.position(a === slot ? b : a)
    })
    const first = ends[0]!
    const second = ends[1] ?? origin
    const direction = normalize(subtract(first, origin))
    // The first vertex sets which side is positive; every other one follows it, so the loop stays
    // in one piece instead of folding where two neighbours disagreed.
    const aligned = reference === null ? true : dot(direction, reference) >= 0
    if (reference === null) reference = direction
    rails.push({
      slot,
      origin,
      positive: aligned ? first : second,
      negative: aligned ? second : first,
    })
  }
  return rails
}

/** Where each vertex sits at a factor. The map is keyed by slot, ready for a transform to write. */
export function slidePositions(rails: VertexRails[], factor: number, options: SlideOptions = DEFAULT_SLIDE): Map<number, Vec3> {
  const bounded = options.clamp ? Math.max(-1, Math.min(1, factor)) : factor
  const signed = options.flipped ? -bounded : bounded
  const even = options.even ? shortestRail(rails, signed) : null
  const points = new Map<number, Vec3>()
  for (const rail of rails) {
    const towards = signed >= 0 ? rail.positive : rail.negative
    const along = subtract(towards, rail.origin)
    const span = length(along)
    if (span < 1e-12) {
      points.set(rail.slot, rail.origin)
      continue
    }
    const distance = even === null ? Math.abs(signed) * span : Math.min(even, span)
    points.set(rail.slot, add(rail.origin, scale(normalize(along), distance)))
  }
  return points
}

/** How far the shortest rail would travel, which is what "even" holds every vertex to. */
function shortestRail(rails: VertexRails[], factor: number): number {
  let shortest = Number.POSITIVE_INFINITY
  for (const rail of rails) {
    const towards = factor >= 0 ? rail.positive : rail.negative
    shortest = Math.min(shortest, length(subtract(towards, rail.origin)))
  }
  return Number.isFinite(shortest) ? Math.abs(factor) * shortest : 0
}

/**
 * ⇧V: one vertex sliding along one of the edges at it.
 *
 * The edge is chosen by the caller — in the viewport, by which of them the pointer is nearest, and
 * from the panel, by the parameter. A factor of one puts the vertex on the far end.
 */
export function vertexSlide(mesh: EditMesh, slot: number, edgeSlot: number, factor: number, clamp = true): Vec3 | null {
  if (!mesh.hasVertex(slot) || !mesh.hasEdge(edgeSlot)) return null
  const [a, b] = mesh.edgeVertices(edgeSlot)
  if (a !== slot && b !== slot) return null
  const origin = mesh.position(slot)
  const target = mesh.position(a === slot ? b : a)
  const bounded = clamp ? Math.max(0, Math.min(1, factor)) : factor
  return add(origin, scale(subtract(target, origin), bounded))
}

/**
 * ⌥S: every selected vertex moves along its own normal.
 *
 * "Even thickness" divides by the cosine between the vertex's normal and the faces it belongs to,
 * so a shell keeps its thickness at a corner instead of pinching — which is the difference between
 * a solidified box with square corners and one with dented ones.
 */
export function shrinkFatten(mesh: EditMesh, slots: Iterable<number>, offset: number, even = true): Map<number, Vec3> {
  const points = new Map<number, Vec3>()
  for (const slot of slots) {
    if (!mesh.hasVertex(slot)) continue
    const normal = mesh.vertexNormal(slot)
    if (length(normal) < 1e-9) continue
    let factor = 1
    if (even) {
      const faces = mesh.vertexFaces(slot)
      let smallest = 1
      for (const face of faces) smallest = Math.min(smallest, Math.abs(dot(normal, mesh.faceNormal(face))))
      factor = smallest > 1e-3 ? 1 / smallest : 1
    }
    points.set(slot, add(mesh.position(slot), scale(normal, offset * factor)))
  }
  return points
}

/** ⇧⌥S: every selected vertex moves onto the sphere through the selection's median. */
export function toSphere(mesh: EditMesh, slots: Iterable<number>, factor: number): Map<number, Vec3> {
  const chosen = [...slots].filter((slot) => mesh.hasVertex(slot))
  if (chosen.length === 0) return new Map()
  const centre = mesh.median(chosen)
  let radius = 0
  for (const slot of chosen) radius += length(subtract(mesh.position(slot), centre))
  radius /= chosen.length
  const blend = Math.max(0, Math.min(1, factor))
  const points = new Map<number, Vec3>()
  for (const slot of chosen) {
    const here = mesh.position(slot)
    const out = subtract(here, centre)
    const span = length(out)
    if (span < 1e-9) continue
    const onSphere = add(centre, scale(normalize(out), radius))
    points.set(slot, [
      here[0] + (onSphere[0] - here[0]) * blend,
      here[1] + (onSphere[1] - here[1]) * blend,
      here[2] + (onSphere[2] - here[2]) * blend,
    ])
  }
  return points
}

/**
 * ⇧⌃⌥S: the selection leans, each vertex moving along one axis in proportion to its distance along
 * another. The two axes come from the view, which is what makes the gesture read as a lean.
 */
export function shear(mesh: EditMesh, slots: Iterable<number>, along: Vec3, across: Vec3, offset: number): Map<number, Vec3> {
  const chosen = [...slots].filter((slot) => mesh.hasVertex(slot))
  if (chosen.length === 0) return new Map()
  const centre = mesh.median(chosen)
  const direction = length(along) > 1e-9 ? normalize(along) : [1, 0, 0] as Vec3
  const axis = length(across) > 1e-9 ? normalize(across) : [0, 0, 1] as Vec3
  const points = new Map<number, Vec3>()
  for (const slot of chosen) {
    const here = mesh.position(slot)
    const reach = dot(subtract(here, centre), axis)
    points.set(slot, add(here, scale(direction, reach * offset)))
  }
  return points
}

/** Push and pull: the selection swells or shrinks about its own median. */
export function pushPull(mesh: EditMesh, slots: Iterable<number>, offset: number): Map<number, Vec3> {
  const chosen = [...slots].filter((slot) => mesh.hasVertex(slot))
  if (chosen.length === 0) return new Map()
  const centre = mesh.median(chosen)
  const points = new Map<number, Vec3>()
  for (const slot of chosen) {
    const here = mesh.position(slot)
    const out = subtract(here, centre)
    const span = length(out)
    if (span < 1e-9) continue
    points.set(slot, add(here, scale(normalize(out), offset)))
  }
  return points
}
