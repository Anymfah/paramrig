import { createVectorElement } from '@/vector/document'
import { chains, chainToRun, commitWorld, extendNetwork, insertNodeOnSegment, newId, normalizeWorld, runPathData, worldNetwork, type AbsNetwork, type Box } from '@/vector/network'
import type { VectorElement, VectorPoint } from '@/vector/types'

/**
 * A pen session works on a world-space copy of one element's network. Anchors are appended from
 * `current`; clicking another node connects to it; clicking the stroke's first node closes it.
 */
export type PenDraft = {
  /** Element being extended, or null when the pen started on empty canvas. */
  element: VectorElement | null
  world: AbsNetwork
  /** Node the next segment will start from, or null after closing. */
  current: string | null
  /** First node placed in this stroke; connecting back to it closes the stroke. */
  start: string | null
  /** Handle pulled out of `current` for the next segment. */
  pendingOut?: VectorPoint
  /** Last segment created, whose end handle the pointer drag adjusts. */
  lastSegment: string | null
  /** Number of nodes and segments before the session, to detect a no-op. */
  baseline: { nodes: number; segments: number }
}

export function penStart(point: VectorPoint): PenDraft {
  const { network, nodeId } = extendNetwork({ nodes: [], segments: [] }, null, point)
  return { element: null, world: network, current: nodeId, start: nodeId, lastSegment: null, baseline: { nodes: 0, segments: 0 } }
}

/** Starts extending an existing element from one of its nodes. */
export function penFromNode(element: VectorElement, nodeId: string): PenDraft {
  const world = worldNetwork(element)
  return { element, world, current: nodeId, start: nodeId, lastSegment: null, baseline: { nodes: world.nodes.length, segments: world.segments.length } }
}

/** Starts a disconnected stroke inside an existing element's network. */
export function penFromPoint(element: VectorElement, point: VectorPoint): PenDraft {
  const world = worldNetwork(element)
  const { network, nodeId } = extendNetwork(world, null, point)
  return { element, world: network, current: nodeId, start: nodeId, lastSegment: null, baseline: { nodes: world.nodes.length, segments: world.segments.length } }
}

/** Starts extending an element from a new node dropped on one of its segments. */
export function penFromSegment(element: VectorElement, segmentId: string, t: number): PenDraft {
  const world = worldNetwork(element)
  const inserted = insertNodeOnSegment(element, world, segmentId, t)
  const next = worldNetwork({ ...element, ...inserted, kind: 'path' })
  return { element, world: next, current: inserted.nodeId, start: inserted.nodeId, lastSegment: null, baseline: { nodes: world.nodes.length, segments: world.segments.length } }
}

export function penAddAnchor(draft: PenDraft, point: VectorPoint): PenDraft {
  const { network, nodeId, segmentId } = extendNetwork(draft.world, draft.current, point)
  const world = draft.pendingOut && segmentId
    ? { ...network, segments: network.segments.map((segment) => segment.id === segmentId ? { ...segment, ah: draft.pendingOut } : segment) }
    : network
  return { ...draft, world, current: nodeId, start: draft.current ? draft.start : nodeId, lastSegment: segmentId, pendingOut: undefined }
}

/** Connects the current node to an existing node. Reaching the stroke's first node closes it. */
export function penConnect(draft: PenDraft, nodeId: string): PenDraft {
  if (!draft.current) return { ...draft, current: nodeId, start: nodeId, pendingOut: undefined, lastSegment: null }
  if (nodeId === draft.current) return draft
  const exists = draft.world.segments.some((segment) => (segment.a === draft.current && segment.b === nodeId) || (segment.b === draft.current && segment.a === nodeId))
  if (exists) return { ...draft, current: nodeId === draft.start ? null : nodeId, pendingOut: undefined, lastSegment: null }
  const segmentId = newId()
  const segment = { id: segmentId, a: draft.current, b: nodeId, ...(draft.pendingOut ? { ah: draft.pendingOut } : {}) }
  const closes = nodeId === draft.start
  return { ...draft, world: { ...draft.world, segments: [...draft.world.segments, segment] }, current: closes ? null : nodeId, lastSegment: segmentId, pendingOut: undefined }
}

/** Splits a segment of the draft and connects to the new node. */
export function penConnectSegment(draft: PenDraft, segmentId: string, t: number): PenDraft {
  const inserted = insertNodeOnSegment({ x: 0, y: 0, width: 0, height: 0, rotation: 0 }, draft.world, segmentId, t)
  const world = worldNetwork({ ...inserted, rotation: 0, kind: 'path' })
  return penConnect({ ...draft, world }, inserted.nodeId)
}

/**
 * Drags the handle at the end of the last segment; the mirrored handle is kept for the next segment.
 * With `alt`, only the outgoing handle changes.
 */
export function penDragHandle(draft: PenDraft, point: VectorPoint, alt = false): PenDraft {
  if (!draft.current) return draft
  const node = draft.world.nodes.find((item) => item.id === draft.current)!
  const moved = Math.hypot(point.x - node.point.x, point.y - node.point.y) > 0.5
  const mirrored = moved ? { x: node.point.x * 2 - point.x, y: node.point.y * 2 - point.y } : undefined
  const segments = draft.world.segments.map((segment) => {
    if (segment.id !== draft.lastSegment || alt) return segment
    const key = segment.b === draft.current ? 'bh' : 'ah'
    if (!mirrored) { const { [key]: _drop, ...rest } = segment; return rest }
    return { ...segment, [key]: mirrored }
  })
  const nodes = draft.world.nodes.map((item) => item.id === draft.current ? { ...item, handles: alt ? 'independent' as const : 'mirrored' as const } : item)
  return { ...draft, world: { nodes, segments }, pendingOut: moved ? point : undefined }
}

export function penRemoveLast(draft: PenDraft): PenDraft | null {
  if (!draft.lastSegment) return draft.element ? null : null
  const segment = draft.world.segments.find((item) => item.id === draft.lastSegment)
  if (!segment) return draft
  const segments = draft.world.segments.filter((item) => item.id !== draft.lastSegment)
  const used = new Set(segments.flatMap((item) => [item.a, item.b]))
  const previous = segment.a
  const nodes = draft.world.nodes.filter((node) => used.has(node.id) || node.id === previous)
  if (nodes.length === 0) return null
  return { ...draft, world: { nodes, segments }, current: previous, lastSegment: null, pendingOut: undefined }
}

export function penCanClose(draft: PenDraft, point: VectorPoint, threshold: number): boolean {
  if (!draft.current || !draft.start || draft.start === draft.current) return false
  const start = draft.world.nodes.find((node) => node.id === draft.start)
  if (!start) return false
  const placed = draft.world.segments.length - draft.baseline.segments
  return placed >= 2 && Math.hypot(point.x - start.point.x, point.y - start.point.y) <= threshold
}

/** Node of the draft near a point, if any. */
export function penNodeAt(draft: PenDraft, point: VectorPoint, threshold: number): string | null {
  const hit = draft.world.nodes.find((node) => Math.hypot(node.point.x - point.x, node.point.y - point.y) <= threshold)
  return hit ? hit.id : null
}

export type PenStyle = Pick<VectorElement, 'fill' | 'stroke' | 'strokeWidth'>

/** A new element, a patch for the extended element, or null when nothing was drawn. */
export function penCommit(draft: PenDraft, style?: Partial<PenStyle>): { element: VectorElement } | { id: string; patch: Partial<VectorElement> } | null {
  const world = { ...draft.world, nodes: draft.world.nodes.filter((node) => draft.world.segments.some((segment) => segment.a === node.id || segment.b === node.id)) }
  if (world.segments.length === 0) return null
  if (draft.element) {
    if (world.segments.length === draft.baseline.segments && world.nodes.length === draft.baseline.nodes) return null
    const box: Box = { ...draft.element, rotation: draft.element.rotation }
    const edit = commitWorld(box, world)
    return { id: draft.element.id, patch: { ...edit, kind: 'path' } }
  }
  const built = normalizeWorld(world)
  return { element: createVectorElement('path', built, { ...style, network: built.network }) }
}

/** Path data for what has been placed plus the rubber band towards the cursor. */
export function penPreviewData(draft: PenDraft, cursor?: VectorPoint | null): string {
  const runs = chains(draft.world).map((chain) => chainToRun(draft.world, chain))
  const parts = runs.map(runPathData)
  if (cursor && draft.current) {
    const node = draft.world.nodes.find((item) => item.id === draft.current)
    if (node) {
      parts.push(draft.pendingOut
        ? `M ${round(node.point.x)} ${round(node.point.y)} C ${round(draft.pendingOut.x)} ${round(draft.pendingOut.y)} ${round(cursor.x)} ${round(cursor.y)} ${round(cursor.x)} ${round(cursor.y)}`
        : `M ${round(node.point.x)} ${round(node.point.y)} L ${round(cursor.x)} ${round(cursor.y)}`)
    }
  }
  return parts.join(' ')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
