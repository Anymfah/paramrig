import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createVectorDocument,
  createVectorElement,
  getVectorDocument,
  listVectorDocuments,
  sanitizeVectorDocument,
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
