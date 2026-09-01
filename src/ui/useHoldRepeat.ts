import { useRef } from 'react'

const DELAY_MS = 400
const INTERVAL_MS = 70

export function useHoldRepeat(onTick: (direction: 1 | -1) => void, onStart?: () => void, onEnd?: () => void) {
  const timer = useRef(0)
  const interval = useRef(0)
  const active = useRef(false)

  const clearTimers = () => {
    window.clearTimeout(timer.current)
    window.clearInterval(interval.current)
    timer.current = 0
    interval.current = 0
  }

  const stop = () => {
    clearTimers()
    if (!active.current) return
    active.current = false
    onEnd?.()
  }

  const start = (direction: 1 | -1) => {
    clearTimers()
    if (!active.current) {
      active.current = true
      onStart?.()
    }
    onTick(direction)
    timer.current = window.setTimeout(() => {
      interval.current = window.setInterval(() => onTick(direction), INTERVAL_MS)
    }, DELAY_MS)
  }

  return { start, stop }
}
