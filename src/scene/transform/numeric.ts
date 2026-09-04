import type { TransformUnit } from '@/scene/transform/math'
import type { SceneUnits } from '@/scene/types'

/**
 * The number a person types during a transform, and how it reads back.
 *
 * Typing replaces the pointer entirely: from the first digit the session stops listening to the
 * mouse and starts listening to the buffer, which is why the buffer is kept as text rather than as
 * a number — "1/" and "-" are states a value cannot hold, and backspacing out of the buffer has to
 * hand the pointer back exactly where it was.
 *
 * One buffer is kept per axis so that Tab can walk between them and keep what was typed for the one
 * it leaves. Lengths are read in scene units, where a bare number is one unit and the metric
 * suffixes are relative to it; a document whose `units.scale` is not one converts on the way out.
 */

export type NumericEntry = {
  /** One buffer per axis, addressed x, y, z; a single-value mode uses the first alone. */
  fields: [string, string, string]
  /** Which of the session's free axes the keys land in. */
  index: number
  /** False until the first digit; the pointer is in charge while it is false. */
  active: boolean
}

export const EMPTY_NUMERIC_ENTRY: NumericEntry = { fields: ['', '', ''], index: 0, active: false }

const DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

/** The keys the buffer always takes; anything else is the session's or the caller's business. */
export function isNumericKey(key: string): boolean {
  return DIGITS.has(key) || key === '-' || key === '.' || key === '/' || key === 'Backspace' || key === 'Tab'
}

/** The letters already typed after the number, which a unit suffix has to carry on from. */
function unitTail(text: string): string {
  const match = /[a-z\u00b0%]*$/.exec(text.toLowerCase())
  return match ? match[0] : ''
}

/**
 * Whether a letter is the next letter of a unit this buffer could end in.
 *
 * Letters are only swallowed while they still spell a suffix — 'c' then 'm' after a digit is
 * centimetres, 'a' after a digit is nothing and belongs to whoever else wanted the key. Without that
 * test a modal transform would eat the whole alphabet the moment someone typed a number.
 */
export function acceptsUnitKey(text: string, key: string, unit: TransformUnit): boolean {
  if (key.length !== 1 || !/\d/.test(text)) return false
  const candidate = (unitTail(text) + key).toLowerCase()
  return suffixesFor(unit).some(([suffix]) => suffix.startsWith(candidate))
}

function currentTerm(text: string): string {
  const slash = text.lastIndexOf('/')
  return slash === -1 ? text : text.slice(slash + 1)
}

function toggleSign(text: string): string {
  return text.startsWith('-') ? text.slice(1) : `-${text}`
}

function editField(text: string, key: string): string {
  if (DIGITS.has(key)) return text + key
  if (key === '-') return toggleSign(text)
  if (key === '.') return currentTerm(text).includes('.') ? text : `${text}.`
  if (key === '/') return text === '' || text === '-' || text.includes('/') ? text : `${text}/`
  if (key === 'Backspace') return text.slice(0, -1)
  return text
}

/**
 * The entry after one key, or null when the key is not one the buffer wants.
 *
 * Backspace on an empty buffer leaves numeric entry rather than doing nothing: that is how a person
 * changes their mind mid-transform and gets the pointer back without cancelling the session.
 */
export function numericKey(
  entry: NumericEntry,
  key: string,
  fieldCount: number,
  unit: TransformUnit,
): NumericEntry | null {
  const count = Math.max(1, Math.min(3, fieldCount))
  const index = Math.min(entry.index, count - 1)
  if (!isNumericKey(key)) {
    if (!entry.active || !acceptsUnitKey(entry.fields[index] ?? '', key, unit)) return null
    const typed: [string, string, string] = [entry.fields[0], entry.fields[1], entry.fields[2]]
    typed[index] = (typed[index] ?? '') + key
    return { fields: typed, index, active: true }
  }

  if (key === 'Tab') {
    if (!entry.active) return null
    return { ...entry, index: (index + 1) % count }
  }

  const fields: [string, string, string] = [entry.fields[0], entry.fields[1], entry.fields[2]]
  const before = fields[index] ?? ''

  if (key === 'Backspace') {
    if (!entry.active) return null
    if (before === '') return { fields: ['', '', ''], index: 0, active: false }
    fields[index] = editField(before, key)
    return { fields, index, active: true }
  }

  fields[index] = editField(before, key)
  return { fields, index, active: true }
}

/**
 * The entry after one arrow key: the value it holds, a step further on.
 *
 * A transform driven from the keyboard has to be able to say "one metre that way" without typing
 * the digit and without a pointer at all, which is what makes G, R and S reachable for somebody who
 * cannot use a mouse. The buffer becomes a plain number, losing any unit suffix that was typed —
 * the step is in the session's own unit, so the suffix has nothing left to say.
 */
export function numericNudge(entry: NumericEntry, delta: number, fieldCount: number, base = 0): NumericEntry {
  const count = Math.max(1, Math.min(3, fieldCount))
  const index = Math.min(entry.index, count - 1)
  const fields: [string, string, string] = [entry.fields[0], entry.fields[1], entry.fields[2]]
  const typed = Number.parseFloat(fields[index] ?? '')
  const current = entry.active && Number.isFinite(typed) ? typed : base
  // Rounded, because a tenth added to a tenth in binary is 0.30000000000000004 and nobody types that.
  fields[index] = String(Math.round((current + delta) * 1e4) / 1e4)
  return { fields, index, active: true }
}

/** Whether anything at all has been typed, which is one half of "this session changed something". */
export function hasNumericInput(entry: NumericEntry): boolean {
  return entry.active && entry.fields.some((field) => field !== '')
}

const LENGTH_SUFFIXES: Array<[string, number]> = [
  ['km', 1000],
  ['cm', 0.01],
  ['mm', 0.001],
  ['ft', 0.3048],
  ['in', 0.0254],
  ['m', 1],
]

const ANGLE_SUFFIXES: Array<[string, number]> = [
  ['rad', 180 / Math.PI],
  ['deg', 1],
  ['°', 1],
  ['d', 1],
  ['r', 180 / Math.PI],
]

// No 'x' here: during a transform that key is the X axis, and an axis outranks a unit.
const FACTOR_SUFFIXES: Array<[string, number]> = [['%', 0.01]]

function suffixesFor(unit: TransformUnit): Array<[string, number]> {
  if (unit === 'length') return LENGTH_SUFFIXES
  if (unit === 'angle') return ANGLE_SUFFIXES
  return FACTOR_SUFFIXES
}

const NUMBER_PATTERN = /^-?(\d+(\.\d*)?|\.\d+|)$/

function readTerm(text: string): number | null {
  if (!NUMBER_PATTERN.test(text)) return null
  const value = Number.parseFloat(text)
  return Number.isFinite(value) ? value : null
}

/**
 * What a typed buffer is worth, or null while it is not yet worth anything.
 *
 * It is evaluated as it is typed, so "1/" is one and "-" is nothing yet. A single slash is the whole
 * of the arithmetic on purpose: Blender's field accepts expressions, a modal transform does not.
 */
export function evaluateNumericInput(text: string, unit: TransformUnit): number | null {
  const compact = text.replace(/\s+/g, '').toLowerCase()
  if (compact === '') return null

  let body = compact
  let factor = 1
  for (const [suffix, value] of suffixesFor(unit)) {
    if (body.endsWith(suffix) && body.length > suffix.length) {
      body = body.slice(0, -suffix.length)
      factor = value
      break
    }
  }

  const parts = body.split('/')
  if (parts.length > 2) return null
  const numerator = readTerm(parts[0] ?? '')
  if (numerator === null) return null
  if (parts.length === 1) return numerator * factor

  const divisor = parts[1] ?? ''
  // A fraction with nothing after the slash is worth its numerator, so "1/3" counts down as it goes.
  if (divisor === '' || divisor === '-') return numerator * factor
  const denominator = readTerm(divisor)
  if (denominator === null || denominator === 0) return null
  return (numerator / denominator) * factor
}

/** One field's value, or null when that field has not been typed into. */
export function numericValue(entry: NumericEntry, index: number, unit: TransformUnit): number | null {
  return evaluateNumericInput(entry.fields[index] ?? '', unit)
}

/* -------------------------------------------------------------- wording */

/** A number the way the header writes it: four decimals at most, no trailing zeros. */
export function formatNumber(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Number(value.toFixed(decimals))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** What the unit system calls one scene unit. */
export function lengthSuffix(units: SceneUnits): string {
  if (units.system === 'metric') return 'm'
  if (units.system === 'imperial') return 'ft'
  return ''
}

/** A length with its unit, except at zero, where the unit says nothing worth reading. */
export function formatLength(value: number, units: SceneUnits): string {
  const text = formatNumber(value)
  const suffix = lengthSuffix(units)
  if (text === '0' || suffix === '') return text
  return `${text} ${suffix}`
}

export function formatAngle(value: number): string {
  return `${formatNumber(value, 3)}°`
}

export function formatFactor(value: number): string {
  return formatNumber(value, 4)
}
