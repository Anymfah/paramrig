import { useEffect, useId, useRef } from 'react'
import { NumberField } from '@/ui/NumberField'

type SliderFieldProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  sliderMin?: number
  sliderMax?: number
  disabled?: boolean
  onChange: (value: number) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onReset?: () => void
  resetDisabled?: boolean
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  sliderMin,
  sliderMax,
  disabled,
  onChange,
  onGestureStart,
  onGestureEnd,
  onReset,
  resetDisabled,
}: SliderFieldProps) {
  const id = useId()
  const trackMin = sliderMin ?? min
  const trackMax = sliderMax ?? max
  const inputRef = useRef<HTMLInputElement>(null)
  const fill = (Math.min(trackMax, Math.max(trackMin, value)) - trackMin) / (trackMax - trackMin || 1)

  useEffect(() => {
    inputRef.current?.style.setProperty('--p', String(fill))
  }, [fill])

  return (
    <div className="slider-field">
      <NumberField
        id={id}
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        disabled={disabled}
        onChange={onChange}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
        onReset={onReset}
        resetDisabled={resetDisabled}
      />
      <input
        ref={inputRef}
        className="slider"
        type="range"
        min={trackMin}
        max={trackMax}
        step={step}
        value={Math.min(trackMax, Math.max(trackMin, value))}
        disabled={disabled}
        aria-label={`${label} slider`}
        aria-valuetext={unit ? `${value}${unit}` : String(value)}
        onPointerDown={onGestureStart}
        onPointerUp={onGestureEnd}
        onPointerCancel={onGestureEnd}
        onLostPointerCapture={onGestureEnd}
        onChange={(event) => onChange(Number(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Home') {
            event.preventDefault()
            onChange(trackMin)
          }
          if (event.key === 'End') {
            event.preventDefault()
            onChange(trackMax)
          }
        }}
      />
    </div>
  )
}
