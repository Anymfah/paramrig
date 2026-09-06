import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSceneDocumentCache,
  COMPACT_THRESHOLD_BYTES,
  compactDocument,
  createSceneDocument,
  deleteSceneDocument,
  getSceneDocument,
  isBundledScene,
  listSceneDocuments,
  MAX_STORED_BYTES,
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
import { sanitizeSceneRig, sceneRigTargets } from '@/scene/rig'
import { validateMeshData } from '@/scene/mesh/data'
import type { SceneDocument } from '@/scene/types'

beforeEach(() => {
  localStorage.clear()
  // The store is cached in the module, and clearing storage does not reach it: without this a test
  // that saved something heavy leaves it in the next test's store, where it fills the quota.
  clearSceneDocumentCache()
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
    // Beside it, whatever the app ships: a bundled example is a document like any other.
    expect(listSceneDocuments().map((entry) => entry.id)).toContain(document.id)

    deleteSceneDocument(document.id)
    expect(getSceneDocument(document.id)).toBeNull()
  })

  it('serves the bundled examples until they are edited', () => {
    const lantern = getSceneDocument('example-paper-lantern')
    expect(lantern?.name).toBe('Paper lantern')
    expect(isBundledScene('example-paper-lantern')).toBe(true)
    expect(sceneManifest(lantern!).title).toBe('Examples/Scene')
    // Its rig comes with it, so the library card can offer the controls before it is opened.
    expect(lantern?.rig?.parameters).toHaveLength(5)
    expect(lantern?.rig?.bindings).toHaveLength(5)

    // Opening it saves it as it was found, which must not count as editing it.
    saveSceneDocument(lantern!)
    expect(isBundledScene('example-paper-lantern')).toBe(true)

    saveSceneDocument({ ...lantern!, name: 'Mine' })
    expect(getSceneDocument('example-paper-lantern')?.name).toBe('Mine')
    expect(isBundledScene('example-paper-lantern')).toBe(false)
    expect(sceneManifest(getSceneDocument('example-paper-lantern')!).title).toBe('Projects/Scene')
    // And it is listed once, not twice.
    expect(listSceneDocuments().filter((entry) => entry.id === 'example-paper-lantern')).toHaveLength(1)
  })

  it('keeps every binding of the bundled example pointing at something', () => {
    const lantern = getSceneDocument('example-paper-lantern')!
    const kept = sanitizeSceneRig(lantern.rig, sceneRigTargets(lantern))
    expect(kept?.bindings).toHaveLength(lantern.rig!.bindings.length)
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

describe('the shape keys a file carries', () => {
  it('keeps a sound key, holds its range the right way round and clamps the active one', () => {
    const base = createSceneDocument()
    const read = sanitizeSceneDocument({
      ...base,
      objects: base.objects.map((object) => (object.kind === 'mesh'
        ? {
          ...object,
          activeShapeKey: 9,
          shapeKeys: [
            { name: 'Smile', value: 0.5, min: 1, max: 0, offsets: { 3: [0, 0, 1] } },
            { name: '', value: 'x', min: 0, max: 1, offsets: { nonsense: [0, 0, 1], 4: [1, 'x', null] } },
          ],
        }
        : object)),
    })!
    const object = read.objects.find((entry) => entry.kind === 'mesh')!
    expect(object.shapeKeys).toHaveLength(2)
    // A range written the wrong way round is not a refusal, it is a range: the two are swapped.
    expect(object.shapeKeys![0]).toMatchObject({ name: 'Smile', min: 0, max: 1, value: 0.5 })
    expect(object.shapeKeys![1]!.name).toBe('Key')
    expect(object.shapeKeys![1]!.value).toBe(0)
    // An offset against something that is not a vertex id is not an offset.
    expect(Object.keys(object.shapeKeys![1]!.offsets)).toEqual(['4'])
    expect(object.shapeKeys![1]!.offsets['4']).toEqual([1, 0, 0])
    expect(object.activeShapeKey).toBe(1)
  })

  it('carries none at all when the file has none', () => {
    const read = sanitizeSceneDocument(createSceneDocument())!
    expect(read.objects.every((object) => object.shapeKeys === undefined)).toBe(true)
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

  /**
   * A scene too big to store is the one the editor works hardest on, and it used to pay the whole
   * price of storing it on every turn of the camera: sanitise a hundred thousand vertices, round
   * them, serialise twenty-seven megabytes twice, then refuse. These four say it is found out once.
   */
  describe('once it has been refused', () => {
    /*
     * Built once and shared, because building it is the slow part of these tests, and the value it
     * carries — five decimals — is the value rounding would leave, so the document is over the
     * ceiling before compaction and still over it after. The assertion below is the premise: if a
     * change ever brings it under, these tests would quietly start measuring jsdom's own quota
     * instead of the gate they are about.
     */
    let heavy: SceneDocument | null = null
    const tooBig = (): SceneDocument => {
      if (heavy) return heavy
      const document = createSceneDocument()
      const meshId = (document.objects[0]!.data as { meshId: string }).meshId
      const vertices: number[] = []
      const ids: number[] = []
      for (let index = 0; index < 600_000; index += 1) {
        vertices.push(index + 0.12345, 0.98765, 0.11111)
        ids.push(index)
      }
      heavy = {
        ...document,
        meshes: { [meshId]: { ...boxMesh(2), vertices, vertexIds: ids, nextVertexId: ids.length, edges: [], faces: [], faceIds: [], nextFaceId: 0 } },
      }
      return heavy
    }
    /** What a Tab or an orbit leaves behind: the same content, a different view. */
    const looked = (document: SceneDocument): SceneDocument =>
      ({ ...document, view: { ...document.view, yaw: document.view.yaw + 15 }, updatedAt: new Date().toISOString() })

    it('is over the ceiling even after rounding, which is what makes these tests about the gate', () => {
      expect(JSON.stringify(compactDocument(tooBig())).length).toBeGreaterThan(MAX_STORED_BYTES)
    })

    it('does not weigh the same content twice', () => {
      const document = tooBig()
      const first = performance.now()
      expect(saveSceneDocument(document)).toEqual({ ok: false, reason: 'quota' })
      const weighed = performance.now() - first
      const second = performance.now()
      expect(saveSceneDocument(looked(document))).toEqual({ ok: false, reason: 'quota' })
      const remembered = performance.now() - second
      // Time is the only witness there is: the answer is the same either way, and the whole point
      // of the change is that arriving at it costs nothing the second time.
      expect(remembered).toBeLessThan(weighed / 5)
    })

    it('still lets the view through, so the scene reopens where it was left', () => {
      const small = createSceneDocument()
      const meshId = (small.objects[0]!.data as { meshId: string }).meshId
      expect(getSceneDocument(small.id)?.meshes[meshId]?.vertexIds).toHaveLength(8)
      const grown = { ...tooBig(), id: small.id }
      expect(saveSceneDocument(grown)).toEqual({ ok: false, reason: 'quota' })
      const turned = looked(grown)
      expect(saveSceneDocument(turned)).toEqual({ ok: false, reason: 'quota' })
      const held = getSceneDocument(small.id)
      expect(held?.view.yaw).toBe(turned.view.yaw)
      /*
       * And what could not be stored was not stored. The cache deliberately holds what this tab is
       * holding, refused or not, so the question has to be put to storage itself: forget the cache
       * and read it back.
       */
      clearSceneDocumentCache()
      expect(getSceneDocument(small.id)?.meshes[meshId]?.vertexIds).toHaveLength(8)
    })

    it('forgets the refusal when the content changes, so a scene that fits is written', () => {
      const document = tooBig()
      expect(saveSceneDocument(document)).toEqual({ ok: false, reason: 'quota' })
      const meshId = (document.objects[0]!.data as { meshId: string }).meshId
      expect(saveSceneDocument(withMesh(document, meshId, boxMesh(2))).ok).toBe(true)
      expect(getSceneDocument(document.id)?.meshes[meshId]?.vertexIds).toHaveLength(8)
    })

    /**
     * The refusal has to leave nothing behind, because the map it was nearly filed in is the
     * module's own cache and not a copy of it. Filed and then refused, twenty-seven megabytes sat
     * in the cache of a tab that had just declined to store them, and the next scene to save — a
     * cube, four kilobytes — was written out with them: one `setItem` over quota, silently, and
     * every edit of that scene lost on reload. This suite's own `beforeEach` describes the same
     * leak from the inside, which is how long it had been arranged around rather than fixed.
     */
    it('leaves nothing of what it refused for the next scene to carry', () => {
      const heavy = { ...tooBig(), id: 'scene-refused' }
      expect(saveSceneDocument(heavy)).toEqual({ ok: false, reason: 'quota' })
      // Its id and not the document: a failure here prints what it was given, and printing
      // twenty-seven megabytes of vertices is how this assertion ends a test worker rather than a test.
      expect(getSceneDocument(heavy.id)?.id ?? null).toBeNull()

      const written = vi.spyOn(Storage.prototype, 'setItem')
      try {
        expect(saveSceneDocument(createSceneDocument('After')).ok).toBe(true)
        const payload = written.mock.calls.at(-1)?.[1] ?? ''
        expect(payload).not.toContain(heavy.id)
        expect(payload.length).toBeLessThan(COMPACT_THRESHOLD_BYTES)
      } finally {
        written.mockRestore()
      }
    })

    it('is forgotten with the rest when another tab writes', () => {
      const document = tooBig()
      expect(saveSceneDocument(document)).toEqual({ ok: false, reason: 'quota' })
      clearSceneDocumentCache()
      const second = performance.now()
      expect(saveSceneDocument(looked(document))).toEqual({ ok: false, reason: 'quota' })
      // Weighed again, because the cache it belonged to is gone.
      expect(performance.now() - second).toBeGreaterThan(1)
    })
  })
})

/**
 * Sanitising a document is nearly all mesh reading, and an edit that leaves the geometry alone
 * hands back the very same `meshes` object. These say it is read once.
 */
describe('saving a document whose geometry has not changed', () => {
  it('stores exactly what saving it the first time stored', () => {
    const document = createSceneDocument()
    expect(saveSceneDocument(document).ok).toBe(true)
    const first = getSceneDocument(document.id)
    const turned = { ...document, view: { ...document.view, yaw: document.view.yaw + 15 } }
    expect(saveSceneDocument(turned).ok).toBe(true)
    const second = getSceneDocument(document.id)
    expect(second?.meshes).toEqual(first?.meshes)
    expect(second?.view.yaw).toBe(turned.view.yaw)
  })

  it('reads the meshes again as soon as one of them is different', () => {
    const document = createSceneDocument()
    expect(saveSceneDocument(document).ok).toBe(true)
    const meshId = (document.objects[0]!.data as { meshId: string }).meshId
    const broken = { ...boxMesh(2), faces: [[0, 0, 0]] }
    expect(saveSceneDocument(withMesh(document, meshId, broken)).ok).toBe(true)
    // A face with three of the same corner is not a face, and the sanitiser drops it — which it
    // can only do if the new record sent it back to reading rather than to what it read before.
    expect(getSceneDocument(document.id)?.meshes[meshId]?.faces).toEqual([])
  })
})
