import { describe, expect, it } from 'vitest'
import { cloneMesh, meshFingerprint, validateMeshData } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, planeMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import {
  activeUv,
  activeUvIndex,
  hasUvs,
  loopCount,
  loopStarts,
  remapUvs,
  uniqueUvName,
  uvAt,
  uvMapsOf,
  withActiveUv,
  withUvMaps,
} from '@/scene/mesh/uv'
import type { MeshData } from '@/scene/types'

/**
 * The corner domain.
 *
 * Two things are worth testing and the rest follows: that a map is always exactly as long as the
 * corners under it, and that it survives everything that reorders faces — because a UV map that is
 * one corner out of step is worse than no UV map at all.
 */

function twoQuads(): MeshData {
  return validateMeshData({
    vertices: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0],
    vertexIds: [0, 1, 2, 3, 4, 5],
    nextVertexId: 6,
    edges: [],
    faces: [[0, 1, 2, 3], [1, 4, 5, 2]],
    faceIds: [0, 1],
    nextFaceId: 2,
    attributes: { face: { smooth: [false, false], material: [0, 0] }, edge: {}, vertex: {}, loop: {} },
  })!
}

describe('counting corners', () => {
  it('adds up the face lengths, and says where each face starts', () => {
    const mesh = twoQuads()
    expect(loopCount(mesh)).toBe(8)
    expect(loopStarts(mesh)).toEqual([0, 4, 8])
  })

  it('gives a triangle three corners and a quad four', () => {
    const mesh = { faces: [[0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4]] }
    expect(loopCount(mesh)).toBe(12)
    expect(loopStarts(mesh)).toEqual([0, 3, 7, 12])
  })
})

describe('the maps a mesh carries', () => {
  it('starts with none, and says so', () => {
    const mesh = twoQuads()
    expect(hasUvs(mesh)).toBe(false)
    expect(activeUv(mesh)).toBeNull()
    expect(activeUvIndex(mesh)).toBe(-1)
  })

  it('takes one, and answers with it', () => {
    const data = new Array<number>(16).fill(0).map((_, index) => index / 16)
    const mesh = withActiveUv(twoQuads(), data)
    expect(hasUvs(mesh)).toBe(true)
    expect(uvMapsOf(mesh)[0]!.name).toBe('UVMap')
    expect(activeUv(mesh)).toEqual(data)
    expect(uvAt(activeUv(mesh)!, 2)).toEqual([4 / 16, 5 / 16])
  })

  it('replaces the active one rather than adding another', () => {
    const first = withUvMaps(twoQuads(), [{ name: 'A', data: new Array<number>(16).fill(0) }, { name: 'B', data: new Array<number>(16).fill(1) }], 1)
    const next = withActiveUv(first, new Array<number>(16).fill(0.5))
    expect(uvMapsOf(next)).toHaveLength(2)
    expect(uvMapsOf(next)[0]!.data[0]).toBe(0)
    expect(activeUv(next)![0]).toBe(0.5)
  })

  it('holds the active index inside the list it points at', () => {
    const mesh = withUvMaps(twoQuads(), [{ name: 'A', data: new Array<number>(16).fill(0) }], 7)
    expect(activeUvIndex(mesh)).toBe(0)
  })

  it('numbers a repeated name the way Blender does', () => {
    const maps = [{ name: 'UVMap', data: [] }, { name: 'UVMap.001', data: [] }]
    expect(uniqueUvName(maps)).toBe('UVMap.002')
    expect(uniqueUvName(maps, 'Lightmap')).toBe('Lightmap')
  })

  it('copies its maps when the mesh is cloned, sharing nothing', () => {
    const mesh = withActiveUv(twoQuads(), new Array<number>(16).fill(0.25))
    const copy = cloneMesh(mesh)
    copy.attributes.loop!.uvMaps![0]!.data[0] = 9
    expect(activeUv(mesh)![0]).toBe(0.25)
  })
})

describe('rebuilding a map when the faces change', () => {
  it('takes each corner from where the operator says it came from', () => {
    const mesh = withActiveUv(twoQuads(), [0, 0, 1, 0, 1, 1, 0, 1, 2, 0, 3, 0, 3, 1, 2, 1])
    const maps = remapUvs(mesh, [3, 2, 1, 0])
    expect(maps[0]!.data).toEqual([0, 1, 1, 1, 1, 0, 0, 0])
  })

  it('puts a corner made by a cut between the two it was cut from', () => {
    const mesh = withActiveUv(twoQuads(), [0, 0, 2, 0, 2, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0])
    const maps = remapUvs(mesh, [{ from: 0, to: 1, at: 0.5 }, { from: 1, to: 2, at: 0.25 }])
    expect(maps[0]!.data).toEqual([1, 0, 2, 0.5])
  })

  it('leaves a corner that inherits nothing at the origin', () => {
    const mesh = withActiveUv(twoQuads(), new Array<number>(16).fill(0.5))
    expect(remapUvs(mesh, [null, 0])[0]!.data).toEqual([0, 0, 0.5, 0.5])
  })

  it('rebuilds every map, not only the active one', () => {
    const mesh = withUvMaps(twoQuads(), [
      { name: 'A', data: new Array<number>(16).fill(0.1) },
      { name: 'B', data: new Array<number>(16).fill(0.9) },
    ])
    const maps = remapUvs(mesh, [0, 1])
    expect(maps.map((map) => map.name)).toEqual(['A', 'B'])
    expect(maps[1]!.data).toEqual([0.9, 0.9, 0.9, 0.9])
  })
})

describe('what a file may say', () => {
  it('drops a map whose length is not the corners the faces have', () => {
    const mesh = twoQuads()
    const read = validateMeshData({ ...mesh, attributes: { ...mesh.attributes, loop: { uvMaps: [{ name: 'Short', data: [0, 0] }] } } })
    expect(uvMapsOf(read!)).toEqual([])
  })

  it('takes a bare loop.uv as the one map, which is the shorter thing to write by hand', () => {
    const mesh = twoQuads()
    const read = validateMeshData({ ...mesh, attributes: { ...mesh.attributes, loop: { uv: new Array<number>(16).fill(0.5) } } })
    expect(uvMapsOf(read!)).toHaveLength(1)
    expect(uvMapsOf(read!)[0]!.name).toBe('UVMap')
  })

  it('holds the active index inside the maps it has', () => {
    const mesh = twoQuads()
    const read = validateMeshData({
      ...mesh,
      attributes: { ...mesh.attributes, loop: { uvMaps: [{ name: 'A', data: new Array<number>(16).fill(0) }], activeUv: 5 } },
    })
    expect(read!.attributes.loop.activeUv).toBe(0)
  })

  it('reads a number a file wrote as a string, and refuses one that is not a number at all', () => {
    const mesh = twoQuads()
    const data = new Array<number>(16).fill(0) as unknown[]
    data[0] = '0.5'
    data[1] = 'nowhere'
    const read = validateMeshData({ ...mesh, attributes: { ...mesh.attributes, loop: { uvMaps: [{ name: 'A', data }] } } })
    expect(activeUv(read!)!.slice(0, 2)).toEqual([0.5, 0])
  })
})

describe('how the drawn view is kept in step', () => {
  /*
   * Not by the fingerprint. It is the key of the triangulation cache, and a triangulation does not
   * depend on a texture coordinate; hashing half a million numbers per frame to answer a question
   * about the shape would cost more than drawing the mesh. The view compares the array itself.
   */
  it('leaves the fingerprint alone when a UV moves, because a triangulation has not changed', () => {
    const mesh = withActiveUv(twoQuads(), new Array<number>(16).fill(0.25))
    const moved = withActiveUv(mesh, new Array<number>(16).fill(0.75))
    expect(meshFingerprint(moved)).toBe(meshFingerprint(mesh))
  })

  it('hands over a new array whenever a map changes, which is what the view compares', () => {
    const mesh = withActiveUv(twoQuads(), new Array<number>(16).fill(0.25))
    const moved = withActiveUv(mesh, new Array<number>(16).fill(0.75))
    expect(activeUv(moved)).not.toBe(activeUv(mesh))
    // And the mesh it was built from is untouched, as every helper here is.
    expect(activeUv(mesh)![0]).toBe(0.25)
  })
})

describe('the mutable editor', () => {
  it('takes the maps apart and puts them back together unchanged', () => {
    const data = new Array<number>(16).fill(0).map((_, index) => index)
    const mesh = withActiveUv(twoQuads(), data)
    expect(activeUv(EditMesh.from(mesh).toData())).toEqual(data)
  })

  it('reorders the corners of a face when it is flipped', () => {
    const mesh = withActiveUv(twoQuads(), [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0])
    const edit = EditMesh.from(mesh)
    edit.flipFace(0)
    // The first corner stays where it is and the rest run the other way, as the loop does.
    expect(activeUv(edit.toData())!.slice(0, 8)).toEqual([0, 0, 0, 1, 1, 1, 1, 0])
  })

  it('gives a face made from nothing an empty row of the right length', () => {
    const mesh = withActiveUv(twoQuads(), new Array<number>(16).fill(0.5))
    const edit = EditMesh.from(mesh)
    edit.addFace([0, 1, 4])
    const data = activeUv(edit.toData())!
    expect(data).toHaveLength(22)
    expect(data.slice(16)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('copies the corners of one face onto another', () => {
    const mesh = withActiveUv(twoQuads(), [0, 0, 1, 0, 1, 1, 0, 1, 9, 9, 9, 9, 9, 9, 9, 9])
    const edit = EditMesh.from(mesh)
    edit.copyFaceUv(0, 1)
    expect(activeUv(edit.toData())!.slice(8)).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
  })

  it('blends a corner between two others, which is what a cut leaves', () => {
    const mesh = withActiveUv(twoQuads(), [0, 0, 2, 0, 2, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0])
    const edit = EditMesh.from(mesh)
    edit.blendCornerUv({ face: 0, corner: 0 }, { face: 0, corner: 1 }, 0.5, { face: 1, corner: 0 })
    expect(activeUv(edit.toData())!.slice(8, 10)).toEqual([1, 0])
  })
})

describe('the primitives', () => {
  it('every one arrives with a map as long as its corners', () => {
    for (const mesh of [planeMesh(), boxMesh(), uvSphereMesh({ segments: 8, rings: 4 })]) {
      const data = activeUv(mesh)
      expect(data, JSON.stringify(mesh.faces.length)).not.toBeNull()
      expect(data!.length).toBe(loopCount(mesh) * 2)
    }
  })

  it('gives every face of a cube the whole image, as Blender does', () => {
    const data = activeUv(boxMesh())!
    for (let face = 0; face < 6; face += 1) {
      const row = data.slice(face * 8, face * 8 + 8)
      expect(row).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
    }
  })
})
