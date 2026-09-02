import { cubicAt } from '@/vector/network'
import type { Run, RunPoint } from '@/vector/network'
import type { VectorPoint, VectorStrokeCap, VectorStrokeProfile } from '@/vector/types'

/** How finely a curve is walked when the envelope is built, in document units. */
const SAMPLE_STEP = 2
const MIN_SAMPLES = 4
const MAX_SAMPLES = 64

/** A point along a chain, with the direction of travel and how far along the whole run it sits. */
export type Walk = { point: VectorPoint; normal: VectorPoint; t: number }

/** The width factor a profile gives at `t`, straight-line between the points it carries. */
export function profileWidth(profile: VectorStrokeProfile | undefined, t: number): number {
  if (!profile || profile.length === 0) return 1
  const sorted = [...profile].sort((a, b) => a.t - b.t)
  const clamped = Math.min(1, Math.max(0, t))
  if (clamped <= sorted[0]!.t) return Math.max(0, sorted[0]!.width)
  const last = sorted[sorted.length - 1]!
  if (clamped >= last.t) return Math.max(0, last.width)
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index]!
    const to = sorted[index + 1]!
    if (clamped < from.t || clamped > to.t) continue
    const span = to.t - from.t
    const ratio = span <= 0 ? 0 : (clamped - from.t) / span
    return Math.max(0, from.width + (to.width - from.width) * ratio)
  }
  return 1
}

/** Adds a point to a profile, or moves the one already sitting at that position. */
export function setProfilePoint(profile: VectorStrokeProfile | undefined, t: number, width: number, tolerance = 0.02): VectorStrokeProfile {
  const base = profile && profile.length >= 2 ? profile : [{ t: 0, width: 1 }, { t: 1, width: 1 }]
  const clamped = Math.min(1, Math.max(0, t))
  const value = Math.max(0, Math.min(20, width))
  const next = base.filter((point) => Math.abs(point.t - clamped) > tolerance)
  next.push({ t: round(clamped), width: round(value) })
  return next.sort((a, b) => a.t - b.t)
}

/** Removes the profile point nearest `t`, keeping the two ends the profile needs. */
export function removeProfilePoint(profile: VectorStrokeProfile | undefined, t: number, tolerance = 0.05): VectorStrokeProfile | undefined {
  if (!profile || profile.length <= 2) return undefined
  const sorted = [...profile].sort((a, b) => a.t - b.t)
  let best = -1
  let distance = tolerance
  sorted.forEach((point, index) => {
    const gap = Math.abs(point.t - t)
    if (gap <= distance) { distance = gap; best = index }
  })
  if (best < 0) return profile
  const next = sorted.filter((_, index) => index !== best)
  return next.length >= 2 ? next : undefined
}

export function sanitizeStrokeProfile(value: unknown): VectorStrokeProfile | undefined {
  if (!Array.isArray(value)) return undefined
  const points = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as { t?: unknown; width?: unknown }
    if (typeof source.t !== 'number' || !Number.isFinite(source.t)) return []
    if (typeof source.width !== 'number' || !Number.isFinite(source.width)) return []
    return [{ t: round(Math.min(1, Math.max(0, source.t))), width: round(Math.min(20, Math.max(0, source.width))) }]
  }).sort((a, b) => a.t - b.t).slice(0, 64)
  if (points.length < 2) return undefined
  // A profile that says "the width everywhere" is the same as no profile at all.
  return points.every((point) => Math.abs(point.width - 1) < 0.001) ? undefined : points
}

/** Walks a chain at roughly even steps, carrying the normal and the position along the whole run. */
export function walkRun(run: Run): Walk[] {
  const points = run.points
  if (points.length < 2) return []
  const pieces = run.closed ? points.length : points.length - 1
  const raw: Array<{ point: VectorPoint; tangent: VectorPoint }> = []
  for (let index = 0; index < pieces; index += 1) {
    const from = points[index]!
    const to = points[(index + 1) % points.length]!
    const cubic = pieceCubic(from, to)
    const steps = sampleCount(cubic)
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps
      raw.push({ point: cubicAt(cubic, t), tangent: cubicTangent(cubic, t) })
    }
  }
  const last = points[run.closed ? 0 : points.length - 1]!
  const tail = pieceCubic(points[(run.closed ? points.length : points.length - 1) - 1]!, last)
  raw.push({ point: cubicAt(tail, 1), tangent: cubicTangent(tail, 1) })

  const lengths = [0]
  for (let index = 1; index < raw.length; index += 1) {
    const previous = raw[index - 1]!.point
    const current = raw[index]!.point
    lengths.push(lengths[index - 1]! + Math.hypot(current.x - previous.x, current.y - previous.y))
  }
  const total = lengths[lengths.length - 1]!
  return raw.map((entry, index) => {
    const length = Math.hypot(entry.tangent.x, entry.tangent.y) || 1
    return {
      point: entry.point,
      normal: { x: -entry.tangent.y / length, y: entry.tangent.x / length },
      t: total > 0 ? lengths[index]! / total : 0,
    }
  })
}

/**
 * The outline of a profiled stroke along one chain, as fillable path data.
 *
 * An open chain becomes one loop: the left side forward, a cap, the right side back, a cap. A
 * closed chain becomes two loops, outer and inner, which paint as a ring under the even-odd rule
 * the rest of the renderer already uses.
 */
export function envelopePath(run: Run, strokeWidth: number, profile: VectorStrokeProfile | undefined, cap: VectorStrokeCap = 'butt'): string {
  const walk = walkRun(run)
  if (walk.length < 2 || strokeWidth <= 0) return ''
  const half = (entry: Walk) => (strokeWidth * profileWidth(profile, entry.t)) / 2
  const left = walk.map((entry) => ({ x: entry.point.x + entry.normal.x * half(entry), y: entry.point.y + entry.normal.y * half(entry) }))
  const right = walk.map((entry) => ({ x: entry.point.x - entry.normal.x * half(entry), y: entry.point.y - entry.normal.y * half(entry) }))
  if (run.closed) {
    return `${loop(left)} ${loop([...right].reverse())}`
  }
  const start = walk[0]!
  const end = walk[walk.length - 1]!
  const commands = [`M ${format(left[0]!)}`]
  for (let index = 1; index < left.length; index += 1) commands.push(`L ${format(left[index]!)}`)
  commands.push(...capCommands(end, half(end), cap, false, right[right.length - 1]!))
  for (let index = right.length - 2; index >= 0; index -= 1) commands.push(`L ${format(right[index]!)}`)
  commands.push(...capCommands(start, half(start), cap, true, left[0]!))
  commands.push('Z')
  return commands.join(' ')
}

function capCommands(entry: Walk, half: number, cap: VectorStrokeCap, atStart: boolean, target: VectorPoint): string[] {
  if (half <= 0) return [`L ${format(target)}`]
  if (cap === 'round') {
    // One half-turn around the end point, on the side the stroke is heading.
    return [`A ${round(half)} ${round(half)} 0 0 ${atStart ? 1 : 1} ${format(target)}`]
  }
  if (cap === 'square') {
    // The direction of travel, which is the normal turned back a quarter.
    const along = { x: entry.normal.y, y: -entry.normal.x }
    const sign = atStart ? -1 : 1
    const from = atStart ? { x: entry.point.x - entry.normal.x * half, y: entry.point.y - entry.normal.y * half } : { x: entry.point.x + entry.normal.x * half, y: entry.point.y + entry.normal.y * half }
    const a = { x: from.x + along.x * half * sign, y: from.y + along.y * half * sign }
    const b = { x: target.x + along.x * half * sign, y: target.y + along.y * half * sign }
    return [`L ${format(a)}`, `L ${format(b)}`, `L ${format(target)}`]
  }
  return [`L ${format(target)}`]
}

function loop(points: VectorPoint[]): string {
  return `M ${format(points[0]!)} ${points.slice(1).map((point) => `L ${format(point)}`).join(' ')} Z`
}

type Cubic = [VectorPoint, VectorPoint, VectorPoint, VectorPoint]

function pieceCubic(from: RunPoint, to: RunPoint): Cubic {
  return [from.anchor, from.out ?? from.anchor, to.in ?? to.anchor, to.anchor]
}

function cubicTangent(cubic: Cubic, t: number): VectorPoint {
  const [a, b, c, d] = cubic
  const u = 1 - t
  const x = 3 * u * u * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t * t * (d.x - c.x)
  const y = 3 * u * u * (b.y - a.y) + 6 * u * t * (c.y - b.y) + 3 * t * t * (d.y - c.y)
  if (Math.abs(x) > 1e-9 || Math.abs(y) > 1e-9) return { x, y }
  // A degenerate handle leaves no direction; fall back to the chord.
  return { x: cubic[3].x - cubic[0].x, y: cubic[3].y - cubic[0].y }
}

function sampleCount(cubic: Cubic): number {
  const [a, b, c, d] = cubic
  const rough = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(d.x - c.x, d.y - c.y)
  return Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.ceil(rough / SAMPLE_STEP)))
}

function format(point: VectorPoint): string {
  return `${round(point.x)} ${round(point.y)}`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
