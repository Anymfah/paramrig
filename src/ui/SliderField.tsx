import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { NumberField } from '@/ui/NumberField'
import { fineStep, nudgeNumber } from '@/ui/numeric'

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
  onGestureCancel?: () => void
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
  onGestureCancel,
}: SliderFieldProps) {
  const id = useId()
  const trackMin = sliderMin ?? min
  const trackMax = sliderMax ?? max
  const inputRef = useRef<HTMLInputElement>(null)
  const fill = (Math.min(trackMax, Math.max(trackMin, value)) - trackMin) / (trackMax - trackMin || 1)
  const origin = trackMin < 0 && trackMax > 0 ? (0 - trackMin) / (trackMax - trackMin) : null
  const dragging = useRef(false)
  const overflow = value < trackMin ? 'start' : value > trackMax ? 'end' : undefined

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const blockWheel = (event: WheelEvent) => event.preventDefault()
    el.addEventListener('wheel', blockWheel, { passive: false })
    return () => el.removeEventListener('wheel', blockWheel)
  }, [])

  const finish = (cancelled: boolean) => {
    if (!dragging.current) return
    dragging.current = false
    inputRef.current?.removeAttribute('data-scrubbing')
    if (cancelled) onGestureCancel?.()
    else onGestureEnd?.()
  }

  const wrapStyle = {
    '--p': String(fill),
    ...(origin !== null
      ? { '--origin': String(origin), '--fill-start': String(Math.min(origin, fill)), '--fill-span': String(Math.abs(fill - origin)) }
      : {}),
  } as CSSProperties

  return (
    <div className="control control--slider">
      <NumberField
        id={id}
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        variant="slider"
        disabled={disabled}
        onChange={onChange}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
        onGestureCancel={onGestureCancel}
      />
      <div className="slider-wrap" data-overflow={overflow} data-bipolar={origin !== null || undefined} style={wrapStyle}>
        {origin !== null ? <span className="slider__origin" /> : null}
        <span className="slider__track" aria-hidden="true">
          <span className="slider__fill" />
        </span>
        {overflow === 'start' ? <span className="slider__overflow slider__overflow--start" aria-hidden="true" /> : null}
        {overflow === 'end' ? <span className="slider__overflow slider__overflow--end" aria-hidden="true" /> : null}
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
          aria-description="Drag the handle or use the arrow keys. Hold Shift for finer changes. Press Home or End for the limits, and Escape to cancel a drag."
          aria-valuetext={unit ? `${value}${unit}` : String(value)}
          onPointerDown={(event) => {
            dragging.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
            event.currentTarget.setAttribute('data-scrubbing', 'true')
            onGestureStart?.()
          }}
          onPointerUp={() => finish(false)}
          onPointerCancel={() => finish(true)}
          onLostPointerCapture={() => {
            if (dragging.current) finish(true)
          }}
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
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault()
              const increment = event.shiftKey ? fineStep(step) : step
              const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1
              onChange(nudgeNumber(value, direction, { min, max, step: increment }))
            }
            if (event.key === 'Escape' && dragging.current) {
              event.preventDefault()
              finish(true)
            }
          }}
        />
      </div>
    </div>
  )
}
