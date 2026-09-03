import { describe, expect, it } from 'vitest'
import { createSceneDocument, DEFAULT_MATERIAL, meshOf, objectById, ROOT_COLLECTION_ID, sanitizeSceneDocument } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import '@/scene/operators/material'
import { operatorAvailability, runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams } from '@/scene/operators/types'
import type { Material, MeshData, SceneDocument, SceneObject } from '@/scene/types'

/**
 * Slots, materials, and the faces that point into them.
 *
 * What is worth asserting is the bookkeeping rather than the colour: a slot removed has to take its
 * faces somewhere sensible, a slot moved has to take them with it, and a material deleted must not
 * leave a slot pointing at nothing. Those are the things that go wrong silently.
 */

function meshObject(id: string, slots: string[]): SceneObject {
  return {
    id,
    name: id,
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: 'mesh-1' },
    modifiers: [],
    materialSlots: slots,
  }
}

function material(id: string, name: string, baseColor = '#ff0000'): Material {
  return { ...DEFAULT_MATERIAL, id, name, baseColor }
}

/** A cube whose six faces are spread over the slots given, so a move is visible in the attribute. */
function cubeWith(slotOfFace: number[]): MeshData {
  const mesh = boxMesh(2)
  for (let face = 0; face < mesh.faceIds.length; face += 1) mesh.attributes.face.material[face] = slotOfFace[face] ?? 0
  return mesh
}

function scene(options: { slots?: string[]; materials?: Material[]; faces?: number[] } = {}): SceneDocument {
  const materials = options.materials ?? [material('material-a', 'Red'), material('material-b', 'Blue', '#0000ff')]
  return {
    ...createSceneDocument(),
    objects: [meshObject('cube', options.slots ?? ['material-a', 'material-b'])],
    meshes: { 'mesh-1': cubeWith(options.faces ?? [0, 0, 1, 1, 0, 1]) },
    materials,
  }
}

function contextFor(document: SceneDocument, extra: Partial<OperatorContext> = {}): OperatorContext {
  return {
    document,
    selection: { objectIds: ['cube'], activeObjectId: 'cube' },
    mode: 'object',
    view: document.view,
    cursor: document.cursor,
    active: objectById(document, 'cube'),
    ...extra,
  }
}

function run(document: SceneDocument, id: string, params: OperatorParams = {}, extra: Partial<OperatorContext> = {}) {
  return runOperator(id, contextFor(document, extra), params)
}

function slotsOf(document: SceneDocument): number[] {
  return [...meshOf(document, objectById(document, 'cube')!)!.attributes.face.material]
}

describe('material slots', () => {
  it('adds a slot pointing at a material that exists', () => {
    const next = run(scene(), 'material.addSlot').document!
    expect(objectById(next, 'cube')!.materialSlots).toEqual(['material-a', 'material-b', 'material-a'])
  })

  it('keeps at least one, and says so', () => {
    const one = scene({ slots: ['material-a'], faces: [0, 0, 0, 0, 0, 0] })
    expect(operatorAvailability('material.removeSlot', contextFor(one))).toBe('An object keeps at least one slot.')
  })

  it('sends the faces of a removed slot to the first, and shifts the ones above it down', () => {
    const document = scene({ slots: ['material-a', 'material-b', 'material-a'], faces: [0, 1, 2, 2, 1, 0] })
    const next = run(document, 'material.removeSlot', {}, {
      selection: { objectIds: ['cube'], activeObjectId: 'cube', activeMaterialSlot: 1 },
    }).document!
    expect(objectById(next, 'cube')!.materialSlots).toEqual(['material-a', 'material-a'])
    // Slot 1 is gone: its faces fall to 0, and what was 2 becomes 1.
    expect(slotsOf(next)).toEqual([0, 0, 1, 1, 0, 0])
  })

  it('moves a slot and takes its faces with it', () => {
    const document = scene({ faces: [0, 0, 1, 1, 0, 1] })
    const result = run(document, 'material.moveSlot', { step: 1 }, {
      selection: { objectIds: ['cube'], activeObjectId: 'cube', activeMaterialSlot: 0 },
    })
    expect(objectById(result.document!, 'cube')!.materialSlots).toEqual(['material-b', 'material-a'])
    expect(slotsOf(result.document!)).toEqual([1, 1, 0, 0, 1, 0])
    // The panel follows the slot it was on rather than staying on the row number.
    expect(result.selection?.activeMaterialSlot).toBe(1)
  })
})

describe('materials themselves', () => {
  it('puts a new one in the active slot, named so that two are told apart', () => {
    const first = run(scene({ materials: [material('material-a', 'Material')] , slots: ['material-a'], faces: [0, 0, 0, 0, 0, 0] }), 'material.new').document!
    expect(first.materials.map((entry) => entry.name)).toEqual(['Material', 'Material.001'])
    expect(objectById(first, 'cube')!.materialSlots[0]).toBe(first.materials[1]!.id)
  })

  it('duplicates the one in the slot rather than starting from the default', () => {
    const document = scene()
    const next = run(document, 'material.new', { copyActive: true }).document!
    const made = next.materials[next.materials.length - 1]!
    expect(made.baseColor).toBe('#ff0000')
    expect(made.name).toBe('Red.001')
  })

  it('takes a deleted material off every slot that named it', () => {
    const document = scene()
    const next = run(document, 'material.delete', { materialId: 'material-a' }).document!
    expect(next.materials.map((entry) => entry.id)).toEqual(['material-b'])
    expect(objectById(next, 'cube')!.materialSlots).toEqual(['material-b', 'material-b'])
  })

  it('keeps the last material in the document', () => {
    const one = scene({ materials: [material('material-a', 'Red')], slots: ['material-a'] })
    expect(operatorAvailability('material.delete', contextFor(one))).toBe('A document keeps at least one material.')
  })
})

describe('assigning and selecting by material', () => {
  const editing = (faces: string[]) => ({
    selection: {
      objectIds: ['cube'],
      activeObjectId: 'cube',
      activeMaterialSlot: 1,
      editObjectIds: ['cube'],
      elements: { cube: { vertices: [], edges: [], faces } },
    },
    mode: 'edit' as const,
  })

  it('puts the selected faces in the active slot', () => {
    const document = scene({ faces: [0, 0, 0, 0, 0, 0] })
    const ids = meshOf(document, objectById(document, 'cube')!)!.faceIds.slice(0, 2).map(String)
    const result = run(document, 'material.assign', {}, editing(ids))
    expect(slotsOf(result.document!)).toEqual([1, 1, 0, 0, 0, 0])
    expect(result.label).toBe('Assigned 2 faces')
  })

  it('says what to do when nothing is selected', () => {
    const document = scene()
    expect(operatorAvailability('material.assign', contextFor(document, editing([])))).toBe('Select some faces first.')
  })

  it('selects every face in the slot, keeping what was selected already', () => {
    const document = scene({ faces: [0, 0, 1, 1, 0, 1] })
    const mesh = meshOf(document, objectById(document, 'cube')!)!
    const first = String(mesh.faceIds[0])
    const result = run(document, 'material.select', {}, editing([first]))
    const chosen = result.selection!.elements!.cube!.faces
    expect(chosen).toContain(first)
    expect(chosen).toHaveLength(4)
    expect(result.label).toBe('Selected 3 faces')
  })

  it('deselects them again without touching the rest', () => {
    const document = scene({ faces: [0, 0, 1, 1, 0, 1] })
    const mesh = meshOf(document, objectById(document, 'cube')!)!
    const all = mesh.faceIds.map(String)
    const result = run(document, 'material.deselect', {}, editing(all))
    expect(result.selection!.elements!.cube!.faces).toHaveLength(3)
  })
})

describe('what a file may hold', () => {
  it('drops a texture slot whose resource id is not a string, and keeps the rest', () => {
    const document = sanitizeSceneDocument({
      ...createSceneDocument(),
      materials: [{
        ...DEFAULT_MATERIAL,
        textures: {
          baseColor: { resourceId: 'resource-1', name: 'grain.png', scale: [2, 2] },
          roughness: { resourceId: 42 },
          normal: { nothing: true },
        },
      }],
    } as unknown as SceneDocument)
    const textures = document!.materials[0]!.textures!
    expect(textures.baseColor).toEqual({ resourceId: 'resource-1', name: 'grain.png', scale: [2, 2] })
    expect(textures.roughness).toBeUndefined()
    expect(textures.normal).toBeUndefined()
  })

  it('bounds a face material index at nought rather than letting it go negative', () => {
    const mesh = boxMesh(2)
    mesh.attributes.face.material[0] = -3
    const document = sanitizeSceneDocument({
      ...createSceneDocument(),
      objects: [meshObject('cube', ['material-a'])],
      meshes: { 'mesh-1': mesh },
      materials: [material('material-a', 'Red')],
    } as SceneDocument)
    expect(document!.meshes['mesh-1']!.attributes.face.material[0]).toBe(0)
  })
})
