import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneDocument, ROOT_COLLECTION_ID } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { activeUv, pinnedOf } from '@/scene/mesh/uv'
import '@/scene/operators'
import { getOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams } from '@/scene/operators/types'
import type { SceneDocument, SceneObject } from '@/scene/types'

/**
 * The UV menu of the second space, run as the editor runs it.
 *
 * The one thing these have that no other operator does is where they read their selection from: the
 * UV editor's own, in `selection.uv`, rather than the mesh's. So every case here is about that —
 * what happens with a selection, and what is said when there is none.
 */

const MESH = 'mesh-1'

function object(): SceneObject {
  return {
    id: 'object-1',
    name: 'Cube',
    kind: 'mesh',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'mesh', meshId: MESH },
    modifiers: [],
    materialSlots: [],
  }
}

let scene: SceneDocument

beforeEach(() => {
  const base = createSceneDocument()
  scene = {
    ...base,
    objects: [object()],
    meshes: { [MESH]: boxMesh(2) },
    view: { ...base.view, mode: 'edit', selectMode: ['face'] },
  }
})

function context(loops: number[] | null, mode: 'object' | 'edit' = 'edit'): OperatorContext {
  return {
    document: { ...scene, view: { ...scene.view, mode } },
    selection: {
      objectIds: ['object-1'],
      activeObjectId: 'object-1',
      editObjectIds: ['object-1'],
      ...(loops ? { uv: { 'object-1': loops } } : {}),
    },
    mode,
    view: scene.view,
    cursor: scene.cursor,
    active: scene.objects[0]!,
  } as unknown as OperatorContext
}

function run(id: string, loops: number[] | null, params: OperatorParams = {}, mode: 'object' | 'edit' = 'edit') {
  const operator = getOperator(id)
  expect(operator, id).toBeTruthy()
  return operator!.run(context(loops, mode), { ...operator!.defaults, ...params })
}

describe('the UV editor’s menu', () => {
  it('says what it needs rather than doing nothing', () => {
    expect(run('uv.weld', null).error).toBe('Select something in the UV editor first.')
    expect(run('uv.weld', [0, 1], {}, 'object').error).toBe('This works in edit mode. Press Tab.')
    expect(getOperator('uv.weld')!.available(context(null))).toBe('Select something in the UV editor first.')
    expect(getOperator('uv.weld')!.available(context([0]))).toBe(true)
  })

  it('welds the corners the UV editor has selected, and only those', () => {
    const result = run('uv.weld', [0, 1, 2, 3])
    const uv = activeUv(result.document!.meshes[MESH]!)!
    expect(uv.slice(0, 8)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
    expect(uv.slice(8, 16)).toEqual(activeUv(scene.meshes[MESH]!)!.slice(8, 16))
  })

  it('pins and unpins, and a mesh with nothing pinned carries no list', () => {
    const pinned = run('uv.pin', [0, 5])
    expect(pinnedOf(pinned.document!.meshes[MESH]!).filter(Boolean)).toHaveLength(2)
    scene = pinned.document!
    const cleared = run('uv.unpin', [0, 5])
    expect(cleared.document!.meshes[MESH]!.attributes.loop.pinned).toBeUndefined()
  })

  it('an unwrap leaves a pinned corner where it was pinned', () => {
    /*
     * The cube's first face, pinned at two of its corners and then unwrapped on its own. The pins
     * are what the answer is measured against — everything else about a conformal map is free.
     */
    const mesh = scene.meshes[MESH]!
    const seam = mesh.edges.map(() => true)
    scene = { ...scene, meshes: { [MESH]: { ...mesh, attributes: { ...mesh.attributes, edge: { ...mesh.attributes.edge, seam } } } } }
    const pinned = run('uv.pin', [0, 2])
    scene = pinned.document!
    const before = activeUv(scene.meshes[MESH]!)!
    const unwrapped = getOperator('uv.unwrap')!.run({
      ...context(null),
      selection: {
        objectIds: ['object-1'],
        activeObjectId: 'object-1',
        editObjectIds: ['object-1'],
        elements: { 'object-1': { vertices: [], edges: [], faces: scene.meshes[MESH]!.faceIds.map(String) } },
      },
    } as unknown as OperatorContext, { ...getOperator('uv.unwrap')!.defaults, pack: false })
    const after = activeUv(unwrapped.document!.meshes[MESH]!)!
    expect(after[0]).toBeCloseTo(before[0]!, 3)
    expect(after[1]).toBeCloseTo(before[1]!, 3)
    expect(after[4]).toBeCloseTo(before[4]!, 3)
    expect(after[5]).toBeCloseTo(before[5]!, 3)
  })

  it('brings a map inside the image whatever is selected', () => {
    const mesh = scene.meshes[MESH]!
    const wide = activeUv(mesh)!.map((value) => value * 3 - 1)
    scene = { ...scene, meshes: { [MESH]: { ...mesh, attributes: { ...mesh.attributes, loop: { uvMaps: [{ name: 'UVMap', data: wide }], activeUv: 0 } } } } }
    const result = run('uv.constrainToImage', null)
    const uv = activeUv(result.document!.meshes[MESH]!)!
    expect(Math.min(...uv)).toBe(0)
    expect(Math.max(...uv)).toBe(1)
  })
})
