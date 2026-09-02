import { commitWorld, isStraight, newId, segmentCubic, splitCubic, type AbsNetwork, type AbsSegment, type Box, type NetworkEdit } from '@/vector/network'
import type { VectorElement } from '@/vector/types'

/**
 * Cuts a segment at `t`: the two halves keep their curvature but end on separate nodes that sit
 * on the same point, so the path is open there.
 */
export function cutSegment(element: Box, world: AbsNetwork, segmentId: string, t: number): NetworkEdit {
  const segment = world.segments.find((item) => item.id === segmentId)
  if (!segment) return commitWorld(element, world)
  const clamped = Math.min(0.999, Math.max(0.001, t))
  const { left, right } = splitCubic(segmentCubic(world, segment), clamped)
  const straight = isStraight(segment)
  const firstId = newId()
  const secondId = newId()
  const nodes = [
    ...world.nodes,
    { id: firstId, point: left[3], ...(straight ? {} : { handles: 'mirrored' as const }) },
    { id: secondId, point: right[0], ...(straight ? {} : { handles: 'mirrored' as const }) },
  ]
  const first: AbsSegment = { id: newId(), a: segment.a, b: firstId, ...(straight ? {} : { ah: left[1], bh: left[2] }) }
  const second: AbsSegment = { id: newId(), a: secondId, b: segment.b, ...(straight ? {} : { ah: right[1], bh: right[2] }) }
  const segments = world.segments.flatMap((item) => item.id === segmentId ? [first, second] : [item])
  return commitWorld(element, { nodes, segments })
}

/**
 * Cuts a node apart: every segment that met there gets its own copy of it, so a crossing becomes
 * as many loose ends as it had branches. A node with one segment is left alone.
 */
export function cutNode(element: Box, world: AbsNetwork, nodeId: string): NetworkEdit {
  const node = world.nodes.find((item) => item.id === nodeId)
  const incident = world.segments.filter((segment) => segment.a === nodeId || segment.b === nodeId)
  if (!node || incident.length < 2) return commitWorld(element, world)
  const copies = incident.map(() => newId())
  const nodes = [
    ...world.nodes.filter((item) => item.id !== nodeId),
    ...copies.map((id) => ({ id, point: node.point, ...(node.handles ? { handles: node.handles } : {}), ...(node.radius ? { radius: node.radius } : {}) })),
  ]
  const segments = world.segments.map((segment) => {
    const position = incident.indexOf(segment)
    if (position < 0) return segment
    const replacement = copies[position]!
    return {
      ...segment,
      ...(segment.a === nodeId ? { a: replacement } : {}),
      ...(segment.b === nodeId ? { b: replacement } : {}),
    }
  })
  return commitWorld(element, { nodes, segments })
}

/** Properties that should follow a uniform scale, so a shape keeps its weight when it is resized. */
export function scaleStylePatch(element: VectorElement, factor: number): Partial<VectorElement> {
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-6) return {}
  const patch: Partial<VectorElement> = {}
  if (element.strokeWidth > 0) patch.strokeWidth = round(element.strokeWidth * factor)
  if (element.strokeDash) patch.strokeDash = [round(element.strokeDash[0] * factor), round(element.strokeDash[1] * factor)]
  if (typeof element.cornerRadius === 'number') patch.cornerRadius = round(element.cornerRadius * factor)
  else if (Array.isArray(element.cornerRadius)) {
    patch.cornerRadius = element.cornerRadius.map((radius) => round(radius * factor)) as [number, number, number, number]
  }
  if (element.kind === 'text') {
    if (element.fontSize) patch.fontSize = round(element.fontSize * factor)
    if (element.letterSpacing) patch.letterSpacing = round(element.letterSpacing * factor)
  }
  if (element.network?.nodes.some((node) => node.radius)) {
    patch.network = {
      ...element.network,
      nodes: element.network.nodes.map((node) => node.radius ? { ...node, radius: round(node.radius * factor) } : node),
    }
  }
  return patch
}

/** The single factor a two-axis resize is worth, so weights scale evenly. */
export function uniformFactor(from: { width: number; height: number }, to: { width: number; height: number }): number {
  const x = to.width / Math.max(1e-6, from.width)
  const y = to.height / Math.max(1e-6, from.height)
  return Math.sqrt(Math.max(1e-6, Math.abs(x * y)))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
