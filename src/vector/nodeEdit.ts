import type { AlignMode, DistributeAxis } from '@/vector/align'
import type { AbsNetwork } from '@/vector/network'
import type { Face } from '@/vector/planar'
import type { VectorPoint } from '@/vector/types'

/** Angle step handles snap to while Shift is held. */
export const HANDLE_ANGLE_STEP = 15

/** Lines a set of points up on one edge or centre of their own bounding box. */
export function alignPoints(points: VectorPoint[], mode: AlignMode): VectorPoint[] {
  if (points.length < 2) return points
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  return points.map((point) => {
    switch (mode) {
      case 'left': return { x: box.left, y: point.y }
      case 'right': return { x: box.right, y: point.y }
      case 'centerX': return { x: (box.left + box.right) / 2, y: point.y }
      case 'top': return { x: point.x, y: box.top }
      case 'bottom': return { x: point.x, y: box.bottom }
      case 'centerY': return { x: point.x, y: (box.top + box.bottom) / 2 }
    }
  })
}

/** Spaces points evenly between the two outermost ones along an axis; those two stay put. */
export function distributePoints(points: VectorPoint[], axis: DistributeAxis): VectorPoint[] {
  if (points.length < 3) return points
  const key = axis === 'x' ? 'x' : 'y'
  const order = points.map((point, index) => ({ index, value: point[key] })).sort((a, b) => a.value - b.value)
  const first = order[0]!.value
  const last = order[order.length - 1]!.value
  const step = (last - first) / (order.length - 1)
  const moved = points.map((point) => ({ ...point }))
  order.forEach((entry, position) => {
    moved[entry.index]![key] = first + step * position
  })
  return moved
}

/**
 * A network with some nodes moved to new points; each node's handles travel with it, so the
 * curves keep their shape.
 */
export function moveNodesTo(world: AbsNetwork, targets: Map<string, VectorPoint>): AbsNetwork {
  const deltas = new Map<string, VectorPoint>()
  for (const node of world.nodes) {
    const target = targets.get(node.id)
    if (!target) continue
    const delta = { x: target.x - node.point.x, y: target.y - node.point.y }
    if (Math.abs(delta.x) > 1e-9 || Math.abs(delta.y) > 1e-9) deltas.set(node.id, delta)
  }
  if (deltas.size === 0) return world
  const shift = (point: VectorPoint, delta: VectorPoint) => ({ x: point.x + delta.x, y: point.y + delta.y })
  return {
    nodes: world.nodes.map((node) => {
      const delta = deltas.get(node.id)
      return delta ? { ...node, point: shift(node.point, delta) } : node
    }),
    segments: world.segments.map((segment) => {
      const a = deltas.get(segment.a)
      const b = deltas.get(segment.b)
      if (!a && !b) return segment
      return {
        ...segment,
        ...(segment.ah && a ? { ah: shift(segment.ah, a) } : {}),
        ...(segment.bh && b ? { bh: shift(segment.bh, b) } : {}),
      }
    }),
  }
}

/** Point constrained to the nearest multiple of `step` degrees around an anchor. */
export function constrainToAngle(anchor: VectorPoint, point: VectorPoint, step = HANDLE_ANGLE_STEP): VectorPoint {
  const dx = point.x - anchor.x
  const dy = point.y - anchor.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return point
  const radians = (step * Math.PI) / 180
  const snapped = Math.round(Math.atan2(dy, dx) / radians) * radians
  return { x: anchor.x + Math.cos(snapped) * length, y: anchor.y + Math.sin(snapped) * length }
}

/** Polar form of a handle relative to its node: length in pixels, angle in degrees with y up. */
export function handlePolar(node: VectorPoint, handle: VectorPoint): { length: number; angle: number } {
  const dx = handle.x - node.x
  const dy = handle.y - node.y
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI
  return { length: Math.hypot(dx, dy), angle: ((angle % 360) + 360) % 360 }
}

/** The handle point a length and angle describe, in the same convention as `handlePolar`. */
export function handleFromPolar(node: VectorPoint, length: number, angle: number): VectorPoint {
  const radians = (angle * Math.PI) / 180
  return { x: node.x + Math.cos(radians) * length, y: node.y - Math.sin(radians) * length }
}

/** Node ids on a face's outline, in traversal order and without repeats. */
export function faceNodeIds(face: Face): string[] {
  const ids: string[] = []
  for (const loop of [face.outer, ...face.holes]) {
    for (const vertex of loop.vertices) {
      if (!vertex.startsWith('n:')) continue
      const id = vertex.slice(2)
      if (!ids.includes(id)) ids.push(id)
    }
  }
  return ids
}
