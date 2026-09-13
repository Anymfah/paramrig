import { describe, expect, it } from 'vitest'
import { mulberry32, streamFor } from '@/audio/dsp/rng'

describe('mulberry32', () => {
  it('returns the same sequence for the same seed', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const first = Array.from({ length: 64 }, () => a())
    const second = Array.from({ length: 64 }, () => b())
    expect(first).toEqual(second)
  })

  it('stays inside the unit interval', () => {
    const next = mulberry32(7)
    for (let i = 0; i < 5000; i += 1) {
      const value = next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('does not settle on one value', () => {
    const next = mulberry32(99)
    const seen = new Set(Array.from({ length: 500 }, () => next()))
    expect(seen.size).toBeGreaterThan(400)
  })
})

describe('streamFor', () => {
  it('gives each layer a different stream from one patch seed', () => {
    const zero = streamFor(4, 0)
    const one = streamFor(4, 1)
    expect(Array.from({ length: 16 }, () => zero())).not.toEqual(Array.from({ length: 16 }, () => one()))
  })

  it('is stable per layer, so editing one layer cannot reshuffle another', () => {
    const first = streamFor(4, 2)
    const again = streamFor(4, 2)
    expect(Array.from({ length: 16 }, () => first())).toEqual(Array.from({ length: 16 }, () => again()))
  })
})
