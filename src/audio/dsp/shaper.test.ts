import { describe, expect, it } from 'vitest'
import { createShaper, crushSample, saturate } from '@/audio/dsp/shaper'

describe('saturate', () => {
  it('is an exact bypass at no drive, not a gentle one', () => {
    for (const value of [-0.9, -0.31, 0, 0.25, 0.87]) expect(saturate(value, 0)).toBe(value)
  })

  it('lifts quiet material and squeezes loud material as drive rises', () => {
    expect(saturate(0.2, 0.8)).toBeGreaterThan(0.2)
    expect(Math.abs(saturate(1, 0.8))).toBeLessThanOrEqual(1.0001)
  })

  it('stays finite whatever it is asked for', () => {
    for (let i = 0; i < 500; i += 1) expect(Number.isFinite(saturate(Math.sin(i) * 9, 5))).toBe(true)
  })
})

describe('crushSample', () => {
  it('is an exact bypass at sixteen bits and no hold', () => {
    const state = createShaper()
    for (const value of [-0.9, -0.31, 0, 0.25, 0.87]) expect(crushSample(state, 16, 0, value)).toBe(value)
  })

  it('quantises to the requested number of bits', () => {
    expect(crushSample(createShaper(), 2, 0, 0.31) * 2).toBeCloseTo(Math.round(0.31 * 2), 9)
  })

  it('holds a sample when crushing instead of following the input', () => {
    const state = createShaper()
    const first = crushSample(state, 16, 0.5, 1)
    expect(crushSample(state, 16, 0.5, -1)).toBe(first)
  })

  it('stays finite on absurd settings', () => {
    const state = createShaper()
    for (let i = 0; i < 500; i += 1) expect(Number.isFinite(crushSample(state, -3, 9, Math.sin(i)))).toBe(true)
  })
})
