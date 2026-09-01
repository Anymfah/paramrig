import type { AnimTrack, BezierCurve, GradientStop, ParamValue } from '@/rigs/types'

export function cloneValue(value: ParamValue): ParamValue {
  return structuredClone(value)
}

export function cloneValues(values: Record<string, ParamValue>): Record<string, ParamValue> {
  return structuredClone(values)
}

export function valuesEqual(a: ParamValue, b: ParamValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function recordsEqual(
  a: Record<string, ParamValue>,
  b: Record<string, ParamValue>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (!valuesEqual(a[key] as ParamValue, b[key] as ParamValue)) return false
  }
  return true
}

export function changedKeys(
  current: Record<string, ParamValue>,
  baseline: Record<string, ParamValue>,
): string[] {
  return Object.keys(current).filter(
    (key) => !valuesEqual(current[key] as ParamValue, baseline[key] as ParamValue),
  )
}

export function isBezier(value: ParamValue): value is BezierCurve {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'cubic-bezier'
}

export function isGradient(value: ParamValue): value is GradientStop[] {
  return Array.isArray(value) && value.length > 0 && value.every(stop =>
    typeof stop === 'object' && stop !== null && 'color' in stop && typeof stop.color === 'string' &&
    't' in stop && typeof stop.t === 'number')
}

export function sampleBezier(curve: BezierCurve, t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  const x = cubic(curve.p0[0], curve.p1[0], curve.p2[0], curve.p3[0], clamped)
  const y = cubic(curve.p0[1], curve.p1[1], curve.p2[1], curve.p3[1], clamped)
  return { x, y }.y
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const mt = 1 - t
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d
}

export function interpolateNumber(track: AnimTrack, time: number, duration: number, loop: boolean): number {
  const frames = [...track.keyframes].sort((a, b) => a.time - b.time)
  if (frames.length === 0) return 0
  const first = frames[0]
  const last = frames[frames.length - 1]
  if (!first || !last) return 0

  let t = time
  if (loop && duration > 0) {
    t = ((time % duration) + duration) % duration
  } else {
    t = Math.min(Math.max(time, 0), duration)
  }

  if (t <= first.time) return first.value
  if (t >= last.time) return last.value

  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i]
    const b = frames[i + 1]
    if (!a || !b) continue
    if (t >= a.time && t <= b.time) {
      if (t === b.time) return b.value
      const easing = a.easing ?? track.interpolation
      if (easing === 'step' || b.time === a.time) return a.value
      const linear = (t - a.time) / (b.time - a.time)
      const u = easing === 'ease-in' ? linear * linear
        : easing === 'ease-out' ? 1 - (1 - linear) ** 2
          : easing === 'ease-in-out' ? linear * linear * (3 - 2 * linear) : linear
      return a.value + (b.value - a.value) * u
    }
  }
  return last.value
}

export function upsertKeyframe(track: AnimTrack, time: number, value: number, tolerance = 0.04): AnimTrack {
  const frames = [...track.keyframes]
  const existing = frames.findIndex((frame) => Math.abs(frame.time - time) <= tolerance)
  if (existing >= 0) {
    frames[existing] = { ...frames[existing], time: frames[existing]?.time ?? time, value }
  } else {
    frames.push({ time, value })
  }
  return {
    ...track,
    keyframes: frames.sort((a, b) => a.time - b.time),
  }
}

export const defaultCurve = (): BezierCurve => ({
  type: 'cubic-bezier',
  p0: [0, 0],
  p1: [0.32, 0],
  p2: [0.36, 1],
  p3: [1, 1],
})
