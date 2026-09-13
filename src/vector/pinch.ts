/** WebKit reports trackpad pinch as gesture events instead of Chromium's ctrl-wheel. */
export function bindWebKitPinch(viewport: HTMLElement, zoom: (ratio: number, x: number, y: number) => void) {
  let active = false
  let previous = 1
  const start = (event: Event) => {
    event.preventDefault()
    active = true
    previous = 1
  }
  const change = (event: Event) => {
    event.preventDefault()
    if (!active) return
    const gesture = event as Event & { scale: number; clientX: number; clientY: number }
    if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return
    zoom(gesture.scale / previous, gesture.clientX, gesture.clientY)
    previous = gesture.scale
  }
  const end = (event: Event) => { event.preventDefault(); active = false }
  viewport.addEventListener('gesturestart', start, { passive: false })
  viewport.addEventListener('gesturechange', change, { passive: false })
  viewport.addEventListener('gestureend', end, { passive: false })
  return {
    active: () => active,
    dispose: () => {
      viewport.removeEventListener('gesturestart', start)
      viewport.removeEventListener('gesturechange', change)
      viewport.removeEventListener('gestureend', end)
    },
  }
}
