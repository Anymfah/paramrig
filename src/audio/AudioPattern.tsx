import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { STEP_COUNT } from '@/audio/fields'
import { patternAt } from '@/audio/dsp/performer'
import type { PerformerShape } from '@/audio/types'

/**
 * A performer's row: sixteen levels drawn with the pointer, the way the reference draws them.
 * Press anywhere and the step under the pointer takes the pointer's height; drag across and the
 * steps follow. The line over the bars is the row as the performer reads it — held, joined or
 * eased — so a change of shape is seen before it is heard. Each step is a slider to a keyboard.
 */
export function AudioPattern({ steps, shape, bipolar, width, height, name, onChange, onGestureStart, onGestureEnd }: {
  steps: number[]
  shape: PerformerShape
  bipolar: boolean
  width: number
  height: number
  name: string
  onChange: (steps: number[]) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const plot = useRef<SVGSVGElement>(null)
  const drawing = useRef(false)
  const column = width / STEP_COUNT

  const paint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = plot.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    const index = Math.min(STEP_COUNT - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * STEP_COUNT)))
    const level = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height))
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

  // The row as it is read, sampled finely enough that the eased shape is a curve and not a fence.
  const samples = STEP_COUNT * 8
  const read = Array.from({ length: samples + 1 }, (_, at) => {
    const x = (at / samples) * width
    const y = height - patternAt(steps, shape, at / samples) * height
    return `${at === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')

  return (
    <div className="pattern" role="group" aria-label={name}>
      <svg
        ref={plot}
        className="pattern__plot"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
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
          <line key={at} className="pattern__grid" x1={(at + 1) * column} x2={(at + 1) * column} y1={0} y2={height} />
        ))}
        {bipolar ? <line className="pattern__rest" x1={0} x2={width} y1={height / 2} y2={height / 2} /> : null}
        {steps.map((level, at) => (
          <rect key={at} className="pattern__step" x={at * column + 0.5} y={height - level * height} width={Math.max(0, column - 1)} height={level * height} />
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
          style={{ left: `${(at / STEP_COUNT) * 100}%`, width: `${100 / STEP_COUNT}%` }}
          onKeyDown={onKey(at)}
        />
      ))}
    </div>
  )
}
