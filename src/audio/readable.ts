import type { ParameterDef } from '@/rigs/types'

/**
 * A number as the field means it, not as it is stored.
 *
 * Every time in this instrument is stored in seconds and labelled in milliseconds, because seconds
 * are what the engine does arithmetic in and milliseconds are what anybody reads on an envelope.
 * A control that printed the stored number beside the label said "0.20 ms" for a fifth of a second
 * — a thousandfold lie, and the one place it was heard rather than seen, since the dial's own
 * readout carries no unit at all.
 *
 * The unit a field declares is looked up in the units it offers, and the number is divided by that
 * unit's factor. A field with no units list is already in its own unit and passes straight through.
 */
export function inUnits(param: Extract<ParameterDef, { kind: 'number' }>, value: number): number {
  const unit = param.units?.find((one) => one.value === param.unit)
  return unit && unit.factor ? value / unit.factor : value
}

/** The same number, written the way a control shows it: as many decimals as it is worth. */
export function readable(param: Extract<ParameterDef, { kind: 'number' }>, value: number): string {
  const shown = inUnits(param, value)
  const size = Math.abs(shown)
  if (param.step >= 1 || size >= 100) return shown.toFixed(0)
  if (size >= 10) return shown.toFixed(1)
  return shown.toFixed(2)
}

/** And with its unit after it, for the readout a screen reader speaks. */
export function spoken(param: Extract<ParameterDef, { kind: 'number' }>, value: number): string {
  return `${readable(param, value)}${param.unit ? ` ${param.unit}` : ''}`
}
