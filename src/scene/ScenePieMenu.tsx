import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { sceneIcon } from '@/scene/iconRegistry'
import { Tooltip } from '@/ui/Tooltip'

/**
 * Blender's radial menu: four or eight choices on a circle at the pointer.
 *
 * A pie is not a prettier dropdown, it is a different instrument. Because every entry sits at a
 * fixed angle, the hand learns the *gesture* rather than the position in a list — `.` then up-right
 * is the 3D cursor pivot, always, whatever the menu happens to be showing. That is why the first
 * entry is at the top and the rest run clockwise from there, and why a flick past the dead zone
 * highlights a sector before the button is released: the choice is made by direction, and the
 * release only confirms it.
 *
 * Everything the gesture does, the keyboard does too. The arrows and Tab walk the circle, Enter
 * takes the highlighted entry and Escape leaves without one, so a pie is never the only way to
 * reach something — which also makes it usable with one tap on a touch screen, where each entry is
 * a button of its own.
 */

/** How far the ring sits from the centre, and how far the pointer travels before it commits. */
const RADIUS = 96
const DEAD_ZONE = 24

/** Half an entry's width plus the gap it needs from the edge of the window. */
const EDGE_PADDING = 56

export type ScenePieItem = {
  id: string
  label: string
  /** A name in `@/scene/iconRegistry`. */
  icon?: string
  disabled?: boolean
  /** Why it cannot be picked, shown in the entry's tooltip. */
  reason?: string
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/** The angle an entry sits at: the first straight up, the rest clockwise from it. */
function angleOf(position: number, count: number): number {
  return -Math.PI / 2 + (position * Math.PI * 2) / Math.max(1, count)
}

/**
 * Which entry a direction points at. The inverse of `angleOf`, rounded to the nearest sector, so
 * the whole slice of the circle around an entry belongs to it rather than only the exact bearing.
 */
function sectorAt(dx: number, dy: number, count: number): number {
  if (count <= 0) return 0
  const turn = (Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2)
  return Math.round((turn - Math.floor(turn)) * count) % count
}

export function ScenePieMenu({ open, at, label, items, onPick, onClose }: {
  open: boolean
  at: { x: number; y: number }
  label: string
  items: ScenePieItem[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [active, setActive] = useState(0)
  const [directed, setDirected] = useState(false)
  const [centre, setCentre] = useState({ x: at.x, y: at.y })
  const [mounted, setMounted] = useState(false)
  const ringRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  // Declared before the effect that moves the focus onto an entry, so it reads the element the
  // pie was opened from rather than the entry the pie has just focused.
  useEffect(() => {
    if (!open) return
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (before?.isConnected) before.focus()
    }
  }, [open])

  // Cleared on the way out, so a pie never opens showing the entry the last one landed on: a
  // reset that ran after opening would leave one frame of the wrong highlight on the screen.
  useEffect(() => {
    if (open) return
    setActive(0)
    setDirected(false)
  }, [open])

  // Pulled away from the edges of the window, because a pie half off the screen is a pie with
  // entries that cannot be reached in the direction they are drawn.
  useLayoutEffect(() => {
    if (!open) return
    const viewWidth = document.documentElement.clientWidth || window.innerWidth
    const viewHeight = document.documentElement.clientHeight || window.innerHeight
    const margin = RADIUS + EDGE_PADDING
    setCentre({
      x: clamp(at.x, margin, Math.max(margin, viewWidth - margin)),
      y: clamp(at.y, margin, Math.max(margin, viewHeight - margin)),
    })
  }, [open, at.x, at.y])

  useEffect(() => {
    if (!open) return
    const entries = ringRef.current?.querySelectorAll<HTMLElement>('[data-scene-pie-item]')
    entries?.[Math.min(active, entries.length - 1)]?.focus()
  }, [open, mounted, active, items.length])

  const pick = useCallback((position: number) => {
    const item = items[position]
    if (!item || item.disabled) return
    onClose()
    onPick(item.id)
  }, [items, onClose, onPick])

  const step = useCallback((delta: number) => {
    setDirected(false)
    setActive((current) => (items.length === 0 ? 0 : (current + delta + items.length) % items.length))
  }, [items.length])

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dx = event.clientX - centre.x
    const dy = event.clientY - centre.y
    if (Math.hypot(dx, dy) < DEAD_ZONE) {
      setDirected(false)
      return
    }
    setDirected(true)
    setActive(sectorAt(dx, dy, items.length))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    // An entry's own click does the picking when the release lands on it, so that one tap works
    // on a touch screen where no movement precedes the release.
    if (event.target instanceof Element && event.target.closest('[data-scene-pie-item]')) return
    if (directed) pick(active)
    else onClose()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    // Taken here rather than left to the focused entry's own activation: preventing the default
    // cancels the click that would otherwise follow, so an entry cannot be picked twice.
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      pick(active)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); step(1); return }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); step(-1); return }
    if (event.key === 'Home') { event.preventDefault(); setActive(0); return }
    if (event.key === 'End') { event.preventDefault(); setActive(Math.max(0, items.length - 1)) }
  }

  if (!mounted || !open) return null

  const current = items[active]

  return createPortal(
    <div
      className="scene-pie__field"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(event) => { event.preventDefault(); onClose() }}
    >
      <div
        ref={ringRef}
        className="scene-pie"
        role="menu"
        aria-label={label}
        style={{ left: `${centre.x}px`, top: `${centre.y}px` }}
        onKeyDown={onKeyDown}
      >
        {/* Hidden from the reading order: it repeats the menu's own name and the entry the
            keyboard is already on, and a menu whose first child is prose reads badly. */}
        <p className="scene-pie__centre" aria-hidden>
          <span className="scene-pie__title">{label}</span>
          <span className="scene-pie__reading">{current ? current.label : ''}</span>
        </p>
        {items.map((item, position) => {
          const angle = angleOf(position, items.length)
          const Icon = sceneIcon(item.icon)
          const entry = (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="scene-pie__item"
              data-scene-pie-item=""
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              data-highlighted={position === active || undefined}
              data-disabled={item.disabled || undefined}
              style={{ left: `${Math.round(Math.cos(angle) * RADIUS)}px`, top: `${Math.round(Math.sin(angle) * RADIUS)}px` }}
              onClick={() => pick(position)}
            >
              {Icon ? <Icon className="scene-pie__glyph" /> : null}
              <span className="scene-pie__label">{item.label}</span>
            </button>
          )
          if (!item.disabled || !item.reason) return entry
          return <Tooltip key={item.id} content={item.reason} instant>{entry}</Tooltip>
        })}
      </div>
    </div>,
    document.body,
  )
}
