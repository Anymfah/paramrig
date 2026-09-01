import { rotatePoint } from '@/vector/directTransform'
import type { VectorTransformAxis, VectorTransformMode } from '@/vector/transform'
import type { VectorElement, VectorHandleMode, VectorNode, VectorPoint, VectorSubpath } from '@/vector/types'

const KAPPA = 0.27614237

/** A resolved sub-path: node indices `[start, end)` and whether it closes. */
export type SubpathRange = { start: number; end: number; closed: boolean }

type PathLike = Pick<VectorElement, 'closed' | 'subpaths'>

/** Sub-paths of an element for a given node count. */
export function subpathRanges(element: PathLike, nodeCount: number): SubpathRange[] {
  const declared = element.subpaths && element.subpaths.length ? element.subpaths : [{ start: 0, closed: element.closed !== false }]
  const ranges: SubpathRange[] = []
  for (let index = 0; index < declared.length; index += 1) {
    const current = declared[index]!
    const next = declared[index + 1]
    const end = next ? next.start : nodeCount
    if (current.start >= end) continue
    ranges.push({ start: current.start, end, closed: current.closed })
  }
  return ranges
}

export function subpathOfNode(element: PathLike, nodeCount: number, index: number): SubpathRange | null {
  return subpathRanges(element, nodeCount).find((range) => index >= range.start && index < range.end) ?? null
}

/** Neighbouring node indices along the sub-path, honouring open ends. */
export function neighbours(element: PathLike, nodeCount: number, index: number): { previous: number | null; next: number | null } {
  const range = subpathOfNode(element, nodeCount, index)
  if (!range) return { previous: null, next: null }
  const size = range.end - range.start
  const local = index - range.start
  const previous = local > 0 ? index - 1 : range.closed && size > 1 ? range.end - 1 : null
  const next = local < size - 1 ? index + 1 : range.closed && size > 1 ? range.start : null
  return { previous, next }
}

/** Normalises declared sub-paths: sorted, first at 0, within range, no duplicates. */
export function normalizeSubpaths(subpaths: VectorSubpath[] | undefined, nodeCount: number): VectorSubpath[] | undefined {
  if (!subpaths || subpaths.length === 0) return undefined
  const sorted = [...subpaths].filter((subpath) => subpath.start >= 0 && subpath.start < nodeCount).sort((a, b) => a.start - b.start)
  const unique: VectorSubpath[] = []
  for (const subpath of sorted) {
    if (unique.length && unique[unique.length - 1]!.start === subpath.start) continue
    unique.push({ start: subpath.start, closed: subpath.closed })
  }
  if (unique.length === 0) return undefined
  if (unique[0]!.start !== 0) unique[0] = { ...unique[0]!, start: 0 }
  if (unique.length === 1) return undefined
  return unique
}

/** Element fields describing the given sub-path ranges. */
export function subpathFields(ranges: SubpathRange[]): Pick<VectorElement, 'closed' | 'subpaths'> {
  if (ranges.length <= 1) {
    const closed = ranges[0]?.closed ?? true
    return { closed: closed ? undefined : false, subpaths: undefined }
  }
  return { closed: undefined, subpaths: ranges.map((range) => ({ start: range.start, closed: range.closed })) }
}

/** Whether every sub-path of the element is closed. */
export function isClosedPath(element: PathLike, nodeCount?: number): boolean {
  if (element.subpaths && element.subpaths.length) return element.subpaths.every((subpath) => subpath.closed)
  void nodeCount
  return element.closed !== false
}

/** Smallest node count the sub-path containing `index` can keep. */
export function minimumNodeCount(element: PathLike, nodeCount = 0, index = 0): number {
  const range = subpathOfNode(element, nodeCount, index)
  const closed = range ? range.closed : isClosedPath(element)
  return closed ? 3 : 2
}

export function handleMode(node: Pick<VectorNode, 'in' | 'out' | 'handles'>): VectorHandleMode {
  return node.handles ?? 'mirrored'
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
  closedOverride?: boolean,
): string {
  if (!nodes.length) return ''
  const anchor = (node: VectorNode) => ({ x: element.x + node.x * element.width, y: element.y + node.y * element.height })
  const control = (node: VectorNode, part: 'in' | 'out') => {
    const point = anchor(node)
    const offset = node[part]
    return offset ? { x: point.x + offset.x * element.width, y: point.y + offset.y * element.height } : point
  }
  const ranges = closedOverride === undefined
    ? subpathRanges(element, nodes.length)
    : subpathRanges({ ...element, subpaths: undefined, closed: closedOverride }, nodes.length)
  const commands: string[] = []
  for (const range of ranges) {
    const size = range.end - range.start
    const first = anchor(nodes[range.start]!)
    commands.push(`M ${round(first.x)} ${round(first.y)}`)
    const segments = range.closed ? size : size - 1
    for (let step = 0; step < segments; step += 1) {
      const index = range.start + step
      const current = nodes[index]!
      const next = nodes[range.start + ((step + 1) % size)]!
      const end = anchor(next)
      if (current.out || next.in) {
        const a = control(current, 'out')
        const b = control(next, 'in')
        commands.push(`C ${round(a.x)} ${round(a.y)} ${round(b.x)} ${round(b.y)} ${round(end.x)} ${round(end.y)}`)
      } else {
        commands.push(`L ${round(end.x)} ${round(end.y)}`)
      }
    }
    if (range.closed) commands.push('Z')
  }
  return commands.join(' ')
}

/** World positions of the two free ends of a single open path, or `null` for closed or multi-sub-path shapes. */
export function pathEndpoints(element: VectorElement): { start: VectorPoint; end: VectorPoint } | null {
  const nodes = element.vectorNodes
  if (!nodes || nodes.length < 2) return null
  const ranges = subpathRanges(element, nodes.length)
  if (ranges.length !== 1 || ranges[0]!.closed) return null
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
    const mode = mirrorHandles ? handleMode(nodes[index]!) : 'independent'
    const other = target[opposite]
    if (other && mode !== 'independent') {
      const direction = { x: target.anchor.x - localPointer.x, y: target.anchor.y - localPointer.y }
      const length = Math.hypot(direction.x, direction.y)
      if (mode === 'mirrored' || length < 1e-6) {
        target[opposite] = { x: target.anchor.x * 2 - localPointer.x, y: target.anchor.y * 2 - localPointer.y }
      } else {
        const keep = Math.hypot(other.x - target.anchor.x, other.y - target.anchor.y)
        target[opposite] = { x: target.anchor.x + direction.x / length * keep, y: target.anchor.y + direction.y / length * keep }
      }
    }
  }

  const result = normalizeAbsoluteNodes(element, absolute)
  result.vectorNodes = result.vectorNodes.map((node, position) => withNodeMeta(node, nodes[position]))
  return result
}

/** Carries handle mode and radius from a source node onto re-normalised geometry. */
export function withNodeMeta(node: VectorNode, source: VectorNode | undefined): VectorNode {
  if (!source) return node
  return {
    ...node,
    ...(source.handles ? { handles: source.handles } : {}),
    ...(source.radius ? { radius: source.radius } : {}),
  }
}

export function transformVectorNodes(
  element: VectorElement,
  nodes: VectorNode[],
  indices: number[],
  mode: VectorTransformMode,
  axis: VectorTransformAxis,
  start: VectorPoint,
  current: VectorPoint,
  originOverride?: VectorPoint,
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
  const origin = originOverride ?? {
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
  const result = normalizeAbsoluteNodes(element, transformed)
  result.vectorNodes = result.vectorNodes.map((node, position) => withNodeMeta(node, nodes[position]))
  return result
}

/** Maps the selected nodes (anchors and handles, world space) from one box to another. */
export function scaleNodesToBounds(
  element: VectorElement,
  nodes: VectorNode[],
  indices: number[],
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { vectorNodes: VectorNode[] } {
  const selected = new Set(indices)
  const sx = from.width > 0 ? to.width / from.width : 1
  const sy = from.height > 0 ? to.height / from.height : 1
  const map = (point: VectorPoint): VectorPoint => ({ x: to.x + (point.x - from.x) * sx, y: to.y + (point.y - from.y) * sy })
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const world = worldNodes(element, nodes)
  const transformed = world.map((node, index) => selected.has(index) ? {
    ...node,
    anchor: map(node.anchor),
    ...(node.in ? { in: map(node.in) } : {}),
    ...(node.out ? { out: map(node.out) } : {}),
  } : node).map((node) => ({
    ...node,
    anchor: rotatePoint(node.anchor, center, -element.rotation),
    ...(node.in ? { in: rotatePoint(node.in, center, -element.rotation) } : {}),
    ...(node.out ? { out: rotatePoint(node.out, center, -element.rotation) } : {}),
  }))
  return normalizeAbsoluteNodes(element, transformed)
}

/** Bounds of selected anchors in world space. */
export function nodeSelectionBounds(element: VectorElement, nodes: VectorNode[], indices: number[]): { x: number; y: number; width: number; height: number } | null {
  const points = indices.flatMap((index) => nodes[index] ? [nodeWorldPosition(element, nodes[index]!)] : [])
  if (points.length === 0) return null
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const right = Math.max(...points.map((point) => point.x))
  const bottom = Math.max(...points.map((point) => point.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
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
export type AbsoluteNode = { anchor: VectorPoint; in?: VectorPoint; out?: VectorPoint; handles?: VectorHandleMode; radius?: number }

export function absoluteNodes(element: VectorElement, nodes: VectorNode[]): AbsoluteNode[] {
  return nodes.map((node) => {
    const anchor = { x: element.x + node.x * element.width, y: element.y + node.y * element.height }
    return {
      anchor,
      in: node.in ? { x: anchor.x + node.in.x * element.width, y: anchor.y + node.in.y * element.height } : undefined,
      out: node.out ? { x: anchor.x + node.out.x * element.width, y: anchor.y + node.out.y * element.height } : undefined,
      ...(node.handles ? { handles: node.handles } : {}),
      ...(node.radius ? { radius: node.radius } : {}),
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
    ...(node.handles ? { handles: node.handles } : {}),
    ...(node.radius ? { radius: node.radius } : {}),
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
    ...(node.handles ? { handles: node.handles } : {}),
    ...(node.radius ? { radius: Math.round(node.radius * 100) / 100 } : {}),
  }
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}
