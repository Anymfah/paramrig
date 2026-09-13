import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { base64Bytes, fontFaceRule, googleCssUrl, MAX_FONT_BYTES, pickFontFileUrl, readFontFile, sanitizeFonts, searchGoogleFamilies } from '@/vector/fonts'

const css = `
/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/cyrillic.woff2) format('woff2');
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/latin.woff2) format('woff2');
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/inter/latin-700.woff2) format('woff2');
}
`

describe('asking Google for a family', () => {
  it('builds the stylesheet URL with the weights it wants', () => {
    expect(googleCssUrl('Space Grotesk', [700, 400, 400])).toBe('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap')
    expect(googleCssUrl('Inter', [])).toContain('wght@400')
  })

  it('takes the latin file out of the stylesheet, at the weight asked for', () => {
    expect(pickFontFileUrl(css, 400)).toBe('https://fonts.gstatic.com/s/inter/latin.woff2')
    expect(pickFontFileUrl(css, 700)).toBe('https://fonts.gstatic.com/s/inter/latin-700.woff2')
  })

  it('falls back to whatever it can find', () => {
    expect(pickFontFileUrl('@font-face { src: url(https://example.test/a.woff2) format("woff2"); }')).toBe('https://example.test/a.woff2')
    expect(pickFontFileUrl('nothing here')).toBeNull()
  })

  it('searches the list it offers', () => {
    expect(searchGoogleFamilies('mono')).toContain('IBM Plex Mono')
    expect(searchGoogleFamilies('  ').length).toBeGreaterThan(20)
    expect(searchGoogleFamilies('nothing at all')).toEqual([])
  })
})

describe('sanitising the font registry', () => {
  it('keeps a Google family without its bytes', () => {
    expect(sanitizeFonts([{ family: 'Inter', source: 'google', weights: [400, 700] }])).toEqual([{ family: 'Inter', source: 'google', weights: [400, 700] }])
  })

  it('drops an imported font that lost its file: it can be neither drawn nor embedded', () => {
    expect(sanitizeFonts([{ family: 'Mine', source: 'file', weights: [400] }])).toBeUndefined()
  })

  it('drops a file bigger than a document should carry', () => {
    const huge = 'A'.repeat(Math.ceil((MAX_FONT_BYTES + 1024) * 4 / 3))

    expect(sanitizeFonts([{ family: 'Huge', source: 'file', weights: [400], data: huge, format: 'woff2' }])).toBeUndefined()
  })

  it('keeps one entry per family, with weights it can use', () => {
    const fonts = sanitizeFonts([
      { family: 'Inter', source: 'google', weights: [400, 1200, 700] },
      { family: 'Inter', source: 'google', weights: [400] },
      { family: '  ', source: 'google', weights: [400] },
    ])

    expect(fonts).toEqual([{ family: 'Inter', source: 'google', weights: [400, 700] }])
  })

  it('reads back the size of a base64 payload without decoding it', () => {
    expect(base64Bytes(btoa('hello'))).toBe(5)
    expect(base64Bytes(btoa('hi'))).toBe(2)
  })
})

describe('importing a font file', () => {
  const file = (name: string, size: number) => ({
    name,
    size,
    arrayBuffer: async () => new Uint8Array(Math.min(size, 8)).buffer,
  }) as unknown as File

  it('takes the family name from the file name', async () => {
    const bytes = new Uint8Array(readFileSync('public/fonts/SpaceGrotesk.woff2'))
    const result = await readFontFile({ name: 'Space_Grotesk-Regular.woff2', size: bytes.length, arrayBuffer: async () => bytes.buffer } as File)

    expect('font' in result && result.font).toMatchObject({ family: 'Space Grotesk Regular', source: 'file', format: 'woff2' })
    expect('font' in result && result.font.weights).toEqual([300, 700])
  })

  it('refuses what is not a font', async () => {
    expect(await readFontFile(file('cat.png', 100))).toEqual({ error: 'Fonts can be imported as .woff2, .ttf or .otf files.' })
  })

  it('refuses a file too heavy to travel with the document', async () => {
    const result = await readFontFile(file('Huge.ttf', MAX_FONT_BYTES + 1))

    expect('error' in result && result.error).toContain('has to stay under')
  })
})

describe('embedding a font in a file', () => {
  it('writes a face rule with the bytes inline', () => {
    const rule = fontFaceRule('Inter', 'AAAA', 'woff2', [400, 700])

    expect(rule).toContain("font-family:'Inter'")
    expect(rule).toContain('url(data:font/woff2;base64,AAAA) format(\'woff2\')')
    expect(rule).toContain('font-weight:400 700')
  })

  it('names the format the reader expects for a TrueType file', () => {
    expect(fontFaceRule('Mine', 'AAAA', 'ttf')).toContain("format('truetype')")
  })
})
