import { Fragment, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { ParameterDef } from '@/rigs/types'
import { readable, spoken } from '@/audio/readable'

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
export type KnobSize = 'hero' | 'mid' | 'std' | 'sm' | 'macro'
export type KnobTone = 'dark' | 'light' | 'cool'

/**
 * A modulator pointed at the control: its colour, how far it swings and where to write a new
 * swing, whether it swings both ways (an LFO) or one (an envelope, the sign of its depth saying
 * which), and how to take it off again.
 */
export type KnobMod = { id: string; name: string; colour: string; depth: number; onDepth: (next: number) => void; bipolar?: boolean; onClear?: () => void }

/** The arc every dial wears: 270 degrees from half-past seven, on a hundred-unit box. */
const TRACK = 'M14.645 85.355 A50 50 0 1 1 85.355 85.355'
const point = (deg: number, radius = 50) => {
  const rad = (deg * Math.PI) / 180
  return `${(50 + radius * Math.cos(rad)).toFixed(3)} ${(50 + radius * Math.sin(rad)).toFixed(3)}`
}
/** The stretch of a ring between two angles, clockwise, in the same units. */
const arc = (from: number, to: number, radius = 50) =>
  `M${point(from, radius)} A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to, radius)}`
/** The whole ring, for the arc a modulator's swing is drawn on and for the hit area over it. */
const ring = (radius: number) => `M${point(135, radius)} A${radius} ${radius} 0 1 1 ${point(405, radius)}`
/** How far in each further source is drawn. Three fit before the rings reach the body. */
const STEP_IN = 6

export function AudioKnob({ param, value, onChange, size = 'std', tone = 'dark', face, digit, style, inert, idle, dots, target, property, mods = [], onGestureStart, onGestureEnd }: {
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
  /**
   * Wired, but not read by the arrangement the patch is in at this moment — a filter balance while
   * only one filter is running, a detune on a layer that makes noise. It still turns and still
   * remembers, because the arrangement is one click away; it is dimmed, and it says what would
   * make it do something. Dead-looking is better than dead-and-looking-alive.
   */
  idle?: string
  /** Two dots at the ends of the arc: the reference's mark for a bipolar range. */
  dots?: boolean
  /** The modulation target this control stands for, if a modulator may be dropped on it. */
  target?: string
  /** The parameter it edits, so a macro may be dropped on it. */
  property?: string
  /**
   * The modulators pointed at it, each drawn as a coloured stretch of its own ring either side of
   * the value. Several may point at one control and the engine adds their swings, so the plate
   * has to show several — one arc said the first was the only one, which was a lie about the sound.
   */
  mods?: KnobMod[]
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

  /**
   * One arrow press, in whatever the parameter's own units are.
   *
   * It used to nudge the *fraction* by a fiftieth, and then the value it produced was rounded back
   * onto the parameter's step — so on anything with fewer than twenty-five steps across its range
   * the press landed on the value it started from and nothing moved. Shift, a tenth of that, was
   * dead on nearly every knob in the instrument: Reso, Pan, Sustain, Spread, Gain. And the whole
   * fraction is recomputed from the value each press, so nothing accumulated either — the key was
   * dead rather than slow. Ten steps for an arrow, one for a fine press, and a press always lands
   * on the neighbouring step whatever the range.
   */
  const stepped = (direction: number, fine: boolean) => {
    const step = param.step > 0 ? param.step : (param.max - param.min) / 100
    // A fiftieth of the range for a plain press, one step for a fine one — and never less than a
    // step either way, which is the whole fix: a fiftieth of five is a tenth, and a tenth of a
    // dial whose step is one rounds back to where it started.
    const by = fine ? step : Math.max(step, (param.max - param.min) / 50)
    const wanted = value + direction * by
    // A log knob keeps its fraction nudge, where a step in hertz means something different at each
    // end: a fiftieth of the sweep, floored at one step so it can never stand still.
    if (log) {
      const byFraction = fromFraction(toFraction(value) + direction * (fine ? 0.002 : 0.02))
      return byFraction === value ? Math.min(param.max, Math.max(param.min, wanted)) : byFraction
    }
    const rounded = Number((Math.round(wanted / step) * step).toFixed(6))
    return Math.min(param.max, Math.max(param.min, rounded))
  }

  const fraction = toFraction(value)
  const origin = useRef({ y: 0, fraction: 0 })
  const dragging = useRef(false)
  // A drag on a ring itself, where a modulator sits, sets how far that one swings.
  const depthOrigin = useRef({ y: 0, depth: 0 })
  const depthDragging = useRef<KnobMod | null>(null)
  const depthDown = (held: KnobMod) => (event: ReactPointerEvent<Element>) => {
    if (event.button && event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    depthDragging.current = held
    depthOrigin.current = { y: event.clientY, depth: held.depth }
    onGestureStart?.()
  }
  const depthMove = (event: ReactPointerEvent<Element>) => {
    const held = depthDragging.current
    if (!held) return
    const floor = held.bipolar === false ? -1 : 0
    held.onDepth(Math.min(1, Math.max(floor, depthOrigin.current.depth + (depthOrigin.current.y - event.clientY) / 150)))
  }
  const depthUp = (event: ReactPointerEvent<Element>) => {
    if (!depthDragging.current) return
    depthDragging.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    onGestureEnd?.()
  }
  const angle = 135 + fraction * 270
  const mod = mods[0]
  /**
   * Where one source's swing starts and ends on its own ring.
   *
   * An oscillator swings either side of the value; an envelope pushes one way, the sign of its
   * depth saying which.
   */
  const stretch = (held: KnobMod) => {
    const swing = Math.min(135, Math.abs(held.depth) * 135)
    const from = held.bipolar === false ? (held.depth >= 0 ? angle : Math.max(135, angle - swing)) : Math.max(135, angle - swing)
    const to = held.bipolar === false ? (held.depth >= 0 ? Math.min(405, angle + swing) : angle) : Math.min(405, angle + swing)
    return { swing, from, to }
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
    onChange(fromFraction(origin.current.fraction + (origin.current.y - event.clientY) / (event.shiftKey ? 900 : 180)))
  }
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    onGestureEnd?.()
  }

  const shown = readable(param, value)

  return (
    <div
      className="fp-knob"
      data-size={size}
      data-tone={tone}
      role={inert ? 'img' : 'slider'}
      tabIndex={inert ? -1 : 0}
      data-inert={inert || undefined}
      data-idle={idle ? '' : undefined}
      data-hint={idle || undefined}
      data-dots={dots || undefined}
      data-target={target}
      data-property={property}
      data-mod={mod ? '' : undefined}
      data-mods={mods.length > 1 ? mods.length : undefined}
      aria-label={inert ? `${param.label}, not wired` : idle ? `${param.label || param.id}, ${idle}` : param.label || param.id}
      aria-valuemin={inert ? undefined : param.min}
      aria-valuemax={inert ? undefined : param.max}
      aria-valuenow={inert ? undefined : value}
      aria-valuetext={inert ? undefined : `${spoken(param, value)}${mods.length === 0 ? '' : mods.length === 1 ? `, modulated ${Math.round(mod!.depth * 100)} per cent by ${mod!.name}` : `, modulated by ${mods.length} sources`}`}
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
        // Alt and an arrow move the modulator's swing instead of the value.
        if (mod && event.altKey) {
          mod.onDepth(Math.min(1, Math.max(mod.bipolar === false ? -1 : 0, mod.depth + (forward ? 1 : -1) * 0.02)))
          return
        }
        onChange(stepped(forward ? 1 : -1, event.shiftKey))
      }}
    >
      {/* The arc: 270 degrees from half-past seven, one device pixel, standing off the body. */}
      <svg className="fp-knob__ring" viewBox="0 0 100 100" aria-hidden="true">
        <path className="fp-knob__track" d={TRACK} />
        {mods.map((held, at) => {
          const radius = 50 - at * STEP_IN
          if (radius < 26) return null
          const { swing, from, to } = stretch(held)
          return (
            <Fragment key={held.id}>
              {at > 0 ? <path className="fp-knob__track" d={ring(radius)} /> : null}
              {swing > 0.5 ? <path className="fp-knob__mod" d={arc(from, to, radius)} style={{ stroke: held.colour }} /> : null}
              <path className="fp-knob__hit" d={ring(radius)}
                onPointerDown={depthDown(held)} onPointerMove={depthMove} onPointerUp={depthUp} onPointerCancel={depthUp} />
            </Fragment>
          )
        })}
      </svg>
      <span className="fp-knob__body" aria-hidden="true">
        {face ? <span className="fp-knob__face">{face}</span> : null}
        <span className="fp-knob__spin"><span className="fp-knob__hand" /></span>
        {digit !== undefined ? <span className="fp-knob__digit">{digit}</span> : null}
      </span>
      {/* The slot: the case a held modulator is dropped in, and afterwards the amount it took, in its colour. */}
      {target || property ? (
        <span className="fp-knob__slot" aria-hidden="true" data-many={mods.length > 1 || undefined}
          style={mod ? { '--slot': mod.colour } as CSSProperties : undefined}
          onPointerDown={mod ? depthDown(mod) : undefined} onPointerMove={mod ? depthMove : undefined} onPointerUp={mod ? depthUp : undefined} onPointerCancel={mod ? depthUp : undefined}
          // Stopped here, or the same gesture also reaches the body's own double-click and puts the
          // parameter back to the blank patch's value — one click, two edits, one of them nobody
          // asked for.
          onDoubleClick={mod ? (event) => { event.stopPropagation(); mod.onClear?.() } : undefined}>
          {mod ? mod.depth.toFixed(2) : ''}
        </span>
      ) : null}
      {inert ? null : <output className="fp-knob__value" aria-hidden="true">{shown}</output>}
    </div>
  )
}
