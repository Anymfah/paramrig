import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParamValue } from '@/rigs/types'
import { envelopeAt, fitEnvelope } from '@/audio/dsp/envelope'
import type { AmpSettings } from '@/audio/types'

/**
 * The envelope, as an envelope.
 *
 * Six numeric fields describe the same thing and none of them shows it. Every synthesiser worth
 * using draws this instead, because the shape is the parameter: you recognise a pluck, a swell or
 * a knock at a glance and you reach for the corner that is wrong.
 *
 * The curve is drawn by `envelopeAt` — the function the synthesiser itself runs — so the picture
 * is not an illustration of the sound, it is the sound's own envelope at drawing resolution. A
 * discrepancy between the two is impossible rather than unlikely.
 */

type Handle = 'attack' | 'hold' | 'decay' | 'release'

const HANDLES: { id: Handle; label: string }[] = [
  { id: 'attack', label: 'Attack' },
  { id: 'hold', label: 'Hold' },
  { id: 'decay', label: 'Decay and sustain' },
  { id: 'release', label: 'Release' },
]

const PAD = 10
const SAMPLES = 120

const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`

export function AudioEnvelope({ layer, values, duration, onChange, onGestureStart, onGestureEnd, height = 88, pad = PAD }: {
  layer: number
  values: Record<string, ParamValue>
  duration: number
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  /** The face-plate draws the plot at the reference's size, sixty pixels with a pixel of margin. */
  height?: number
  pad?: number
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // Only the width is measured. The height is fixed because the plot is one line of a column and
  // has to keep its place in the rhythm, not grow with whatever sits under it.
  const [width, setWidth] = useState(240)
  const dragRef = useRef<Handle | null>(null)

  const offsetValue = values[`layers[${layer}].offset`]
  const offset = typeof offsetValue === 'number' ? offsetValue : 0
  const life = Math.max(0.02, duration - offset)

  // Memoised because `write` depends on it, and a fresh object every render would rebuild that
  // callback on every render too.
  const amp = useMemo<AmpSettings>(() => {
    const read = (field: string, fallback: number) => {
      const value = values[`layers[${layer}].amp.${field}`]
      return typeof value === 'number' ? value : fallback
    }
    return {
      attack: read('attack', 0), hold: read('hold', 0), decay: read('decay', 0.1),
      sustain: read('sustain', 0), release: read('release', 0.05), curve: read('curve', 2),
    }
  }, [layer, values])
  const fitted = fitEnvelope(amp, life)

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0) setWidth(Math.round(rect.width))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const plotW = Math.max(1, width - pad * 2)
  const plotH = Math.max(1, height - pad * 2)
  const x = (seconds: number) => pad + (seconds / life) * plotW
  const y = (level: number) => pad + (1 - level) * plotH

  const path = Array.from({ length: SAMPLES + 1 }, (_, index) => {
    const at = (index / SAMPLES) * life
    return `${index === 0 ? 'M' : 'L'}${x(at).toFixed(2)},${y(envelopeAt(amp, fitted, at, life)).toFixed(2)}`
  }).join('')

  const decayEnd = fitted.attack + fitted.hold + fitted.decay
  const spots: Record<Handle, { cx: number; cy: number; text: string }> = {
    attack: { cx: x(fitted.attack), cy: y(1), text: ms(amp.attack) },
    hold: { cx: x(fitted.attack + fitted.hold), cy: y(1), text: ms(amp.hold) },
    decay: { cx: x(decayEnd), cy: y(amp.sustain), text: `${ms(amp.decay)}, sustain ${amp.sustain.toFixed(2)}` },
    release: { cx: x(life - fitted.release), cy: y(amp.sustain), text: ms(amp.release) },
  }

  /**
   * The stage being dragged wins, and only its neighbours give way — in order, and only as far as
   * they have to.
   *
   * Two earlier attempts were wrong in opposite directions. Capping each stage at whatever the
   * other three left over meant every handle travelled a few pixels and then stopped dead on top
   * of its neighbour, which reads as the point vanishing rather than as a limit. Shrinking all the
   * others proportionally freed the handle but flattened the rest of the envelope with it: one
   * pull of the decay and the attack, hold and release were gone.
   *
   * So a drag takes only from the side it is moving into, nearest first, and stops when that side
   * is used up. Pulling the decay out shortens the release and leaves the attack alone; pulling
   * the release in — it grows leftwards — eats the decay before the hold.
   */
  const write = useCallback((handle: Handle, seconds: number, level: number | null) => {
    const order: Handle[] = ['attack', 'hold', 'decay', 'release']
    const stages: Record<Handle, number> = {
      attack: amp.attack, hold: amp.hold, decay: amp.decay, release: amp.release,
    }
    const at = order.indexOf(handle)
    // Release is measured from the end, so it grows into what precedes it; the rest grow forwards.
    const gives = handle === 'release' ? order.slice(0, at).reverse() : order.slice(at + 1)
    const fixed = order.filter((id) => id !== handle && !gives.includes(id))
      .reduce((sum, id) => sum + stages[id], 0)

    const wanted = handle === 'attack' ? seconds
      : handle === 'hold' ? seconds - amp.attack
      : handle === 'decay' ? seconds - amp.attack - amp.hold
      : life - seconds
    stages[handle] = Math.min(Math.max(0, life - fixed), Math.max(0, wanted))

    let excess = order.reduce((sum, id) => sum + stages[id], 0) - life
    for (const id of gives) {
      if (excess <= 0) break
      const taken = Math.min(stages[id], excess)
      stages[id] -= taken
      excess -= taken
    }

    for (const id of order) {
      if (stages[id] !== amp[id]) onChange(`layers[${layer}].amp.${id}`, stages[id])
    }
    if (handle === 'decay' && level !== null) {
      onChange(`layers[${layer}].amp.sustain`, Math.min(1, Math.max(0, level)))
    }
  }, [amp, layer, life, onChange])

  const fromPointer = (event: React.PointerEvent<SVGSVGElement>, handle: Handle) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const seconds = ((event.clientX - rect.left - pad) / plotW) * life
    const level = 1 - (event.clientY - rect.top - pad) / plotH
    write(handle, seconds, handle === 'decay' ? level : null)
  }

  const nudge = (handle: Handle, event: React.KeyboardEvent) => {
    const step = event.shiftKey ? life / 200 : life / 40
    const spot = spots[handle]
    const seconds = ((spot.cx - pad) / plotW) * life
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      write(handle, seconds + (event.key === 'ArrowRight' ? step : -step), null)
      return
    }
    if (handle === 'decay' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      onChange(`layers[${layer}].amp.sustain`, Math.min(1, Math.max(0, amp.sustain + (event.key === 'ArrowUp' ? 0.05 : -0.05))))
    }
  }

  return (
    <div className="envelope" ref={hostRef}>
      <svg
        className="envelope__plot"
        width={width}
        height={height}
        onPointerDown={(event) => {
          const handle = (event.target as Element).closest('[data-handle]')?.getAttribute('data-handle') as Handle | null
          if (!handle) return
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = handle
          onGestureStart?.()
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return
          event.preventDefault()
          fromPointer(event, dragRef.current)
        }}
        onPointerUp={(event) => {
          if (!dragRef.current) return
          dragRef.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
          onGestureEnd?.()
        }}
        onPointerCancel={() => {
          if (!dragRef.current) return
          dragRef.current = null
          onGestureEnd?.()
        }}
      >
        <line className="envelope__floor" x1={pad} y1={y(0)} x2={width - pad} y2={y(0)} />
        <path className="envelope__fill" d={`${path}L${x(life).toFixed(2)},${y(0).toFixed(2)}L${x(0).toFixed(2)},${y(0).toFixed(2)}Z`} />
        <path className="envelope__line" d={path} />
        {HANDLES.map(({ id, label }) => (
          <g
            key={id}
            data-handle={id}
            className="envelope__handle"
            role="slider"
            tabIndex={0}
            aria-label={`${label}, layer ${layer + 1}`}
            aria-valuetext={spots[id].text}
            onKeyDown={(event) => nudge(id, event)}
          >
            <circle className="envelope__grab" cx={spots[id].cx} cy={spots[id].cy} r={14} />
            <circle className="envelope__dot" cx={spots[id].cx} cy={spots[id].cy} r={4} />
          </g>
        ))}
      </svg>
      <p className="envelope__read">
        <span>A {ms(amp.attack)}</span>
        <span>H {ms(amp.hold)}</span>
        <span>D {ms(amp.decay)}</span>
        <span>S {amp.sustain.toFixed(2)}</span>
        <span>R {ms(amp.release)}</span>
      </p>
    </div>
  )
}
