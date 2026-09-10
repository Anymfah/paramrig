import { LINEAR } from '@/audio/dsp/curve'
import { parseAudioProperty } from '@/audio/rig'
import { sanitizeTransform } from '@/rigs/binding'
import type { MacroGesture, MacroGestureDestination } from '@/audio/types'

/**
 * A recorded movement of one macro: points on the patch clock, destinations travelling with the
 * take so a later rewiring of the live macro cannot rewrite a take that has already been kept.
 *
 * One take at a time is armed. Several takes may live on the patch; a new recording appends rather
 * than overwriting the last loop.
 */

export const MAX_GESTURE_POINTS = 1024
export const MAX_GESTURES = 16

export function sanitizeGestureDestination(value: unknown): MacroGestureDestination | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (typeof source.property !== 'string') return null
  const path = parseAudioProperty(source.property)
  if (!path || path.spec.type !== 'number' || path.spec.editorOnly) return null
  const from = typeof source.from === 'number' && Number.isFinite(source.from) ? source.from : 0
  const to = typeof source.to === 'number' && Number.isFinite(source.to) ? source.to : 1
  const curve = sanitizeTransform({ curve: source.curve })?.curve ?? LINEAR
  return { property: source.property, from, to, invert: source.invert === true, curve }
}

export function sanitizeGesture(value: unknown): MacroGesture | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim().slice(0, 80) : null
  const macro = typeof source.macro === 'number' && Number.isInteger(source.macro) ? source.macro : -1
  if (!id || macro < 0 || macro > 15) return null
  const start = typeof source.start === 'number' && Number.isFinite(source.start) ? Math.max(0, source.start) : 0
  const duration = typeof source.duration === 'number' && Number.isFinite(source.duration) ? Math.max(0.001, source.duration) : 0.001
  const raw = Array.isArray(source.points) ? source.points : []
  const sorted = raw.slice(0, MAX_GESTURE_POINTS).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const point = entry as Record<string, unknown>
    if (typeof point.t !== 'number' || typeof point.v !== 'number') return []
    if (!Number.isFinite(point.t) || !Number.isFinite(point.v)) return []
    return [{ t: Math.min(1, Math.max(0, point.t)), v: Math.min(1, Math.max(0, point.v)) }]
  }).sort((a, b) => a.t - b.t)
  const points = sorted.filter((point, index) => point.t !== sorted[index + 1]?.t)
  if (points.length < 2) return null
  const destinations = (Array.isArray(source.destinations) ? source.destinations : [])
    .flatMap((entry) => {
      const dest = sanitizeGestureDestination(entry)
      return dest ? [dest] : []
    })
  return {
    id,
    macro,
    enabled: source.enabled !== false,
    start,
    duration,
    points,
    destinations,
  }
}

export function sanitizeGestures(value: unknown): MacroGesture[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_GESTURES * 2).flatMap((entry) => {
    const gesture = sanitizeGesture(entry)
    return gesture ? [gesture] : []
  }).slice(0, MAX_GESTURES)
}

/** The macro amount at a moment of the patch clock, or null when this take is not speaking. */
export function gestureAt(gesture: MacroGesture, clock: number): number | null {
  if (!gesture.enabled || gesture.duration <= 0) return null
  const local = (clock - gesture.start) / gesture.duration
  if (local < 0 || local > 1) return null
  const points = gesture.points
  if (points.length === 0) return null
  if (local <= points[0]!.t) return points[0]!.v
  if (local >= points[points.length - 1]!.t) return points[points.length - 1]!.v
  let lo = points[0]!
  let hi = points[points.length - 1]!
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    if (local >= a.t && local <= b.t) {
      lo = a
      hi = b
      break
    }
  }
  const span = hi.t - lo.t
  const mix = span > 0 ? (local - lo.t) / span : 0
  return lo.v + (hi.v - lo.v) * mix
}

/**
 * Thin a take without flattening the moves that made it worth keeping.
 *
 * Fast changes, the first point and the last point stay. A run of points that sit on a straight
 * line is reduced to its ends. Sixteen values is a performer row, and a recorded gesture is not
 * one of those.
 */
export function simplifyGesture(points: { t: number; v: number }[], tolerance = 0.012): { t: number; v: number }[] {
  if (points.length <= 4) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const pair = stack.pop()
    if (!pair) break
    const start = pair[0]
    const end = pair[1]
    const a = points[start]
    const b = points[end]
    if (!a || !b) continue
    let worst = 0
    let at = -1
    const span = b.t - a.t
    for (let i = start + 1; i < end; i += 1) {
      const p = points[i]!
      const mix = span > 0 ? (p.t - a.t) / span : 0
      const expected = a.v + (b.v - a.v) * mix
      const err = Math.abs(p.v - expected)
      if (err > worst) {
        worst = err
        at = i
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = true
      stack.push([start, at], [at, end])
    }
  }
  return points.filter((_, index) => keep[index])
}

/** Capture points at audio-rate timestamps, then simplify. `times` and `values` are parallel. */
export function takeFromSamples(times: number[], values: number[], start: number, duration: number): { t: number; v: number }[] {
  const points: { t: number; v: number }[] = []
  const span = Math.max(0.001, duration)
  for (let i = 0; i < times.length; i += 1) {
    const t = (times[i]! - start) / span
    if (t < 0 || t > 1) continue
    points.push({ t, v: Math.min(1, Math.max(0, values[i] ?? 0)) })
  }
  if (points.length === 0) return [{ t: 0, v: 0 }, { t: 1, v: 0 }]
  if (points[0]!.t > 0) points.unshift({ t: 0, v: points[0]!.v })
  if (points[points.length - 1]!.t < 1) points.push({ t: 1, v: points[points.length - 1]!.v })
  return simplifyGesture(points)
}
