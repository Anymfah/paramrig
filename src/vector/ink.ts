import { rotatePoint } from '@/vector/directTransform'
import { elementCenter, type Bounds } from '@/vector/geometry'
import { localNetwork, segmentCubic } from '@/vector/network'
import { arcNetwork, arcProperties, isFullEllipse } from '@/vector/shapes'
import type { VectorElement, VectorNetwork, VectorPoint } from '@/vector/types'

/**
 * How much of its own box an element's drawing covers, as fractions of that box. Nearly everything
 * covers all of it — a rectangle, a path and, since they are stretched to their edges, a polygon
 * and a star. A slice cut out of an ellipse does not: a ninety-degree sector lives in a corner of
 * the ellipse's frame, and a selection drawn on the frame would be mostly empty.
 */
export type InkRatio = { x: number; y: number; width: number; height: number }

export const FULL_INK: InkRatio = { x: 0, y: 0, width: 1, height: 1 }

const UNIT = { x: 0, y: 0, width: 1, height: 1 }

export function isFullInk(ratio: InkRatio): boolean {
  return ratio.x < 1e-4 && ratio.y < 1e-4 && ratio.width > 1 - 1e-4 && ratio.height > 1 - 1e-4
}

/** The part of its box an element covers. Only a sliced ellipse covers less than all of it. */
export function inkRatio(element: Pick<VectorElement, 'kind' | 'network' | 'arcStart' | 'arcSweep' | 'arcRatio'>): InkRatio {
  if (element.kind !== 'ellipse' || element.network) return FULL_INK
  const arc = arcProperties(element)
  if (isFullEllipse(arc)) return FULL_INK
  const bounds = networkBounds(arcNetwork(arc))
  return bounds ?? FULL_INK
}

/** The element's ink as a box in its own unrotated frame. */
export function inkBox(element: VectorElement): Bounds {
  const ratio = inkRatio(element)
  return {
    x: element.x + ratio.x * element.width,
    y: element.y + ratio.y * element.height,
    width: Math.max(1e-6, ratio.width * element.width),
    height: Math.max(1e-6, ratio.height * element.height),
  }
}

/** The four corners of that box in document space, the element's rotation applied. */
export function inkCorners(element: VectorElement): VectorPoint[] {
  const box = inkBox(element)
  const center = elementCenter(element)
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ].map((corner) => rotatePoint(corner, center, element.rotation))
}

/** Axis-aligned bounds of what a set of elements draws, rather than of the boxes they live in. */
export function inkSelectionBounds(elements: VectorElement[]): Bounds {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const points = elements.flatMap((element) => inkCorners(element))
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const right = Math.max(...points.map((point) => point.x))
  const bottom = Math.max(...points.map((point) => point.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The box an element needs so its ink lands on `wanted`. Resizing drags the ink — that is what the
 * handles sit on — and the frame behind it follows.
 */
export function boxForInk(element: VectorElement, wanted: Bounds): Bounds {
  const ratio = inkRatio(element)
  if (isFullInk(ratio)) return wanted
  const width = wanted.width / Math.max(1e-6, ratio.width)
  const height = wanted.height / Math.max(1e-6, ratio.height)
  // The two centres sit apart by a fixed offset in the element's own frame, which turns with it.
  const offset = rotatePoint(
    { x: (ratio.x + ratio.width / 2 - 0.5) * width, y: (ratio.y + ratio.height / 2 - 0.5) * height },
    { x: 0, y: 0 },
    element.rotation,
  )
  const center = { x: wanted.x + wanted.width / 2 - offset.x, y: wanted.y + wanted.height / 2 - offset.y }
  return { x: center.x - width / 2, y: center.y - height / 2, width, height }
}

/** Where an element's ink is centred in document space, which is what a rotation should hold. */
export function inkCenter(element: VectorElement): VectorPoint {
  const box = inkBox(element)
  return rotatePoint(elementCenter(box), elementCenter(element), element.rotation)
}

/** Tight bounds of a normalised network, curves included, as fractions of the unit box. */
export function networkBounds(network: VectorNetwork): InkRatio | null {
  const absolute = localNetwork(UNIT, network)
  if (absolute.nodes.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  const see = (point: VectorPoint) => {
    left = Math.min(left, point.x)
    top = Math.min(top, point.y)
    right = Math.max(right, point.x)
    bottom = Math.max(bottom, point.y)
  }
  for (const node of absolute.nodes) see(node.point)
  for (const segment of absolute.segments) {
    const cubic = segmentCubic(absolute, segment)
    for (const t of extrema(cubic.map((point) => point.x) as [number, number, number, number])) see(cubicAt(cubic, t))
    for (const t of extrema(cubic.map((point) => point.y) as [number, number, number, number])) see(cubicAt(cubic, t))
  }
  if (!Number.isFinite(left) || right - left < 1e-6 || bottom - top < 1e-6) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function cubicAt(cubic: VectorPoint[], t: number): VectorPoint {
  const [p0, p1, p2, p3] = cubic as [VectorPoint, VectorPoint, VectorPoint, VectorPoint]
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/** Where one component of a cubic turns around, which is where the curve reaches past its ends. */
function extrema([a, b, c, d]: [number, number, number, number]): number[] {
  const quadA = -a + 3 * b - 3 * c + d
  const quadB = 2 * a - 4 * b + 2 * c
  const quadC = -a + b
  const inside = (t: number) => (t > 1e-6 && t < 1 - 1e-6 ? [t] : [])
  if (Math.abs(quadA) < 1e-9) return Math.abs(quadB) < 1e-9 ? [] : inside(-quadC / quadB)
  const discriminant = quadB * quadB - 4 * quadA * quadC
  if (discriminant < 0) return []
  const root = Math.sqrt(discriminant)
  return [...inside((-quadB + root) / (2 * quadA)), ...inside((-quadB - root) / (2 * quadA))]
}
