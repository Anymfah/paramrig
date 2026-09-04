import { Vector3 } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneDocument, DEFAULT_MATERIAL, meshOf, objectById, ROOT_COLLECTION_ID } from '@/scene/document'
import { KEYMAP } from '@/scene/keymap'
import { meshFromPolygons, vertexPosition } from '@/scene/mesh/data'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import { worldMatrix } from '@/scene/objects'
import '@/scene/operators/cursor'
import { pasteObjects, serializeObjects, type ClipboardResult } from '@/scene/operators/object'
import { getOperator, operatorAvailability, runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams } from '@/scene/operators/types'
import type { MeshData, SceneDocument, SceneObject, Transform, Vec3 } from '@/scene/types'

beforeEach(() => {
  localStorage.clear()
})

/* ------------------------------------------------------------- vocabulary */

/** A document with the startup cube, light and camera taken out, so a test says what is in it. */
function emptyScene(): SceneDocument {
  const document = createSceneDocument()
  return { ...document, objects: [], meshes: {} }
}

type MeshOptions = {
  name: string
  mesh?: MeshData
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  parentId?: string
  materials?: string[]
  collectionId?: string
  meshId?: string
}

/** Ids are spelled from the name so a failing assertion reads as the object a person would name. */
function withMeshObject(document: SceneDocument, options: MeshOptions): SceneDocument {
  const meshId = options.meshId ?? `mesh-${options.name}`
  const object: SceneObject = {
    id: `object-${options.name}`,
    name: options.name,
    kind: 'mesh',
    ...(options.parentId ? { parentId: options.parentId } : {}),
    collectionId: options.collectionId ?? ROOT_COLLECTION_ID,
    transform: {
      position: options.position ?? [0, 0, 0],
      rotation: options.rotation ?? [0, 0, 0],
      scale: options.scale ?? [1, 1, 1],
    },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId },
    modifiers: [],
    materialSlots: options.materials ?? [DEFAULT_MATERIAL.id],
  }
  return {
    ...document,
    objects: [...document.objects, object],
    meshes: { ...document.meshes, [meshId]: options.mesh ?? boxMesh(2) },
  }
}

function withEmpty(document: SceneDocument, name: string, position: Vec3 = [0, 0, 0], parentId?: string): SceneDocument {
  const object: SceneObject = {
    id: `object-${name}`,
    name,
    kind: 'empty',
    ...(parentId ? { parentId } : {}),
    collectionId: ROOT_COLLECTION_ID,
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'empty', display: 'plain-axes', size: 1 },
    modifiers: [],
    materialSlots: [],
  }
  return { ...document, objects: [...document.objects, object] }
}

function contextFor(document: SceneDocument, ids: string[], activeId?: string | null): OperatorContext {
  const active = activeId === undefined ? ids.at(-1) ?? null : activeId
  return {
    document,
    selection: { objectIds: ids, activeObjectId: active },
    mode: 'object',
    view: document.view,
    cursor: document.cursor,
    active: active ? objectById(document, active) : null,
  }
}

function object(document: SceneDocument, name: string): SceneObject {
  const found = objectById(document, `object-${name}`)
  if (!found) throw new Error(`No object called ${name} in this document.`)
  return found
}

function mesh(document: SceneDocument, name: string): MeshData {
  const found = meshOf(document, object(document, name))
  if (!found) throw new Error(`No mesh under ${name} in this document.`)
  return found
}

/** Every vertex of an object, in world space: the only frame two objects can be compared in. */
function worldVertices(document: SceneDocument, name: string): Vec3[] {
  const data = mesh(document, name)
  const matrix = worldMatrix(document, object(document, name))
  return data.vertexIds.map((_, slot) => {
    const point = new Vector3(...vertexPosition(data, slot)).applyMatrix4(matrix)
    return [point.x, point.y, point.z] as Vec3
  })
}

function worldOrigin(document: SceneDocument, name: string): Vec3 {
  const point = new Vector3().setFromMatrixPosition(worldMatrix(document, object(document, name)))
  return [point.x, point.y, point.z]
}

function expectVec3(actual: Vec3, expected: Vec3): void {
  for (let axis = 0; axis < 3; axis += 1) expect(actual[axis]).toBeCloseTo(expected[axis]!, 6)
}

function run(id: string, context: OperatorContext, params: Partial<OperatorParams> = {}) {
  return runOperator(id, context, params)
}

/** The document an operator produced, or a readable failure rather than a null dereference. */
function documentFrom(result: { document?: SceneDocument; error?: string }): SceneDocument {
  if (!result.document) throw new Error(`The operator refused: ${result.error ?? 'with no reason at all'}`)
  return result.document
}

/* -------------------------------------------------------------- the family */

describe('the object family', () => {
  it('registers every id the keymap already promises', () => {
    const promised = KEYMAP
      .flatMap((binding) => (binding.action.kind === 'operator' ? [binding.action.id] : []))
      .filter((id) => id.startsWith('object.'))

    expect(promised.length).toBeGreaterThan(0)
    for (const id of promised) expect(getOperator(id), id).toBeDefined()
  })

  it('carries the shortcuts the keymap writes for it', () => {
    expect(getOperator('object.duplicate')?.shortcut).toBe('⇧D')
    expect(getOperator('object.duplicateLinked')?.shortcut).toBe('⌥D')
    expect(getOperator('object.join')?.shortcut).toBe('⌃J')
    expect(getOperator('object.clearScale')?.shortcut).toBe('⌥S')
  })

  it('refuses an empty selection with a sentence rather than a false', () => {
    const context = contextFor(withMeshObject(emptyScene(), { name: 'Cube' }), [])
    const acting = [
      'object.duplicate', 'object.duplicateLinked', 'object.delete', 'object.join', 'object.parent',
      'object.clearParent', 'object.moveToCollection', 'object.linkToCollection', 'object.hide',
      'object.hideUnselected', 'object.rename', 'object.copy', 'object.clearLocation',
      'object.clearRotation', 'object.clearScale', 'object.applyTransform', 'object.setOrigin',
      'object.shadeSmooth', 'object.shadeFlat', 'object.makeSingleUser',
      'object.align', 'object.randomizeTransform',
    ]

    for (const id of acting) {
      expect(operatorAvailability(id, context), id).toBe('Select an object first.')
      expect(run(id, context).error, id).toBe('Select an object first.')
      expect(run(id, context).document, id).toBeUndefined()
    }
  })

  it('lets the operators that only move the cursor run with nothing selected', () => {
    const context = contextFor(withMeshObject(emptyScene(), { name: 'Cube' }), [])

    expect(operatorAvailability('cursor.toWorldOrigin', context)).toBe(true)
    expect(operatorAvailability('cursor.toGrid', context)).toBe(true)
  })
})

/* ------------------------------------------------------------- duplicating */

describe('duplicating an object', () => {
  it('copies the mesh as well, names the copy .001, and hands back the copy selected', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube', position: [1, 2, 3] })
    const result = run('object.duplicate', contextFor(document, ['object-Cube']))
    const next = documentFrom(result)

    expect(next.objects).toHaveLength(2)
    expect(Object.keys(next.meshes)).toHaveLength(2)
    const copy = next.objects[1]!
    expect(copy.name).toBe('Cube.001')
    expect(copy.id).not.toBe('object-Cube')
    expect(copy.data.kind === 'mesh' && copy.data.meshId).not.toBe('mesh-Cube')
    expect(result.selection).toEqual({ objectIds: [copy.id], activeObjectId: copy.id })
  })

  it('gives the copy geometry of its own, equal but not shared', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    const next = documentFrom(run('object.duplicate', contextFor(document, ['object-Cube'])))
    const copy = next.objects[1]!
    const copied = meshOf(next, copy)!

    expect(copied.vertices).toEqual(mesh(next, 'Cube').vertices)
    expect(copied).not.toBe(mesh(next, 'Cube'))
  })

  it('keeps a parent that is not being duplicated', () => {
    let document = withEmpty(emptyScene(), 'Rig', [0, 0, 2])
    document = withMeshObject(document, { name: 'Cube', parentId: 'object-Rig' })
    const next = documentFrom(run('object.duplicate', contextFor(document, ['object-Cube'])))

    expect(next.objects[2]!.parentId).toBe('object-Rig')
  })

  it('points a duplicated child at the duplicated parent, not at the original', () => {
    let document = withEmpty(emptyScene(), 'Rig', [0, 0, 2])
    document = withMeshObject(document, { name: 'Cube', parentId: 'object-Rig' })
    const next = documentFrom(run('object.duplicate', contextFor(document, ['object-Rig', 'object-Cube'])))
    const rigCopy = next.objects[2]!
    const cubeCopy = next.objects[3]!

    expect(cubeCopy.parentId).toBe(rigCopy.id)
  })

  it('does not make a second scene camera out of a copied one', () => {
    const source = createSceneDocument()
    const camera = source.objects.find((entry) => entry.kind === 'camera')!
    const next = documentFrom(run('object.duplicate', contextFor(source, [camera.id])))
    const copy = next.objects.at(-1)!

    expect(copy.data.kind === 'camera' && copy.data.active).toBeUndefined()
  })
})

describe('duplicating linked', () => {
  it('points the copy at the very same mesh, so editing one edits both', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    const next = documentFrom(run('object.duplicateLinked', contextFor(document, ['object-Cube'])))
    const copy = next.objects[1]!

    expect(Object.keys(next.meshes)).toHaveLength(1)
    expect(copy.data.kind === 'mesh' && copy.data.meshId).toBe('mesh-Cube')
    expect(meshOf(next, copy)).toBe(mesh(next, 'Cube'))
  })

  it('un-shares it again on make single user, keeping the geometry it had', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    const linked = documentFrom(run('object.duplicateLinked', contextFor(document, ['object-Cube'])))
    const copy = linked.objects[1]!
    const single = documentFrom(run('object.makeSingleUser', contextFor(linked, [copy.id])))
    const own = single.objects[1]!

    expect(Object.keys(single.meshes)).toHaveLength(2)
    expect(own.data.kind === 'mesh' && own.data.meshId).not.toBe('mesh-Cube')
    expect(meshOf(single, own)!.vertices).toEqual(mesh(single, 'Cube').vertices)
    expect(meshOf(single, own)).not.toBe(mesh(single, 'Cube'))
  })

  it('shows the un-sharing by shading one of the pair and not the other', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    const linked = documentFrom(run('object.duplicateLinked', contextFor(document, ['object-Cube'])))
    const copy = linked.objects[1]!

    const bothSmooth = documentFrom(run('object.shadeSmooth', contextFor(linked, [copy.id])))
    expect(mesh(bothSmooth, 'Cube').attributes.face.smooth.every(Boolean)).toBe(true)

    const single = documentFrom(run('object.makeSingleUser', contextFor(linked, [copy.id])))
    const onlyOne = documentFrom(run('object.shadeSmooth', contextFor(single, [single.objects[1]!.id])))
    expect(meshOf(onlyOne, onlyOne.objects[1]!)!.attributes.face.smooth.every(Boolean)).toBe(true)
    expect(mesh(onlyOne, 'Cube').attributes.face.smooth.some(Boolean)).toBe(false)
  })

  it('says so when nothing selected is shared', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })

    expect(operatorAvailability('object.makeSingleUser', contextFor(document, ['object-Cube'])))
      .toBe('Every selected object already has data of its own.')
  })
})

/* -------------------------------------------------------------------- join */

describe('joining meshes', () => {
  function twoCubes(): SceneDocument {
    let document = withMeshObject(emptyScene(), { name: 'Left', position: [-3, 0, 0], materials: ['material-default'] })
    document = withMeshObject(document, { name: 'Right', position: [3, 0, 0], scale: [2, 2, 2], materials: ['material-red'] })
    return { ...document, materials: [...document.materials, { ...DEFAULT_MATERIAL, id: 'material-red', name: 'Red' }] }
  }

  it('brings the topology across and renumbers so nothing collides', () => {
    const document = twoCubes()
    const next = documentFrom(run('object.join', contextFor(document, ['object-Right', 'object-Left'], 'object-Left')))
    const merged = mesh(next, 'Left')

    expect(next.objects).toHaveLength(1)
    expect(merged.vertexIds).toHaveLength(16)
    expect(merged.edges).toHaveLength(24)
    expect(merged.faces).toHaveLength(12)
    expect(new Set(merged.vertexIds).size).toBe(16)
    expect(new Set(merged.faceIds).size).toBe(12)
    expect(merged.nextVertexId).toBeGreaterThanOrEqual(16)
  })

  it('lands a vertex of the joined object exactly where it was in the world', () => {
    const document = twoCubes()
    const before = worldVertices(document, 'Right')
    const next = documentFrom(run('object.join', contextFor(document, ['object-Right', 'object-Left'], 'object-Left')))
    const after = worldVertices(next, 'Left').slice(8)

    expect(after).toHaveLength(8)
    for (let index = 0; index < 8; index += 1) expectVec3(after[index]!, before[index]!)
  })

  it('merges the material slots and remaps every face onto the merged list', () => {
    const document = twoCubes()
    const next = documentFrom(run('object.join', contextFor(document, ['object-Right', 'object-Left'], 'object-Left')))
    const merged = mesh(next, 'Left')

    expect(object(next, 'Left').materialSlots).toEqual(['material-default', 'material-red'])
    expect(merged.attributes.face.material.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0])
    expect(merged.attributes.face.material.slice(6)).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('takes the joined object out of the document and its mesh with it', () => {
    const document = twoCubes()
    const result = run('object.join', contextFor(document, ['object-Right', 'object-Left'], 'object-Left'))
    const next = documentFrom(result)

    expect(objectById(next, 'object-Right')).toBeNull()
    expect(Object.keys(next.meshes)).toEqual(['mesh-Left'])
    expect(result.selection).toEqual({ objectIds: ['object-Left'], activeObjectId: 'object-Left' })
  })

  it('hands a child of the joined object to the active one without moving it', () => {
    let document = twoCubes()
    document = withEmpty(document, 'Hook', [0, 0, 1], 'object-Right')
    const before = worldOrigin(document, 'Hook')
    const next = documentFrom(run('object.join', contextFor(document, ['object-Right', 'object-Left'], 'object-Left')))

    expect(object(next, 'Hook').parentId).toBe('object-Left')
    expectVec3(worldOrigin(next, 'Hook'), before)
  })

  it('refuses to join into something that is not a mesh', () => {
    let document = withMeshObject(emptyScene(), { name: 'Cube' })
    document = withEmpty(document, 'Hook')

    expect(operatorAvailability('object.join', contextFor(document, ['object-Cube', 'object-Hook'], 'object-Hook')))
      .toBe('“Hook” is not a mesh, so nothing can be joined into it.')
  })

  it('refuses a join of one object with itself', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })

    expect(operatorAvailability('object.join', contextFor(document, ['object-Cube'])))
      .toBe('Select at least one other mesh to join in.')
  })
})

/* ------------------------------------------------------------------- apply */

describe('applying a transform', () => {
  it('bakes the scale into the mesh and leaves the object at its true size', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube', scale: [2, 3, 4] })
    const before = worldVertices(document, 'Cube')
    const next = documentFrom(run('object.applyTransform', contextFor(document, ['object-Cube']), { what: 'scale' }))

    expect(object(next, 'Cube').transform.scale).toEqual([1, 1, 1])
    const after = worldVertices(next, 'Cube')
    for (let index = 0; index < before.length; index += 1) expectVec3(after[index]!, before[index]!)
  })

  it('bakes everything and leaves the transform at nothing at all', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube', position: [1, 2, 3], rotation: [0, 0, 90], scale: [2, 2, 2] })
    const before = worldVertices(document, 'Cube')
    const next = documentFrom(run('object.applyTransform', contextFor(document, ['object-Cube']), { what: 'all' }))
    const transform = object(next, 'Cube').transform

    expectVec3(transform.position, [0, 0, 0])
    expectVec3(transform.rotation, [0, 0, 0])
    expectVec3(transform.scale, [1, 1, 1])
    const after = worldVertices(next, 'Cube')
    for (let index = 0; index < before.length; index += 1) expectVec3(after[index]!, before[index]!)
  })

  it('applies the location alone without letting the rotation move the geometry', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube', position: [1, 2, 3], rotation: [0, 0, 90], scale: [2, 1, 1] })
    const before = worldVertices(document, 'Cube')
    const next = documentFrom(run('object.applyTransform', contextFor(document, ['object-Cube']), { what: 'location' }))

    expectVec3(object(next, 'Cube').transform.position, [0, 0, 0])
    expectVec3(object(next, 'Cube').transform.rotation, [0, 0, 90])
    const after = worldVertices(next, 'Cube')
    for (let index = 0; index < before.length; index += 1) expectVec3(after[index]!, before[index]!)
  })

  it('leaves the children of the object it applied exactly where they were', () => {
    let document = withMeshObject(emptyScene(), { name: 'Body', scale: [2, 2, 2] })
    document = withMeshObject(document, { name: 'Head', position: [0, 0, 2], parentId: 'object-Body' })
    const headBefore = worldVertices(document, 'Head')
    const originBefore = worldOrigin(document, 'Head')

    const next = documentFrom(run('object.applyTransform', contextFor(document, ['object-Body']), { what: 'scale' }))

    expect(object(next, 'Body').transform.scale).toEqual([1, 1, 1])
    expectVec3(worldOrigin(next, 'Head'), originBefore)
    const headAfter = worldVertices(next, 'Head')
    for (let index = 0; index < headBefore.length; index += 1) expectVec3(headAfter[index]!, headBefore[index]!)
  })

  it('refuses an object whose mesh belongs to something else as well', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube', scale: [2, 2, 2] })
    const linked = documentFrom(run('object.duplicateLinked', contextFor(document, ['object-Cube'])))

    expect(run('object.applyTransform', contextFor(linked, ['object-Cube']), { what: 'scale' }).error)
      .toBe('“Cube” shares its mesh with another object. Make it single user before applying a transform.')
  })

  it('says there is no geometry when the selection carries none', () => {
    const document = withEmpty(emptyScene(), 'Hook')

    expect(operatorAvailability('object.applyTransform', contextFor(document, ['object-Hook'])))
      .toBe('Select a mesh: there is no geometry here to work on.')
  })
})

/* -------------------------------------------------------------- set origin */

describe('setting the origin', () => {
  /** Two quads of very different areas, so the median and the centre of mass part company. */
  function lopsided(): MeshData {
    return meshFromPolygons(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [5, 0, 0], [5, 1, 0]],
      [[0, 1, 2, 3], [1, 4, 5, 2]],
    )
  }

  it('puts the origin on the median of the geometry and moves not one vertex', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube', mesh: boxMesh(2), position: [4, 0, 0] })
    const shifted = { ...document, meshes: { ...document.meshes, 'mesh-Cube': shiftMesh(boxMesh(2), [2, 0, 0]) } }
    const before = worldVertices(shifted, 'Cube')

    const next = documentFrom(run('object.setOrigin', contextFor(shifted, ['object-Cube']), { to: 'origin-to-geometry' }))

    expectVec3(object(next, 'Cube').transform.position, [6, 0, 0])
    const after = worldVertices(next, 'Cube')
    for (let index = 0; index < before.length; index += 1) expectVec3(after[index]!, before[index]!)
  })

  it('puts the origin on the 3D cursor and moves not one vertex', () => {
    const scene = withMeshObject(emptyScene(), { name: 'Cube', position: [1, 1, 1], rotation: [0, 0, 45], scale: [2, 1, 1] })
    const document = { ...scene, cursor: { position: [3, -2, 5] as Vec3, rotation: [0, 0, 0] as Vec3 } }
    const before = worldVertices(document, 'Cube')

    const next = documentFrom(run('object.setOrigin', contextFor(document, ['object-Cube']), { to: 'cursor' }))

    expectVec3(worldOrigin(next, 'Cube'), [3, -2, 5])
    const after = worldVertices(next, 'Cube')
    for (let index = 0; index < before.length; index += 1) expectVec3(after[index]!, before[index]!)
  })

  it('weights the centre of mass by area, which is not where the median falls', () => {
    const document = withMeshObject(emptyScene(), { name: 'Slab', mesh: lopsided() })
    const median = documentFrom(run('object.setOrigin', contextFor(document, ['object-Slab']), { to: 'origin-to-geometry' }))
    const mass = documentFrom(run('object.setOrigin', contextFor(document, ['object-Slab']), { to: 'centre-of-mass' }))

    expectVec3(object(median, 'Slab').transform.position, [2, 0.5, 0])
    expectVec3(object(mass, 'Slab').transform.position, [2.5, 0.5, 0])
  })

  it('leaves the children of the object where they were when its origin moves', () => {
    let document = withMeshObject(emptyScene(), { name: 'Body', position: [0, 0, 0] })
    document = { ...document, meshes: { ...document.meshes, 'mesh-Body': shiftMesh(boxMesh(2), [4, 0, 0]) } }
    document = withEmpty(document, 'Hook', [0, 0, 3], 'object-Body')
    const before = worldOrigin(document, 'Hook')

    const next = documentFrom(run('object.setOrigin', contextFor(document, ['object-Body']), { to: 'origin-to-geometry' }))

    expectVec3(object(next, 'Body').transform.position, [4, 0, 0])
    expectVec3(worldOrigin(next, 'Hook'), before)
  })

  it('sends the geometry to the origin the other way round, moving the mesh and not the object', () => {
    let document = withMeshObject(emptyScene(), { name: 'Cube', position: [2, 0, 0] })
    document = { ...document, meshes: { ...document.meshes, 'mesh-Cube': shiftMesh(boxMesh(2), [5, 0, 0]) } }

    const next = documentFrom(run('object.setOrigin', contextFor(document, ['object-Cube']), { to: 'geometry' }))

    expectVec3(object(next, 'Cube').transform.position, [2, 0, 0])
    expectVec3(vertexPosition(mesh(next, 'Cube'), 0), vertexPosition(boxMesh(2), 0))
  })

  it('refuses to move the origin of a mesh two objects are sharing', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    const linked = documentFrom(run('object.duplicateLinked', contextFor(document, ['object-Cube'])))

    expect(run('object.setOrigin', contextFor(linked, ['object-Cube'])).error)
      .toBe('“Cube” shares its mesh with another object. Make it single user before moving its origin.')
  })
})

function shiftMesh(source: MeshData, offset: Vec3): MeshData {
  const next: MeshData = { ...source, vertices: source.vertices.slice() }
  for (let slot = 0; slot < next.vertexIds.length; slot += 1) {
    next.vertices[slot * 3] = (next.vertices[slot * 3] ?? 0) + offset[0]
    next.vertices[slot * 3 + 1] = (next.vertices[slot * 3 + 1] ?? 0) + offset[1]
    next.vertices[slot * 3 + 2] = (next.vertices[slot * 3 + 2] ?? 0) + offset[2]
  }
  return next
}

/* --------------------------------------------------------------- parenting */

describe('parenting', () => {
  function pair(): SceneDocument {
    let document = withEmpty(emptyScene(), 'Rig', [0, 0, 5])
    document = withMeshObject(document, { name: 'Cube', position: [2, 0, 0], rotation: [0, 30, 0], scale: [2, 2, 2] })
    return { ...document, objects: document.objects.map((entry) => (entry.id === 'object-Rig' ? { ...entry, transform: { ...entry.transform, rotation: [0, 0, 90] as Vec3, scale: [3, 3, 3] as Vec3 } } : entry)) }
  }

  it('sets the parent and leaves the world matrix exactly as it was', () => {
    const document = pair()
    const before = worldMatrix(document, object(document, 'Cube')).elements.slice()

    const next = documentFrom(run('object.parent', contextFor(document, ['object-Cube', 'object-Rig'], 'object-Rig')))

    expect(object(next, 'Cube').parentId).toBe('object-Rig')
    const after = worldMatrix(next, object(next, 'Cube')).elements
    for (let index = 0; index < 16; index += 1) expect(after[index]).toBeCloseTo(before[index]!, 6)
  })

  it('clears the parent again and still leaves the world matrix as it was', () => {
    const document = pair()
    const parented = documentFrom(run('object.parent', contextFor(document, ['object-Cube', 'object-Rig'], 'object-Rig')))
    const before = worldMatrix(parented, object(parented, 'Cube')).elements.slice()

    const next = documentFrom(run('object.clearParent', contextFor(parented, ['object-Cube'])))

    expect(object(next, 'Cube').parentId).toBeUndefined()
    const after = worldMatrix(next, object(next, 'Cube')).elements
    for (let index = 0; index < 16; index += 1) expect(after[index]).toBeCloseTo(before[index]!, 6)
  })

  it('lets the child jump when the transform is deliberately not kept', () => {
    const document = pair()
    const next = documentFrom(run('object.parent', contextFor(document, ['object-Cube', 'object-Rig'], 'object-Rig'), { keepTransform: false }))

    expect(object(next, 'Cube').transform.position).toEqual([2, 0, 0])
    expectVec3(worldOrigin(next, 'Cube'), [0, 6, 5])
  })

  it('refuses a parenting that would make a loop, and says which way round it is', () => {
    let document = withEmpty(emptyScene(), 'Rig')
    document = withEmpty(document, 'Arm', [0, 0, 1], 'object-Rig')

    const result = run('object.parent', contextFor(document, ['object-Rig', 'object-Arm'], 'object-Arm'))

    expect(result.error).toBe('“Arm” is already under “Rig”, so parenting them would make a loop.')
    expect(result.document).toBeUndefined()
  })

  it('says so when nothing selected has a parent to clear', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })

    expect(operatorAvailability('object.clearParent', contextFor(document, ['object-Cube'])))
      .toBe('Nothing selected has a parent.')
  })
})

/* ----------------------------------------------------------------- delete */

describe('deleting', () => {
  function family(): SceneDocument {
    let document = withEmpty(emptyScene(), 'Rig', [0, 0, 4])
    document = withMeshObject(document, { name: 'Cube', position: [1, 0, 0], parentId: 'object-Rig' })
    document = withMeshObject(document, { name: 'Bolt', position: [0, 2, 0], parentId: 'object-Cube' })
    return document
  }

  it('re-parents the children of what it deleted, keeping them where they were', () => {
    const document = family()
    const before = worldOrigin(document, 'Bolt')

    const result = run('object.delete', contextFor(document, ['object-Cube']))
    const next = documentFrom(result)

    expect(objectById(next, 'object-Cube')).toBeNull()
    expect(object(next, 'Bolt').parentId).toBe('object-Rig')
    expectVec3(worldOrigin(next, 'Bolt'), before)
    expect(result.selection).toEqual({ objectIds: [], activeObjectId: null })
  })

  it('takes the children with it when the hierarchy switch is on', () => {
    const next = documentFrom(run('object.delete', contextFor(family(), ['object-Cube']), { hierarchy: true }))

    expect(next.objects.map((entry) => entry.name)).toEqual(['Rig'])
    expect(Object.keys(next.meshes)).toEqual([])
  })

  it('leaves a linked twin its mesh', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    const linked = documentFrom(run('object.duplicateLinked', contextFor(document, ['object-Cube'])))
    const next = documentFrom(run('object.delete', contextFor(linked, ['object-Cube'])))

    expect(next.objects).toHaveLength(1)
    expect(Object.keys(next.meshes)).toEqual(['mesh-Cube'])
  })
})

/* ------------------------------------------------------------- collections */

describe('collections', () => {
  function twoCollections(): SceneDocument {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    return { ...document, collections: [...document.collections, { id: 'collection-props', name: 'Props', parentId: ROOT_COLLECTION_ID }] }
  }

  it('moves the selection into the collection it is given', () => {
    const next = documentFrom(run('object.moveToCollection', contextFor(twoCollections(), ['object-Cube']), { collectionId: 'collection-props' }))

    expect(object(next, 'Cube').collectionId).toBe('collection-props')
  })

  it('refuses a collection this scene does not have', () => {
    expect(run('object.moveToCollection', contextFor(twoCollections(), ['object-Cube']), { collectionId: 'collection-nowhere' }).error)
      .toBe('That collection is not in this scene.')
  })

  it('says so rather than writing a step that changes nothing', () => {
    expect(run('object.moveToCollection', contextFor(twoCollections(), ['object-Cube']), { collectionId: ROOT_COLLECTION_ID }).error)
      .toBe('Everything selected is already in “Scene Collection”.')
  })

  it('links a copy into the other collection, sharing the mesh with the original', () => {
    const result = run('object.linkToCollection', contextFor(twoCollections(), ['object-Cube']), { collectionId: 'collection-props' })
    const next = documentFrom(result)
    const linked = next.objects[1]!

    expect(next.objects).toHaveLength(2)
    expect(Object.keys(next.meshes)).toHaveLength(1)
    expect(linked.collectionId).toBe('collection-props')
    expect(linked.data.kind === 'mesh' && linked.data.meshId).toBe('mesh-Cube')
    expect(result.label).toBe('Link to “Props”')
  })
})

/* -------------------------------------------------------------- visibility */

describe('hiding and revealing', () => {
  function three(): SceneDocument {
    let document = withMeshObject(emptyScene(), { name: 'One' })
    document = withMeshObject(document, { name: 'Two' })
    return withMeshObject(document, { name: 'Three' })
  }

  it('hides the selection and lets go of it, so nothing invisible stays selected', () => {
    const result = run('object.hide', contextFor(three(), ['object-One', 'object-Two']))
    const next = documentFrom(result)

    expect(next.objects.map((entry) => entry.visible)).toEqual([false, false, true])
    expect(result.selection).toEqual({ objectIds: [], activeObjectId: null })
  })

  it('hides everything but the selection', () => {
    const next = documentFrom(run('object.hideUnselected', contextFor(three(), ['object-Two'])))

    expect(next.objects.map((entry) => entry.visible)).toEqual([false, true, false])
  })

  it('brings the hidden back and selects them, with nothing selected to start from', () => {
    const hidden = documentFrom(run('object.hide', contextFor(three(), ['object-One'])))
    const result = run('object.revealHidden', contextFor(hidden, []))
    const next = documentFrom(result)

    expect(next.objects.every((entry) => entry.visible)).toBe(true)
    expect(result.selection).toEqual({ objectIds: ['object-One'], activeObjectId: 'object-One' })
  })

  it('says there is nothing hidden when there is not', () => {
    expect(operatorAvailability('object.revealHidden', contextFor(three(), []))).toBe('Nothing is hidden.')
  })
})

/* ----------------------------------------------------------------- naming */

describe('renaming', () => {
  it('renames the active object', () => {
    const next = documentFrom(run('object.rename', contextFor(withMeshObject(emptyScene(), { name: 'Cube' }), ['object-Cube']), { name: 'Chassis' }))

    expect(object(next, 'Cube').name).toBe('Chassis')
  })

  it('will not take a blank name', () => {
    expect(run('object.rename', contextFor(withMeshObject(emptyScene(), { name: 'Cube' }), ['object-Cube']), { name: '   ' }).error)
      .toBe('Type a name for the object.')
  })

  it('keeps the name unique when another object already has it', () => {
    let document = withMeshObject(emptyScene(), { name: 'Cube' })
    document = withMeshObject(document, { name: 'Sphere' })

    const next = documentFrom(run('object.rename', contextFor(document, ['object-Sphere']), { name: 'Cube' }))

    expect(object(next, 'Sphere').name).toBe('Cube.001')
  })
})

/* -------------------------------------------------------------- clipboard */

describe('the clipboard', () => {
  it('serialises the objects with the meshes they need', () => {
    let document = withMeshObject(emptyScene(), { name: 'Cube' })
    document = withMeshObject(document, { name: 'Sphere', mesh: planeMesh(2) })
    const payload = JSON.parse(serializeObjects(document, ['object-Cube'])) as Record<string, unknown>

    expect(payload.kind).toBe('paramrig.scene.objects')
    expect((payload.objects as unknown[])).toHaveLength(1)
    expect(Object.keys(payload.meshes as object)).toEqual(['mesh-Cube'])
  })

  it('pastes with fresh ids and a name that does not collide', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube', position: [1, 1, 1] })
    const payload = serializeObjects(document, ['object-Cube'])
    const result = pasteObjects(document, payload, [0, 0, 0])
    const next = documentFrom(result)
    const pasted = next.objects[1]!

    expect(next.objects).toHaveLength(2)
    expect(pasted.id).not.toBe('object-Cube')
    expect(pasted.name).toBe('Cube.001')
    expect(pasted.data.kind === 'mesh' && pasted.data.meshId).not.toBe('mesh-Cube')
    expect(result.selection).toEqual({ objectIds: [pasted.id], activeObjectId: pasted.id })
  })

  it('lands the paste on the 3D cursor', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube', position: [1, 1, 1] })
    const next = documentFrom(pasteObjects(document, serializeObjects(document, ['object-Cube']), [4, 0, -2]))

    expectVec3(next.objects[1]!.transform.position, [4, 0, -2])
  })

  it('keeps a linked pair linked across a copy and a paste', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    const linked = documentFrom(run('object.duplicateLinked', contextFor(document, ['object-Cube'])))
    const ids = linked.objects.map((entry) => entry.id)

    const next = documentFrom(pasteObjects(linked, serializeObjects(linked, ids), [0, 0, 0]))
    const pasted = next.objects.slice(2)

    expect(pasted).toHaveLength(2)
    expect(Object.keys(next.meshes)).toHaveLength(2)
    expect(pasted[0]!.data.kind === 'mesh' && pasted[0]!.data.meshId)
      .toBe(pasted[1]!.data.kind === 'mesh' ? pasted[1]!.data.meshId : null)
  })

  it('goes round the two operators, from ⌃C to ⌃V', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    const copied = run('object.copy', contextFor(document, ['object-Cube'])) as ClipboardResult
    expect(typeof copied.clipboard).toBe('string')

    const next = documentFrom(run('object.paste', contextFor(document, []), { payload: copied.clipboard ?? '' }))
    expect(next.objects).toHaveLength(2)
  })

  it('carries the controls that were driving what was copied', () => {
    const base = withMeshObject(emptyScene(), { name: 'Cube' })
    const rigged: SceneDocument = {
      ...base,
      objects: base.objects.map((object) => ({
        ...object,
        modifiers: [{
          id: 'modifier-1',
          kind: 'subsurf' as const,
          name: 'Subdivision',
          enabled: { viewport: true, render: true, editMode: true, onCage: false },
          params: { levels: 1 },
        }],
      })),
      rig: {
        groups: [{ id: 'main', label: 'Main' }],
        parameters: [{ kind: 'number', id: 'detail', label: 'Detail', group: 'main', min: 0, max: 6, step: 1, defaultValue: 1 }],
        bindings: [{ id: 'binding-1', objectId: 'object-Cube', property: 'modifiers[modifier-1].levels', parameterId: 'detail' }],
      },
    }

    const payload = serializeObjects(rigged, ['object-Cube'])
    const next = documentFrom(pasteObjects(rigged, payload, [0, 0, 0]))

    // The copy has a modifier of its own, with an id of its own, and the binding follows it there.
    const copy = next.objects.find((object) => object.name === 'Cube.001')!
    expect(next.rig?.bindings).toHaveLength(2)
    const added = next.rig!.bindings[1]!
    expect(added.objectId).toBe(copy.id)
    expect(added.property).toBe(`modifiers[${copy.modifiers[0]!.id}].levels`)
    expect(added.parameterId).toBe('detail')
  })

  it('leaves a binding behind when the control is not in the document it lands in', () => {
    const base = withMeshObject(emptyScene(), { name: 'Cube' })
    const rigged: SceneDocument = {
      ...base,
      rig: {
        groups: [{ id: 'main', label: 'Main' }],
        parameters: [{ kind: 'number', id: 'slide', label: 'Slide', group: 'main', min: 0, max: 1, step: 0.1, defaultValue: 0 }],
        bindings: [{ id: 'binding-1', objectId: 'object-Cube', property: 'transform.position.x', parameterId: 'slide' }],
      },
    }
    const payload = serializeObjects(rigged, ['object-Cube'])

    // Into a document with no rig at all: the geometry arrives, the binding does not.
    const plain = documentFrom(pasteObjects(emptyScene(), payload, [0, 0, 0]))
    expect(plain.objects).toHaveLength(1)
    expect(plain.rig).toBeUndefined()
  })

  it('refuses a clipboard that is not one of ours', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })

    expect(pasteObjects(document, 'not json at all', [0, 0, 0]).error).toBe('That is not something the scene editor can paste.')
    expect(pasteObjects(document, '{"kind":"something.else"}', [0, 0, 0]).error).toBe('That is not something the scene editor can paste.')
    expect(run('object.paste', contextFor(document, [])).error).toBe('There is nothing on the clipboard.')
  })
})

/* ------------------------------------------------------ clearing transforms */

describe('clearing a transform', () => {
  const moved: Transform = { position: [1, 2, 3], rotation: [10, 20, 30], scale: [2, 2, 2] }

  function movedCube(): SceneDocument {
    return withMeshObject(emptyScene(), { name: 'Cube', position: moved.position, rotation: moved.rotation, scale: moved.scale })
  }

  it('sends the location back to nothing and leaves the rest alone', () => {
    const next = documentFrom(run('object.clearLocation', contextFor(movedCube(), ['object-Cube'])))

    expect(object(next, 'Cube').transform.position).toEqual([0, 0, 0])
    expect(object(next, 'Cube').transform.rotation).toEqual([10, 20, 30])
    expect(object(next, 'Cube').transform.scale).toEqual([2, 2, 2])
  })

  it('sends the rotation back to nothing', () => {
    const next = documentFrom(run('object.clearRotation', contextFor(movedCube(), ['object-Cube'])))

    expect(object(next, 'Cube').transform.rotation).toEqual([0, 0, 0])
    expect(object(next, 'Cube').transform.position).toEqual([1, 2, 3])
  })

  it('sends the scale back to one', () => {
    const next = documentFrom(run('object.clearScale', contextFor(movedCube(), ['object-Cube'])))

    expect(object(next, 'Cube').transform.scale).toEqual([1, 1, 1])
  })
})

/* ---------------------------------------------------------------- shading */

describe('shading', () => {
  it('smooths every face, and can keep the sharp edges', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })

    const plain = documentFrom(run('object.shadeSmooth', contextFor(document, ['object-Cube'])))
    expect(mesh(plain, 'Cube').attributes.face.smooth).toEqual(new Array(6).fill(true))
    expect(mesh(plain, 'Cube').autoSmooth).toBeUndefined()

    const auto = documentFrom(run('object.shadeSmooth', contextFor(document, ['object-Cube']), { autoSmooth: true, angle: 40 }))
    expect(mesh(auto, 'Cube').autoSmooth).toEqual({ enabled: true, angle: 40 })
  })

  it('flattens every face again', () => {
    const document = withMeshObject(emptyScene(), { name: 'Cube' })
    const smooth = documentFrom(run('object.shadeSmooth', contextFor(document, ['object-Cube'])))
    const flat = documentFrom(run('object.shadeFlat', contextFor(smooth, ['object-Cube'])))

    expect(mesh(flat, 'Cube').attributes.face.smooth).toEqual(new Array(6).fill(false))
  })
})

/* ---------------------------------------------------------------- snapping */

/*
 * Snapping the selection to the cursor and back is `cursor.*`, tested in
 * `src/scene/operators/cursor.test.ts`. It was registered here as well for a while; one family
 * was dropped rather than have the palette offer each of those actions twice.
 */

describe('aligning and scattering', () => {
  function row(): SceneDocument {
    let document = withMeshObject(emptyScene(), { name: 'One', position: [-6, 0, 0] })
    document = withMeshObject(document, { name: 'Two', position: [0, 0, 0] })
    return withMeshObject(document, { name: 'Three', position: [6, 0, 0] })
  }

  it('lines the selection up on one axis', () => {
    const ids = ['object-One', 'object-Two', 'object-Three']
    const next = documentFrom(run('object.align', contextFor(row(), ids), { axis: 'x', mode: 'centre', relativeTo: 'selection' }))

    for (const name of ['One', 'Two', 'Three']) expect(worldOrigin(next, name)[0]).toBeCloseTo(0, 6)
  })

  it('lines them up against the world origin instead when asked', () => {
    const ids = ['object-One', 'object-Two', 'object-Three']
    const next = documentFrom(run('object.align', contextFor(row(), ids), { axis: 'x', mode: 'min', relativeTo: 'world' }))

    for (const name of ['One', 'Two', 'Three']) expect(worldOrigin(next, name)[0]).toBeCloseTo(1, 6)
  })

  it('wants at least two objects before it lines anything up', () => {
    expect(operatorAvailability('object.align', contextFor(row(), ['object-One'])))
      .toBe('Select at least two objects to line up.')
  })

  it('scatters the same way every time for one seed, and differently for another', () => {
    const document = row()
    const ids = ['object-One', 'object-Two', 'object-Three']
    const first = documentFrom(run('object.randomizeTransform', contextFor(document, ids), { seed: 7, location: 2 }))
    const again = documentFrom(run('object.randomizeTransform', contextFor(document, ids), { seed: 7, location: 2 }))
    const other = documentFrom(run('object.randomizeTransform', contextFor(document, ids), { seed: 8, location: 2 }))

    expect(first.objects.map((entry) => entry.transform.position)).toEqual(again.objects.map((entry) => entry.transform.position))
    expect(first.objects.map((entry) => entry.transform.position)).not.toEqual(other.objects.map((entry) => entry.transform.position))
    expect(Math.abs(object(first, 'One').transform.position[0] + 6)).toBeLessThanOrEqual(2)
  })

  it('moves nothing at all when every amount is zero', () => {
    const document = row()
    const ids = ['object-One', 'object-Two', 'object-Three']
    const next = documentFrom(run('object.randomizeTransform', contextFor(document, ids), { seed: 3, location: 0, rotation: 0, scale: 0 }))

    expect(next.objects.map((entry) => entry.transform)).toEqual(document.objects.map((entry) => entry.transform))
  })
})
