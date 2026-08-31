import { useId } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { IconChevron, IconReset } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'

type Option = { value: string; label: string }

type SelectFieldProps = {
  id?: string
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  onReset?: () => void
  resetDisabled?: boolean
}

export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  onReset,
  resetDisabled,
}: SelectFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  const current = options.find((option) => option.value === value)?.label ?? value
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
