import { describe, expect, it } from 'vitest'
import { measurementLabel, measurementReading, nextZoom, zoomAround, zoomToBox } from '@/vector/measure'

describe('reading a measurement', () => {
  it('gives the length and the angle, zero to the right and ninety up', () => {
    expect(measurementReading({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ length: 100, angle: 0 })
    expect(measurementReading({ x: 0, y: 0 }, { x: 0, y: -100 })).toMatchObject({ angle: 90 })
    expect(measurementReading({ x: 0, y: 0 }, { x: 0, y: 100 })).toMatchObject({ angle: 270 })
    expect(measurementReading({ x: 0, y: 0 }, { x: 3, y: -4 }).length).toBe(5)
  })

  it('writes it the way the read-out shows it', () => {
    expect(measurementLabel({ x: 0, y: 0 }, { x: 30, y: -30 })).toBe('42.43 px · 45°')
  })
})

describe('stepping the zoom', () => {
  it('walks up and down the levels and stops at the ends', () => {
    expect(nextZoom(1, 1)).toBe(1.5)
    expect(nextZoom(1, -1)).toBe(0.8)
    expect(nextZoom(8, 1)).toBe(8)
    expect(nextZoom(0.1, -1)).toBe(0.1)
    expect(nextZoom(0.9, 1)).toBe(1)
  })
})

describe('zooming to a box', () => {
  const viewport = { width: 1000, height: 800 }
  const page = { width: 800, height: 600 }

  it('fits the box with a little room and centres on it', () => {
    const result = zoomToBox({ x: 300, y: 200, width: 200, height: 100 }, viewport, page)

    expect(result.zoom).toBeCloseTo(4.76, 1)
    expect(result.pan.x).toBeCloseTo(0, 1)
    // The box sits 50 above the page centre, so the pan pushes it back down by that much, zoomed.
    expect(result.pan.y).toBeCloseTo(50 * result.zoom, 1)
  })

  it('stays inside what the canvas can show', () => {
    expect(zoomToBox({ x: 0, y: 0, width: 1, height: 1 }, viewport, page).zoom).toBe(8)
    expect(zoomToBox({ x: 0, y: 0, width: 100000, height: 100000 }, viewport, page).zoom).toBe(0.1)
  })
})

describe('zooming around the pointer', () => {
  const page = { width: 800, height: 600 }

  it('leaves the point under the pointer where it is', () => {
    const pan = zoomAround({ x: 700, y: 500 }, { x: 0, y: 0 }, 1, 2, page)

    // Doubling the zoom pushes the pan by the offset of the point from the page centre.
    expect(pan).toEqual({ x: -300, y: -200 })
  })

  it('does nothing when the zoom does not change', () => {
    expect(zoomAround({ x: 700, y: 500 }, { x: 12, y: 34 }, 2, 2, page)).toEqual({ x: 12, y: 34 })
  })
})
