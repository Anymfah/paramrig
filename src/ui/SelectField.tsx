import { useId } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { IconCheck, IconChevron } from '@/ui/icons'

type Option = { value: string; label: string }

type SelectFieldProps = {
  id?: string
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
}

const SEGMENT_MAX = 4

export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: SelectFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  if (options.length >= 2 && options.length <= SEGMENT_MAX) {
    return (
      <div className="control control--select control--segmented">
        <span className="control__label" id={fieldId}>
          {label}
        </span>
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
    )
  }

  const current = options.find((option) => option.value === value)?.label ?? value
  return (
    <div className="control control--select">
      <label className="control__label" htmlFor={fieldId}>
        {label}
      </label>
      <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
        <SelectPrimitive.Trigger id={fieldId} className="select-trigger" aria-label={label}>
          <SelectPrimitive.Value>{current}</SelectPrimitive.Value>
          <IconChevron className="select-trigger__icon" />
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="select-content" position="popper" sideOffset={8} align="start">
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
    </div>
  )
}
