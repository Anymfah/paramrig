import { describe, expect, it } from 'vitest'
import { DEFAULT_MATERIAL } from '@/scene/document'
import { meshCounts, meshFromPolygons } from '@/scene/mesh/data'
import { boxMesh } from '@/scene/mesh/primitives'
import { readObj, writeObj } from '@/scene/io/obj'
import type { Material, MeshData, Vec3 } from '@/scene/types'

/**
 * What matters about a file format is the round trip: a mesh written and read again has to be the
 * same mesh, n-gons and all. Everything else here is about the ways an OBJ from elsewhere can be
 * written — one-based indices, negative indices, several objects sharing one vertex list.
 */

function positionsOf(mesh: MeshData): Vec3[] {
  const points: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
    points.push([mesh.vertices[slot * 3]!, mesh.vertices[slot * 3 + 1]!, mesh.vertices[slot * 3 + 2]!])
  }
  return points
}

/** The mesh's faces as sorted lists of sorted positions, so two meshes can be compared by shape. */
function shape(mesh: MeshData): string[] {
  const points = positionsOf(mesh)
  return mesh.faces
    .map((loop) => loop.map((corner) => points[corner]!.map((value) => value.toFixed(4)).join(',')).sort().join(' | '))
    .sort()
}

function material(patch: Partial<Material> = {}): Material {
  return { ...DEFAULT_MATERIAL, ...patch }
}

describe('reading an OBJ', () => {
  it('takes a cube back as a cube', () => {
    const { obj } = writeObj([{ name: 'Cube', mesh: boxMesh(2), materials: [material()] }])
    const read = readObj(obj)
    expect(read.objects).toHaveLength(1)
    expect(meshCounts(read.objects[0]!.mesh)).toEqual(meshCounts(boxMesh(2)))
    expect(shape(read.objects[0]!.mesh)).toEqual(shape(boxMesh(2)))
  })

  it('keeps an n-gon rather than triangulating it', () => {
    const hexagon = meshFromPolygons(
      Array.from({ length: 6 }, (_, index): Vec3 => [Math.cos((index / 6) * Math.PI * 2), Math.sin((index / 6) * Math.PI * 2), 0]),
      [[0, 1, 2, 3, 4, 5]],
    )
    const { obj } = writeObj([{ name: 'Hex', mesh: hexagon, materials: [material()] }])
    const read = readObj(obj).objects[0]!.mesh
    expect(read.faces).toHaveLength(1)
    expect(read.faces[0]).toHaveLength(6)
  })

  it('numbers each object from where the last one ended', () => {
    const first = boxMesh(2)
    const second = boxMesh(1)
    const { obj } = writeObj([
      { name: 'A', mesh: first, materials: [material()] },
      { name: 'B', mesh: second, materials: [material()] },
    ])
    const read = readObj(obj)
    expect(read.objects.map((object) => object.name)).toEqual(['A', 'B'])
    // The second object's own vertices, not the first's: a wrong offset shows up as a cube of the
    // other size, or as one that reaches back into its neighbour.
    const bounds = positionsOf(read.objects[1]!.mesh).map((point) => Math.abs(point[0]))
    expect(Math.max(...bounds)).toBeCloseTo(0.5, 6)
  })

  it('reads one-based, negative and slashed indices the way the format defines them', () => {
    const text = [
      'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
      'vt 0 0', 'vn 0 0 1',
      'f 1/1/1 2/1/1 3/1/1 4/1/1',
      'v 0 0 1', 'v 1 0 1', 'v 1 1 1',
      'f -3 -2 -1',
    ].join('\n')
    const read = readObj(text)
    expect(read.objects).toHaveLength(1)
    const mesh = read.objects[0]!.mesh
    expect(mesh.faces.map((loop) => loop.length).sort()).toEqual([3, 4])
  })

  it('gives each named material a slot, and each face the slot it was drawn with', () => {
    const text = [
      'mtllib scene.mtl',
      'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
      'usemtl Red', 'f 1 2 3',
      'usemtl Blue', 'f 1 3 4',
    ].join('\n')
    const read = readObj(text)
    expect(read.materialLibrary).toBe('scene.mtl')
    expect(read.objects[0]!.materials).toEqual(['Red', 'Blue'])
    expect([...read.objects[0]!.mesh.attributes.face.material]).toEqual([0, 1])
  })

  it('ignores comments, blank lines and anything it has no place for', () => {
    const text = ['# a cube', '', 'usemap none', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', 'l 1 2'].join('\n')
    expect(readObj(text).objects[0]!.mesh.faces).toHaveLength(1)
  })

  it('gives nothing back for a file with no faces rather than an empty object', () => {
    expect(readObj('v 0 0 0\nv 1 0 0').objects).toHaveLength(0)
  })
})

describe('writing an OBJ', () => {
  it('writes the geometry in world space when a matrix is given', () => {
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]
    const { obj } = writeObj([{ name: 'Cube', mesh: boxMesh(2), materials: [material()], matrix }])
    const read = readObj(obj).objects[0]!
    const xs = positionsOf(read.mesh).map((point) => point[0])
    expect(Math.min(...xs)).toBeCloseTo(9, 6)
    expect(Math.max(...xs)).toBeCloseTo(11, 6)
  })

  it('names each material once, in runs, rather than once per face', () => {
    const mesh = boxMesh(2)
    for (let face = 0; face < mesh.faceIds.length; face += 1) mesh.attributes.face.material[face] = face % 2
    const { obj } = writeObj([{
      name: 'Cube',
      mesh,
      materials: [material({ name: 'Red' }), material({ name: 'Blue' })],
    }])
    expect(obj.split('\n').filter((line) => line.startsWith('usemtl'))).toEqual(['usemtl Red', 'usemtl Blue'])
  })

  it('writes a companion .mtl with what the two shading models share', () => {
    const { mtl } = writeObj([{
      name: 'Cube',
      mesh: boxMesh(2),
      materials: [material({ name: 'Glass', baseColor: '#ff0000', roughness: 0, alpha: 0.5 })],
    }])
    expect(mtl).toContain('newmtl Glass')
    expect(mtl).toContain('Kd 1 0 0')
    expect(mtl).toContain('d 0.5')
    // Roughness nought is the shiniest a Phong exponent gets, not the mattest.
    expect(mtl).toMatch(/Ns 90[0-9]/)
  })

  it('says whether each face is smooth, changing the state only when it changes', () => {
    const mesh = boxMesh(2)
    for (let face = 0; face < mesh.faceIds.length; face += 1) mesh.attributes.face.smooth[face] = true
    const { obj } = writeObj([{ name: 'Cube', mesh, materials: [material()] }])
    expect(obj.split('\n').filter((line) => line.startsWith('s '))).toEqual(['s 1'])
    expect(readObj(obj).objects[0]!.mesh.attributes.face.smooth.every(Boolean)).toBe(true)
  })
})
