import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * The bar between two spaces, and the only way to change how the room is shared.
 *
 * It is a `separator` with a value, not a button: a person on a keyboard moves it with the arrow
 * keys and hears where it is, which is what the role is for. The pointer drag measures against the
 * parent rather than the window, so a splitter inside a panel works the same as one across the
 * page, and the pointer is captured so a fast drag that leaves the bar carries on.
 *
 * The value is a fraction of the parent rather than a number of pixels, because a window that is
 * resized should keep the proportion a person chose rather than the width they happened to drag to.
 */

/** How far an arrow key moves it, and how far with shift held. */
const STEP = 0.02
const COARSE_STEP = 0.1

export function SceneSplitter({ label, value, min = 0.2, max = 0.8, onChange, onReset }: {
  label: string
  /** How much of the parent the space before the splitter takes, from 0 to 1. */
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  /** Double-clicking asks for the arrangement back; without a handler it does nothing. */
  onReset?: () => void
}) {
  const bar = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)

  const clamp = (next: number): number => Math.min(max, Math.max(min, next))

  const fromPointer = (event: PointerEvent<HTMLDivElement>): number | null => {
    const parent = bar.current?.parentElement
    if (!parent) return null
    const box = parent.getBoundingClientRect()
    if (box.width <= 0) return null
    return clamp((event.clientX - box.left) / box.width)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? COARSE_STEP : STEP
    if (event.key === 'ArrowLeft') onChange(clamp(value - step))
    else if (event.key === 'ArrowRight') onChange(clamp(value + step))
    else if (event.key === 'Home') onChange(min)
    else if (event.key === 'End') onChange(max)
    else return
    event.preventDefault()
    // The page answers to the arrow keys as well; a splitter being moved is not a view being turned.
    event.stopPropagation()
  }

  return (
    <div
      ref={bar}
      className="scene-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onReset?.()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return
        const next = fromPointer(event)
        if (next !== null) onChange(next)
      }}
      onPointerUp={(event) => {
        dragging.current = false
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => { dragging.current = false }}
    >
      <span className="scene-splitter__grip" aria-hidden="true" />
    </div>
  )
}
