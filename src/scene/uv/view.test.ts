import { describe, expect, it } from 'vitest'
import {
  clampZoom,
  fitUvView,
  gridStep,
  IMAGE_BOUNDS,
  MAX_UV_ZOOM,
  MIN_UV_ZOOM,
  panView,
  screenToUv,
  uvToScreen,
  zoomAround,
} from '@/scene/uv/view'

/**
 * The one thing that has to hold everywhere else: a point put on screen and read back is the point
 * it started as. Everything the editor does — a click, a drag, a marquee — is one of those two
 * conversions, so a sign error here would be a sign error in all of them.
 */

const VIEW = { pan: [100, 400] as [number, number], zoom: 256 }

describe('the UV view', () => {
  it('puts the image the right way up: v climbs the screen', () => {
    expect(uvToScreen(VIEW, [0, 0])).toEqual([100, 400])
    expect(uvToScreen(VIEW, [1, 0])).toEqual([356, 400])
    expect(uvToScreen(VIEW, [0, 1])).toEqual([100, 144])
  })

  it('reads a point back exactly where it was put', () => {
    for (const uv of [[0, 0], [0.25, 0.75], [1, 1], [-0.3, 2.5]] as Array<[number, number]>) {
      const back = screenToUv(VIEW, uvToScreen(VIEW, uv))
      expect(back[0]).toBeCloseTo(uv[0], 12)
      expect(back[1]).toBeCloseTo(uv[1], 12)
    }
  })

  it('keeps the point under the pointer still while zooming', () => {
    const anchor: [number, number] = [310, 220]
    const before = screenToUv(VIEW, anchor)
    for (const factor of [1.25, 0.8, 4, 0.1]) {
      const after = screenToUv(zoomAround(VIEW, factor, anchor), anchor)
      expect(after[0]).toBeCloseTo(before[0], 9)
      expect(after[1]).toBeCloseTo(before[1], 9)
    }
  })

  it('will not zoom past the ends, and a clamped zoom still holds the anchor', () => {
    const anchor: [number, number] = [10, 10]
    expect(zoomAround(VIEW, 1e9, anchor).zoom).toBe(MAX_UV_ZOOM)
    expect(zoomAround(VIEW, 1e-9, anchor).zoom).toBe(MIN_UV_ZOOM)
    const far = zoomAround(VIEW, 1e9, anchor)
    expect(screenToUv(far, anchor)[0]).toBeCloseTo(screenToUv(VIEW, anchor)[0], 9)
    expect(clampZoom(Number.NaN)).toBe(MIN_UV_ZOOM)
  })

  it('pans by pixels, and never changes the scale', () => {
    const moved = panView(VIEW, -40, 12)
    expect(moved.pan).toEqual([60, 412])
    expect(moved.zoom).toBe(VIEW.zoom)
  })

  it('frames the image in the middle of the canvas, with room around it', () => {
    const view = fitUvView(IMAGE_BOUNDS, { width: 800, height: 400 })
    // The short side is what the fit is against, less the margin either side.
    expect(view.zoom).toBeCloseTo(400 * (1 - 0.08 * 2), 6)
    const centre = uvToScreen(view, [0.5, 0.5])
    expect(centre[0]).toBeCloseTo(400, 6)
    expect(centre[1]).toBeCloseTo(200, 6)
  })

  it('frames a box that is one point by looking at the image it sits in', () => {
    const view = fitUvView({ minU: 0.5, minV: 0.5, maxU: 0.5, maxV: 0.5 }, { width: 300, height: 300 })
    expect(view.zoom).toBe(MAX_UV_ZOOM)
    expect(uvToScreen(view, [0.5, 0.5])).toEqual([150, 150])
  })

  it('survives a canvas of no size, which is what a hidden panel has', () => {
    const view = fitUvView(IMAGE_BOUNDS, { width: 0, height: 0 })
    expect(Number.isFinite(view.zoom)).toBe(true)
    expect(Number.isFinite(view.pan[0])).toBe(true)
  })

  it('subdivides the grid by powers of two as it is zoomed into', () => {
    expect(gridStep(64)).toBe(1)
    expect(gridStep(256)).toBe(0.25)
    expect(gridStep(4096)).toBe(1 / 64)
    // Every step keeps the lines at least the asked-for distance apart.
    for (const zoom of [40, 100, 333, 1024, 20000]) {
      expect(gridStep(zoom) * zoom).toBeGreaterThanOrEqual(56)
    }
  })
})
