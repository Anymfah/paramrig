import { evaluateExpression } from '@/state/expression'
import type { BezierCurve } from '@/rigs/types'

/**
 * What every rig shares, whatever it drives.
 *
 * A binding is a control writing to a property, and the arithmetic between the two is the same
 * whether the property belongs to a drawing or to a scene: clamp it, scale it, offset it, or
 * replace all of that with an expression over the control's value. It lives here rather than in
 * either editor so that the two cannot drift — a rig file written for one has to mean the same
 * thing to the other.
 */

/**
 * How a control reaches a property. A number can be rescaled on the way — `min`/`max` clamp it,
 * `scale` and `offset` map it, and `expression` replaces all of that with arithmetic over the
 * control's value, written as `value`.
 */
export type BindingTransform = {
  min?: number
  max?: number
  scale?: number
  offset?: number
  expression?: string
  /**
   * When both are present, the control is read as 0..1 and mapped onto this range instead of
   * being written through. That is how one macro drives several fields, each with its own span.
   */
  from?: number
  to?: number
  /** Reverse the 0..1 amount before it is mapped. */
  invert?: boolean
  /** How the amount travels from from to to. Linear when omitted. */
  curve?: BezierCurve
}

/**
 * A number put through a binding's transform. Anything that is not finite is left alone: a control
 * that produces a NaN should leave the property where it was rather than erase it.
 */
export function applyTransform(value: number, transform: BindingTransform | undefined, resolve: (id: string) => number): number {
  if (!transform) return value
  let next = value
  if (transform.expression) {
    try {
      next = evaluateExpression(transform.expression, (id) => (id === 'value' ? value : resolve(id)))
    } catch {
      return value
    }
  } else {
    if (typeof transform.scale === 'number') next *= transform.scale
    if (typeof transform.offset === 'number') next += transform.offset
  }
  if (typeof transform.min === 'number') next = Math.max(transform.min, next)
  if (typeof transform.max === 'number') next = Math.min(transform.max, next)
  return Number.isFinite(next) ? next : value
}

/** A control id from what it was called, kept unique against the ones already there. */
export function controlId(label: string, taken: Set<string>): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'control'
  if (!taken.has(base)) return base
  for (let index = 2; index < 500; index += 1) {
    const candidate = `${base}-${index}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

/** The transform of a binding, read from a file that could say anything. */
export function sanitizeTransform(value: unknown): BindingTransform | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const transform: BindingTransform = {}
  for (const key of ['min', 'max', 'scale', 'offset'] as const) {
    const number = source[key]
    if (typeof number === 'number' && Number.isFinite(number)) transform[key] = number
  }
  const expression = source.expression
  if (typeof expression === 'string' && expression.trim()) transform.expression = expression.trim().slice(0, 1000)
  for (const key of ['from', 'to'] as const) {
    const number = source[key]
    if (typeof number === 'number' && Number.isFinite(number)) transform[key] = number
  }
  if (source.invert === true) transform.invert = true
  if (source.curve && typeof source.curve === 'object' && !Array.isArray(source.curve)) {
    const curve = source.curve as Record<string, unknown>
    const ok = (point: unknown) => Array.isArray(point) && point.length >= 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n))
    if (curve.type === 'cubic-bezier' && ok(curve.p0) && ok(curve.p1) && ok(curve.p2) && ok(curve.p3)) {
      transform.curve = curve as unknown as BezierCurve
    }
  }
  return Object.keys(transform).length > 0 ? transform : undefined
}
