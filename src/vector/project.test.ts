import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createVectorDocument,
  createVectorElement,
  saveVectorDocument,
  storageMessage,
  STORAGE_FULL_MESSAGE,
} from '@/vector/document'
import { exportProject, importProject, projectFileName, serializeProject } from '@/vector/project'

describe('vector project files', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const sample = () => {
    const document = createVectorDocument()
    document.name = 'Studio poster'
    document.elements = [createVectorElement('rectangle', { x: 10, y: 20, width: 100, height: 60 }, { name: 'Card' })]
    document.versions = [{ id: 'v1', name: 'First pass', createdAt: '2026-01-01T10:00:00.000Z', elements: [...document.elements], guides: [] }]
    return document
  }

  it('round-trips a document through export and import', () => {
    const document = sample()

    const result = importProject(serializeProject(document))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.format).toBe('paramrig.vector')
    expect(result.project.document.name).toBe('Studio poster')
    expect(result.project.document.elements).toHaveLength(1)
    expect(result.project.document.elements[0]).toMatchObject({ name: 'Card', x: 10, y: 20, width: 100, height: 60 })
    expect(result.project.document.versions?.[0]?.name).toBe('First pass')
  })

  it('names the file after the document', () => {
    expect(projectFileName({ name: 'Studio Poster ' })).toBe('studio-poster.paramrig.json')
    expect(projectFileName({ name: '   ' })).toBe('untitled.paramrig.json')
  })

  it('carries the document through the wrapper unchanged', () => {
    const document = sample()

    expect(exportProject(document).document.id).toBe(document.id)
  })

  it('refuses files that are not projects', () => {
    expect(importProject('not json at all')).toEqual({ ok: false, error: 'That file is not valid JSON.' })
    expect(importProject('[]')).toEqual({ ok: false, error: 'That file is not a ParamRig project.' })
    expect(importProject('{"format":"something.else"}')).toEqual({ ok: false, error: 'That file is not a ParamRig project.' })
  })

  it('refuses a newer format version', () => {
    const result = importProject({ format: 'paramrig.vector', formatVersion: 99, document: sample() })

    expect(result).toEqual({ ok: false, error: 'That project was saved by a newer version of ParamRig.' })
  })

  it('refuses a damaged document instead of loading half of it', () => {
    const result = importProject({ format: 'paramrig.vector', formatVersion: 1, document: { version: 1, id: 'x', name: 'Broken' } })

    expect(result).toEqual({ ok: false, error: 'That project file is damaged and could not be read.' })
  })

  it('drops damaged elements but keeps the sound ones', () => {
    const document = sample()
    const payload = JSON.parse(serializeProject(document)) as { document: { elements: unknown[] } }
    payload.document.elements.push({ id: 'broken', kind: 'rectangle', name: 'No geometry' })

    const result = importProject(payload)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.document.elements).toHaveLength(1)
  })

  it('reports a full browser storage instead of losing the change silently', () => {
    const quota = new DOMException('exceeded', 'QuotaExceededError')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota
    })

    const result = saveVectorDocument(sample())

    expect(result).toEqual({ ok: false, reason: 'quota' })
    expect(storageMessage(result)).toBe(STORAGE_FULL_MESSAGE)
  })
})
