import { describe, expect, it } from 'vitest'
import { importAudioProject, serializeAudioProject } from '@/audio/project'
import { createAudioDocument } from '@/audio/document'
import { aetherGate, aetherGateRig } from '@/audio/presets-signature'
import { generateSound } from './labs/generate'
import { DEFAULT_CRITERIA, emptyLabSession } from './labs/model'

describe('audio project files', () => {
  it('round-trip a patch, its macros and a recorded gesture', () => {
    const document = createAudioDocument()
    const patch = aetherGate()
    const rig = aetherGateRig(patch)
    const text = serializeAudioProject({ ...document, patch, rig })
    const read = importAudioProject(text)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.project.document.patch.gestures?.length).toBeGreaterThan(0)
    expect(read.project.document.rig?.parameters.some((parameter) => parameter.label === 'Open')).toBe(true)
  })

  it('refuses a file that is not one', () => {
    expect(importAudioProject('{"format":"paramrig.scene"}').ok).toBe(false)
  })
})

it('includes tables referenced only by snapshots and refuses an incomplete export', () => {
  const document = createAudioDocument()
  const patch = aetherGate()
  patch.layers[0]!.source.table = 'user:missing-table'
  document.snapshots = [{ id: 'snap', name: 'Imported', createdAt: '', patch }]
  expect(() => serializeAudioProject(document)).toThrow(/missing/i)
})

it('round-trips research state and checks tables used only by reserved sounds or saved ancestry', () => {
  const document = createAudioDocument()
  const sound = generateSound(DEFAULT_CRITERIA, 49)
  document.labs = { ...emptyLabSession(), reserve: [sound], reference: sound }
  const imported = importAudioProject(serializeAudioProject(document))
  expect(imported.ok).toBe(true)
  if (imported.ok) expect(imported.project.document.labs?.reserve[0]?.rig).toEqual(sound.rig)
  sound.patch.layers[0]!.source.table = 'user:only-in-reserve'
  expect(() => serializeAudioProject(document)).toThrow(/missing/i)
  document.labs = undefined
  const saved = generateSound(DEFAULT_CRITERIA, 71)
  saved.parents = [sound]
  document.snapshots = [{ id: 'lab-snap', name: 'Lab snapshot', createdAt: '', patch: saved.patch, rig: saved.rig, lab: saved }]
  expect(() => serializeAudioProject(document)).toThrow(/missing/i)
})

it('rejects unsupported versions and malformed binary assets before installation', () => {
  const document = createAudioDocument()
  const base = { format: 'paramrig.audio', formatVersion: 1, document }
  expect(importAudioProject({ ...base, formatVersion: 2 }).ok).toBe(false)
  expect(importAudioProject({ ...base, assets: [{ kind: 'wavetable', id: 'user:test-table', frames: 1, frameSize: 256, data: 'invalid' }] }).ok).toBe(false)
  expect(importAudioProject({ ...base, assets: [{ kind: 'wavetable', id: 'sweep', frames: 1, frameSize: 256, data: '' }] }).ok).toBe(false)
})
