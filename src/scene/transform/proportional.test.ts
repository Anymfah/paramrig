import { describe, expect, it } from 'vitest'
import { FALLOFF_KINDS, falloff, proportionalWeights, type FalloffKind } from '@/scene/transform/proportional'

/** The curve values at the centre, half way out and at the edge, as Blender draws them. */
const HALF_WAY: Array<[FalloffKind, number]> = [
  ['smooth', 0.5],
  ['sphere', Math.sqrt(0.75)],
  ['root', Math.SQRT1_2],
  ['inverse-square', 0.75],
  ['sharp', 0.25],
  ['linear', 0.5],
  ['constant', 1],
]

describe('the falloff curves', () => {
  it('gives the whole transform at the centre and none of it at the edge', () => {
    for (const kind of FALLOFF_KINDS) {
      if (kind === 'random') continue
      expect(falloff(kind, 0)).toBeCloseTo(1, 9)
      expect(falloff(kind, 1)).toBeCloseTo(0, 9)
    }
  })

  it('has the shape it is named for half way out', () => {
    for (const [kind, expected] of HALF_WAY) {
      expect(falloff(kind, 0.5)).toBeCloseTo(expected, 9)
    }
  })

  it('gives nothing beyond the radius, however far beyond', () => {
    for (const kind of FALLOFF_KINDS) {
      expect(falloff(kind, 1.5, 7)).toBeCloseTo(0, 9)
    }
  })

  it('scatters the random falloff but gives the same scatter every time', () => {
    const first = falloff('random', 0.5, 12)

    expect(falloff('random', 0.5, 12)).toBe(first)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThanOrEqual(0.5)
    expect(falloff('random', 0.5, 13)).not.toBe(first)
  })
})

describe('weighting a list of vertices', () => {
  const points = [
    { id: 'a', distance: 0 },
    { id: 'b', distance: 1 },
    { id: 'c', distance: 3 },
  ]

  it('drops anything the circle does not reach', () => {
    const weights = proportionalWeights(points, 2, 'linear')

    expect(weights.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(weights[0]!.weight).toBeCloseTo(1, 9)
    expect(weights[1]!.weight).toBeCloseTo(0.5, 9)
  })

  it('weighs nothing at all when there is no radius to speak of', () => {
    expect(proportionalWeights(points, 0, 'smooth')).toEqual([])
  })
})
