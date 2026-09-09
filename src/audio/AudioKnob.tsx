import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { ParameterDef } from '@/rigs/types'

/**
 * A knob as a face-plate has one: a dial, its value, its name, and nothing else.
 *
 * The shared number controller stacks a full inspector row above a dial — label, editable input,
 * reset button, units menu — because in an inspector the value is the task. Squeezing that into a
 * fifty-pixel cell with CSS got the height down and made the type collide, which is the tell that
 * the component was answering a different question. This one is built for the cell it lives in.
 *
 * The gesture is the same one the shared dial teaches, so nothing has to be relearned: drag up or
 * down, hold Shift for precision, double-click to go back to what a new patch has.
 */
export function AudioKnob({ param, value, onChange, size = 'md', onGestureStart, onGestureEnd }: {
  param: Extract<ParameterDef, { kind: 'number' }>
  value: number
  onChange: (next: number) => void
  size?: 'lg' | 'md' | 'sm'
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

  /** Two significant places on a fine control, none on a coarse one — a jitter of 12.00 cents reads worse than 12. */
  const shown = param.step >= 1 ? value.toFixed(0) : value >= 1000 ? value.toFixed(0) : value.toFixed(2)

  return (
    <div className="audio-knob" data-size={size}>
      <div
        className="audio-knob__dial"
        role="slider"
        tabIndex={0}
        aria-label={param.label}
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
        <span className="audio-knob__hand" aria-hidden="true" />
      </div>
      <output className="audio-knob__value">{shown}</output>
      <span className="audio-knob__label">{param.label}</span>
    </div>
  )
}
