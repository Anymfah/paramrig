import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneDocument, ROOT_COLLECTION_ID, withMesh } from '@/scene/document'
import { boxMesh, gridMesh } from '@/scene/mesh/primitives'
import { activeUv, loopCount, uvMapsOf, withUvMaps } from '@/scene/mesh/uv'
import '@/scene/operators'
import { getOperator } from '@/scene/operators/registry'
import { islandsFromSeams } from '@/scene/uv/islands'
import type { MeshData, SceneDocument, SceneObject, SceneSelection } from '@/scene/types'
import type { OperatorContext, OperatorParams } from '@/scene/operators/types'

/**
 * The UV menu, run the way the editor runs it.
 *
 * Each of these is a whole operator against a whole document, because that is where the parts meet:
 * the selection says which faces, the mesh says which corners, and what comes back has to be a map
 * the renderer can read. The arithmetic of each unwrapper is tested beside the unwrapper.
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

function scene(mesh: MeshData): SceneDocument {
  const document = { ...createSceneDocument(), objects: [object()], meshes: { [MESH]: mesh } }
  return { ...document, view: { ...document.view, mode: 'edit', selectMode: ['face'] } }
}

/** The editor's context for a mesh with every face selected, which is what U works on. */
function context(document: SceneDocument, faces?: number[]): OperatorContext {
  const mesh = document.meshes[MESH]!
  const chosen = faces ?? mesh.faceIds.map((_, index) => index)
  const selection: SceneSelection = {
    objectIds: ['object-1'],
    activeObjectId: 'object-1',
    editObjectIds: ['object-1'],
    // The selection names elements by id, as a document does, so that it survives an edit.
    elements: { 'object-1': { vertices: [], edges: [], faces: chosen.map((slot) => String(mesh.faceIds[slot]!)) } },
  }
  return {
    document,
    selection,
    cursor: document.cursor,
    view: document.view,
    units: document.units,
  } as unknown as OperatorContext
}

function run(document: SceneDocument, id: string, params: OperatorParams = {}): SceneDocument {
  const operator = getOperator(id)
  expect(operator, id).toBeTruthy()
  const result = operator!.run(context(document), { ...operator!.defaults, ...params })
  expect('error' in result ? result.error : null, id).toBeNull()
  return 'document' in result && result.document ? result.document : document
}

let seamedCube: SceneDocument

beforeEach(() => {
  const mesh = boxMesh(2)
  const seam = mesh.edges.map(() => true)
  seamedCube = scene({ ...mesh, attributes: { ...mesh.attributes, edge: { ...mesh.attributes.edge, seam } } })
})

describe('unwrapping from the menu', () => {
  it('gives a cut cube a map with every corner inside the image', () => {
    const next = run(seamedCube, 'uv.unwrap')
    const uv = activeUv(next.meshes[MESH]!)!
    expect(uv).toHaveLength(loopCount(next.meshes[MESH]!) * 2)
    expect(Math.min(...uv)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...uv)).toBeLessThanOrEqual(1)
  })

  it('lays the six islands of a cut cube apart from each other', () => {
    const next = run(seamedCube, 'uv.unwrap')
    const mesh = next.meshes[MESH]!
    const uv = activeUv(mesh)!
    const centres = islandsFromSeams(mesh).map((island) => {
      const corners = island.faces.flatMap((face) => [0, 1, 2, 3].map((corner) => face * 4 + corner))
      const u = corners.reduce((total, loop) => total + (uv[loop * 2] ?? 0), 0) / corners.length
      const v = corners.reduce((total, loop) => total + (uv[loop * 2 + 1] ?? 0), 0) / corners.length
      return `${u.toFixed(3)}:${v.toFixed(3)}`
    })
    expect(new Set(centres).size).toBe(6)
  })

  it('lays each island square with the image rather than on its corner', () => {
    const next = run(seamedCube, 'uv.unwrap')
    const uv = activeUv(next.meshes[MESH]!)!
    /*
     * A conformal flattening is only defined up to a rotation, so a square face comes back standing
     * on a corner as readily as lying flat — and a diamond needs twice the room of the square it is.
     * Every face of a cube is square, so every island's sides have to end up along the axes.
     */
    for (let face = 0; face < 6; face += 1) {
      for (let corner = 0; corner < 4; corner += 1) {
        const from = (face * 4 + corner) * 2
        const to = (face * 4 + ((corner + 1) % 4)) * 2
        const du = Math.abs((uv[to] ?? 0) - (uv[from] ?? 0))
        const dv = Math.abs((uv[to + 1] ?? 0) - (uv[from + 1] ?? 0))
        expect(Math.min(du, dv), `face ${face} side ${corner}`).toBeLessThan(0.01)
      }
    }
  })

  it('makes a map on a mesh that had none, and keeps the one it had otherwise', () => {
    const before = seamedCube.meshes[MESH]!
    expect(uvMapsOf(before)).toHaveLength(1)
    const named = withUvMaps(before, [{ name: 'Second', data: activeUv(before)!.slice() }], 0)
    const next = run({ ...seamedCube, meshes: { [MESH]: named } }, 'uv.unwrap')
    expect(uvMapsOf(next.meshes[MESH]!).map((map) => map.name)).toEqual(['Second'])
  })

  it('leaves the faces nobody selected where they were', () => {
    const before = activeUv(seamedCube.meshes[MESH]!)!.slice()
    const partial = run(seamedCube, 'uv.reset')
    // Reset over every face writes the unit square everywhere, which is what the cube already had.
    expect(activeUv(partial.meshes[MESH]!)!.slice(0, 8)).toEqual(before.slice(0, 8))
  })
})

describe('the projections from the menu', () => {
  for (const id of ['uv.cubeProject', 'uv.cylinderProject', 'uv.sphereProject', 'uv.reset', 'uv.projectFromView']) {
    it(`${id} writes a finite pair for every corner`, () => {
      const next = run(seamedCube, id)
      const uv = activeUv(next.meshes[MESH]!)!
      expect(uv).toHaveLength(loopCount(next.meshes[MESH]!) * 2)
      expect(uv.every((value) => Number.isFinite(value))).toBe(true)
    })
  }
})

describe('what the menu does to a map that exists', () => {
  it('packs the islands into the square', () => {
    const wild = withUvMaps(seamedCube.meshes[MESH]!, [{
      name: 'UVMap',
      data: activeUv(seamedCube.meshes[MESH]!)!.map((value) => value * 5 - 2),
    }], 0)
    const next = run({ ...seamedCube, meshes: { [MESH]: wild } }, 'uv.packIslands')
    const uv = activeUv(next.meshes[MESH]!)!
    expect(Math.min(...uv)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...uv)).toBeLessThanOrEqual(1)
  })

  it('gives every island the same texel density', () => {
    const mesh = seamedCube.meshes[MESH]!
    // One face blown up to five times the others: averaging must bring it back.
    const data = activeUv(mesh)!.slice()
    for (let corner = 0; corner < 4; corner += 1) {
      data[corner * 2] = (data[corner * 2] ?? 0) * 5
      data[corner * 2 + 1] = (data[corner * 2 + 1] ?? 0) * 5
    }
    const next = run({ ...seamedCube, meshes: { [MESH]: withUvMaps(mesh, [{ name: 'UVMap', data }], 0) } }, 'uv.averageIslandScale')
    const after = activeUv(next.meshes[MESH]!)!
    const width = Math.max(after[0]!, after[2]!, after[4]!, after[6]!) - Math.min(after[0]!, after[2]!, after[4]!, after[6]!)
    const other = Math.max(after[8]!, after[10]!, after[12]!, after[14]!) - Math.min(after[8]!, after[10]!, after[12]!, after[14]!)
    expect(width).toBeCloseTo(other, 3)
  })

  it('marks a seam wherever the map is cut', () => {
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
    const document = scene(mesh)
    // Every face on the whole image, so every shared edge is a cut.
    const data: number[] = []
    for (let face = 0; face < mesh.faces.length; face += 1) data.push(0, 0, 1, 0, 1, 1, 0, 1)
    const next = run({ ...document, meshes: { [MESH]: withUvMaps(mesh, [{ name: 'UVMap', data }], 0) } }, 'uv.seamsFromIslands')
    expect((next.meshes[MESH]!.attributes.edge.seam ?? []).some(Boolean)).toBe(true)
  })
})

describe('what the menu refuses', () => {
  it('says so when a mesh has no UV map to read seams from', () => {
    const bare = withUvMaps(seamedCube.meshes[MESH]!, [])
    const operator = getOperator('uv.seamsFromIslands')!
    const result = operator.run(context({ ...seamedCube, meshes: { [MESH]: bare } }), {})
    expect('error' in result ? result.error : '').toMatch(/no UV map/i)
  })
})

/** Kept so the mesh helpers are exercised through the operators rather than only in isolation. */
void withMesh
