import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { STEP_COUNT } from '@/audio/fields'
import { patternAt } from '@/audio/dsp/performer'
import type { PerformerShape } from '@/audio/types'

/**
 * A performer's row: sixteen levels drawn with the pointer, the way the reference draws them.
 * Press anywhere and the step under the pointer takes the pointer's height; drag across and the
 * steps follow. The line over the bars is the row as the performer reads it — held, joined or
 * eased — so a change of shape is seen before it is heard. Each step is a slider to a keyboard.
 *
 * Under the bars runs a second row of sixteen, one a step, saying how much that step is joined to
 * the one before it. It is the difference between a sequence of notes and a shape: the row's own
 * shape says *how* two steps are joined, and this says how much of that joining happens where.
 */
const JOIN_HEIGHT = 13

export function AudioPattern({ steps, curves, shape, bipolar, grid, width, height, name, onChange, onCurves, onGestureStart, onGestureEnd }: {
  steps: number[]
  /** How far each step is joined to the one before it, 0..1. */
  curves: number[]
  shape: PerformerShape
  bipolar: boolean
  /** Divisions the drawing snaps to, 0 for none. */
  grid: number
  width: number
  height: number
  name: string
  onChange: (steps: number[]) => void
  onCurves: (curves: number[]) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const plot = useRef<SVGSVGElement>(null)
  const drawing = useRef(false)
  const column = width / STEP_COUNT
  const plotHeight = Math.max(20, height - JOIN_HEIGHT)
  const snap = (level: number) => (grid >= 2 ? Math.round(level * grid) / grid : level)

  const paint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = plot.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    const index = Math.min(STEP_COUNT - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * STEP_COUNT)))
    const level = snap(Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height)))
    if (steps[index] === level) return
    onChange(steps.map((step, at) => (at === index ? level : step)))
  }
  const step = (index: number, by: number) => {
    const level = Math.min(1, Math.max(0, (steps[index] ?? 0) + by))
    onChange(steps.map((entry, at) => (at === index ? level : entry)))
  }
  const onKey = (index: number) => (event: ReactKeyboardEvent<HTMLElement>) => {
    const by = event.key === 'ArrowUp' ? 0.05 : event.key === 'ArrowDown' ? -0.05 : event.key === 'PageUp' ? 0.25 : event.key === 'PageDown' ? -0.25 : event.key === 'Home' ? -1 : event.key === 'End' ? 1 : 0
    if (!by) return
    event.preventDefault()
    step(index, event.shiftKey ? by / 5 : by)
  }
  const join = (index: number, to: number) => onCurves(curves.map((entry, at) => (at === index ? Math.min(1, Math.max(0, to)) : entry)))

  // The row as it is read, sampled finely enough that the eased shape is a curve and not a fence.
  const samples = STEP_COUNT * 8
  const read = Array.from({ length: samples + 1 }, (_, at) => {
    const x = (at / samples) * width
    const y = plotHeight - patternAt(steps, shape, at / samples, curves) * plotHeight
    return `${at === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')

  return (
    <div className="pattern" role="group" aria-label={name}>
      <svg
        ref={plot}
        className="pattern__plot"
        viewBox={`0 0 ${width} ${plotHeight}`}
        width={width}
        height={plotHeight}
        aria-hidden="true"
        onPointerDown={(event) => {
          if (event.button && event.button !== 0) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          drawing.current = true
          onGestureStart?.()
          paint(event)
        }}
        onPointerMove={(event) => { if (drawing.current) { event.preventDefault(); paint(event) } }}
        onPointerUp={() => { if (drawing.current) { drawing.current = false; onGestureEnd?.() } }}
        onPointerCancel={() => { if (drawing.current) { drawing.current = false; onGestureEnd?.() } }}
      >
        {Array.from({ length: STEP_COUNT - 1 }, (_, at) => (
          <line key={at} className="pattern__grid" x1={(at + 1) * column} x2={(at + 1) * column} y1={0} y2={plotHeight} />
        ))}
        {/* The heights the drawing lands on, drawn so the snapping is a place and not a surprise. */}
        {grid >= 2 ? Array.from({ length: grid - 1 }, (_, at) => (
          <line key={`h${at}`} className="pattern__grid" x1={0} x2={width} y1={((at + 1) / grid) * plotHeight} y2={((at + 1) / grid) * plotHeight} />
        )) : null}
        {bipolar ? <line className="pattern__rest" x1={0} x2={width} y1={plotHeight / 2} y2={plotHeight / 2} /> : null}
        {steps.map((level, at) => (
          <rect key={at} className="pattern__step" x={at * column + 0.5} y={plotHeight - level * plotHeight} width={Math.max(0, column - 1)} height={level * plotHeight} />
        ))}
        <path className="pattern__read" d={read} />
      </svg>
      {steps.map((level, at) => (
        <span
          key={at}
          className="pattern__key"
          role="slider"
          tabIndex={0}
          aria-label={`Step ${at + 1}`}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Number(level.toFixed(3))}
          style={{ left: `${(at / STEP_COUNT) * 100}%`, width: `${100 / STEP_COUNT}%`, bottom: JOIN_HEIGHT }}
          onKeyDown={onKey(at)}
        />
      ))}
      <div className="pattern__joins" style={{ height: JOIN_HEIGHT }}>
        {curves.map((amount, at) => (
          <button
            key={at}
            type="button"
            className="pattern__join"
            role="slider"
            aria-label={`Step ${at + 1} join`}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number(amount.toFixed(2))}
            aria-valuetext={amount >= 0.999 ? 'joined' : amount <= 0.001 ? 'held' : `${Math.round(amount * 100)} per cent joined`}
            data-held={amount <= 0.001 || undefined}
            style={{ '--amount': amount } as React.CSSProperties}
            onClick={() => join(at, amount > 0.5 ? 0 : 1)}
            onKeyDown={(event) => {
              const by = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 0.1
                : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -0.1
                : event.key === 'Home' ? -1 : event.key === 'End' ? 1 : 0
              if (!by) return
              event.preventDefault()
              join(at, amount + by)
            }}
          />
        ))}
      </div>
    </div>
  )
}
