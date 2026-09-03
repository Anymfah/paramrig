export const SCRUB_THRESHOLD_PX = 4
export const SCRUB_PX_PER_STEP = 6
export const SCRUB_PX_PER_STEP_FINE = 20
/** How much slower a held Shift makes a gauge drag. */
export const SCRUB_FINE_DIVISOR = 8

export function formatNumber(value: number, step: number): string {
  const rawDecimals = String(step).split('.')[1]?.length ?? 0
  const decimals = step >= 1 ? 0 : rawDecimals > 8 || String(step).includes('e') ? Math.min(8, Math.ceil(-Math.log10(step)) + 1) : rawDecimals
  return value.toFixed(decimals)
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function snapToStep(value: number, min: number, step: number): number {
  if (step <= 0) return value
  const steps = Math.round((value - min) / step)
  const snapped = min + steps * step
  const decimals = step >= 1 ? 0 : Math.min(12, String(step).split('.')[1]?.length ?? 8)
  return Number(snapped.toFixed(decimals))
}

export function parseNumberInput(raw: string, min: number, max: number, step: number): number | null {
  const next = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(next)) return null
  return clampNumber(snapToStep(next, min, step), min, max)
}

export function isIntegerStep(step: number): boolean {
  return step >= 1 && Number.isInteger(step)
}

/** Discrete counts (Lobes, Layers, Seed) keep steppers; measured values keep sliders. */
export function usesStepper(param: {
  step: number
  unit?: string
  sliderMin?: number
  sliderMax?: number
}): boolean {
  return isIntegerStep(param.step) && !param.unit && param.sliderMin === undefined && param.sliderMax === undefined
}

export function applyScrub(
  origin: number,
  dx: number,
  options: { min: number; max: number; step: number; fine: boolean },
): number {
  const pxPerStep = options.fine ? SCRUB_PX_PER_STEP_FINE : SCRUB_PX_PER_STEP
  /*
   * A bounded value scrubs by a hundredth of its range, so one sweep of the field crosses it. A
   * value whose bounds are only there to stop an infinity — a world coordinate runs to ±1e6 —
   * has no range worth crossing, and a hundredth of it would send the object out of the scene on
   * the first pixel. Past ten thousand steps the range stops meaning anything, and the step wins.
   */
  const span = options.max - options.min
  const bounded = Number.isFinite(span) && options.step > 0 && span / options.step <= 10_000
  const rangeStep = bounded ? span / 100 : options.step
  const scrubStep = options.fine ? options.step : Math.max(options.step, rangeStep)
  const next = origin + (dx / pxPerStep) * scrubStep
  return clampNumber(snapToStep(next, options.min, options.step), options.min, options.max)
}

/**
 * A gauge follows the pointer: crossing the box crosses the whole track, so the filled
 * edge stays where the hand put it. Shift slows the hand down, it does not change the map.
 */
export function trackFraction(origin: number, dx: number, width: number, fine: boolean): number {
  if (!(width > 0)) return clampNumber(origin, 0, 1)
  return clampNumber(origin + dx / width / (fine ? SCRUB_FINE_DIVISOR : 1), 0, 1)
}

export function fineStep(step: number): number {
  if (step <= 0) return 0.01
  const next = step / 10
  return next >= 1 ? Math.round(next) : Number(next.toFixed(8))
}

export function nudgeNumber(
  value: number,
  direction: 1 | -1,
  options: { min: number; max: number; step: number },
): number {
  return clampNumber(snapToStep(value + direction * options.step, options.min, options.step), options.min, options.max)
}

/**
 * A field accepts arithmetic, not just a number: `32*2`, `(100-8)/3`, `2^3`, `50%` of the range,
 * `+=10` relative to the current value, and a trailing unit the field knows (`2rem`).
 */
export type UnitOption = { value: string; label: string; factor?: number }

export function evaluateExpression(source: string): number | null {
  const src = source.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
  if (!src) return null
  let i = 0
  const peek = () => src[i]
  const number = (): number | null => {
    const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))
    if (!match) return null
    i += match[0].length
    return Number(match[0])
  }
  const factor = (): number | null => {
    if (peek() === '-') { i++; const v = factor(); return v === null ? null : -v }
    if (peek() === '+') { i++; return factor() }
    if (peek() === '(') {
      i++
      const v = expression()
      if (v === null || peek() !== ')') return null
      i++
      return v
    }
    return number()
  }
  const power = (): number | null => {
    let base = factor()
    if (base === null) return null
    while (peek() === '^') {
      i++
      const exponent = factor()
      if (exponent === null) return null
      base = Math.pow(base, exponent)
    }
    return base
  }
  const term = (): number | null => {
    let left = power()
    if (left === null) return null
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = src[i++]
      const right = power()
      if (right === null) return null
      left = op === '*' ? left * right : op === '/' ? left / right : left % right
    }
    return left
  }
  const expression = (): number | null => {
    let left = term()
    if (left === null) return null
    while (peek() === '+' || peek() === '-') {
      const op = src[i++]
      const right = term()
      if (right === null) return null
      left = op === '+' ? left + right : left - right
    }
    return left
  }
  const result = expression()
  if (result === null || i !== src.length || !Number.isFinite(result)) return null
  return result
}

/*
 * The units a field understands without being told about them. A field measured in metres takes
 * `40cm`, one measured in degrees takes `0.5turn`: the conversion is a fact about the units and
 * not about the field, so it does not have to be declared parameter by parameter.
 */
const UNIT_FAMILIES: Array<Record<string, number>> = [
  { m: 1, cm: 0.01, mm: 0.001, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144 },
  { '°': 1, deg: 1, degrees: 1, rad: 180 / Math.PI, turn: 360 },
  { s: 1, ms: 0.001, min: 60 },
]

/** How many of `unit` one `suffix` is, when the two are the same kind of measurement. */
function convertUnit(suffix: string, unit: string | undefined): number | null {
  if (!unit) return null
  const from = suffix.toLowerCase()
  const to = unit.toLowerCase()
  if (from === to) return 1
  for (const family of UNIT_FAMILIES) {
    const a = family[from]
    const b = family[to]
    if (a !== undefined && b !== undefined) return a / b
  }
  return null
}

export function evaluateNumberInput(
  raw: string,
  current: number,
  options: { min: number; max: number; step: number; unit?: string; units?: UnitOption[] },
): number | null {
  let text = raw.trim()
  if (text === '') return null
  let relative: 1 | -1 | 0 = 0
  if (text.startsWith('+=')) { relative = 1; text = text.slice(2) }
  else if (text.startsWith('-=')) { relative = -1; text = text.slice(2) }
  let scale = 1
  const percent = /%$/.test(text) && !/[-+*/^(]/.test(text)
  if (percent) {
    text = text.slice(0, -1)
    const span = options.max - options.min
    if (Number.isFinite(span) && span > 0 && span !== 100) scale = span / 100
  } else {
    const suffix = /([a-z°%]+)$/i.exec(text)?.[1]
    if (suffix) {
      const known = options.units?.find((item) => item.value.toLowerCase() === suffix.toLowerCase())
      const currentUnit = options.units?.find((item) => item.value === options.unit)
      const converted = convertUnit(suffix, options.unit)
      if (known && known.factor && currentUnit?.factor) scale = known.factor / currentUnit.factor
      else if (converted !== null) scale = converted
      else if (suffix.toLowerCase() !== (options.unit ?? '').toLowerCase()) return null
      text = text.slice(0, -suffix.length)
    }
  }
  const evaluated = evaluateExpression(text)
  if (evaluated === null) return null
  const absolute = relative === 0 ? evaluated * scale + (percent && scale !== 1 ? options.min : 0) : current + relative * evaluated * scale
  return clampNumber(snapToStep(absolute, options.min, options.step), options.min, options.max)
}
