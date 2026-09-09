import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { ParameterDef } from '@/rigs/types'

/**
 * A knob, to the reference's anatomy — this time measured, not remembered.
 *
 * Read off a Retina capture: the body is not flat. It is a vertical gradient, #505257 at the top
 * to #3f3e43 at the foot, with a hairline of near-black around it and a soft shadow falling below.
 * A thin grey arc — the modulation track — stands well off the body, from half-past seven round to
 * half-past four, one device pixel wide. The pointer is a rounded bar from a third of the radius
 * to the rim. Four sizes: the hero dial of an oscillator (65 px, flat, a cream tick at the rim and
 * the wave drawn on its face), the standard dial (28), the small one (20) and the macro (21, with
 * its arc pulled in close). The amplifier's dials are the same shape in a light warm grey with a
 * dark pointer. Every number here is a measurement in CSS pixels; the plate places the knob by its
 * centre and the arc's diameter is the box.
 */
export type KnobSize = 'hero' | 'std' | 'sm' | 'macro'
export type KnobTone = 'dark' | 'light' | 'cool'

export function AudioKnob({ param, value, onChange, size = 'std', tone = 'dark', face, digit, style, inert, onGestureStart, onGestureEnd }: {
  param: Extract<ParameterDef, { kind: 'number' }>
  value: number
  onChange: (next: number) => void
  size?: KnobSize
  tone?: KnobTone
  /** Drawn on the face under the pointer — the oscillator dials show their wave. */
  face?: ReactNode
  /** The red macro number the reference prints on a dial a macro is assigned to. */
  digit?: string | number
  style?: CSSProperties
  /** Drawn where the reference draws it and wired to nothing; says so, and takes no gesture. */
  inert?: boolean
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
    <div
      className="fp-knob"
      data-size={size}
      data-tone={tone}
      role={inert ? 'img' : 'slider'}
      tabIndex={inert ? -1 : 0}
      data-inert={inert || undefined}
      aria-label={inert ? `${param.label}, not wired` : param.label || param.id}
      aria-valuemin={inert ? undefined : param.min}
      aria-valuemax={inert ? undefined : param.max}
      aria-valuenow={inert ? undefined : value}
      aria-valuetext={inert ? undefined : `${shown}${param.unit ? ` ${param.unit}` : ''}`}
      style={{ ...style, '--turn': `${fraction * 270 - 135}deg` } as CSSProperties}
      onPointerDown={inert ? undefined : down}
      onPointerMove={inert ? undefined : move}
      onPointerUp={inert ? undefined : up}
      onPointerCancel={inert ? undefined : up}
      onDoubleClick={inert ? undefined : () => onChange(Number(param.defaultValue))}
      onKeyDown={inert ? undefined : (event) => {
        const forward = event.key === 'ArrowUp' || event.key === 'ArrowRight'
        const back = event.key === 'ArrowDown' || event.key === 'ArrowLeft'
        if (!forward && !back) return
        event.preventDefault()
        onChange(fromFraction(fraction + (forward ? 1 : -1) * (event.shiftKey ? 0.002 : 0.02)))
      }}
    >
      {/* The arc: 270 degrees from half-past seven, one device pixel, standing off the body. */}
      <svg className="fp-knob__ring" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M14.645 85.355 A50 50 0 1 1 85.355 85.355" />
      </svg>
      <span className="fp-knob__body" aria-hidden="true">
        {face ? <span className="fp-knob__face">{face}</span> : null}
        <span className="fp-knob__spin"><span className="fp-knob__hand" /></span>
        {digit !== undefined ? <span className="fp-knob__digit">{digit}</span> : null}
      </span>
      {inert ? null : <output className="fp-knob__value" aria-hidden="true">{shown}</output>}
    </div>
  )
}
