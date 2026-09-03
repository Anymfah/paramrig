import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { dot, normalize, subtract } from '@/scene/mesh/normals'
import { boxMesh, circleMesh } from '@/scene/mesh/primitives'
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
import '@/scene/operators/fill'
import { runOperator } from '@/scene/operators/registry'
import type { MeshData } from '@/scene/types'

/** A primitive with some of its faces taken out: how a test makes a hole to fill. */
function withoutFaces(mesh: MeshData, faces: number[]): MeshData {
  const edit = EditMesh.from(mesh)
  edit.remove({ faces })
  return edit.toData()
}

/** The narrowest corner of any face, in degrees — the measure beauty fill is trying to widen. */
function narrowestCorner(mesh: EditMesh): number {
  let narrowest = 180
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    for (let index = 0; index < loop.length; index += 1) {
      const here = mesh.position(loop[index]!)
      const before = normalize(subtract(mesh.position(loop[(index + loop.length - 1) % loop.length]!), here))
      const after = normalize(subtract(mesh.position(loop[(index + 1) % loop.length]!), here))
      const angle = Math.acos(Math.min(1, Math.max(-1, dot(before, after))))
      narrowest = Math.min(narrowest, (angle * 180) / Math.PI)
    }
  }
  return narrowest
}

function everyFaceHas(mesh: EditMesh, corners: number): boolean {
  for (let face = 0; face < mesh.faceCount; face += 1) if (mesh.faceVertices(face).length !== corners) return false
  return true
}

describe('mesh.fill', () => {
  it('closes a square rim of four edges with one face', () => {
    const mesh = circleMesh({ vertices: 4, fill: 'none' })
    const result = runOperator('mesh.fill', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(4)
    expect(after.edgeCount).toBe(4)
    expect(after.faceCount).toBe(1)
    expect(after.faceVertices(0).length).toBe(4)
    expect(isWellFormed(after)).toBe(true)
    expect(resultSelection(result).faces).toEqual([0])
  })

  it('joins two vertices with an edge and leaves no face behind', () => {
    const mesh = boxMesh(2)
    const result = runOperator('mesh.fill', editContext({ mesh, vertices: [0, 6] }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(8)
    expect(after.edgeCount).toBe(13)
    expect(after.faceCount).toBe(6)
    expect(isWellFormed(after)).toBe(true)
    expect(resultSelection(result)).toEqual({ vertices: [], edges: ['0:6'], faces: [] })
  })

  it('fills every rim of a selection at once, and closes the box it opened', () => {
    // The lid and the floor are gone, so the selection has two rims of four edges.
    const mesh = withoutFaces(boxMesh(2), [0, 1])
    const result = runOperator('mesh.fill', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    const after = resultEdit(result)
    expect(after.faceCount).toBe(6)
    expect(after.edgeCount).toBe(12)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(isWellFormed(after)).toBe(true)
    expect(meshVolume(after)).toBeCloseTo(8, 9)
    // Both new faces look outwards, like the four they were laid against.
    for (const id of [6, 7]) {
      const face = after.slotOfFace(id)
      expect(face).toBeGreaterThanOrEqual(0)
      expect(dot(after.faceNormal(face), after.faceCentre(face))).toBeGreaterThan(0)
    }
    expect(resultSelection(result).faces).toEqual([6, 7])
  })

  it('refuses when nothing selected can carry a face', () => {
    const mesh = boxMesh(2)
    const result = runOperator('mesh.fill', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    expect(result.error).toBe('Select a rim of edges to close, or two vertices to join.')
  })

  it('refuses two vertices a face already joins', () => {
    const result = runOperator('mesh.fill', editContext({ mesh: boxMesh(2), vertices: [0, 2] }))
    expect(result.error).toBe('Select two vertices that no face already joins.')
  })

  it('replays to the same face when the panel runs it again', () => {
    const mesh = circleMesh({ vertices: 6, fill: 'none' })
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const once = resultEdit(runOperator('mesh.fill', context))
    const again = resultEdit(runOperator('mesh.fill', context, {}))
    expect(again.faceCount).toBe(once.faceCount)
    expect(again.vertexCount).toBe(once.vertexCount)
    expect(again.faceVertices(0)).toEqual(once.faceVertices(0))
  })
})

describe('mesh.beautyFill', () => {
  it('closes a hexagonal rim with four triangles, none of them a splinter', () => {
    const mesh = circleMesh({ vertices: 6, fill: 'none' })
    const result = runOperator('mesh.beautyFill', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(6)
    expect(after.faceCount).toBe(4)
    expect(after.edgeCount).toBe(9)
    expect(everyFaceHas(after, 3)).toBe(true)
    expect(isWellFormed(after)).toBe(true)
    // The best a regular hexagon allows is 30°; a plain ear-clipped fan leaves corners under 20°.
    expect(narrowestCorner(after)).toBeGreaterThan(25)
    expect(resultSelection(result).faces.length).toBe(4)
  })

  it('refuses when nothing selected can carry a face', () => {
    const mesh = boxMesh(2)
    const result = runOperator('mesh.beautyFill', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    expect(result.error).toBe('Select a rim of edges to close, or two vertices to join.')
  })

  it('replays to the same triangles when the panel runs it again', () => {
    const mesh = circleMesh({ vertices: 8, fill: 'none' })
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const once = resultEdit(runOperator('mesh.beautyFill', context))
    const again = resultEdit(runOperator('mesh.beautyFill', context, {}))
    expect(again.faceCount).toBe(once.faceCount)
    expect(again.edgeCount).toBe(once.edgeCount)
    expect(narrowestCorner(again)).toBeCloseTo(narrowestCorner(once), 9)
  })
})

describe('mesh.gridFill', () => {
  it('lays a grid of quads inside one rim, with its middle vertex at the centre', () => {
    const mesh = circleMesh({ vertices: 8, fill: 'none' })
    const result = runOperator('mesh.gridFill', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(9)
    expect(after.edgeCount).toBe(12)
    expect(after.faceCount).toBe(4)
    expect(everyFaceHas(after, 4)).toBe(true)
    expect(isWellFormed(after)).toBe(true)
    expect(euler(after)).toBe(1)
    const middle = after.position(8)
    expect(middle[0]).toBeCloseTo(0, 9)
    expect(middle[1]).toBeCloseTo(0, 9)
    expect(middle[2]).toBeCloseTo(0, 9)
  })

  it('lays four quads across two rims of four edges and closes the box', () => {
    // Only the lid and the floor are left, so the two rims have nothing joining them yet.
    const mesh = withoutFaces(boxMesh(2), [2, 3, 4, 5])
    const result = runOperator('mesh.gridFill', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    const after = resultEdit(result)
    expect(after.faceCount).toBe(6)
    expect(after.vertexCount).toBe(8)
    expect(after.edgeCount).toBe(12)
    expect(everyFaceHas(after, 4)).toBe(true)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(isWellFormed(after)).toBe(true)
    expect(meshVolume(after)).toBeCloseTo(8, 9)
    expect(resultSelection(result).faces.length).toBe(4)
  })

  it('refuses a rim with an odd number of edges', () => {
    const mesh = circleMesh({ vertices: 5, fill: 'none' })
    const result = runOperator('mesh.gridFill', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    expect(result.error).toBe('This rim has an odd number of edges; grid fill needs an even one.')
  })

  it('replays with another span, and lays the grid the new span asks for', () => {
    const mesh = circleMesh({ vertices: 8, fill: 'none' })
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const after = resultEdit(runOperator('mesh.gridFill', context, { span: 1 }))
    expect(after.faceCount).toBe(3)
    expect(after.vertexCount).toBe(8)
    expect(after.edgeCount).toBe(10)
    expect(everyFaceHas(after, 4)).toBe(true)
    expect(isWellFormed(after)).toBe(true)
  })

  it('blends the middle of a bent rim more flatly when simple blending is on', () => {
    const mesh = circleMesh({ vertices: 8, fill: 'none' })
    const raised = EditMesh.from(mesh)
    raised.setPosition(1, [raised.position(1)[0], raised.position(1)[1], 1])
    raised.setPosition(3, [raised.position(3)[0], raised.position(3)[1], 1])
    const context = editContext({ mesh: raised.toData(), vertices: allIds(mesh, 'vertex') })
    const coons = resultEdit(runOperator('mesh.gridFill', context))
    const simple = resultEdit(runOperator('mesh.gridFill', context, { simpleBlending: true }))
    expect(coons.position(8)[2]).not.toBeCloseTo(simple.position(8)[2], 6)
  })
})

describe('mesh.fillHoles', () => {
  it('closes the hole a missing face left, and the box with it', () => {
    const mesh = withoutFaces(boxMesh(2), [1])
    const result = runOperator('mesh.fillHoles', editContext({ mesh }))
    const after = resultEdit(result)
    expect(after.faceCount).toBe(6)
    expect(after.vertexCount).toBe(8)
    expect(after.edgeCount).toBe(12)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(isWellFormed(after)).toBe(true)
    expect(meshVolume(after)).toBeCloseTo(8, 9)
    const face = after.slotOfFace(6)
    expect(dot(after.faceNormal(face), after.faceCentre(face))).toBeGreaterThan(0)
  })

  it('refuses a mesh with no holes in it', () => {
    expect(runOperator('mesh.fillHoles', editContext({ mesh: boxMesh(2) })).error)
      .toBe('There are no holes in this mesh.')
  })

  it('replays with fewer sides allowed, and leaves the hole open', () => {
    const mesh = withoutFaces(boxMesh(2), [1])
    const context = editContext({ mesh })
    expect(runOperator('mesh.fillHoles', context, { sides: 3 }).error)
      .toBe('Every hole here has more sides than the limit allows.')
    expect(resultEdit(runOperator('mesh.fillHoles', context, { sides: 0 })).faceCount).toBe(6)
  })
})
