import type { Vec2 } from '@/scene/types'

/**
 * Where the UV editor is looking: the one piece of state a 2D canvas needs, and the arithmetic
 * that turns a place in the image into a place on screen and back.
 *
 * The image is the unit square, `v` pointing up as it does in Blender and in OpenGL, while a canvas
 * counts its rows downwards — so `v` is the one axis that flips. `zoom` is the length of the whole
 * image in pixels, which makes it the only number a person can be told: "the image is 512 pixels
 * across". `pan` is where UV (0, 0) — the bottom-left corner of the image — lands on the canvas.
 *
 * Nothing here touches the DOM. Every gesture in the editor is a call into this module and a piece
 * of state handed back, which is what lets the zooming, the fitting and the grid be tested without
 * a canvas at all.
 */

export type UvView = {
  /** Where UV (0, 0) is on the canvas, in CSS pixels from its top-left corner. */
  pan: [number, number]
  /** How many pixels one UV unit — the whole width of the image — covers. */
  zoom: number
}

/** Below this the image is a smudge; above it a single texel fills the view. */
export const MIN_UV_ZOOM = 24
export const MAX_UV_ZOOM = 32768

/** One wheel notch, in the same ratio the viewport's own zoom uses. */
export const UV_ZOOM_STEP = 1.25

export function uvToScreen(view: UvView, uv: Vec2): [number, number] {
  return [view.pan[0] + uv[0] * view.zoom, view.pan[1] - uv[1] * view.zoom]
}

export function screenToUv(view: UvView, point: [number, number]): Vec2 {
  return [(point[0] - view.pan[0]) / view.zoom, (view.pan[1] - point[1]) / view.zoom]
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_UV_ZOOM
  return Math.min(MAX_UV_ZOOM, Math.max(MIN_UV_ZOOM, zoom))
}

/**
 * Zooming with a point held still: the pixel under the pointer is the pixel under it afterwards.
 *
 * This is the whole difference between a zoom that feels like moving closer and one that feels like
 * the picture jumping. The point is kept by moving the pan by however far it would otherwise have
 * travelled.
 */
export function zoomAround(view: UvView, factor: number, anchor: [number, number]): UvView {
  const zoom = clampZoom(view.zoom * factor)
  const ratio = zoom / view.zoom
  return {
    zoom,
    pan: [anchor[0] - (anchor[0] - view.pan[0]) * ratio, anchor[1] - (anchor[1] - view.pan[1]) * ratio],
  }
}

export function panView(view: UvView, dx: number, dy: number): UvView {
  return { zoom: view.zoom, pan: [view.pan[0] + dx, view.pan[1] + dy] }
}

export type UvBounds = { minU: number; minV: number; maxU: number; maxV: number }

/** The unit square, which is what the view frames when there is nothing else to frame. */
export const IMAGE_BOUNDS: UvBounds = { minU: 0, minV: 0, maxU: 1, maxV: 1 }

/**
 * The view that puts a box in the middle of a canvas of this size, with room around it.
 *
 * A box of no width — a single point, or an island collapsed onto a line — would divide by nothing,
 * so it is given the size of the image instead: framing one point means looking at the image it
 * sits in, which is the only useful answer.
 */
export function fitUvView(bounds: UvBounds, size: { width: number; height: number }, margin = 0.08): UvView {
  const width = Math.max(1e-6, bounds.maxU - bounds.minU)
  const height = Math.max(1e-6, bounds.maxV - bounds.minV)
  const room = 1 - Math.min(0.4, Math.max(0, margin)) * 2
  const usable = { width: Math.max(1, size.width), height: Math.max(1, size.height) }
  const zoom = clampZoom(Math.min(usable.width / width, usable.height / height) * room)
  const centreU = (bounds.minU + bounds.maxU) / 2
  const centreV = (bounds.minV + bounds.maxV) / 2
  return { zoom, pan: [usable.width / 2 - centreU * zoom, usable.height / 2 + centreV * zoom] }
}

/**
 * How far apart the grid lines are, in UV units.
 *
 * Powers of two, so that the lines fall on the texel boundaries of an image whose side is a power
 * of two — which every texture in a game engine is. The step is the coarsest one that keeps the
 * lines at least `minPixels` apart, so zooming in subdivides rather than crowding.
 */
export function gridStep(zoom: number, minPixels = 56): number {
  const wanted = Math.max(1, minPixels) / Math.max(1e-6, zoom)
  const power = Math.ceil(Math.log2(wanted))
  return 2 ** Math.min(4, Math.max(-12, power))
}
