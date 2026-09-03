import { edgeKey, parseEdgeKey } from '@/scene/mesh/data'
import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, cross, dot, length, subtract } from '@/scene/mesh/normals'
import type { EdgeKey, SceneSelection, SelectMode, Vec3 } from '@/scene/types'

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
export type SimilarTrait = 'length' | 'area' | 'sides' | 'valence' | 'normal'

/** The traits `selectByTrait` finds, which is Blender's Select All by Trait menu. */
export type MeshTrait = 'non-manifold' | 'loose' | 'interior' | 'boundary'

/**
 * How far apart two normals may point and still count as similar, on top of the caller's threshold.
 * Two faces built from the same numbers do not always come out with a dot product of exactly one,
 * and a threshold of zero has to mean “the same way” rather than “never”.
 */
const NORMAL_TOLERANCE = 1e-6

/* --------------------------------------------------------------- documents */

export function toElements(selection: SceneSelection): ElementSelection {
  return {
    vertices: readIds(selection.vertices),
    edges: readKeys(selection.edges),
    faces: readIds(selection.faces),
  }
}

/**
 * The document's half of the round trip. The lists come out sorted so that two selections holding
 * the same elements are the same document, whatever order the operators put them in.
 */
export function fromElements(elements: ElementSelection, active?: SceneSelection['active']): Partial<SceneSelection> {
  return {
    vertices: sortedNumbers(elements.vertices).map((id) => String(id)),
    edges: sortedKeys(elements.edges),
    faces: sortedNumbers(elements.faces).map((id) => String(id)),
    active: active ?? null,
  }
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
 * selection when it touches a selected one across an edge.
 */
export function growSelection(mesh: EditMesh, elements: ElementSelection, mode: SelectMode): ElementSelection {
  const next = copy(elements)
  if (mode === 'vertex') {
    for (const id of elements.vertices) {
      const slot = mesh.slotOfVertex(id)
      if (slot < 0) continue
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
 */
export function shrinkSelection(mesh: EditMesh, elements: ElementSelection, mode: SelectMode): ElementSelection {
  const next = copy(elements)
  if (mode === 'vertex') {
    next.vertices = new Set([...elements.vertices].filter((id) => {
      const slot = mesh.slotOfVertex(id)
      if (slot < 0) return false
      return mesh.vertexEdges(slot).every((edge) => {
        if (mesh.edgeFaces(edge).length !== 2) return false
        return mesh.edgeVertices(edge).every((end) => elements.vertices.has(mesh.vertexId(end)))
      })
    }))
    return next
  }
  if (mode === 'edge') {
    next.edges = new Set([...elements.edges].filter((key) => {
      const edge = edgeOfKey(mesh, key)
      if (edge < 0 || mesh.edgeFaces(edge).length !== 2) return false
      return mesh.edgeVertices(edge).every((end) => mesh.vertexEdges(end).every((neighbour) => {
        const name = keyOfEdge(mesh, neighbour)
        return name !== null && elements.edges.has(name)
      }))
    }))
    return next
  }
  next.faces = new Set([...elements.faces].filter((id) => {
    const face = mesh.slotOfFace(id)
    if (face < 0) return false
    return mesh.faceEdges(face).every((edge) => {
      const around = mesh.edgeFaces(edge)
      if (around.length !== 2) return false
      return around.every((neighbour) => elements.faces.has(mesh.faceId(neighbour)))
    })
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
  if (mode === 'edge' && trait === 'length') {
    const slots = [...elements.edges].map((key) => edgeOfKey(mesh, key)).filter((slot) => slot >= 0)
    if (slots.length === 0) return next
    const references = slots.map((slot) => edgeLength(mesh, slot))
    for (let slot = 0; slot < mesh.edgeCount; slot += 1) {
      if (!near(edgeLength(mesh, slot), references, threshold)) continue
      const key = keyOfEdge(mesh, slot)
      if (key) next.edges.add(key)
    }
    return next
  }
  if (mode === 'face' && (trait === 'area' || trait === 'sides' || trait === 'normal')) {
    const slots = [...elements.faces].map((id) => mesh.slotOfFace(id)).filter((slot) => slot >= 0)
    if (slots.length === 0) return next
    if (trait === 'normal') {
      const references = slots.map((slot) => mesh.faceNormal(slot))
      for (let slot = 0; slot < mesh.faceCount; slot += 1) {
        if (alike(mesh.faceNormal(slot), references, threshold)) next.faces.add(mesh.faceId(slot))
      }
      return next
    }
    const measure = trait === 'area'
      ? (slot: number) => faceArea(mesh, slot)
      : (slot: number) => mesh.faceVertices(slot).length
    const references = slots.map(measure)
    for (let slot = 0; slot < mesh.faceCount; slot += 1) {
      if (near(measure(slot), references, threshold)) next.faces.add(mesh.faceId(slot))
    }
    return next
  }
  return next
}

/**
 * Blender's Select All by Trait, over the whole mesh rather than over what is selected. `sides`
 * narrows whatever faces the trait found to the ones with that many corners, which is how the
 * “faces by sides” field of the same menu is spelled here.
 */
export function selectByTrait(mesh: EditMesh, trait: MeshTrait, sides?: { min: number; max: number }): ElementSelection {
  const found = selectNone()
  if (trait === 'non-manifold') {
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      // A boundary counts: Blender's Select Non Manifold has that box ticked by default, and an
      // open edge is exactly what stops a bevel or a solidify from doing the obvious thing.
      if (mesh.edgeFaces(edge).length === 2) continue
      addEdge(mesh, found, edge)
    }
    for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
      if (isBowTie(mesh, vertex)) found.vertices.add(mesh.vertexId(vertex))
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
  if (sides) {
    const min = Math.min(sides.min, sides.max)
    const max = Math.max(sides.min, sides.max)
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
