import { useViewport } from '@/shell/useLayout'
import { useEffect, useRef, type CSSProperties } from 'react'
import { navColumnWidth, navResizeOrigin, snapNavResize, stepNavResize } from '@/state/nav-layout'
import { NAV_WIDTH_COMPACT, NAV_WIDTH_MAX } from '@/state/persistence'
import { updatePrefs, useWorkspace } from '@/state/workspace'

export function ShellNavResize() {
  const { prefs } = useWorkspace()
  const view = useViewport()
  const navW = navColumnWidth(prefs, view.width)
  if (prefs.navCollapsed) {
    return <EdgeReveal label="Show navigation" side="start" onClick={() => updatePrefs({ navCollapsed: false })} />
  }
  return (
    <ResizeCol
      ariaLabel="Resize navigation"
      value={navResizeOrigin(prefs)}
      min={NAV_WIDTH_COMPACT}
      max={NAV_WIDTH_MAX}
      onChange={(raw) => updatePrefs(snapNavResize(raw, prefs.navWidth))}
      onNudge={(direction, step) => updatePrefs(stepNavResize(prefs.navCompact, prefs.navWidth, direction, step))}
      onCollapse={() => updatePrefs({ navCollapsed: true })}
      style={{ left: navW - 4 }}
    />
  )
}

export function ResizeCol({
  value,
  min,
  max,
  invert,
  onChange,
  onNudge,
  onCollapse,
  ariaLabel,
  style,
}: {
  value: number
  min: number
  max: number
  invert?: boolean
  onChange: (value: number) => void
  onNudge?: (direction: -1 | 1, step: number) => void
  onCollapse: () => void
  ariaLabel: string
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      className="resize-handle"
      data-edge={invert ? 'end' : 'start'}
      aria-label={`${ariaLabel}. Double-click or Home to collapse.`}
      aria-description="Drag horizontally or use the Left and Right arrow keys to resize. Hold Shift for a larger keyboard step. Home or double-click collapses the panel."
      style={style}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        const start = event.clientX
        const origin = value
        const move = (ev: PointerEvent) => {
          const delta = invert ? start - ev.clientX : ev.clientX - start
          onChange(Math.round(Math.min(max, Math.max(min, origin + delta))))
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      }}
      onDoubleClick={onCollapse}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 16 : 8
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          const direction: -1 | 1 = event.key === 'ArrowLeft' ? (invert ? 1 : -1) : invert ? -1 : 1
          if (onNudge) onNudge(direction, step)
          else onChange(Math.min(max, Math.max(min, value + direction * step)))
        }
        if (event.key === 'Home') {
          event.preventDefault()
          onCollapse()
        }
      }}
    />
  )
}

export function ResizeRow({
  value,
  min,
  max,
  onChange,
  onCollapse,
  ariaLabel,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  onCollapse: () => void
  ariaLabel: string
}) {
  const drag = useRef<{ y: number; origin: number; pointerId: number; min: number; max: number } | null>(null)
  const change = useRef(onChange)
  useEffect(() => { change.current = onChange }, [onChange])
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current
      if (!current || event.pointerId !== current.pointerId) return
      change.current(Math.round(Math.min(current.max, Math.max(current.min, current.origin + current.y - event.clientY))))
    }
    const up = (event: PointerEvent) => { if (event.pointerId === drag.current?.pointerId) drag.current = null }
    const cancel = () => { const current = drag.current; drag.current = null; if (current) change.current(current.origin) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', escape)
      cancel()
    }
  }, [])
  return (
    <button
      type="button"
      role="separator"
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className="resize-handle resize-handle--row"
      aria-label={ariaLabel}
      aria-description="Drag or use Up and Down to resize. End expands; Home or double-click collapses. Escape cancels a drag."
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { y: event.clientY, origin: value, pointerId: event.pointerId, min, max }
      }}
      onDoubleClick={onCollapse}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 16 : 8
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          onChange(Math.min(max, Math.max(min, value + (event.key === 'ArrowUp' ? step : -step))))
        }
        if (event.key === 'End') { event.preventDefault(); onChange(max) }
        if (event.key === 'Home') {
          event.preventDefault()
          onCollapse()
        }
      }}
    />
  )
}

export function EdgeReveal({
  label,
  side,
  onClick,
}: {
  label: string
  side: 'start' | 'end'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="resize-handle resize-handle--show"
      data-side={side}
      aria-label={label}
      onClick={onClick}
    />
  )
}
