import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneDocument, meshOf, ROOT_COLLECTION_ID } from '@/scene/document'
import { SCENE_ICONS } from '@/scene/iconRegistry'
import { meshCounts, meshFingerprint } from '@/scene/mesh/data'
import { ADD_MENU } from '@/scene/operators/add'
import { getOperator, listOperators, runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams } from '@/scene/operators/types'
import type { SceneDocument, SceneObject } from '@/scene/types'

/*
 * Importing '@/scene/operators/add' is what registers the family, so every test below goes through
 * the registry — the same path the menus, the keymap and the palette take.
 */

const EVERY_ID = ADD_MENU.flatMap((section) => section.items)

beforeEach(() => {
  localStorage.clear()
})

function contextFor(document: SceneDocument, overrides: Partial<OperatorContext> = {}): OperatorContext {
  return {
    document,
    selection: { objectIds: [], activeObjectId: null },
    mode: document.view.mode,
    view: document.view,
    cursor: document.cursor,
    active: null,
    ...overrides,
  }
}

/** Runs an Add operator and insists it worked: in these tests a refusal is the failure. */
function add(id: string, params: OperatorParams = {}, context = contextFor(createSceneDocument())) {
  const result = runOperator(id, context, params)
  if (!result.document) throw new Error(`${id} refused: ${result.error ?? 'it returned no document'}`)
  const object = result.document.objects.at(-1)
  if (!object) throw new Error(`${id} added nothing.`)
  return { document: result.document, object, selection: result.selection, label: result.label }
}

function countsOf(document: SceneDocument, object: SceneObject): { vertices: number; edges: number; faces: number } {
  const mesh = meshOf(document, object)
  if (!mesh) throw new Error(`${object.name} carries no mesh.`)
  const counts = meshCounts(mesh)
  return { vertices: counts.vertices, edges: counts.edges, faces: counts.faces }
}

/* ------------------------------------------------------------- the menu */

describe('the Add menu', () => {
  it('lists the sections in Blender’s order', () => {
    expect(ADD_MENU.map((section) => section.label)).toEqual(['Mesh', 'Curve', 'Text', 'Light', 'Camera', 'Empty'])
  })

  it('reaches every Add operator exactly once, and nothing that is not one', () => {
    const registered = listOperators('Add').map((operator) => operator.id).sort()

    expect([...EVERY_ID].sort()).toEqual(registered)
    expect(new Set(EVERY_ID).size).toBe(EVERY_ID.length)
  })

  it('gives every entry a label, a description and an icon the registry can draw', () => {
    for (const id of EVERY_ID) {
      const operator = getOperator(id)
      expect(operator, id).toBeDefined()
      expect(operator?.section).toBe('Add')
      expect(operator?.label).toBeTruthy()
      expect(operator?.description).toBeTruthy()
      expect(Object.hasOwn(SCENE_ICONS, operator?.icon ?? ''), `${id} icon ${operator?.icon}`).toBe(true)
    }
  })

  it('offers align, location and rotation on every entry, whatever else it has', () => {
    for (const id of EVERY_ID) {
      const ids = getOperator(id)?.params.map((param) => param.id) ?? []
      expect(ids.slice(-3), id).toEqual(['align', 'location', 'rotation'])
    }
  })
})

/* --------------------------------------------------------- adding at all */

describe('adding an object', () => {
  it('adds exactly one object, whichever entry it was', () => {
    for (const id of EVERY_ID) {
      const before = createSceneDocument()
      const { document } = add(id, {}, contextFor(before))

      expect(document.objects, id).toHaveLength(before.objects.length + 1)
    }
  })

  it('hands back a selection holding the new object, and makes it active', () => {
    const { object, selection } = add('add.cube')

    expect(selection?.objectIds).toEqual([object.id])
    expect(selection?.activeObjectId).toBe(object.id)
  })

  it('says in the history what was added', () => {
    expect(add('add.cube').label).toBe('Add cube')
    expect(add('add.lightPoint').label).toBe('Add point light')
    expect(add('add.uvSphere').label).toBe('Add UV sphere')
  })

  it('names it the way Blender does, and calls the second one .001', () => {
    const first = add('add.plane')
    const second = add('add.plane', {}, contextFor(first.document))

    expect(first.object.name).toBe('Plane')
    expect(second.object.name).toBe('Plane.001')
  })

  it('never repeats the startup file’s own names', () => {
    // The startup file already has a Cube, so the one added here is the second of that name.
    expect(add('add.cube').object.name).toBe('Cube.001')
  })

  it('lands on the 3D cursor', () => {
    const start = createSceneDocument()
    const moved: SceneDocument = { ...start, cursor: { position: [1, -2, 3], rotation: [0, 0, 0] } }

    expect(add('add.cube', {}, contextFor(moved)).object.transform.position).toEqual([1, -2, 3])
  })

  it('takes a location it is given over the cursor’s, which is what the redo panel sends', () => {
    const start = createSceneDocument()
    const moved: SceneDocument = { ...start, cursor: { position: [1, -2, 3], rotation: [0, 0, 0] } }

    expect(add('add.cube', { location: [5, 0, 0] }, contextFor(moved)).object.transform.position).toEqual([5, 0, 0])
  })

  it('joins the collection the active object is in', () => {
    const start = createSceneDocument()
    const document: SceneDocument = {
      ...start,
      collections: [...start.collections, { id: 'collection-props', name: 'Props' }],
      objects: start.objects.map((object, index) => (index === 0 ? { ...object, collectionId: 'collection-props' } : object)),
    }
    const active = document.objects[0]

    const { object } = add('add.cube', {}, contextFor(document, { active: active ?? null }))

    expect(object.collectionId).toBe('collection-props')
  })

  it('falls back to the root collection when nothing is active', () => {
    expect(add('add.cube').object.collectionId).toBe(ROOT_COLLECTION_ID)
  })

  it('gives a mesh the document’s first material as its one slot, and a light none', () => {
    const start = createSceneDocument()
    const materialId = start.materials[0]?.id

    expect(add('add.cube', {}, contextFor(start)).object.materialSlots).toEqual([materialId])
    expect(add('add.lightPoint', {}, contextFor(start)).object.materialSlots).toEqual([])
  })

  it('arrives visible, selectable, renderable and unmodified', () => {
    const { object } = add('add.torus')

    expect(object.visible).toBe(true)
    expect(object.selectable).toBe(true)
    expect(object.renderable).toBe(true)
    expect(object.modifiers).toEqual([])
    expect(object.transform.scale).toEqual([1, 1, 1])
  })

  it('leaves the document it was given alone', () => {
    const start = createSceneDocument()
    const before = start.objects.length

    add('add.cube', {}, contextFor(start))

    expect(start.objects).toHaveLength(before)
  })
})

/* -------------------------------------------------------------- the mesh */

describe('the meshes the menu makes', () => {
  const EXPECTED: Record<string, { vertices: number; edges: number; faces: number }> = {
    'add.plane': { vertices: 4, edges: 4, faces: 1 },
    'add.cube': { vertices: 8, edges: 12, faces: 6 },
    'add.circle': { vertices: 32, edges: 32, faces: 0 },
    'add.uvSphere': { vertices: 482, edges: 992, faces: 512 },
    'add.icoSphere': { vertices: 42, edges: 120, faces: 80 },
    'add.cylinder': { vertices: 64, edges: 96, faces: 34 },
    'add.cone': { vertices: 33, edges: 64, faces: 33 },
    'add.torus': { vertices: 576, edges: 1152, faces: 576 },
    'add.grid': { vertices: 100, edges: 180, faces: 81 },
    'add.paramRigMark': { vertices: 384, edges: 768, faces: 384 },
  }

  it('makes each primitive at Blender’s own defaults', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const { document, object } = add(id)

      expect(countsOf(document, object), id).toEqual(expected)
    }
  })

  it('puts the mesh in the document under an id of its own, and points the object at it', () => {
    const start = createSceneDocument()
    const { document, object } = add('add.cube', {}, contextFor(start))

    expect(Object.keys(document.meshes)).toHaveLength(Object.keys(start.meshes).length + 1)
    expect(object.data.kind).toBe('mesh')
    expect(meshOf(document, object)).not.toBeNull()
  })

  it('reads the primitive’s own parameters', () => {
    const eight = add('add.cylinder', { vertices: 8 })
    const wire = add('add.circle', { vertices: 6, fill: 'ngon' })
    const sphere = add('add.uvSphere', { segments: 8, rings: 4 })

    expect(countsOf(eight.document, eight.object)).toEqual({ vertices: 16, edges: 24, faces: 10 })
    expect(countsOf(wire.document, wire.object)).toEqual({ vertices: 6, edges: 6, faces: 1 })
    expect(countsOf(sphere.document, sphere.object)).toEqual({ vertices: 26, edges: 56, faces: 32 })
  })

  it('scales the ParamRig mark by the size it is given', () => {
    const full = add('add.paramRigMark')
    const half = add('add.paramRigMark', { size: 1 })
    const wide = meshOf(full.document, full.object)
    const narrow = meshOf(half.document, half.object)

    expect(countsOf(half.document, half.object)).toEqual(countsOf(full.document, full.object))
    expect(narrow?.vertices[0]).toBeCloseTo((wide?.vertices[0] ?? 0) / 2, 10)
  })

  it('clamps a count the primitive would refuse rather than making a broken mesh', () => {
    const tiny = add('add.circle', { vertices: 1, fill: 'ngon' })

    expect(countsOf(tiny.document, tiny.object)).toEqual({ vertices: 3, edges: 3, faces: 1 })
  })
})

/* ------------------------------------------------------------- alignment */

describe('alignment', () => {
  it('leaves the rotation at zero when it aligns to the world', () => {
    expect(add('add.plane', { align: 'world' }).object.transform.rotation).toEqual([0, 0, 0])
  })

  it('stands a plane up against the front view when it aligns to the view', () => {
    const start = createSceneDocument()
    const front: SceneDocument = { ...start, view: { ...start.view, yaw: 0, pitch: 0 } }
    const { object } = add('add.plane', { align: 'view' }, contextFor(front))

    expect(object.transform.rotation).toEqual([90, 0, 0])
  })

  it('gives a different rotation from the world alignment on the startup view', () => {
    const start = createSceneDocument()
    const world = add('add.plane', { align: 'world' }, contextFor(start)).object.transform.rotation
    const view = add('add.plane', { align: 'view' }, contextFor(start)).object.transform.rotation

    expect(view).not.toEqual(world)
    expect(view.every((angle) => Number.isFinite(angle))).toBe(true)
  })

  it('takes the 3D cursor’s own rotation when it aligns to the cursor', () => {
    const start = createSceneDocument()
    const turned: SceneDocument = { ...start, cursor: { position: [0, 0, 0], rotation: [15, 30, 45] } }
    const { object } = add('add.cube', { align: 'cursor' }, contextFor(turned))

    expect(object.transform.rotation).toEqual([15, 30, 45])
  })

  it('turns the object inside the frame the alignment gave it', () => {
    const start = createSceneDocument()
    const front: SceneDocument = { ...start, view: { ...start.view, yaw: 0, pitch: 0 } }
    const { object } = add('add.plane', { align: 'view', rotation: [0, 0, 90] }, contextFor(front))

    // Ninety about the view's own Z, on top of the ninety about X the front view gives.
    expect(object.transform.rotation[0]).toBeCloseTo(90, 6)
    expect(object.transform.rotation).not.toEqual([90, 0, 0])
  })
})

/* --------------------------------------- the lights, the camera, the empty */

describe('the lights, the camera and the empty', () => {
  it('opens each light on Blender’s own numbers', () => {
    const point = add('add.lightPoint').object.data
    const sun = add('add.lightSun').object.data
    const spot = add('add.lightSpot').object.data
    const area = add('add.lightArea').object.data

    expect(point).toMatchObject({ kind: 'light', light: 'point', power: 1000, radius: 0.1 })
    expect(sun).toMatchObject({ kind: 'light', light: 'sun', power: 1, radius: 0.526 })
    expect(spot).toMatchObject({ kind: 'light', light: 'spot', power: 1000, spotAngle: 45, spotBlur: 0.15 })
    expect(area).toMatchObject({ kind: 'light', light: 'area', power: 100, areaShape: 'square', areaSize: [1, 1] })
  })

  it('names a light after its kind, the way Blender does', () => {
    expect(add('add.lightPoint').object.name).toBe('Point')
    expect(add('add.lightSun').object.name).toBe('Sun')
    expect(add('add.lightSpot').object.name).toBe('Spot')
    expect(add('add.lightArea').object.name).toBe('Area')
  })

  it('reads a light’s own parameters', () => {
    expect(add('add.lightArea', { power: 40, shape: 'disk', size: 2 }).object.data)
      .toMatchObject({ power: 40, areaShape: 'disk', areaSize: [2, 2] })
    expect(add('add.lightSun', { angle: 5 }).object.data).toMatchObject({ radius: 5 })
  })

  it('makes the first camera the scene camera, and lets the second alone', () => {
    const start = createSceneDocument()
    const empty: SceneDocument = { ...start, objects: start.objects.filter((object) => object.kind !== 'camera') }

    expect(add('add.camera', {}, contextFor(empty)).object.data).toMatchObject({ kind: 'camera', active: true })
    expect(add('add.camera', {}, contextFor(start)).object.data).not.toMatchObject({ active: true })
  })

  it('reads the camera’s own parameters', () => {
    expect(add('add.camera', { focalLength: 24, clipEnd: 500 }).object.data)
      .toMatchObject({ kind: 'camera', focalLength: 24, clipEnd: 500 })
  })

  it('makes an empty with a display and a size, and no mesh at all', () => {
    const { document, object } = add('add.empty', { display: 'sphere', size: 3 })

    expect(object.name).toBe('Empty')
    expect(object.data).toEqual({ kind: 'empty', display: 'sphere', size: 3 })
    expect(meshOf(document, object)).toBeNull()
  })
})

/* ------------------------------------------------------------ running again */

describe('running it again', () => {
  it('gives a different mesh from the same document when a parameter changes, which is what F9 does', () => {
    const before = createSceneDocument()
    const first = add('add.cylinder', {}, contextFor(before))
    const again = add('add.cylinder', { vertices: 8 }, contextFor(before))

    const one = meshOf(first.document, first.object)
    const other = meshOf(again.document, again.object)

    expect(one && meshFingerprint(one)).not.toBe(other && meshFingerprint(other))
    expect(countsOf(again.document, again.object)).toEqual({ vertices: 16, edges: 24, faces: 10 })
    // The replay starts from the document as it was, so it adds one object, not two.
    expect(again.document.objects).toHaveLength(before.objects.length + 1)
  })

  it('repeating with the same parameters adds a second object, named apart from the first', () => {
    const first = add('add.cone')
    const second = add('add.cone', {}, contextFor(first.document))

    expect(second.object.name).toBe('Cone.001')
    expect(second.object.id).not.toBe(first.object.id)
  })
})

/* --------------------------------------------------------------- refusals */

describe('what it refuses', () => {
  it('refuses in edit mode, in a sentence a person can read', () => {
    const start = createSceneDocument()
    const editing: SceneDocument = { ...start, view: { ...start.view, mode: 'edit' } }
    const result = runOperator('add.cube', contextFor(editing))

    expect(result.error).toBe('Leave edit mode to add an object.')
    expect(result.document).toBeUndefined()
  })

  it('refuses in sculpt mode too, and names that mode', () => {
    const start = createSceneDocument()
    const sculpting: SceneDocument = { ...start, view: { ...start.view, mode: 'sculpt' } }

    expect(runOperator('add.grid', contextFor(sculpting)).error).toBe('Leave sculpt mode to add an object.')
  })

  it('is available in object mode, for every entry', () => {
    const context = contextFor(createSceneDocument())

    for (const id of EVERY_ID) {
      expect(getOperator(id)?.available(context), id).toBe(true)
    }
  })
})
