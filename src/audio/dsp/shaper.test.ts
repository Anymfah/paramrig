import { describe, expect, it } from 'vitest'
import type { ShaperSettings } from '@/audio/types'
import { createShaper, shapeSample } from '@/audio/dsp/shaper'

const settings = (over: Partial<ShaperSettings> = {}): ShaperSettings => ({ drive: 0, bitDepth: 16, crush: 0, ...over })

describe('shapeSample', () => {
  it('is an exact bypass when nothing is engaged', () => {
    const state = createShaper()
    for (const value of [-0.9, -0.31, 0, 0.25, 0.87]) {
      expect(shapeSample(state, settings(), value)).toBe(value)
    }
  })

  it('lifts quiet material and squeezes loud material as drive rises', () => {
    const clean = shapeSample(createShaper(), settings(), 0.2)
    const driven = shapeSample(createShaper(), settings({ drive: 0.8 }), 0.2)
    expect(driven).toBeGreaterThan(clean)
    expect(Math.abs(shapeSample(createShaper(), settings({ drive: 0.8 }), 1))).toBeLessThanOrEqual(1.0001)
  })

  it('quantises to the requested number of bits', () => {
    const state = createShaper()
    const out = shapeSample(state, settings({ bitDepth: 2 }), 0.31)
    expect(out * 2).toBeCloseTo(Math.round(0.31 * 2), 9)
  })

  it('holds a sample when crushing instead of following the input', () => {
    const state = createShaper()
    const first = shapeSample(state, settings({ crush: 0.5 }), 1)
    const second = shapeSample(state, settings({ crush: 0.5 }), -1)
    expect(second).toBe(first)
  })

  it('stays finite on absurd settings', () => {
    const state = createShaper()
    for (let i = 0; i < 500; i += 1) {
      const out = shapeSample(state, settings({ drive: 5, bitDepth: -3, crush: 9 }), Math.sin(i))
      expect(Number.isFinite(out)).toBe(true)
    }
  })
})
