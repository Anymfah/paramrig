import { elementCorners, elementCenter, type Bounds } from '@/vector/geometry'
import { rotatePoint } from '@/vector/directTransform'
import type { VectorElement, VectorPoint } from '@/vector/types'
import { normalizeWorld, worldNetwork } from '@/vector/network'
import { textProperties } from '@/vector/text'

/** Row-major 2D affine: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function applyAffine(m: Affine, point: VectorPoint): VectorPoint {
  return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f }
}

/** Maps one box onto another (independent x and y scale about the box origin). */
export function boxMap(from: Bounds, to: Bounds): Affine {
  const sx = from.width > 0 ? to.width / from.width : 1
  const sy = from.height > 0 ? to.height / from.height : 1
  return { a: sx, b: 0, c: 0, d: sy, e: to.x - from.x * sx, f: to.y - from.y * sy }
}

export function flipAffine(axis: 'x' | 'y', center: VectorPoint): Affine {
  return axis === 'x'
    ? { a: -1, b: 0, c: 0, d: 1, e: 2 * center.x, f: 0 }
    : { a: 1, b: 0, c: 0, d: -1, e: 0, f: 2 * center.y }
}

export function rotationAffine(degrees: number, center: VectorPoint): Affine {
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { a: cos, b: sin, c: -sin, d: cos, e: center.x - cos * center.x + sin * center.y, f: center.y - sin * center.x - cos * center.y }
}

/**
 * Applies an affine to an element. Paths bake the transform into their nodes (exact, including
 * shear). Primitives keep their box: the centre maps exactly and each local axis keeps its length
 * under the map, so rectangles and ellipses stay rectangles and ellipses.
 */
export function transformElementAffine(element: VectorElement, m: Affine): Partial<VectorElement> {
  if (element.network || element.kind === 'path') {
    const world = worldNetwork(element)
    const mapped = {
      nodes: world.nodes.map((node) => ({ ...node, point: applyAffine(m, node.point) })),
      segments: world.segments.map((segment) => ({ ...segment, ...(segment.ah ? { ah: applyAffine(m, segment.ah) } : {}), ...(segment.bh ? { bh: applyAffine(m, segment.bh) } : {}) })),
    }
    return { ...normalizeWorld(mapped), rotation: 0, kind: 'path' }
  }
  const center = elementCenter(element)
  const radians = element.rotation * Math.PI / 180
  const axisX = { x: Math.cos(radians), y: Math.sin(radians) }
  const axisY = { x: -Math.sin(radians), y: Math.cos(radians) }
  const mappedCenter = applyAffine(m, center)
  const right = applyAffine(m, { x: center.x + axisX.x * element.width / 2, y: center.y + axisX.y * element.width / 2 })
  const bottom = applyAffine(m, { x: center.x + axisY.x * element.height / 2, y: center.y + axisY.y * element.height / 2 })
  const width = Math.max(1, Math.hypot(right.x - mappedCenter.x, right.y - mappedCenter.y) * 2)
  const height = Math.max(1, Math.hypot(bottom.x - mappedCenter.x, bottom.y - mappedCenter.y) * 2)
  const determinant = m.a * m.d - m.b * m.c
  let rotation = Math.atan2(right.y - mappedCenter.y, right.x - mappedCenter.x) * 180 / Math.PI
  // Boxes are symmetric under a half turn, so a mirror reads as the opposite rotation.
  if (determinant < 0) rotation += 180
  const patch: Partial<VectorElement> = {
    x: round(mappedCenter.x - width / 2),
    y: round(mappedCenter.y - height / 2),
    width: round(width),
    height: round(height),
    rotation: round(normalizeDegrees(rotation)),
  }
  if (element.kind === 'text') {
    // Letters follow the box: a text scaled by an affine keeps the same number of lines.
    const scale = Math.sqrt(Math.abs(determinant)) || 1
    if (Math.abs(scale - 1) > 1e-6) {
      const properties = textProperties(element)
      patch.fontSize = round(properties.fontSize * scale)
      if (properties.letterSpacing) patch.letterSpacing = round(properties.letterSpacing * scale)
    }
  }
  if (determinant < 0 && element.kind === 'rectangle' && typeof element.cornerRadius === 'object') {
    const [tl, tr, br, bl] = element.cornerRadius
    patch.cornerRadius = Math.abs(m.a) > Math.abs(m.d) && m.a < 0 ? [tr, tl, bl, br] : [bl, br, tr, tl]
  }
  if (determinant < 0 && element.kind === 'rectangle' && element.strokeSides) {
    const sides = element.strokeSides
    patch.strokeSides = m.a < 0 ? { ...sides, left: sides.right, right: sides.left } : { ...sides, top: sides.bottom, bottom: sides.top }
  }
  return patch
}

/** Corner-based test used by lasso selection. */
export function pointInPolygon(point: VectorPoint, polygon: VectorPoint[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!
    const b = polygon[previous]!
    const crosses = (a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

/** Whether an element is caught by a lasso: its centre or any corner falls inside the polygon. */
export function elementInLasso(element: VectorElement, polygon: VectorPoint[]): boolean {
  if (polygon.length < 3) return false
  if (pointInPolygon(elementCenter(element), polygon)) return true
  return elementCorners(element).some((corner) => pointInPolygon(corner, polygon))
}

function normalizeDegrees(value: number): number {
  let degrees = value % 360
  if (degrees > 180) degrees -= 360
  if (degrees < -180) degrees += 360
  return degrees
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export { rotatePoint }

/** `b` applied after `a`. */
export function composeAffine(a: Affine, b: Affine): Affine {
  return {
    a: b.a * a.a + b.c * a.b,
    b: b.b * a.a + b.d * a.b,
    c: b.a * a.c + b.c * a.d,
    d: b.b * a.c + b.d * a.d,
    e: b.a * a.e + b.c * a.f + b.e,
    f: b.b * a.e + b.d * a.f + b.f,
  }
}

/** Scales about a centre, independently on each axis. */
export function scaleAffine(sx: number, sy: number, center: VectorPoint): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: center.x - sx * center.x, f: center.y - sy * center.y }
}

export function translationAffine(dx: number, dy: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy }
}
