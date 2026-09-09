import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { ParameterDef } from '@/rigs/types'

/**
 * A knob as the reference face-plate draws one.
 *
 * Its anatomy, read off a 2000-pixel capture: the name above the dial; a dark body with a soft
 * highlight and a hairline rim; a thin grey arc standing a little off the body, its swept portion
 * only slightly lighter and never coloured unless a modulator is pointed at the control; a white
 * pointer from a third of the radius to the edge; and no number under it — values live in the
 * readouts at a panel's head, and appear here only while the knob is being used. The first version
 * put value and name below and an accent-coloured arc around, which is what "still dirty" meant.
 *
 * The gesture is the shared dial's: drag up or down, Shift to refine, double-click to reset.
 */
export function AudioKnob({ param, value, onChange, size = 'md', face, onGestureStart, onGestureEnd }: {
  param: Extract<ParameterDef, { kind: 'number' }>
  value: number
  onChange: (next: number) => void
  size?: 'lg' | 'md' | 'sm'
  /** Drawn inside the dial, under the pointer — the reference's oscillator dials show their wave. */
  face?: ReactNode
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const log = param.scale === 'log' && param.min > 0
  const toFraction = (raw: number) => {
    const at = Math.min(param.max, Math.max(param.min, raw))
    return log
      ? Math.log(at / param.min) / Math.log(param.max / param.min)
      : (at - param.min) / (param.max - param.min || 1)
  }
  const fromFraction = (fraction: number) => {
    const clamped = Math.min(1, Math.max(0, fraction))
    const raw = log
      ? param.min * Math.pow(param.max / param.min, clamped)
      : param.min + clamped * (param.max - param.min)
    const step = param.step > 0 ? param.step : 0.001
    return Math.min(param.max, Math.max(param.min, Number((Math.round(raw / step) * step).toFixed(6))))
  }

  const fraction = toFraction(value)
  const origin = useRef({ y: 0, fraction: 0 })
  const dragging = useRef(false)

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    origin.current = { y: event.clientY, fraction }
    onGestureStart?.()
  }
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    onChange(fromFraction(origin.current.fraction + (origin.current.y - event.clientY) / (event.shiftKey ? 900 : 180)))
  }
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    onGestureEnd?.()
  }

  const shown = param.step >= 1 ? value.toFixed(0) : value >= 1000 ? value.toFixed(0) : value.toFixed(2)

  return (
    <div className="audio-knob" data-size={size}>
      {param.label ? <span className="audio-knob__label">{param.label}</span> : null}
      <div
        className="audio-knob__dial"
        role="slider"
        tabIndex={0}
        aria-label={param.label || param.id}
        aria-valuemin={param.min}
        aria-valuemax={param.max}
        aria-valuenow={value}
        aria-valuetext={`${shown}${param.unit ? ` ${param.unit}` : ''}`}
        style={{ '--turn': `${fraction * 270 - 135}deg`, '--fraction': String(fraction) } as CSSProperties}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => onChange(Number(param.defaultValue))}
        onKeyDown={(event) => {
          const forward = event.key === 'ArrowUp' || event.key === 'ArrowRight'
          const back = event.key === 'ArrowDown' || event.key === 'ArrowLeft'
          if (!forward && !back) return
          event.preventDefault()
          onChange(fromFraction(fraction + (forward ? 1 : -1) * (event.shiftKey ? 0.002 : 0.02)))
        }}
      >
        <span className="audio-knob__arc" aria-hidden="true" />
        {face ? <span className="audio-knob__face" aria-hidden="true">{face}</span> : null}
        <span className="audio-knob__hand" aria-hidden="true" />
      </div>
      <output className="audio-knob__value" aria-hidden="true">{shown}</output>
    </div>
  )
}
