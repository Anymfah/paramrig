
let revision = 0
const listeners = new Set<() => void>()
const notify = () => { revision++; for (const listener of listeners) listener() }
export const invalidateFontMetrics = notify

/** A cached line layout is no longer valid when the real face replaces its fallback. */
export const fontMetricsRevision = () => revision

export function subscribeFontMetrics(listener: () => void): () => void {
  const fonts = globalThis.document?.fonts
  if (!fonts?.addEventListener) return () => undefined
  if (listeners.size === 0) fonts.addEventListener('loadingdone', notify)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) fonts.removeEventListener('loadingdone', notify)
  }
}
