import { beforeEach, describe, expect, it } from 'vitest'
import {
  audioManifest, createAudioDocument, deleteAudioDocument, getAudioDocument,
  isBundledAudioDocument, listAudioDocuments, sanitizeAudioDocument, saveAudioDocument,
} from '@/audio/document'
import { arcadeCoin } from '@/rigs/examples/arcade-coin'

beforeEach(() => {
  localStorage.clear()
})

describe('bundled patches', () => {
  it('are listed even though this browser has never stored one', () => {
    expect(listAudioDocuments().map((document) => document.id)).toContain(arcadeCoin().id)
    expect(isBundledAudioDocument(arcadeCoin().id)).toBe(true)
  })

  /** Opening an example is not editing it, or looking at one would file it as your own project. */
  it('are not copied into storage by being opened and saved unchanged', () => {
    const document = getAudioDocument(arcadeCoin().id)
    expect(document).not.toBeNull()
    if (!document) return
    expect(saveAudioDocument(document).ok).toBe(true)
    expect(localStorage.getItem('paramrig.audio-documents.v1')).toBeNull()
    expect(isBundledAudioDocument(document.id)).toBe(true)
  })

  it('become this browser’s document the moment one number changes', () => {
    const document = getAudioDocument(arcadeCoin().id)
    if (!document) throw new Error('the example should be there')
    saveAudioDocument({ ...document, patch: { ...document.patch, duration: 0.9 } })
    expect(isBundledAudioDocument(document.id)).toBe(false)
    expect(getAudioDocument(document.id)?.patch.duration).toBe(0.9)
  })
})

describe('local patches', () => {
  it('are created, listed, read back and removed', () => {
    const document = createAudioDocument()
    expect(getAudioDocument(document.id)?.name).toBe('Untitled')
    expect(listAudioDocuments().some((entry) => entry.id === document.id)).toBe(true)
    deleteAudioDocument(document.id)
    expect(getAudioDocument(document.id)).toBeNull()
  })

  it('come back newest first', () => {
    const first = createAudioDocument()
    saveAudioDocument({ ...first, updatedAt: '2026-01-01T00:00:00.000Z' })
    const second = createAudioDocument()
    saveAudioDocument({ ...second, updatedAt: '2026-05-05T00:00:00.000Z' })
    const ids = listAudioDocuments().map((entry) => entry.id)
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))
  })
})

describe('sanitizeAudioDocument', () => {
  it('needs an id and nothing else', () => {
    expect(sanitizeAudioDocument({ id: 'audio-1' })).toMatchObject({ id: 'audio-1', name: 'Untitled' })
    expect(sanitizeAudioDocument({})).toBeNull()
    expect(sanitizeAudioDocument(null)).toBeNull()
  })

  it('keeps a rig that reads back and drops one that does not', () => {
    expect(sanitizeAudioDocument({ id: 'a', rig: { groups: [] } })?.rig).toBeUndefined()
    const good = sanitizeAudioDocument(arcadeCoin())
    expect(good?.rig?.parameters).toHaveLength(4)
    expect(good?.rig?.bindings).toHaveLength(4)
  })

  /** The controls of the bundled example must survive the shared sanitiser, log scale included. */
  it('keeps the logarithmic scale and the display units of a control', () => {
    const rig = sanitizeAudioDocument(arcadeCoin())?.rig
    expect(rig?.parameters.find((parameter) => parameter.id === 'pitch')).toMatchObject({ scale: 'log', unit: 'Hz' })
    const length = rig?.parameters.find((parameter) => parameter.id === 'length')
    expect(length && 'units' in length ? length.units?.map((unit) => unit.value) : []).toEqual(['ms', 's'])
  })
})

describe('audioManifest', () => {
  it('describes a bundled patch as an example that carries controls', () => {
    const manifest = audioManifest(arcadeCoin())
    expect(manifest).toMatchObject({
      renderer: 'audio',
      rendererLabel: 'Audio',
      collection: 'examples',
      title: 'Examples/Audio',
      summary: 'Audio · 4 controls',
    })
    expect(manifest.parameters).toHaveLength(4)
  })

  it('describes a plain patch by its length and its layers', () => {
    const document = createAudioDocument()
    const manifest = audioManifest(document)
    expect(manifest.collection).toBe('project')
    expect(manifest.title).toBe('Projects/Audio')
    expect(manifest.summary).toBe('Audio · 250 ms, 1 layer')
    expect(manifest.parameters).toHaveLength(0)
  })
})
