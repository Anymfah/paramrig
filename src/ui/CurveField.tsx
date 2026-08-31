import { useEffect, useId, useState } from 'react'
import type { BezierCurve } from '@/rigs/types'
import { IconReset } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'

type CurveFieldProps = {
  label: string
  value: BezierCurve
  onChange: (value: BezierCurve) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onReset?: () => void
  resetDisabled?: boolean
}

const W = 272
const H = 44
const PAD = 8

function toPx(point: [number, number]): [number, number] {
  return [PAD + point[0] * (W - PAD * 2), PAD + (1 - point[1]) * (H - PAD * 2)]
}

function fromPx(x: number, y: number): [number, number] {
  return [
    Math.min(1, Math.max(0, (x - PAD) / (W - PAD * 2))),
    Math.min(1, Math.max(0, 1 - (y - PAD) / (H - PAD * 2))),
  ]
}

export function CurveField({ label, value, onChange, onGestureStart, onGestureEnd, onReset, resetDisabled }: CurveFieldProps) {
  const id = useId()
  const p0 = toPx(value.p0)
  const p1 = toPx(value.p1)
  const p2 = toPx(value.p2)
  const p3 = toPx(value.p3)
  const d = `M${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`

  const moveHandle = (which: 'p1' | 'p2', clientX: number, clientY: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * W
    const y = ((clientY - rect.top) / rect.height) * H
    onChange({ ...value, [which]: fromPx(x, y) })
  }

  return (
    <div className="field">
      <div className="field__head">
        <span className="field__label" id={id}>
          {label}
        </span>
        {onReset ? (
          <Tooltip content={resetDisabled ? 'Already at the default' : 'Reset this control'}>
            <IconButton label={`Reset ${label}`} onClick={onReset} disabled={resetDisabled}>
              <IconReset />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      <svg
        className="curve-field"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-labelledby={id}
        onPointerUp={onGestureEnd}
        onPointerCancel={onGestureEnd}
      >
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="curve-field__axis" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className="curve-field__axis" />
        <path d={d} className="curve-field__path" />
        <Handle
          cx={p1[0]}
          cy={p1[1]}
          label="Start handle"
          curve={value}
          which="p1"
          onGestureStart={onGestureStart}
          move={moveHandle}
        />
        <Handle
          cx={p2[0]}
          cy={p2[1]}
          label="End handle"
          curve={value}
          which="p2"
          onGestureStart={onGestureStart}
          move={moveHandle}
        />
      </svg>
      <details className="curve-field__exact">
        <summary>Exact coordinates</summary>
        <div className="curve-field__nums">
        <CurveCoord
          caption="Start X"
          ariaLabel={`${label} start X`}
          value={value.p1[0]}
          onCommit={(next) => onChange({ ...value, p1: [next, value.p1[1]] })}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
        <CurveCoord
          caption="Start Y"
          ariaLabel={`${label} start Y`}
          value={value.p1[1]}
          onCommit={(next) => onChange({ ...value, p1: [value.p1[0], next] })}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
        <CurveCoord
          caption="End X"
          ariaLabel={`${label} end X`}
          value={value.p2[0]}
          onCommit={(next) => onChange({ ...value, p2: [next, value.p2[1]] })}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
        <CurveCoord
          caption="End Y"
          ariaLabel={`${label} end Y`}
          value={value.p2[1]}
          onCommit={(next) => onChange({ ...value, p2: [value.p2[0], next] })}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
        </div>
      </details>
      <p className="visually-hidden">Custom curve control. Drag the handles or type coordinates.</p>
    </div>
  )
}

function Handle({
  cx,
  cy,
  label,
  which,
  curve,
  onGestureStart,
  move,
}: {
  cx: number
  cy: number
  label: string
  curve: BezierCurve
  which: 'p1' | 'p2'
  onGestureStart?: () => void
  move: (which: 'p1' | 'p2', x: number, y: number, svg: SVGSVGElement) => void
}) {
  return (
    <circle
      className="curve-field__handle"
      cx={cx}
      cy={cy}
      r={5}
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={which === 'p1' ? curve.p1[0] : curve.p2[0]}
      aria-valuetext={`${(which === 'p1' ? curve.p1 : curve.p2)[0].toFixed(2)}, ${(which === 'p1' ? curve.p1 : curve.p2)[1].toFixed(2)}`}
      onPointerDown={(event) => {
        const svg = event.currentTarget.ownerSVGElement
        if (!svg) return
        event.currentTarget.setPointerCapture(event.pointerId)
        onGestureStart?.()
        move(which, event.clientX, event.clientY, svg)
      }}
      onPointerMove={(event) => {
        const svg = event.currentTarget.ownerSVGElement
        if (!svg || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        move(which, event.clientX, event.clientY, svg)
      }}
      onKeyDown={(event) => {
        const svg = event.currentTarget.ownerSVGElement
        if (!svg) return
        const step = event.shiftKey ? 8 : 4
        let x = (cx / W) * svg.clientWidth
        let y = (cy / H) * svg.clientHeight
        const rect = svg.getBoundingClientRect()
        if (event.key === 'ArrowLeft') x -= step
        else if (event.key === 'ArrowRight') x += step
        else if (event.key === 'ArrowUp') y -= step
        else if (event.key === 'ArrowDown') y += step
        else return
        event.preventDefault()
        onGestureStart?.()
        move(which, rect.left + x, rect.top + y, svg)
      }}
    />
  )
}

function CurveCoord({
  caption,
  ariaLabel,
  value,
  onCommit,
  onGestureStart,
  onGestureEnd,
}: {
  caption: string
  ariaLabel: string
  value: number
  onCommit: (value: number) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const [draft, setDraft] = useState(value.toFixed(2))
  useEffect(() => {
    setDraft(value.toFixed(2))
  }, [value])

  const commit = (raw: string) => {
    const next = Number(raw)
    if (raw.trim() === '' || Number.isNaN(next)) {
      setDraft(value.toFixed(2))
      return
    }
    onCommit(Math.min(1, Math.max(0, next)))
  }

  return (
    <label className="curve-field__num">
      {caption}
      <input
        inputMode="decimal"
        value={draft}
        aria-label={ariaLabel}
        onFocus={onGestureStart}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          commit(event.currentTarget.value)
          onGestureEnd?.()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit(event.currentTarget.value)
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(value.toFixed(2))
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}
