import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh } from '@/scene/mesh/primitives'
import { translation } from '@/scene/modifiers/matrix'
import { getModifier, type ModifierInput } from '@/scene/modifiers/types'
import { euler, isClosed, isConsistentlyWound, isWellFormed, meshVolume, signedVolume } from '@/scene/operators/editHarness'
import type { Modifier, Vec3 } from '@/scene/types'
import '@/scene/modifiers/mirror'

/**
 * Mirror, judged by the solid it closes.
 *
 * Half a two-metre cube encloses nothing at all — it is a shell with a hole in one side. Mirrored,
 * it has to enclose exactly eight cubic metres, be closed, and have no doubled vertex left on the
 * plane. Those four numbers together are what no count on its own can say: a mirror that welded
 * nothing, that wound its copy the wrong way round, or that reflected about the wrong plane, fails
 * one of them.
 */

const module = getModifier('mirror')!

function mirror(mesh: EditMesh, params: Modifier['params'] = {}, inputs: Record<string, ModifierInput | null> = {}) {
  return module.apply(mesh, { ...module.defaults, ...params }, { inputs, forRender: false, editing: false })
}

/** The face of a box whose centre sits on the plane where `axis` reads zero. */
function faceOnPlane(mesh: EditMesh, axis: 0 | 1 | 2): number {
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (Math.abs(mesh.faceCentre(face)[axis]) < 1e-9) return face
  }
  return -1
}

function shifted(mesh: EditMesh, by: Vec3): EditMesh {
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    mesh.setPosition(slot, [point[0] + by[0], point[1] + by[1], point[2] + by[2]])
  }
  return mesh
}

/** The +X half of a two-metre cube, open where the plane cuts it: five faces, eight vertices. */
function halfCube(): EditMesh {
  const mesh = shifted(EditMesh.from(boxMesh([1, 2, 2])), [0.5, 0, 0])
  mesh.removeFaces([faceOnPlane(mesh, 0)])
  return mesh
}

/** The +X +Y quarter of the same cube, open on both planes: four faces. */
function quarterCube(): EditMesh {
  const mesh = shifted(EditMesh.from(boxMesh([1, 1, 2])), [0.5, 0.5, 0])
  mesh.removeFaces([faceOnPlane(mesh, 0)])
  mesh.removeFaces([faceOnPlane(mesh, 1)])
  // The two removed faces shared an edge, which is left dangling with no face of its own; a person
  // modelling a quarter would not have one, and it would still be dangling after the mirror.
  mesh.dropLoose()
  return mesh
}

/** How many vertices sit exactly on the plane, which is what says whether the weld happened. */
function onPlane(mesh: EditMesh, axis: 0 | 1 | 2): number {
  let count = 0
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    if (Math.abs(mesh.position(slot)[axis]) < 1e-9) count += 1
  }
  return count
}

describe('the mirror modifier', () => {
  it('closes half a cube into a cube, welding the vertices that meet on the plane', () => {
    const mesh = halfCube()
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 5])

    expect(mirror(mesh)).toBeUndefined()

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([12, 20, 10])
    expect(euler(mesh)).toBe(2)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    // Eight cubic metres, and the sign says the faces still look outwards rather than in.
    expect(signedVolume(mesh)).toBeCloseTo(8, 10)
    expect(onPlane(mesh, 0)).toBe(4)
    expect(mesh.bounds().min[0]).toBeCloseTo(-1, 10)
  })

  it('doubles the mesh exactly when merge is switched off', () => {
    const mesh = halfCube()

    expect(mirror(mesh, { merge: false })).toBeUndefined()

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([16, 24, 10])
    expect(isWellFormed(mesh)).toBe(true)
    // Two shells with their rims lying on each other: the plane carries the doubled vertices.
    expect(onPlane(mesh, 0)).toBe(8)
    expect(isClosed(mesh)).toBe(false)
  })

  it('bisects away what is past the plane before reflecting', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(mirror(mesh, { bisectX: true })).toBeUndefined()

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([12, 20, 10])
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(8, 10)
  })

  it('leaves the far half in place when bisect is off, and mirrors it onto itself', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(mirror(mesh)).toBeUndefined()

    // The whole cube reflected onto the whole cube: two closed boxes in the same eight metres.
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([16, 24, 12])
    expect(isWellFormed(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(16, 10)
  })

  it('mirrors about a mirror object’s plane rather than the origin’s', () => {
    const mesh = halfCube()
    const empty: ModifierInput = { id: 'empty', name: 'Plane', matrix: translation([2, 0, 0]), mesh: null }

    expect(mirror(mesh, { mirrorObject: 'empty' }, { mirrorObject: empty })).toBeUndefined()

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([16, 24, 10])
    expect(isWellFormed(mesh)).toBe(true)
    // The copy sits between three and four metres along X; nothing was reflected through the origin.
    expect(mesh.bounds().min[0]).toBeCloseTo(0, 10)
    expect(mesh.bounds().max[0]).toBeCloseTo(4, 10)
  })

  it('turns the copy inside out when the axis is flipped', () => {
    const kept = halfCube()
    const flipped = halfCube()

    mirror(kept)
    mirror(flipped, { flipX: true })

    expect(isConsistentlyWound(kept)).toBe(true)
    // Both halves wound the same way round the seam they share is what “inside out” looks like.
    expect(isConsistentlyWound(flipped)).toBe(false)
    expect(isWellFormed(flipped)).toBe(true)
  })

  it('composes two axes into four quarters of one closed cube', () => {
    const mesh = quarterCube()
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 11, 4])

    expect(mirror(mesh, { axisX: true, axisY: true })).toBeUndefined()

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([18, 32, 16])
    expect(euler(mesh)).toBe(2)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    expect(signedVolume(mesh)).toBeCloseTo(8, 10)
  })

  it('refuses when no axis is switched on', () => {
    const mesh = halfCube()

    expect(mirror(mesh, { axisX: false })).toBe('Mirror has no axis switched on, so there is nothing to reflect.')

    expect([mesh.vertexCount, mesh.faceCount]).toEqual([8, 5])
  })

  it('refuses when the mirror object it names has gone from the scene', () => {
    const mesh = halfCube()

    const outcome = mirror(mesh, { mirrorObject: 'empty' }, { mirrorObject: null })

    expect(outcome).toBe('The mirror object this modifier names is not in the scene any more.')
    expect(mesh.faceCount).toBe(5)
  })

  it('offers a field for every default it holds, with the same value', () => {
    const ids = module.schema.map((param) => param.id)

    expect([...ids].sort()).toEqual(Object.keys(module.defaults).sort())
    for (const param of module.schema) expect(module.defaults[param.id]).toEqual(param.defaultValue)
  })
})
