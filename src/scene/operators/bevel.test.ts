import { describe, expect, it } from 'vitest'
import { edgeKey } from '@/scene/mesh/data'
import type { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, gridMesh, planeMesh } from '@/scene/mesh/primitives'
import { allEdgeKeys, editContext, euler, isClosed, isWellFormed, resultEdit, resultSelection } from '@/scene/operators/editHarness'
import '@/scene/operators/bevel'
import { runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
import type { EdgeKey, MeshData, Vec3 } from '@/scene/types'

/*
 * `boxMesh(2)` is the cube from (−1, −1, −1) to (1, 1, 1); its vertex ids are its slots, so 5 is
 * (1, −1, 1) and 6 is (1, 1, 1), and the edge between them is the one where the top meets +X. That
 * edge is what every single-edge case below bevels, because all three of its faces are ordinary.
 */

const TOP_RIGHT: EdgeKey = edgeKey(5, 6)

function edgeContext(edges: EdgeKey[], mesh: MeshData = boxMesh(2)): OperatorContext {
  return editContext({ mesh, edges, selectMode: ['edge'] })
}

function bevelEdges(edges: EdgeKey[], params: Partial<OperatorParams> = {}, mesh?: MeshData): OperatorResult {
  return runOperator('mesh.bevelEdges', edgeContext(edges, mesh), params)
}

function bevelVertices(vertices: number[], params: Partial<OperatorParams> = {}, mesh: MeshData = boxMesh(2)): OperatorResult {
  return runOperator('mesh.bevelVertices', editContext({ mesh, vertices, selectMode: ['vertex'] }), params)
}

/** How many faces have each number of corners, which is what says quad, triangle or n-gon. */
function shapes(mesh: EditMesh): Map<number, number> {
  const counts = new Map<number, number>()
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const corners = mesh.faceVertices(face).length
    counts.set(corners, (counts.get(corners) ?? 0) + 1)
  }
  return counts
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

describe('bevelling one edge', () => {
  it('opens the edge into a strip and leaves the cube closed', () => {
    const result = bevelEdges([TOP_RIGHT], { width: 0.5 })
    const mesh = resultEdit(result)
    // The two corners become two points each; the face across from the edge takes both, so it is a
    // pentagon, and only the strip itself is a new face.
    expect(mesh.vertexCount).toBe(10)
    expect(mesh.edgeCount).toBe(15)
    expect(mesh.faceCount).toBe(7)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(shapes(mesh).get(5)).toBe(2)
    expect(resultSelection(result).faces).toHaveLength(1)
  })

  it('puts the new corners the width away from the edge, on each of its faces', () => {
    const mesh = resultEdit(bevelEdges([TOP_RIGHT], { width: 0.5 }))
    expect(hasPoint(mesh, [0.5, -1, 1])).toBe(true)
    expect(hasPoint(mesh, [1, -1, 0.5])).toBe(true)
    expect(hasPoint(mesh, [0.5, 1, 1])).toBe(true)
    expect(hasPoint(mesh, [1, 1, 0.5])).toBe(true)
    expect(hasPoint(mesh, [1, -1, 1])).toBe(false)
  })

  it('holds the width at half the edge when clamp overlap is on', () => {
    const clamped = resultEdit(bevelEdges([TOP_RIGHT], { width: 5 }))
    expect(hasPoint(clamped, [0, -1, 1])).toBe(true)
    expect(hasPoint(clamped, [1, -1, 0])).toBe(true)
    expect(isClosed(clamped)).toBe(true)

    const loose = resultEdit(bevelEdges([TOP_RIGHT], { width: 5, clampOverlap: false }))
    expect(hasPoint(loose, [-4, -1, 1])).toBe(true)
  })

  it('turns the width into an offset when the width type asks for the chamfer itself', () => {
    // The faces of a cube meet at a right angle, so a chamfer √2 wide is one metre of offset.
    const mesh = resultEdit(bevelEdges([TOP_RIGHT], { width: Math.SQRT2, offsetType: 'width', clampOverlap: false }))
    expect(hasPoint(mesh, [0, -1, 1])).toBe(true)
    expect(hasPoint(mesh, [1, -1, 0])).toBe(true)
  })

  it('marks the sides of the strip when it is asked to, and takes the material it is given', () => {
    const result = bevelEdges([TOP_RIGHT], { width: 0.5, markSeam: true, markSharp: true, material: 3 })
    const mesh = resultEdit(result)
    const seams: number[] = []
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) if (mesh.edgeFlag(edge, 'seam')) seams.push(edge)
    expect(seams).toHaveLength(2)
    for (const edge of seams) expect(mesh.edgeFlag(edge, 'sharp')).toBe(true)
    for (const face of resultSelection(result).faces) expect(mesh.faceMaterial(mesh.slotOfFace(face))).toBe(3)
  })
})

describe('bevelling every edge of a cube', () => {
  it('leaves six faces, twelve strips and eight corners at one segment', () => {
    const result = bevelEdges(allEdgeKeys(boxMesh(2)), { width: 0.4 })
    const mesh = resultEdit(result)
    expect(mesh.faceCount).toBe(26)
    expect(mesh.vertexCount).toBe(24)
    expect(mesh.edgeCount).toBe(48)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(shapes(mesh).get(3)).toBe(8)
    expect(shapes(mesh).get(4)).toBe(18)
    expect(resultSelection(result).faces).toHaveLength(20)
  })

  it('quarters every corner into a grid at two segments', () => {
    const mesh = resultEdit(bevelEdges(allEdgeKeys(boxMesh(2)), { width: 0.4, segments: 2 }))
    // Six faces, two quads to a strip and three to a corner, and nothing left that is not a quad.
    expect(mesh.faceCount).toBe(54)
    expect(mesh.vertexCount).toBe(56)
    expect(mesh.edgeCount).toBe(108)
    expect(shapes(mesh).get(4)).toBe(54)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('bevels two edges meeting at one corner without tearing the mesh', () => {
    const mesh = resultEdit(bevelEdges([edgeKey(5, 6), edgeKey(6, 7)], { width: 0.4 }))
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })
})

describe('the profile', () => {
  it('lays the middle of a two-segment chamfer flat when the profile is one', () => {
    const mesh = resultEdit(bevelEdges([TOP_RIGHT], { width: 0.5, segments: 2, profile: 1 }))
    // Halfway along a flat chamfer is halfway between its ends, which the round profile is not.
    expect(hasPoint(mesh, [0.75, -1, 0.75])).toBe(true)
    expect(hasPoint(mesh, [0.75, 1, 0.75])).toBe(true)
  })

  it('bulges towards the corner it cut off when the profile is a circular arc', () => {
    const mesh = resultEdit(bevelEdges([TOP_RIGHT], { width: 0.5, segments: 2, profile: 0.5 }))
    const round = 0.5 + 0.5 * Math.SQRT1_2
    expect(hasPoint(mesh, [round, -1, round])).toBe(true)
    expect(hasPoint(mesh, [0.75, -1, 0.75])).toBe(false)
  })
})

describe('a bevel that runs out', () => {
  it('keeps the vertex and caps it with a triangle where only one edge is bevelled', () => {
    // Four quads by four vertices a side: the edge from 5 to 6 is the one whose ends are both
    // four-valence, so the bevel has to stop at each of them.
    const grid = gridMesh({ xSubdivisions: 4, ySubdivisions: 4, size: 3 })
    const mesh = resultEdit(bevelEdges([edgeKey(5, 6)], { width: 0.2 }, grid))
    expect(mesh.vertexCount).toBe(20)
    expect(mesh.edgeCount).toBe(31)
    expect(mesh.faceCount).toBe(12)
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
    expect(shapes(mesh).get(3)).toBe(2)
    expect(shapes(mesh).get(5)).toBe(4)
  })
})

describe('bevelling vertices', () => {
  it('cuts every corner of a cube into a triangle and leaves the faces octagons', () => {
    const result = bevelVertices([0, 1, 2, 3, 4, 5, 6, 7], { width: 0.5 })
    const mesh = resultEdit(result)
    expect(mesh.faceCount).toBe(14)
    expect(mesh.vertexCount).toBe(24)
    expect(mesh.edgeCount).toBe(36)
    expect(shapes(mesh).get(3)).toBe(8)
    expect(shapes(mesh).get(8)).toBe(6)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(resultSelection(result).faces).toHaveLength(8)
  })

  it('cuts one corner and leaves the rest of the cube alone', () => {
    const mesh = resultEdit(bevelVertices([6], { width: 0.5 }))
    expect(mesh.faceCount).toBe(7)
    expect(mesh.vertexCount).toBe(10)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(hasPoint(mesh, [0.5, 1, 1])).toBe(true)
    expect(hasPoint(mesh, [1, 0.5, 1])).toBe(true)
    expect(hasPoint(mesh, [1, 1, 0.5])).toBe(true)
    expect(hasPoint(mesh, [1, 1, 1])).toBe(false)
  })
})

describe('what a bevel refuses', () => {
  it('names the edge it cannot open when it has only one face', () => {
    const result = bevelEdges([edgeKey(0, 1)], { width: 0.2 }, planeMesh(2))
    expect(result.error).toBe(
      'Deselect the edge between vertices 0 and 1: a bevel needs every edge it opens to have a face on each side.',
    )
    expect(result.document).toBeUndefined()
  })

  it('names the corner it cannot open when the faces there leave a rim', () => {
    const result = bevelVertices([0], { width: 0.2 }, planeMesh(2))
    expect(result.error).toBe(
      'Deselect vertex 0: a bevel rounds a corner off, and the faces there do not close a ring around it.',
    )
  })

  it('says so when nothing is selected', () => {
    const empty = editContext({ mesh: boxMesh(2), selectMode: ['edge'] })
    expect(runOperator('mesh.bevelEdges', empty, { width: 0.2 }).error).toBe('No edges are selected.')
    expect(runOperator('mesh.bevelVertices', empty, { width: 0.2 }).error).toBe('No vertices are selected.')
  })
})

describe('adjusting the last bevel', () => {
  it('replays the same edges with another segment count', () => {
    const context = edgeContext(allEdgeKeys(boxMesh(2)))
    const once = resultEdit(runOperator('mesh.bevelEdges', context, { width: 0.4, segments: 1 }))
    expect(once.faceCount).toBe(26)

    const twice = resultEdit(runOperator('mesh.bevelEdges', context, { width: 0.4, segments: 2 }))
    expect(twice.faceCount).toBe(54)
    expect(isClosed(twice)).toBe(true)
    expect(euler(twice)).toBe(2)

    // The panel can turn one keystroke's operator into the other's, as Blender's does.
    const corners = resultEdit(runOperator('mesh.bevelEdges', context, { width: 0.5, affect: 'vertices' }))
    expect(corners.faceCount).toBe(14)
  })
})
