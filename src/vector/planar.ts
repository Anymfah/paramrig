import { createLruCache } from '@/vector/cache'
import { cubicAt, isStraight, segmentCubic, subCubic, type AbsNetwork, type AbsSegment, type Run } from '@/vector/network'
import type { VectorPoint } from '@/vector/types'

type Cubic = [VectorPoint, VectorPoint, VectorPoint, VectorPoint]

/** A traversed piece of an original segment between two arrangement vertices. */
export type FacePiece = { segmentId: string; index: number; t0: number; t1: number; reversed: boolean }
export type FaceLoop = { pieces: FacePiece[]; vertices: string[] }
export type Face = { key: string; outer: FaceLoop; holes: FaceLoop[]; area: number }

const CURVE_SAMPLES = 24
const MIN_CURVE_SAMPLES = 8
const MAX_CURVE_SAMPLES = 32
const FACE_CACHE_SIZE = 240
const MERGE_TOLERANCE = 0.05
const EPSILON = 1e-6

type Vertex = { id: string; point: VectorPoint; nodeId: string | null }
type Piece = { id: string; segmentId: string; index: number; t0: number; t1: number; from: string; to: string; polyline: VectorPoint[] }
type HalfEdge = { id: number; piece: Piece; reversed: boolean; from: string; to: string; angle: number; twin: number; next: number }

const faceCache = createLruCache<Face[]>(FACE_CACHE_SIZE)

/** Fingerprint of a world network: identical geometry gives an identical key. */
export function networkFingerprint(world: AbsNetwork): string {
  const nodes = world.nodes.map((node) => `${node.id},${fixed(node.point.x)},${fixed(node.point.y)},${node.radius ?? ''},${node.handles ?? ''}`).join(';')
  const segments = world.segments.map((segment) => `${segment.id},${segment.a},${segment.b},${handleKey(segment.ah)},${handleKey(segment.bh)}`).join(';')
  return `${nodes}|${segments}`
}

function handleKey(point: VectorPoint | undefined): string {
  return point ? `${fixed(point.x)}:${fixed(point.y)}` : ''
}

function fixed(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

/**
 * Computes the bounded faces of the planar arrangement formed by the network's segments,
 * splitting segments where they cross. Curves are sampled for topology only; callers render each
 * piece from the exact cubic via `pieceCubic`.
 *
 * Results are cached by network fingerprint and shared between callers, so treat them as frozen.
 */
export function computeFaces(world: AbsNetwork): Face[] {
  const key = networkFingerprint(world)
  const cached = faceCache.get(key)
  if (cached) return cached
  const faces = arrangeFaces(world)
  faceCache.set(key, faces)
  return faces
}

export const faceCacheStats = { get size() { return faceCache.size } }

function arrangeFaces(world: AbsNetwork): Face[] {
  if (world.segments.length < 2) return []
  const cubics = new Map(world.segments.map((segment) => [segment.id, segmentCubic(world, segment)]))
  const samples = new Map<string, Array<{ t: number; point: VectorPoint }>>()
  for (const segment of world.segments) {
    const cubic = cubics.get(segment.id)!
    const count = isStraight(segment) ? 1 : curveSamples(cubic)
    const list: Array<{ t: number; point: VectorPoint }> = []
    for (let index = 0; index <= count; index += 1) {
      const t = index / count
      list.push({ t, point: index === 0 ? cubic[0] : index === count ? cubic[3] : cubicAt(cubic, t) })
    }
    samples.set(segment.id, list)
  }

  // Vertices: original nodes plus crossing points.
  const vertices = new Map<string, Vertex>()
  const nodeVertex = new Map<string, string>()
  // Vertices bucketed on a 0.05 grid so merging a crossing into an existing point is a
  // nine-cell lookup instead of a scan of every vertex found so far.
  const grid = new Map<string, Vertex[]>()
  const cellKey = (point: VectorPoint) => `${Math.floor(point.x / MERGE_TOLERANCE)}:${Math.floor(point.y / MERGE_TOLERANCE)}`
  const addVertex = (vertex: Vertex) => {
    vertices.set(vertex.id, vertex)
    const key = cellKey(vertex.point)
    const cell = grid.get(key)
    if (cell) cell.push(vertex)
    else grid.set(key, [vertex])
  }
  const vertexAt = (point: VectorPoint): Vertex | null => {
    const cx = Math.floor(point.x / MERGE_TOLERANCE)
    const cy = Math.floor(point.y / MERGE_TOLERANCE)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const vertex of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (Math.abs(vertex.point.x - point.x) < MERGE_TOLERANCE && Math.abs(vertex.point.y - point.y) < MERGE_TOLERANCE) return vertex
        }
      }
    }
    return null
  }
  // Nodes that sit on the same point become one vertex: a curve that runs back through one of its
  // own nodes has to split the traversal there, or its sub-loops cancel out and no face is found.
  for (const node of world.nodes) {
    const shared = vertexAt(node.point)
    if (shared) {
      nodeVertex.set(node.id, shared.id)
      continue
    }
    const id = `n:${node.id}`
    addVertex({ id, point: node.point, nodeId: node.id })
    nodeVertex.set(node.id, id)
  }
  const splits = new Map<string, Array<{ t: number; vertex: string }>>()
  for (const segment of world.segments) splits.set(segment.id, [])
  const crossingVertex = (point: VectorPoint): string => {
    const shared = vertexAt(point)
    if (shared) return shared.id
    const id = `x:${vertices.size}`
    addVertex({ id, point, nodeId: null })
    return id
  }
  const bounds = new Map(world.segments.map((segment) => [segment.id, boundsOf(samples.get(segment.id)!.map((item) => item.point))]))
  for (const [i, j] of candidatePairs(world.segments, bounds)) {
    const first = world.segments[i]!
    const firstSamples = samples.get(first.id)!
    const second = world.segments[j]!
    const secondSamples = samples.get(second.id)!
    const self = i === j
    for (let p = 0; p + 1 < firstSamples.length; p += 1) {
      for (let q = self ? p + 2 : 0; q + 1 < secondSamples.length; q += 1) {
        if (self && p === 0 && q + 1 === secondSamples.length && firstSamples[0]!.point === secondSamples[q + 1]!.point) continue
        const hit = intersectSegments(firstSamples[p]!.point, firstSamples[p + 1]!.point, secondSamples[q]!.point, secondSamples[q + 1]!.point)
        if (!hit) continue
        const tFirst = firstSamples[p]!.t + (firstSamples[p + 1]!.t - firstSamples[p]!.t) * hit.u
        const tSecond = secondSamples[q]!.t + (secondSamples[q + 1]!.t - secondSamples[q]!.t) * hit.v
        const sharesEndpoint = !self && (nodeVertex.get(first.a) === nodeVertex.get(second.a) || nodeVertex.get(first.a) === nodeVertex.get(second.b)
          || nodeVertex.get(first.b) === nodeVertex.get(second.a) || nodeVertex.get(first.b) === nodeVertex.get(second.b))
        const atFirstEnd = tFirst < 1e-4 || tFirst > 1 - 1e-4
        const atSecondEnd = tSecond < 1e-4 || tSecond > 1 - 1e-4
        if (atFirstEnd && atSecondEnd) continue
        if (sharesEndpoint && (atFirstEnd || atSecondEnd)) continue
        const vertex = atFirstEnd ? nodeVertex.get(tFirst < 0.5 ? first.a : first.b)! : atSecondEnd ? nodeVertex.get(tSecond < 0.5 ? second.a : second.b)! : crossingVertex(hit.point)
        if (!atFirstEnd) splits.get(first.id)!.push({ t: tFirst, vertex })
        if (!atSecondEnd) splits.get(second.id)!.push({ t: tSecond, vertex })
      }
    }
  }

  // Pieces between consecutive split parameters.
  const pieces: Piece[] = []
  for (const segment of world.segments) {
    const list = [...splits.get(segment.id)!].sort((a, b) => a.t - b.t)
    const stops: Array<{ t: number; vertex: string }> = [{ t: 0, vertex: nodeVertex.get(segment.a)! }]
    for (const item of list) {
      const last = stops[stops.length - 1]!
      if (item.t - last.t < 1e-4 || item.vertex === last.vertex) continue
      stops.push(item)
    }
    const endVertex = nodeVertex.get(segment.b)!
    const box = bounds.get(segment.id)!
    // A segment whose ends merged into one vertex still closes a loop, unless it has no extent.
    const extent = Math.max(box.right - box.left, box.bottom - box.top)
    const closesOnItself = stops.length === 1 && stops[0]!.vertex === endVertex
    if (stops[stops.length - 1]!.vertex !== endVertex || (closesOnItself && extent > MERGE_TOLERANCE)) {
      stops.push({ t: 1, vertex: endVertex })
    }
    const sampleList = samples.get(segment.id)!
    for (let index = 0; index + 1 < stops.length; index += 1) {
      const from = stops[index]!
      const to = stops[index + 1]!
      const inner = sampleList.filter((item) => item.t > from.t + 1e-6 && item.t < to.t - 1e-6).map((item) => item.point)
      pieces.push({ id: `${segment.id}#${index}`, segmentId: segment.id, index, t0: from.t, t1: to.t, from: from.vertex, to: to.vertex, polyline: [vertices.get(from.vertex)!.point, ...inner, vertices.get(to.vertex)!.point] })
    }
  }

  // Half-edges sorted around each vertex.
  const halfEdges: HalfEdge[] = []
  for (const piece of pieces) {
    const forward: HalfEdge = { id: halfEdges.length, piece, reversed: false, from: piece.from, to: piece.to, angle: angleOf(piece.polyline[0]!, piece.polyline[1]!), twin: halfEdges.length + 1, next: -1 }
    const backward: HalfEdge = { id: halfEdges.length + 1, piece, reversed: true, from: piece.to, to: piece.from, angle: angleOf(piece.polyline[piece.polyline.length - 1]!, piece.polyline[piece.polyline.length - 2]!), twin: halfEdges.length, next: -1 }
    halfEdges.push(forward, backward)
  }
  const outgoing = new Map<string, HalfEdge[]>()
  for (const edge of halfEdges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge])
  for (const list of outgoing.values()) list.sort((a, b) => a.angle - b.angle)
  for (const edge of halfEdges) {
    const around = outgoing.get(edge.to)!
    const twinIndex = around.findIndex((candidate) => candidate.id === edge.twin)
    // Turn to the next edge clockwise (decreasing angle) from the way we came in.
    const next = around[(twinIndex - 1 + around.length) % around.length]!
    edge.next = next.id
  }

  // Cycles.
  const visited = new Set<number>()
  type Cycle = { edges: HalfEdge[]; area: number; vertices: string[] }
  const cycles: Cycle[] = []
  for (const start of halfEdges) {
    if (visited.has(start.id)) continue
    const edges: HalfEdge[] = []
    let current = start
    while (!visited.has(current.id)) {
      visited.add(current.id)
      edges.push(current)
      current = halfEdges[current.next]!
    }
    const polygon = edges.flatMap((edge) => {
      const line = edge.reversed ? [...edge.piece.polyline].reverse() : edge.piece.polyline
      return line.slice(0, -1)
    })
    cycles.push({ edges, area: signedArea(polygon), vertices: edges.map((edge) => edge.from) })
  }

  // Connected components (by vertex) to tell outer boundaries from bounded faces.
  const componentOf = new Map<string, number>()
  let componentCount = 0
  for (const vertex of vertices.keys()) {
    if (componentOf.has(vertex)) continue
    const stack = [vertex]
    componentOf.set(vertex, componentCount)
    while (stack.length) {
      const current = stack.pop()!
      for (const edge of outgoing.get(current) ?? []) {
        if (!componentOf.has(edge.to)) {
          componentOf.set(edge.to, componentCount)
          stack.push(edge.to)
        }
      }
    }
    componentCount += 1
  }
  const bounded: Array<Cycle & { component: number }> = []
  const outers: Array<Cycle & { component: number }> = []
  for (const cycle of cycles) {
    const component = componentOf.get(cycle.vertices[0]!)!
    if (cycle.area > EPSILON) bounded.push({ ...cycle, component })
    else outers.push({ ...cycle, component })
  }

  const toLoop = (cycle: Cycle): FaceLoop => ({
    pieces: cycle.edges.map((edge) => ({ segmentId: edge.piece.segmentId, index: edge.piece.index, t0: edge.piece.t0, t1: edge.piece.t1, reversed: edge.reversed })),
    vertices: cycle.vertices,
  })
  const faces: Face[] = bounded.map((cycle) => ({
    key: [...new Set(cycle.edges.map((edge) => edge.piece.id))].sort().join('|'),
    outer: toLoop(cycle),
    holes: [],
    area: cycle.area,
  }))
  // A component sitting inside another component's face punches a hole in it.
  for (const outer of outers) {
    const probe = vertices.get(outer.vertices[0]!)!.point
    let host: (Face & { component: number }) | null = null
    faces.forEach((face, index) => {
      const cycle = bounded[index]!
      if (cycle.component === outer.component) return
      const polygon = cycle.edges.flatMap((edge) => (edge.reversed ? [...edge.piece.polyline].reverse() : edge.piece.polyline).slice(0, -1))
      if (pointInPolygon(probe, polygon) && (!host || face.area < host.area)) host = { ...face, component: cycle.component }
    })
    if (host) {
      const target = faces.find((face) => face.key === host!.key)!
      target.holes.push(toLoop(outer))
    }
  }
  return faces
}

/** Stable key of a loop, matching the `key` of the face that loop bounds. */
export function loopKey(loop: FaceLoop): string {
  return [...new Set(loop.pieces.map((piece) => `${piece.segmentId}#${piece.index}`))].sort().join('|')
}

/**
 * Keys of the faces that only exist because they sit inside another face — the counters of a
 * glyph, the hole of a ring. Callers that want a solid shape switch these off.
 */
export function holeFaceKeys(faces: Face[]): string[] {
  const holes = new Set(faces.flatMap((face) => face.holes.map(loopKey)))
  return faces.filter((face) => holes.has(face.key)).map((face) => face.key)
}

/** Exact cubic of one traversed piece. */
export function pieceCubic(world: AbsNetwork, piece: FacePiece): { cubic: Cubic; straight: boolean } {
  const segment = world.segments.find((item) => item.id === piece.segmentId)!
  const cubic = subCubic(segmentCubic(world, segment), piece.t0, piece.t1)
  const ordered: Cubic = piece.reversed ? [cubic[3], cubic[2], cubic[1], cubic[0]] : cubic
  return { cubic: ordered, straight: isStraight(segment) }
}

/** Converts a face loop into an anchor run for path data emission. */
export function loopToRun(world: AbsNetwork, loop: FaceLoop): Run {
  const nodeMap = new Map(world.nodes.map((node) => [node.id, node]))
  const points: Run['points'] = []
  loop.pieces.forEach((piece, index) => {
    const { cubic, straight } = pieceCubic(world, piece)
    const vertexId = loop.vertices[index]!
    const nodeId = vertexId.startsWith('n:') ? vertexId.slice(2) : undefined
    const node = nodeId ? nodeMap.get(nodeId) : undefined
    const incident = node ? world.segments.filter((segment) => segment.a === node.id || segment.b === node.id).length : 0
    if (index === 0) points.push({ anchor: cubic[0], ...(nodeId ? { nodeId } : {}), ...(node?.radius && incident === 2 ? { radius: node.radius } : {}) })
    const last = points[points.length - 1]!
    if (!straight) last.out = cubic[1]
    if (index === loop.pieces.length - 1) {
      if (!straight) points[0]!.in = cubic[2]
      return
    }
    const nextVertex = loop.vertices[index + 1]!
    const nextNodeId = nextVertex.startsWith('n:') ? nextVertex.slice(2) : undefined
    const nextNode = nextNodeId ? nodeMap.get(nextNodeId) : undefined
    const nextIncident = nextNode ? world.segments.filter((segment) => segment.a === nextNode.id || segment.b === nextNode.id).length : 0
    points.push({ anchor: cubic[3], ...(straight ? {} : { in: cubic[2] }), ...(nextNodeId ? { nodeId: nextNodeId } : {}), ...(nextNode?.radius && nextIncident === 2 ? { radius: nextNode.radius } : {}) })
  })
  return { points, closed: true }
}

/** Pieces of one original segment that lie on the boundary of a filled face, for hit testing. */
export function faceContainsPoint(world: AbsNetwork, face: Face, point: VectorPoint): boolean {
  const polygon = loopPolygon(world, face.outer)
  if (!pointInPolygon(point, polygon)) return false
  return !face.holes.some((hole) => pointInPolygon(point, loopPolygon(world, hole)))
}

function loopPolygon(world: AbsNetwork, loop: FaceLoop): VectorPoint[] {
  return loop.pieces.flatMap((piece) => {
    const { cubic, straight } = pieceCubic(world, piece)
    if (straight) return [cubic[0]]
    return Array.from({ length: CURVE_SAMPLES }, (_, index) => cubicAt(cubic, index / CURVE_SAMPLES))
  })
}

/**
 * Segment pairs worth intersecting, as index pairs with `i <= j` (a pair `[i, i]` asks for the
 * self-intersection pass). A sweep along x over the segment boxes replaces the all-pairs loop:
 * only boxes that still overlap the sweep line are compared.
 */
function candidatePairs(segments: AbsSegment[], bounds: Map<string, Bounds>): Array<[number, number]> {
  const order = segments
    .map((segment, index) => ({ index, box: bounds.get(segment.id)! }))
    .sort((a, b) => a.box.left - b.box.left)
  const pairs: Array<[number, number]> = []
  let active: Array<{ index: number; box: Bounds }> = []
  for (const entry of order) {
    active = active.filter((candidate) => candidate.box.right >= entry.box.left - 0.1)
    pairs.push([entry.index, entry.index])
    for (const candidate of active) {
      if (candidate.box.top > entry.box.bottom + 0.1 || entry.box.top > candidate.box.bottom + 0.1) continue
      pairs.push(candidate.index < entry.index ? [candidate.index, entry.index] : [entry.index, candidate.index])
    }
    active.push(entry)
  }
  return pairs
}

/**
 * Sampling steps for one cubic, from how far its control polygon strays from the chord:
 * a nearly flat curve needs eight, a tight one thirty-two.
 */
function curveSamples(cubic: Cubic): number {
  const chord = Math.hypot(cubic[3].x - cubic[0].x, cubic[3].y - cubic[0].y)
  const deviation = Math.max(distanceToChord(cubic[1], cubic[0], cubic[3]), distanceToChord(cubic[2], cubic[0], cubic[3]))
  const ratio = deviation / Math.max(1, chord)
  if (ratio < 0.05) return MIN_CURVE_SAMPLES
  if (ratio < 0.12) return 12
  if (ratio < 0.25) return 16
  if (ratio < 0.5) return CURVE_SAMPLES
  return MAX_CURVE_SAMPLES
}

function distanceToChord(point: VectorPoint, from: VectorPoint, to: VectorPoint): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return Math.hypot(point.x - from.x, point.y - from.y)
  return Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / length
}

function angleOf(from: VectorPoint, to: VectorPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

function signedArea(polygon: VectorPoint[]): number {
  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % polygon.length]!
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

function intersectSegments(p1: VectorPoint, p2: VectorPoint, p3: VectorPoint, p4: VectorPoint): { point: VectorPoint; u: number; v: number } | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-12) return null
  const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  if (u < -1e-9 || u > 1 + 1e-9 || v < -1e-9 || v > 1 + 1e-9) return null
  return { point: { x: p1.x + (p2.x - p1.x) * u, y: p1.y + (p2.y - p1.y) * u }, u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) }
}

type Bounds = { left: number; right: number; top: number; bottom: number }

function boundsOf(points: VectorPoint[]): Bounds {
  return {
    left: Math.min(...points.map((point) => point.x)), right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)), bottom: Math.max(...points.map((point) => point.y)),
  }
}

export function pointInPolygon(point: VectorPoint, polygon: VectorPoint[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!
    const b = polygon[previous]!
    const crosses = (a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

export type { AbsSegment }
