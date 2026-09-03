import { beforeEach, describe, expect, it } from 'vitest'
import {
  COMPACT_THRESHOLD_BYTES,
  createSceneDocument,
  deleteSceneDocument,
  getSceneDocument,
  listSceneDocuments,
  meshOf,
  meshUsers,
  ROOT_COLLECTION_ID,
  sanitizeSceneDocument,
  saveSceneDocument,
  sceneCounts,
  sceneManifest,
  uniqueName,
  withMesh,
} from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { validateMeshData } from '@/scene/mesh/data'
import type { SceneDocument } from '@/scene/types'

beforeEach(() => {
  localStorage.clear()
})

describe('a new scene', () => {
  it('opens on Blender’s startup file: a cube, a light and a camera', () => {
    const document = createSceneDocument()

    expect(document.objects.map((object) => object.name)).toEqual(['Cube', 'Light', 'Camera'])
    expect(document.objects.map((object) => object.kind)).toEqual(['mesh', 'light', 'camera'])
    expect(document.collections).toHaveLength(1)
    expect(document.collections[0]!.name).toBe('Scene Collection')
  })

  it('makes a cube that is a cube: eight corners, twelve edges, six quads', () => {
    const document = createSceneDocument()
    const mesh = meshOf(document, document.objects[0]!)!

    expect(mesh.vertexIds).toHaveLength(8)
    expect(mesh.edges).toHaveLength(12)
    expect(mesh.faces).toHaveLength(6)
    expect(mesh.faces.every((face) => face.length === 4)).toBe(true)
    // Euler for a closed surface of genus zero.
    expect(mesh.vertexIds.length - mesh.edges.length + mesh.faces.length).toBe(2)
  })

  it('counts what the status bar shows', () => {
    expect(sceneCounts(createSceneDocument())).toEqual({ objects: 3, vertices: 8, edges: 12, faces: 6, triangles: 12 })
  })

  it('stores itself, and reads back the same', () => {
    const document = createSceneDocument()

    expect(getSceneDocument(document.id)?.name).toBe('Untitled')
    expect(listSceneDocuments().map((entry) => entry.id)).toEqual([document.id])

    deleteSceneDocument(document.id)
    expect(getSceneDocument(document.id)).toBeNull()
  })
})

describe('names', () => {
  it('numbers a repeat the way Blender does', () => {
    expect(uniqueName([], 'Cube')).toBe('Cube')
    expect(uniqueName(['Cube'], 'Cube')).toBe('Cube.001')
    expect(uniqueName(['Cube', 'Cube.001'], 'Cube')).toBe('Cube.002')
    expect(uniqueName(['Cube', 'Cube.001'], 'Cube.001')).toBe('Cube.002')
  })
})

describe('a mesh two objects share', () => {
  it('counts its users, and replacing it leaves every other mesh alone', () => {
    const document = createSceneDocument()
    const meshId = (document.objects[0]!.data as { meshId: string }).meshId
    const linked: SceneDocument = {
      ...document,
      objects: [...document.objects, { ...document.objects[0]!, id: 'copy', name: 'Cube.001' }],
    }

    expect(meshUsers(linked, meshId)).toBe(2)

    const next = withMesh(linked, meshId, boxMesh(4))
    expect(next.meshes[meshId]!.vertices[0]).toBe(-2)
    expect(next.objects).toBe(linked.objects)
  })
})

describe('reading a document that cannot be trusted', () => {
  const base = () => JSON.parse(JSON.stringify(createSceneDocument())) as Record<string, unknown>

  it('refuses something that is not a document at all', () => {
    expect(sanitizeSceneDocument(null)).toBeNull()
    expect(sanitizeSceneDocument([])).toBeNull()
    expect(sanitizeSceneDocument({ name: 'no id' })).toBeNull()
  })

  it('drops an object whose mesh is missing', () => {
    const raw = base()
    raw.meshes = {}
    const clean = sanitizeSceneDocument(raw)!

    expect(clean.objects.map((object) => object.kind)).toEqual(['light', 'camera'])
  })

  it('drops a mesh nothing points at', () => {
    const raw = base()
    ;(raw.meshes as Record<string, unknown>).orphan = boxMesh(1)
    expect(Object.keys(sanitizeSceneDocument(raw)!.meshes)).toHaveLength(1)
  })

  it('puts an object with a missing or looping parent back at the top', () => {
    const raw = base()
    const objects = raw.objects as Array<Record<string, unknown>>
    objects[0]!.parentId = 'nobody'
    objects[1]!.parentId = objects[2]!.id
    objects[2]!.parentId = objects[1]!.id
    const clean = sanitizeSceneDocument(raw)!

    expect(clean.objects[0]!.parentId).toBeUndefined()
    // One of the two in the loop keeps its parent; neither can reach itself.
    const looping = clean.objects.filter((object) => object.parentId)
    expect(looping.length).toBeLessThanOrEqual(1)
  })

  it('moves an object in a collection that is gone into the root collection', () => {
    const raw = base()
    ;(raw.objects as Array<Record<string, unknown>>)[0]!.collectionId = 'nowhere'
    expect(sanitizeSceneDocument(raw)!.objects[0]!.collectionId).toBe(ROOT_COLLECTION_ID)
  })

  it('gives every object a name no other object has', () => {
    const raw = base()
    for (const object of raw.objects as Array<Record<string, unknown>>) object.name = 'Thing'
    const names = sanitizeSceneDocument(raw)!.objects.map((object) => object.name)

    expect(names).toEqual(['Thing', 'Thing.001', 'Thing.002'])
  })

  it('keeps one active camera at most', () => {
    const raw = base()
    const objects = raw.objects as Array<Record<string, unknown>>
    objects.push({ ...objects[2], id: 'camera-2', name: 'Camera.001' })
    const cameras = sanitizeSceneDocument(raw)!.objects.filter((object) => object.data.kind === 'camera')

    expect(cameras.filter((object) => (object.data as { active?: boolean }).active)).toHaveLength(1)
  })

  it('drops a material slot that names no material', () => {
    const raw = base()
    ;(raw.objects as Array<Record<string, unknown>>)[0]!.materialSlots = ['gone']
    // A mesh always keeps one slot, so the faces have somewhere to point.
    expect(sanitizeSceneDocument(raw)!.objects[0]!.materialSlots).toEqual(['material-default'])
  })

  it('keeps the view it was left with, and repairs the parts that make no sense', () => {
    const raw = base()
    raw.view = { yaw: 12, pitch: 400, shading: 'nonsense', selectMode: ['face', 'nope'], distance: -3 }
    const view = sanitizeSceneDocument(raw)!.view

    expect(view.yaw).toBe(12)
    expect(view.pitch).toBe(89.9)
    expect(view.shading).toBe('solid')
    expect(view.selectMode).toEqual(['face'])
    expect(view.distance).toBeGreaterThan(0)
  })
})

describe('a mesh that cannot be trusted', () => {
  it('drops an edge that names one vertex twice, or a vertex that is not there', () => {
    const mesh = validateMeshData({ ...boxMesh(2), edges: [[0, 0], [0, 99], [0, 1]] })!

    // The face loops put the other eleven edges back.
    expect(mesh.edges).toContainEqual([0, 1])
    expect(mesh.edges.every(([a, b]) => a !== b && a >= 0 && b < 8)).toBe(true)
    expect(mesh.edges).toHaveLength(12)
  })

  it('drops a face with fewer than three distinct corners', () => {
    const mesh = validateMeshData({ ...boxMesh(2), faces: [[0, 1, 1], [0, 1, 2, 3], [4]] })!

    expect(mesh.faces).toEqual([[0, 1, 2, 3]])
  })

  it('never hands out the same vertex id twice', () => {
    const mesh = validateMeshData({ ...boxMesh(2), vertexIds: [0, 0, 0, 0, 0, 0, 0, 0] })!

    expect(new Set(mesh.vertexIds).size).toBe(8)
    expect(mesh.nextVertexId).toBeGreaterThanOrEqual(8)
  })

  it('keeps the edges a face needs even when the file left them out', () => {
    const mesh = validateMeshData({ ...boxMesh(2), edges: [] })!

    expect(mesh.edges).toHaveLength(12)
  })
})

describe('the manifest the workbench reads', () => {
  it('names the document, its renderer and where it belongs', () => {
    const document = createSceneDocument()
    const manifest = sceneManifest({ ...document, name: 'Lamp' })

    expect(manifest).toMatchObject({
      id: document.id,
      name: 'Lamp',
      renderer: 'scene',
      rendererLabel: 'Scene',
      collection: 'project',
      title: 'Projects/Scene',
      summary: 'Scene · 3 objects',
      parameters: [],
    })
  })
})

describe('a document too big for browser storage', () => {
  it('rounds positions once it is heavy, and refuses one that is heavier still', () => {
    const document = createSceneDocument()
    const meshId = (document.objects[0]!.data as { meshId: string }).meshId
    const wide = boxMesh(2)
    // Enough vertices to cross the compaction threshold, each with digits to lose.
    const vertices: number[] = []
    const ids: number[] = []
    for (let index = 0; index < 200_000; index += 1) {
      vertices.push(index + 0.123456789, 0.987654321, 0.111111111)
      ids.push(index)
    }
    const heavy: SceneDocument = {
      ...document,
      meshes: { [meshId]: { ...wide, vertices, vertexIds: ids, nextVertexId: ids.length, edges: [], faces: [], faceIds: [], nextFaceId: 0 } },
    }
    expect(JSON.stringify(heavy).length).toBeGreaterThan(COMPACT_THRESHOLD_BYTES)

    expect(saveSceneDocument(heavy)).toEqual({ ok: false, reason: 'quota' })
  })
})
