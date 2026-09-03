import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { circleMesh, cylinderMesh, planeMesh } from '@/scene/mesh/primitives'
import '@/scene/operators/bridge'
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
import { runOperator } from '@/scene/operators/registry'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * A cylinder open along its side rather than at its ends: the two caps, and no side faces at all.
 *
 * Bridging the two rims of a cap-less tube cannot close anything — those rims are already joined by
 * the tube's own band, and a bridge would lay a second one over it and leave every upright edge
 * with four faces. Open along the side is the shape the operator is actually for.
 */
function openSidedCylinder(vertices: number): MeshData {
  const edit = EditMesh.from(cylinderMesh({ vertices, fill: 'ngon' }))
  edit.remove({ faces: Array.from({ length: vertices }, (_, side) => side) })
  // The uprights the side faces were hanging on are left behind by the removal, and a rim with wire
  // still attached is not the mesh this test is about.
  edit.dropLoose()
  return edit.toData()
}

/** Two meshes side by side in one, which is how a test gets four rims to pair up. */
function sideBySide(one: MeshData, other: MeshData, offset: Vec3): MeshData {
  const edit = EditMesh.from(one)
  const source = EditMesh.from(other)
  const moved = new Map<number, number>()
  for (let slot = 0; slot < source.vertexCount; slot += 1) {
    const point = source.position(slot)
    moved.set(slot, edit.addVertex([point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]]))
  }
  for (let edge = 0; edge < source.edgeCount; edge += 1) {
    const [a, b] = source.edgeVertices(edge)
    edit.addEdge(moved.get(a)!, moved.get(b)!)
  }
  for (let face = 0; face < source.faceCount; face += 1) {
    edit.addFace(source.faceVertices(face).map((slot) => moved.get(slot)!))
  }
  return edit.toData()
}

function everyFaceHas(mesh: EditMesh, corners: number): boolean {
  for (let face = 0; face < mesh.faceCount; face += 1) if (mesh.faceVertices(face).length !== corners) return false
  return true
}

/** The corners of the band face on a rim edge: the one that reaches across to the other rim. */
function faceAcross(mesh: EditMesh, one: number, other: number): number[] {
  const edge = mesh.edgeSlot(one, other)
  for (const face of mesh.edgeFaces(edge)) {
    const loop = mesh.faceVertices(face)
    if (loop.some((slot) => mesh.position(slot)[2] > 0)) return loop
  }
  return []
}

describe('mesh.bridgeEdgeLoops', () => {
  it('closes an open-sided cylinder with a band of quads', () => {
    const mesh = openSidedCylinder(4)
    const result = runOperator('mesh.bridgeEdgeLoops', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(8)
    expect(after.edgeCount).toBe(12)
    expect(after.faceCount).toBe(6)
    expect(everyFaceHas(after, 4)).toBe(true)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(isWellFormed(after)).toBe(true)
    // A four-sided cylinder of radius 1 is a square prism: a base of area 2, two metres deep.
    expect(meshVolume(after)).toBeCloseTo(4, 9)
    expect(resultSelection(result).faces.length).toBe(4)
  })

  it('replays with two cuts, and lays three bands with their rings evenly spaced', () => {
    const mesh = openSidedCylinder(4)
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const after = resultEdit(runOperator('mesh.bridgeEdgeLoops', context, { cuts: 2 }))
    expect(after.vertexCount).toBe(16)
    expect(after.edgeCount).toBe(28)
    expect(after.faceCount).toBe(14)
    expect(everyFaceHas(after, 4)).toBe(true)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(isWellFormed(after)).toBe(true)
    // The rims face straight at each other, so at smoothness 1 the rings stay on the line between
    // them: a third and two thirds of the way up, above the rim vertex each one belongs to.
    const rim = after.position(0)
    const first = after.position(8)
    const second = after.position(12)
    expect(first[0]).toBeCloseTo(rim[0], 9)
    expect(first[1]).toBeCloseTo(rim[1], 9)
    expect(first[2]).toBeCloseTo(-1 / 3, 9)
    expect(second[2]).toBeCloseTo(1 / 3, 9)
  })

  it('shears the band by one vertex when it is twisted', () => {
    const mesh = openSidedCylinder(4)
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const straight = resultEdit(runOperator('mesh.bridgeEdgeLoops', context))
    const twisted = resultEdit(runOperator('mesh.bridgeEdgeLoops', context, { twist: 1 }))
    expect(faceAcross(straight, 0, 1).slice().sort()).toEqual([0, 1, 4, 5])
    expect(faceAcross(twisted, 0, 1).slice().sort()).toEqual([0, 1, 4, 7])
    expect(isClosed(twisted)).toBe(true)
    expect(euler(twisted)).toBe(2)
    expect(isWellFormed(twisted)).toBe(true)
  })

  it('swells the band away from its axis when the profile is raised', () => {
    const mesh = openSidedCylinder(4)
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const straight = resultEdit(runOperator('mesh.bridgeEdgeLoops', context, { cuts: 1 }))
    const swollen = resultEdit(runOperator('mesh.bridgeEdgeLoops', context, { cuts: 1, profile: 0.5 }))
    const flat = Math.hypot(straight.position(8)[0], straight.position(8)[1])
    const round = Math.hypot(swollen.position(8)[0], swollen.position(8)[1])
    expect(flat).toBeCloseTo(1, 9)
    expect(round).toBeCloseTo(1.5, 9)
  })

  it('pairs four rims off by proximity when loop pairs is on', () => {
    const shell = openSidedCylinder(4)
    const mesh = sideBySide(shell, shell, [6, 0, 0])
    const result = runOperator(
      'mesh.bridgeEdgeLoops',
      editContext({ mesh, vertices: allIds(mesh, 'vertex') }),
      { loopPairs: true },
    )
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(16)
    expect(after.faceCount).toBe(12)
    expect(isClosed(after)).toBe(true)
    // Two closed shells rather than one: Euler counts them both.
    expect(euler(after)).toBe(4)
    expect(isWellFormed(after)).toBe(true)
  })

  it('refuses more than two rims until loop pairs is on', () => {
    const shell = openSidedCylinder(4)
    const mesh = sideBySide(shell, shell, [6, 0, 0])
    const result = runOperator('mesh.bridgeEdgeLoops', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    expect(result.error).toBe('More than two rims are selected; turn Loop pairs on to bridge them in pairs.')
  })

  it('refuses a selection with fewer than two rims', () => {
    const mesh = cylinderMesh({ vertices: 6, fill: 'ngon' })
    const result = runOperator('mesh.bridgeEdgeLoops', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    expect(result.error).toBe('Select two rims of edges to bridge.')
  })

  it('refuses two rims of different lengths', () => {
    const mesh = sideBySide(circleMesh({ vertices: 4, fill: 'none' }), circleMesh({ vertices: 6, fill: 'none' }), [0, 0, 2])
    const result = runOperator('mesh.bridgeEdgeLoops', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    expect(result.error).toBe('The two rims must have the same number of edges.')
  })
})

describe('mesh.weldEdges', () => {
  it('cuts a quad in two along the loose edge that crosses it', () => {
    const edit = EditMesh.from(planeMesh(2))
    edit.addEdge(0, 2)
    const mesh = edit.toData()
    const result = runOperator('mesh.weldEdges', editContext({ mesh, vertices: [0, 2] }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(4)
    expect(after.edgeCount).toBe(5)
    expect(after.faceCount).toBe(2)
    expect(after.faceVertices(0).length).toBe(3)
    expect(after.faceVertices(1).length).toBe(3)
    expect(isWellFormed(after)).toBe(true)
    expect(after.edgeFaces(after.edgeSlot(0, 2)).length).toBe(2)
    expect(resultSelection(result).faces.length).toBe(2)
  })

  it('refuses when nothing loose is selected', () => {
    const mesh = planeMesh(2)
    const result = runOperator('mesh.weldEdges', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    expect(result.error).toBe('Select loose edges that run across a face.')
  })

  it('refuses loose edges that cross no face', () => {
    const mesh = circleMesh({ vertices: 4, fill: 'none' })
    const result = runOperator('mesh.weldEdges', editContext({ mesh, vertices: allIds(mesh, 'vertex') }))
    expect(result.error).toBe('None of the selected loose edges runs across a face.')
  })

  it('replays to the same two triangles when the panel runs it again', () => {
    const edit = EditMesh.from(planeMesh(2))
    edit.addEdge(1, 3)
    const context = editContext({ mesh: edit.toData(), vertices: [1, 3] })
    const once = resultEdit(runOperator('mesh.weldEdges', context))
    const again = resultEdit(runOperator('mesh.weldEdges', context, {}))
    expect(again.faceCount).toBe(once.faceCount)
    expect(again.faceVertices(0)).toEqual(once.faceVertices(0))
    expect(again.faceVertices(1)).toEqual(once.faceVertices(1))
  })
})
