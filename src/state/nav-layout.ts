import type { PanelPrefs } from '@/rigs/types'
import {
  NAV_COMPACT_EXPAND_SLACK,
  NAV_WIDTH_COMPACT,
  NAV_WIDTH_MAX,
  NAV_WIDTH_MIN,
} from '@/state/persistence'

export const NAV_DESKTOP_MIN_PX = 64 * 16

export function isNavCompact(prefs: Pick<PanelPrefs, 'navCollapsed' | 'navCompact'>, viewportWidth: number) {
  return !prefs.navCollapsed && prefs.navCompact && viewportWidth >= NAV_DESKTOP_MIN_PX
}

export function navColumnWidth(
  prefs: Pick<PanelPrefs, 'navCollapsed' | 'navCompact' | 'navWidth'>,
  viewportWidth: number,
) {
  if (prefs.navCollapsed) return 0
  if (isNavCompact(prefs, viewportWidth)) return NAV_WIDTH_COMPACT
  return prefs.navWidth
}

export function navResizeOrigin(prefs: Pick<PanelPrefs, 'navCompact' | 'navWidth'>) {
  return prefs.navCompact ? NAV_WIDTH_MIN - NAV_COMPACT_EXPAND_SLACK : prefs.navWidth
}

export function snapNavResize(
  raw: number,
  expandedWidth: number,
): Pick<PanelPrefs, 'navCompact' | 'navWidth'> {
  if (raw < NAV_WIDTH_MIN) {
    return { navCompact: true, navWidth: expandedWidth }
  }
  return {
    navCompact: false,
    navWidth: Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, Math.round(raw))),
  }
}

export function stepNavResize(
  compact: boolean,
  navWidth: number,
  direction: -1 | 1,
  step: number,
): Pick<PanelPrefs, 'navCompact' | 'navWidth'> {
  if (direction > 0 && compact) return { navCompact: false, navWidth }
  if (direction < 0 && (compact || navWidth <= NAV_WIDTH_MIN)) return { navCompact: true, navWidth }
  return snapNavResize(navWidth + direction * step, navWidth)
}
