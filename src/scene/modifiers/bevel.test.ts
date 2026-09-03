import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh } from '@/scene/mesh/primitives'
import '@/scene/modifiers/bevel'
import { getModifier, type ModifierOutcome } from '@/scene/modifiers/types'
import { euler, isClosed, isWellFormed } from '@/scene/operators/editHarness'
import type { Modifier, Vec3 } from '@/scene/types'

/*
 * The cube from `boxMesh(2)` runs from (−1, −1, −1) to (1, 1, 1) and its vertex ids are its slots,
 * so 5 is (1, −1, 1) and 6 is (1, 1, 1): the edge between them is the one where the top meets +X,
 * and it is the edge every single-edge case below carries a bevel weight on.
 */

const module = getModifier('bevel')!

function bevel(mesh: EditMesh, params: Modifier['params'] = {}): ModifierOutcome {
  return module.apply(mesh, { ...module.defaults, ...params }, { inputs: {}, forRender: false, editing: false })
}

/** Whether some vertex of the mesh sits at this point. */
function hasPoint(mesh: EditMesh, point: Vec3): boolean {
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const here = mesh.position(slot)
    if (Math.abs(here[0] - point[0]) < 1e-9 && Math.abs(here[1] - point[1]) < 1e-9 && Math.abs(here[2] - point[2]) < 1e-9) {
      return true
    }
  }
  return false
}

/** A cube with one edge weighted, which is what the weight limit reads. */
function weightedCube(weight: number): EditMesh {
  const mesh = EditMesh.from(boxMesh(2))
  mesh.setEdgeNumber(mesh.edgeSlot(5, 6), 'bevelWeight', weight)
  return mesh
}

describe('the bevel modifier', () => {
  it('opens every edge of a cube at one segment', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(bevel(mesh, { width: 0.4 })).toBeUndefined()

    // Six faces, twelve strips and eight corner triangles, on three points per original corner.
    expect(mesh.vertexCount).toBe(24)
    expect(mesh.edgeCount).toBe(48)
    expect(mesh.faceCount).toBe(26)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('puts the new corners the width back from the edges they opened', () => {
    const mesh = EditMesh.from(boxMesh(2))

    bevel(mesh, { width: 0.4 })

    // Every edge is open, so each face is pulled in on both of the sides meeting at a corner: the
    // three points the corner (1, 1, 1) became each keep one coordinate on their own face.
    expect(hasPoint(mesh, [0.6, 0.6, 1])).toBe(true)
    expect(hasPoint(mesh, [0.6, 1, 0.6])).toBe(true)
    expect(hasPoint(mesh, [1, 0.6, 0.6])).toBe(true)
    expect(hasPoint(mesh, [1, 1, 1])).toBe(false)
  })

  it('leaves a cube untouched at an angle limit no edge of it reaches', () => {
    const mesh = EditMesh.from(boxMesh(2))

    // A cube folds at 90°, so a limit of 100° picks nothing out — and picking nothing out is not a
    // refusal, it is a mesh that carries on down the stack as it stands.
    expect(bevel(mesh, { width: 0.4, limitMethod: 'angle', angleLimit: 100 })).toBeUndefined()

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(6)
    expect(hasPoint(mesh, [1, 1, 1])).toBe(true)
  })

  it('opens only the weighted edge under the weight limit, and scales the width by the weight', () => {
    const mesh = weightedCube(0.5)

    expect(bevel(mesh, { width: 0.4, limitMethod: 'weight' })).toBeUndefined()

    // One edge of a cube opened: two corners become two points each, and the face across from the
    // edge takes both, so only the strip itself is a new face.
    expect(mesh.vertexCount).toBe(10)
    expect(mesh.edgeCount).toBe(15)
    expect(mesh.faceCount).toBe(7)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    // Half a weight is half the width: 0.4 × 0.5 back from the edge, not 0.4.
    expect(hasPoint(mesh, [0.8, 1, 1])).toBe(true)
    expect(hasPoint(mesh, [1, 1, 0.8])).toBe(true)
    expect(hasPoint(mesh, [0.6, 1, 1])).toBe(false)
  })

  it('quarters every corner into a grid at two segments', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(bevel(mesh, { width: 0.4, segments: 2, limitMethod: 'none' })).toBeUndefined()

    expect(mesh.faceCount).toBe(54)
    expect(mesh.vertexCount).toBe(56)
    expect(mesh.edgeCount).toBe(108)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('carries the material and the marks it is given onto the strips', () => {
    const mesh = weightedCube(1)

    bevel(mesh, { width: 0.4, limitMethod: 'weight', materialIndex: 3, markSeams: true, markSharp: true })

    const strips: number[] = []
    for (let face = 0; face < mesh.faceCount; face += 1) if (mesh.faceMaterial(face) === 3) strips.push(face)
    expect(strips).toHaveLength(1)
    const seams: number[] = []
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) if (mesh.edgeFlag(edge, 'seam')) seams.push(edge)
    expect(seams).toHaveLength(2)
    for (const edge of seams) expect(mesh.edgeFlag(edge, 'sharp')).toBe(true)
  })

  it('refuses a width of nothing, and a mesh with no faces', () => {
    expect(bevel(EditMesh.from(boxMesh(2)), { width: 0 }))
      .toBe('Set a width above zero: a bevel of no width has nothing to open.')
    expect(bevel(EditMesh.from(circleMesh({ vertices: 8, fill: 'none' })), { width: 0.2 }))
      .toBe('Bevel needs faces to open an edge between; this mesh has none.')
  })
})
