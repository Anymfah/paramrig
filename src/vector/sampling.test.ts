import { describe, expect, it } from 'vitest'
import { colorAt, type CanvasSample } from '@/vector/sampling'

/** A 4 × 2 raster: red on the left half, transparent on the right. */
function sample(scale = 1): CanvasSample {
  const data: number[] = []
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      if (x < 2) data.push(255, 0, 0, 255)
      else data.push(0, 0, 0, 0)
    }
  }
  return { image: { width: 4, height: 2, data }, bounds: { x: 10, y: 20, width: 4 / scale, height: 2 / scale }, scale }
}

describe('reading a colour off the rendered page', () => {
  it('reads the pixel under a document point', () => {
    expect(colorAt(sample(), { x: 10.5, y: 20.5 })).toBe('#FF0000')
    expect(colorAt(sample(), { x: 11.9, y: 21.2 })).toBe('#FF0000')
  })

  it('says nothing where the page is transparent', () => {
    expect(colorAt(sample(), { x: 12.5, y: 20.5 })).toBeNull()
  })

  it('says nothing outside the raster', () => {
    expect(colorAt(sample(), { x: 9.5, y: 20.5 })).toBeNull()
    expect(colorAt(sample(), { x: 14.5, y: 20.5 })).toBeNull()
    expect(colorAt(sample(), { x: 10.5, y: 19 })).toBeNull()
    expect(colorAt(sample(), { x: 10.5, y: 22.5 })).toBeNull()
  })

  it('accounts for a raster drawn at a different scale than the page', () => {
    const twice = sample(2)

    expect(colorAt(twice, { x: 10.2, y: 20.2 })).toBe('#FF0000')
    expect(colorAt(twice, { x: 11.2, y: 20.2 })).toBeNull()
  })
})
