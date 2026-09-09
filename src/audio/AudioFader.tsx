import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { ParameterDef } from '@/rigs/types'

/**
 * A vertical fader, because a level is a height.
 *
 * Everything else on these panels turns, and a panel where everything turns is a panel where
 * nothing stands out. The quantities that answer "how much of this" — a layer's gain, an effect's
 * mix — are the ones a person reaches for most and compares across three layers at a glance, and a
 * column of columns is read in one look where a row of dials has to be read one at a time. Every
 * mixing desk ever built makes the same distinction.
 *
 * The drag is vertical and the whole track is the target, so a press anywhere on it starts from
 * where the value already is rather than jumping to the pointer.
 */
export function AudioFader({ param, value, onChange, onGestureStart, onGestureEnd }: {
  param: Extract<ParameterDef, { kind: 'number' }>
  value: number
  onChange: (next: number) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const span = param.max - param.min || 1
  const fraction = Math.min(1, Math.max(0, (value - param.min) / span))
  const origin = useRef({ y: 0, fraction: 0 })
  const dragging = useRef(false)

  const snap = (next: number) => {
    const step = param.step > 0 ? param.step : 0.01
    const at = param.min + Math.round(((param.min + span * next) - param.min) / step) * step
    return Math.min(param.max, Math.max(param.min, Number(at.toFixed(6))))
  }

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    origin.current = { y: event.clientY, fraction }
    onGestureStart?.()
  }
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const travel = event.currentTarget.getBoundingClientRect().height || 100
    const moved = (origin.current.y - event.clientY) / (event.shiftKey ? travel * 5 : travel)
    onChange(snap(Math.min(1, Math.max(0, origin.current.fraction + moved))))
  }
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    onGestureEnd?.()
  }

  const nudge = (direction: 1 | -1, coarse: boolean) => {
    const step = (param.step > 0 ? param.step : 0.01) * (coarse ? 10 : 1)
    onChange(Math.min(param.max, Math.max(param.min, Number((value + direction * step).toFixed(6)))))
  }

  return (
    <div className="audio-fader">
      <div
        className="audio-fader__track"
        role="slider"
        tabIndex={0}
        aria-label={param.label}
        aria-valuemin={param.min}
        aria-valuemax={param.max}
        aria-valuenow={value}
        aria-valuetext={`${value}${param.unit ?? ''}`}
        style={{ '--fill': String(fraction) } as CSSProperties}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => onChange(Number(param.defaultValue))}
        onKeyDown={(event) => {
          const up_ = event.key === 'ArrowUp' || event.key === 'ArrowRight'
          const down_ = event.key === 'ArrowDown' || event.key === 'ArrowLeft'
          if (!up_ && !down_) return
          event.preventDefault()
          nudge(up_ ? 1 : -1, event.shiftKey)
        }}
      >
        <span className="audio-fader__fill" aria-hidden="true" />
        <span className="audio-fader__handle" aria-hidden="true" />
      </div>
      <output className="audio-fader__value">{value.toFixed(param.step >= 1 ? 0 : 2)}</output>
      <span className="audio-fader__label">{param.label}</span>
    </div>
  )
}
