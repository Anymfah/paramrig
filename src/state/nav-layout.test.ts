import { describe, expect, it } from 'vitest'
import { NAV_WIDTH_COMPACT, NAV_WIDTH_DEFAULT, NAV_WIDTH_MIN } from '@/state/persistence'
import {
  NAV_DESKTOP_MIN_PX,
  isNavCompact,
  navColumnWidth,
  navResizeOrigin,
  snapNavResize,
  stepNavResize,
} from '@/state/nav-layout'

const open = { navCollapsed: false, navCompact: false, navWidth: NAV_WIDTH_DEFAULT }
const compact = { navCollapsed: false, navCompact: true, navWidth: NAV_WIDTH_DEFAULT }

describe('nav layout', () => {
  it('keeps the last expanded width when the rail is compact', () => {
    expect(navColumnWidth(compact, NAV_DESKTOP_MIN_PX)).toBe(NAV_WIDTH_COMPACT)
    expect(navColumnWidth(compact, NAV_DESKTOP_MIN_PX - 1)).toBe(NAV_WIDTH_DEFAULT)
  })

  it('hides the column when the nav is fully collapsed', () => {
    expect(navColumnWidth({ ...open, navCollapsed: true }, NAV_DESKTOP_MIN_PX)).toBe(0)
    expect(isNavCompact({ navCollapsed: true, navCompact: true }, NAV_DESKTOP_MIN_PX)).toBe(false)
  })

  it('snaps below the expanded minimum into compact without losing width', () => {
    expect(snapNavResize(NAV_WIDTH_MIN - 1, 240)).toEqual({ navCompact: true, navWidth: 240 })
    expect(snapNavResize(NAV_WIDTH_MIN, 240)).toEqual({ navCompact: false, navWidth: NAV_WIDTH_MIN })
  })

  it('starts a compact drag close to the expanded minimum so a short pull opens it', () => {
    expect(navResizeOrigin({ navCompact: true, navWidth: 240 })).toBeLessThan(NAV_WIDTH_MIN)
    expect(navResizeOrigin({ navCompact: false, navWidth: 240 })).toBe(240)
  })

  it('opens compact with one keyboard step to the right', () => {
    expect(stepNavResize(true, 240, 1, 8)).toEqual({ navCompact: false, navWidth: 240 })
    expect(stepNavResize(false, NAV_WIDTH_MIN, -1, 8)).toEqual({ navCompact: true, navWidth: NAV_WIDTH_MIN })
  })
})
