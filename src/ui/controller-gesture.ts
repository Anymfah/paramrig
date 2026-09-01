import { useEffect, useRef, type PointerEvent } from 'react'

export type GestureProps = {
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onGestureCancel?: () => void
}

/** Shared pointer transaction: exactly one history entry, cancellation on interruption. */
export function useControllerGesture(props: GestureProps) {
  const active = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const finish = (cancel = false) => {
    if (!active.current) return
    active.current = false
    if (cancel) latest.current.onGestureCancel?.()
    else latest.current.onGestureEnd?.()
  }
  useEffect(() => {
    const cancel = () => finish(true)
    const up = () => finish()
    const key = (e: KeyboardEvent) => { if (e.key==='Escape' && active.current) {e.preventDefault(); finish(true)} }
    window.addEventListener('blur',cancel)
    window.addEventListener('pointercancel',cancel)
    window.addEventListener('pointerup',up)
    window.addEventListener('keydown',key,true)
    return () => { cancel(); window.removeEventListener('blur',cancel); window.removeEventListener('pointercancel',cancel); window.removeEventListener('pointerup',up); window.removeEventListener('keydown',key,true) }
  }, [])
  return {
    active,
    start(e: PointerEvent<HTMLElement>, native = false) {
      if (e.button!==0) return false
      if (!native) e.preventDefault()
      e.currentTarget.focus()
      e.currentTarget.setPointerCapture(e.pointerId)
      active.current=true
      latest.current.onGestureStart?.()
      return true
    },
    finish,
    handlers: { onPointerUp:()=>finish(), onPointerCancel:()=>finish(true), onLostPointerCapture:()=>finish(true) },
  }
}
