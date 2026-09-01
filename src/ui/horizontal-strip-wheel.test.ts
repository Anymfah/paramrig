import { describe, expect, it } from 'vitest'
import { horizontalStripWheel } from '@/ui/horizontal-strip-wheel'

describe('horizontalStripWheel', () => {
  it('maps a mouse-wheel deltaY onto the strip', () => {
    expect(horizontalStripWheel({ deltaX: 0, deltaY: 40, deltaMode: 0 }, 320)).toBe(40)
  })

  it('leaves a trackpad pan to native overflow-x', () => {
    expect(horizontalStripWheel({ deltaX: 80, deltaY: 4, deltaMode: 0 }, 320)).toBe(0)
  })

  it('maps a mostly-vertical trackpad flick', () => {
    expect(horizontalStripWheel({ deltaX: 3, deltaY: 60, deltaMode: 0 }, 320)).toBe(60)
  })

  it('does not steal a 45-degree pan from the trackpad', () => {
    expect(horizontalStripWheel({ deltaX: 30, deltaY: 30, deltaMode: 0 }, 320)).toBe(0)
  })

  it('scales line and page delta modes', () => {
    expect(horizontalStripWheel({ deltaX: 0, deltaY: 2, deltaMode: 1 }, 320)).toBe(32)
    expect(horizontalStripWheel({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 200)).toBe(200)
  })
})
