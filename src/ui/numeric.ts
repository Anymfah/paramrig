export const SCRUB_THRESHOLD_PX = 4
export const SCRUB_PX_PER_STEP = 6
export const SCRUB_PX_PER_STEP_FINE = 20

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
  const rangeStep = (options.max - options.min) / 100
  const scrubStep = options.fine ? options.step : Math.max(options.step, rangeStep)
  const next = origin + (dx / pxPerStep) * scrubStep
  return clampNumber(snapToStep(next, options.min, options.step), options.min, options.max)
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
