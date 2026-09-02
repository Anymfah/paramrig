import { describe, expect, it } from 'vitest'
import { cmykOf, encode, pdfColor, pdfNumber, pdfString, PdfWriter } from '@/vector/pdf'
import { exportPdf, pathOperators, pdfPages } from '@/vector/pdfExport'
import { createVectorDocument, createVectorElement } from '@/vector/document'
import type { VectorDocument, VectorElement } from '@/vector/types'

const read = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

function documentWith(elements: VectorElement[]): VectorDocument {
  return { ...createVectorDocument(), elements, width: 400, height: 300 }
}

describe('the file it writes', () => {
  it('is a PDF with a cross-reference table that points at its objects', async () => {
    const rect = { ...createVectorElement('rectangle', { x: 20, y: 30, width: 100, height: 50 }), id: 'r', fill: '#FF0000' }
    const { bytes } = await exportPdf(pdfPages(documentWith([rect]), false))
    const text = read(bytes)

    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    const size = Number(text.match(/\/Size (\d+)/)![1])
    const rows = [...text.matchAll(/^(\d{10}) 00000 n $/gm)]
    expect(rows).toHaveLength(size - 1)
    // Every offset in the table lands on the object it claims.
    rows.forEach((row, index) => {
      expect(text.slice(Number(row[1])).startsWith(`${index + 1} 0 obj`)).toBe(true)
    })
    expect(text).toMatch(/startxref\n\d+/)
  })

  it('draws a rectangle as a path in its own colour', async () => {
    const rect = { ...createVectorElement('rectangle', { x: 20, y: 30, width: 100, height: 50 }), id: 'r', fill: '#FF0000', stroke: 'none', strokeWidth: 0 }
    const text = read((await exportPdf(pdfPages(documentWith([rect]), false))).bytes)

    expect(text).toContain('1 0 0 rg')
    expect(text).toContain('20 30 m')
    expect(text).toContain('120 30 l')
    expect(text).toContain('f*')
  })

  it('flips the page so the drawing is the right way up', async () => {
    const text = read((await exportPdf(pdfPages(documentWith([]), false))).bytes)

    expect(text).toContain('1 0 0 -1 0 300 cm')
    expect(text).toContain('/MediaBox [0 0 400 300]')
  })

  it('carries a gradient as a shading with a function per pair of stops', async () => {
    const rect = {
      ...createVectorElement('rectangle', { x: 0, y: 0, width: 100, height: 100 }),
      id: 'g',
      fills: [{ id: 'p', type: 'linear' as const, opacity: 1, visible: true, angle: 0, stops: [{ t: 0, color: '#FF0000' }, { t: 0.5, color: '#00FF00' }, { t: 1, color: '#0000FF' }] }],
    }
    const text = read((await exportPdf(pdfPages(documentWith([rect]), false))).bytes)

    expect(text).toContain('/ShadingType 2')
    expect(text).toContain('/FunctionType 3')
    expect(text).toContain('/Bounds [0.5]')
    expect(text).toContain('W* n')
    expect(text).toMatch(/\/Sh0 \d+ 0 R/)
  })

  it('gives a page per frame when it is asked to', () => {
    const frame = { ...createVectorElement('frame', { x: 10, y: 10, width: 200, height: 100 }), id: 'f', name: 'Card' }
    const pages = pdfPages(documentWith([frame]), true)

    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ name: 'Card', bounds: { x: 10, y: 10, width: 200, height: 100 } })
  })

  it('says what it could not write in vector terms', async () => {
    const shadowed = {
      ...createVectorElement('rectangle', { x: 0, y: 0, width: 50, height: 50 }),
      id: 's',
      name: 'Shadowed',
      effects: [{ id: 'e', kind: 'dropShadow' as const, visible: true, dx: 2, dy: 2, blur: 4, spread: 0, color: '#000000', opacity: 0.5 }],
    }
    const { notes } = await exportPdf(pdfPages(documentWith([shadowed]), false))

    expect(notes.skipped).toEqual(['Shadowed'])
  })

  it('places a rasterised element as an image', async () => {
    const shadowed = {
      ...createVectorElement('rectangle', { x: 10, y: 10, width: 50, height: 40 }),
      id: 's',
      name: 'Shadowed',
      effects: [{ id: 'e', kind: 'dropShadow' as const, visible: true, dx: 2, dy: 2, blur: 4, spread: 0, color: '#000000', opacity: 0.5 }],
    }
    const { bytes, notes } = await exportPdf(pdfPages(documentWith([shadowed]), false), {
      rasterise: async () => ({ data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 8, height: 6 }),
    })
    const text = read(bytes)

    expect(notes.rasterised).toEqual(['Shadowed'])
    expect(text).toContain('/Subtype /Image')
    expect(text).toContain('/Filter /DCTDecode')
    expect(text).toContain('/Im0 Do')
  })
})

describe('the pieces it is built from', () => {
  it('writes numbers without a trailing mess, and never a negative zero', () => {
    expect(pdfNumber(1 / 3)).toBe('0.333')
    expect(pdfNumber(-0)).toBe('0')
    expect(pdfNumber(12)).toBe('12')
  })

  it('escapes what a PDF string reserves', () => {
    expect(pdfString('a (b) \\ c')).toBe('(a \\(b\\) \\\\ c)')
  })

  it('reads a hex colour into the numbers PDF wants', () => {
    expect(pdfColor('#FF8000').map((value) => Math.round(value * 100))).toEqual([100, 50, 0])
  })

  it('turns a path into moves, lines and curves', () => {
    const run = { points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 }, in: { x: 5, y: 0 } }], closed: true }

    // The closing side has no handles of its own, so it goes back as a straight line.
    expect(pathOperators([run])).toEqual(['0 0 m', '0 0 5 0 10 0 c', '0 0 l', 'h'])
  })

  it('converts to CMYK naively, and says black is black', () => {
    expect(cmykOf('#000000')).toEqual([0, 0, 0, 1])
    expect(cmykOf('#FFFFFF')).toEqual([0, 0, 0, 0])
    expect(cmykOf('#FF0000')).toEqual([0, 1, 1, 0])
  })

  it('keeps every byte of a string in the file', () => {
    expect(encode('%PDF')).toEqual(new Uint8Array([37, 80, 68, 70]))
    const writer = new PdfWriter()
    const ref = writer.put('<< /Type /Test >>')
    expect(read(writer.build(ref))).toContain('/Type /Test')
  })
})
