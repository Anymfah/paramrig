import paper from 'paper/dist/paper-core'
import { rotatePoint } from '@/vector/directTransform'
import { chains, chainToRun, networkFromRuns, normalizeWorld, worldNetwork, type Run, type RunPoint } from '@/vector/network'
import { computeFaces, loopToRun } from '@/vector/planar'
import { rectangleRun, roundCorners } from '@/vector/corners'
import type { VectorElement, VectorPoint } from '@/vector/types'

export type BooleanOperation = 'unite' | 'subtract' | 'intersect' | 'exclude'

let ready = false
function setup() {
  if (ready) return
  paper.setup(new paper.Size(1, 1))
  ready = true
}

function runToPath(run: Run): paper.Path {
  const path = new paper.Path({ insert: false })
  for (const point of run.points) {
    const handleIn = point.in ?? point.anchor
    const handleOut = point.out ?? point.anchor
    path.add(new paper.Segment(new paper.Point(point.anchor.x, point.anchor.y), new paper.Point(handleIn.x - point.anchor.x, handleIn.y - point.anchor.y), new paper.Point(handleOut.x - point.anchor.x, handleOut.y - point.anchor.y)))
  }
  path.closed = run.closed
  return path
}

/** World-space runs of an element: filled regions (holes included) and stroke chains. */
export function worldRuns(element: VectorElement): { fills: Run[][]; strokes: Run[] } {
  const smoothing = element.cornerSmoothing ?? 0
  if (!element.network && element.kind === 'rectangle') {
    const center = { x: element.x + element.width / 2, y: element.y + element.height / 2 }
    const rotate = (point: VectorPoint) => rotatePoint(point, center, element.rotation)
    const points = rectangleRun(element).map((point): RunPoint => ({ ...point, anchor: rotate(point.anchor), ...(point.in ? { in: rotate(point.in) } : {}), ...(point.out ? { out: rotate(point.out) } : {}) }))
    const run = { points, closed: true }
    return { fills: [[run]], strokes: [run] }
  }
  const world = worldNetwork(element)
  const strokes = chains(world).map((chain) => { const run = chainToRun(world, chain); return { points: roundCorners(run.points, run.closed, smoothing), closed: run.closed } })
  const off = new Set(element.regionsOff ?? [])
  const fills = computeFaces(world).filter((face) => !off.has(face.key)).map((face) => [face.outer, ...face.holes].map((loop) => { const run = loopToRun(world, loop); return { points: roundCorners(run.points, true, smoothing), closed: true } }))
  return { fills, strokes }
}

/** Filled area of an element as one paper item (faces united, holes cut). */
export function toPaperItem(element: VectorElement): paper.PathItem {
  setup()
  const { fills } = worldRuns(element)
  let result: paper.PathItem | null = null
  for (const loops of fills) {
    const [outer, ...holes] = loops
    let face: paper.PathItem = runToPath(outer!)
    for (const hole of holes) {
      const cut = runToPath(hole)
      const next = face.subtract(cut, { insert: false }) as paper.PathItem
      face.remove(); cut.remove(); face = next
    }
    if (!result) result = face
    else {
      const next = result.unite(face, { insert: false }) as paper.PathItem
      result.remove(); face.remove(); result = next
    }
  }
  return result ?? new paper.Path({ insert: false })
}

/** Converts a paper item back to a world-space network. */
export function fromPaperItem(item: paper.PathItem) {
  const paths: paper.Path[] = item instanceof paper.CompoundPath ? (item.children as paper.Path[]) : [item as paper.Path]
  const runs: Run[] = []
  for (const path of paths) {
    if (path.segments.length < 2) continue
    const points: RunPoint[] = path.segments.map((segment) => {
      const anchor = { x: round(segment.point.x), y: round(segment.point.y) }
      const point: RunPoint = { anchor }
      if (!segment.handleIn.isZero()) point.in = { x: round(segment.point.x + segment.handleIn.x), y: round(segment.point.y + segment.handleIn.y) }
      if (!segment.handleOut.isZero()) point.out = { x: round(segment.point.x + segment.handleOut.x), y: round(segment.point.y + segment.handleOut.y) }
      if (point.in && point.out) point.handles = 'independent'
      return point
    })
    runs.push({ points, closed: path.closed })
  }
  return networkFromRuns(runs)
}

export type GeometryResult = Pick<VectorElement, 'x' | 'y' | 'width' | 'height'> & { network: VectorElement['network'] }

function toResult(world: ReturnType<typeof fromPaperItem>): GeometryResult | null {
  if (world.segments.length === 0) return null
  return normalizeWorld(world)
}

/**
 * Cleans a path that crosses itself, which is what a profiled stroke's envelope does wherever the
 * chain turns sharply. Resolving the crossings and re-orienting the result turns the overlaps into
 * one filled shape, instead of the holes the even-odd rule would punch there.
 */
export function resolveSelfIntersections(data: string): string {
  if (!data) return data
  setup()
  const item = new paper.CompoundPath({ pathData: data, insert: false })
  try {
    // `resolveCrossings` exists on every path item at runtime; the shipped typings miss it.
    const resolved = (item as unknown as { resolveCrossings: () => paper.PathItem }).resolveCrossings()
    const oriented = resolved.reorient(true, true) ?? resolved
    const cleaned = oriented.pathData
    return cleaned || data
  } catch {
    // paper gives up on some degenerate input; the raw envelope still paints, just less cleanly.
    return data
  } finally {
    item.remove()
  }
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
  return toResult(converted)
}

/** Replaces the element's network with the union of its filled regions (Flatten). */
export function flattenElement(element: VectorElement): GeometryResult | null {
  setup()
  const item = toPaperItem(element)
  const converted = fromPaperItem(item)
  item.remove()
  return toResult(converted)
}

/**
 * Converts a stroke into filled geometry: each segment is flattened and expanded into quads plus
 * joins and caps, united, then re-fitted. Curves become dense polylines at the given tolerance.
 */
export function outlineStroke(element: VectorElement, tolerance = 0.25): GeometryResult | null {
  if (element.strokeWidth <= 0) return null
  setup()
  const item = toPaperItem(element)
  const paths: paper.Path[] = worldRuns(element).strokes.map(runToPath)
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
  for (const path of paths) path.remove()
  return toResult(converted)
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

function round(value: number): number {
  return Math.round(value * 100) / 100
}
