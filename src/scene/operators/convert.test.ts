import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSceneDocument, objectById, ROOT_COLLECTION_ID } from '@/scene/document'
import { bezierCircleData, DEFAULT_TEXT, pathData } from '@/scene/curve/data'
import { registerOutlineFont, resetOutlineFonts, type OutlineFont } from '@/scene/curve/font'
import { clearGeneratedCache, objectMesh } from '@/scene/modifiers/stack'
import '@/scene/operators/convert'
import { operatorAvailability, runOperator } from '@/scene/operators/registry'
import type { OperatorContext } from '@/scene/operators/types'
import type { ObjectData, SceneDocument, SceneObject } from '@/scene/types'

/**
 * Convert: the one operator that changes what an object *is*. It reads the same evaluated mesh the
 * viewport draws, which is the whole promise — what you convert is what you were looking at.
 */

beforeAll(async () => {
  const opentype = await import('opentype.js')
  const bytes = readFileSync('public/fonts/PublicSans.ttf')
  resetOutlineFonts()
  registerOutlineFont('Public Sans', opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as unknown as OutlineFont)
  clearGeneratedCache()
})

function object(id: string, data: ObjectData): SceneObject {
  return {
    id,
    name: id,
    kind: data.kind,
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data,
    modifiers: [],
    materialSlots: [],
  }
}

function scene(objects: SceneObject[]): SceneDocument {
  return { ...createSceneDocument(), objects, meshes: {} }
}

function contextFor(document: SceneDocument, id: string): OperatorContext {
  return {
    document,
    selection: { objectIds: [id], activeObjectId: id },
    mode: 'object',
    view: document.view,
    cursor: document.cursor,
    active: objectById(document, id),
  }
}

describe('object.convertToMesh', () => {
  it('replaces a filled curve with the mesh it was drawing', () => {
    const document = scene([object('curve', { ...bezierCircleData(), extrude: 0.2 })])
    const evaluated = objectMesh(document, document.objects[0]!)!
    const result = runOperator('object.convertToMesh', contextFor(document, 'curve'))
    expect('error' in result).toBe(false)
    const converted = objectById(result.document!, 'curve')!
    expect(converted.kind).toBe('mesh')
    expect(converted.data.kind).toBe('mesh')
    const mesh = result.document!.meshes[(converted.data as { meshId: string }).meshId]!
    expect(mesh.faces).toHaveLength(evaluated.faces.length)
    expect(mesh.vertices).toEqual(evaluated.vertices)
  })

  it('refuses a curve that has no surface, and says what is missing', () => {
    const document = scene([object('curve', { ...pathData(), fill: 'none' })])
    const result = runOperator('object.convertToMesh', contextFor(document, 'curve'))
    expect(result.error).toContain('no surface')
    expect(result.document).toBeUndefined()
  })

  it('turns a text object into a mesh of its letters', () => {
    const document = scene([object('text', { ...DEFAULT_TEXT, body: 'A', extrude: 0.1 })])
    const result = runOperator('object.convertToMesh', contextFor(document, 'text'))
    const converted = objectById(result.document!, 'text')!
    expect(converted.kind).toBe('mesh')
    const mesh = result.document!.meshes[(converted.data as { meshId: string }).meshId]!
    expect(mesh.faces.length).toBeGreaterThan(10)
  })

  it('is out of reach in edit mode', () => {
    const document = scene([object('curve', bezierCircleData())])
    const context = { ...contextFor(document, 'curve'), mode: 'edit' as const }
    expect(operatorAvailability('object.convertToMesh', context)).toBe('Leave edit mode to convert an object.')
  })
})

describe('object.convertToCurve', () => {
  it('replaces a text object with the outlines of its letters', () => {
    const document = scene([object('text', { ...DEFAULT_TEXT, body: 'A' })])
    const result = runOperator('object.convertToCurve', contextFor(document, 'text'))
    const converted = objectById(result.document!, 'text')!
    expect(converted.kind).toBe('curve')
    expect(converted.data.kind).toBe('curve')
    expect((converted.data as { splines: unknown[] }).splines).toHaveLength(2)
  })

  it('has nothing to say about a curve', () => {
    const document = scene([object('curve', bezierCircleData())])
    expect(operatorAvailability('object.convertToCurve', contextFor(document, 'curve'))).toBe('Select a text object to convert.')
  })
})

describe('objectMesh', () => {
  it('gives the same mesh back for the same curve, and a new one when it changes', () => {
    const document = scene([object('curve', { ...bezierCircleData(), extrude: 0.2 })])
    const first = objectMesh(document, document.objects[0]!)
    const again = objectMesh(document, document.objects[0]!)
    expect(again).toBe(first)
    const moved = scene([object('curve', { ...bezierCircleData(), extrude: 0.4 })])
    expect(objectMesh(moved, moved.objects[0]!)).not.toBe(first)
  })

  it('has nothing for a light', () => {
    const document = createSceneDocument()
    const light = document.objects.find((entry) => entry.data.kind === 'light')
    expect(light ? objectMesh(document, light) : null).toBeNull()
  })
})
