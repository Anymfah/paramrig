import { rotatePoint } from '@/vector/directTransform'
import { elementCenter } from '@/vector/geometry'
import type { VectorElement, VectorNetwork, VectorPoint } from '@/vector/types'

type Point = VectorPoint

/** Polygons and stars: how many sides, and how far in the inner points sit (0 = plain polygon). */
export const MIN_SIDES = 3
export const MAX_SIDES = 60
export const DEFAULT_SIDES = 5
export const DEFAULT_INNER_RATIO = 0

export type PolygonProperties = { sides: number; innerRatio: number }

export function polygonProperties(element: Partial<VectorElement>): PolygonProperties {
  const sides = typeof element.sides === 'number' && Number.isFinite(element.sides)
    ? Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(element.sides)))
    : DEFAULT_SIDES
  const innerRatio = typeof element.innerRatio === 'number' && Number.isFinite(element.innerRatio)
    ? Math.min(1, Math.max(0, element.innerRatio))
    : DEFAULT_INNER_RATIO
  return { sides, innerRatio }
}

/** Arcs and rings carved out of an ellipse: where the sweep starts, how far it goes, and the hole. */
export type ArcProperties = { start: number; sweep: number; ratio: number }

export function arcProperties(element: Partial<VectorElement>): ArcProperties {
  const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const sweep = Math.min(360, Math.max(-360, number(element.arcSweep, 360)))
  return {
    start: normalizeAngle(number(element.arcStart, 0)),
    sweep,
    ratio: Math.min(0.99, Math.max(0, number(element.arcRatio, 0))),
  }
}

/** Whether an ellipse's arc settings still describe the whole ellipse. */
export function isFullEllipse(properties: ArcProperties): boolean {
  return Math.abs(Math.abs(properties.sweep) - 360) < 1e-6 && properties.ratio <= 0
}

export function normalizeAngle(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/** Point on the unit box's inscribed ellipse: 0° is the right edge, 90° the top. */
export function anglePoint(degrees: number, radius = 0.5): VectorPoint {
  const radians = (degrees * Math.PI) / 180
  return { x: 0.5 + Math.cos(radians) * radius, y: 0.5 - Math.sin(radians) * radius }
}

/**
 * Regular polygon, or a star when `innerRatio` is above zero: the first point sits at the top and
 * the rest follow counter-clockwise, in normalised box coordinates.
 */
export function polygonNetwork({ sides, innerRatio }: PolygonProperties): VectorNetwork {
  const points: VectorPoint[] = []
  const step = 360 / sides
  for (let index = 0; index < sides; index += 1) {
    points.push(anglePoint(90 + index * step))
    if (innerRatio > 0) points.push(anglePoint(90 + index * step + step / 2, innerRatio * 0.5))
  }
  return {
    nodes: points.map((point, index) => ({ id: `p${index}`, x: round(point.x), y: round(point.y) })),
    segments: points.map((_, index) => ({ id: `e${index}`, a: `p${index}`, b: `p${(index + 1) % points.length}` })),
  }
}

/**
 * The outline of a polygon or a star laid into a box, as path data. The canvas draws this while a
 * shape is being dragged out, so what is under the pointer is the shape and not a stand-in box.
 */
export function polygonPathData(bounds: { x: number; y: number; width: number; height: number }, properties: PolygonProperties): string {
  const { nodes } = polygonNetwork(properties)
  if (nodes.length === 0) return ''
  const at = (node: { x: number; y: number }) => `${round(bounds.x + node.x * bounds.width)} ${round(bounds.y + node.y * bounds.height)}`
  return `M ${at(nodes[0]!)} ${nodes.slice(1).map((node) => `L ${at(node)}`).join(' ')} Z`
}

/**
 * Sector, ring or ring segment carved out of the inscribed ellipse. A full sweep with no hole is
 * the ellipse itself; a full sweep with a hole is two separate rings.
 */
export function arcNetwork(properties: ArcProperties): VectorNetwork {
  const { start, sweep, ratio } = properties
  const full = Math.abs(Math.abs(sweep) - 360) < 1e-6
  if (full && ratio <= 0) return ringNetwork(0.5, 'o')
  if (full) return mergeNetworks(ringNetwork(0.5, 'o'), ringNetwork(ratio * 0.5, 'i'))
  const outer = arcPoints(start, sweep, 0.5)
  const inner = ratio > 0 ? arcPoints(start + sweep, -sweep, ratio * 0.5) : null
  const nodes: VectorNetwork['nodes'] = []
  const segments: VectorNetwork['segments'] = []
  const push = (arc: ArcPiece[], prefix: string) => {
    arc.forEach((piece, index) => {
      if (index === 0) nodes.push({ id: `${prefix}${index}`, x: round(piece.from.x), y: round(piece.from.y) })
      nodes.push({ id: `${prefix}${index + 1}`, x: round(piece.to.x), y: round(piece.to.y) })
      segments.push({
        id: `${prefix}s${index}`,
        a: `${prefix}${index}`,
        b: `${prefix}${index + 1}`,
        ah: round2(piece.ah),
        bh: round2(piece.bh),
      })
    })
  }
  push(outer, 'o')
  if (inner) {
    push(inner, 'i')
    // Ring segment: the two arcs are joined by their straight ends.
    segments.push({ id: 'join0', a: `o${outer.length}`, b: 'i0' })
    segments.push({ id: 'join1', a: `i${inner.length}`, b: 'o0' })
  } else {
    // Sector: both ends meet at the centre.
    nodes.push({ id: 'c', x: 0.5, y: 0.5 })
    segments.push({ id: 'join0', a: `o${outer.length}`, b: 'c' })
    segments.push({ id: 'join1', a: 'c', b: 'o0' })
  }
  return { nodes, segments }
}

type ArcPiece = { from: VectorPoint; to: VectorPoint; ah: VectorPoint; bh: VectorPoint }

/** Splits an arc into pieces of at most ninety degrees, each an exact cubic approximation. */
function arcPieces(start: number, sweep: number, radius: number): ArcPiece[] {
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / 90))
  const step = sweep / count
  const kappa = (4 / 3) * Math.tan((step * Math.PI) / 180 / 4)
  const pieces: ArcPiece[] = []
  for (let index = 0; index < count; index += 1) {
    const from = start + step * index
    const to = from + step
    // The tangent points the way the sweep goes; y grows downward, hence the sign on the sine.
    const tangent = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180
      return { x: -Math.sin(radians) * radius * kappa, y: -Math.cos(radians) * radius * kappa }
    }
    const forward = tangent(from)
    const backward = tangent(to)
    pieces.push({
      from: anglePoint(from, radius),
      to: anglePoint(to, radius),
      ah: forward,
      bh: { x: -backward.x, y: -backward.y },
    })
  }
  return pieces
}

function arcPoints(start: number, sweep: number, radius: number): ArcPiece[] {
  return arcPieces(start, sweep, radius)
}

/** A closed ring of four quarter arcs at the given radius. */
function ringNetwork(radius: number, prefix: string): VectorNetwork {
  const pieces = arcPieces(0, 360, radius)
  const nodes = pieces.map((piece, index) => ({ id: `${prefix}${index}`, x: round(piece.from.x), y: round(piece.from.y), handles: 'mirrored' as const }))
  const segments = pieces.map((piece, index) => ({
    id: `${prefix}s${index}`,
    a: `${prefix}${index}`,
    b: `${prefix}${(index + 1) % pieces.length}`,
    ah: round2(piece.ah),
    bh: round2(piece.bh),
  }))
  return { nodes, segments }
}

function mergeNetworks(first: VectorNetwork, second: VectorNetwork): VectorNetwork {
  return { nodes: [...first.nodes, ...second.nodes], segments: [...first.segments, ...second.segments] }
}

/** Straight two-node run for the line tool, in normalised box coordinates. */
export function lineNetwork(): VectorNetwork {
  return { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }], segments: [{ id: 's', a: 'a', b: 'b' }] }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function round2(point: VectorPoint): VectorPoint {
  return { x: round(point.x), y: round(point.y) }
}

export type ShapeHandle = 'polygon-sides' | 'polygon-ratio' | 'arc-start' | 'arc-end' | 'arc-ratio'

/** Local (unrotated) coordinates of a world point, relative to the element's box. */
export function localPoint(element: VectorElement, point: Point): Point {
  const center = elementCenter(element)
  return element.rotation ? rotatePoint(point, center, -element.rotation) : point
}

/** Angle of a world point around the element's centre, zero to the right and ninety at the top. */
function shapeAngle(element: VectorElement, point: Point): number {
  const local = localPoint(element, point)
  const center = elementCenter(element)
  return normalizeAngle((Math.atan2(-(local.y - center.y), local.x - center.x) * 180) / Math.PI)
}

/** How far out a world point sits, as a fraction of the element's own radius. */
function shapeRadius(element: VectorElement, point: Point): number {
  const local = localPoint(element, point)
  const center = elementCenter(element)
  const dx = (local.x - center.x) / Math.max(1e-6, element.width / 2)
  const dy = (local.y - center.y) / Math.max(1e-6, element.height / 2)
  return Math.min(1, Math.hypot(dx, dy))
}

/** World position of a point given in the element's normalised box. */
export function shapePoint(element: VectorElement, normalized: Point): Point {
  const local = { x: element.x + normalized.x * element.width, y: element.y + normalized.y * element.height }
  return element.rotation ? rotatePoint(local, elementCenter(element), element.rotation) : local
}

const SIDES_PER_PIXEL = 14

/** What dragging a shape handle does to the element it belongs to. */
export function shapePatch(element: VectorElement, handle: ShapeHandle, at: Point, start: Point, zoom: number): Partial<VectorElement> {
  if (handle === 'polygon-sides') {
    const { sides } = polygonProperties(element)
    const steps = Math.round(((at.x - start.x) * zoom) / SIDES_PER_PIXEL)
    return { sides: Math.min(MAX_SIDES, Math.max(MIN_SIDES, sides + steps)) }
  }
  if (handle === 'polygon-ratio') {
    return { innerRatio: Math.min(1, Math.max(0, shapeRadius(element, at))) }
  }
  const arc = arcProperties(element)
  if (handle === 'arc-ratio') return { arcStart: arc.start, arcSweep: arc.sweep, arcRatio: Math.min(0.99, shapeRadius(element, at)) }
  const angle = shapeAngle(element, at)
  if (handle === 'arc-start') {
    const end = arc.start + arc.sweep
    return { arcStart: angle, arcSweep: clampSweep(end - angle), arcRatio: arc.ratio }
  }
  // Dragging the end keeps the start put; a full ellipse opens counter-clockwise from it.
  return { arcStart: arc.start, arcSweep: clampSweep(angle - arc.start || 360), arcRatio: arc.ratio }
}

function clampSweep(value: number): number {
  const wrapped = ((value % 360) + 360) % 360
  return wrapped === 0 ? 360 : wrapped
}

/** What the read-out shows while a shape handle is dragged. */
export function shapeHudLabel(element: VectorElement, handle: ShapeHandle, at: Point, start: Point, zoom: number): string {
  const patch = shapePatch(element, handle, at, start, zoom)
  if (handle === 'polygon-sides') return `${patch.sides} sides`
  if (handle === 'polygon-ratio') return `${Math.round((patch.innerRatio ?? 0) * 100)}%`
  if (handle === 'arc-ratio') return `${Math.round((patch.arcRatio ?? 0) * 100)}%`
  return `${Math.round(patch.arcStart ?? 0)}° · ${Math.round(patch.arcSweep ?? 0)}°`
}

/** How far in a star's inner points sit when the shape tool draws one. */
export const STAR_INNER_RATIO = 0.45
