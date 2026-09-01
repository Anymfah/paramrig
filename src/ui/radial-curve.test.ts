import { describe, expect, it } from 'vitest'
import { radialFillPath, radialStrokePath, radialTangents, sampleRadialAt, sampleRadialCurve } from './radial-curve'

describe('radial curve sampling', () => {
  it('uses a constant slope for two points', () => {
    expect(radialTangents([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([1, 1])
  })
  it('samples a linear segment as a straight line', () => {
    const samples = sampleRadialCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    expect(samples[0]).toEqual({ x: 0, y: 0 })
    expect(samples.at(-1)).toEqual({ x: 1, y: 1 })
    expect(sampleRadialAt([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.5)).toBeCloseTo(0.5, 5)
  })
  it('zeroes a tangent at a peak so the curve does not overshoot', () => {
    const tangents = radialTangents([{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }])
    expect(tangents[1]).toBe(0)
    expect(sampleRadialAt([{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }], 0.5)).toBeCloseTo(1, 5)
  })
  it('builds SVG paths in a 100 by 100 plot', () => {
    expect(radialStrokePath([{ x: 0, y: 1 }, { x: 1, y: 0 }])).toMatch(/^M0,0/)
    expect(radialFillPath([{ x: 0, y: 1 }, { x: 1, y: 0 }])).toMatch(/Z$/)
  })
})
