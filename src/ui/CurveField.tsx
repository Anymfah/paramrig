import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { BezierCurve } from '@/rigs/types'
import { IconCopy, IconExpand } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { NumberField } from '@/ui/NumberField'
import { Tooltip } from '@/ui/Tooltip'
import { applyCurvePreset, CURVE_PRESETS, defaultHandle, matchingCurvePreset } from '@/ui/curve-presets'
import { HIT_TARGET_COARSE_PX } from '@/ui/hit-target'

type CurveFieldProps = {
  label: string
  value: BezierCurve
  onChange: (value: BezierCurve) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onGestureCancel?: () => void
}

const W = 272
const PAD = 18
const HANDLE = 10
const HIT = HIT_TARGET_COARSE_PX
const RING = 16

function toPx(point: [number, number], height: number): [number, number] {
  return [PAD + point[0] * (W - PAD * 2), PAD + (1 - point[1]) * (height - PAD * 2)]
}

function fromPx(x: number, y: number, height: number): [number, number] {
  return [
    Math.min(1, Math.max(0, (x - PAD) / (W - PAD * 2))),
    Math.min(1, Math.max(0, 1 - (y - PAD) / (height - PAD * 2))),
  ]
}

export function CurveField({
  label,
  value,
  onChange,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: CurveFieldProps) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const height = expanded ? 144 : 96
  const css = `cubic-bezier(${[value.p1[0], value.p1[1], value.p2[0], value.p2[1]].map((n) => Number(n.toFixed(3))).join(', ')})`
  const p0 = toPx(value.p0, height)
  const p1 = toPx(value.p1, height)
  const p2 = toPx(value.p2, height)
  const p3 = toPx(value.p3, height)
  const d = `M${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`
  const activePreset = matchingCurvePreset(value)?.id

  const moveHandle = (which: 'p1' | 'p2', clientX: number, clientY: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * W
    const y = ((clientY - rect.top) / rect.height) * height
    onChange({ ...value, [which]: fromPx(x, y, height) })
  }

  return (
    <div className="control control--curve">
      <div className="control__head">
        <span className="control__label" id={id}>
          {label}
        </span>
        <div className="control__tools">
          <Tooltip content={copied ? 'Copied' : `Copy ${css}`}>
            <IconButton
              label={`Copy ${label} as CSS`}
              onClick={() => {
                void navigator.clipboard?.writeText(css)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
              }}
            >
              <IconCopy />
            </IconButton>
          </Tooltip>
          <Tooltip content={expanded ? 'Compact curve editor' : 'Enlarge curve editor'}>
            <IconButton
              label={expanded ? `Compact ${label}` : `Enlarge ${label}`}
              aria-pressed={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              <IconExpand />
            </IconButton>
          </Tooltip>
        </div>
      </div>
      <div className="curve-presets" role="group" aria-label={`${label} presets`}>
        {CURVE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="curve-preset"
            aria-pressed={activePreset === preset.id}
            onClick={() => {
              onGestureStart?.()
              onChange(applyCurvePreset(preset))
              onGestureEnd?.()
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <svg
        className="curve-field"
        data-expanded={expanded || undefined}
        viewBox={`0 0 ${W} ${height}`}
        role="group"
        aria-labelledby={id}
        onPointerUp={onGestureEnd}
        onPointerCancel={onGestureCancel}
      >
        <Grid width={W} height={height} />
        <path d={`M${p0[0]} ${p0[1]} L ${p1[0]} ${p1[1]}`} className="curve-field__guide" />
        <path d={`M${p3[0]} ${p3[1]} L ${p2[0]} ${p2[1]}`} className="curve-field__guide" />
        <path d={d} className="curve-field__path" />
        <Handle
          x={p1[0]}
          y={p1[1]}
          height={height}
          label="Start handle"
          curve={value}
          which="p1"
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
          onGestureCancel={onGestureCancel}
          move={moveHandle}
          onReset={() => onChange({ ...value, p1: defaultHandle('p1') })}
        />
        <Handle
          x={p2[0]}
          y={p2[1]}
          height={height}
          label="End handle"
          curve={value}
          which="p2"
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
          onGestureCancel={onGestureCancel}
          move={moveHandle}
          onReset={() => onChange({ ...value, p2: defaultHandle('p2') })}
        />
      </svg>
      <details className="curve-field__exact">
        <summary>Exact coordinates</summary>
        <div className="curve-field__nums">
          {([['p1', 0, 'Start X'], ['p1', 1, 'Start Y'], ['p2', 0, 'End X'], ['p2', 1, 'End Y']] as const).map(([which, axis, caption]) => (
            <NumberField
              key={caption}
              variant="field"
              label={caption}
              value={value[which][axis]}
              min={0}
              max={1}
              step={0.01}
              onChange={(next) => {
                const point: [number, number] = [...value[which]]
                point[axis] = next
                onChange({ ...value, [which]: point })
              }}
              onGestureStart={onGestureStart}
              onGestureEnd={onGestureEnd}
              onGestureCancel={onGestureCancel}
            />
          ))}
        </div>
      </details>
      <p className="visually-hidden">Custom curve control. Drag the handles, choose a preset, or type coordinates.</p>
    </div>
  )
}

function Grid({ width, height }: { width: number; height: number }) {
  const lines = [0.25, 0.5, 0.75]
  return (
    <g className="curve-field__grid" aria-hidden="true">
      {lines.map((t) => (
        <line key={`v${t}`} x1={PAD + t * (width - PAD * 2)} y1={PAD} x2={PAD + t * (width - PAD * 2)} y2={height - PAD} />
      ))}
      {lines.map((t) => (
        <line key={`h${t}`} x1={PAD} y1={PAD + t * (height - PAD * 2)} x2={width - PAD} y2={PAD + t * (height - PAD * 2)} />
      ))}
      <rect x={PAD} y={PAD} width={width - PAD * 2} height={height - PAD * 2} fill="none" className="curve-field__frame" />
    </g>
  )
}

function Handle({
  x,
  y,
  height,
  label,
  which,
  curve,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
  move,
  onReset,
}: {
  x: number
  y: number
  height: number
  label: string
  curve: BezierCurve
  which: 'p1' | 'p2'
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onGestureCancel?: () => void
  move: (which: 'p1' | 'p2', clientX: number, clientY: number, svg: SVGSVGElement) => void
  onReset: () => void
}) {
  const live = useRef(false)
  const origin = useRef({ pointerX: 0, pointerY: 0, handleX: 0, handleY: 0 })
  const finish = (cancelled: boolean) => {
    if (!live.current) return
    live.current = false
    if (cancelled) onGestureCancel?.()
    else onGestureEnd?.()
  }
  const point = which === 'p1' ? curve.p1 : curve.p2
  const grab = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = ''
    live.current = true
    const box = svg.getBoundingClientRect()
    origin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      handleX: box.left + (x / W) * box.width,
      handleY: box.top + (y / height) * box.height,
    }
    onGestureStart?.()
  }
  return (
    <g className={`curve-field__knob curve-field__knob--${which}`}>
      <rect
        className="curve-field__hit"
        x={x - HIT / 2}
        y={y - HIT / 2}
        width={HIT}
        height={HIT}
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-description="Drag to shape the curve, use the arrow keys for precise changes, or double-click to reset this handle. Hold Shift for finer dragging."
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={point[0]}
        aria-valuetext={`${point[0].toFixed(2)}, ${point[1].toFixed(2)}`}
        onPointerDown={grab}
        onDoubleClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          live.current = false
          onReset()
        }}
        onPointerMove={(event) => {
          const svg = event.currentTarget.ownerSVGElement
          if (!svg || !event.currentTarget.hasPointerCapture(event.pointerId)) return
          const fine = event.shiftKey ? 0.25 : 1
          const dx = (event.clientX - origin.current.pointerX) * fine
          const dy = (event.clientY - origin.current.pointerY) * fine
          move(which, origin.current.handleX + dx, origin.current.handleY + dy, svg)
        }}
        onPointerUp={(event) => {
          event.currentTarget.removeAttribute('data-dragging')
          finish(false)
        }}
        onPointerCancel={(event) => {
          event.currentTarget.removeAttribute('data-dragging')
          finish(true)
        }}
        onLostPointerCapture={(event) => {
          event.currentTarget.removeAttribute('data-dragging')
          finish(false)
        }}
        onKeyDown={(event) => {
          const svg = event.currentTarget.ownerSVGElement
          if (!svg) return
          const step = event.shiftKey ? 4 : 8
          let nx = (x / W) * svg.clientWidth
          let ny = (y / height) * svg.clientHeight
          const rect = svg.getBoundingClientRect()
          if (event.key === 'ArrowLeft') nx -= step
          else if (event.key === 'ArrowRight') nx += step
          else if (event.key === 'ArrowUp') ny -= step
          else if (event.key === 'ArrowDown') ny += step
          else if (event.key === 'Escape') {
            onGestureCancel?.()
            return
          } else return
          event.preventDefault()
          if (event.repeat === false) onGestureStart?.()
          move(which, rect.left + nx, rect.top + ny, svg)
        }}
        onKeyUp={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            onGestureEnd?.()
          }
        }}
      />
      <circle
        className={`curve-field__ring curve-field__ring--${which}`}
        cx={x}
        cy={y}
        r={RING / 2}
        aria-hidden="true"
      />
      <circle
        className={`curve-field__handle curve-field__handle--${which}`}
        cx={x}
        cy={y}
        r={HANDLE / 2}
        aria-hidden="true"
      />
    </g>
  )
}
