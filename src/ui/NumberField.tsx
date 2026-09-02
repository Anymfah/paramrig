import { useEffect, useId, useRef, useState } from 'react'
import { IconMinus, IconPlus } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { useHoldRepeat } from '@/ui/useHoldRepeat'
import {
  SCRUB_THRESHOLD_PX,
  applyScrub,
  formatNumber,
  nudgeNumber,
  parseNumberInput,
} from '@/ui/numeric'

type NumberFieldProps = {
  id?: string
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  variant?: 'slider' | 'stepper' | 'field'
  disabled?: boolean
  onChange: (value: number) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onGestureCancel?: () => void
}

export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  variant = 'slider',
  disabled,
  onChange,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: NumberFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  const inputRef = useRef<HTMLInputElement>(null)
  const discardOnBlur = useRef(false)
  /** What the field held when it took focus, so Escape can put it back. */
  const valueOnFocus = useRef<number | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const [draft, setDraft] = useState(formatNumber(value, step))
  const [error, setError] = useState<string | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const gesture = useRef<'none' | 'pending' | 'scrub' | 'arrows' | 'stepper'>('none')
  const onGestureStartRef = useRef(onGestureStart)
  const onGestureEndRef = useRef(onGestureEnd)
  const onGestureCancelRef = useRef(onGestureCancel)
  onGestureStartRef.current = onGestureStart
  onGestureEndRef.current = onGestureEnd
  onGestureCancelRef.current = onGestureCancel
  const pointer = useRef<{
    id: number
    startX: number
    origin: number
    target: HTMLElement
  } | null>(null)

  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) return
    setDraft(formatNumber(value, step))
  }, [value, step])

  const bounds = { min, max, step }

  const commit = (raw: string) => {
    const next = parseNumberInput(raw, min, max, step)
    if (next === null) {
      setError('Enter a number')
      setDraft(formatNumber(value, step))
      return
    }
    setError(null)
    if (next !== value) onChange(next)
    setDraft(formatNumber(next, step))
  }

  const applyNudge = (direction: 1 | -1) => {
    onChange(nudgeNumber(valueRef.current, direction, bounds))
  }

  const hold = useHoldRepeat(
    (direction) => applyNudge(direction),
    () => {
      gesture.current = 'stepper'
      onGestureStart?.()
    },
    () => {
      if (gesture.current === 'stepper') {
        gesture.current = 'none'
        onGestureEnd?.()
      }
    },
  )

  const endScrub = (cancelled: boolean) => {
    const wasScrub = gesture.current === 'scrub'
    if (gesture.current !== 'pending' && !wasScrub) return
    gesture.current = 'none'
    const state = pointer.current
    pointer.current = null
    setScrubbing(false)
    if (wasScrub) {
      if (cancelled) onGestureCancelRef.current?.()
      else onGestureEndRef.current?.()
    }
    if (state) {
      try {
        state.target.releasePointerCapture(state.id)
      } catch {
        /* already released */
      }
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (gesture.current !== 'scrub' && gesture.current !== 'pending') return
      event.preventDefault()
      endScrub(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const valueControl = (
    <div
      className="number-value"
      data-scrubbing={scrubbing || undefined}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return
        event.preventDefault()
        gesture.current = 'pending'
        pointer.current = {
          id: event.pointerId,
          startX: event.clientX,
          origin:
            document.activeElement === inputRef.current
              ? parseNumberInput(draft, min, max, step) ?? valueRef.current
              : valueRef.current,
          target: event.currentTarget,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const state = pointer.current
        if (!state || event.pointerId !== state.id) return
        const dx = event.clientX - state.startX
        if (gesture.current === 'pending' && Math.abs(dx) < SCRUB_THRESHOLD_PX) return
        if (gesture.current === 'pending') {
          gesture.current = 'scrub'
          setScrubbing(true)
          onGestureStart?.()
        }
        if (gesture.current !== 'scrub') return
        event.preventDefault()
        const next = applyScrub(state.origin, dx, { ...bounds, fine: event.shiftKey })
        setDraft(formatNumber(next, step))
        setError(null)
        onChange(next)
      }}
      onPointerUp={(event) => {
        const state = pointer.current
        if (!state || event.pointerId !== state.id) return
        if (gesture.current === 'pending') {
          pointer.current = null
          gesture.current = 'none'
          try {
            event.currentTarget.releasePointerCapture(event.pointerId)
          } catch {
            /* already released */
          }
          inputRef.current?.focus()
          inputRef.current?.select()
          return
        }
        endScrub(false)
      }}
      onPointerCancel={() => endScrub(true)}
      onLostPointerCapture={() => {
        if (gesture.current === 'scrub') endScrub(true)
        else {
          gesture.current = 'none'
          pointer.current = null
        }
      }}
    >
      {variant === 'stepper' ? null : (
        <label className="number-value__label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={fieldId}
        className="number-value__input"
        style={{ width: `${Math.max(4, draft.length + 1)}ch` }}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft}
        aria-invalid={error ? true : undefined}
        aria-description="Drag horizontally to adjust, click to type, or use the arrow keys. Hold Shift while dragging for finer changes."
        aria-describedby={error ? `${fieldId}-error` : unit ? `${fieldId}-unit` : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
        }}
        onFocus={() => { valueOnFocus.current = value }}
        onBlur={(event) => {
          if (!discardOnBlur.current) commit(event.currentTarget.value)
          discardOnBlur.current = false
          valueOnFocus.current = null
          if (gesture.current === 'arrows') {
            gesture.current = 'none'
            onGestureEnd?.()
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit(event.currentTarget.value)
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            discardOnBlur.current = true
            // Back to the value the field held when it took focus, scrubs and arrows included.
            const before = valueOnFocus.current
            if (before !== null && before !== value) onChange(before)
            setDraft(formatNumber(before ?? value, step))
            setError(null)
            event.currentTarget.blur()
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            if (gesture.current === 'none') {
              gesture.current = 'arrows'
              onGestureStart?.()
            }
            applyNudge(event.key === 'ArrowUp' ? 1 : -1)
          }
        }}
        onKeyUp={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          if (gesture.current !== 'arrows') return
          gesture.current = 'none'
          onGestureEnd?.()
        }}
        onWheel={(event) => event.preventDefault()}
      />
      {unit ? (
        <span id={`${fieldId}-unit`} className="number-value__unit">
          {unit}
        </span>
      ) : null}
    </div>
  )

  const guidedValueControl = (
    <Tooltip content="Drag to adjust · Click to type · Shift for precision">
      {valueControl}
    </Tooltip>
  )

  if (variant === 'stepper') {
    return (
      <div className="control control--field">
        <div className="stepper">
          <label className="stepper__label" htmlFor={fieldId}>
            {label}
          </label>
          <Tooltip content={value <= min ? `${label} is at its minimum` : `Decrease ${label}`}>
            <IconButton
              label={`Decrease ${label}`}
              onClick={event => { if (event.detail === 0) applyNudge(-1) }}
              disabled={disabled || value <= min}
              onPointerDown={(event) => {
                if (event.button !== 0 || disabled || value <= min) return
                event.preventDefault()
                hold.start(-1)
              }}
              onPointerUp={hold.stop}
              onPointerCancel={hold.stop}
              onLostPointerCapture={hold.stop}
            >
              <IconMinus />
            </IconButton>
          </Tooltip>
          {guidedValueControl}
          <Tooltip content={value >= max ? `${label} is at its maximum` : `Increase ${label}`}>
            <IconButton
              label={`Increase ${label}`}
              onClick={event => { if (event.detail === 0) applyNudge(1) }}
              disabled={disabled || value >= max}
              onPointerDown={(event) => {
                if (event.button !== 0 || disabled || value >= max) return
                event.preventDefault()
                hold.start(1)
              }}
              onPointerUp={hold.stop}
              onPointerCancel={hold.stop}
              onLostPointerCapture={hold.stop}
            >
              <IconPlus />
            </IconButton>
          </Tooltip>
        </div>
        {error ? (
          <p className="field__error" id={`${fieldId}-error`}>
            {error}. The previous value was kept.
          </p>
        ) : null}
      </div>
    )
  }

  const field = (
    <>
      {guidedValueControl}
      {error ? (
        <p className="field__error" id={`${fieldId}-error`}>
          {error}. The previous value was kept.
        </p>
      ) : null}
    </>
  )
  return variant === 'field' ? <div className="control control--field">{field}</div> : field
}
