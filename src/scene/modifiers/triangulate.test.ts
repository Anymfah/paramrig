import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh, planeMesh } from '@/scene/mesh/primitives'
import { getModifier } from '@/scene/modifiers/types'
import { euler, isClosed, isConsistentlyWound, isWellFormed, meshVolume } from '@/scene/operators/editHarness'
import '@/scene/modifiers/triangulate'

/**
 * Triangulate, judged by the counts a cut into triangles has to give.
 *
 * A cube of six quads becomes twelve triangles: one diagonal per face, so 8 vertices, 12 + 6 = 18
 * edges and 12 faces, still closed and still holding eight cubic metres. A hexagonal n-gon becomes
 * four triangles, whichever way the diagonals fall.
 */

const triangulate = getModifier('triangulate')!

type Params = Record<string, number | string | boolean>

function run(mesh: EditMesh, params: Params = {}): string | void {
  return triangulate.apply(mesh, { ...triangulate.defaults, ...params }, { inputs: {}, forRender: false, editing: false })
}

function everyFaceIsATriangle(mesh: EditMesh): boolean {
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (mesh.faceVertices(face).length !== 3) return false
  }
  return true
}

describe('the triangulate modifier', () => {
  it('cuts a cube into twelve triangles and leaves it closed', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh)).toBeUndefined()

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(18)
    expect(mesh.faceCount).toBe(12)
    expect(everyFaceIsATriangle(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(meshVolume(mesh)).toBeCloseTo(8, 10)
  })

  it('cuts a hexagon into four triangles, both n-gon ways', () => {
    for (const ngonMethod of ['beauty', 'clip']) {
      const mesh = EditMesh.from(circleMesh({ vertices: 6, radius: 1, fill: 'ngon' }))

      expect(run(mesh, { ngonMethod })).toBeUndefined()

      expect(mesh.vertexCount).toBe(6)
      expect(mesh.faceCount).toBe(4)
      expect(everyFaceIsATriangle(mesh)).toBe(true)
      expect(isWellFormed(mesh)).toBe(true)
      expect(euler(mesh)).toBe(1)
    }
  })

  it('takes the diagonal each quad method asks for', () => {
    // A square is symmetrical, so the two fixed methods are what tells them apart: “fixed” cuts
    // from the first corner and “alternate” from the second.
    const fixed = EditMesh.from(planeMesh(2))
    const alternate = EditMesh.from(planeMesh(2))
    const loop = fixed.faceVertices(0)

    run(fixed, { quadMethod: 'fixed' })
    run(alternate, { quadMethod: 'alternate' })

    expect(fixed.edgeSlot(loop[0]!, loop[2]!)).toBeGreaterThanOrEqual(0)
    expect(fixed.edgeSlot(loop[1]!, loop[3]!)).toBe(-1)
    expect(alternate.edgeSlot(loop[1]!, loop[3]!)).toBeGreaterThanOrEqual(0)
    expect(alternate.edgeSlot(loop[0]!, loop[2]!)).toBe(-1)
  })

  it('keeps the quads when the floor is raised past four corners', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh, { minVertices: 5 })).toBe('No face here has enough corners to triangulate.')
    expect(mesh.faceCount).toBe(6)

    const hexagon = EditMesh.from(circleMesh({ vertices: 6, radius: 1, fill: 'ngon' }))
    expect(run(hexagon, { minVertices: 5 })).toBeUndefined()
    expect(hexagon.faceCount).toBe(4)
  })

  it('carries the material and the shading onto every triangle it mints', () => {
    const mesh = EditMesh.from(boxMesh(2))
    mesh.setFaceMaterial(0, 3)
    mesh.setFaceSmooth(0, true)

    run(mesh)

    let painted = 0
    for (let face = 0; face < mesh.faceCount; face += 1) {
      if (mesh.faceMaterial(face) !== 3) continue
      painted += 1
      expect(mesh.faceSmooth(face)).toBe(true)
    }
    expect(painted).toBe(2)
  })

  it('says so when every face is already a triangle', () => {
    const mesh = EditMesh.from(boxMesh(2))
    run(mesh)

    expect(run(mesh)).toBe('No face here has enough corners to triangulate.')
    expect(mesh.faceCount).toBe(12)
  })
})
