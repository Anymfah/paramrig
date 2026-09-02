import { useId, type CSSProperties } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { IconCheck, IconChevron } from '@/ui/icons'
import { FieldReset } from '@/ui/FieldReset'

type Option = { value: string; label: string }

type SelectFieldProps = {
  id?: string
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  defaultValue?: string
}

const SEGMENT_MAX = 4
/** Beyond this many characters across all options, a segment would truncate in an inspector column. */
const SEGMENT_MAX_CHARS = 28

export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  defaultValue,
}: SelectFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  const modified = defaultValue !== undefined && value !== defaultValue
  const reset = modified ? <FieldReset label={label} defaultLabel={options.find((option) => option.value === defaultValue)?.label ?? defaultValue!} onReset={() => onChange(defaultValue!)} /> : null
  const segmented = options.length >= 2 && options.length <= SEGMENT_MAX
    && options.reduce((total, option) => total + option.label.length, 0) <= SEGMENT_MAX_CHARS
  if (segmented) {
    return (
      <div className="control control--select control--segmented">
        <div className="segment-field" style={{ '--segment-count': options.length } as CSSProperties}>
          <span className="control__label segment-field__label" id={fieldId}>
            {label}
          </span>
          {reset}
          <div className="segment" role="radiogroup" aria-labelledby={fieldId}>
            {options.map((option) => (
              <label key={option.value} className="segment__opt">
                <input
                  type="radio"
                  name={fieldId}
                  value={option.value}
                  checked={option.value === value}
                  disabled={disabled}
                  onChange={() => onChange(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const current = options.find((option) => option.value === value)?.label ?? value
  return (
    <div className="control control--select" data-modified={modified || undefined}>
      <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
        <SelectPrimitive.Trigger id={fieldId} className="select-trigger" aria-label={label}>
          <span className="select-trigger__label" aria-hidden="true">
            {label}
          </span>
          <span className="select-trigger__value">
            <SelectPrimitive.Value>{current}</SelectPrimitive.Value>
          </span>
          <IconChevron className="select-trigger__icon" />
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="select-content" position="popper" sideOffset={8} align="end">
            <SelectPrimitive.Viewport>
              {options.map((option) => (
                <SelectPrimitive.Item key={option.value} value={option.value} className="select-item">
                  <span className="select-item__check">
                    <SelectPrimitive.ItemIndicator>
                      <IconCheck />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {reset ? <span className="control__aside">{reset}</span> : null}
    </div>
  )
}
