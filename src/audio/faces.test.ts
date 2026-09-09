import { describe, expect, it } from 'vitest'
import { FOLD, NARROW, PLATE, ROWS, fitPlate, rowB } from '@/audio/faces'

describe('the two faces of the plate', () => {
  it('keeps the wide face wherever it can be read, at the scale that fits the room whole', () => {
    expect(fitPlate(1500, 744)).toEqual({ layout: 'wide', scale: Math.min(1500 / PLATE.w, 744 / PLATE.h) })
    expect(fitPlate(1040, 700)).toEqual({ layout: 'wide', scale: 1040 / PLATE.w })
    // A big screen gets a big plate, as the plugin's own zoom would give it.
    expect(fitPlate(2000, 1200).layout).toBe('wide')
    expect(fitPlate(2000, 1200).scale).toBeGreaterThan(1)
  })

  it('folds rather than shrink the wide face below the fold, and keeps its own size', () => {
    expect(fitPlate(784, 668)).toEqual({ layout: 'narrow', scale: 1 })
    expect(fitPlate(820, 930)).toEqual({ layout: 'narrow', scale: 1 })
    expect(FOLD).toBeLessThan(1)
  })

  it('fits the fold to a room narrower than itself', () => {
    expect(fitPlate(430, 680)).toEqual({ layout: 'narrow', scale: 430 / NARROW.w })
  })

  it('keeps the wide face in a room that is wide but short, and lets it scroll', () => {
    expect(fitPlate(1200, 400)).toEqual({ layout: 'wide', scale: Math.min(1, 1200 / PLATE.w) })
  })

  it('stretches row B in step to the narrow width, and leaves the reference row alone on the wide face', () => {
    const wide = rowB('wide')
    expect(wide.body).toEqual({ x: 696.5, y: 54, w: 159 })
    expect(wide.fx.x + wide.fx.w).toBe(PLATE.w)
    const narrow = rowB('narrow')
    expect(narrow.body.x).toBe(0)
    expect(narrow.fx.x + narrow.fx.w).toBeCloseTo(NARROW.w, 6)
    expect(narrow.filter.w / wide.filter.w).toBeCloseTo(narrow.amp.w / wide.amp.w, 6)
    expect(narrow.filter.x).toBeCloseTo(narrow.body.x + narrow.body.w + 1.5, 6)
    expect(narrow.body.y).toBe(ROWS.narrow.b)
  })

  it('stacks the narrow face without overlap, to its own height', () => {
    const rows = ROWS.narrow
    expect(rows.a).toBeGreaterThanOrEqual(rows.band)
    expect(rows.b).toBeGreaterThanOrEqual(rows.a + 288)
    expect(rows.routing).toBeGreaterThanOrEqual(rows.b + 288)
    expect(rows.modulators).toBeGreaterThanOrEqual(rows.routing + 39)
    expect(rows.strip).toBeGreaterThanOrEqual(rows.modulators + 288)
    expect(rows.strip + 23).toBe(NARROW.h)
    // Every rule lies in the gap between two bands, as the reference draws them: over the last half
    // pixel of the band above, up to the first of the band below.
    const bands: [number, number][] = [[0, rows.band], [rows.a, rows.a + 288], [rows.b, rows.b + 288], [rows.routing, rows.routing + 39], [rows.modulators, rows.modulators + 288], [rows.strip, NARROW.h]]
    for (const [top, thickness] of rows.rules) {
      const between = bands.slice(1).some(([from], index) => {
        const above = bands[index]?.[1] ?? 0
        return top >= above - 1 && top + thickness <= from + 1e-9
      })
      expect(between, `rule at ${top}`).toBe(true)
    }
  })
})
