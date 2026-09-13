import { describe, expect, it } from 'vitest'
import { projectRelief, projectedDepth, unprojectedDepth, reliefLayout, type ReliefLayout } from './reliefLayout'

describe('centred relief perspective', () => {
  it('projects a known camera frame and keeps the vanishing direction centred', () => {
    const layout: ReliefLayout = { w: 1000, h: 500, x0: 100, x1: 900, y0: 400, shiftY: 200, height: 100, perspective: 0.5, wave: null, axes: { time: true, level: true, frequency: true } }
    expect(projectRelief(layout, 0.5, 1, 0)).toEqual({ x: 500, y: 200 })
    expect(projectRelief(layout, 1, 1, 1).x).toBeCloseTo(766.6667, 4)
    expect(projectRelief(layout, 1, 1, 1).y).toBeCloseTo(133.3333, 4)
    for (const depth of [0, 0.3, 0.75, 1]) {
      const left = projectRelief(layout, 0.2, depth, 0.7)
      const right = projectRelief(layout, 0.8, depth, 0.7)
      expect(left.x + right.x).toBeCloseTo(1000, 6)
      expect(left.y).toBe(right.y)
      expect(projectRelief(layout, 0.5, depth, 1).x).toBe(500)
    }
  })

  it('fits the volume and keeps a visible frequency plane across viewport sizes', () => {
    for (const [width, height] of [[1200, 440], [850, 440], [350, 380], [296, 380]]) {
      for (const view of ['spectrum', 'both'] as const) {
        const layout = reliefLayout(width!, height!, view)
        expect(layout.shiftY).toBeGreaterThan(layout.height * 2)
        for (const t of [0, 0.5, 1]) for (const depth of [0, 0.5, 1]) for (const level of [0, 1]) {
          const point = projectRelief(layout, t, depth, level)
          expect(point.x).toBeGreaterThanOrEqual(0)
          expect(point.x).toBeLessThanOrEqual(width!)
          expect(point.y).toBeGreaterThanOrEqual(0)
          expect(point.y).toBeLessThanOrEqual(layout.y0)
        }
      }
    }
  })

  it('gives the 50 Hz–1 kHz band about three quarters of the visible frequency plane', () => {
    const position = (hz: number) => Math.log(hz / 40) / Math.log(20000 / 40)
    for (const width of [1200, 350]) {
      const layout = reliefLayout(width, 440, 'spectrum')
      const low = projectedDepth(layout, position(50))
      const middle = projectedDepth(layout, position(1000))
      const high = projectedDepth(layout, position(20000))
      expect((middle - low) / (high - low)).toBeGreaterThan(0.73)
      expect((middle - low) / (high - low)).toBeLessThan(0.77)
      // A focused projection must stay invertible, so dragging Bite never jumps or reverses.
      for (let i = 0; i <= 100; i++) {
        const depth = i / 100
        expect(unprojectedDepth(layout, projectedDepth(layout, depth))).toBeCloseTo(depth, 10)
        if (i) expect(projectedDepth(layout, depth)).toBeGreaterThan(projectedDepth(layout, depth - 0.01))
      }
    }
  })
})
