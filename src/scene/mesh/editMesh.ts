import { cloneMesh, setVertexPosition, vertexPosition } from '@/scene/mesh/data'
import { faceNormal, length, meshBounds, subtract, vertexNormal } from '@/scene/mesh/normals'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * A mesh with its adjacency built: the form every mesh operator works on.
 *
 * `MeshData` is what a document stores, and answering “which faces share this edge” from it costs a
 * scan of the whole mesh. `EditMesh` pays that cost once, when it is built, and afterwards answers
 * in the order of a vertex's valence. An operator takes an `EditMesh`, mutates it, and hands back
 * `toData()`; the mesh it was built from is never touched, because `from` copies.
 *
 * Slots renumber whenever geometry is removed. Ids do not, ever — a selection, a shape key and a
 * rig binding all name geometry by id, and they have to survive an edit somewhere else in the mesh.
 */

/** Two vertex slots, in either order, as one key. Slots renumber, so this index is rebuilt with them. */
function slotPairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** How far a walk got, and whether it came back to where it started. */
type Walk = { chain: number[]; closed: boolean }

export class EditMesh {
  private readonly mesh: MeshData
  private vertexEdgeLists: number[][] = []
  private vertexFaceLists: number[][] = []
  private edgeFaceLists: number[][] = []
  /** One edge slot per corner of the face, so `faceEdges(f)[i]` runs from `faceVertices(f)[i]`. */
  private faceEdgeLists: number[][] = []
  private edgeIndex = new Map<string, number>()
  private vertexIdIndex = new Map<number, number>()
  private faceIdIndex = new Map<number, number>()

  private constructor(mesh: MeshData) {
    this.mesh = mesh
    this.rebuild()
  }

  static from(mesh: MeshData): EditMesh {
    return new EditMesh(cloneMesh(mesh))
  }

  /** A fresh `MeshData`; it shares no array with the mesh this one was built from, or with itself. */
  toData(): MeshData {
    return cloneMesh(this.mesh)
  }

  clone(): EditMesh {
    return new EditMesh(cloneMesh(this.mesh))
  }

  get vertexCount(): number {
    return this.mesh.vertexIds.length
  }

  get edgeCount(): number {
    return this.mesh.edges.length
  }

  get faceCount(): number {
    return this.mesh.faces.length
  }

  /* ------------------------------------------------------------- geometry */

  position(vertexSlot: number): Vec3 {
    return vertexPosition(this.mesh, vertexSlot)
  }

  setPosition(vertexSlot: number, point: Vec3): void {
    if (vertexSlot < 0 || vertexSlot >= this.vertexCount) return
    setVertexPosition(this.mesh, vertexSlot, point)
  }

  /* ------------------------------------------------------------------ ids */

  vertexId(slot: number): number {
    return this.mesh.vertexIds[slot] ?? -1
  }

  slotOfVertex(id: number): number {
    return this.vertexIdIndex.get(id) ?? -1
  }

  faceId(slot: number): number {
    return this.mesh.faceIds[slot] ?? -1
  }

  slotOfFace(id: number): number {
    return this.faceIdIndex.get(id) ?? -1
  }

  /* ------------------------------------------------------------- adjacency */

  edgeSlot(a: number, b: number): number {
    if (a === b) return -1
    return this.edgeIndex.get(slotPairKey(a, b)) ?? -1
  }

  edgeVertices(edgeSlot: number): [number, number] {
    const edge = this.mesh.edges[edgeSlot]
    return edge ? [edge[0], edge[1]] : [-1, -1]
  }

  vertexEdges(vertexSlot: number): number[] {
    return this.vertexEdgeLists[vertexSlot]?.slice() ?? []
  }

  vertexFaces(vertexSlot: number): number[] {
    return this.vertexFaceLists[vertexSlot]?.slice() ?? []
  }

  edgeFaces(edgeSlot: number): number[] {
    return this.edgeFaceLists[edgeSlot]?.slice() ?? []
  }

  faceEdges(faceSlot: number): number[] {
    return this.faceEdgeLists[faceSlot]?.slice() ?? []
  }

  faceVertices(faceSlot: number): number[] {
    return this.mesh.faces[faceSlot]?.slice() ?? []
  }

  /** The next and previous corner of a face's loop, by slot. */
  loopNext(faceSlot: number, vertexSlot: number): number {
    const loop = this.mesh.faces[faceSlot]
    if (!loop) return -1
    const index = loop.indexOf(vertexSlot)
    return index < 0 ? -1 : loop[(index + 1) % loop.length] ?? -1
  }

  loopPrev(faceSlot: number, vertexSlot: number): number {
    const loop = this.mesh.faces[faceSlot]
    if (!loop) return -1
    const index = loop.indexOf(vertexSlot)
    return index < 0 ? -1 : loop[(index + loop.length - 1) % loop.length] ?? -1
  }

  /* ---------------------------------------------------------- manifoldness */

  /**
   * Whether the mesh is one a person could hold: every edge carries one or two faces, and the faces
   * around a vertex form a single fan. The second half is what catches a bow-tie, where two
   * quads touch at one corner and every edge on its own looks perfectly ordinary.
   */
  isManifold(): boolean {
    for (let edge = 0; edge < this.mesh.edges.length; edge += 1) {
      if (!this.isEdgeManifold(edge)) return false
    }
    for (let vertex = 0; vertex < this.vertexCount; vertex += 1) {
      if (!this.hasSingleFan(vertex)) return false
    }
    return true
  }

  isEdgeManifold(edgeSlot: number): boolean {
    const faces = this.edgeFaceLists[edgeSlot]
    if (!faces) return false
    return faces.length === 1 || faces.length === 2
  }

  boundaryEdges(): number[] {
    const edges: number[] = []
    for (let edge = 0; edge < this.mesh.edges.length; edge += 1) {
      if (this.isBoundaryEdge(edge)) edges.push(edge)
    }
    return edges
  }

  isBoundaryEdge(edgeSlot: number): boolean {
    return this.edgeFaceLists[edgeSlot]?.length === 1
  }

  /** Whether the faces around a vertex are one fan rather than two touching at a point. */
  private hasSingleFan(vertexSlot: number): boolean {
    const faces = this.vertexFaceLists[vertexSlot]
    if (!faces || faces.length < 2) return true
    const around = new Set(faces)
    const seen = new Set<number>([faces[0]!])
    const queue = [faces[0]!]
    while (queue.length > 0) {
      const face = queue.pop()!
      for (const edge of this.faceEdgeLists[face] ?? []) {
        const pair = this.mesh.edges[edge]
        if (!pair || (pair[0] !== vertexSlot && pair[1] !== vertexSlot)) continue
        for (const other of this.edgeFaceLists[edge] ?? []) {
          if (!around.has(other) || seen.has(other)) continue
          seen.add(other)
          queue.push(other)
        }
      }
    }
    return seen.size === around.size
  }

  /* ----------------------------------------------------------- loops, rings */

  /**
   * Blender's edge loop: from an edge, step across each four-valence vertex to the edge that shares
   * no face with the one arrived on. It stops at a boundary, at a pole, and where it started.
   */
  edgeLoop(edgeSlot: number): number[] {
    const edge = this.mesh.edges[edgeSlot]
    if (!edge) return []
    const forward = this.walkLoop(edgeSlot, edge[1])
    if (forward.closed) return [edgeSlot, ...forward.chain]
    const backward = this.walkLoop(edgeSlot, edge[0])
    return [...backward.chain.reverse(), edgeSlot, ...forward.chain]
  }

  /** Blender's edge ring: step across each quad to the edge facing the one arrived on. */
  edgeRing(edgeSlot: number): number[] {
    const faces = this.edgeFaceLists[edgeSlot]
    if (!faces || faces.length === 0) return this.mesh.edges[edgeSlot] ? [edgeSlot] : []
    const forward = this.walkRing(edgeSlot, faces[0]!)
    if (forward.closed) return [edgeSlot, ...forward.chain]
    const second = faces[1]
    const backward = second === undefined ? { chain: [], closed: false } : this.walkRing(edgeSlot, second)
    return [...backward.chain.reverse(), edgeSlot, ...forward.chain]
  }

  private walkLoop(startEdge: number, startVertex: number): Walk {
    const chain: number[] = []
    const visited = new Set<number>([startEdge])
    let edge = startEdge
    let vertex = startVertex
    for (;;) {
      const next = this.oppositeLoopEdge(vertex, edge)
      if (next < 0) return { chain, closed: false }
      if (next === startEdge) return { chain, closed: true }
      if (visited.has(next)) return { chain, closed: false }
      visited.add(next)
      chain.push(next)
      const ahead = this.otherVertex(next, vertex)
      if (ahead < 0) return { chain, closed: false }
      vertex = ahead
      edge = next
    }
  }

  private walkRing(startEdge: number, startFace: number): Walk {
    const chain: number[] = []
    const visited = new Set<number>([startEdge])
    let edge = startEdge
    let face = startFace
    for (;;) {
      const next = this.oppositeRingEdge(edge, face)
      if (next < 0) return { chain, closed: false }
      if (next === startEdge) return { chain, closed: true }
      if (visited.has(next)) return { chain, closed: false }
      visited.add(next)
      chain.push(next)
      const ahead = (this.edgeFaceLists[next] ?? []).find((candidate) => candidate !== face)
      if (ahead === undefined) return { chain, closed: false }
      edge = next
      face = ahead
    }
  }

  /**
   * The fourth edge at a four-valence vertex: not the edge arrived on, and in neither of the two
   * faces that edge belongs to. Anything else — a pole, a boundary, a seam — has no opposite, and
   * the loop stops there rather than guessing.
   */
  private oppositeLoopEdge(vertexSlot: number, edgeSlot: number): number {
    const edges = this.vertexEdgeLists[vertexSlot]
    if (!edges || edges.length !== 4) return -1
    const faces = this.edgeFaceLists[edgeSlot]
    if (!faces || faces.length !== 2) return -1
    const shared = new Set<number>([edgeSlot])
    for (const face of faces) {
      for (const edge of this.faceEdgeLists[face] ?? []) {
        const pair = this.mesh.edges[edge]
        if (!pair) continue
        if (pair[0] === vertexSlot || pair[1] === vertexSlot) shared.add(edge)
      }
    }
    const rest = edges.filter((edge) => !shared.has(edge))
    return rest.length === 1 ? rest[0]! : -1
  }

  private oppositeRingEdge(edgeSlot: number, faceSlot: number): number {
    const edges = this.faceEdgeLists[faceSlot]
    if (!edges || edges.length !== 4) return -1
    const index = edges.indexOf(edgeSlot)
    return index < 0 ? -1 : edges[(index + 2) % 4] ?? -1
  }

  private otherVertex(edgeSlot: number, vertexSlot: number): number {
    const edge = this.mesh.edges[edgeSlot]
    if (!edge) return -1
    if (edge[0] === vertexSlot) return edge[1]
    if (edge[1] === vertexSlot) return edge[0]
    return -1
  }

  /* ------------------------------------------------------- reach and parts */

  /** Every vertex reachable from this one through edges, the start included. */
  linked(vertexSlot: number): number[] {
    if (vertexSlot < 0 || vertexSlot >= this.vertexCount) return []
    const reached = new Set<number>([vertexSlot])
    const queue = [vertexSlot]
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!
      for (const edge of this.vertexEdgeLists[current] ?? []) {
        const other = this.otherVertex(edge, current)
        if (other < 0 || reached.has(other)) continue
        reached.add(other)
        queue.push(other)
      }
    }
    return queue
  }

  /** Connected components, as lists of vertex slots. A vertex on its own is a part of one. */
  looseParts(): number[][] {
    const seen = new Set<number>()
    const parts: number[][] = []
    for (let vertex = 0; vertex < this.vertexCount; vertex += 1) {
      if (seen.has(vertex)) continue
      const part = this.linked(vertex)
      for (const slot of part) seen.add(slot)
      parts.push(part)
    }
    return parts
  }

  /**
   * The cheapest run of edges from one vertex to another, by edge length rather than edge count —
   * which is what Blender's shortest path picks, and what a person tracing a seam expects.
   * Empty when the two are in different parts.
   */
  shortestPath(fromVertexSlot: number, toVertexSlot: number): number[] {
    if (fromVertexSlot < 0 || fromVertexSlot >= this.vertexCount) return []
    if (toVertexSlot < 0 || toVertexSlot >= this.vertexCount) return []
    if (fromVertexSlot === toVertexSlot) return [fromVertexSlot]
    const distance = new Float64Array(this.vertexCount).fill(Number.POSITIVE_INFINITY)
    const previous = new Int32Array(this.vertexCount).fill(-1)
    const settled = new Uint8Array(this.vertexCount)
    distance[fromVertexSlot] = 0
    const queue = new SlotHeap()
    queue.push(fromVertexSlot, 0)
    while (queue.size > 0) {
      const current = queue.pop()
      if (current < 0) break
      if (settled[current]) continue
      settled[current] = 1
      if (current === toVertexSlot) break
      const here = this.position(current)
      for (const edge of this.vertexEdgeLists[current] ?? []) {
        const other = this.otherVertex(edge, current)
        if (other < 0 || settled[other]) continue
        const step = distance[current]! + length(subtract(this.position(other), here))
        if (step >= distance[other]!) continue
        distance[other] = step
        previous[other] = current
        queue.push(other, step)
      }
    }
    if (!settled[toVertexSlot]) return []
    const path = [toVertexSlot]
    let walk = previous[toVertexSlot]!
    while (walk >= 0) {
      path.push(walk)
      walk = previous[walk]!
    }
    return path.reverse()
  }

  /* --------------------------------------------------------------- measure */

  faceNormal(faceSlot: number): Vec3 {
    return faceNormal(this.mesh, faceSlot)
  }

  vertexNormal(vertexSlot: number): Vec3 {
    return vertexNormal(this.mesh, vertexSlot)
  }

  bounds(): { min: Vec3; max: Vec3; centre: Vec3; size: Vec3 } {
    return meshBounds(this.mesh)
  }

  /* ------------------------------------------------------------- building */

  /** Appends a vertex and mints an id for it; the slot it lands on is the one returned. */
  addVertex(point: Vec3): number {
    const slot = this.vertexCount
    const id = this.mesh.nextVertexId
    this.mesh.vertices.push(point[0], point[1], point[2])
    this.mesh.vertexIds.push(id)
    this.mesh.nextVertexId = id + 1
    this.vertexIdIndex.set(id, slot)
    this.vertexEdgeLists.push([])
    this.vertexFaceLists.push([])
    const colour = this.mesh.attributes.vertex.color
    const stride = colour ? colourStride(colour.length, slot) : 0
    if (colour && stride > 0) for (let channel = 0; channel < stride; channel += 1) colour.push(1)
    return slot
  }

  /**
   * Appends a face over existing vertices, adding any edge it needs that the mesh has not got.
   * Repeats and slots that do not exist are dropped; fewer than three corners left is a refusal,
   * answered with -1 rather than a face nothing could draw.
   */
  addFace(vertexSlots: number[]): number {
    const loop: number[] = []
    for (const slot of vertexSlots) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= this.vertexCount) continue
      if (loop.includes(slot)) continue
      loop.push(slot)
    }
    if (loop.length < 3) return -1
    const face = this.mesh.faces.length
    const id = this.mesh.nextFaceId
    this.mesh.faces.push(loop)
    this.mesh.faceIds.push(id)
    this.mesh.nextFaceId = id + 1
    this.faceIdIndex.set(id, face)
    this.mesh.attributes.face.smooth.push(false)
    this.mesh.attributes.face.material.push(0)
    this.mesh.attributes.vertex.uv?.push([])
    const edges: number[] = []
    for (let index = 0; index < loop.length; index += 1) {
      const edge = this.ensureEdge(loop[index]!, loop[(index + 1) % loop.length]!)
      edges.push(edge)
      this.edgeFaceLists[edge]!.push(face)
    }
    this.faceEdgeLists.push(edges)
    for (const slot of loop) this.vertexFaceLists[slot]!.push(face)
    return face
  }

  /** Removes faces and leaves their edges and vertices behind, the way Blender's Delete Faces does. */
  removeFaces(faceSlots: Iterable<number>): void {
    const faces = this.collect(faceSlots, this.mesh.faces.length)
    if (faces.size === 0) return
    this.compactFaces(faces)
    this.rebuild()
  }

  /** Removes edges, and with them every face that used one. */
  removeEdges(edgeSlots: Iterable<number>): void {
    const edges = this.collect(edgeSlots, this.mesh.edges.length)
    if (edges.size === 0) return
    const faces = new Set<number>()
    for (const edge of edges) for (const face of this.edgeFaceLists[edge] ?? []) faces.add(face)
    this.compactFaces(faces)
    this.compactEdges(edges)
    this.rebuild()
  }

  /** Removes vertices, and with them every edge and face that used one. */
  removeVertices(vertexSlots: Iterable<number>): void {
    const vertices = this.collect(vertexSlots, this.vertexCount)
    if (vertices.size === 0) return
    const edges = new Set<number>()
    const faces = new Set<number>()
    for (const vertex of vertices) {
      for (const edge of this.vertexEdgeLists[vertex] ?? []) edges.add(edge)
      for (const face of this.vertexFaceLists[vertex] ?? []) faces.add(face)
    }
    this.compactFaces(faces)
    this.compactEdges(edges)
    this.compactVertices(vertices)
    this.rebuild()
  }

  /** Removes every edge and vertex no face uses any more, which is what an operator leaves behind. */
  dropLoose(): void {
    const usedEdges = new Set<number>()
    const usedVertices = new Set<number>()
    for (let face = 0; face < this.mesh.faces.length; face += 1) {
      for (const edge of this.faceEdgeLists[face] ?? []) usedEdges.add(edge)
      for (const slot of this.mesh.faces[face] ?? []) usedVertices.add(slot)
    }
    const edges = new Set<number>()
    for (let edge = 0; edge < this.mesh.edges.length; edge += 1) if (!usedEdges.has(edge)) edges.add(edge)
    const vertices = new Set<number>()
    for (let vertex = 0; vertex < this.vertexCount; vertex += 1) if (!usedVertices.has(vertex)) vertices.add(vertex)
    if (edges.size === 0 && vertices.size === 0) return
    this.compactEdges(edges)
    this.compactVertices(vertices)
    this.rebuild()
  }

  /**
   * Turns a face's loop around, so its normal points the other way. The first corner stays where it
   * is: the loop's starting point is what a UV row and a corner attribute are addressed by.
   */
  flipFace(faceSlot: number): void {
    const loop = this.mesh.faces[faceSlot]
    if (!loop || loop.length < 3) return
    const order = [0]
    for (let index = loop.length - 1; index >= 1; index -= 1) order.push(index)
    this.mesh.faces[faceSlot] = order.map((index) => loop[index]!)
    const uv = this.mesh.attributes.vertex.uv?.[faceSlot]
    if (uv && uv.length === loop.length * 2) {
      this.mesh.attributes.vertex.uv![faceSlot] = order.flatMap((index) => [uv[index * 2]!, uv[index * 2 + 1]!])
    }
    const next = this.mesh.faces[faceSlot]!
    const edges: number[] = []
    for (let index = 0; index < next.length; index += 1) {
      const edge = this.edgeSlot(next[index]!, next[(index + 1) % next.length]!)
      if (edge >= 0) edges.push(edge)
    }
    this.faceEdgeLists[faceSlot] = edges
  }

  /* -------------------------------------------------------------- internals */

  private collect(slots: Iterable<number>, count: number): Set<number> {
    const kept = new Set<number>()
    for (const slot of slots) {
      if (Number.isInteger(slot) && slot >= 0 && slot < count) kept.add(slot)
    }
    return kept
  }

  private ensureEdge(a: number, b: number): number {
    const key = slotPairKey(a, b)
    const existing = this.edgeIndex.get(key)
    if (existing !== undefined) return existing
    const slot = this.mesh.edges.length
    this.mesh.edges.push([Math.min(a, b), Math.max(a, b)])
    this.edgeIndex.set(key, slot)
    this.edgeFaceLists.push([])
    this.vertexEdgeLists[a]!.push(slot)
    this.vertexEdgeLists[b]!.push(slot)
    const attributes = this.mesh.attributes.edge
    attributes.seam?.push(false)
    attributes.sharp?.push(false)
    attributes.crease?.push(0)
    attributes.bevelWeight?.push(0)
    return slot
  }

  private compactFaces(drop: Set<number>): void {
    if (drop.size === 0) return
    const keep: number[] = []
    for (let face = 0; face < this.mesh.faces.length; face += 1) if (!drop.has(face)) keep.push(face)
    const faces = this.mesh.faces
    const faceIds = this.mesh.faceIds
    const attributes = this.mesh.attributes.face
    const smooth = attributes.smooth
    const material = attributes.material
    const uv = this.mesh.attributes.vertex.uv
    this.mesh.faces = keep.map((face) => faces[face]!)
    this.mesh.faceIds = keep.map((face) => faceIds[face]!)
    attributes.smooth = keep.map((face) => smooth[face] ?? false)
    attributes.material = keep.map((face) => material[face] ?? 0)
    if (uv) this.mesh.attributes.vertex.uv = keep.map((face) => uv[face] ?? [])
  }

  private compactEdges(drop: Set<number>): void {
    if (drop.size === 0) return
    const keep: number[] = []
    for (let edge = 0; edge < this.mesh.edges.length; edge += 1) if (!drop.has(edge)) keep.push(edge)
    const edges = this.mesh.edges
    this.mesh.edges = keep.map((edge) => edges[edge]!)
    const attributes = this.mesh.attributes.edge
    const seam = attributes.seam
    const sharp = attributes.sharp
    const crease = attributes.crease
    const bevelWeight = attributes.bevelWeight
    if (seam) attributes.seam = keep.map((edge) => seam[edge] ?? false)
    if (sharp) attributes.sharp = keep.map((edge) => sharp[edge] ?? false)
    if (crease) attributes.crease = keep.map((edge) => crease[edge] ?? 0)
    if (bevelWeight) attributes.bevelWeight = keep.map((edge) => bevelWeight[edge] ?? 0)
  }

  private compactVertices(drop: Set<number>): void {
    if (drop.size === 0) return
    const count = this.vertexCount
    const remap = new Int32Array(count).fill(-1)
    const keep: number[] = []
    for (let vertex = 0; vertex < count; vertex += 1) {
      if (drop.has(vertex)) continue
      remap[vertex] = keep.length
      keep.push(vertex)
    }
    const source = this.mesh.vertices
    const vertices: number[] = []
    for (const vertex of keep) {
      vertices.push(source[vertex * 3] ?? 0, source[vertex * 3 + 1] ?? 0, source[vertex * 3 + 2] ?? 0)
    }
    const vertexIds = this.mesh.vertexIds
    this.mesh.vertices = vertices
    this.mesh.vertexIds = keep.map((vertex) => vertexIds[vertex]!)
    const colour = this.mesh.attributes.vertex.color
    const stride = colour ? colourStride(colour.length, count) : 0
    if (colour && stride > 0) {
      const next: number[] = []
      for (const vertex of keep) {
        for (let channel = 0; channel < stride; channel += 1) next.push(colour[vertex * stride + channel] ?? 1)
      }
      this.mesh.attributes.vertex.color = next
    }
    // Anything still naming a dropped vertex would draw as a hole; the callers remove it first, and
    // this is the belt to their braces.
    const keptEdges = new Set<number>()
    const edges: Array<[number, number]> = []
    for (let edge = 0; edge < this.mesh.edges.length; edge += 1) {
      const pair = this.mesh.edges[edge]!
      const a = remap[pair[0]] ?? -1
      const b = remap[pair[1]] ?? -1
      if (a < 0 || b < 0) continue
      keptEdges.add(edge)
      edges.push([Math.min(a, b), Math.max(a, b)])
    }
    if (keptEdges.size !== this.mesh.edges.length) {
      const stale = new Set<number>()
      for (let edge = 0; edge < this.mesh.edges.length; edge += 1) if (!keptEdges.has(edge)) stale.add(edge)
      this.compactEdges(stale)
    }
    this.mesh.edges = edges
    const loops = this.mesh.faces
    const staleFaces = new Set<number>()
    const remapped: number[][] = []
    for (let face = 0; face < loops.length; face += 1) {
      const loop = loops[face]!.map((slot) => remap[slot] ?? -1)
      if (loop.some((slot) => slot < 0)) {
        staleFaces.add(face)
        remapped.push([])
        continue
      }
      remapped.push(loop)
    }
    this.mesh.faces = remapped
    if (staleFaces.size > 0) this.compactFaces(staleFaces)
  }

  /**
   * Builds every adjacency list from the arrays as they stand. Adding geometry keeps the lists up to
   * date as it goes; removing it renumbers everything, so removal pays for one pass instead.
   */
  private rebuild(): void {
    const vertexCount = this.mesh.vertexIds.length
    const faceCount = this.mesh.faces.length
    this.vertexEdgeLists = Array.from({ length: vertexCount }, () => [])
    this.vertexFaceLists = Array.from({ length: vertexCount }, () => [])
    this.edgeFaceLists = this.mesh.edges.map(() => [])
    this.faceEdgeLists = Array.from({ length: faceCount }, () => [])
    this.edgeIndex = new Map()
    this.vertexIdIndex = new Map()
    this.faceIdIndex = new Map()
    for (let slot = 0; slot < vertexCount; slot += 1) this.vertexIdIndex.set(this.mesh.vertexIds[slot]!, slot)
    for (let slot = 0; slot < faceCount; slot += 1) this.faceIdIndex.set(this.mesh.faceIds[slot]!, slot)
    for (let slot = 0; slot < this.mesh.edges.length; slot += 1) {
      const pair = this.mesh.edges[slot]!
      this.edgeIndex.set(slotPairKey(pair[0], pair[1]), slot)
      this.vertexEdgeLists[pair[0]]?.push(slot)
      this.vertexEdgeLists[pair[1]]?.push(slot)
    }
    for (let face = 0; face < faceCount; face += 1) {
      const loop = this.mesh.faces[face]!
      const edges = this.faceEdgeLists[face]!
      for (let index = 0; index < loop.length; index += 1) {
        // A face names an edge the mesh has not got only when a file was written badly; minting it
        // here is what keeps `faceEdges` and `faceVertices` the same length, which the ring walk
        // and every operator rely on.
        const edge = this.ensureEdge(loop[index]!, loop[(index + 1) % loop.length]!)
        edges.push(edge)
        this.edgeFaceLists[edge]!.push(face)
      }
      for (const slot of loop) this.vertexFaceLists[slot]?.push(face)
    }
  }
}

/** How many numbers a vertex colour takes, or 0 when the array does not divide evenly. */
function colourStride(colourLength: number, vertexCount: number): number {
  if (vertexCount <= 0) return 0
  const stride = Math.floor(colourLength / vertexCount)
  return stride > 0 && stride * vertexCount === colourLength ? stride : 0
}

/**
 * A binary heap of vertex slots by distance. The path search would otherwise scan every unsettled
 * vertex on each step, which turns a walk across a corner of a dense mesh into a walk across all of it.
 */
class SlotHeap {
  private readonly slots: number[] = []
  private readonly keys: number[] = []

  get size(): number {
    return this.slots.length
  }

  push(slot: number, key: number): void {
    this.slots.push(slot)
    this.keys.push(key)
    let index = this.slots.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.keys[parent]! <= this.keys[index]!) break
      this.swap(parent, index)
      index = parent
    }
  }

  pop(): number {
    if (this.slots.length === 0) return -1
    const top = this.slots[0]!
    const slot = this.slots.pop()!
    const key = this.keys.pop()!
    if (this.slots.length === 0) return top
    this.slots[0] = slot
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
    const slot = this.slots[a]!
    const key = this.keys[a]!
    this.slots[a] = this.slots[b]!
    this.keys[a] = this.keys[b]!
    this.slots[b] = slot
    this.keys[b] = key
  }
}
