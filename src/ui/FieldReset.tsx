import type { PointerEvent } from 'react'
import { Tooltip } from './Tooltip'

/** The small mark that says a value moved away from its default, and puts it back on click. */
export function FieldReset({ label, defaultLabel, onReset }: { label: string; defaultLabel: string; onReset: () => void }) {
  return (
    <Tooltip content={`Reset to ${defaultLabel}`}>
      <button
        type="button"
        className="field-reset"
        aria-label={`Reset ${label} to ${defaultLabel}`}
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onReset() }}
      />
    </Tooltip>
  )
}
