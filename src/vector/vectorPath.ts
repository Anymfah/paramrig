import { rotatePoint } from '@/vector/directTransform'
import type { VectorTransformAxis, VectorTransformMode } from '@/vector/transform'
import type { VectorElement, VectorNode, VectorPoint } from '@/vector/types'

const KAPPA = 0.27614237

/** Minimum node count a path can be reduced to. */
export function minimumNodeCount(element: Pick<VectorElement, 'closed'>): number {
  return isClosedPath(element) ? 3 : 2
}

export function isClosedPath(element: Pick<VectorElement, 'closed'>): boolean {
  return element.closed !== false
}

export function defaultVectorNodes(element: VectorElement): VectorNode[] {
  if (element.kind === 'ellipse') {
    return [
      { x: 0.5, y: 0, in: { x: -KAPPA, y: 0 }, out: { x: KAPPA, y: 0 } },
      { x: 1, y: 0.5, in: { x: 0, y: -KAPPA }, out: { x: 0, y: KAPPA } },
      { x: 0.5, y: 1, in: { x: KAPPA, y: 0 }, out: { x: -KAPPA, y: 0 } },
      { x: 0, y: 0.5, in: { x: 0, y: KAPPA }, out: { x: 0, y: -KAPPA } },
    ]
  }
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
}

export function vectorPathData(
  element: VectorElement,
  nodes = element.vectorNodes ?? defaultVectorNodes(element),
  closed = isClosedPath(element),
): string {
  if (!nodes.length) return ''
  const anchor = (node: VectorNode) => ({ x: element.x + node.x * element.width, y: element.y + node.y * element.height })
  const control = (node: VectorNode, part: 'in' | 'out') => {
    const point = anchor(node)
    const offset = node[part]
    return offset ? { x: point.x + offset.x * element.width, y: point.y + offset.y * element.height } : point
  }
  const first = anchor(nodes[0]!)
  const commands = [`M ${round(first.x)} ${round(first.y)}`]
  const segments = closed ? nodes.length : nodes.length - 1
  for (let index = 0; index < segments; index += 1) {
    const current = nodes[index]!
    const next = nodes[(index + 1) % nodes.length]!
    const end = anchor(next)
    if (current.out || next.in) {
      const a = control(current, 'out')
      const b = control(next, 'in')
      commands.push(`C ${round(a.x)} ${round(a.y)} ${round(b.x)} ${round(b.y)} ${round(end.x)} ${round(end.y)}`)
    } else {
      commands.push(`L ${round(end.x)} ${round(end.y)}`)
    }
  }
  return closed ? `${commands.join(' ')} Z` : commands.join(' ')
}

/** World positions of the two free ends of an open path, or `null` for closed shapes. */
export function pathEndpoints(element: VectorElement): { start: VectorPoint; end: VectorPoint } | null {
  const nodes = element.vectorNodes
  if (isClosedPath(element) || !nodes || nodes.length < 2) return null
  return { start: nodeWorldPosition(element, nodes[0]!), end: nodeWorldPosition(element, nodes[nodes.length - 1]!) }
}

export function moveVectorNode(
  element: VectorElement,
  nodes: VectorNode[],
  index: number,
  part: 'anchor' | 'in' | 'out',
  pointer: VectorPoint,
  mirrorHandles: boolean,
): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { vectorNodes: VectorNode[] } {
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const localPointer = rotatePoint(pointer, center, -element.rotation)
  const absolute = absoluteNodes(element, nodes)
  const target = absolute[index]
  if (!target) return { x: element.x, y: element.y, width: element.width, height: element.height, vectorNodes: nodes }
  if (part === 'anchor') {
    const delta = { x: localPointer.x - target.anchor.x, y: localPointer.y - target.anchor.y }
    target.anchor = localPointer
    if (target.in) target.in = { x: target.in.x + delta.x, y: target.in.y + delta.y }
    if (target.out) target.out = { x: target.out.x + delta.x, y: target.out.y + delta.y }
  } else {
    target[part] = localPointer
    const opposite = part === 'in' ? 'out' : 'in'
    if (mirrorHandles && target[opposite]) {
      target[opposite] = { x: target.anchor.x * 2 - localPointer.x, y: target.anchor.y * 2 - localPointer.y }
    }
  }

  return normalizeAbsoluteNodes(element, absolute)
}

export function transformVectorNodes(
  element: VectorElement,
  nodes: VectorNode[],
  indices: number[],
  mode: VectorTransformMode,
  axis: VectorTransformAxis,
  start: VectorPoint,
  current: VectorPoint,
): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { vectorNodes: VectorNode[] } {
  const selected = new Set(indices)
  if (selected.size === 0) return unchanged(element, nodes)
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const absolute = absoluteNodes(element, nodes).map((node) => ({
    anchor: rotatePoint(node.anchor, center, element.rotation),
    in: node.in ? rotatePoint(node.in, center, element.rotation) : undefined,
    out: node.out ? rotatePoint(node.out, center, element.rotation) : undefined,
  }))
  const anchors = absolute.filter((_, index) => selected.has(index)).map((node) => node.anchor)
  if (anchors.length === 0) return unchanged(element, nodes)
  const origin = {
    x: anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length,
    y: anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length,
  }
  const transform = nodePointTransform(mode, axis, origin, start, current)
  const transformed = absolute.map((node, index) => selected.has(index) ? {
    anchor: transform(node.anchor),
    in: node.in ? transform(node.in) : undefined,
    out: node.out ? transform(node.out) : undefined,
  } : node).map((node) => ({
    anchor: rotatePoint(node.anchor, center, -element.rotation),
    in: node.in ? rotatePoint(node.in, center, -element.rotation) : undefined,
    out: node.out ? rotatePoint(node.out, center, -element.rotation) : undefined,
  }))
  return normalizeAbsoluteNodes(element, transformed)
}

export function nodeWorldPosition(element: VectorElement, node: VectorNode, part: 'anchor' | 'in' | 'out' = 'anchor'): VectorPoint {
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  return rotatePoint(nodePosition(element, node, part), center, element.rotation)
}

export function nodeIndicesInBounds(
  element: VectorElement,
  nodes: VectorNode[],
  bounds: { x: number; y: number; width: number; height: number },
): number[] {
  return nodes.flatMap((node, index) => {
    const point = nodeWorldPosition(element, node)
    return point.x >= bounds.x && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y && point.y <= bounds.y + bounds.height ? [index] : []
  })
}

/** A node expressed in the element's local (unrotated) document coordinates. */
export type AbsoluteNode = { anchor: VectorPoint; in?: VectorPoint; out?: VectorPoint }

export function absoluteNodes(element: VectorElement, nodes: VectorNode[]): AbsoluteNode[] {
  return nodes.map((node) => {
    const anchor = { x: element.x + node.x * element.width, y: element.y + node.y * element.height }
    return {
      anchor,
      in: node.in ? { x: anchor.x + node.in.x * element.width, y: anchor.y + node.in.y * element.height } : undefined,
      out: node.out ? { x: anchor.x + node.out.x * element.width, y: anchor.y + node.out.y * element.height } : undefined,
    }
  })
}

/** Nodes in world coordinates (rotation applied). */
export function worldNodes(element: VectorElement, nodes = element.vectorNodes ?? defaultVectorNodes(element)): AbsoluteNode[] {
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  return absoluteNodes(element, nodes).map((node) => ({
    anchor: rotatePoint(node.anchor, center, element.rotation),
    in: node.in ? rotatePoint(node.in, center, element.rotation) : undefined,
    out: node.out ? rotatePoint(node.out, center, element.rotation) : undefined,
  }))
}

/**
 * Rebuilds the element box from local absolute nodes and re-normalises them.
 * The world centre of the new box is placed so the geometry does not move when rotated.
 */
export function normalizeAbsoluteNodes(
  element: Pick<VectorElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  absolute: AbsoluteNode[],
): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { vectorNodes: VectorNode[] } {
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const geometry = absolute.flatMap((node) => [node.anchor, ...(node.in ? [node.in] : []), ...(node.out ? [node.out] : [])])
  const left = Math.min(...geometry.map((point) => point.x))
  const right = Math.max(...geometry.map((point) => point.x))
  const top = Math.min(...geometry.map((point) => point.y))
  const bottom = Math.max(...geometry.map((point) => point.y))
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const localCenter = { x: left + width / 2, y: top + height / 2 }
  const worldCenter = rotatePoint(localCenter, center, element.rotation)
  const normalized = absolute.map((node): VectorNode => ({
    x: (node.anchor.x - left) / width,
    y: (node.anchor.y - top) / height,
    ...(node.in ? { in: { x: (node.in.x - node.anchor.x) / width, y: (node.in.y - node.anchor.y) / height } } : {}),
    ...(node.out ? { out: { x: (node.out.x - node.anchor.x) / width, y: (node.out.y - node.anchor.y) / height } } : {}),
  }))
  return {
    x: round(worldCenter.x - width / 2),
    y: round(worldCenter.y - height / 2),
    width: round(width),
    height: round(height),
    vectorNodes: normalized.map(roundNode),
  }
}

/** Builds a fresh unrotated box + nodes from world-space nodes (used by the pen and by ungrouping). */
export function elementFromWorldNodes(absolute: AbsoluteNode[]): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { vectorNodes: VectorNode[] } {
  return normalizeAbsoluteNodes({ x: 0, y: 0, width: 0, height: 0, rotation: 0 }, absolute)
}

function nodePointTransform(
  mode: VectorTransformMode,
  axis: VectorTransformAxis,
  origin: VectorPoint,
  start: VectorPoint,
  current: VectorPoint,
): (point: VectorPoint) => VectorPoint {
  if (mode === 'move') {
    const dx = axis === 'y' ? 0 : current.x - start.x
    const dy = axis === 'x' ? 0 : current.y - start.y
    return (point) => ({ x: point.x + dx, y: point.y + dy })
  }
  if (mode === 'rotate') {
    const startAngle = Math.atan2(start.y - origin.y, start.x - origin.x)
    const currentAngle = Math.atan2(current.y - origin.y, current.x - origin.x)
    const angle = currentAngle - startAngle
    return (point) => rotatePoint(point, origin, angle * 180 / Math.PI)
  }
  const startVector = { x: start.x - origin.x, y: start.y - origin.y }
  const currentVector = { x: current.x - origin.x, y: current.y - origin.y }
  const uniform = Math.max(0.01, Math.hypot(currentVector.x, currentVector.y) / Math.max(1, Math.hypot(startVector.x, startVector.y)))
  const factorX = axis === 'y' ? 1 : axis === 'x' ? safeRatio(currentVector.x, startVector.x, uniform) : uniform
  const factorY = axis === 'x' ? 1 : axis === 'y' ? safeRatio(currentVector.y, startVector.y, uniform) : uniform
  return (point) => ({
    x: origin.x + (point.x - origin.x) * factorX,
    y: origin.y + (point.y - origin.y) * factorY,
  })
}

function safeRatio(value: number, base: number, fallback: number): number {
  return Math.abs(base) > 0.01 ? Math.max(0.01, value / base) : fallback
}

function unchanged(element: VectorElement, nodes: VectorNode[]) {
  return { x: element.x, y: element.y, width: element.width, height: element.height, vectorNodes: nodes }
}

export function nodePosition(element: VectorElement, node: VectorNode, part: 'anchor' | 'in' | 'out' = 'anchor'): VectorPoint {
  const anchor = { x: element.x + node.x * element.width, y: element.y + node.y * element.height }
  if (part === 'anchor' || !node[part]) return anchor
  return { x: anchor.x + node[part]!.x * element.width, y: anchor.y + node[part]!.y * element.height }
}

export function roundNode(node: VectorNode): VectorNode {
  return {
    x: round(node.x), y: round(node.y),
    ...(node.in ? { in: { x: round(node.in.x), y: round(node.in.y) } } : {}),
    ...(node.out ? { out: { x: round(node.out.x), y: round(node.out.y) } } : {}),
  }
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}
