import type { CSSProperties } from 'react'
import { NAV_WIDTH_MAX, NAV_WIDTH_MIN } from '@/state/persistence'
import { updatePrefs, useWorkspace } from '@/state/workspace'

export function useNavColumn() {
  const { prefs } = useWorkspace()
  const navW = prefs.navCollapsed ? 0 : prefs.navWidth
  return {
    dataNav: (prefs.navCollapsed ? 'collapsed' : 'open') as 'collapsed' | 'open',
    style: { '--nav-w': `${navW}px` } as CSSProperties,
  }
}

export function ShellNavResize() {
  const { prefs } = useWorkspace()
  const navW = prefs.navCollapsed ? 0 : prefs.navWidth
  if (prefs.navCollapsed) {
    return <EdgeReveal label="Show navigation" side="start" onClick={() => updatePrefs({ navCollapsed: false })} />
  }
  return (
    <ResizeCol
      ariaLabel="Resize navigation"
      value={prefs.navWidth}
      min={NAV_WIDTH_MIN}
      max={NAV_WIDTH_MAX}
      onChange={(navWidth) => updatePrefs({ navWidth })}
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
  onCollapse,
  ariaLabel,
  style,
}: {
  value: number
  min: number
  max: number
  invert?: boolean
  onChange: (value: number) => void
  onCollapse: () => void
  ariaLabel: string
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      className="resize-handle"
      aria-label={`${ariaLabel}. Double-click or Home to collapse.`}
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
        if (event.key === 'ArrowLeft') onChange(Math.min(max, Math.max(min, value + (invert ? step : -step))))
        if (event.key === 'ArrowRight') onChange(Math.min(max, Math.max(min, value + (invert ? -step : step))))
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
  return (
    <button
      type="button"
      className="resize-handle resize-handle--row"
      aria-label={`${ariaLabel}. Double-click or Home to collapse.`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        const start = event.clientY
        const origin = value
        const move = (ev: PointerEvent) => {
          onChange(Math.round(Math.min(max, Math.max(min, origin + (start - ev.clientY)))))
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
        if (event.key === 'ArrowUp') onChange(Math.min(max, Math.max(min, value + step)))
        if (event.key === 'ArrowDown') onChange(Math.min(max, Math.max(min, value - step)))
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
