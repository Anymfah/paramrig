import { useId } from 'react'
import { IconReset } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'

type SwitchFieldProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  onReset?: () => void
  resetDisabled?: boolean
}

export function SwitchField({ label, checked, onChange, onReset, resetDisabled }: SwitchFieldProps) {
  const id = useId()
  return (
    <div className="field field--row">
      <div className="field__head">
        <span className="field__label" id={id}>
          {label}
        </span>
        {onReset ? (
          <Tooltip content={resetDisabled ? 'Already at the default' : 'Reset this control'}>
            <IconButton label={`Reset ${label}`} onClick={onReset} disabled={resetDisabled}>
              <IconReset />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
    </div>
  )
}
