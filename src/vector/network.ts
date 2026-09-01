import { rotatePoint } from '@/vector/directTransform'
import type { VectorElement, VectorHandleMode, VectorNetwork, VectorNetworkNode, VectorNetworkSegment, VectorPoint } from '@/vector/types'

const KAPPA = 0.5522847498

export type Box = Pick<VectorElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>

/** A node in document coordinates (rotation applied when produced by `worldNetwork`). */
export type AbsNode = { id: string; point: VectorPoint; radius?: number; handles?: VectorHandleMode }
/** A segment whose handles are absolute points (or absent for a straight segment). */
export type AbsSegment = { id: string; a: string; b: string; ah?: VectorPoint; bh?: VectorPoint }
export type AbsNetwork = { nodes: AbsNode[]; segments: AbsSegment[] }

export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function emptyNetwork(): VectorNetwork {
  return { nodes: [], segments: [] }
}

/** The implicit network of a primitive that has not been edited yet. */
export function defaultNetwork(element: Pick<VectorElement, 'kind' | 'network'>): VectorNetwork {
  if (element.network) return element.network
  if (element.kind === 'ellipse') {
    const ids = ['n1', 'n2', 'n3', 'n4']
    const k = KAPPA / 2
    return {
      nodes: [
        { id: 'n1', x: 0.5, y: 0, handles: 'mirrored' }, { id: 'n2', x: 1, y: 0.5, handles: 'mirrored' },
        { id: 'n3', x: 0.5, y: 1, handles: 'mirrored' }, { id: 'n4', x: 0, y: 0.5, handles: 'mirrored' },
      ],
      segments: [
        { id: 's1', a: ids[0]!, b: ids[1]!, ah: { x: k, y: 0 }, bh: { x: 0, y: -k } },
        { id: 's2', a: ids[1]!, b: ids[2]!, ah: { x: 0, y: k }, bh: { x: k, y: 0 } },
        { id: 's3', a: ids[2]!, b: ids[3]!, ah: { x: -k, y: 0 }, bh: { x: 0, y: k } },
        { id: 's4', a: ids[3]!, b: ids[0]!, ah: { x: 0, y: -k }, bh: { x: -k, y: 0 } },
      ],
    }
  }
  return {
    nodes: [{ id: 'n1', x: 0, y: 0 }, { id: 'n2', x: 1, y: 0 }, { id: 'n3', x: 1, y: 1 }, { id: 'n4', x: 0, y: 1 }],
    segments: [{ id: 's1', a: 'n1', b: 'n2' }, { id: 's2', a: 'n2', b: 'n3' }, { id: 's3', a: 'n3', b: 'n4' }, { id: 's4', a: 'n4', b: 'n1' }],
  }
}

export function nodeById(network: VectorNetwork, id: string): VectorNetworkNode | undefined {
  return network.nodes.find((node) => node.id === id)
}

export function segmentById(network: VectorNetwork, id: string): VectorNetworkSegment | undefined {
  return network.segments.find((segment) => segment.id === id)
}

export function segmentsAt(network: Pick<VectorNetwork, 'segments'>, nodeId: string): VectorNetworkSegment[] {
  return network.segments.filter((segment) => segment.a === nodeId || segment.b === nodeId)
}

export function degree(network: Pick<VectorNetwork, 'segments'>, nodeId: string): number {
  return segmentsAt(network, nodeId).length
}

export function otherEnd(segment: VectorNetworkSegment, nodeId: string): string {
  return segment.a === nodeId ? segment.b : segment.a
}

/** Nodes and handles in the element's local (unrotated) coordinates. */
export function localNetwork(box: Pick<VectorElement, 'x' | 'y' | 'width' | 'height'>, network: VectorNetwork): AbsNetwork {
  const at = (node: VectorNetworkNode): VectorPoint => ({ x: box.x + node.x * box.width, y: box.y + node.y * box.height })
  const nodes = network.nodes.map((node): AbsNode => ({ id: node.id, point: at(node), ...(node.radius ? { radius: node.radius } : {}), ...(node.handles ? { handles: node.handles } : {}) }))
  const byId = new Map(nodes.map((node) => [node.id, node.point]))
  const segments = network.segments.map((segment): AbsSegment => {
    const a = byId.get(segment.a)!
    const b = byId.get(segment.b)!
    return {
      id: segment.id, a: segment.a, b: segment.b,
      ...(segment.ah ? { ah: { x: a.x + segment.ah.x * box.width, y: a.y + segment.ah.y * box.height } } : {}),
      ...(segment.bh ? { bh: { x: b.x + segment.bh.x * box.width, y: b.y + segment.bh.y * box.height } } : {}),
    }
  })
  return { nodes, segments }
}

/** Nodes and handles in document coordinates with the element rotation applied. */
export function worldNetwork(element: Box & { network?: VectorNetwork; kind: VectorElement['kind'] }, network = defaultNetwork(element)): AbsNetwork {
  const local = localNetwork(element, network)
  if (!element.rotation) return local
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const rotate = (point: VectorPoint) => rotatePoint(point, center, element.rotation)
  return {
    nodes: local.nodes.map((node) => ({ ...node, point: rotate(node.point) })),
    segments: local.segments.map((segment) => ({ ...segment, ...(segment.ah ? { ah: rotate(segment.ah) } : {}), ...(segment.bh ? { bh: rotate(segment.bh) } : {}) })),
  }
}

export type NetworkEdit = Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { network: VectorNetwork }

/**
 * Refits the element box around local-space geometry and re-normalises it. The world centre of the
 * new box is placed so a rotated element does not move.
 */
export function normalizeLocal(box: Box, absolute: AbsNetwork): NetworkEdit {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const points = [
    ...absolute.nodes.map((node) => node.point),
    ...absolute.segments.flatMap((segment) => [...(segment.ah ? [segment.ah] : []), ...(segment.bh ? [segment.bh] : [])]),
  ]
  if (points.length === 0) return { x: box.x, y: box.y, width: box.width, height: box.height, network: { nodes: [], segments: [] } }
  const left = Math.min(...points.map((point) => point.x))
  const right = Math.max(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const bottom = Math.max(...points.map((point) => point.y))
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const localCenter = { x: left + width / 2, y: top + height / 2 }
  const worldCenter = rotatePoint(localCenter, center, box.rotation)
  const byId = new Map(absolute.nodes.map((node) => [node.id, node.point]))
  const network: VectorNetwork = {
    nodes: absolute.nodes.map((node) => ({
      id: node.id,
      x: round4((node.point.x - left) / width),
      y: round4((node.point.y - top) / height),
      ...(node.radius ? { radius: round2(node.radius) } : {}),
      ...(node.handles ? { handles: node.handles } : {}),
    })),
    segments: absolute.segments.map((segment) => {
      const a = byId.get(segment.a)!
      const b = byId.get(segment.b)!
      return {
        id: segment.id, a: segment.a, b: segment.b,
        ...(segment.ah ? { ah: { x: round4((segment.ah.x - a.x) / width), y: round4((segment.ah.y - a.y) / height) } } : {}),
        ...(segment.bh ? { bh: { x: round4((segment.bh.x - b.x) / width), y: round4((segment.bh.y - b.y) / height) } } : {}),
      }
    }),
  }
  return { x: round2(worldCenter.x - width / 2), y: round2(worldCenter.y - height / 2), width: round2(width), height: round2(height), network }
}

/** Builds an unrotated element box from world-space geometry. */
export function normalizeWorld(absolute: AbsNetwork): NetworkEdit {
  return normalizeLocal({ x: 0, y: 0, width: 0, height: 0, rotation: 0 }, absolute)
}

/** Converts a world-space edit on an element into local coordinates and refits. */
export function commitWorld(element: Box, absolute: AbsNetwork): NetworkEdit {
  if (!element.rotation) return normalizeLocal(element, absolute)
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const unrotate = (point: VectorPoint) => rotatePoint(point, center, -element.rotation)
  return normalizeLocal(element, {
    nodes: absolute.nodes.map((node) => ({ ...node, point: unrotate(node.point) })),
    segments: absolute.segments.map((segment) => ({ ...segment, ...(segment.ah ? { ah: unrotate(segment.ah) } : {}), ...(segment.bh ? { bh: unrotate(segment.bh) } : {}) })),
  })
}

/** Cubic control polygon of a segment in the given absolute network. */
export function segmentCubic(absolute: AbsNetwork, segment: AbsSegment): [VectorPoint, VectorPoint, VectorPoint, VectorPoint] {
  const a = absolute.nodes.find((node) => node.id === segment.a)!.point
  const b = absolute.nodes.find((node) => node.id === segment.b)!.point
  if (!segment.ah && !segment.bh) return [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b]
  return [a, segment.ah ?? a, segment.bh ?? b, b]
}

export function isStraight(segment: Pick<AbsSegment, 'ah' | 'bh'>): boolean {
  return !segment.ah && !segment.bh
}

export function cubicAt(cubic: [VectorPoint, VectorPoint, VectorPoint, VectorPoint], t: number): VectorPoint {
  const [p0, p1, p2, p3] = cubic
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

export function splitCubic(cubic: [VectorPoint, VectorPoint, VectorPoint, VectorPoint], t: number) {
  const [p0, p1, p2, p3] = cubic
  const a = lerp(p0, p1, t)
  const b = lerp(p1, p2, t)
  const c = lerp(p2, p3, t)
  const d = lerp(a, b, t)
  const e = lerp(b, c, t)
  const m = lerp(d, e, t)
  return { left: [p0, a, d, m] as [VectorPoint, VectorPoint, VectorPoint, VectorPoint], right: [m, e, c, p3] as [VectorPoint, VectorPoint, VectorPoint, VectorPoint] }
}

/** Portion [t0, t1] of a cubic as a new cubic. */
export function subCubic(cubic: [VectorPoint, VectorPoint, VectorPoint, VectorPoint], t0: number, t1: number): [VectorPoint, VectorPoint, VectorPoint, VectorPoint] {
  if (t0 <= 0 && t1 >= 1) return cubic
  const right = t0 > 0 ? splitCubic(cubic, t0).right : cubic
  const scaled = t0 > 0 ? (t1 - t0) / (1 - t0) : t1
  return scaled < 1 ? splitCubic(right, scaled).left : right
}

export function nearestOnCubic(cubic: [VectorPoint, VectorPoint, VectorPoint, VectorPoint], point: VectorPoint): { t: number; point: VectorPoint; distance: number } {
  const distanceAt = (t: number) => {
    const at = cubicAt(cubic, t)
    return Math.hypot(at.x - point.x, at.y - point.y)
  }
  let bestT = 0
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index <= 32; index += 1) {
    const t = index / 32
    const d = distanceAt(t)
    if (d < best) { best = d; bestT = t }
  }
  let low = Math.max(0, bestT - 1 / 32)
  let high = Math.min(1, bestT + 1 / 32)
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const m1 = low + (high - low) / 3
    const m2 = high - (high - low) / 3
    if (distanceAt(m1) < distanceAt(m2)) high = m2
    else low = m1
  }
  const t = (low + high) / 2
  const at = cubicAt(cubic, t)
  return { t, point: at, distance: Math.hypot(at.x - point.x, at.y - point.y) }
}

/** Nearest segment of the element outline to a world point. */
export function nearestSegment(element: Box & { network?: VectorNetwork; kind: VectorElement['kind'] }, point: VectorPoint): { segment: AbsSegment; t: number; point: VectorPoint; distance: number } | null {
  const world = worldNetwork(element)
  let best: { segment: AbsSegment; t: number; point: VectorPoint; distance: number } | null = null
  for (const segment of world.segments) {
    const candidate = nearestOnCubic(segmentCubic(world, segment), point)
    if (!best || candidate.distance < best.distance) best = { segment, ...candidate }
  }
  return best
}

/* ---------- editing operations (world space in, refit out) ---------- */

/** Moves nodes by a delta; their handles follow. */
export function moveNodes(element: Box, world: AbsNetwork, ids: string[], delta: VectorPoint): NetworkEdit {
  const moving = new Set(ids)
  const shifted: AbsNetwork = {
    nodes: world.nodes.map((node) => moving.has(node.id) ? { ...node, point: add(node.point, delta) } : node),
    segments: world.segments.map((segment) => ({
      ...segment,
      ...(segment.ah && moving.has(segment.a) ? { ah: add(segment.ah, delta) } : {}),
      ...(segment.bh && moving.has(segment.b) ? { bh: add(segment.bh, delta) } : {}),
    })),
  }
  return commitWorld(element, shifted)
}

/** Applies a point transform to the selected nodes and their handles. */
export function transformNodes(element: Box, world: AbsNetwork, ids: string[], map: (point: VectorPoint) => VectorPoint): NetworkEdit {
  const moving = new Set(ids)
  return commitWorld(element, {
    nodes: world.nodes.map((node) => moving.has(node.id) ? { ...node, point: map(node.point) } : node),
    segments: world.segments.map((segment) => ({
      ...segment,
      ...(segment.ah && moving.has(segment.a) ? { ah: map(segment.ah) } : {}),
      ...(segment.bh && moving.has(segment.b) ? { bh: map(segment.bh) } : {}),
    })),
  })
}

/**
 * Moves one handle (the `end` of `segmentId`). At a two-segment node the partner handle follows the
 * node's handle mode unless `independent` is forced.
 */
export function moveHandle(element: Box, world: AbsNetwork, segmentId: string, end: 'a' | 'b', point: VectorPoint, independent = false): NetworkEdit {
  const segment = world.segments.find((item) => item.id === segmentId)
  if (!segment) return commitWorld(element, world)
  const nodeId = end === 'a' ? segment.a : segment.b
  const node = world.nodes.find((item) => item.id === nodeId)!
  const key = end === 'a' ? 'ah' : 'bh'
  const incident = world.segments.filter((item) => item.a === nodeId || item.b === nodeId)
  const mode: VectorHandleMode = independent ? 'independent' : node.handles ?? 'mirrored'
  const segments = world.segments.map((item) => {
    if (item.id === segmentId) return { ...item, [key]: point }
    if (mode === 'independent' || incident.length !== 2 || (item.a !== nodeId && item.b !== nodeId)) return item
    const partnerKey = item.a === nodeId ? 'ah' : 'bh'
    const current = item[partnerKey]
    if (!current) return item
    const direction = { x: node.point.x - point.x, y: node.point.y - point.y }
    const length = Math.hypot(direction.x, direction.y)
    if (length < 1e-6) return item
    const keep = mode === 'mirrored' ? length : Math.hypot(current.x - node.point.x, current.y - node.point.y)
    return { ...item, [partnerKey]: { x: node.point.x + direction.x / length * keep, y: node.point.y + direction.y / length * keep } }
  })
  return commitWorld(element, { ...world, segments })
}

/** Corner nodes gain tangent handles on every incident segment; nodes with handles lose them. */
export function toggleNodeSmooth(element: Box, world: AbsNetwork, nodeId: string): NetworkEdit {
  const node = world.nodes.find((item) => item.id === nodeId)
  if (!node) return commitWorld(element, world)
  const incident = world.segments.filter((item) => item.a === nodeId || item.b === nodeId)
  const smooth = incident.some((item) => (item.a === nodeId && item.ah) || (item.b === nodeId && item.bh))
  if (smooth) {
    return commitWorld(element, {
      nodes: world.nodes.map((item) => item.id === nodeId ? stripHandles(item) : item),
      segments: world.segments.map((item) => {
        if (item.a === nodeId) { const { ah: _ah, ...rest } = item; return rest }
        if (item.b === nodeId) { const { bh: _bh, ...rest } = item; return rest }
        return item
      }),
    })
  }
  const neighbours = incident.map((item) => ({ item, other: world.nodes.find((candidate) => candidate.id === otherEnd(item, nodeId))!.point }))
  let tangent: VectorPoint
  if (neighbours.length === 2) {
    tangent = unit({ x: neighbours[1]!.other.x - neighbours[0]!.other.x, y: neighbours[1]!.other.y - neighbours[0]!.other.y })
  } else {
    tangent = { x: 1, y: 0 }
  }
  const average = neighbours.reduce((sum, entry) => sum + Math.hypot(entry.other.x - node.point.x, entry.other.y - node.point.y), 0) / Math.max(1, neighbours.length) / 3
  const segments = world.segments.map((item) => {
    const entry = neighbours.find((candidate) => candidate.item.id === item.id)
    if (!entry) return item
    const reach = neighbours.length === 2 ? average : Math.hypot(entry.other.x - node.point.x, entry.other.y - node.point.y) / 3
    const towards = neighbours.length === 2
      ? (entry === neighbours[0] ? { x: -tangent.x, y: -tangent.y } : tangent)
      : unit({ x: entry.other.x - node.point.x, y: entry.other.y - node.point.y })
    const handle = { x: node.point.x + towards.x * reach, y: node.point.y + towards.y * reach }
    return item.a === nodeId ? { ...item, ah: handle } : { ...item, bh: handle }
  })
  return commitWorld(element, {
    nodes: world.nodes.map((item) => item.id === nodeId ? { ...item, handles: 'mirrored' } : item),
    segments,
  })
}

export function setHandleMode(element: Box, world: AbsNetwork, nodeId: string, mode: VectorHandleMode): NetworkEdit {
  const node = world.nodes.find((item) => item.id === nodeId)
  if (!node) return commitWorld(element, world)
  const incident = world.segments.filter((item) => item.a === nodeId || item.b === nodeId)
  let segments = world.segments
  if (incident.length === 2 && mode !== 'independent') {
    const [first, second] = incident as [AbsSegment, AbsSegment]
    const firstHandle = first.a === nodeId ? first.ah : first.bh
    const secondHandle = second.a === nodeId ? second.ah : second.bh
    if (firstHandle && secondHandle) {
      const direction = { x: firstHandle.x - node.point.x, y: firstHandle.y - node.point.y }
      const length = Math.hypot(direction.x, direction.y)
      if (length > 1e-6) {
        const keep = mode === 'mirrored' ? length : Math.hypot(secondHandle.x - node.point.x, secondHandle.y - node.point.y)
        const aligned = { x: node.point.x - direction.x / length * keep, y: node.point.y - direction.y / length * keep }
        segments = segments.map((item) => item.id === second.id ? (second.a === nodeId ? { ...item, ah: aligned } : { ...item, bh: aligned }) : item)
      }
    }
  }
  return commitWorld(element, { nodes: world.nodes.map((item) => item.id === nodeId ? { ...item, handles: mode } : item), segments })
}

/** Inserts a node on a segment at parameter t, preserving the curve. */
export function insertNodeOnSegment(element: Box, world: AbsNetwork, segmentId: string, t: number): NetworkEdit & { nodeId: string } {
  const segment = world.segments.find((item) => item.id === segmentId)
  if (!segment) return { ...commitWorld(element, world), nodeId: '' }
  const cubic = segmentCubic(world, segment)
  const nodeId = newId()
  const { left, right } = splitCubic(cubic, t)
  const straight = isStraight(segment)
  const node: AbsNode = { id: nodeId, point: left[3], ...(straight ? {} : { handles: 'mirrored' as const }) }
  const first: AbsSegment = { id: newId(), a: segment.a, b: nodeId, ...(straight ? {} : { ah: left[1], bh: left[2] }) }
  const second: AbsSegment = { id: newId(), a: nodeId, b: segment.b, ...(straight ? {} : { ah: right[1], bh: right[2] }) }
  const segments = world.segments.flatMap((item) => item.id === segmentId ? [first, second] : [item])
  return { ...commitWorld(element, { nodes: [...world.nodes, node], segments }), nodeId }
}

/** Bends a segment so its point at t reaches the target. */
export function bendSegment(element: Box, world: AbsNetwork, segmentId: string, t: number, target: VectorPoint): NetworkEdit {
  const segment = world.segments.find((item) => item.id === segmentId)
  if (!segment) return commitWorld(element, world)
  const cubic = segmentCubic(world, segment)
  const clamped = Math.min(0.9, Math.max(0.1, t))
  const at = cubicAt(cubic, clamped)
  const weight = 3 * clamped * (1 - clamped)
  const delta = { x: (target.x - at.x) / weight, y: (target.y - at.y) / weight }
  const nodes = world.nodes.map((node) => {
    if (node.id !== segment.a && node.id !== segment.b) return node
    const incident = world.segments.filter((item) => item.a === node.id || item.b === node.id)
    return incident.length === 2 ? { ...node, handles: 'independent' as const } : node
  })
  const segments = world.segments.map((item) => item.id === segmentId ? { ...item, ah: add(cubic[1], delta), bh: add(cubic[2], delta) } : item)
  return commitWorld(element, { nodes, segments })
}

/** Removes nodes with their incident segments, then any node left without a segment. Null when empty. */
export function deleteNodes(element: Box, world: AbsNetwork, ids: string[]): NetworkEdit | null {
  const removed = new Set(ids)
  const segments = world.segments.filter((segment) => !removed.has(segment.a) && !removed.has(segment.b))
  const used = new Set(segments.flatMap((segment) => [segment.a, segment.b]))
  const nodes = world.nodes.filter((node) => !removed.has(node.id) && used.has(node.id))
  if (nodes.length === 0) return null
  return commitWorld(element, { nodes, segments })
}

export function deleteSegments(element: Box, world: AbsNetwork, ids: string[]): NetworkEdit | null {
  const removed = new Set(ids)
  const segments = world.segments.filter((segment) => !removed.has(segment.id))
  const used = new Set(segments.flatMap((segment) => [segment.a, segment.b]))
  const nodes = world.nodes.filter((node) => used.has(node.id))
  if (nodes.length === 0) return null
  return commitWorld(element, { nodes, segments })
}

/** Adds a straight segment between two nodes unless one already joins them. */
export function connectNodes(element: Box, world: AbsNetwork, a: string, b: string): NetworkEdit | null {
  if (a === b) return null
  if (world.segments.some((segment) => (segment.a === a && segment.b === b) || (segment.a === b && segment.b === a))) return null
  return commitWorld(element, { ...world, segments: [...world.segments, { id: newId(), a, b }] })
}

/** Adds a node connected to `fromId` (or a lone node when `fromId` is null). */
export function extendNetwork(world: AbsNetwork, fromId: string | null, point: VectorPoint): { network: AbsNetwork; nodeId: string; segmentId: string | null } {
  const nodeId = newId()
  const nodes = [...world.nodes, { id: nodeId, point }]
  if (!fromId) return { network: { nodes, segments: world.segments }, nodeId, segmentId: null }
  const segmentId = newId()
  return { network: { nodes, segments: [...world.segments, { id: segmentId, a: fromId, b: nodeId }] }, nodeId, segmentId }
}

/** Connected components as node id groups. */
export function components(network: { nodes: Array<{ id: string }>; segments: Array<{ a: string; b: string }> }): string[][] {
  const parent = new Map(network.nodes.map((node) => [node.id, node.id]))
  const find = (id: string): string => {
    let current = id
    while (parent.get(current) !== current) current = parent.get(current)!
    return current
  }
  for (const segment of network.segments) {
    const a = find(segment.a)
    const b = find(segment.b)
    if (a !== b) parent.set(a, b)
  }
  const groups = new Map<string, string[]>()
  for (const node of network.nodes) {
    const root = find(node.id)
    groups.set(root, [...(groups.get(root) ?? []), node.id])
  }
  return [...groups.values()]
}

/** Maximal runs through degree-2 nodes, used for strokes, caps and export. */
export type Chain = { segments: Array<{ segment: AbsSegment; reversed: boolean }>; closed: boolean; nodeIds: string[] }

export function chains(world: AbsNetwork): Chain[] {
  const remaining = new Set(world.segments.map((segment) => segment.id))
  const byId = new Map(world.segments.map((segment) => [segment.id, segment]))
  const deg = (id: string) => world.segments.filter((segment) => segment.a === id || segment.b === id).length
  const result: Chain[] = []
  const walk = (start: AbsSegment, fromNode: string) => {
    const run: Chain['segments'] = []
    const nodeIds = [fromNode]
    let current = start
    let at = fromNode
    while (true) {
      remaining.delete(current.id)
      const reversed = current.b === at
      run.push({ segment: current, reversed })
      at = reversed ? current.a : current.b
      nodeIds.push(at)
      if (at === fromNode) return { segments: run, closed: true, nodeIds: nodeIds.slice(0, -1) }
      if (deg(at) !== 2) return { segments: run, closed: false, nodeIds }
      const next = world.segments.find((segment) => remaining.has(segment.id) && (segment.a === at || segment.b === at))
      if (!next) return { segments: run, closed: false, nodeIds }
      current = next
    }
  }
  // Open chains first, starting at nodes whose degree is not two.
  for (const segment of world.segments) {
    if (!remaining.has(segment.id)) continue
    const startA = deg(segment.a) !== 2
    const startB = deg(segment.b) !== 2
    if (!startA && !startB) continue
    result.push(walk(segment, startA ? segment.a : segment.b))
  }
  // Remaining segments form closed rings of degree-2 nodes.
  for (const id of [...remaining]) {
    if (!remaining.has(id)) continue
    result.push(walk(byId.get(id)!, byId.get(id)!.a))
  }
  return result
}

/** A run of anchors with handles (used by corner rounding and path data emission). */
export type RunPoint = { anchor: VectorPoint; in?: VectorPoint; out?: VectorPoint; radius?: number; nodeId?: string; handles?: VectorHandleMode }
export type Run = { points: RunPoint[]; closed: boolean }

export function chainToRun(world: AbsNetwork, chain: Chain): Run {
  const nodeMap = new Map(world.nodes.map((node) => [node.id, node]))
  const points: Run['points'] = []
  chain.segments.forEach((entry, index) => {
    const startId = entry.reversed ? entry.segment.b : entry.segment.a
    const endId = entry.reversed ? entry.segment.a : entry.segment.b
    const out = entry.reversed ? entry.segment.bh : entry.segment.ah
    const into = entry.reversed ? entry.segment.ah : entry.segment.bh
    const startNode = nodeMap.get(startId)!
    if (index === 0) points.push({ anchor: startNode.point, nodeId: startId, ...(radiusOf(world, startNode) ? { radius: radiusOf(world, startNode) } : {}) })
    const last = points[points.length - 1]!
    if (out) last.out = out
    if (chain.closed && index === chain.segments.length - 1) {
      if (into) points[0]!.in = into
      return
    }
    const endNode = nodeMap.get(endId)!
    points.push({ anchor: endNode.point, nodeId: endId, ...(into ? { in: into } : {}), ...(radiusOf(world, endNode) ? { radius: radiusOf(world, endNode) } : {}) })
  })
  return { points, closed: chain.closed }
}

function radiusOf(world: AbsNetwork, node: AbsNode): number | undefined {
  if (!node.radius) return undefined
  const incident = world.segments.filter((segment) => segment.a === node.id || segment.b === node.id)
  return incident.length === 2 ? node.radius : undefined
}

/** Builds a world network from runs (pen, pencil, import, boolean results). Closed runs loop back. */
export function networkFromRuns(runs: Run[]): AbsNetwork {
  const nodes: AbsNode[] = []
  const segments: AbsSegment[] = []
  for (const run of runs) {
    if (run.points.length < 2) continue
    const ids = run.points.map((point) => {
      const id = newId()
      nodes.push({ id, point: point.anchor, ...(point.radius ? { radius: point.radius } : {}), ...(point.handles ? { handles: point.handles } : point.in && point.out ? { handles: 'mirrored' as const } : {}) })
      return id
    })
    const count = run.closed ? run.points.length : run.points.length - 1
    for (let index = 0; index < count; index += 1) {
      const from = run.points[index]!
      const to = run.points[(index + 1) % run.points.length]!
      segments.push({ id: newId(), a: ids[index]!, b: ids[(index + 1) % ids.length]!, ...(from.out ? { ah: from.out } : {}), ...(to.in ? { bh: to.in } : {}) })
    }
  }
  return { nodes, segments }
}

/** Merges several world networks into one (ids are kept unique by regeneration). */
export function mergeNetworks(networks: AbsNetwork[]): AbsNetwork {
  const nodes: AbsNode[] = []
  const segments: AbsSegment[] = []
  for (const network of networks) {
    const map = new Map(network.nodes.map((node) => [node.id, newId()]))
    nodes.push(...network.nodes.map((node) => ({ ...node, id: map.get(node.id)! })))
    segments.push(...network.segments.map((segment) => ({ ...segment, id: newId(), a: map.get(segment.a)!, b: map.get(segment.b)! })))
  }
  return { nodes, segments }
}

export function runPathData(run: Run): string {
  const points = run.points
  if (!points.length) return ''
  const commands = [`M ${round2(points[0]!.anchor.x)} ${round2(points[0]!.anchor.y)}`]
  const count = run.closed ? points.length : points.length - 1
  for (let index = 0; index < count; index += 1) {
    const from = points[index]!
    const to = points[(index + 1) % points.length]!
    if (from.out || to.in) {
      const a = from.out ?? from.anchor
      const b = to.in ?? to.anchor
      commands.push(`C ${round2(a.x)} ${round2(a.y)} ${round2(b.x)} ${round2(b.y)} ${round2(to.anchor.x)} ${round2(to.anchor.y)}`)
    } else {
      commands.push(`L ${round2(to.anchor.x)} ${round2(to.anchor.y)}`)
    }
  }
  if (run.closed) commands.push('Z')
  return commands.join(' ')
}

export function nodeWorldPoint(element: Box & { network?: VectorNetwork; kind: VectorElement['kind'] }, nodeId: string): VectorPoint | null {
  const node = worldNetwork(element).nodes.find((item) => item.id === nodeId)
  return node ? node.point : null
}

/** Sanitises a stored network: finite coordinates, valid references, unique ids. */
export function sanitizeNetwork(value: unknown): VectorNetwork | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VectorNetwork>
  if (!Array.isArray(source.nodes) || !Array.isArray(source.segments)) return null
  const finite = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate) && Math.abs(candidate) <= 100
  const point = (candidate: unknown): VectorPoint | null => {
    if (!candidate || typeof candidate !== 'object') return null
    const item = candidate as { x?: unknown; y?: unknown }
    return finite(item.x) && finite(item.y) ? { x: item.x, y: item.y } : null
  }
  const ids = new Set<string>()
  const nodes: VectorNetworkNode[] = []
  for (const candidate of source.nodes.slice(0, 2048)) {
    if (!candidate || typeof candidate !== 'object') continue
    const item = candidate as Partial<VectorNetworkNode>
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || !finite(item.x) || !finite(item.y)) continue
    ids.add(item.id)
    nodes.push({
      id: item.id, x: item.x, y: item.y,
      ...(typeof item.radius === 'number' && Number.isFinite(item.radius) && item.radius > 0 ? { radius: Math.min(10000, item.radius) } : {}),
      ...(item.handles === 'mirrored' || item.handles === 'asymmetric' || item.handles === 'independent' ? { handles: item.handles } : {}),
    })
  }
  const segmentIds = new Set<string>()
  const segments: VectorNetworkSegment[] = []
  for (const candidate of source.segments.slice(0, 4096)) {
    if (!candidate || typeof candidate !== 'object') continue
    const item = candidate as Partial<VectorNetworkSegment>
    if (typeof item.id !== 'string' || !item.id || segmentIds.has(item.id)) continue
    if (typeof item.a !== 'string' || typeof item.b !== 'string' || !ids.has(item.a) || !ids.has(item.b) || item.a === item.b) continue
    const ah = item.ah === undefined ? undefined : point(item.ah)
    const bh = item.bh === undefined ? undefined : point(item.bh)
    if (item.ah !== undefined && !ah || item.bh !== undefined && !bh) continue
    segmentIds.add(item.id)
    segments.push({ id: item.id, a: item.a, b: item.b, ...(ah ? { ah } : {}), ...(bh ? { bh } : {}) })
  }
  if (nodes.length === 0 || segments.length === 0) return null
  const used = new Set(segments.flatMap((segment) => [segment.a, segment.b]))
  return { nodes: nodes.filter((node) => used.has(node.id)), segments }
}

function stripHandles(node: AbsNode): AbsNode {
  const { handles: _handles, ...rest } = node
  return rest
}

function lerp(a: VectorPoint, b: VectorPoint, t: number): VectorPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function add(a: VectorPoint, b: VectorPoint): VectorPoint {
  return { x: a.x + b.x, y: a.y + b.y }
}

function unit(vector: VectorPoint): VectorPoint {
  const length = Math.hypot(vector.x, vector.y) || 1
  return { x: vector.x / length, y: vector.y / length }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
