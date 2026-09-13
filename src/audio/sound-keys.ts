const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

export function isSoundCursorKey(key: string): boolean {
  return KEYS.has(key)
}

/**
 * How many cards sit on the first row. A grid that has not been laid out yet, or that fits on a
 * single row, reports every item at the same offset — treat that as a list, so Down still walks.
 */
export function columnCount(items: Array<Pick<HTMLElement, 'offsetTop'>>): number {
  if (items.length < 2) return 1
  const top = items[0]?.offsetTop
  let columns = 1
  for (let i = 1; i < items.length; i += 1) {
    if (items[i]?.offsetTop !== top) break
    columns += 1
  }
  return columns === items.length ? 1 : columns
}

export function nextSoundIndex(key: string, at: number, count: number, columns = 1): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  const stride = key === 'ArrowDown' || key === 'ArrowUp' ? Math.max(1, columns) : 1
  const by = key === 'ArrowRight' || key === 'ArrowDown' ? stride
    : key === 'ArrowLeft' || key === 'ArrowUp' ? -stride
    : 0
  if (!by) return null
  const from = at >= 0 ? at : by > 0 ? -1 : 0
  return ((from + by) % count + count) % count
}

/** The next item to hear, or null if this key is not a move from a sound in the list. */
export function moveSoundFocus(event: KeyboardEvent, items: HTMLElement[], columns?: number): number | null {
  if (!isSoundCursorKey(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return null
  const target = event.target
  if (!(target instanceof HTMLElement)) return null
  const at = items.indexOf(target)
  if (at < 0) return null
  const next = nextSoundIndex(event.key, at, items.length, columns ?? columnCount(items))
  if (next === null) return null
  event.preventDefault()
  return next
}
