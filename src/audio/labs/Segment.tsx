import { useId, type ReactNode } from 'react'

/** A row of radios drawn as one control: the choice is visible, the arrows walk it. */
export function Segment<T extends string>({ label, value, options, onChange, render, disabled }: { label: string; value: T; options: readonly T[]; onChange: (next: T) => void; render: (option: T) => ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="labs-segment" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map((option) => (
        <label key={option} className="labs-segment__opt" data-checked={option === value || undefined}>
          <input type="radio" name={id} value={option} checked={option === value} disabled={disabled} onChange={() => onChange(option)} />
          {render(option)}
        </label>
      ))}
    </div>
  )
}
