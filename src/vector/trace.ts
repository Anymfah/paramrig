import { fitSmoothNodes, simplifyPolyline } from '@/vector/pencil'
import type { VectorPoint, VectorTraceOptions } from '@/vector/types'

export const MAX_TRACE_COLORS = 8
export const MIN_TRACE_COLORS = 2
/** The preview runs on a reduced copy; the full trace runs on the picture as it is. */
export const PREVIEW_SIDE = 512

export const DEFAULT_TRACE: VectorTraceOptions = {
  mode: 'silhouette',
  colors: 4,
  threshold: 0.5,
  smoothing: 0.5,
  minArea: 24,
}

export function sanitizeTraceOptions(value: unknown): VectorTraceOptions {
  if (!value || typeof value !== 'object') return { ...DEFAULT_TRACE }
  const source = value as Partial<VectorTraceOptions>
  const number = (input: unknown, fallback: number, min: number, max: number) =>
    typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(min, input)) : fallback
  return {
    mode: source.mode === 'colors' ? 'colors' : 'silhouette',
    colors: Math.round(number(source.colors, DEFAULT_TRACE.colors, MIN_TRACE_COLORS, MAX_TRACE_COLORS)),
    threshold: number(source.threshold, DEFAULT_TRACE.threshold, 0, 1),
    smoothing: number(source.smoothing, DEFAULT_TRACE.smoothing, 0, 1),
    minArea: number(source.minArea, DEFAULT_TRACE.minArea, 0, 10000),
  }
}

/** One traced layer: the colour it is painted with, and the loops that make it up. */
export type TraceLayer = { color: string; loops: VectorPoint[][] }

/** Luminance, 0 to 1, the way every eye-weighted formula does it. */
export function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Traces a bitmap into closed loops.
 *
 * A silhouette is one threshold on the luminance. Colours are bands of luminance, nested: each
 * layer covers everything darker than its own edge, so the layers stack back to front and the
 * darkest sits on top. Both go through marching squares, which walks the boundary between the
 * pixels that pass and those that do not, and closes it into loops — holes included, since a hole
 * is just another crossing of the same level.
 */
export function traceBitmap(pixels: Uint8ClampedArray, width: number, height: number, options: VectorTraceOptions): TraceLayer[] {
  if (width < 2 || height < 2) return []
  const levels = options.mode === 'silhouette' ? 1 : Math.max(1, options.colors - 1)
  const layers: TraceLayer[] = []
  for (let level = levels; level >= 1; level -= 1) {
    const edge = options.mode === 'silhouette'
      ? options.threshold
      : (level / (levels + 1)) * (options.threshold * 2)
    const mask = maskBelow(pixels, width, height, edge)
    const loops = marchingSquares(mask, width, height)
      .map((loop) => refine(loop, options))
      .filter((loop) => loop.length >= 3 && Math.abs(polygonArea(loop)) >= options.minArea)
    if (loops.length === 0) continue
    layers.push({ color: averageColor(pixels, mask), loops })
  }
  return layers
}

/** Pixels darker than the level, as a flat 0/1 mask. */
function maskBelow(pixels: Uint8ClampedArray, width: number, height: number, level: number): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    const alpha = pixels[offset + 3] ?? 255
    // A transparent pixel is not part of the shape, whatever colour it claims to be.
    if (alpha < 128) continue
    const value = luminance(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0)
    mask[index] = value <= level ? 1 : 0
  }
  return mask
}

function averageColor(pixels: Uint8ClampedArray, mask: Uint8Array): string {
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue
    const offset = index * 4
    r += pixels[offset] ?? 0
    g += pixels[offset + 1] ?? 0
    b += pixels[offset + 2] ?? 0
    count += 1
  }
  if (count === 0) return '#000000'
  const channel = (total: number) => Math.round(total / count).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

type Segment = { from: string; to: string; a: VectorPoint; b: VectorPoint }

/**
 * Marching squares over the mask: every cell contributes the piece of boundary that crosses it,
 * and the pieces are chained end to end into closed loops. Endpoints land on exact half-pixels,
 * so they can be matched by key rather than by distance.
 */
export function marchingSquares(mask: Uint8Array, width: number, height: number): VectorPoint[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x] ?? 0)
  const segments: Segment[] = []
  const push = (a: VectorPoint, b: VectorPoint) => segments.push({ from: key(a), to: key(b), a, b })
  // The grid runs one cell past the picture on each side, so a shape touching the edge still closes.
  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      const tl = at(x, y)
      const tr = at(x + 1, y)
      const br = at(x + 1, y + 1)
      const bl = at(x, y + 1)
      const index = tl * 8 + tr * 4 + br * 2 + bl
      if (index === 0 || index === 15) continue
      const top = { x: x + 0.5, y }
      const right = { x: x + 1, y: y + 0.5 }
      const bottom = { x: x + 0.5, y: y + 1 }
      const left = { x, y: y + 0.5 }
      switch (index) {
        case 1: push(left, bottom); break
        case 2: push(bottom, right); break
        case 3: push(left, right); break
        case 4: push(right, top); break
        case 5: push(left, top); push(right, bottom); break
        case 6: push(bottom, top); break
        case 7: push(left, top); break
        case 8: push(top, left); break
        case 9: push(top, bottom); break
        case 10: push(top, right); push(bottom, left); break
        case 11: push(top, right); break
        case 12: push(right, left); break
        case 13: push(right, bottom); break
        case 14: push(bottom, left); break
        default: break
      }
    }
  }
  return chain(segments)
}

function chain(segments: Segment[]): VectorPoint[][] {
  const byStart = new Map<string, Segment[]>()
  for (const segment of segments) {
    const list = byStart.get(segment.from)
    if (list) list.push(segment)
    else byStart.set(segment.from, [segment])
  }
  const used = new Set<Segment>()
  const loops: VectorPoint[][] = []
  for (const segment of segments) {
    if (used.has(segment)) continue
    const loop: VectorPoint[] = [segment.a]
    let current: Segment = segment
    for (;;) {
      used.add(current)
      loop.push(current.b)
      const next: Segment | undefined = byStart.get(current.to)?.find((candidate) => !used.has(candidate))
      if (!next) break
      current = next
      if (current.from === segment.from) break
    }
    if (loop.length >= 4) loops.push(loop)
  }
  return loops
}

/** Simplifies and rounds a traced loop, by however much smoothing was asked for. */
function refine(loop: VectorPoint[], options: VectorTraceOptions): VectorPoint[] {
  const tolerance = 0.4 + options.smoothing * 2.5
  const simplified = simplifyPolyline(loop, tolerance)
  return simplified.length >= 3 ? simplified : loop
}

/** The nodes of a traced loop, rounded when smoothing asks for it. */
export function loopNodes(loop: VectorPoint[], smoothing: number) {
  return smoothing > 0 ? fitSmoothNodes(loop, true, 70) : loop.map((point) => ({ anchor: point }))
}

export function polygonArea(points: VectorPoint[]): number {
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    total += a.x * b.y - b.x * a.y
  }
  return total / 2
}

function key(point: VectorPoint): string {
  return `${Math.round(point.x * 2)},${Math.round(point.y * 2)}`
}
