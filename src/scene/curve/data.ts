import { DEFAULT_RESOLUTION, MAX_RESOLUTION, MIN_RESOLUTION, curvePoint } from '@/scene/curve/spline'
import type { CurveData, CurveHandleType, CurvePoint, CurveSpline, TextData, Vec3 } from '@/scene/types'

/**
 * Curve and text data: the defaults, the primitives the Add menu makes, and the reader that turns
 * whatever a file holds into one of them.
 *
 * A document is untrusted the moment it leaves the session that wrote it, so every field is read
 * with a fallback rather than cast. It is the same contract the meshes have, for the same reason:
 * a curve with a NaN handle is a curve that draws nothing and says nothing about why.
 */

export const HANDLE_TYPES: readonly CurveHandleType[] = ['free', 'aligned', 'vector', 'auto']

/** Blender's own: 12 pieces a span, 2D, filled both ways, no depth. */
export const DEFAULT_CURVE: Omit<CurveData, 'splines'> = {
  kind: 'curve',
  dimensions: '2D',
  resolution: DEFAULT_RESOLUTION,
  fill: 'both',
  extrude: 0,
  bevelDepth: 0,
  bevelResolution: 4,
}

export const DEFAULT_TEXT: TextData = {
  kind: 'text',
  body: 'Text',
  font: 'Public Sans',
  size: 1,
  align: 'left',
  spacing: 0,
  lineSpacing: 0,
  extrude: 0,
  bevelDepth: 0,
  bevelResolution: 4,
}

let counter = 0

/** Splines are named within their object, and the id is what a selection holds on to. */
export function splineId(): string {
  counter += 1
  return `spline-${counter}-${Math.random().toString(36).slice(2, 8)}`
}

/* ------------------------------------------------------------- primitives */

/** Blender's Add ▸ Curve ▸ Bézier: two knots, an S laid on the XY plane. */
export function bezierCurveData(): CurveData {
  const points: CurvePoint[] = [
    { co: [-1, 0, 0], left: [-1.5, -0.5, 0], right: [-0.5, 0.5, 0], leftType: 'aligned', rightType: 'aligned' },
    { co: [1, 0, 0], left: [0.5, -0.5, 0], right: [1.5, 0.5, 0], leftType: 'aligned', rightType: 'aligned' },
  ]
  return { ...DEFAULT_CURVE, splines: [{ id: splineId(), kind: 'bezier', cyclic: false, points }] }
}

/**
 * A circle of four knots. The handle length is the one that makes four cubics a circle to within a
 * part in ten thousand: 4/3 × (√2 − 1) of the radius, which is the number every drawing program uses.
 */
export function bezierCircleData(radius = 1): CurveData {
  const reach = radius * (4 / 3) * (Math.SQRT2 - 1)
  const points: CurvePoint[] = [
    { co: [-radius, 0, 0], left: [-radius, -reach, 0], right: [-radius, reach, 0], leftType: 'aligned', rightType: 'aligned' },
    { co: [0, radius, 0], left: [-reach, radius, 0], right: [reach, radius, 0], leftType: 'aligned', rightType: 'aligned' },
    { co: [radius, 0, 0], left: [radius, reach, 0], right: [radius, -reach, 0], leftType: 'aligned', rightType: 'aligned' },
    { co: [0, -radius, 0], left: [reach, -radius, 0], right: [-reach, -radius, 0], leftType: 'aligned', rightType: 'aligned' },
  ]
  return { ...DEFAULT_CURVE, splines: [{ id: splineId(), kind: 'bezier', cyclic: true, points }] }
}

/**
 * Blender's Path is a NURBS of five points; there is no NURBS here, so it is a poly of five, which
 * is what a path is used for — a track to follow — and it evaluates to the same straight run.
 */
export function pathData(): CurveData {
  const points: CurvePoint[] = []
  for (let index = 0; index < 5; index += 1) points.push(curvePoint([index - 2, 0, 0], 0.25, 'vector'))
  return { ...DEFAULT_CURVE, dimensions: '3D', fill: 'none', splines: [{ id: splineId(), kind: 'poly', cyclic: false, points }] }
}

/* -------------------------------------------------------------- sanitising */

function num(value: unknown, fallback: number, min = -1e6, max = 1e6): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function vec3(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return [...fallback]
  return [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])]
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}

/** As many knots as a browser can draw without a person waiting for it. */
const MAX_POINTS = 20_000

export function sanitizeCurvePoint(value: unknown): CurvePoint | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const co = vec3(source.co, [0, 0, 0])
  const point: CurvePoint = {
    co,
    left: vec3(source.left, [co[0] - 0.25, co[1], co[2]]),
    right: vec3(source.right, [co[0] + 0.25, co[1], co[2]]),
    leftType: pick(source.leftType, HANDLE_TYPES, 'aligned'),
    rightType: pick(source.rightType, HANDLE_TYPES, 'aligned'),
  }
  if (source.tilt !== undefined) point.tilt = num(source.tilt, 0, -3600, 3600)
  if (source.radius !== undefined) point.radius = num(source.radius, 1, 0, 100)
  return point
}

export function sanitizeSplines(value: unknown): CurveSpline[] {
  if (!Array.isArray(value)) return []
  const splines: CurveSpline[] = []
  let budget = MAX_POINTS
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>
    const points = Array.isArray(source.points)
      ? source.points.slice(0, budget).map(sanitizeCurvePoint).filter((point): point is CurvePoint => point !== null)
      : []
    if (points.length === 0) continue
    budget -= points.length
    splines.push({
      id: typeof source.id === 'string' && source.id ? source.id.slice(0, 80) : splineId(),
      kind: pick(source.kind, ['bezier', 'poly'] as const, 'bezier'),
      cyclic: source.cyclic === true,
      points,
    })
    if (budget <= 0) break
  }
  return splines
}

export function sanitizeCurveData(value: unknown): CurveData {
  const source = (value ?? {}) as Record<string, unknown>
  return {
    kind: 'curve',
    splines: sanitizeSplines(source.splines),
    dimensions: pick(source.dimensions, ['2D', '3D'] as const, '2D'),
    resolution: Math.round(num(source.resolution, DEFAULT_RESOLUTION, MIN_RESOLUTION, MAX_RESOLUTION)),
    fill: pick(source.fill, ['none', 'front', 'back', 'both'] as const, 'both'),
    extrude: num(source.extrude, 0, 0, 1000),
    bevelDepth: num(source.bevelDepth, 0, 0, 1000),
    bevelResolution: Math.round(num(source.bevelResolution, 4, 0, 15)),
    ...(typeof source.taperObjectId === 'string' && source.taperObjectId ? { taperObjectId: source.taperObjectId.slice(0, 80) } : {}),
  }
}

/** A body long enough for a title and a line of credits, and short enough to stay a curve. */
export const MAX_TEXT_LENGTH = 2000

export function sanitizeTextData(value: unknown): TextData {
  const source = (value ?? {}) as Record<string, unknown>
  return {
    kind: 'text',
    body: typeof source.body === 'string' ? source.body.slice(0, MAX_TEXT_LENGTH) : DEFAULT_TEXT.body,
    font: typeof source.font === 'string' && source.font.trim() ? source.font.trim().slice(0, 80) : DEFAULT_TEXT.font,
    size: num(source.size, 1, 0.001, 1000),
    align: pick(source.align, ['left', 'center', 'right'] as const, 'left'),
    spacing: num(source.spacing, 0, -1, 10),
    lineSpacing: num(source.lineSpacing, 0, -1, 10),
    extrude: num(source.extrude, 0, 0, 1000),
    bevelDepth: num(source.bevelDepth, 0, 0, 1000),
    bevelResolution: Math.round(num(source.bevelResolution, 4, 0, 15)),
  }
}

/* ---------------------------------------------------------------- reading */

/** How many knots a curve carries, which is what the statistics line reports. */
export function curveKnotCount(data: CurveData): number {
  return data.splines.reduce((total, spline) => total + spline.points.length, 0)
}
