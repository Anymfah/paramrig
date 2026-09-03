import { edgeKey, parseEdgeKey } from '@/scene/mesh/data'
import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, cross, dot, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import type { EdgeKey, ElementIds, ElementRef, SceneSelection, SelectMode, Vec3 } from '@/scene/types'

/**
 * What is selected in edit mode, and every question the select operators ask of it.
 *
 * A document stores its edit-mode selection by stable id, because slots renumber under the person's
 * hands and a selection that renumbered with them would jump to other geometry after every delete.
 * Working with ids means every query here goes through the mesh to find the slot; that is the price
 * of a selection that survives, and it is paid one lookup at a time rather than by a scan.
 *
 * Everything in this module is pure: a selection goes in, a new selection comes out, and nothing is
 * mutated in place — which is what lets the operators be replayed by the redo panel.
 */

/** A selection in the form the operators work in: vertex ids, edge keys, face ids. */
export type ElementSelection = { vertices: Set<number>; edges: Set<EdgeKey>; faces: Set<number> }

/** Which trait `selectSimilar` compares. Each one belongs to one or two of the select modes. */
export type SimilarTrait =
  | 'length'
  | 'direction'
  | 'seam'
  | 'sharp'
  | 'crease'
  | 'area'
  | 'perimeter'
  | 'sides'
  | 'material'
  | 'valence'
  | 'normal'

/** The traits `selectByTrait` finds, which is Blender's Select All by Trait menu. */
export type MeshTrait = 'non-manifold' | 'loose' | 'interior' | 'boundary' | 'sharp' | 'faces-by-sides'

/** How `faces-by-sides` reads the corner count it is given. */
export type SideComparison = 'equal' | 'greater' | 'less'

/**
 * Everything `selectByTrait` needs besides the trait's name. One flat bag rather than one shape per
 * trait, because the redo panel hands its fields over one by one and a trait that does not read a
 * field simply ignores it.
 */
export type TraitOptions = {
  /** Any trait: the corner counts a face must fall between to be kept. */
  min?: number
  max?: number
  /** `faces-by-sides`: how many corners to compare a face with, and which way round. */
  sides?: number
  comparison?: SideComparison
  /** `sharp`: how far the two faces at an edge must fold apart, in radians. */
  angle?: number
  /** `non-manifold`: which kinds of trouble to look for. Each is on unless it is turned off. */
  wire?: boolean
  boundary?: boolean
  multipleFaces?: boolean
  nonContiguous?: boolean
  vertices?: boolean
}

/**
 * An element named the way a click names one: a kind and an id, an edge's id being its key. An
 * `ElementRef` from a document fits here as it stands, which is what the viewport hands over.
 */
export type ElementPick = { kind: SelectMode; id: number | EdgeKey }

/** Which axis a side or a mirror works along: X, Y or Z. */
export type Axis = 0 | 1 | 2

/** What `growSelection` and `shrinkSelection` take besides the mode. */
export type StepOptions = {
  /**
   * Blender's face step: an element joins when it shares a *face* with a selected one rather than
   * only when it shares an edge, so a selection grows diagonally across a quad's corners.
   */
  faceStep?: boolean
}

/** What `selectShortestPath` takes besides its two ends. */
export type PathOptions = {
  /**
   * Blender's Fill Region: everything lying between the two ends rather than the one run the walk
   * happened to find, which on a grid is the whole block the two corners bound.
   */
  fillRegion?: boolean
}

/** Where a linked flood stops: an edge carrying the attribute, or a change of face material. */
export type LinkDelimiters = { seam?: boolean; sharp?: boolean; material?: boolean }

/**
 * How far apart two normals may point and still count as similar, on top of the caller's threshold.
 * Two faces built from the same numbers do not always come out with a dot product of exactly one,
 * and a threshold of zero has to mean “the same way” rather than “never”.
 */
const NORMAL_TOLERANCE = 1e-6

/** Blender's default for Select Sharp Edges: the fold two faces must make to count as an edge. */
const SHARP_ANGLE = Math.PI / 6

/** How far off the plane a vertex may sit and still count as level with the active element. */
const AXIS_TOLERANCE = 1e-4

/**
 * How much dearer than the cheapest a route may be and still be part of the filled region. A grid's
 * every staircase between two corners costs the same in exact arithmetic and not quite the same in
 * floating point, and a fill that dropped half of them for the last bit of a metre would be wrong.
 */
const PATH_TOLERANCE = 1e-9

/* --------------------------------------------------------------- documents */

export function toElements(selection: SceneSelection, objectId?: string): ElementSelection {
  const id = objectId ?? selection.activeObjectId ?? ''
  const stored = selection.elements?.[id]
  return {
    vertices: readIds(stored?.vertices),
    edges: readKeys(stored?.edges),
    faces: readIds(stored?.faces),
  }
}

/** Every object the selection is editing, active first, which is the order operators run in. */
export function editedObjectIds(selection: SceneSelection): string[] {
  const ids = selection.editObjectIds ?? []
  const active = selection.activeObjectId
  if (!active || !ids.includes(active)) return [...ids]
  return [active, ...ids.filter((id) => id !== active)]
}

/**
 * The document's half of the round trip. The lists come out sorted so that two selections holding
 * the same elements are the same document, whatever order the operators put them in.
 */
export function fromElements(elements: ElementSelection): ElementIds {
  return {
    vertices: sortedNumbers(elements.vertices).map((id) => String(id)),
    edges: sortedKeys(elements.edges),
    faces: sortedNumbers(elements.faces).map((id) => String(id)),
  }
}

/**
 * One object's entry replaced, everything else left alone. The active element is dropped when it is
 * no longer in the selection — an active that has been deselected would keep steering the pivot and
 * the normal orientation from geometry nobody can see is chosen.
 */
export function withElements(
  selection: SceneSelection,
  objectId: string,
  elements: ElementSelection,
  active?: ElementRef | null,
): SceneSelection {
  const next: SceneSelection = {
    ...selection,
    elements: { ...(selection.elements ?? {}), [objectId]: fromElements(elements) },
  }
  const chosen = active === undefined ? selection.active ?? null : active
  next.active = chosen && holds(next, chosen) ? chosen : promoteActive(next, chosen)
  if (active) {
    const history = (selection.elementHistory ?? []).filter((entry) => !sameElement(entry, active))
    next.elementHistory = [...history, active].slice(-64)
  } else {
    next.elementHistory = (selection.elementHistory ?? []).filter((entry) => holds(next, entry))
  }
  return next
}

/** Whether a selection still holds an element, which is what makes an active one still valid. */
export function holds(selection: SceneSelection, element: ElementRef): boolean {
  const stored = selection.elements?.[element.objectId]
  if (!stored) return false
  if (element.kind === 'vertex') return stored.vertices.includes(element.id)
  if (element.kind === 'edge') return stored.edges.includes(element.id)
  return stored.faces.includes(element.id)
}

/** The most recent pick that is still selected: what the active becomes when the active goes. */
export function promoteActive(selection: SceneSelection, dropped?: ElementRef | null): ElementRef | null {
  const history = selection.elementHistory ?? []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]!
    if (dropped && sameElement(entry, dropped)) continue
    if (holds(selection, entry)) return entry
  }
  return null
}

export function sameElement(a: ElementRef, b: ElementRef): boolean {
  return a.kind === b.kind && a.objectId === b.objectId && a.id === b.id
}

/* ----------------------------------------------------------------- flushing */

/** Blender's rule: selecting a face selects its edges and vertices, and an edge its vertices. */
export function propagateDown(mesh: EditMesh, elements: ElementSelection): ElementSelection {
  const next = copy(elements)
  for (const id of elements.faces) {
    const face = mesh.slotOfFace(id)
    if (face < 0) continue
    for (const edge of mesh.faceEdges(face)) {
      const key = keyOfEdge(mesh, edge)
      if (key) next.edges.add(key)
    }
    for (const slot of mesh.faceVertices(face)) next.vertices.add(mesh.vertexId(slot))
  }
  for (const key of next.edges) {
    const pair = parseEdgeKey(key)
    if (!pair) continue
    next.vertices.add(pair[0])
    next.vertices.add(pair[1])
  }
  return next
}

/** And the other way: an edge is selected when both its ends are, a face when all its edges are. */
export function propagateUp(mesh: EditMesh, elements: ElementSelection): ElementSelection {
  const next = copy(elements)
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    const [a, b] = mesh.edgeVertices(edge)
    const first = mesh.vertexId(a)
    const second = mesh.vertexId(b)
    if (!next.vertices.has(first) || !next.vertices.has(second)) continue
    next.edges.add(edgeKey(first, second))
  }
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const edges = mesh.faceEdges(face)
    if (edges.length === 0) continue
    const whole = edges.every((edge) => {
      const key = keyOfEdge(mesh, edge)
      return key !== null && next.edges.has(key)
    })
    if (whole) next.faces.add(mesh.faceId(face))
  }
  return next
}

/**
 * The selection as the new modes see it. Going finer keeps everything the old modes covered — a
 * face's vertices stay selected when face mode gives way to vertex mode. Going coarser keeps only
 * what is wholly selected, so a stray vertex does not drag a face along with it.
 */
export function convertSelectMode(mesh: EditMesh, elements: ElementSelection, from: SelectMode[], to: SelectMode[]): ElementSelection {
  const kept = restrict(elements, from)
  return restrict(propagateUp(mesh, propagateDown(mesh, kept)), to)
}

/* ---------------------------------------------------------------- the basics */

export function selectAll(mesh: EditMesh): ElementSelection {
  const vertices = new Set<number>()
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) vertices.add(mesh.vertexId(slot))
  const edges = new Set<EdgeKey>()
  for (let slot = 0; slot < mesh.edgeCount; slot += 1) {
    const key = keyOfEdge(mesh, slot)
    if (key) edges.add(key)
  }
  const faces = new Set<number>()
  for (let slot = 0; slot < mesh.faceCount; slot += 1) faces.add(mesh.faceId(slot))
  return { vertices, edges, faces }
}

export function selectNone(): ElementSelection {
  return { vertices: new Set(), edges: new Set(), faces: new Set() }
}

/** Swaps selected for unselected in one mode, and leaves the other two as they were. */
export function invertSelection(mesh: EditMesh, elements: ElementSelection, mode: SelectMode): ElementSelection {
  const everything = selectAll(mesh)
  const next = copy(elements)
  if (mode === 'vertex') next.vertices = difference(everything.vertices, elements.vertices)
  if (mode === 'edge') next.edges = difference(everything.edges, elements.edges)
  if (mode === 'face') next.faces = difference(everything.faces, elements.faces)
  return next
}

/**
 * Blender's Select More, in the one sense that holds for all three modes: an element joins the
 * selection when it touches a selected one across an edge — or, with `faceStep`, when it merely
 * shares a face with one, which is how a selection spreads to a quad's opposite corner.
 */
export function growSelection(
  mesh: EditMesh,
  elements: ElementSelection,
  mode: SelectMode,
  options: StepOptions = {},
): ElementSelection {
  const next = copy(elements)
  if (mode === 'vertex') {
    for (const id of elements.vertices) {
      const slot = mesh.slotOfVertex(id)
      if (slot < 0) continue
      if (options.faceStep) {
        for (const face of mesh.vertexFaces(slot)) {
          for (const corner of mesh.faceVertices(face)) next.vertices.add(mesh.vertexId(corner))
        }
        continue
      }
      for (const edge of mesh.vertexEdges(slot)) {
        for (const end of mesh.edgeVertices(edge)) next.vertices.add(mesh.vertexId(end))
      }
    }
    return next
  }
  if (mode === 'edge') {
    for (const key of elements.edges) {
      const edge = edgeOfKey(mesh, key)
      if (edge < 0) continue
      if (options.faceStep) {
        for (const face of mesh.edgeFaces(edge)) {
          for (const neighbour of mesh.faceEdges(face)) {
            const name = keyOfEdge(mesh, neighbour)
            if (name) next.edges.add(name)
          }
        }
        continue
      }
      for (const end of mesh.edgeVertices(edge)) {
        for (const neighbour of mesh.vertexEdges(end)) {
          const name = keyOfEdge(mesh, neighbour)
          if (name) next.edges.add(name)
        }
      }
    }
    return next
  }
  for (const id of elements.faces) {
    const face = mesh.slotOfFace(id)
    if (face < 0) continue
    if (options.faceStep) {
      for (const corner of mesh.faceVertices(face)) {
        for (const neighbour of mesh.vertexFaces(corner)) next.faces.add(mesh.faceId(neighbour))
      }
      continue
    }
    for (const edge of mesh.faceEdges(face)) {
      for (const neighbour of mesh.edgeFaces(edge)) next.faces.add(mesh.faceId(neighbour))
    }
  }
  return next
}

/**
 * Blender's Select Less. An element stays selected when everything `growSelection` would have
 * reached from it is selected too, and when it sits nowhere near an open border — which is what
 * makes a full selection on a grid peel back by one ring, and leaves a closed mesh alone.
 *
 * `faceStep` widens what “reached from it” means the same way it does for More, so a face keeps its
 * place only when the eight faces round it are selected rather than the four across its edges.
 */
export function shrinkSelection(
  mesh: EditMesh,
  elements: ElementSelection,
  mode: SelectMode,
  options: StepOptions = {},
): ElementSelection {
  const next = copy(elements)
  if (mode === 'vertex') {
    next.vertices = new Set([...elements.vertices].filter((id) => {
      const slot = mesh.slotOfVertex(id)
      if (slot < 0) return false
      if (!mesh.vertexEdges(slot).every((edge) => mesh.edgeFaces(edge).length === 2)) return false
      if (options.faceStep) {
        return mesh.vertexFaces(slot).every((face) => mesh.faceVertices(face)
          .every((corner) => elements.vertices.has(mesh.vertexId(corner))))
      }
      return mesh.vertexEdges(slot).every((edge) => mesh.edgeVertices(edge)
        .every((end) => elements.vertices.has(mesh.vertexId(end))))
    }))
    return next
  }
  if (mode === 'edge') {
    next.edges = new Set([...elements.edges].filter((key) => {
      const edge = edgeOfKey(mesh, key)
      if (edge < 0 || mesh.edgeFaces(edge).length !== 2) return false
      const holdsEdge = (neighbour: number): boolean => {
        const name = keyOfEdge(mesh, neighbour)
        return name !== null && elements.edges.has(name)
      }
      if (options.faceStep) {
        return mesh.edgeFaces(edge).every((face) => mesh.faceEdges(face).every(holdsEdge))
      }
      return mesh.edgeVertices(edge).every((end) => mesh.vertexEdges(end).every(holdsEdge))
    }))
    return next
  }
  next.faces = new Set([...elements.faces].filter((id) => {
    const face = mesh.slotOfFace(id)
    if (face < 0) return false
    if (!mesh.faceEdges(face).every((edge) => mesh.edgeFaces(edge).length === 2)) return false
    if (options.faceStep) {
      return mesh.faceVertices(face).every((corner) => mesh.vertexFaces(corner)
        .every((neighbour) => elements.faces.has(mesh.faceId(neighbour))))
    }
    return mesh.faceEdges(face).every((edge) => mesh.edgeFaces(edge)
      .every((neighbour) => elements.faces.has(mesh.faceId(neighbour))))
  }))
  return next
}

/* ------------------------------------------------------------- by topology */

/** Everything joined to what is already selected, by edges, then flushed back up. */
export function selectLinked(mesh: EditMesh, elements: ElementSelection): ElementSelection {
  const seeds = propagateDown(mesh, elements)
  const vertices = new Set<number>()
  for (const id of seeds.vertices) {
    if (vertices.has(id)) continue
    const slot = mesh.slotOfVertex(id)
    if (slot < 0) continue
    for (const reached of mesh.linked(slot)) vertices.add(mesh.vertexId(reached))
  }
  return propagateUp(mesh, { vertices, edges: new Set(), faces: new Set() })
}

export function selectLoop(mesh: EditMesh, edgeSlot: number): ElementSelection {
  return fromEdgeRun(mesh, mesh.edgeLoop(edgeSlot))
}

export function selectRing(mesh: EditMesh, edgeSlot: number): ElementSelection {
  return fromEdgeRun(mesh, mesh.edgeRing(edgeSlot))
}

/**
 * Blender's Region to Loop: the edges around the selected faces, the ones with a selected face on
 * one side and nothing on the other. With no face selected there is no region, so it falls back to
 * the mesh's own boundary, which is the answer that question has when it is asked of a bare mesh.
 */
export function selectBoundary(mesh: EditMesh, elements: ElementSelection): ElementSelection {
  const region = elements.faces
  const edges = new Set<EdgeKey>()
  const vertices = new Set<number>()
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    const around = mesh.edgeFaces(edge)
    const inside = around.filter((face) => region.has(mesh.faceId(face))).length
    const onBoundary = region.size === 0
      ? around.length === 1
      : inside > 0 && (inside < around.length || around.length === 1)
    if (!onBoundary) continue
    const key = keyOfEdge(mesh, edge)
    if (!key) continue
    edges.add(key)
    for (const end of mesh.edgeVertices(edge)) vertices.add(mesh.vertexId(end))
  }
  return { vertices, edges, faces: new Set() }
}

/**
 * Blender's ⌃ click: the cheapest run of elements from the active one to the one just clicked,
 * added to what is already selected.
 *
 * Cheapest is by distance, not by number of steps — the run a person traces along a seam is the
 * short way round, not the way with the fewest corners. Vertices and edges walk the mesh's own
 * shortest path; faces walk their centres across shared edges, which is the same idea on the dual.
 *
 * With `fillRegion` the answer is not one run but everything lying between the two ends: every
 * element whose own cheapest way from one end to the other costs no more than the run itself. On a
 * grid that fills the whole block the two corners bound, which is what the option is for.
 *
 * The two ends must be of the same kind; a mismatch leaves the selection as it was, because a path
 * from a vertex to a face is a question with no answer rather than a mistake worth refusing over.
 */
export function selectShortestPath(
  mesh: EditMesh,
  elements: ElementSelection,
  from: ElementPick,
  to: ElementPick,
  options: PathOptions = {},
): ElementSelection {
  const next = copy(elements)
  if (from.kind !== to.kind) return next
  if (from.kind === 'vertex') {
    const start = mesh.slotOfVertex(Number(from.id))
    const end = mesh.slotOfVertex(Number(to.id))
    if (start < 0 || end < 0) return next
    const run = options.fillRegion
      ? routeBand(vertexGraph(mesh), start, end)
      : mesh.shortestPath(start, end)
    for (const slot of run) next.vertices.add(mesh.vertexId(slot))
    return next
  }
  if (from.kind === 'face') {
    const start = mesh.slotOfFace(Number(from.id))
    const end = mesh.slotOfFace(Number(to.id))
    if (start < 0 || end < 0) return next
    const graph = faceGraph(mesh)
    const run = options.fillRegion ? routeBand(graph, start, end) : route(graph, start, end)
    for (const slot of run) next.faces.add(mesh.faceId(slot))
    return next
  }
  const first = edgeOfKey(mesh, String(from.id))
  const second = edgeOfKey(mesh, String(to.id))
  if (first < 0 || second < 0) return next
  const ends = nearestEnds(mesh, first, second)
  if (!ends) return next
  addEdge(mesh, next, first)
  addEdge(mesh, next, second)
  if (options.fillRegion) {
    const band = new Set(routeBand(vertexGraph(mesh), ends.from, ends.to))
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      const [a, b] = mesh.edgeVertices(edge)
      if (band.has(a) && band.has(b)) addEdge(mesh, next, edge)
    }
    return next
  }
  for (let index = 0; index + 1 < ends.path.length; index += 1) {
    const edge = mesh.edgeSlot(ends.path[index]!, ends.path[index + 1]!)
    if (edge >= 0) addEdge(mesh, next, edge)
  }
  return next
}

/**
 * Blender's L: the part of the mesh the pointer is over, flooded from there and stopped by the
 * delimiters — an edge marked as a seam or as sharp, or a change of material from one face to the
 * next. It is what a person uses to pick one island of a UV layout, or one shell of a bolt.
 *
 * With no delimiter the flood is over vertices, so a loose edge and a lone corner come along; with
 * one, it is over faces, because a seam is a wall between faces and means nothing to a wire.
 */
export function selectLinkedFrom(
  mesh: EditMesh,
  elements: ElementSelection,
  seed: ElementPick,
  delimiters: LinkDelimiters = {},
): ElementSelection {
  const walled = delimiters.seam === true || delimiters.sharp === true || delimiters.material === true
  const seeds = seedFaces(mesh, seed)
  if (!walled || seeds.length === 0) {
    const start = seedVertex(mesh, seed)
    if (start < 0) return copy(elements)
    const reached = selectNone()
    for (const slot of mesh.linked(start)) reached.vertices.add(mesh.vertexId(slot))
    return merge(copy(elements), propagateUp(mesh, reached))
  }
  const reached = new Set<number>(seeds)
  const queue = [...seeds]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const face = queue[cursor]!
    for (const edge of mesh.faceEdges(face)) {
      if (delimiters.seam && mesh.edgeFlag(edge, 'seam')) continue
      if (delimiters.sharp && mesh.edgeFlag(edge, 'sharp')) continue
      for (const other of mesh.edgeFaces(edge)) {
        if (reached.has(other)) continue
        if (delimiters.material && mesh.faceMaterial(other) !== mesh.faceMaterial(face)) continue
        reached.add(other)
        queue.push(other)
      }
    }
  }
  const found = selectNone()
  for (const face of reached) found.faces.add(mesh.faceId(face))
  return merge(copy(elements), propagateDown(mesh, found))
}

/**
 * Blender's Select Loop Inner-Region: the faces a selected loop of edges encloses.
 *
 * The loop is a wall, and the faces fall into groups that cannot reach each other without crossing
 * it. The biggest group is the outside — that is what “inside” means on a surface with no up — and
 * everything else is what the loop encloses. A selection that walls nothing off leaves the
 * selection alone, since there is then no inside to speak of.
 */
export function selectLoopInnerRegion(mesh: EditMesh, elements: ElementSelection): ElementSelection {
  const walls = new Set<number>()
  for (const key of elements.edges) {
    const edge = edgeOfKey(mesh, key)
    if (edge >= 0) walls.add(edge)
  }
  const next = copy(elements)
  if (walls.size === 0 || mesh.faceCount === 0) return next
  const group = new Int32Array(mesh.faceCount).fill(-1)
  const sizes: number[] = []
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (group[face]! >= 0) continue
    const index = sizes.length
    const queue = [face]
    group[face] = index
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!
      for (const edge of mesh.faceEdges(current)) {
        if (walls.has(edge)) continue
        for (const other of mesh.edgeFaces(edge)) {
          if (group[other]! >= 0) continue
          group[other] = index
          queue.push(other)
        }
      }
    }
    sizes.push(queue.length)
  }
  if (sizes.length < 2) return next
  let outside = 0
  for (let index = 1; index < sizes.length; index += 1) {
    if (sizes[index]! > sizes[outside]!) outside = index
  }
  const inner = selectNone()
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (group[face]! !== outside) inner.faces.add(mesh.faceId(face))
  }
  return merge(next, propagateDown(mesh, inner))
}

/* ----------------------------------------------------------------- by place */

/**
 * Blender's ⌃] and ⌃[: everything on one side of the active element along an axis, the axis being
 * the object's own rather than the world's, since that is the frame the mesh is written in.
 *
 * `aligned` is the third answer the same question has — the ring of geometry level with the active
 * element — and it is what a person reaches for to select a mirror plane's own vertices.
 */
export function selectSideOfActive(
  mesh: EditMesh,
  elements: ElementSelection,
  active: ElementPick,
  axis: Axis,
  side: 'positive' | 'negative' | 'aligned',
  extend: boolean,
): ElementSelection {
  const origin = pickCentre(mesh, active)
  if (!origin) return copy(elements)
  const mark = coordinate(origin, axis)
  const vertices = extend ? new Set(elements.vertices) : new Set<number>()
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const offset = coordinate(mesh.position(slot), axis) - mark
    const takes = side === 'positive'
      ? offset > AXIS_TOLERANCE
      : side === 'negative' ? offset < -AXIS_TOLERANCE : Math.abs(offset) <= AXIS_TOLERANCE
    if (takes) vertices.add(mesh.vertexId(slot))
  }
  const base: ElementSelection = extend
    ? { vertices, edges: new Set(elements.edges), faces: new Set(elements.faces) }
    : { vertices, edges: new Set(), faces: new Set() }
  return propagateUp(mesh, base)
}

/**
 * Blender's ⇧⌃M: each selected element's opposite number across a plane through the origin.
 *
 * The twin is found by position rather than by topology, because a mesh that is symmetrical is
 * rarely symmetrical in the order its vertices were made. `threshold` is how far a twin may sit
 * from the mirrored point and still be one, which on a mesh whose halves were built separately is
 * the difference between finding everything and finding nothing.
 */
export function selectMirror(
  mesh: EditMesh,
  elements: ElementSelection,
  axis: Axis,
  threshold: number,
  extend: boolean,
): ElementSelection {
  const tolerance = Math.max(Math.abs(threshold), NORMAL_TOLERANCE)
  const positions: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) positions.push(mesh.position(slot))
  const nearestVertex = nearestPoint(positions, tolerance)
  const found = selectNone()
  for (const id of elements.vertices) {
    const slot = mesh.slotOfVertex(id)
    if (slot < 0) continue
    const twin = nearestVertex(mirror(positions[slot]!, axis))
    if (twin >= 0) found.vertices.add(mesh.vertexId(twin))
  }
  for (const key of elements.edges) {
    const edge = edgeOfKey(mesh, key)
    if (edge < 0) continue
    const [a, b] = mesh.edgeVertices(edge)
    const first = nearestVertex(mirror(positions[a]!, axis))
    const second = nearestVertex(mirror(positions[b]!, axis))
    if (first < 0 || second < 0) continue
    const twin = mesh.edgeSlot(first, second)
    if (twin >= 0) addEdge(mesh, found, twin)
  }
  if (elements.faces.size > 0) {
    const centres: Vec3[] = []
    for (let slot = 0; slot < mesh.faceCount; slot += 1) centres.push(mesh.faceCentre(slot))
    const nearestFace = nearestPoint(centres, tolerance)
    for (const id of elements.faces) {
      const slot = mesh.slotOfFace(id)
      if (slot < 0) continue
      const twin = nearestFace(mirror(centres[slot]!, axis))
      if (twin >= 0) found.faces.add(mesh.faceId(twin))
    }
  }
  return extend ? merge(copy(elements), found) : found
}

/* ------------------------------------------------------------ by pick order */

/**
 * Blender's Select Next / Previous Active, walking the pick history rather than the mesh: the
 * element picked after — or before — the active one becomes active and joins the selection.
 *
 * The history is left as it is. A walk that rewrote it could never go back, since every step would
 * put the element it landed on at the end of the list it is walking.
 */
export function nextActive(mesh: EditMesh, selection: SceneSelection): SceneSelection {
  return stepActive(mesh, selection, 1)
}

export function previousActive(mesh: EditMesh, selection: SceneSelection): SceneSelection {
  return stepActive(mesh, selection, -1)
}

/* ------------------------------------------------------------ by resemblance */

/**
 * Blender's Select Similar. Everything already selected is a reference, and an element joins when
 * it matches any of them: a length, an area, a side count or a valence within `threshold`, or a
 * normal whose dot product with a reference is at least `1 - threshold`.
 *
 * A trait that has no meaning in this mode — an area in vertex mode — leaves the selection alone.
 */
export function selectSimilar(
  mesh: EditMesh,
  elements: ElementSelection,
  mode: SelectMode,
  trait: SimilarTrait,
  threshold: number,
): ElementSelection {
  const next = copy(elements)
  if (mode === 'vertex' && (trait === 'valence' || trait === 'normal')) {
    const slots = [...elements.vertices].map((id) => mesh.slotOfVertex(id)).filter((slot) => slot >= 0)
    if (slots.length === 0) return next
    if (trait === 'valence') {
      const references = slots.map((slot) => mesh.vertexEdges(slot).length)
      for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
        if (near(mesh.vertexEdges(slot).length, references, threshold)) next.vertices.add(mesh.vertexId(slot))
      }
      return next
    }
    const references = slots.map((slot) => mesh.vertexNormal(slot))
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      if (alike(mesh.vertexNormal(slot), references, threshold)) next.vertices.add(mesh.vertexId(slot))
    }
    return next
  }
  if (mode === 'edge') {
    const slots = [...elements.edges].map((key) => edgeOfKey(mesh, key)).filter((slot) => slot >= 0)
    if (slots.length === 0) return next
    const matches = edgeMatcher(mesh, slots, trait, threshold)
    if (!matches) return next
    for (let slot = 0; slot < mesh.edgeCount; slot += 1) {
      if (!matches(slot)) continue
      const key = keyOfEdge(mesh, slot)
      if (key) next.edges.add(key)
    }
    return next
  }
  if (mode === 'face') {
    const slots = [...elements.faces].map((id) => mesh.slotOfFace(id)).filter((slot) => slot >= 0)
    if (slots.length === 0) return next
    const matches = faceMatcher(mesh, slots, trait, threshold)
    if (!matches) return next
    for (let slot = 0; slot < mesh.faceCount; slot += 1) {
      if (matches(slot)) next.faces.add(mesh.faceId(slot))
    }
    return next
  }
  return next
}

/**
 * What makes an edge resemble the ones already selected. A trait that means nothing to an edge —
 * an area — has no answer here, and the null says so rather than quietly matching everything.
 */
function edgeMatcher(
  mesh: EditMesh,
  references: number[],
  trait: SimilarTrait,
  threshold: number,
): ((slot: number) => boolean) | null {
  if (trait === 'seam' || trait === 'sharp') {
    const flags = new Set(references.map((slot) => mesh.edgeFlag(slot, trait)))
    return (slot) => flags.has(mesh.edgeFlag(slot, trait))
  }
  if (trait === 'direction') {
    const directions = references.map((slot) => edgeDirection(mesh, slot))
    return (slot) => parallel(edgeDirection(mesh, slot), directions, threshold)
  }
  const measure = trait === 'length'
    ? (slot: number) => edgeLength(mesh, slot)
    : trait === 'crease' ? (slot: number) => mesh.edgeNumber(slot, 'crease') : null
  if (!measure) return null
  const values = references.map(measure)
  return (slot) => near(measure(slot), values, threshold)
}

/** And the same for a face: its shape, the way it looks, or the material slot it draws with. */
function faceMatcher(
  mesh: EditMesh,
  references: number[],
  trait: SimilarTrait,
  threshold: number,
): ((slot: number) => boolean) | null {
  if (trait === 'normal') {
    const normals = references.map((slot) => mesh.faceNormal(slot))
    return (slot) => alike(mesh.faceNormal(slot), normals, threshold)
  }
  if (trait === 'material') {
    const materials = new Set(references.map((slot) => mesh.faceMaterial(slot)))
    return (slot) => materials.has(mesh.faceMaterial(slot))
  }
  const measure = trait === 'area'
    ? (slot: number) => faceArea(mesh, slot)
    : trait === 'perimeter'
      ? (slot: number) => mesh.facePerimeter(slot)
      : trait === 'sides' ? (slot: number) => mesh.faceVertices(slot).length : null
  if (!measure) return null
  const values = references.map(measure)
  return (slot) => near(measure(slot), values, threshold)
}

/**
 * Blender's Select All by Trait, over the whole mesh rather than over what is selected. `min` and
 * `max` narrow whatever faces the trait found to the ones with that many corners, which is how the
 * “faces by sides” field of the same menu was first spelled here; the trait of that name now asks
 * the question properly, with a comparison rather than a range.
 */
export function selectByTrait(mesh: EditMesh, trait: MeshTrait, options: TraitOptions = {}): ElementSelection {
  const found = selectNone()
  if (trait === 'non-manifold') {
    // Each kind of trouble is on unless it is turned off, as Blender's own panel has them: a person
    // asking what is wrong with a mesh wants all of it, and narrows afterwards.
    const wire = options.wire ?? true
    const boundary = options.boundary ?? true
    const multipleFaces = options.multipleFaces ?? true
    const nonContiguous = options.nonContiguous ?? true
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      const faces = mesh.edgeFaces(edge).length
      const wrong = faces === 0
        ? wire
        : faces === 1 ? boundary : faces > 2 ? multipleFaces : nonContiguous && !isContiguous(mesh, edge)
      if (wrong) addEdge(mesh, found, edge)
    }
    if (options.vertices ?? true) {
      for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
        if (isBowTie(mesh, vertex)) found.vertices.add(mesh.vertexId(vertex))
      }
    }
  }
  if (trait === 'sharp') {
    const angle = options.angle ?? SHARP_ANGLE
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      if (mesh.edgeFaces(edge).length !== 2) continue
      if (mesh.dihedral(edge) >= angle) addEdge(mesh, found, edge)
    }
  }
  if (trait === 'faces-by-sides') {
    const corners = Math.max(3, Math.round(options.sides ?? 4))
    const comparison = options.comparison ?? 'equal'
    for (let face = 0; face < mesh.faceCount; face += 1) {
      const count = mesh.faceVertices(face).length
      const takes = comparison === 'greater'
        ? count > corners
        : comparison === 'less' ? count < corners : count === corners
      if (takes) found.faces.add(mesh.faceId(face))
    }
  }
  if (trait === 'loose') {
    for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
      if (mesh.vertexEdges(vertex).length === 0) found.vertices.add(mesh.vertexId(vertex))
    }
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      if (mesh.edgeFaces(edge).length === 0) addEdge(mesh, found, edge)
    }
  }
  if (trait === 'boundary') {
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      if (mesh.isBoundaryEdge(edge)) addEdge(mesh, found, edge)
    }
  }
  if (trait === 'interior') {
    for (let face = 0; face < mesh.faceCount; face += 1) {
      const edges = mesh.faceEdges(face)
      if (edges.length === 0) continue
      if (edges.every((edge) => mesh.edgeFaces(edge).length > 2)) found.faces.add(mesh.faceId(face))
    }
  }
  if (options.min !== undefined || options.max !== undefined) {
    const first = options.min ?? 3
    const second = options.max ?? Number.MAX_SAFE_INTEGER
    const min = Math.min(first, second)
    const max = Math.max(first, second)
    found.faces = new Set([...found.faces].filter((id) => {
      const count = mesh.faceVertices(mesh.slotOfFace(id)).length
      return count >= min && count <= max
    }))
  }
  return found
}

/* -------------------------------------------------------------- by pattern */

/**
 * A repeatable scatter. The seed is the whole state, so the same seed gives the same selection on
 * every machine and after every reload — which `Math.random` could not, and which is what makes a
 * random selection something an operator can replay from the redo panel.
 */
export function selectRandom(mesh: EditMesh, mode: SelectMode, ratio: number, seed: number): ElementSelection {
  const found = selectNone()
  const chance = Math.min(1, Math.max(0, ratio))
  if (chance <= 0) return found
  const next = randomSequence(seed)
  if (mode === 'vertex') {
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      if (next() < chance) found.vertices.add(mesh.vertexId(slot))
    }
    return found
  }
  if (mode === 'edge') {
    for (let slot = 0; slot < mesh.edgeCount; slot += 1) {
      if (next() < chance) addEdge(mesh, found, slot)
    }
    return found
  }
  for (let slot = 0; slot < mesh.faceCount; slot += 1) {
    if (next() < chance) found.faces.add(mesh.faceId(slot))
  }
  return found
}

/**
 * Blender's Checker Deselect, walking the selection in id order: `nth` elements stay, the next
 * `skip` go, and `offset` slides the pattern along. It needs no mesh — the order of the ids is the
 * order of the walk, which is what makes the result the same however the selection was built.
 */
export function selectCheckerDeselect(
  elements: ElementSelection,
  mode: SelectMode,
  nth: number,
  skip: number,
  offset: number,
): ElementSelection {
  const keep = Math.max(1, Math.floor(nth))
  const drop = Math.max(0, Math.floor(skip))
  const next = copy(elements)
  if (drop === 0) return next
  const period = keep + drop
  const shift = Math.floor(offset)
  const survives = (index: number): boolean => (((index + shift) % period) + period) % period < keep
  if (mode === 'vertex') next.vertices = new Set(sortedNumbers(elements.vertices).filter((_, index) => survives(index)))
  if (mode === 'edge') next.edges = new Set(sortedKeys(elements.edges).filter((_, index) => survives(index)))
  if (mode === 'face') next.faces = new Set(sortedNumbers(elements.faces).filter((_, index) => survives(index)))
  return next
}

/* -------------------------------------------------------------- internals */

function copy(elements: ElementSelection): ElementSelection {
  return { vertices: new Set(elements.vertices), edges: new Set(elements.edges), faces: new Set(elements.faces) }
}

/** The second selection poured into the first, which is given back. */
function merge(into: ElementSelection, extra: ElementSelection): ElementSelection {
  for (const id of extra.vertices) into.vertices.add(id)
  for (const key of extra.edges) into.edges.add(key)
  for (const id of extra.faces) into.faces.add(id)
  return into
}

function restrict(elements: ElementSelection, modes: SelectMode[]): ElementSelection {
  return {
    vertices: modes.includes('vertex') ? new Set(elements.vertices) : new Set(),
    edges: modes.includes('edge') ? new Set(elements.edges) : new Set(),
    faces: modes.includes('face') ? new Set(elements.faces) : new Set(),
  }
}

function difference<T>(whole: Set<T>, taken: Set<T>): Set<T> {
  return new Set([...whole].filter((item) => !taken.has(item)))
}

function readIds(list: string[] | undefined): Set<number> {
  const ids = new Set<number>()
  for (const entry of list ?? []) {
    if (entry.trim() === '') continue
    const id = Number(entry)
    if (Number.isInteger(id)) ids.add(id)
  }
  return ids
}

function readKeys(list: EdgeKey[] | undefined): Set<EdgeKey> {
  const keys = new Set<EdgeKey>()
  for (const entry of list ?? []) if (parseEdgeKey(entry)) keys.add(entry)
  return keys
}

function sortedNumbers(ids: Iterable<number>): number[] {
  return [...ids].sort((a, b) => a - b)
}

function sortedKeys(keys: Iterable<EdgeKey>): EdgeKey[] {
  return [...keys].sort((a, b) => {
    const left = parseEdgeKey(a) ?? [0, 0]
    const right = parseEdgeKey(b) ?? [0, 0]
    return left[0] - right[0] || left[1] - right[1]
  })
}

function keyOfEdge(mesh: EditMesh, edgeSlot: number): EdgeKey | null {
  const [a, b] = mesh.edgeVertices(edgeSlot)
  if (a < 0 || b < 0) return null
  return edgeKey(mesh.vertexId(a), mesh.vertexId(b))
}

function edgeOfKey(mesh: EditMesh, key: EdgeKey): number {
  const pair = parseEdgeKey(key)
  if (!pair) return -1
  const a = mesh.slotOfVertex(pair[0])
  const b = mesh.slotOfVertex(pair[1])
  if (a < 0 || b < 0) return -1
  return mesh.edgeSlot(a, b)
}

function addEdge(mesh: EditMesh, elements: ElementSelection, edgeSlot: number): void {
  const key = keyOfEdge(mesh, edgeSlot)
  if (!key) return
  elements.edges.add(key)
  for (const end of mesh.edgeVertices(edgeSlot)) elements.vertices.add(mesh.vertexId(end))
}

function fromEdgeRun(mesh: EditMesh, edgeSlots: number[]): ElementSelection {
  const found = selectNone()
  for (const edge of edgeSlots) addEdge(mesh, found, edge)
  return found
}

function edgeLength(mesh: EditMesh, edgeSlot: number): number {
  const [a, b] = mesh.edgeVertices(edgeSlot)
  if (a < 0 || b < 0) return 0
  return length(subtract(mesh.position(b), mesh.position(a)))
}

/**
 * The vector area of a face, summed corner by corner. The module's own `faceArea` wants a
 * `MeshData`, and building one for every face of the mesh would turn a question about a face into a
 * pass over all of it; this is the same sum Newell's method makes, halved because the sum is twice
 * the area.
 */
function faceArea(mesh: EditMesh, faceSlot: number): number {
  const points: Vec3[] = mesh.faceVertices(faceSlot).map((slot) => mesh.position(slot))
  if (points.length < 3) return 0
  let sum: Vec3 = [0, 0, 0]
  for (let index = 0; index < points.length; index += 1) {
    sum = add(sum, cross(points[index]!, points[(index + 1) % points.length]!))
  }
  return length(sum) / 2
}

function near(value: number, references: number[], threshold: number): boolean {
  return references.some((reference) => Math.abs(value - reference) <= Math.abs(threshold))
}

function alike(normal: Vec3, references: Vec3[], threshold: number): boolean {
  const floor = 1 - Math.abs(threshold) - NORMAL_TOLERANCE
  return references.some((reference) => dot(normal, reference) >= floor)
}

/** Whether the faces around a vertex form more than one fan, which is what a bow-tie is. */
function isBowTie(mesh: EditMesh, vertexSlot: number): boolean {
  const faces = mesh.vertexFaces(vertexSlot)
  if (faces.length < 2) return false
  const around = new Set(faces)
  const seen = new Set<number>([faces[0]!])
  const queue = [faces[0]!]
  while (queue.length > 0) {
    const face = queue.pop()!
    for (const edge of mesh.faceEdges(face)) {
      if (!mesh.edgeVertices(edge).includes(vertexSlot)) continue
      for (const other of mesh.edgeFaces(edge)) {
        if (!around.has(other) || seen.has(other)) continue
        seen.add(other)
        queue.push(other)
      }
    }
  }
  return seen.size !== around.size
}

/* ------------------------------------------------------------ picked elements */

/** The faces a pick sits on: the face itself, or the ones round a corner or along an edge. */
function seedFaces(mesh: EditMesh, pick: ElementPick): number[] {
  if (pick.kind === 'face') {
    const slot = mesh.slotOfFace(Number(pick.id))
    return slot < 0 ? [] : [slot]
  }
  if (pick.kind === 'vertex') {
    const slot = mesh.slotOfVertex(Number(pick.id))
    return slot < 0 ? [] : mesh.vertexFaces(slot)
  }
  const edge = edgeOfKey(mesh, String(pick.id))
  return edge < 0 ? [] : mesh.edgeFaces(edge)
}

/** One vertex of a pick, whatever kind it is, to start a walk from. */
function seedVertex(mesh: EditMesh, pick: ElementPick): number {
  if (pick.kind === 'vertex') return mesh.slotOfVertex(Number(pick.id))
  if (pick.kind === 'edge') {
    const edge = edgeOfKey(mesh, String(pick.id))
    return edge < 0 ? -1 : mesh.edgeVertices(edge)[0]
  }
  const face = mesh.slotOfFace(Number(pick.id))
  return face < 0 ? -1 : mesh.faceVertices(face)[0] ?? -1
}

/** Where a pick sits: a corner's position, an edge's middle, a face's centre. */
function pickCentre(mesh: EditMesh, pick: ElementPick): Vec3 | null {
  if (pick.kind === 'vertex') {
    const slot = mesh.slotOfVertex(Number(pick.id))
    return slot < 0 ? null : mesh.position(slot)
  }
  if (pick.kind === 'edge') {
    const edge = edgeOfKey(mesh, String(pick.id))
    if (edge < 0) return null
    const [a, b] = mesh.edgeVertices(edge)
    return scale(add(mesh.position(a), mesh.position(b)), 0.5)
  }
  const face = mesh.slotOfFace(Number(pick.id))
  return face < 0 ? null : mesh.faceCentre(face)
}

/** Whether an element the history remembers is still in the mesh at all. */
function elementExists(mesh: EditMesh, element: ElementRef): boolean {
  if (element.kind === 'vertex') return mesh.slotOfVertex(Number(element.id)) >= 0
  if (element.kind === 'face') return mesh.slotOfFace(Number(element.id)) >= 0
  return edgeOfKey(mesh, element.id) >= 0
}

/**
 * One step along the pick history. Entries for another object are taken on trust — the mesh in hand
 * cannot speak for them — and the walk stops at either end rather than wrapping round, because a
 * person stepping back through their picks expects to arrive at the first one and stay there.
 */
function stepActive(mesh: EditMesh, selection: SceneSelection, step: 1 | -1): SceneSelection {
  const history = selection.elementHistory ?? []
  if (history.length === 0) return selection
  const active = selection.active ?? null
  const at = active
    ? history.findIndex((entry) => sameElement(entry, active))
    : step > 0 ? -1 : history.length
  for (let index = at + step; index >= 0 && index < history.length; index += step) {
    const entry = history[index]!
    if (entry.objectId === selection.activeObjectId && !elementExists(mesh, entry)) continue
    const elements = toElements(selection, entry.objectId)
    if (entry.kind === 'vertex') elements.vertices.add(Number(entry.id))
    else if (entry.kind === 'face') elements.faces.add(Number(entry.id))
    else elements.edges.add(entry.id)
    return {
      ...selection,
      elements: { ...(selection.elements ?? {}), [entry.objectId]: fromElements(elements) },
      active: entry,
    }
  }
  return selection
}

/* -------------------------------------------------------------- measurement */

function coordinate(point: Vec3, axis: Axis): number {
  return axis === 0 ? point[0] : axis === 1 ? point[1] : point[2]
}

function mirror(point: Vec3, axis: Axis): Vec3 {
  return [axis === 0 ? -point[0] : point[0], axis === 1 ? -point[1] : point[1], axis === 2 ? -point[2] : point[2]]
}

/** An edge's direction, of unit length and of no particular sign: an edge points both ways. */
function edgeDirection(mesh: EditMesh, edgeSlot: number): Vec3 {
  const [a, b] = mesh.edgeVertices(edgeSlot)
  if (a < 0 || b < 0) return [0, 0, 0]
  return normalize(subtract(mesh.position(b), mesh.position(a)))
}

/** Like `alike`, but for directions rather than normals: opposite counts as the same line. */
function parallel(direction: Vec3, references: Vec3[], threshold: number): boolean {
  const floor = 1 - Math.abs(threshold) - NORMAL_TOLERANCE
  return references.some((reference) => Math.abs(dot(direction, reference)) >= floor)
}

/**
 * Whether the two faces at an edge run round it in opposite directions, which is what says their
 * normals agree. An edge with any other number of faces has no disagreement to have.
 */
function isContiguous(mesh: EditMesh, edgeSlot: number): boolean {
  const faces = mesh.edgeFaces(edgeSlot)
  if (faces.length !== 2) return true
  const [a, b] = mesh.edgeVertices(edgeSlot)
  const forward = (face: number): boolean => mesh.loopNext(face, a) === b
  return forward(faces[0]!) !== forward(faces[1]!)
}

/**
 * A lookup from a point to the nearest of a list, within a tolerance, over a grid of cells the
 * tolerance wide. A mirror asks this question once per selected element, and asking it by scanning
 * every vertex each time turns selecting a symmetrical half into a walk over the mesh squared.
 */
function nearestPoint(points: Vec3[], tolerance: number): (point: Vec3) => number {
  const cell = Math.max(tolerance, NORMAL_TOLERANCE)
  const buckets = new Map<string, number[]>()
  for (let index = 0; index < points.length; index += 1) {
    const key = cellKey(points[index]!, cell, 0, 0, 0)
    const list = buckets.get(key)
    if (list) list.push(index)
    else buckets.set(key, [index])
  }
  return (point) => {
    let best = -1
    let closest = tolerance
    for (let x = -1; x <= 1; x += 1) {
      for (let y = -1; y <= 1; y += 1) {
        for (let z = -1; z <= 1; z += 1) {
          for (const index of buckets.get(cellKey(point, cell, x, y, z)) ?? []) {
            const gap = length(subtract(points[index]!, point))
            if (gap > closest) continue
            closest = gap
            best = index
          }
        }
      }
    }
    return best
  }
}

function cellKey(point: Vec3, cell: number, x: number, y: number, z: number): string {
  return `${Math.floor(point[0] / cell) + x}|${Math.floor(point[1] / cell) + y}|${Math.floor(point[2] / cell) + z}`
}

/* ------------------------------------------------------------------- walking */

/** A graph to walk: how many nodes, who each one's neighbours are, and what a step costs. */
type Graph = { count: number; neighbours: (node: number) => number[]; cost: (from: number, to: number) => number }

function vertexGraph(mesh: EditMesh): Graph {
  return {
    count: mesh.vertexCount,
    neighbours: (vertex) => mesh.vertexEdges(vertex).map((edge) => {
      const [a, b] = mesh.edgeVertices(edge)
      return a === vertex ? b : a
    }),
    cost: (from, to) => length(subtract(mesh.position(to), mesh.position(from))),
  }
}

/**
 * The dual: a node per face, a step wherever two faces share an edge, and the distance between
 * their centres as its cost. `EditMesh` walks vertices and edges for us; this is the third walk,
 * and it lives here because a path across faces is a question only a selection asks.
 */
function faceGraph(mesh: EditMesh): Graph {
  const centres: Vec3[] = []
  for (let face = 0; face < mesh.faceCount; face += 1) centres.push(mesh.faceCentre(face))
  return {
    count: mesh.faceCount,
    neighbours: (face) => {
      const found: number[] = []
      for (const edge of mesh.faceEdges(face)) {
        for (const other of mesh.edgeFaces(edge)) if (other !== face) found.push(other)
      }
      return found
    },
    cost: (from, to) => length(subtract(centres[to]!, centres[from]!)),
  }
}

/** Dijkstra from one node, stopping early once `target` is settled when one is named. */
function cheapestRoutes(graph: Graph, source: number, target = -1): { cost: Float64Array; previous: Int32Array } {
  const cost = new Float64Array(graph.count).fill(Number.POSITIVE_INFINITY)
  const previous = new Int32Array(graph.count).fill(-1)
  if (source < 0 || source >= graph.count) return { cost, previous }
  const settled = new Uint8Array(graph.count)
  cost[source] = 0
  const queue = new CostQueue()
  queue.push(source, 0)
  while (queue.size > 0) {
    const current = queue.pop()
    if (current < 0) break
    if (settled[current]) continue
    settled[current] = 1
    if (current === target) break
    for (const other of graph.neighbours(current)) {
      if (other < 0 || other >= graph.count || settled[other]) continue
      const step = cost[current]! + graph.cost(current, other)
      if (step >= cost[other]!) continue
      cost[other] = step
      previous[other] = current
      queue.push(other, step)
    }
  }
  return { cost, previous }
}

/** The cheapest run of nodes from one to another, empty when the two are in different parts. */
function route(graph: Graph, from: number, to: number): number[] {
  if (from < 0 || to < 0) return []
  if (from === to) return [from]
  const { cost, previous } = cheapestRoutes(graph, from, to)
  if (!Number.isFinite(cost[to] ?? Number.POSITIVE_INFINITY)) return []
  const path = [to]
  let walk = previous[to]!
  while (walk >= 0) {
    path.push(walk)
    walk = previous[walk]!
  }
  return path.reverse()
}

/** Every node lying on some cheapest run between the two: the region a fill selects. */
function routeBand(graph: Graph, from: number, to: number): number[] {
  if (from < 0 || to < 0) return []
  const forward = cheapestRoutes(graph, from).cost
  const backward = cheapestRoutes(graph, to).cost
  const total = forward[to] ?? Number.POSITIVE_INFINITY
  if (!Number.isFinite(total)) return []
  const room = total * PATH_TOLERANCE + PATH_TOLERANCE
  const band: number[] = []
  for (let node = 0; node < graph.count; node += 1) {
    if (forward[node]! + backward[node]! <= total + room) band.push(node)
  }
  return band
}

/**
 * Which ends of two edges are nearest each other, and the run of vertices between them. The path
 * from one edge to another is the cheapest of the four ways their ends can be paired up.
 */
function nearestEnds(mesh: EditMesh, first: number, second: number): { from: number; to: number; path: number[] } | null {
  let best: { from: number; to: number; path: number[] } | null = null
  let cheapest = Number.POSITIVE_INFINITY
  for (const from of mesh.edgeVertices(first)) {
    for (const to of mesh.edgeVertices(second)) {
      if (from < 0 || to < 0) continue
      const path = mesh.shortestPath(from, to)
      if (path.length === 0) continue
      let cost = 0
      for (let index = 0; index + 1 < path.length; index += 1) {
        cost += length(subtract(mesh.position(path[index + 1]!), mesh.position(path[index]!)))
      }
      if (cost >= cheapest) continue
      cheapest = cost
      best = { from, to, path }
    }
  }
  return best
}

/**
 * A binary heap of nodes by cost. Dijkstra would otherwise scan every unsettled node on each step,
 * which turns a path across the corner of a dense mesh into a walk over all of it.
 */
class CostQueue {
  private readonly nodes: number[] = []
  private readonly keys: number[] = []

  get size(): number {
    return this.nodes.length
  }

  push(node: number, key: number): void {
    this.nodes.push(node)
    this.keys.push(key)
    let index = this.nodes.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.keys[parent]! <= this.keys[index]!) break
      this.swap(parent, index)
      index = parent
    }
  }

  pop(): number {
    if (this.nodes.length === 0) return -1
    const top = this.nodes[0]!
    const node = this.nodes.pop()!
    const key = this.keys.pop()!
    if (this.nodes.length === 0) return top
    this.nodes[0] = node
    this.keys[0] = key
    let index = 0
    for (;;) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index
      if (left < this.keys.length && this.keys[left]! < this.keys[smallest]!) smallest = left
      if (right < this.keys.length && this.keys[right]! < this.keys[smallest]!) smallest = right
      if (smallest === index) return top
      this.swap(smallest, index)
      index = smallest
    }
  }

  private swap(a: number, b: number): void {
    const node = this.nodes[a]!
    const key = this.keys[a]!
    this.nodes[a] = this.nodes[b]!
    this.keys[a] = this.keys[b]!
    this.nodes[b] = node
    this.keys[b] = key
  }
}

/**
 * A xorshift over a 32-bit state. A zero state would sit on zero for ever, so a seed of zero is
 * moved off it rather than quietly producing the same number every time.
 */
function randomSequence(seed: number): () => number {
  let state = Math.floor(seed) | 0
  if (state === 0) state = 0x6d2b79f5
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state |= 0
    return (state >>> 0) / 0x100000000
  }
}
