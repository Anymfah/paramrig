import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createVectorDocument,
  createVectorElement,
  getVectorDocument,
  listVectorDocuments,
  sanitizeVectorDocument,
  saveVectorDocument,
  serializeVectorDocument,
  serializeVectorMarkup,
  documentThumbnail,
  vectorManifest,
} from '@/vector/document'
import type { VectorElement } from '@/vector/types'

describe('vector documents', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'test-id') })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('creates a persistent blank project manifest', () => {
    const document = createVectorDocument()

    expect(document).toMatchObject({
      id: 'vector-test-id',
      name: 'Untitled',
      background: '#151516',
      width: 800,
      height: 600,
      elements: [],
    })
    expect(getVectorDocument(document.id)).toEqual(document)
    expect(listVectorDocuments()).toEqual([document])
    expect(vectorManifest(document)).toMatchObject({
      id: document.id,
      renderer: 'vector',
      collection: 'project',
      title: 'Projects/Vector',
      parameters: [],
    })
  })

  it('serializes visible shapes to portable SVG', () => {
    const document = createVectorDocument()
    document.name = 'Mark & motion'
    document.elements = [
      createVectorElement('rectangle', { x: 20, y: 30, width: 120, height: 80 }),
      { ...createVectorElement('ellipse', { x: 200, y: 100, width: 60, height: 40 }), visible: false },
    ]

    const svg = serializeVectorDocument(document)

    expect(svg).toContain('viewBox="0 0 800 600"')
    expect(svg).toContain('<rect')
    expect(svg).not.toContain('<ellipse')
    expect(svg).toContain('fill="#1C1D1E"')
  })

  it('serializes edited networks as a path', () => {
    const document = createVectorDocument()
    const element = createVectorElement('rectangle', { x: 20, y: 30, width: 120, height: 80 })
    element.kind = 'path'
    element.network = { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0.2 }, { id: 'c', x: 1, y: 1 }, { id: 'd', x: 0, y: 1 }], segments: [{ id: 's1', a: 'a', b: 'b' }, { id: 's2', a: 'b', b: 'c' }, { id: 's3', a: 'c', b: 'd' }, { id: 's4', a: 'd', b: 'a' }] }
    document.elements = [element]

    const svg = serializeVectorDocument(document)

    expect(svg).toContain('<path')
    expect(svg).toContain('d="M 20 30 L 140 46')
    expect(svg).not.toContain('<rect')
  })

  it('rejects malformed documents and removes malformed elements', () => {
    expect(sanitizeVectorDocument({ version: 1, id: 'broken' })).toBeNull()
    const valid = sanitizeVectorDocument({
      version: 1,
      id: 'valid',
      name: 'Valid',
      width: 200,
      height: 100,
      elements: [{ kind: 'path' }],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(valid?.elements).toEqual([])
    expect(valid?.background).toBe('#151516')
  })

  it('keeps a valid page background and normalizes its hex value', () => {
    const document = createVectorDocument()
    expect(sanitizeVectorDocument({ ...document, background: '#aabbcc' })?.background).toBe('#AABBCC')
  })
})

describe('paths, paints, groups and guides', () => {
  beforeEach(() => {
    localStorage.clear()
    let counter = 0
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `id-${counter++}`) })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('creates stroke-only paths and serializes open chains without Z', () => {
    const document = createVectorDocument()
    const path = createVectorElement('path', { x: 0, y: 0, width: 100, height: 50 }, { network: { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }], segments: [{ id: 's', a: 'a', b: 'b' }] } })
    expect(path).toMatchObject({ kind: 'path', fill: 'none', strokeWidth: 2 })
    document.elements = [path]
    const svg = serializeVectorDocument(document)
    expect(svg).toContain('d="M 0 0 L 100 50"')
    expect(svg).not.toContain('Z"')
  })

  it('accepts none paints and rejects other non-hex paints', () => {
    const document = createVectorDocument()
    const good = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), fill: 'none', stroke: '#abcdef' }
    const bad = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id: 'bad', fill: 'red' }
    const result = sanitizeVectorDocument({ ...document, elements: [good, bad] })
    expect(result?.elements.map((element) => element.id)).toEqual([good.id])
    expect(result?.elements[0]).toMatchObject({ fill: 'none', stroke: '#ABCDEF' })
  })

  it('drops paths without a usable network and keeps region toggles', () => {
    const document = createVectorDocument()
    const good = { ...createVectorElement('path', { x: 0, y: 0, width: 10, height: 10 }, { network: { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }], segments: [{ id: 's', a: 'a', b: 'b' }] } }), regionsOff: ['k'] }
    const empty = { ...createVectorElement('path', { x: 0, y: 0, width: 10, height: 10 }), id: 'empty' }
    const result = sanitizeVectorDocument({ ...document, elements: [good, empty] })
    expect(result?.elements).toHaveLength(1)
    expect(result?.elements[0]?.regionsOff).toEqual(['k'])
  })

  it('serializes groups as nested g elements and persists guides', () => {
    const document = createVectorDocument()
    const child = { ...createVectorElement('rectangle', { x: 10, y: 10, width: 20, height: 20 }), parentId: 'g' }
    const group = { ...createVectorElement('group', { x: 0, y: 0, width: 1, height: 1 }), id: 'g' }
    document.elements = [child, group]
    document.guides = [{ id: 'guide', axis: 'x', position: 40 }]
    const svg = serializeVectorDocument(document)
    expect(svg).toContain('<g id="g">')
    expect(svg).toContain('</g>')
    expect(svg).not.toContain('<rect id="g"')
    saveVectorDocument(document)
    const stored = getVectorDocument(document.id)
    expect(stored?.guides).toEqual([{ id: 'guide', axis: 'x', position: 40 }])
    expect(stored?.elements.find((element) => element.id === 'g')).toMatchObject({ x: 10, y: 10, width: 20, height: 20 })
  })

  it('drops empty groups and dangling parents when loading', () => {
    const document = createVectorDocument()
    const orphan = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), parentId: 'nope' }
    const empty = { ...createVectorElement('group', { x: 0, y: 0, width: 1, height: 1 }), id: 'empty' }
    const result = sanitizeVectorDocument({ ...document, elements: [orphan, empty] })
    expect(result?.elements).toHaveLength(1)
    expect(result?.elements[0]?.parentId).toBeUndefined()
  })
})

describe('text elements', () => {
  beforeEach(() => localStorage.clear())

  const textElement = (patch: Partial<VectorElement> = {}): VectorElement => ({
    ...createVectorElement('text', { x: 10, y: 20, width: 120, height: 40 }, { text: 'Hello\nthere' }),
    ...patch,
  })

  it('creates a text element with the shipped face and a paint that reads on the canvas', () => {
    const element = createVectorElement('text', { x: 0, y: 0, width: 100, height: 40 })

    expect(element).toMatchObject({
      kind: 'text', name: 'Text', text: 'Text', fontFamily: 'Public Sans',
      fontSize: 32, fontWeight: 400, lineHeight: 1.3, letterSpacing: 0,
      textAlign: 'left', textSizing: 'auto', stroke: 'none',
    })
    expect(element.fill).not.toBe('none')
  })

  it('keeps the text properties through a sanitise round trip', () => {
    const element = textElement({ fontFamily: 'Georgia', fontSize: 18, fontWeight: 700, lineHeight: 1.6, letterSpacing: 2, textAlign: 'center', textSizing: 'fixed' })

    const clean = sanitizeVectorDocument({ ...createVectorDocument(), elements: [element] })

    expect(clean?.elements[0]).toMatchObject({
      kind: 'text', text: 'Hello\nthere', fontFamily: 'Georgia', fontSize: 18,
      fontWeight: 700, lineHeight: 1.6, letterSpacing: 2, textAlign: 'center', textSizing: 'fixed',
    })
  })

  it('refuses a text element with no content, clamps sizes and falls back on unknown faces', () => {
    const document = createVectorDocument()

    expect(sanitizeVectorDocument({ ...document, elements: [{ ...textElement(), text: undefined }] })?.elements).toEqual([])
    expect(sanitizeVectorDocument({ ...document, elements: [textElement({ fontFamily: 'Comic Papyrus', fontSize: -4, lineHeight: 99, textAlign: 'justify' as never })] })?.elements[0]).toMatchObject({
      fontFamily: 'Public Sans', fontSize: 1, lineHeight: 6, textAlign: 'left',
    })
  })

  it('exports one tspan per line instead of a rectangle', () => {
    const document = { ...createVectorDocument(), elements: [textElement({ textAlign: 'center' })] }

    const svg = serializeVectorDocument(document)

    expect(svg).toContain('<text ')
    expect(svg).not.toContain('<rect')
    expect(svg).toContain('text-anchor="middle"')
    expect(svg.match(/<tspan /g)).toHaveLength(2)
    expect(svg).toContain('>Hello</tspan>')
    expect(svg).toContain('>there</tspan>')
  })

  it('escapes markup in the text it exports', () => {
    const document = { ...createVectorDocument(), elements: [textElement({ text: '<b>&"</b>' })] }

    const svg = serializeVectorDocument(document)

    expect(svg).toContain('&lt;b&gt;&amp;"&lt;/b&gt;')
    expect(svg).not.toContain('<b>')
  })
})

describe('background blur at export', () => {
  const backdrop = { id: 'fx', kind: 'backgroundBlur' as const, visible: true, blur: 12 }

  function scene() {
    const photo = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 400, height: 300 }), id: 'photo', name: 'Photo', fill: '#FF0000' }
    const pane = { ...createVectorElement('rectangle', { x: 50, y: 50, width: 200, height: 120 }), id: 'pane', name: 'Pane', effects: [backdrop] }
    return [photo, pane]
  }

  it('bakes what is underneath: a blurred, clipped copy just below the pane', () => {
    const markup = serializeVectorMarkup(scene(), { x: 0, y: 0, width: 400, height: 300 })

    expect(markup).toContain('<clipPath id="backdrop-clip-pane">')
    expect(markup).toContain('<filter id="backdrop-blur-pane" filterUnits="userSpaceOnUse"')
    expect(markup).toContain('<feGaussianBlur stdDeviation="6"/>')
    expect(markup).toContain('clip-path="url(#backdrop-clip-pane)" filter="url(#backdrop-blur-pane)"')
    // The copy carries its own id, so nothing in the file is named twice.
    expect(markup).toContain('bd-pane-photo')
    expect(markup.match(/id="photo"/g)).toHaveLength(1)
  })

  it('puts the copy before the pane, so it is painted under it', () => {
    const markup = serializeVectorMarkup(scene(), { x: 0, y: 0, width: 400, height: 300 })

    expect(markup.indexOf('backdrop-clip-pane"')).toBeLessThan(markup.lastIndexOf('id="pane"'))
  })

  it('reaches past the shape by three sigma so the blur has something to sample', () => {
    const markup = serializeVectorMarkup(scene(), { x: 0, y: 0, width: 400, height: 300 })
    const region = markup.match(/id="backdrop-blur-pane" filterUnits="userSpaceOnUse" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/)!

    expect(region.slice(1).map(Number)).toEqual([50 - 36, 50 - 36, 200 + 72, 120 + 72])
  })

  it('bakes nothing when there is nothing underneath', () => {
    const [, pane] = scene()

    expect(serializeVectorMarkup([pane!], { x: 0, y: 0, width: 400, height: 300 })).not.toContain('backdrop-clip')
  })

  it('leaves a pane with no background blur alone', () => {
    const [photo, pane] = scene()

    expect(serializeVectorMarkup([photo!, { ...pane!, effects: undefined }], { x: 0, y: 0, width: 400, height: 300 })).not.toContain('backdrop-clip')
  })

  it('does not copy the pane, or its own children, into its backdrop', () => {
    const [photo, pane] = scene()
    const child = { ...createVectorElement('ellipse', { x: 60, y: 60, width: 40, height: 40 }), id: 'child', parentId: 'pane' }
    const markup = serializeVectorMarkup([photo!, child, { ...pane!, kind: 'frame' as const }], { x: 0, y: 0, width: 400, height: 300 })

    expect(markup).not.toContain('bd-pane-pane')
    expect(markup).not.toContain('bd-pane-child')
    expect(markup).toContain('bd-pane-photo')
  })

  it('flattens a stack of frosted panes instead of squaring it', () => {
    const [photo, pane] = scene()
    const second = { ...pane!, id: 'pane2', x: 120 }
    const markup = serializeVectorMarkup([photo!, pane!, second], { x: 0, y: 0, width: 400, height: 300 })

    // The second pane copies the first, but that copy carries no background blur of its own.
    expect(markup).toContain('bd-pane2-pane')
    expect(markup).not.toContain('backdrop-clip-bd-pane2-pane')
  })
})

describe('document thumbnails', () => {
  it('shows what the export shows: a frosted pane frosts', () => {
    const photo = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 400, height: 300 }), id: 'photo' }
    const pane = {
      ...createVectorElement('rectangle', { x: 50, y: 50, width: 200, height: 120 }),
      id: 'pane',
      effects: [{ id: 'fx', kind: 'backgroundBlur' as const, visible: true, blur: 12 }],
    }
    const thumbnail = documentThumbnail({ id: 'doc', elements: [photo, pane] })

    expect(thumbnail).toContain('backdrop-clip-pane')
    expect(thumbnail).toContain('<feGaussianBlur stdDeviation="6"/>')
    expect(thumbnail.startsWith('<defs>')).toBe(true)
  })

  it('clips a frame\'s children the way the file does', () => {
    const frame = { ...createVectorElement('frame', { x: 0, y: 0, width: 200, height: 200 }), id: 'frame', clipContent: true }
    const child = { ...createVectorElement('rectangle', { x: 150, y: 20, width: 200, height: 40 }), id: 'child', parentId: 'frame' }
    const thumbnail = documentThumbnail({ id: 'doc', elements: [child, frame] })

    expect(thumbnail).toContain('clip-path="url(#frame-clip-frame)"')
    expect(thumbnail).toContain('id="child"')
  })

  it('leaves a hidden object out', () => {
    const shown = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id: 'shown' }
    const hidden = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id: 'hidden', visible: false }

    expect(documentThumbnail({ id: 'doc', elements: [shown, hidden] })).not.toContain('id="hidden"')
  })
})
