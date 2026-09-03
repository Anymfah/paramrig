import { useRef } from 'react'
import { Tooltip } from '@/ui/Tooltip'
import { cameraBasis, type AxisView } from '@/scene/viewport/view'
import type { ViewState } from '@/scene/types'

/**
 * The axis ball in the corner, and the four buttons under it.
 *
 * Blender draws this inside the viewport. Here it is SVG in the DOM, on purpose: every ball is a
 * real button, so it takes focus, carries a tooltip, answers the keyboard, meets a 32-pixel target
 * without arithmetic, and survives forced-colours mode — none of which is true of something drawn
 * with WebGL. What it shows is identical; what it costs is nothing, because it changes only when
 * the view does.
 */

const RADIUS = 30
const BALL = 9.5

type Axis = { name: AxisView; label: string; vector: [number, number, number]; role: 'x' | 'y' | 'z'; positive: boolean }

const AXES: Axis[] = [
  { name: 'right', label: 'X', vector: [1, 0, 0], role: 'x', positive: true },
  { name: 'left', label: '−X', vector: [-1, 0, 0], role: 'x', positive: false },
  { name: 'back', label: 'Y', vector: [0, 1, 0], role: 'y', positive: true },
  { name: 'front', label: '−Y', vector: [0, -1, 0], role: 'y', positive: false },
  { name: 'top', label: 'Z', vector: [0, 0, 1], role: 'z', positive: true },
  { name: 'bottom', label: '−Z', vector: [0, 0, -1], role: 'z', positive: false },
]

export function SceneNavGizmo({ view, onAxis, onOrbit, onZoom, onPan, onToggleProjection, onCamera, hasCamera }: {
  view: ViewState
  onAxis: (axis: AxisView) => void
  onOrbit: (dx: number, dy: number) => void
  onZoom: (delta: number) => void
  onPan: (dx: number, dy: number) => void
  onToggleProjection: () => void
  onCamera: () => void
  hasCamera: boolean
}) {
  const drag = useRef<{ x: number; y: number; kind: 'orbit' | 'zoom' | 'pan' } | null>(null)
  const basis = cameraBasis(view.yaw, view.pitch)

  /** Where an axis lands on the ball: right and up give the screen position, forward the depth. */
  const place = (vector: [number, number, number]) => {
    const x = vector[0] * basis.right[0] + vector[1] * basis.right[1] + vector[2] * basis.right[2]
    const y = vector[0] * basis.up[0] + vector[1] * basis.up[1] + vector[2] * basis.up[2]
    const z = vector[0] * basis.forward[0] + vector[1] * basis.forward[1] + vector[2] * basis.forward[2]
    return { x: RADIUS + x * (RADIUS - BALL), y: RADIUS - y * (RADIUS - BALL), z }
  }

  const drawn = AXES.map((axis) => ({ axis, at: place(axis.vector) })).sort((a, b) => a.at.z - b.at.z)

  const startDrag = (kind: 'orbit' | 'zoom' | 'pan') => (event: React.PointerEvent) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, kind }
  }
  const moveDrag = (event: React.PointerEvent) => {
    const held = drag.current
    if (!held) return
    const dx = event.clientX - held.x
    const dy = event.clientY - held.y
    drag.current = { ...held, x: event.clientX, y: event.clientY }
    if (held.kind === 'orbit') onOrbit(dx, dy)
    else if (held.kind === 'pan') onPan(dx, dy)
    else onZoom(dy * 4)
  }
  const endDrag = (event: React.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = null
  }

  return (
    <div className="scene-nav" role="group" aria-label="View">
      <svg
        className="scene-nav__ball"
        viewBox={`0 0 ${RADIUS * 2} ${RADIUS * 2}`}
        onPointerDown={startDrag('orbit')}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* The three spokes, drawn only towards the viewer so the ball reads as a ball. */}
        {AXES.filter((axis) => axis.positive).map((axis) => {
          const at = place(axis.vector)
          return (
            <line
              key={axis.label}
              className="scene-nav__spoke"
              data-axis={axis.role}
              x1={RADIUS}
              y1={RADIUS}
              x2={at.x}
              y2={at.y}
              opacity={at.z < 0 ? 1 : 0.35}
            />
          )
        })}
        {drawn.map(({ axis, at }) => (
          <g key={axis.label} className="scene-nav__axis" data-axis={axis.role} data-near={at.z < 0 || undefined}>
            <circle
              className="scene-nav__hit"
              cx={at.x}
              cy={at.y}
              r={BALL + 3}
              role="button"
              tabIndex={0}
              aria-label={`${axisTitle(axis.name)} view`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onAxis(axis.name)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onAxis(axis.name)
              }}
            />
            <circle className="scene-nav__ball-dot" cx={at.x} cy={at.y} r={BALL} />
            {at.z < 0 || axis.positive ? <text className="scene-nav__label" x={at.x} y={at.y}>{axis.label}</text> : null}
          </g>
        ))}
      </svg>
      <div className="scene-nav__buttons">
        <Tooltip content="Zoom · drag, or the wheel">
          <button
            type="button"
            className="scene-nav__button"
            aria-label="Zoom"
            onPointerDown={startDrag('zoom')}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4 14 14M5 7h4" /></svg>
          </button>
        </Tooltip>
        <Tooltip content="Pan · drag, or ⇧ middle-drag">
          <button
            type="button"
            className="scene-nav__button"
            aria-label="Pan"
            onPointerDown={startDrag('pan')}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12M8 2 6 4M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" /></svg>
          </button>
        </Tooltip>
        <Tooltip content={view.projection === 'perspective' ? 'Perspective · Numpad 5 for orthographic' : 'Orthographic · Numpad 5 for perspective'}>
          <button
            type="button"
            className="scene-nav__button"
            aria-label="Toggle perspective"
            aria-pressed={view.projection === 'orthographic'}
            onClick={onToggleProjection}
          >
            {view.projection === 'perspective' ? (
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5 5.5 3.5h5l2.5 9zM4.4 8.2h7.2" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12.5v-9h8v9zM4 8h8" /></svg>
            )}
          </button>
        </Tooltip>
        <Tooltip content={hasCamera ? 'Camera view · Numpad 0' : 'This scene has no active camera'}>
          <button
            type="button"
            className="scene-nav__button"
            aria-label="Camera view"
            aria-disabled={!hasCamera || undefined}
            onClick={() => { if (hasCamera) onCamera() }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5h7v6H2zM9 8l4-2.5v5z" /></svg>
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

function axisTitle(axis: AxisView): string {
  return axis.charAt(0).toUpperCase() + axis.slice(1)
}
