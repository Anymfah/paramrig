import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneDocument, meshOf } from '@/scene/document'
import { exportProject, importProject, projectFileName, serializeProject } from '@/scene/project'
import { listRigs } from '@/rigs/registry'

beforeEach(() => {
  localStorage.clear()
})

describe('a scene saved to a file and read back', () => {
  it('comes back the same document', () => {
    const document = createSceneDocument('Lamp')
    const result = importProject(serializeProject(document))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.document.id).toBe(document.id)
    expect(result.project.document.name).toBe('Lamp')
    expect(result.project.document.objects.map((object) => object.name)).toEqual(['Cube', 'Light', 'Camera'])
    expect(meshOf(result.project.document, result.project.document.objects[0]!)!.faces).toHaveLength(6)
  })

  it('names the file after the document', () => {
    expect(projectFileName({ ...createSceneDocument(), name: 'Desk lamp v2' })).toBe('desk-lamp-v2.paramrig.json')
  })

  it('marks the file so the right editor claims it', () => {
    expect(exportProject(createSceneDocument())).toMatchObject({ format: 'paramrig.scene', kind: 'scene', formatVersion: 1 })
  })
})

describe('a file that is not a scene', () => {
  it('says a vector document is a vector document', () => {
    const result = importProject(JSON.stringify({ format: 'paramrig.vector', formatVersion: 1, document: {} }))

    expect(result).toEqual({ ok: false, error: 'That is a vector document. Open it from the library, or use File · Import project in the vector editor.' })
  })

  it('refuses anything else by name', () => {
    expect(importProject('not json')).toEqual({ ok: false, error: 'That file is not valid JSON.' })
    expect(importProject('[]')).toEqual({ ok: false, error: 'That file is not a ParamRig project.' })
    expect(importProject(JSON.stringify({ format: 'something.else' }))).toEqual({ ok: false, error: 'That file is not a ParamRig scene.' })
  })

  it('refuses a scene from a newer version of the app', () => {
    const raw = JSON.parse(serializeProject(createSceneDocument())) as Record<string, unknown>
    raw.formatVersion = 99

    expect(importProject(JSON.stringify(raw))).toEqual({ ok: false, error: 'That scene was saved by a newer version of ParamRig.' })
  })

  it('says what a damaged file lost rather than losing it quietly', () => {
    const raw = JSON.parse(serializeProject(createSceneDocument())) as { document: Record<string, unknown> }
    raw.document.meshes = {}
    const result = importProject(JSON.stringify(raw))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.note).toBe('1 object could not be read and was left out.')
  })
})

describe('the library', () => {
  it('lists a stored scene beside the documents and the examples', () => {
    const document = createSceneDocument('Lamp')
    const rigs = listRigs()

    expect(rigs.find((rig) => rig.id === document.id)).toMatchObject({ name: 'Lamp', renderer: 'scene' })
  })
})
