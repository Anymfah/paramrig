import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh, icoSphereMesh } from '@/scene/mesh/primitives'
import {
  allIds,
  editContext,
  euler,
  isClosed,
  isWellFormed,
  meshVolume,
  resultEdit,
  resultSelection,
} from '@/scene/operators/editHarness'
import '@/scene/operators/hull'
import { runOperator } from '@/scene/operators/registry'
import type { MeshData, Vec3 } from '@/scene/types'

/** A primitive with another vertex in it, for the points a hull has to decide about. */
function withVertex(mesh: MeshData, point: Vec3): MeshData {
  const edit = EditMesh.from(mesh)
  edit.addVertex(point)
  return edit.toData()
}

function everyFaceHas(mesh: EditMesh, corners: number): boolean {
  for (let face = 0; face < mesh.faceCount; face += 1) if (mesh.faceVertices(face).length !== corners) return false
  return true
}

describe('mesh.convexHull', () => {
  it('wraps the eight corners of a box in six quads of the same volume', () => {
    const mesh = boxMesh(2)
    const result = runOperator('mesh.convexHull', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(8)
    expect(after.faceCount).toBe(6)
    expect(after.edgeCount).toBe(12)
    expect(everyFaceHas(after, 4)).toBe(true)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(isWellFormed(after)).toBe(true)
    expect(meshVolume(after)).toBeCloseTo(8, 6)
    expect(resultSelection(result).faces.length).toBe(6)
  })

  it('replays with the triangles left apart, and gives twelve of them', () => {
    const mesh = boxMesh(2)
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const after = resultEdit(runOperator('mesh.convexHull', context, { joinTriangles: false }))
    expect(after.faceCount).toBe(12)
    expect(after.edgeCount).toBe(18)
    expect(everyFaceHas(after, 3)).toBe(true)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(meshVolume(after)).toBeCloseTo(8, 6)
  })

  it('drops the vertex it did not need when delete unused is on', () => {
    const mesh = withVertex(boxMesh(2), [0, 0, 0])
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    expect(resultEdit(runOperator('mesh.convexHull', context)).vertexCount).toBe(8)
    const kept = resultEdit(runOperator('mesh.convexHull', context, { deleteUnused: false }))
    expect(kept.vertexCount).toBe(9)
    expect(kept.faceCount).toBe(6)
    expect(isClosed(kept)).toBe(true)
  })

  it('holds a sphere in a closed hull of the same volume', () => {
    const mesh = icoSphereMesh({ subdivisions: 2 })
    const before = meshVolume(EditMesh.from(mesh))
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const after = resultEdit(runOperator('mesh.convexHull', context, { joinTriangles: false }))
    expect(after.vertexCount).toBe(42)
    expect(after.faceCount).toBe(80)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(isWellFormed(after)).toBe(true)
    // A sphere is already convex, so its hull is the sphere it started as.
    expect(meshVolume(after)).toBeCloseTo(before, 9)
  })

  it('welds the flat pairs of a hull together, and leaves it closed', () => {
    const mesh = icoSphereMesh({ subdivisions: 2 })
    const after = resultEdit(runOperator('mesh.convexHull', editContext({ mesh, vertices: allIds(mesh, 'vertex') })))
    // Forty degrees is a wide threshold on a sphere this coarse, so most of the pairs are welded.
    expect(after.faceCount).toBeLessThan(80)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(isWellFormed(after)).toBe(true)
  })

  it('refuses fewer than four vertices', () => {
    const mesh = boxMesh(2)
    expect(runOperator('mesh.convexHull', editContext({ mesh, vertices: [0, 1, 2] })).error)
      .toBe('Select at least four vertices to build a hull.')
  })

  it('refuses vertices that all lie in one plane', () => {
    const mesh = circleMesh({ vertices: 6, fill: 'none' })
    expect(runOperator('mesh.convexHull', editContext({ mesh, vertices: allIds(mesh, 'vertex') })).error)
      .toBe('The selected vertices all lie in one plane, so there is no hull to build.')
  })
})
