import { NumberField } from '@/ui/NumberField'
import { clampNumber, snapToStep } from '@/ui/numeric'

type BarFieldProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  /** Display bounds when the track should be narrower than what the value accepts. */
  sliderMin?: number
  sliderMax?: number
  disabled?: boolean
  defaultValue?: number
  mixed?: boolean
  driven?: string
  onChange: (value: number) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onGestureCancel?: () => void
}

/**
 * A measured value on one row: the field is its own track, filled to the value, dragged
 * anywhere in the box. Rig parameters reach it through NumberController's `bar` view; panels
 * that declare their controls by hand use this. Keep SliderField where the track carries
 * something a fill cannot — marks, decades, a colour ramp.
 */
export function BarField({
  label,
  value,
  min,
  max,
  step,
  unit,
  sliderMin,
  sliderMax,
  disabled,
  defaultValue,
  mixed,
  driven,
  onChange,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: BarFieldProps) {
  const lo = sliderMin ?? min
  const hi = sliderMax ?? max
  const span = hi - lo || 1
  return (
    <NumberField
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={unit}
      variant="bar"
      fill={(clampNumber(value, lo, hi) - lo) / span}
      origin={lo < 0 && hi > 0 ? -lo / span : null}
      fromFraction={(fraction) => clampNumber(snapToStep(lo + span * fraction, min, step), min, max)}
      disabled={disabled}
      defaultValue={defaultValue}
      mixed={mixed}
      driven={driven}
      onChange={onChange}
      onGestureStart={onGestureStart}
      onGestureEnd={onGestureEnd}
      onGestureCancel={onGestureCancel}
    />
  )
}
