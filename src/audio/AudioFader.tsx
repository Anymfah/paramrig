import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { ParameterDef } from '@/rigs/types'
import type { KnobMod } from '@/audio/AudioKnob'

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
export function AudioFader({ param, value, onChange, kind = 'osc', digit, style, target, property, mods = [], onGestureStart, onGestureEnd }: {
  param: Extract<ParameterDef, { kind: 'number' }>
  value: number
  onChange: (next: number) => void
  kind?: 'osc' | 'noise'
  digit?: string | number
  style?: CSSProperties
  /** The modulation target this level stands for, and the modulators pointed at it. */
  target?: string
  /** The parameter it edits, so a macro may be dropped on it. */
  property?: string
  mods?: KnobMod[]
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

  // Each modulator's swing, as a bar beside the groove: either side of the cap for an oscillator,
  // one side for an envelope, the sign of its depth saying which. One bar a source, stepping away.
  const centre = 7.5 + (1 - fraction) * travel
  const mod = mods[0]
  const oneWay = mod?.bipolar === false
  // A drag on the slot under the groove sets the swing.
  const slotOrigin = useRef({ y: 0, depth: 0 })
  const slotDragging = useRef(false)

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
      aria-valuetext={`${value}${param.unit ?? ''}${mods.length === 0 ? '' : mods.length === 1 ? `, modulated ${Math.round(mod!.depth * 100)} per cent by ${mod!.name}` : `, modulated by ${mods.length} sources`}`}
      data-target={target}
      data-property={property}
      data-mod={mod ? '' : undefined}
      data-mods={mods.length > 1 ? mods.length : undefined}
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
      {/* One bar a source, stepping away from the groove, so two of them are two of them. */}
      {mods.map((held, at) => {
        const span = Math.abs(held.depth) * travel
        const one = held.bipolar === false
        const from = Math.max(7.5, one ? (held.depth >= 0 ? centre - span : centre) : centre - span / 2)
        const to = Math.min(7.5 + travel, one ? (held.depth >= 0 ? centre : centre + span) : centre + span / 2)
        if (to - from <= 0.5) return null
        return <span key={held.id} className="fp-fader__mod" aria-hidden="true"
          style={{ top: from, height: to - from, background: held.colour, insetInlineStart: `calc(50% + ${4.5 + at * 3}px)` }} />
      })}
      <span className="fp-fader__handle" aria-hidden="true">{digit}</span>
      {target || property ? (
        <span className="fp-fader__slot" aria-hidden="true" style={mod ? { '--slot': mod.colour } as CSSProperties : undefined}
          onPointerDown={mod ? (event) => {
            if (event.button && event.button !== 0) return
            event.stopPropagation()
            event.currentTarget.setPointerCapture?.(event.pointerId)
            slotDragging.current = true
            slotOrigin.current = { y: event.clientY, depth: mod.depth }
            onGestureStart?.()
          } : undefined}
          onPointerMove={mod ? (event) => {
            if (!slotDragging.current) return
            mod.onDepth(Math.min(1, Math.max(oneWay ? -1 : 0, slotOrigin.current.depth + (slotOrigin.current.y - event.clientY) / 150)))
          } : undefined}
          onPointerUp={mod ? (event) => { if (!slotDragging.current) return; slotDragging.current = false; event.currentTarget.releasePointerCapture?.(event.pointerId); onGestureEnd?.() } : undefined}
          onPointerCancel={() => { slotDragging.current = false }}
          onDoubleClick={mod?.onClear}>
          {mod ? mod.depth.toFixed(2) : ''}
        </span>
      ) : null}
    </div>
  )
}
