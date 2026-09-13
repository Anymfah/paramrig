import { useSyncExternalStore } from 'react'
import { subscribeFontMetrics, fontMetricsRevision } from './fontMetricsStore'
export { fontMetricsRevision, invalidateFontMetrics } from './fontMetricsStore'
const serverRevision = () => 0

/** Reflow text after an on-demand font load, without resetting camera or editor gestures. */
export function useFontMetricsRevision(): number {
  return useSyncExternalStore(subscribeFontMetrics, fontMetricsRevision, serverRevision)
}
