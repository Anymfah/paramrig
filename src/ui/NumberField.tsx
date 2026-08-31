import { useEffect, useId, useState } from 'react'
import { IconMinus, IconPlus, IconReset } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'

type NumberFieldProps = {
  id?: string
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  disabled?: boolean
  onChange: (value: number) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onReset?: () => void
  resetDisabled?: boolean
}

function formatValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : String(step).split('.')[1]?.length ?? 2
  return value.toFixed(decimals)
}

export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
  onGestureStart,
  onGestureEnd,
  onReset,
  resetDisabled,
}: NumberFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  const [draft, setDraft] = useState(formatValue(value, step))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(formatValue(value, step))
  }, [value, step])

  const commit = (raw: string) => {
    const next = Number(raw)
    if (raw.trim() === '' || Number.isNaN(next)) {
      setError('Enter a number')
      setDraft(formatValue(value, step))
      return
    }
    const clamped = Math.min(max, Math.max(min, next))
    setError(null)
    onChange(clamped)
    setDraft(formatValue(clamped, step))
  }

  const nudge = (direction: 1 | -1) => {
    onChange(Number(formatValue(value + direction * step, step)))
  }

  return (
    <div className="field">
      <div className="field__head">
        <label className="field__label" htmlFor={fieldId}>
          {label}
        </label>
        {onReset ? (
          <Tooltip content={resetDisabled ? 'Already at the default' : 'Reset this control'}>
            <IconButton label={`Reset ${label}`} onClick={onReset} disabled={resetDisabled}>
              <IconReset />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      <div className="number-field">
        <Tooltip content={value <= min ? `${label} is at its minimum` : `Decrease ${label}`}>
          <IconButton
            label={`Decrease ${label}`}
            disabled={disabled || value <= min}
            onClick={() => nudge(-1)}
          >
            <IconMinus />
          </IconButton>
        </Tooltip>
        <input
          id={fieldId}
          className="number-field__input"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : unit ? `${fieldId}-unit` : undefined}
          onFocus={() => {
            onGestureStart?.()
          }}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onBlur={(event) => {
            commit(event.currentTarget.value)
            onGestureEnd?.()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit(event.currentTarget.value)
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              setDraft(formatValue(value, step))
              setError(null)
              event.currentTarget.blur()
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              nudge(1)
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              nudge(-1)
            }
          }}
        />
        {unit ? (
          <span id={`${fieldId}-unit`} className="number-field__unit">
            {unit}
          </span>
        ) : null}
        <Tooltip content={value >= max ? `${label} is at its maximum` : `Increase ${label}`}>
          <IconButton
            label={`Increase ${label}`}
            disabled={disabled || value >= max}
            onClick={() => nudge(1)}
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
