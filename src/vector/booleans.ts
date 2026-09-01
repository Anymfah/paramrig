import paper from 'paper/dist/paper-core'
import { outlineNodes, runPathData } from '@/vector/render'
import type { VectorElement, VectorPoint } from '@/vector/types'
import { normalizeAbsoluteNodes, subpathFields, type AbsoluteNode, type SubpathRange } from '@/vector/vectorPath'
import { rotatePoint } from '@/vector/directTransform'

export type BooleanOperation = 'unite' | 'subtract' | 'intersect' | 'exclude'

let ready = false
function setup() {
  if (ready) return
  paper.setup(new paper.Size(1, 1))
  ready = true
}

/** World-space outline of an element (corners applied, rotation baked) as a paper item. */
export function toPaperItem(element: VectorElement): paper.PathItem {
  setup()
  const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
  const rotate = (point: VectorPoint) => rotatePoint(point, center, element.rotation)
  const { ranges } = outlineNodes(element)
  const paths = ranges.map((range) => {
    const path = new paper.Path()
    for (const node of range.nodes) {
      const anchor = rotate(node.anchor)
      const handleIn = node.in ? rotate(node.in) : anchor
      const handleOut = node.out ? rotate(node.out) : anchor
      path.add(new paper.Segment(new paper.Point(anchor.x, anchor.y), new paper.Point(handleIn.x - anchor.x, handleIn.y - anchor.y), new paper.Point(handleOut.x - anchor.x, handleOut.y - anchor.y)))
    }
    path.closed = range.closed
    return path
  })
  if (paths.length === 1) return paths[0]!
  const compound = new paper.CompoundPath({ children: paths })
  return compound
}

/** Converts a paper item back to world-space nodes with sub-path ranges. */
export function fromPaperItem(item: paper.PathItem): { nodes: AbsoluteNode[]; ranges: SubpathRange[] } {
  const paths: paper.Path[] = item instanceof paper.CompoundPath ? (item.children as paper.Path[]) : [item as paper.Path]
  const nodes: AbsoluteNode[] = []
  const ranges: SubpathRange[] = []
  for (const path of paths) {
    if (path.segments.length < 2) continue
    const start = nodes.length
    for (const segment of path.segments) {
      const anchor = { x: round(segment.point.x), y: round(segment.point.y) }
      const node: AbsoluteNode = { anchor }
      if (!segment.handleIn.isZero()) node.in = { x: round(segment.point.x + segment.handleIn.x), y: round(segment.point.y + segment.handleIn.y) }
      if (!segment.handleOut.isZero()) node.out = { x: round(segment.point.x + segment.handleOut.x), y: round(segment.point.y + segment.handleOut.y) }
      if (node.in && node.out) node.handles = 'independent'
      nodes.push(node)
    }
    ranges.push({ start, end: nodes.length, closed: path.closed })
  }
  return { nodes, ranges }
}

export type GeometryResult = Pick<VectorElement, 'x' | 'y' | 'width' | 'height' | 'closed' | 'subpaths'> & { vectorNodes: VectorElement['vectorNodes'] }

function toResult(nodes: AbsoluteNode[], ranges: SubpathRange[]): GeometryResult | null {
  if (nodes.length < 2) return null
  const box = normalizeAbsoluteNodes({ x: 0, y: 0, width: 0, height: 0, rotation: 0 }, nodes)
  return { ...box, ...subpathFields(ranges) }
}

/** Applies a boolean operation to elements in paint order (the bottom element is the base). */
export function booleanOperation(operation: BooleanOperation, elements: VectorElement[]): GeometryResult | null {
  if (elements.length < 2) return null
  setup()
  const items = elements.map(toPaperItem)
  let result: paper.PathItem = items[0]!
  for (const item of items.slice(1)) {
    const next = result[operation](item, { insert: false }) as paper.PathItem
    result.remove()
    result = next
  }
  const converted = fromPaperItem(result)
  result.remove()
  for (const item of items) item.remove()
  return toResult(converted.nodes, converted.ranges)
}

/** Unites every sub-path of the element into one outline (Flatten). */
export function flattenElement(element: VectorElement): GeometryResult | null {
  setup()
  const item = toPaperItem(element)
  const paths: paper.Path[] = item instanceof paper.CompoundPath ? [...(item.children as paper.Path[])] : [item as paper.Path]
  if (paths.length < 2) {
    const converted = fromPaperItem(item)
    item.remove()
    return toResult(converted.nodes, converted.ranges)
  }
  let result: paper.PathItem = paths[0]!.clone({ insert: false })
  for (const path of paths.slice(1)) {
    const next = result.unite(path, { insert: false }) as paper.PathItem
    result.remove()
    result = next
  }
  const converted = fromPaperItem(result)
  result.remove()
  item.remove()
  return toResult(converted.nodes, converted.ranges)
}

/**
 * Converts a stroke into filled geometry: each segment is flattened and expanded into quads plus
 * joins and caps, united, then re-fitted. Curves become dense polylines at the given tolerance.
 */
export function outlineStroke(element: VectorElement, tolerance = 0.25): GeometryResult | null {
  if (element.strokeWidth <= 0) return null
  setup()
  const item = toPaperItem(element)
  const paths: paper.Path[] = item instanceof paper.CompoundPath ? (item.children as paper.Path[]) : [item as paper.Path]
  const align = element.strokeAlign ?? 'center'
  const width = align === 'center' ? element.strokeWidth : element.strokeWidth * 2
  const half = width / 2
  const cap = element.strokeCap ?? 'butt'
  const join = element.strokeJoin ?? 'miter'
  const pieces: paper.PathItem[] = []
  for (const path of paths) {
    const flat = path.clone({ insert: false }) as paper.Path
    flat.flatten(tolerance)
    const points = flat.segments.map((segment) => segment.point)
    const count = flat.closed ? points.length : points.length - 1
    for (let index = 0; index < count; index += 1) {
      const a = points[index]!
      const b = points[(index + 1) % points.length]!
      const direction = b.subtract(a)
      if (direction.length < 1e-6) continue
      const normal = direction.normalize(half).rotate(90, new paper.Point(0, 0))
      const extend = cap === 'square' && !flat.closed ? direction.normalize(half) : new paper.Point(0, 0)
      const start = index === 0 && !flat.closed ? a.subtract(extend) : a
      const end = index === count - 1 && !flat.closed ? b.add(extend) : b
      pieces.push(new paper.Path({ segments: [start.add(normal), end.add(normal), end.subtract(normal), start.subtract(normal)], closed: true, insert: false }))
      const isJoin = flat.closed || index < count - 1
      if (isJoin) {
        if (join === 'round') pieces.push(new paper.Path.Circle(b, half))
        else if (join === 'miter') {
          const next = points[(index + 2) % points.length]!
          const miter = miterPolygon(a, b, next, half)
          if (miter) pieces.push(new paper.Path({ segments: miter, closed: true, insert: false }))
        }
      }
    }
    if (!flat.closed && cap === 'round') {
      pieces.push(new paper.Path.Circle(points[0]!, half))
      pieces.push(new paper.Path.Circle(points[points.length - 1]!, half))
    }
    flat.remove()
  }
  if (pieces.length === 0) {
    item.remove()
    return null
  }
  let result: paper.PathItem = pieces[0]!
  for (const piece of pieces.slice(1)) {
    const next = result.unite(piece, { insert: false }) as paper.PathItem
    result.remove()
    piece.remove()
    result = next
  }
  let final: paper.PathItem = result
  if (align === 'inside') {
    final = result.intersect(item, { insert: false }) as paper.PathItem
    result.remove()
  } else if (align === 'outside') {
    final = result.subtract(item, { insert: false }) as paper.PathItem
    result.remove()
  }
  const converted = fromPaperItem(final)
  final.remove()
  item.remove()
  return toResult(converted.nodes, converted.ranges)
}

function miterPolygon(a: paper.Point, b: paper.Point, c: paper.Point, half: number): paper.Point[] | null {
  const incoming = b.subtract(a).normalize()
  const outgoing = c.subtract(b).normalize()
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x
  if (Math.abs(cross) < 1e-6) return null
  const outer = cross > 0 ? -90 : 90
  const p1 = b.add(incoming.rotate(outer, new paper.Point(0, 0)).multiply(half))
  const p2 = b.add(outgoing.rotate(outer, new paper.Point(0, 0)).multiply(half))
  const bisector = incoming.subtract(outgoing).normalize()
  const angle = Math.acos(Math.max(-1, Math.min(1, incoming.dot(outgoing))))
  const miterLength = half / Math.cos(angle / 2)
  if (miterLength > half * 4) return [b, p1, p2]
  const tip = b.add(bisector.multiply(miterLength))
  return [b, p1, tip, p2]
}

/** Path data helper for tests and previews. */
export function resultPathData(result: GeometryResult): string {
  const element = { ...result, rotation: 0 } as VectorElement
  return outlineNodes({ ...element, kind: 'path', vectorNodes: result.vectorNodes } as VectorElement).ranges.map((range) => runPathData(range.nodes, range.closed)).join(' ')
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
