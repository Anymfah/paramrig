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

describe('carrying a saved document forward', () => {
  it('moves the controls someone exposed onto the paths that moved, rather than deleting them', () => {
    // A document written before the two lists of modulators became one list of slots.
    const older = {
      version: 1,
      id: 'older-one',
      name: 'Older',
      patch: { version: 1, duration: 0.3, lfos: [{ enabled: true, rate: 7, target: 'layers[0].cutoff' }] },
      rig: {
        groups: [{ id: 'g', label: 'Group' }],
        parameters: [
          { kind: 'number', id: 'speed', label: 'Speed', group: 'g', min: 0.1, max: 40, step: 0.1, defaultValue: 7 },
          { kind: 'number', id: 'sweep', label: 'Sweep', group: 'g', min: -1, max: 1, step: 0.01, defaultValue: 0.5 },
        ],
        bindings: [
          { id: 'a', property: 'lfos[0].rate', parameterId: 'speed' },
          { id: 'b', property: 'envelopes[1].depth', parameterId: 'sweep' },
        ],
      },
    }
    const read = sanitizeAudioDocument(older)
    // The first oscillator was the third slot, and the second free envelope was the second.
    expect(read?.rig?.bindings.map((binding) => binding.property)).toEqual(['mods[2].rate', 'mods[1].depth'])
    expect(read?.patch.mods[2]).toMatchObject({ kind: 'lfo', enabled: true, rate: 7, target: 'layers[0].cutoff' })
  })

  it('follows the drive and the body into the slots they became', () => {
    // A document written while every layer had one drive and one resonator, in a fixed order.
    const older = {
      version: 1,
      id: 'older-two',
      name: 'Older still',
      patch: { version: 2, duration: 0.3, layers: [{ shaper: { drive: 0.4, bitDepth: 8, crush: 0.1 }, resonator: { amount: 0.5, frequency: 700 } }] },
      rig: {
        groups: [{ id: 'g', label: 'Group' }],
        parameters: [
          { kind: 'number', id: 'grit', label: 'Grit', group: 'g', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
          { kind: 'number', id: 'bits', label: 'Bits', group: 'g', min: 1, max: 16, step: 1, defaultValue: 8 },
          { kind: 'number', id: 'ring', label: 'Ring', group: 'g', min: 40, max: 16000, step: 1, defaultValue: 700 },
        ],
        bindings: [
          { id: 'a', property: 'layers[0].shaper.drive', parameterId: 'grit' },
          { id: 'b', property: 'layers[0].shaper.bitDepth', parameterId: 'bits' },
          { id: 'c', property: 'layers[0].resonator.frequency', parameterId: 'ring' },
        ],
      },
    }
    const read = sanitizeAudioDocument(older)
    expect(read?.rig?.bindings.map((binding) => binding.property)).toEqual(
      ['layers[0].insertA.drive', 'layers[0].insertB.bitDepth', 'layers[0].insertC.frequency'],
    )
    expect(read?.patch.layers[0]?.insertA).toMatchObject({ kind: 'drive', drive: 0.4 })
    expect(read?.patch.layers[0]?.insertC).toMatchObject({ kind: 'body', place: 'post', frequency: 700 })
  })

  it('follows the master effects into the slots they became', () => {
    const older = {
      version: 1,
      id: 'older-three',
      name: 'Older again',
      patch: { version: 3, duration: 0.3, fx: { delayMix: 0.4, delayTime: 0.08, reverbMix: 0.3, flangerMix: 0.2 } },
      rig: {
        groups: [{ id: 'g', label: 'Group' }],
        parameters: [
          { kind: 'number', id: 'echo', label: 'Echo', group: 'g', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
          { kind: 'number', id: 'room', label: 'Room', group: 'g', min: 0, max: 1, step: 0.01, defaultValue: 0.3 },
          { kind: 'number', id: 'jet', label: 'Jet', group: 'g', min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
        ],
        bindings: [
          { id: 'a', property: 'fx.delayMix', parameterId: 'echo' },
          { id: 'b', property: 'fx.reverbSize', parameterId: 'room' },
          { id: 'c', property: 'fx.flangerRate', parameterId: 'jet' },
        ],
      },
    }
    const read = sanitizeAudioDocument(older)
    expect(read?.rig?.bindings.map((binding) => binding.property)).toEqual(['fx.y.mix', 'fx.z.size', 'fx.x.rate'])
  })

  it('follows a layer’s one filter into the first of the two it became', () => {
    const older = {
      version: 1,
      id: 'older-four',
      name: 'Older yet',
      patch: { version: 4, duration: 0.3, layers: [{ filter: { kind: 'lowpass', cutoff: 900, resonance: 0.5 } }] },
      rig: {
        groups: [{ id: 'g', label: 'Group' }],
        parameters: [
          { kind: 'number', id: 'corner', label: 'Corner', group: 'g', min: 20, max: 20000, step: 1, defaultValue: 900 },
        ],
        bindings: [{ id: 'a', property: 'layers[0].filter.cutoff', parameterId: 'corner' }],
      },
    }
    const read = sanitizeAudioDocument(older)
    expect(read?.rig?.bindings.map((binding) => binding.property)).toEqual(['layers[0].filterA.cutoff'])
    expect(read?.patch.layers[0]?.filterA.cutoff).toBeCloseTo(900, 6)
  })
})
