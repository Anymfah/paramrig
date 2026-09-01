import { describe, expect, it } from 'vitest'
import { createVectorDocument, createVectorElement, sanitizeExportPresets, sanitizeVectorDocument } from '@/vector/document'
import { exportBounds, exportElements, exportFileName, exportMarkup, rasterSize, DEFAULT_EXPORT, MAX_RASTER_SIDE } from '@/vector/export'
import type { VectorDocument, VectorElement } from '@/vector/types'

function scene(): VectorDocument {
  const frame = { ...createVectorElement('frame', { x: 100, y: 50, width: 300, height: 200 }), id: 'frame', name: 'Card' }
  const inside = { ...createVectorElement('rectangle', { x: 120, y: 70, width: 60, height: 40 }), id: 'inside', parentId: 'frame' }
  const outside = { ...createVectorElement('ellipse', { x: 600, y: 400, width: 80, height: 80 }), id: 'outside' }
  return { ...createVectorDocument(), name: 'Poster', elements: [inside, frame, outside] }
}

describe('export targets', () => {
  it('frames the page, a frame or a selection', () => {
    const document = scene()

    expect(exportBounds(document, 'document', { frameId: null, selectedIds: [] })).toEqual({ x: 0, y: 0, width: 800, height: 600 })
    expect(exportBounds(document, 'frame', { frameId: 'frame', selectedIds: [] })).toMatchObject({ x: 100, y: 50, width: 300, height: 200 })
    expect(exportBounds(document, 'selection', { frameId: null, selectedIds: ['outside'] })).toMatchObject({ x: 600, y: 400, width: 80, height: 80 })
  })

  it('has nothing to frame when the target is missing', () => {
    const document = scene()

    expect(exportBounds(document, 'frame', { frameId: null, selectedIds: [] })).toBeNull()
    expect(exportBounds(document, 'selection', { frameId: null, selectedIds: [] })).toBeNull()
  })

  it('takes a frame with its children and detaches it from its parent', () => {
    const document = scene()

    const elements = exportElements(document, 'frame', { frameId: 'frame', selectedIds: [] })

    expect(elements.map((element) => element.id).sort()).toEqual(['frame', 'inside'])
    expect(elements.find((element) => element.id === 'frame')!.parentId).toBeUndefined()
    expect(elements.find((element) => element.id === 'inside')!.parentId).toBe('frame')
  })

  it('leaves out what the selection does not cover', () => {
    const document = scene()

    const elements = exportElements(document, 'selection', { frameId: null, selectedIds: ['outside'] })

    expect(elements.map((element) => element.id)).toEqual(['outside'])
  })
})

describe('export markup', () => {
  it('frames a frame export on the frame box and keeps its children', () => {
    const markup = exportMarkup(scene(), { ...DEFAULT_EXPORT, target: 'frame' }, { frameId: 'frame', selectedIds: [] })!

    expect(markup).toContain('viewBox="100 50 300 200"')
    expect(markup).toContain('width="300" height="200"')
    expect(markup).toContain('id="inside"')
    expect(markup).not.toContain('id="outside"')
  })

  it('paints the page colour unless the export asks for transparency', () => {
    const document = scene()
    const opaque = exportMarkup(document, DEFAULT_EXPORT, { frameId: null, selectedIds: [] })!
    const clear = exportMarkup(document, { ...DEFAULT_EXPORT, transparent: true }, { frameId: null, selectedIds: [] })!

    const backdrop = `<rect x="0" y="0" width="800" height="600" fill="${document.background}"/>`
    expect(opaque).toContain(backdrop)
    expect(clear).not.toContain(backdrop)
    expect(clear).toContain('id="outside"')
  })

  it('returns nothing when the target does not exist', () => {
    expect(exportMarkup(scene(), { ...DEFAULT_EXPORT, target: 'selection' }, { frameId: null, selectedIds: [] })).toBeNull()
  })

  it('names the file after the document, or the frame, with the scale', () => {
    const document = scene()

    expect(exportFileName(document, DEFAULT_EXPORT)).toBe('poster.svg')
    expect(exportFileName(document, { ...DEFAULT_EXPORT, format: 'png', scale: 2 }, 'Card')).toBe('poster@2x.png')
    expect(exportFileName(document, { ...DEFAULT_EXPORT, target: 'frame', format: 'png', scale: 1 }, 'Card')).toBe('card.png')
  })
})

describe('raster size', () => {
  it('multiplies the box by the scale', () => {
    expect(rasterSize({ x: 0, y: 0, width: 10, height: 10 }, 2)).toEqual({ width: 20, height: 20 })
    expect(rasterSize({ x: 0, y: 0, width: 393, height: 852 }, 3)).toEqual({ width: 1179, height: 2556 })
  })

  it('never asks the browser for a canvas it cannot make', () => {
    const size = rasterSize({ x: 0, y: 0, width: 9000, height: 4000 }, 3)

    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_RASTER_SIDE)
    expect(size.width / size.height).toBeCloseTo(9000 / 4000, 2)
  })
})

describe('export presets', () => {
  it('keeps sound presets and drops the rest', () => {
    const presets = sanitizeExportPresets([
      { id: 'a', name: 'Retina card', target: 'frame', format: 'png', scale: 3, transparent: true },
      { id: 'b', name: '  ', target: 'document', format: 'svg', scale: 1, transparent: false },
      { name: 'no id', target: 'document', format: 'svg', scale: 1 },
      { id: 'c', name: 'Odd', target: 'nowhere', format: 'webp', scale: 7 },
    ])

    expect(presets).toEqual([
      { id: 'a', name: 'Retina card', target: 'frame', format: 'png', scale: 3, transparent: true },
      { id: 'c', name: 'Odd', target: 'document', format: 'svg', scale: 1, transparent: false },
    ])
  })

  it('rides through a document round trip', () => {
    const document: VectorDocument = { ...scene(), exportPresets: [{ id: 'p', name: 'Card 2×', target: 'frame', format: 'png', scale: 2, transparent: false }] }

    expect(sanitizeVectorDocument(document)?.exportPresets).toEqual(document.exportPresets)
  })
})

describe('frames in a document', () => {
  it('keeps an empty frame and its clip flag through sanitising', () => {
    const frame: VectorElement = { ...createVectorElement('frame', { x: 0, y: 0, width: 100, height: 100 }), id: 'f' }
    const document = { ...createVectorDocument(), elements: [frame] }

    const clean = sanitizeVectorDocument(document)

    expect(clean?.elements).toHaveLength(1)
    expect(clean?.elements[0]).toMatchObject({ kind: 'frame', clipContent: true })
    expect(sanitizeVectorDocument({ ...document, elements: [{ ...frame, clipContent: false }] })?.elements[0]).toMatchObject({ clipContent: false })
  })

  it('keeps a frame at its own size rather than hugging its children', () => {
    const document = sanitizeVectorDocument(scene())!

    expect(document.elements.find((element) => element.id === 'frame')).toMatchObject({ x: 100, y: 50, width: 300, height: 200 })
  })

  it('clips its children in the exported markup when asked', () => {
    const document = scene()
    const clipped = exportMarkup(document, { ...DEFAULT_EXPORT, target: 'frame' }, { frameId: 'frame', selectedIds: [] })!
    const open = exportMarkup(
      { ...document, elements: document.elements.map((element) => element.id === 'frame' ? { ...element, clipContent: false } : element) },
      { ...DEFAULT_EXPORT, target: 'frame' },
      { frameId: 'frame', selectedIds: [] },
    )!

    expect(clipped).toContain('<clipPath id="frame-clip-frame">')
    expect(clipped).toContain('clip-path="url(#frame-clip-frame)"')
    expect(open).not.toContain('clipPath')
  })
})
