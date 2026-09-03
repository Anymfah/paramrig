import { describe, expect, it } from 'vitest'
import { alphaOf, composite, contrastRatio, parseColour, relativeLuminance } from '@/scene/contrast'

const BLACK = { r: 0, g: 0, b: 0 }
const WHITE = { r: 255, g: 255, b: 255 }

describe('reading a colour out of a stylesheet', () => {
  it('reads the three hexadecimal forms the scene tokens are written in', () => {
    expect(parseColour('#f0a02e')).toEqual({ r: 240, g: 160, b: 46 })
    expect(parseColour('#ffffff21')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColour('#1b1f1e')).toEqual({ r: 27, g: 31, b: 30 })
  })

  it('expands a three-digit hex the way CSS does', () => {
    expect(parseColour('#fff')).toEqual(WHITE)
    expect(parseColour('#1a2')).toEqual({ r: 17, g: 170, b: 34 })
    expect(parseColour('#1a28')).toEqual({ r: 17, g: 170, b: 34 })
  })

  it('reads the functional forms a computed style hands back', () => {
    expect(parseColour('rgb(27, 31, 30)')).toEqual({ r: 27, g: 31, b: 30 })
    expect(parseColour('rgba(240, 160, 46, 0.5)')).toEqual({ r: 240, g: 160, b: 46 })
    expect(parseColour('rgb(240 160 46 / 50%)')).toEqual({ r: 240, g: 160, b: 46 })
    expect(parseColour('rgb(100% 0% 0%)')).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('ignores case and the space around a value', () => {
    expect(parseColour('  #F0A02E  ')).toEqual({ r: 240, g: 160, b: 46 })
    expect(parseColour('RGB(1,2,3)')).toEqual({ r: 1, g: 2, b: 3 })
  })

  it('refuses what it cannot read rather than guessing a colour', () => {
    expect(parseColour('rebeccapurple')).toBeNull()
    expect(parseColour('color-mix(in srgb, white 50%, black)')).toBeNull()
    expect(parseColour('var(--scene-selected)')).toBeNull()
    expect(parseColour('#12345')).toBeNull()
    expect(parseColour('rgb(1, 2)')).toBeNull()
    expect(parseColour('')).toBeNull()
  })
})

describe('the alpha a colour carries', () => {
  it('is one when the colour is written without any', () => {
    expect(alphaOf('#f0a02e')).toBe(1)
    expect(alphaOf('#fff')).toBe(1)
    expect(alphaOf('rgb(1, 2, 3)')).toBe(1)
  })

  it('comes from the fourth byte of an eight-digit hex', () => {
    expect(alphaOf('#ffffff21')).toBeCloseTo(33 / 255, 6)
    expect(alphaOf('#ffffff3d')).toBeCloseTo(61 / 255, 6)
    expect(alphaOf('#00000000')).toBe(0)
    expect(alphaOf('#000000ff')).toBe(1)
  })

  it('expands the fourth digit of a four-digit hex', () => {
    expect(alphaOf('#fff8')).toBeCloseTo(136 / 255, 6)
  })

  it('comes from the fourth argument of rgba(), as a number or a percentage', () => {
    expect(alphaOf('rgba(0, 0, 0, 0.25)')).toBeCloseTo(0.25, 6)
    expect(alphaOf('rgb(0 0 0 / 40%)')).toBeCloseTo(0.4, 6)
  })

  it('treats an unreadable colour as opaque, so nothing vanishes silently', () => {
    expect(alphaOf('rebeccapurple')).toBe(1)
  })
})

describe('relative luminance', () => {
  it('runs from nought for black to one for white', () => {
    expect(relativeLuminance(BLACK)).toBe(0)
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 6)
  })

  it('weights the primaries the way WCAG does', () => {
    expect(relativeLuminance({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.2126, 6)
    expect(relativeLuminance({ r: 0, g: 255, b: 0 })).toBeCloseTo(0.7152, 6)
    expect(relativeLuminance({ r: 0, g: 0, b: 255 })).toBeCloseTo(0.0722, 6)
  })

  it('uses the linear part of the curve for the darkest bytes', () => {
    // Ten of 255 is below the 0.04045 knee, so it is divided by 12.92 rather than raised to 2.4.
    expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(10 / 255 / 12.92, 9)
  })
})

describe('the contrast between two colours', () => {
  it('is 21 for black against white, and 1 for a colour against itself', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 6)
    expect(contrastRatio(WHITE, WHITE)).toBe(1)
    expect(contrastRatio(BLACK, BLACK)).toBe(1)
  })

  it('does not care which colour is given first', () => {
    const amber = { r: 240, g: 160, b: 46 }
    expect(contrastRatio(amber, BLACK)).toBeCloseTo(contrastRatio(BLACK, amber), 12)
  })

  it('agrees with the WCAG worked examples', () => {
    // The grey the guidelines use to illustrate the 4.5:1 threshold.
    expect(contrastRatio({ r: 119, g: 119, b: 119 }, WHITE)).toBeCloseTo(4.48, 2)
    expect(contrastRatio({ r: 255, g: 0, b: 0 }, WHITE)).toBeCloseTo(4.0, 2)
    expect(contrastRatio({ r: 0, g: 128, b: 0 }, WHITE)).toBeCloseTo(5.14, 2)
    expect(contrastRatio({ r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 })).toBeCloseTo(8.0, 2)
    expect(contrastRatio({ r: 0, g: 0, b: 255 }, WHITE)).toBeCloseTo(8.59, 2)
  })
})

describe('a translucent colour seen against a background', () => {
  it('is the background where the colour is fully transparent', () => {
    expect(composite(WHITE, 0, { r: 27, g: 31, b: 30 })).toEqual({ r: 27, g: 31, b: 30 })
  })

  it('is the colour itself where it is opaque', () => {
    expect(composite(WHITE, 1, BLACK)).toEqual(WHITE)
  })

  it('mixes in sRGB, which is where the screen blends it', () => {
    expect(composite(WHITE, 0.5, BLACK)).toEqual({ r: 128, g: 128, b: 128 })
    expect(composite(WHITE, 0.25, BLACK)).toEqual({ r: 64, g: 64, b: 64 })
  })

  it('lifts the dark viewport by the amount the fine grid token asks for', () => {
    // `--scene-grid: #ffffff21` over `--scene-viewport: #1b1f1e`, which is the pair the QA measures.
    expect(composite(WHITE, 33 / 255, { r: 27, g: 31, b: 30 })).toEqual({ r: 57, g: 60, b: 59 })
  })

  it('clamps an alpha outside nought to one rather than running off the end', () => {
    expect(composite(WHITE, 2, BLACK)).toEqual(WHITE)
    expect(composite(WHITE, -1, BLACK)).toEqual(BLACK)
  })
})
