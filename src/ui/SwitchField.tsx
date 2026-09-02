import { useId } from 'react'
import { FieldReset } from './FieldReset'

type SwitchFieldProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Several selected items disagree; the next press turns them all on. */
  mixed?: boolean
  defaultValue?: boolean
}

export function SwitchField({ label, checked, onChange, disabled = false, mixed = false, defaultValue }: SwitchFieldProps) {
  const id = useId()
  const modified = defaultValue !== undefined && !mixed && checked !== defaultValue
  return (
    <label className="control control--switch" htmlFor={id} data-mixed={mixed || undefined} aria-disabled={disabled || undefined}>
      <span className="control__label" id={`${id}-label`}>{label}</span>
      {modified ? <FieldReset label={label} defaultLabel={defaultValue ? 'on' : 'off'} onReset={() => onChange(defaultValue!)} /> : null}
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={mixed ? 'mixed' : checked}
        aria-labelledby={`${id}-label`}
        aria-disabled={disabled || undefined}
        id={id}
        onClick={() => { if (!disabled) onChange(mixed ? true : !checked) }}
      >
        <span className="switch__thumb" />
      </button>
    </label>
  )
}
