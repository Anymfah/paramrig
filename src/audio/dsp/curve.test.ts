import { describe, expect, it } from 'vitest'
import { EASE_IN, EASE_OUT, LINEAR, curveAt } from '@/audio/dsp/curve'

describe('curveAt', () => {
  it('passes through both anchors', () => {
    for (const curve of [LINEAR, EASE_IN, EASE_OUT]) {
      expect(curveAt(curve, 0)).toBeCloseTo(0, 6)
      expect(curveAt(curve, 1)).toBeCloseTo(1, 6)
    }
  })

  it('is the identity on the linear curve', () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(curveAt(LINEAR, x)).toBeCloseTo(x, 3)
  })

  it('clamps outside the unit interval rather than extrapolating', () => {
    expect(curveAt(LINEAR, -3)).toBeCloseTo(0, 6)
    expect(curveAt(LINEAR, 4)).toBeCloseTo(1, 6)
  })

  it('rises without ever turning back', () => {
    for (const curve of [LINEAR, EASE_IN, EASE_OUT]) {
      let previous = -Infinity
      for (let i = 0; i <= 100; i += 1) {
        const y = curveAt(curve, i / 100)
        expect(y).toBeGreaterThanOrEqual(previous - 1e-6)
        previous = y
      }
    }
  })

  it('spends the slide early on ease-out and late on ease-in', () => {
    expect(curveAt(EASE_OUT, 0.25)).toBeGreaterThan(0.25)
    expect(curveAt(EASE_IN, 0.25)).toBeLessThan(0.25)
  })
})
