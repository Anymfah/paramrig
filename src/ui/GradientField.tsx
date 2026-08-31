import type { GradientStop } from '@/rigs/types'
import { ColorField } from '@/ui/ColorField'
import { IconReset } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'

type GradientFieldProps = {
  label: string
  value: GradientStop[]
  onChange: (value: GradientStop[]) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onReset?: () => void
  resetDisabled?: boolean
}

export function GradientField({
  label,
  value,
  onChange,
  onGestureStart,
  onGestureEnd,
  onReset,
  resetDisabled,
}: GradientFieldProps) {
  const css = `linear-gradient(90deg, ${value.map((stop) => `${stop.color} ${stop.t * 100}%`).join(', ')})`
  return (
    <div className="field">
      <div className="field__head">
        <span className="field__label">{label}</span>
        {onReset ? (
          <Tooltip content={resetDisabled ? 'Already at the default' : 'Reset this control'}>
            <IconButton label={`Reset ${label}`} onClick={onReset} disabled={resetDisabled}>
              <IconReset />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      <div className="gradient-bar" style={{ background: css }} aria-hidden="true">
        {value.map((stop, index) => (
          <span key={`${stop.t}-${index}`} className="gradient-handle" style={{ left: `${stop.t * 100}%` }} />
        ))}
      </div>
      <div className="gradient-stops">
        {value.map((stop, index) => (
          <ColorField
            key={`${stop.t}-${index}`}
            label={`Stop ${index + 1}`}
            value={stop.color}
            onChange={(color) => {
              const next = value.map((item, i) => (i === index ? { ...item, color } : item))
              onChange(next)
            }}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
          />
        ))}
      </div>
    </div>
  )
}
