import { cloneMesh, setVertexPosition, vertexPosition } from '@/scene/mesh/data'
import { dot, faceArea, faceCentre, faceNormal, length, meshBounds, subtract, vertexNormal } from '@/scene/mesh/normals'
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

  /* ------------------------------------------------------------- measuring */

  edgeLength(edgeSlot: number): number {
    const edge = this.mesh.edges[edgeSlot]
    if (!edge) return 0
    return length(subtract(this.position(edge[1]), this.position(edge[0])))
  }

  faceCentre(faceSlot: number): Vec3 {
    return faceCentre(this.mesh, faceSlot)
  }

  faceArea(faceSlot: number): number {
    return faceArea(this.mesh, faceSlot)
  }

  facePerimeter(faceSlot: number): number {
    const loop = this.mesh.faces[faceSlot]
    if (!loop || loop.length < 2) return 0
    let total = 0
    for (let index = 0; index < loop.length; index += 1) {
      const here = this.position(loop[index]!)
      const next = this.position(loop[(index + 1) % loop.length]!)
      total += length(subtract(next, here))
    }
    return total
  }

  /**
   * How sharply the two faces at an edge fold, in radians: 0 where they lie flat, π at a spike.
   * An edge with anything other than two faces has no fold, and answers 0 — which is what limited
   * dissolve and “select sharp edges” both want, since neither should act on a boundary.
   */
  dihedral(edgeSlot: number): number {
    const faces = this.edgeFaceLists[edgeSlot]
    if (!faces || faces.length !== 2) return 0
    const cosine = dot(this.faceNormal(faces[0]!), this.faceNormal(faces[1]!))
    return Math.acos(Math.min(1, Math.max(-1, cosine)))
  }

  /** The average of some vertices, which is the median pivot and the centre of a merge. */
  median(vertexSlots: Iterable<number>): Vec3 {
    let x = 0
    let y = 0
    let z = 0
    let count = 0
    for (const slot of vertexSlots) {
      if (!this.hasVertex(slot)) continue
      const point = this.position(slot)
      x += point[0]
      y += point[1]
      z += point[2]
      count += 1
    }
    if (count === 0) return [0, 0, 0]
    return [x / count, y / count, z / count]
  }

  /** The box around some vertices. Empty input answers a box at the origin, never NaN. */
  boundsOf(vertexSlots: Iterable<number>): { min: Vec3; max: Vec3; centre: Vec3; size: Vec3 } {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let count = 0
    for (const slot of vertexSlots) {
      if (!this.hasVertex(slot)) continue
      const [x, y, z] = this.position(slot)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
      count += 1
    }
    if (count === 0) return { min: [0, 0, 0], max: [0, 0, 0], centre: [0, 0, 0], size: [0, 0, 0] }
    const min: Vec3 = [minX, minY, minZ]
    const max: Vec3 = [maxX, maxY, maxZ]
    return {
      min,
      max,
      centre: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
    }
  }

  /** Whether a vertex is one a surface passes cleanly through: manifold edges, and a single fan. */
  isManifoldVertex(vertexSlot: number): boolean {
    const edges = this.vertexEdgeLists[vertexSlot]
    if (!edges || edges.length === 0) return false
    for (const edge of edges) if (!this.isEdgeManifold(edge)) return false
    return this.hasSingleFan(vertexSlot)
  }

  hasVertex(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 0 && slot < this.vertexCount
  }

  hasEdge(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 0 && slot < this.mesh.edges.length
  }

  hasFace(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 0 && slot < this.mesh.faces.length
  }

  /* --------------------------------------------------------------- regions */

  /**
   * The outer boundary of a patch of faces, as cycles of vertex slots wound the way the faces are.
   *
   * The walk is over directed corners rather than edges: a corner whose opposite is also in the
   * patch is inside it, and everything left over is the rim. That gives the winding for free, which
   * an extrusion needs to build its side faces facing outwards, and it costs one pass.
   */
  boundaryLoops(faceSlots: Iterable<number>): number[][] {
    const faces = this.collect(faceSlots, this.mesh.faces.length)
    const directed = new Set<string>()
    for (const face of faces) {
      const loop = this.mesh.faces[face]!
      for (let index = 0; index < loop.length; index += 1) {
        directed.add(`${loop[index]}>${loop[(index + 1) % loop.length]}`)
      }
    }
    const next = new Map<number, number[]>()
    for (const key of directed) {
      const [from, to] = key.split('>').map(Number) as [number, number]
      if (directed.has(`${to}>${from}`)) continue
      const list = next.get(from)
      if (list) list.push(to)
      else next.set(from, [to])
    }
    const loops: number[][] = []
    const used = new Set<string>()
    for (const [start, targets] of next) {
      for (const first of targets) {
        if (used.has(`${start}>${first}`)) continue
        const loop = [start]
        let from = start
        let to = first
        for (;;) {
          used.add(`${from}>${to}`)
          if (to === start) break
          loop.push(to)
          const onward = (next.get(to) ?? []).find((candidate) => !used.has(`${to}>${candidate}`))
          if (onward === undefined) break
          from = to
          to = onward
        }
        if (loop.length >= 3) loops.push(loop)
      }
    }
    return loops
  }

  /* -------------------------------------------------------------- mutating */

  /** The edge between two vertices, minted if the mesh has not got it. */
  addEdge(a: number, b: number): number {
    if (a === b || !this.hasVertex(a) || !this.hasVertex(b)) return -1
    return this.ensureEdge(a, b)
  }

  /**
   * Rewrites a face's corners, keeping its id, its material and its shading.
   *
   * Its UVs do not survive a change of corner count — this prompt cuts geometry, and the UV work is
   * a later one — so they are dropped rather than left mismatched with the loop they address.
   */
  setFaceLoop(faceSlot: number, loop: number[]): boolean {
    if (!this.hasFace(faceSlot)) return false
    const cleaned = this.cleanLoop(loop)
    if (cleaned.length < 3) return false
    const before = this.mesh.faces[faceSlot]!.length
    this.detachFace(faceSlot)
    this.mesh.faces[faceSlot] = cleaned
    this.attachFace(faceSlot)
    const uv = this.mesh.attributes.vertex.uv
    if (uv && cleaned.length !== before) uv[faceSlot] = []
    return true
  }

  /**
   * Splits several edges at once, each at `t` along it, and answers the new vertex slot for each.
   *
   * Doing them together is not an optimisation: an edge is named by a slot, removing one edge
   * renumbers the rest, and so splitting them one call at a time would hand the caller a list of
   * stale numbers after the first. Vertices and faces are only ever added here, so the slots this
   * returns stay good.
   */
  splitEdges(cuts: Array<{ edge: number; t?: number }>): number[] {
    const wanted: Array<{ edge: number; a: number; b: number; t: number }> = []
    const seen = new Set<number>()
    for (const cut of cuts) {
      if (!this.hasEdge(cut.edge) || seen.has(cut.edge)) continue
      seen.add(cut.edge)
      const pair = this.mesh.edges[cut.edge]!
      wanted.push({ edge: cut.edge, a: pair[0], b: pair[1], t: Math.min(1, Math.max(0, cut.t ?? 0.5)) })
    }
    if (wanted.length === 0) return []
    const middles = new Map<number, number>()
    const created: number[] = []
    for (const cut of wanted) {
      const from = this.position(cut.a)
      const to = this.position(cut.b)
      const slot = this.addVertex([
        from[0] + (to[0] - from[0]) * cut.t,
        from[1] + (to[1] - from[1]) * cut.t,
        from[2] + (to[2] - from[2]) * cut.t,
      ])
      middles.set(cut.edge, slot)
      created.push(slot)
    }
    const touched = new Set<number>()
    for (const cut of wanted) for (const face of this.edgeFaceLists[cut.edge] ?? []) touched.add(face)
    for (const face of touched) {
      const loop = this.mesh.faces[face]!
      const next: number[] = []
      for (let index = 0; index < loop.length; index += 1) {
        const here = loop[index]!
        const ahead = loop[(index + 1) % loop.length]!
        next.push(here)
        const edge = this.edgeSlot(here, ahead)
        const middle = edge >= 0 ? middles.get(edge) : undefined
        if (middle !== undefined) next.push(middle)
      }
      this.setFaceLoop(face, next)
    }
    for (const cut of wanted) {
      const middle = middles.get(cut.edge)!
      this.ensureEdge(cut.a, middle)
      this.ensureEdge(middle, cut.b)
    }
    // The halves carry the whole edge's attributes: a crease or a seam that was on it stays on both,
    // which is what Blender does and what keeps a subdivided seam a seam.
    const attributes = this.mesh.attributes.edge
    for (const cut of wanted) {
      const middle = middles.get(cut.edge)!
      for (const half of [this.edgeSlot(cut.a, middle), this.edgeSlot(middle, cut.b)]) {
        if (half < 0) continue
        if (attributes.seam) attributes.seam[half] = attributes.seam[cut.edge] ?? false
        if (attributes.sharp) attributes.sharp[half] = attributes.sharp[cut.edge] ?? false
        if (attributes.crease) attributes.crease[half] = attributes.crease[cut.edge] ?? 0
        if (attributes.bevelWeight) attributes.bevelWeight[half] = attributes.bevelWeight[cut.edge] ?? 0
      }
    }
    this.removeGeometry(new Set(), new Set(wanted.map((cut) => cut.edge)), new Set())
    return created
  }

  /** One edge split, at `t` along it; the new vertex's slot, or -1 when there is no such edge. */
  splitEdge(edgeSlot: number, t = 0.5): number {
    return this.splitEdges([{ edge: edgeSlot, t }])[0] ?? -1
  }

  /**
   * Cuts a face in two along the line between two of its corners. The face keeps its id and the
   * first half; the second half is a new face with the same material and shading.
   * Answers the new face's slot, or -1 when the two corners are the same, not both on the face, or
   * next to each other — none of which is a cut, and all of which would leave a degenerate face.
   */
  splitFace(faceSlot: number, a: number, b: number): number {
    const loop = this.mesh.faces[faceSlot]
    if (!loop || a === b) return -1
    const from = loop.indexOf(a)
    const to = loop.indexOf(b)
    if (from < 0 || to < 0) return -1
    const forward: number[] = []
    for (let index = from; ; index = (index + 1) % loop.length) {
      forward.push(loop[index]!)
      if (index === to) break
    }
    const backward: number[] = []
    for (let index = to; ; index = (index + 1) % loop.length) {
      backward.push(loop[index]!)
      if (index === from) break
    }
    if (forward.length < 3 || backward.length < 3) return -1
    if (!this.setFaceLoop(faceSlot, forward)) return -1
    const added = this.addFace(backward)
    if (added >= 0) this.copyFaceAttributes(faceSlot, added)
    return added
  }

  /**
   * Merges faces into the n-gon of their outer rim, along the edges they share.
   * Answers the slot the merged face landed on, or -1 when the faces do not make a single patch
   * with a single rim — two faces touching at a corner only, or a patch with a hole in it.
   */
  joinFaces(faceSlots: Iterable<number>): number {
    const faces = this.collect(faceSlots, this.mesh.faces.length)
    if (faces.size === 0) return -1
    if (faces.size === 1) return [...faces][0]!
    const shared = new Set<number>()
    for (const face of faces) {
      for (const edge of this.faceEdgeLists[face] ?? []) {
        const users = (this.edgeFaceLists[edge] ?? []).filter((candidate) => faces.has(candidate))
        if (users.length === 2) shared.add(edge)
      }
    }
    const id = this.faceId(Math.min(...faces))
    const merged = this.mergeRegions(faces, shared)
    if (merged.kept.length !== 1) return -1
    this.removeGeometry(merged.dead, merged.interior, new Set())
    return this.slotOfFace(id)
  }

  /**
   * Pulls an edge down to a point: both its vertices become one, at the middle, and any face that
   * had only a triangle's worth of corners left goes with it. Answers the surviving vertex's slot.
   */
  collapseEdge(edgeSlot: number): number {
    const edge = this.mesh.edges[edgeSlot]
    if (!edge) return -1
    const [keep, drop] = [edge[0], edge[1]]
    const keepId = this.vertexId(keep)
    const from = this.position(keep)
    const to = this.position(drop)
    this.setPosition(keep, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2])
    const dead = new Set<number>()
    for (const face of this.vertexFaces(drop)) {
      const loop = this.cleanLoop(this.mesh.faces[face]!.map((slot) => (slot === drop ? keep : slot)))
      if (loop.length < 3) dead.add(face)
      else this.setFaceLoop(face, loop)
    }
    for (const other of this.vertexEdges(drop)) {
      const pair = this.mesh.edges[other]!
      const far = pair[0] === drop ? pair[1] : pair[0]
      if (far !== keep) this.ensureEdge(keep, far)
    }
    this.removeGeometry(dead, new Set(), new Set([drop]))
    return this.slotOfVertex(keepId)
  }

  /**
   * Blender's dissolve, for all three element kinds: the geometry named goes away and what
   * surrounded it becomes one face. A patch that cannot become one face — because it has a hole, or
   * because it pinches at a vertex — is left exactly as it was, and counted as refused.
   */
  dissolveEdges(edgeSlots: Iterable<number>): { dissolved: number; refused: number } {
    const edges = this.collect(edgeSlots, this.mesh.edges.length)
    const inner = new Set<number>()
    const faces = new Set<number>()
    let refused = 0
    for (const edge of edges) {
      const users = this.edgeFaceLists[edge] ?? []
      if (users.length !== 2) {
        refused += 1
        continue
      }
      inner.add(edge)
      for (const face of users) faces.add(face)
    }
    const merged = this.mergeRegions(faces, inner)
    this.removeGeometry(merged.dead, merged.interior, new Set())
    return { dissolved: merged.interior.size, refused: refused + merged.refused }
  }

  dissolveFaces(faceSlots: Iterable<number>): { dissolved: number; refused: number } {
    const faces = this.collect(faceSlots, this.mesh.faces.length)
    const inner = new Set<number>()
    for (const face of faces) {
      for (const edge of this.faceEdgeLists[face] ?? []) {
        const users = (this.edgeFaceLists[edge] ?? []).filter((candidate) => faces.has(candidate))
        if (users.length === 2) inner.add(edge)
      }
    }
    const merged = this.mergeRegions(faces, inner)
    this.removeGeometry(merged.dead, merged.interior, new Set())
    return { dissolved: merged.kept.length, refused: merged.refused }
  }

  dissolveVertices(vertexSlots: Iterable<number>): { dissolved: number; refused: number } {
    const vertices = this.collect(vertexSlots, this.vertexCount)
    const faces = new Set<number>()
    const inner = new Set<number>()
    const gone = new Set<number>()
    let refused = 0
    for (const vertex of vertices) {
      const around = this.vertexFaceLists[vertex] ?? []
      if (around.length === 0) {
        // A vertex no face uses is not dissolved into anything; deleting it is a different verb.
        refused += 1
        continue
      }
      gone.add(vertex)
      for (const face of around) faces.add(face)
      for (const edge of this.vertexEdgeLists[vertex] ?? []) inner.add(edge)
    }
    const merged = this.mergeRegions(faces, inner)
    for (const vertex of [...gone]) {
      // A vertex whose fan refused to merge stays, or the mesh would gain a hole where it was.
      if (merged.stranded.has(vertex)) {
        gone.delete(vertex)
        refused += 1
      }
    }
    /*
     * Merging the fan is only half of it. A vertex on an open rim, and a vertex used by a single
     * face, are still corners of the face that survives — and removing them would take that face
     * with them, which is the opposite of dissolving. Their corner comes off the loop instead, and
     * a loop that would be left with fewer than three corners keeps its vertex rather than
     * collapsing into nothing.
     */
    for (const vertex of [...gone]) {
      let kept = true
      for (const face of this.vertexFaces(vertex)) {
        const loop = this.mesh.faces[face]!.filter((corner) => corner !== vertex)
        if (loop.length < 3 || !this.setFaceLoop(face, loop)) {
          kept = false
          break
        }
      }
      if (kept) continue
      gone.delete(vertex)
      refused += 1
    }
    const edges = new Set<number>()
    for (const edge of merged.interior) edges.add(edge)
    // An edge at a dissolved vertex that no face uses any more goes with it; one still in a face —
    // the two rim edges a boundary dissolve joins — is left for `removeGeometry` to renumber.
    this.removeGeometry(merged.dead, edges, gone)
    return { dissolved: gone.size, refused }
  }

  /**
   * Merges each patch of faces joined by a dissolved edge into one face on the patch's rim.
   * Nothing is removed here: the faces that lost their geometry and the edges that went inside are
   * handed back, so that one removal can renumber the mesh once at the end of an operator.
   */
  private mergeRegions(
    faceSlots: Iterable<number>,
    dissolved: Set<number>,
  ): { kept: number[]; dead: Set<number>; interior: Set<number>; refused: number; stranded: Set<number> } {
    const faces = this.collect(faceSlots, this.mesh.faces.length)
    const kept: number[] = []
    const dead = new Set<number>()
    const interior = new Set<number>()
    const stranded = new Set<number>()
    const seen = new Set<number>()
    let refused = 0
    for (const start of [...faces].sort((a, b) => a - b)) {
      if (seen.has(start)) continue
      const region: number[] = [start]
      seen.add(start)
      for (let index = 0; index < region.length; index += 1) {
        for (const edge of this.faceEdgeLists[region[index]!] ?? []) {
          if (!dissolved.has(edge)) continue
          for (const face of this.edgeFaceLists[edge] ?? []) {
            if (!faces.has(face) || seen.has(face)) continue
            seen.add(face)
            region.push(face)
          }
        }
      }
      if (region.length < 2) continue
      const outcome = this.regionLoop(region, dissolved)
      if (!outcome) {
        refused += 1
        for (const face of region) for (const slot of this.mesh.faces[face] ?? []) stranded.add(slot)
        continue
      }
      const survivor = Math.min(...region)
      if (!this.setFaceLoop(survivor, outcome.loop)) {
        refused += 1
        for (const face of region) for (const slot of this.mesh.faces[face] ?? []) stranded.add(slot)
        continue
      }
      kept.push(survivor)
      for (const face of region) if (face !== survivor) dead.add(face)
      for (const edge of outcome.interior) interior.add(edge)
    }
    return { kept, dead, interior, refused, stranded }
  }

  /** The single rim of a patch, wound like its faces, or null when the patch has not got one. */
  private regionLoop(region: number[], dissolved: Set<number>): { loop: number[]; interior: Set<number> } | null {
    const directed = new Set<string>()
    for (const face of region) {
      const loop = this.mesh.faces[face]!
      for (let index = 0; index < loop.length; index += 1) {
        directed.add(`${loop[index]}>${loop[(index + 1) % loop.length]}`)
      }
    }
    const interior = new Set<number>()
    const next = new Map<number, number>()
    for (const key of directed) {
      const [from, to] = key.split('>').map(Number) as [number, number]
      const edge = this.edgeSlot(from, to)
      if (directed.has(`${to}>${from}`)) {
        // An edge with a face on both sides is inside the patch. If it was not one of the edges
        // being dissolved, merging would swallow it silently — so the patch is refused instead.
        if (edge < 0 || !dissolved.has(edge)) return null
        interior.add(edge)
        continue
      }
      if (next.has(from)) return null
      next.set(from, to)
    }
    if (next.size < 3) return null
    const start = next.keys().next().value as number
    const loop = [start]
    let walk = next.get(start)!
    while (walk !== start) {
      if (loop.length > next.size) return null
      loop.push(walk)
      const onward = next.get(walk)
      if (onward === undefined) return null
      walk = onward
    }
    if (loop.length !== next.size) return null
    return { loop, interior }
  }

  /** Removes faces, edges and vertices in one pass, so slots renumber once rather than three times. */
  private removeGeometry(faces: Set<number>, edges: Set<number>, vertices: Set<number>): void {
    if (faces.size === 0 && edges.size === 0 && vertices.size === 0) return
    for (const edge of edges) for (const face of this.edgeFaceLists[edge] ?? []) faces.add(face)
    for (const vertex of vertices) {
      for (const edge of this.vertexEdgeLists[vertex] ?? []) edges.add(edge)
      for (const face of this.vertexFaceLists[vertex] ?? []) faces.add(face)
    }
    this.compactFaces(faces)
    this.compactEdges(edges)
    this.compactVertices(vertices)
    this.rebuild()
  }

  /** Public removal of anything, by kind, in one renumbering. */
  remove(what: { faces?: Iterable<number>; edges?: Iterable<number>; vertices?: Iterable<number> }): void {
    this.removeGeometry(
      this.collect(what.faces ?? [], this.mesh.faces.length),
      this.collect(what.edges ?? [], this.mesh.edges.length),
      this.collect(what.vertices ?? [], this.vertexCount),
    )
  }

  /** Gives a face another's material and shading, which every face an operator mints should have. */
  copyFaceAttributes(from: number, to: number): void {
    const attributes = this.mesh.attributes.face
    if (!this.hasFace(from) || !this.hasFace(to)) return
    attributes.smooth[to] = attributes.smooth[from] ?? false
    attributes.material[to] = attributes.material[from] ?? 0
  }

  /** A face's material slot, and its shading, which several operators carry across and Data reads. */
  faceMaterial(faceSlot: number): number {
    return this.mesh.attributes.face.material[faceSlot] ?? 0
  }

  setFaceMaterial(faceSlot: number, material: number): void {
    if (this.hasFace(faceSlot)) this.mesh.attributes.face.material[faceSlot] = Math.max(0, Math.round(material))
  }

  faceSmooth(faceSlot: number): boolean {
    return this.mesh.attributes.face.smooth[faceSlot] ?? false
  }

  setFaceSmooth(faceSlot: number, smooth: boolean): void {
    if (this.hasFace(faceSlot)) this.mesh.attributes.face.smooth[faceSlot] = smooth
  }

  /** The edge attributes, read and written by slot: seam, sharp, crease and bevel weight. */
  edgeFlag(edgeSlot: number, flag: 'seam' | 'sharp'): boolean {
    return this.mesh.attributes.edge[flag]?.[edgeSlot] ?? false
  }

  setEdgeFlag(edgeSlot: number, flag: 'seam' | 'sharp', value: boolean): void {
    if (!this.hasEdge(edgeSlot)) return
    const attributes = this.mesh.attributes.edge
    if (!attributes[flag]) attributes[flag] = this.mesh.edges.map(() => false)
    attributes[flag]![edgeSlot] = value
  }

  edgeNumber(edgeSlot: number, flag: 'crease' | 'bevelWeight'): number {
    return this.mesh.attributes.edge[flag]?.[edgeSlot] ?? 0
  }

  setEdgeNumber(edgeSlot: number, flag: 'crease' | 'bevelWeight', value: number): void {
    if (!this.hasEdge(edgeSlot)) return
    const attributes = this.mesh.attributes.edge
    if (!attributes[flag]) attributes[flag] = this.mesh.edges.map(() => 0)
    attributes[flag]![edgeSlot] = Math.min(1, Math.max(0, value))
  }

  /** A loop with repeats and unknown slots taken out, and the wrap-around repeat with them. */
  private cleanLoop(loop: number[]): number[] {
    const cleaned: number[] = []
    for (const slot of loop) {
      if (!this.hasVertex(slot)) continue
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] === slot) continue
      if (cleaned.includes(slot)) continue
      cleaned.push(slot)
    }
    return cleaned
  }

  private detachFace(faceSlot: number): void {
    for (const edge of this.faceEdgeLists[faceSlot] ?? []) {
      const list = this.edgeFaceLists[edge]
      if (list) {
        const index = list.indexOf(faceSlot)
        if (index >= 0) list.splice(index, 1)
      }
    }
    for (const slot of this.mesh.faces[faceSlot] ?? []) {
      const list = this.vertexFaceLists[slot]
      if (list) {
        const index = list.indexOf(faceSlot)
        if (index >= 0) list.splice(index, 1)
      }
    }
    this.faceEdgeLists[faceSlot] = []
  }

  private attachFace(faceSlot: number): void {
    const loop = this.mesh.faces[faceSlot] ?? []
    const edges: number[] = []
    for (let index = 0; index < loop.length; index += 1) {
      const edge = this.ensureEdge(loop[index]!, loop[(index + 1) % loop.length]!)
      edges.push(edge)
      this.edgeFaceLists[edge]!.push(faceSlot)
    }
    this.faceEdgeLists[faceSlot] = edges
    for (const slot of loop) this.vertexFaceLists[slot]!.push(faceSlot)
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
