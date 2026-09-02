import { describe, expect, it } from 'vitest'
import { cmykLabel, cssColor, isColorSpace, outOfSrgbGamut, sanitizeColorSpace } from '@/vector/colorSpace'

describe('the colour space of a document', () => {
  it('is sRGB unless it says otherwise', () => {
    expect(sanitizeColorSpace('display-p3')).toBe('display-p3')
    expect(sanitizeColorSpace('srgb')).toBeUndefined()
    expect(sanitizeColorSpace('cmyk')).toBeUndefined()
    expect(isColorSpace('display-p3')).toBe(true)
    expect(isColorSpace('lab')).toBe(false)
  })

  it('reads the same numbers in the wider space, and leaves sRGB alone', () => {
    expect(cssColor('#FF8000', 'display-p3')).toBe('color(display-p3 1 0.502 0)')
    expect(cssColor('#FF8000', 'srgb')).toBe('#FF8000')
    expect(cssColor('#FF8000', undefined)).toBe('#FF8000')
  })

  it('leaves a paint server reference alone', () => {
    expect(cssColor('url(#gradient)', 'display-p3')).toBe('url(#gradient)')
  })

  it('marks a colour that needs a screen wider than sRGB', () => {
    expect(outOfSrgbGamut('#FF0000', 'display-p3')).toBe(true)
    expect(outOfSrgbGamut('#808080', 'display-p3')).toBe(false)
    // On an sRGB document nothing is out of gamut, by definition.
    expect(outOfSrgbGamut('#FF0000', 'srgb')).toBe(false)
  })

  it('reads a colour out in CMYK, for a print-minded eye', () => {
    expect(cmykLabel('#FF0000')).toBe('0 / 100 / 100 / 0')
    expect(cmykLabel('#000000')).toBe('0 / 0 / 0 / 100')
    expect(cmykLabel('none')).toBe('—')
  })
})
