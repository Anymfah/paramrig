import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneDocument, meshOf } from '@/scene/document'
import { exportProject, importProject, projectFileName, serializeProject } from '@/scene/project'
import { listRigs } from '@/rigs/registry'
import { paperLantern } from '@/rigs/examples/paper-lantern'
import { resolveSceneValues, sceneRigDefaults } from '@/scene/rig'
import { initializeBuiltinModifiers } from '@/scene/modifiers'
initializeBuiltinModifiers()

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

  it('brings a rig in with the document, in one file', () => {
    const document = paperLantern()
    const result = importProject(serializeProject(document))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rig = result.project.document.rig
    expect(rig?.parameters.map((parameter) => parameter.id)).toEqual(['roundness', 'paper', 'spin', 'glow', 'brightness'])
    expect(rig?.bindings).toHaveLength(5)
    expect(result.note).toBeUndefined()
    // And it resolves: a file that arrives with a rig arrives usable, not merely parsed.
    const turned = resolveSceneValues(result.project.document, { ...sceneRigDefaults(rig!), spin: 45 })
    expect(turned.objects.find((object) => object.name === 'Lantern')!.transform.rotation[2]).toBe(45)
  })

  it('says which bindings pointed at something the file does not contain', () => {
    const document = paperLantern()
    const damaged = {
      ...document,
      rig: {
        ...document.rig!,
        bindings: [
          ...document.rig!.bindings,
          { id: 'ghost-object', objectId: 'object-nowhere', property: 'transform.position.z', parameterId: 'spin' },
          { id: 'ghost-modifier', objectId: 'object-lantern', property: 'modifiers[nothing].levels', parameterId: 'roundness' },
        ],
      },
    }
    const result = importProject(JSON.stringify({ ...exportProject(document), document: damaged }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.document.rig?.bindings).toHaveLength(5)
    expect(result.note).toBe('2 bindings pointed at something this file does not contain.')
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
