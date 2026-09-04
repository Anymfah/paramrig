import { describe, expect, it } from 'vitest'
import { activeUv } from '@/scene/mesh/uv'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import { CHECKER_CELLS, drawUv, imageRect, stretchColour, UV_COLOURS, type UvCanvas } from '@/scene/uv/draw'
import { uvGeometry } from '@/scene/uv/geometry'
import type { UvPaint } from '@/scene/uv/draw'

/**
 * jsdom has no canvas, so the drawing is checked by recording it.
 *
 * The recorder answers the questions that matter and no others: is the image where the view says it
 * is, does the checker cover it, are the lines drawn once each, and — the one that would otherwise
 * only be found by a stuttering editor — does a zoomed-in grid draw a handful of lines rather than
 * one for every step between here and the edge of the image.
 */

type Call = { name: string; args: number[] }

function recorder(): UvCanvas & { calls: Call[]; images: number; styles: string[]; strokes: string[] } {
  const calls: Call[] = []
  const styles: string[] = []
  const strokes: string[] = []
  const note = (name: string) => (...args: number[]) => { calls.push({ name, args }) }
  const canvas = {
    calls,
    images: 0,
    styles,
    strokes,
    save: note('save'),
    restore: note('restore'),
    beginPath: note('beginPath'),
    closePath: note('closePath'),
    moveTo: note('moveTo'),
    lineTo: note('lineTo'),
    rect: note('rect'),
    fillRect: note('fillRect'),
    clearRect: note('clearRect'),
    clip: note('clip'),
    fill: note('fill'),
    stroke: note('stroke'),
    drawImage: () => { canvas.images += 1 },
    _fillStyle: '',
    get fillStyle() { return canvas._fillStyle },
    set fillStyle(value: string) {
      canvas._fillStyle = value
      styles.push(String(value))
    },
    _strokeStyle: '',
    get strokeStyle() { return canvas._strokeStyle },
    set strokeStyle(value: string) {
      canvas._strokeStyle = value
      strokes.push(String(value))
    },
    lineWidth: 1,
    globalAlpha: 1,
    lineJoin: 'round' as CanvasLineJoin,
  }
  return canvas as unknown as UvCanvas & { calls: Call[]; images: number; styles: string[]; strokes: string[] }
}

function paint(over: Partial<UvPaint> = {}): UvPaint {
  return {
    view: { pan: [50, 350], zoom: 300 },
    size: { width: 400, height: 400 },
    colours: UV_COLOURS,
    background: 'checker',
    image: null,
    grid: true,
    stretch: null,
    geometry: null,
    pointRadius: 2.5,
    ...over,
  }
}

describe('drawing the UV editor', () => {
  it('puts the image where the view says the unit square is', () => {
    const rect = imageRect({ pan: [50, 350], zoom: 300 })
    // The top-left of the image on screen is UV (0, 1), because v climbs and rows do not.
    expect(rect).toEqual({ x: 50, y: 50, width: 300, height: 300 })
  })

  it('fills the checker inside the image and nowhere else', () => {
    const ctx = recorder()
    drawUv(ctx, paint())
    expect(ctx.calls.filter((call) => call.name === 'clip')).toHaveLength(1)
    const cells = ctx.calls.filter((call) => call.name === 'fillRect' && call.args[2]! < 300)
    expect(cells).toHaveLength(CHECKER_CELLS * CHECKER_CELLS)
    expect(ctx.styles).toContain(UV_COLOURS.checkerLight)
    expect(ctx.styles).toContain(UV_COLOURS.checkerDark)
  })

  it('draws the material image only when there is one to draw', () => {
    const withNone = recorder()
    drawUv(withNone, paint({ background: 'texture' }))
    expect(withNone.images).toBe(0)
    const withOne = recorder()
    drawUv(withOne, paint({ background: 'texture', image: {} as CanvasImageSource }))
    expect(withOne.images).toBe(1)
    // And with the image on, the checker is not underneath it.
    expect(withOne.styles).not.toContain(UV_COLOURS.checkerLight)
  })

  it('draws only the grid lines that cross the canvas, however far it is zoomed in', () => {
    const near = recorder()
    drawUv(near, paint({ view: { pan: [-9000, 9000], zoom: 20000 } }))
    const lines = near.calls.filter((call) => call.name === 'moveTo').length
    expect(lines).toBeGreaterThan(0)
    expect(lines).toBeLessThan(40)
  })

  it('draws every edge of the mesh once, and a square for every point', () => {
    const mesh = planeMesh()
    const geometry = uvGeometry(mesh, activeUv(mesh)!)
    const ctx = recorder()
    drawUv(ctx, paint({ geometry, grid: false }))
    const segments = ctx.calls.filter((call) => call.name === 'lineTo')
    // Four sides of the square, plus the four sides of the image border's own rect.
    expect(segments).toHaveLength(4)
    const points = ctx.calls.filter((call) => call.name === 'fillRect' && call.args[2] === 5)
    expect(points).toHaveLength(4)
  })

  it('gives every line and every point a casing, so both read on any image', () => {
    const mesh = planeMesh()
    const geometry = uvGeometry(mesh, activeUv(mesh)!)
    const ctx = recorder()
    drawUv(ctx, paint({ geometry, grid: false }))
    // The casing is stroked before the line, so the line is what is seen.
    expect(ctx.strokes.indexOf(UV_COLOURS.halo)).toBeLessThan(ctx.strokes.indexOf(UV_COLOURS.edge))
    expect(ctx.calls.filter((call) => call.name === 'fillRect' && call.args[2] === 7)).toHaveLength(4)
    expect(ctx.calls.filter((call) => call.name === 'fillRect' && call.args[2] === 5)).toHaveLength(4)
  })

  it('leaves a point that is off the canvas undrawn', () => {
    const mesh = planeMesh()
    const geometry = uvGeometry(mesh, activeUv(mesh)!)
    const ctx = recorder()
    drawUv(ctx, paint({ geometry, grid: false, view: { pan: [-5000, 5000], zoom: 300 } }))
    expect(ctx.calls.filter((call) => call.name === 'fillRect' && call.args[2] === 5)).toHaveLength(0)
  })

  it('fills each face with its own place on the stretch ramp', () => {
    const cube = boxMesh()
    const geometry = uvGeometry(cube, activeUv(cube)!)
    const ctx = recorder()
    drawUv(ctx, paint({ geometry, grid: false, stretch: [0, 0.25, 0.5, 0.75, 1, 0] }))
    expect(ctx.calls.filter((call) => call.name === 'fill')).toHaveLength(6)
    expect(ctx.styles).toContain(UV_COLOURS.stretchLow)
    expect(ctx.styles).toContain(UV_COLOURS.stretchHigh)
  })

  it('ramps cold to warm through the middle rather than through mud', () => {
    expect(stretchColour(UV_COLOURS, 0)).toBe(UV_COLOURS.stretchLow)
    expect(stretchColour(UV_COLOURS, 0.5)).toBe(UV_COLOURS.stretchMid)
    expect(stretchColour(UV_COLOURS, 1)).toBe(UV_COLOURS.stretchHigh)
    expect(stretchColour(UV_COLOURS, -3)).toBe(UV_COLOURS.stretchLow)
    expect(stretchColour(UV_COLOURS, 9)).toBe(UV_COLOURS.stretchHigh)
  })
})
