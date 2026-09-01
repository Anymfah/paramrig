import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createVectorDocument,
  createVectorElement,
  getVectorDocument,
  listVectorDocuments,
  sanitizeVectorDocument,
  saveVectorDocument,
  serializeVectorDocument,
  vectorManifest,
} from '@/vector/document'

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

  it('serializes edited vector nodes as a path', () => {
    const document = createVectorDocument()
    const element = createVectorElement('rectangle', { x: 20, y: 30, width: 120, height: 80 })
    element.vectorNodes = [{ x: 0, y: 0 }, { x: 1, y: 0.2 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
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

  it('creates stroke-only paths and serializes open ones without Z', () => {
    const document = createVectorDocument()
    const path = createVectorElement('path', { x: 0, y: 0, width: 100, height: 50 }, { vectorNodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false })
    expect(path).toMatchObject({ kind: 'path', fill: 'none', strokeWidth: 2, closed: false })
    document.elements = [path]
    const svg = serializeVectorDocument(document)
    expect(svg).toContain('d="M 0 0 L 100 50"')
    expect(svg).toContain('fill="none"')
  })

  it('accepts none paints and rejects other non-hex paints', () => {
    const document = createVectorDocument()
    const good = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), fill: 'none', stroke: '#abcdef' }
    const bad = { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id: 'bad', fill: 'red' }
    const result = sanitizeVectorDocument({ ...document, elements: [good, bad] })
    expect(result?.elements.map((element) => element.id)).toEqual([good.id])
    expect(result?.elements[0]).toMatchObject({ fill: 'none', stroke: '#ABCDEF' })
  })

  it('keeps open paths with two nodes and drops paths without nodes', () => {
    const document = createVectorDocument()
    const open = { ...createVectorElement('path', { x: 0, y: 0, width: 10, height: 10 }, { vectorNodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }) }
    const empty = { ...createVectorElement('path', { x: 0, y: 0, width: 10, height: 10 }), id: 'empty' }
    const result = sanitizeVectorDocument({ ...document, elements: [open, empty] })
    expect(result?.elements).toHaveLength(1)
    expect(result?.elements[0]?.closed).toBe(false)
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
