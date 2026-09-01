import type { VectorElement, VectorNode, VectorPoint } from '@/vector/types'
import { absoluteNodes, handleMode, neighbours, normalizeAbsoluteNodes, subpathRanges, withNodeMeta, worldNodes, type AbsoluteNode } from '@/vector/vectorPath'
import { subpathsAfterInsert } from '@/vector/subpaths'
import { rotatePoint } from '@/vector/directTransform'

export type Cubic = [VectorPoint, VectorPoint, VectorPoint, VectorPoint]

export function cubicAt([p0, p1, p2, p3]: Cubic, t: number): VectorPoint {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

/** De Casteljau split into two cubics that together trace the original curve. */
export function splitCubic([p0, p1, p2, p3]: Cubic, t: number): { left: Cubic; right: Cubic } {
  const a = lerp(p0, p1, t)
  const b = lerp(p1, p2, t)
  const c = lerp(p2, p3, t)
  const d = lerp(a, b, t)
  const e = lerp(b, c, t)
  const m = lerp(d, e, t)
  return { left: [p0, a, d, m], right: [m, e, c, p3] }
}

/** Closest point on a cubic: 32 samples then a few golden-section refinements. */
export function nearestPointOnCubic(curve: Cubic, point: VectorPoint): { t: number; point: VectorPoint; distance: number } {
  const distanceAt = (t: number) => {
    const at = cubicAt(curve, t)
    return Math.hypot(at.x - point.x, at.y - point.y)
  }
  let bestT = 0
  let best = Number.POSITIVE_INFINITY
  const samples = 32
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples
    const distance = distanceAt(t)
    if (distance < best) {
      best = distance
      bestT = t
    }
  }
  let low = Math.max(0, bestT - 1 / samples)
  let high = Math.min(1, bestT + 1 / samples)
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const m1 = low + (high - low) / 3
    const m2 = high - (high - low) / 3
    if (distanceAt(m1) < distanceAt(m2)) high = m2
    else low = m1
  }
  const t = (low + high) / 2
  const at = cubicAt(curve, t)
  return { t, point: at, distance: Math.hypot(at.x - point.x, at.y - point.y) }
}

/** Control polygon of the segment leaving node `index`, or `null` at a free end. */
export function segmentCubic(nodes: AbsoluteNode[], index: number, closedOrElement: boolean | Pick<VectorElement, 'closed' | 'subpaths'>): Cubic | null {
  const from = nodes[index]
  const nextIndex = typeof closedOrElement === 'boolean'
    ? (closedOrElement ? (index + 1) % nodes.length : index + 1)
    : neighbours(closedOrElement, nodes.length, index).next
  const to = nextIndex === null ? undefined : nodes[nextIndex]
  if (!from || !to) return null
  if (!from.out && !to.in) {
    // A straight segment as a linear cubic, so `t` is the fraction along the line.
    return [from.anchor, lerp(from.anchor, to.anchor, 1 / 3), lerp(from.anchor, to.anchor, 2 / 3), to.anchor]
  }
  return [from.anchor, from.out ?? from.anchor, to.in ?? to.anchor, to.anchor]
}

/** Segment indices of the whole element (one per node that has a following segment). */
export function segmentIndices(element: Pick<VectorElement, 'closed' | 'subpaths'>, nodeCount: number): number[] {
  return subpathRanges(element, nodeCount).flatMap((range) => {
    const size = range.end - range.start
    const count = range.closed ? size : size - 1
    return Array.from({ length: Math.max(0, count) }, (_, step) => range.start + step)
  })
}

/** Nearest segment of an element's outline to a world-space point. */
export function nearestSegment(element: VectorElement, nodes: VectorNode[], point: VectorPoint): { index: number; t: number; point: VectorPoint; distance: number } | null {
  const absolute = worldNodes(element, nodes)
  let best: { index: number; t: number; point: VectorPoint; distance: number } | null = null
  for (const index of segmentIndices(element, nodes.length)) {
    const cubic = segmentCubic(absolute, index, element)
    if (!cubic) continue
    const candidate = nearestPointOnCubic(cubic, point)
    if (!best || candidate.distance < best.distance) best = { index, ...candidate }
  }
  return best
}

/** Inserts an anchor on the segment leaving node `index` at parameter `t`, keeping the outline shape. */
export function insertNode(element: VectorElement, nodes: VectorNode[], index: number, t: number): Pick<VectorElement, 'x' | 'y' | 'width' | 'height' | 'closed' | 'subpaths'> & { vectorNodes: VectorNode[]; insertedIndex: number } {
  const absolute = absoluteNodes(element, nodes)
  const cubic = segmentCubic(absolute, index, element)
  const nextIndex = neighbours(element, nodes.length, index).next
  if (!cubic || nextIndex === null) return { x: element.x, y: element.y, width: element.width, height: element.height, closed: element.closed, subpaths: element.subpaths, vectorNodes: nodes, insertedIndex: -1 }
  const from = absolute[index]!
  const to = absolute[nextIndex]!
  const straight = !from.out && !to.in
  const { left, right } = splitCubic(cubic, t)
  const inserted: AbsoluteNode = straight
    ? { anchor: left[3] }
    : { anchor: left[3], in: left[2], out: right[1] }
  const updated = absolute.map((node, position) => {
    if (straight) return node
    if (position === index) return { ...node, out: left[1] }
    if (position === nextIndex) return { ...node, in: right[2] }
    return node
  })
  updated.splice(index + 1, 0, inserted)
  const result = normalizeAbsoluteNodes(element, updated)
  return { ...result, ...subpathsAfterInsert(element, nodes.length, index + 1), insertedIndex: index + 1 }
}

export function isSmoothNode(node: Pick<VectorNode, 'in' | 'out'>): boolean {
  return !!node.in || !!node.out
}

/** Corner nodes gain mirrored tangent handles; nodes with handles lose them. */
export function toggleNodeType(element: VectorElement, nodes: VectorNode[], index: number): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { vectorNodes: VectorNode[] } {
  const absolute = absoluteNodes(element, nodes)
  const node = absolute[index]
  if (!node) return { x: element.x, y: element.y, width: element.width, height: element.height, vectorNodes: nodes }
  if (isSmoothNode(node)) {
    absolute[index] = { anchor: node.anchor, ...(node.radius ? { radius: node.radius } : {}) }
    return normalizeAbsoluteNodes(element, absolute)
  }
  const around = neighbours(element, nodes.length, index)
  const previous = around.previous === null ? undefined : absolute[around.previous]
  const next = around.next === null ? undefined : absolute[around.next]
  const reference = previous && next ? { x: next.anchor.x - previous.anchor.x, y: next.anchor.y - previous.anchor.y }
    : next ? { x: next.anchor.x - node.anchor.x, y: next.anchor.y - node.anchor.y }
    : previous ? { x: node.anchor.x - previous.anchor.x, y: node.anchor.y - previous.anchor.y }
    : { x: 1, y: 0 }
  const length = Math.hypot(reference.x, reference.y) || 1
  const tangent = { x: reference.x / length, y: reference.y / length }
  const inLength = previous ? Math.hypot(node.anchor.x - previous.anchor.x, node.anchor.y - previous.anchor.y) / 3 : 20
  const outLength = next ? Math.hypot(next.anchor.x - node.anchor.x, next.anchor.y - node.anchor.y) / 3 : 20
  absolute[index] = {
    anchor: node.anchor,
    ...(previous || !next ? { in: { x: node.anchor.x - tangent.x * inLength, y: node.anchor.y - tangent.y * inLength } } : {}),
    ...(next || !previous ? { out: { x: node.anchor.x + tangent.x * outLength, y: node.anchor.y + tangent.y * outLength } } : {}),
    handles: 'mirrored',
  }
  return normalizeAbsoluteNodes(element, absolute)
}

/** Sets the handle mode of a node; switching to mirrored realigns the in handle to the out handle. */
export function setHandleMode(element: VectorElement, nodes: VectorNode[], index: number, mode: VectorNode['handles']): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { vectorNodes: VectorNode[] } {
  const absolute = absoluteNodes(element, nodes)
  const node = absolute[index]
  if (!node) return { x: element.x, y: element.y, width: element.width, height: element.height, vectorNodes: nodes }
  const next: AbsoluteNode = { ...node, handles: mode ?? 'mirrored' }
  if (node.in && node.out && mode !== 'independent') {
    const direction = { x: node.out.x - node.anchor.x, y: node.out.y - node.anchor.y }
    const length = Math.hypot(direction.x, direction.y)
    if (length > 1e-6) {
      const keep = mode === 'mirrored' ? length : Math.hypot(node.in.x - node.anchor.x, node.in.y - node.anchor.y)
      next.in = { x: node.anchor.x - direction.x / length * keep, y: node.anchor.y - direction.y / length * keep }
    }
  }
  absolute[index] = next
  const result = normalizeAbsoluteNodes(element, absolute)
  result.vectorNodes = result.vectorNodes.map((item, position) => position === index ? item : withNodeMeta(item, nodes[position]))
  return result
}

export { handleMode }

/**
 * Bends the segment leaving node `index` so the curve point at `t` lands on `target` (world space).
 * Both end handles move by the same amount; nodes with an opposite handle become independent.
 */
export function bendSegment(element: VectorElement, nodes: VectorNode[], index: number, t: number, target: VectorPoint): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { vectorNodes: VectorNode[] } {
  const nextIndex = neighbours(element, nodes.length, index).next
  if (nextIndex === null) return { x: element.x, y: element.y, width: element.width, height: element.height, vectorNodes: nodes }
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const local = rotatePoint(target, center, -element.rotation)
  const absolute = absoluteNodes(element, nodes)
  const from = absolute[index]!
  const to = absolute[nextIndex]!
  const p1 = from.out ?? lerp(from.anchor, to.anchor, 1 / 3)
  const p2 = to.in ?? lerp(from.anchor, to.anchor, 2 / 3)
  const clampedT = Math.min(0.9, Math.max(0.1, t))
  const at = cubicAt([from.anchor, p1, p2, to.anchor], clampedT)
  const weight = 3 * clampedT * (1 - clampedT)
  const delta = { x: (local.x - at.x) / weight, y: (local.y - at.y) / weight }
  absolute[index] = { ...from, out: { x: p1.x + delta.x, y: p1.y + delta.y }, ...(from.in ? { handles: 'independent' as const } : {}) }
  absolute[nextIndex] = { ...to, in: { x: p2.x + delta.x, y: p2.y + delta.y }, ...(to.out ? { handles: 'independent' as const } : {}) }
  return normalizeAbsoluteNodes(element, absolute)
}

/** Gives a corner node zero-length mirrored handles so a drag can pull them out. */
export function seedHandles(nodes: VectorNode[], index: number): VectorNode[] {
  const node = nodes[index]
  if (!node) return nodes
  return nodes.map((item, position) => position === index ? { ...item, in: { x: 0, y: 0 }, out: { x: 0, y: 0 }, handles: 'mirrored' } : item)
}

/** Moves a node's anchor to a world-space point (handles follow). */
export function placeNodeAt(element: VectorElement, nodes: VectorNode[], index: number, worldPoint: VectorPoint): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { vectorNodes: VectorNode[] } {
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const local = rotatePoint(worldPoint, center, -element.rotation)
  const absolute = absoluteNodes(element, nodes)
  const node = absolute[index]
  if (!node) return { x: element.x, y: element.y, width: element.width, height: element.height, vectorNodes: nodes }
  const delta = { x: local.x - node.anchor.x, y: local.y - node.anchor.y }
  absolute[index] = {
    ...node,
    anchor: local,
    ...(node.in ? { in: { x: node.in.x + delta.x, y: node.in.y + delta.y } } : {}),
    ...(node.out ? { out: { x: node.out.x + delta.x, y: node.out.y + delta.y } } : {}),
  }
  return normalizeAbsoluteNodes(element, absolute)
}

function lerp(a: VectorPoint, b: VectorPoint, t: number): VectorPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
