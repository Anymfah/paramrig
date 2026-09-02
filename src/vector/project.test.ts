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

describe('a project file that carries a rig', () => {
  const withRig = (rig: unknown) => ({
    format: 'paramrig.vector',
    formatVersion: 1,
    document: {
      version: 1,
      id: 'vector-imported',
      name: 'Imported',
      width: 400,
      height: 400,
      background: '#101211',
      elements: [{ id: 'a', kind: 'rectangle', name: 'Rect', x: 0, y: 0, width: 10, height: 10, rotation: 0, fill: '#FFFFFF', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false }],
      guides: [],
      rig,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    },
  })

  it('brings the controls and the bindings in with the drawing', () => {
    const result = importProject(withRig({
      groups: [{ id: 'main', label: 'Main' }],
      parameters: [{ kind: 'number', id: 'w', label: 'Width', group: 'main', min: 0, max: 100, step: 1, defaultValue: 10 }],
      bindings: [{ id: 'b', elementId: 'a', parameterId: 'w', property: 'width' }],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.document.rig?.parameters).toHaveLength(1)
    expect(result.project.document.rig?.bindings).toHaveLength(1)
    expect(result.note).toBeUndefined()
  })

  it('says what it could not read instead of dropping it in silence', () => {
    const result = importProject(withRig({
      groups: [{ id: 'main', label: 'Main' }],
      parameters: [
        { kind: 'number', id: 'w', label: 'Width', group: 'main', min: 0, max: 100, step: 1, defaultValue: 10 },
        { kind: 'gizmo3d', id: 'g', label: 'Gizmo', group: 'main' },
      ],
      bindings: [
        { id: 'b', elementId: 'a', parameterId: 'w', property: 'width' },
        { id: 'orphan', elementId: 'gone', parameterId: 'w', property: 'width' },
      ],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.note).toBe('1 control and 1 binding in that file could not be read and were left out.')
  })
})
