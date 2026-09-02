import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE, luminance, marchingSquares, polygonArea, sanitizeTraceOptions, traceBitmap } from '@/vector/trace'

/** A bitmap with a black disc on white, the classic thing to trace. */
function disc(size: number, radius: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4)
  const centre = size / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) <= radius
      const offset = (y * size + x) * 4
      const value = inside ? 0 : 255
      pixels[offset] = value
      pixels[offset + 1] = value
      pixels[offset + 2] = value
      pixels[offset + 3] = 255
    }
  }
  return pixels
}

describe('tracing a silhouette', () => {
  it('finds the disc, and its area is the one the disc has', () => {
    const size = 128
    const radius = 40
    const [layer] = traceBitmap(disc(size, radius), size, size, { ...DEFAULT_TRACE, smoothing: 0, minArea: 4 })

    expect(layer!.loops).toHaveLength(1)
    const area = Math.abs(polygonArea(layer!.loops[0]!))
    const expected = Math.PI * radius * radius
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.03)
  })

  it('paints it in the colour it found', () => {
    const size = 64
    const [layer] = traceBitmap(disc(size, 20), size, size, { ...DEFAULT_TRACE, smoothing: 0, minArea: 4 })

    expect(layer!.color).toBe('#000000')
  })

  it('drops the specks smaller than the floor', () => {
    const size = 64
    const pixels = disc(size, 20)
    // One black pixel in a corner: noise, not a shape.
    pixels[0] = 0
    pixels[1] = 0
    pixels[2] = 0
    const [layer] = traceBitmap(pixels, size, size, { ...DEFAULT_TRACE, smoothing: 0, minArea: 20 })

    expect(layer!.loops).toHaveLength(1)
  })

  it('finds nothing in a picture with nothing in it', () => {
    const size = 16
    const white = new Uint8ClampedArray(size * size * 4).fill(255)

    expect(traceBitmap(white, size, size, DEFAULT_TRACE)).toEqual([])
  })

  it('sees through a transparent pixel rather than reading its colour', () => {
    const size = 32
    const pixels = new Uint8ClampedArray(size * size * 4)
    // Every pixel is black, and every pixel is transparent.
    for (let index = 0; index < size * size; index += 1) pixels[index * 4 + 3] = 0

    expect(traceBitmap(pixels, size, size, DEFAULT_TRACE)).toEqual([])
  })
})

describe('tracing in bands of colour', () => {
  it('gives a layer per band, darkest last so it sits on top', () => {
    const size = 64
    const pixels = new Uint8ClampedArray(size * size * 4)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = (y * size + x) * 4
        // Three vertical bands: black, mid grey, white.
        const value = x < size / 3 ? 0 : x < (size * 2) / 3 ? 128 : 255
        pixels[offset] = value
        pixels[offset + 1] = value
        pixels[offset + 2] = value
        pixels[offset + 3] = 255
      }
    }
    const layers = traceBitmap(pixels, size, size, { ...DEFAULT_TRACE, mode: 'colors', colors: 3, threshold: 0.75, smoothing: 0, minArea: 8 })

    expect(layers.length).toBeGreaterThan(1)
    expect(Math.abs(polygonArea(layers[0]!.loops[0]!))).toBeGreaterThan(Math.abs(polygonArea(layers[1]!.loops[0]!)))
  })
})

describe('marching squares', () => {
  it('walks around a square and closes the loop', () => {
    const mask = new Uint8Array(8 * 8)
    for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) mask[y * 8 + x] = 1
    const loops = marchingSquares(mask, 8, 8)

    expect(loops).toHaveLength(1)
    // The boundary runs through the half-pixels around the block and chamfers its corners, so a
    // four-by-four block comes back as 15.5 rather than 16. That half pixel is the method itself.
    expect(Math.abs(polygonArea(loops[0]!))).toBeCloseTo(15.5, 5)
  })

  it('finds the hole in a ring as a loop of its own', () => {
    const mask = new Uint8Array(16 * 16)
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const distance = Math.hypot(x - 8, y - 8)
        mask[y * 16 + x] = distance <= 6 && distance >= 3 ? 1 : 0
      }
    }

    expect(marchingSquares(mask, 16, 16)).toHaveLength(2)
  })

  it('closes a shape that runs off the edge of the picture', () => {
    const mask = new Uint8Array(8 * 8).fill(0)
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 8; x += 1) mask[y * 8 + x] = 1

    expect(marchingSquares(mask, 8, 8)).toHaveLength(1)
  })
})

describe('the trace settings', () => {
  it('clamps what it is given', () => {
    expect(sanitizeTraceOptions({ mode: 'colors', colors: 40, threshold: -2, smoothing: 9, minArea: -1 }))
      .toEqual({ mode: 'colors', colors: 8, threshold: 0, smoothing: 1, minArea: 0 })
  })

  it('falls back to the defaults for anything else', () => {
    expect(sanitizeTraceOptions(null)).toEqual(DEFAULT_TRACE)
  })

  it('weighs the channels the way an eye does', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 6)
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0))
  })
})
