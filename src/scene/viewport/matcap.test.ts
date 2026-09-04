import { describe, expect, it } from 'vitest'
import { MATCAPS, MATCAP_LABELS, matcapPixels, type MatcapName } from '@/scene/viewport/matcap'

/**
 * A matcap is a picture, and a picture is hard to assert. What can be asserted is what makes one
 * usable: that it is lit from somewhere rather than flat, that it is brighter where the light is,
 * that nothing has blown out to white or crushed to black, and that its edge is not transparent —
 * every one of which is a way a matcap can be wrong and still look like an image.
 */

const SIZE = 64

function pixel(data: Uint8Array, x: number, y: number, size = SIZE): [number, number, number, number] {
  // Rounded, because a test naming a place on the sphere thinks in fractions of its width.
  const at = (Math.round(y) * size + Math.round(x)) * 4
  return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!]
}

/** How bright a pixel is, near enough for a comparison. */
function luma(colour: [number, number, number, number]): number {
  return 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]
}

describe('every matcap', () => {
  it.each(MATCAPS)('%s is lit from the upper left, as a modeller expects', (name: MatcapName) => {
    const data = matcapPixels(name, SIZE)
    const upperLeft = luma(pixel(data, SIZE * 0.3, SIZE * 0.3))
    const lowerRight = luma(pixel(data, SIZE * 0.72, SIZE * 0.72))
    expect(upperLeft).toBeGreaterThan(lowerRight)
  })

  it.each(MATCAPS)('%s covers the whole square, edges included', (name: MatcapName) => {
    const data = matcapPixels(name, SIZE)
    expect(data).toHaveLength(SIZE * SIZE * 4)
    // A transparent corner would fringe every silhouette in the viewport.
    expect(pixel(data, 0, 0)[3]).toBe(255)
    expect(pixel(data, SIZE - 1, SIZE - 1)[3]).toBe(255)
  })

  it.each(MATCAPS)('%s keeps its range: nothing pure black, nothing blown out', (name: MatcapName) => {
    const data = matcapPixels(name, SIZE)
    let darkest = 255
    let brightest = 0
    let white = 0
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (Math.hypot(x / SIZE - 0.5, y / SIZE - 0.5) > 0.48) continue
        const value = luma(pixel(data, x, y))
        darkest = Math.min(darkest, value)
        brightest = Math.max(brightest, value)
        if (value > 253) white += 1
      }
    }
    expect(darkest).toBeGreaterThan(8)
    expect(brightest).toBeGreaterThan(120)
    // A highlight is allowed to clip; a face of the sphere is not.
    expect(white).toBeLessThan(SIZE * SIZE * 0.06)
  })

  it('gives each one a name a menu can print', () => {
    for (const name of MATCAPS) expect(MATCAP_LABELS[name]).toMatch(/^[A-Z]/)
  })
})

describe('the matcaps against each other', () => {
  it('makes the metal one the shiniest', () => {
    const contrast = (name: MatcapName): number => {
      const data = matcapPixels(name, SIZE)
      let darkest = 255
      let brightest = 0
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          if (Math.hypot(x / SIZE - 0.5, y / SIZE - 0.5) > 0.45) continue
          const value = luma(pixel(data, x, y))
          darkest = Math.min(darkest, value)
          brightest = Math.max(brightest, value)
        }
      }
      return brightest - darkest
    }
    expect(contrast('metal')).toBeGreaterThan(contrast('clay'))
  })

  it('makes the clay one warm and the ceramic one not', () => {
    const clay = pixel(matcapPixels('clay', SIZE), SIZE * 0.4, SIZE * 0.4)
    const ceramic = pixel(matcapPixels('ceramic', SIZE), SIZE * 0.4, SIZE * 0.4)
    expect(clay[0] - clay[2]).toBeGreaterThan(30)
    expect(Math.abs(ceramic[0] - ceramic[2])).toBeLessThan(20)
  })

  it('answers the same pixels for the same matcap, so it can be cached', () => {
    expect(matcapPixels('basic', 16)).toEqual(matcapPixels('basic', 16))
  })

  it('falls back to the basic one for a name from an older file', () => {
    expect(matcapPixels('mystery' as MatcapName, 16)).toEqual(matcapPixels('basic', 16))
  })
})
