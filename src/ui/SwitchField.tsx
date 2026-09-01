import { useId } from 'react'

type SwitchFieldProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function SwitchField({ label, checked, onChange }: SwitchFieldProps) {
  const id = useId()
  return (
    <button
      type="button"
      className="control control--switch"
      role="switch"
      aria-checked={checked}
      id={id}
      onClick={() => onChange(!checked)}
    >
      <span className="control__label">{label}</span>
      <span className="switch" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </button>
  )
}
