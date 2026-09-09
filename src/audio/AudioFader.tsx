import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { ParameterDef } from '@/rigs/types'

/**
 * A vertical fader, to the reference's two patterns.
 *
 * An oscillator's level is a dark groove five and a half pixels wide and seventy-five tall, with
 * a round dark cap riding it — and the cap is where the red macro number lives, so the number
 * travels with the level. A noise generator's level is a thinner groove on a darker panel, capped
 * by a light ring with a dark hole. Neither prints its value: the reference does not, and the
 * handle's height is the reading. The whole box is the drag target, and a press starts from where
 * the value already is rather than jumping to the pointer.
 */
export function AudioFader({ param, value, onChange, kind = 'osc', digit, style, onGestureStart, onGestureEnd }: {
  param: Extract<ParameterDef, { kind: 'number' }>
  value: number
  onChange: (next: number) => void
  kind?: 'osc' | 'noise'
  digit?: string | number
  style?: CSSProperties
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const span = param.max - param.min || 1
  const fraction = Math.min(1, Math.max(0, (value - param.min) / span))
  const origin = useRef({ y: 0, fraction: 0 })
  const dragging = useRef(false)
  // The handle's travel, which is what a pixel of drag is measured against.
  const travel = kind === 'osc' ? 72.5 : 72

  const snap = (next: number) => {
    const step = param.step > 0 ? param.step : 0.01
    const at = param.min + Math.round((span * next) / step) * step
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
    const scale = Number(getComputedStyle(event.currentTarget).getPropertyValue('--fp-scale')) || 1
    const moved = (origin.current.y - event.clientY) / (travel * scale * (event.shiftKey ? 5 : 1))
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
    <div
      className="fp-fader"
      data-kind={kind}
      role="slider"
      tabIndex={0}
      aria-label={param.label}
      aria-valuemin={param.min}
      aria-valuemax={param.max}
      aria-valuenow={value}
      aria-valuetext={`${value}${param.unit ?? ''}`}
      style={{ ...style, '--fill': String(fraction) } as CSSProperties}
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
      <span className="fp-fader__track" aria-hidden="true" />
      <span className="fp-fader__handle" aria-hidden="true">{digit}</span>
    </div>
  )
}
