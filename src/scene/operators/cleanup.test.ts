import { describe, expect, it } from 'vitest'
import { cross, dot, subtract } from '@/scene/mesh/normals'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, gridMesh, icoSphereMesh, planeMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import '@/scene/operators/cleanup'
import { editContext, euler, isClosed, isWellFormed, resultEdit } from '@/scene/operators/editHarness'
import { runOperator } from '@/scene/operators/registry'
import type { MeshData, Vec3 } from '@/scene/types'

/** A mesh with some of its vertices moved, which is how a test bends or ruins a face. */
function moved(mesh: MeshData, places: Array<[number, Vec3]>): MeshData {
  const edit = EditMesh.from(mesh)
  for (const [slot, point] of places) edit.setPosition(slot, point)
  return edit.toData()
}

/** How far a face is from flat: six times the volume its corners span, which is zero when planar. */
function outOfPlane(mesh: EditMesh, face: number): number {
  const loop = mesh.faceVertices(face)
  const origin = mesh.position(loop[0]!)
  const one = subtract(mesh.position(loop[1]!), origin)
  const other = subtract(mesh.position(loop[2]!), origin)
  let widest = 0
  for (let index = 3; index < loop.length; index += 1) {
    widest = Math.max(widest, Math.abs(dot(subtract(mesh.position(loop[index]!), origin), cross(one, other))))
  }
  return widest
}

function everyFaceHas(mesh: EditMesh, corners: number): boolean {
  for (let face = 0; face < mesh.faceCount; face += 1) if (mesh.faceVertices(face).length !== corners) return false
  return true
}

/** How many vertices sit each side of the plane the symmetry option works across. */
function sides(mesh: EditMesh): [number, number] {
  let left = 0
  let right = 0
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const x = mesh.position(slot)[0]
    if (x > 1e-6) right += 1
    if (x < -1e-6) left += 1
  }
  return [left, right]
}

/** A plane with a loose vertex and a loose edge beside it. */
function withLooseParts(): MeshData {
  const edit = EditMesh.from(planeMesh(2))
  edit.addVertex([3, 0, 0])
  const one = edit.addVertex([4, 0, 0])
  const other = edit.addVertex([5, 0, 0])
  edit.addEdge(one, other)
  return edit.toData()
}

describe('mesh.deleteLoose', () => {
  it('takes away a loose vertex and a loose edge with its ends', () => {
    const result = runOperator('mesh.deleteLoose', editContext({ mesh: withLooseParts() }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(4)
    expect(after.edgeCount).toBe(4)
    expect(after.faceCount).toBe(1)
    expect(isWellFormed(after)).toBe(true)
  })

  it('replays with vertices left alone, and keeps the ends of the loose edge', () => {
    const context = editContext({ mesh: withLooseParts() })
    const after = resultEdit(runOperator('mesh.deleteLoose', context, { vertices: false }))
    expect(after.vertexCount).toBe(7)
    expect(after.edgeCount).toBe(4)
    expect(after.faceCount).toBe(1)
  })

  it('takes a face nothing is attached to, and everything it was holding up', () => {
    const after = resultEdit(runOperator('mesh.deleteLoose', editContext({ mesh: planeMesh(2) }), { faces: true }))
    expect(after.faceCount).toBe(0)
    expect(after.edgeCount).toBe(0)
    expect(after.vertexCount).toBe(0)
  })

  it('refuses a mesh with nothing loose in it', () => {
    expect(runOperator('mesh.deleteLoose', editContext({ mesh: boxMesh(2) })).error)
      .toBe('There is no loose geometry here.')
  })
})

describe('mesh.decimate', () => {
  it('halves the triangles of a sphere and leaves it closed', () => {
    const mesh = uvSphereMesh({ segments: 16, rings: 8 })
    const before = EditMesh.from(mesh)
    const result = runOperator('mesh.decimate', editContext({ mesh }))
    const after = resultEdit(result)
    // The sphere is cut into 224 triangles first, so half of it is 112. The assertion is a range
    // rather than that number: a collapse that would fold the surface onto itself or turn a
    // neighbour inside out is refused, and how many of those come up depends on the order the
    // quadrics happen to put the edges in.
    expect(before.faceCount).toBe(128)
    expect(after.faceCount).toBeGreaterThan(100)
    expect(after.faceCount).toBeLessThan(125)
    expect(everyFaceHas(after, 3)).toBe(true)
    expect(isClosed(after)).toBe(true)
    expect(euler(after)).toBe(2)
    expect(isWellFormed(after)).toBe(true)
    // Every survivor is still on the sphere, or just inside it: a collapse lands on the midpoint of
    // the edge it pulled together, which is a chord, so nothing is ever pushed out.
    for (let slot = 0; slot < after.vertexCount; slot += 1) {
      const radius = Math.hypot(...after.position(slot))
      expect(radius).toBeGreaterThan(0.85)
      expect(radius).toBeLessThan(1.0000001)
    }
  })

  it('replays at a quarter, and takes more away than a half did', () => {
    const context = editContext({ mesh: uvSphereMesh({ segments: 16, rings: 8 }) })
    const half = resultEdit(runOperator('mesh.decimate', context, { ratio: 0.5 }))
    const quarter = resultEdit(runOperator('mesh.decimate', context, { ratio: 0.25 }))
    expect(quarter.faceCount).toBeLessThan(half.faceCount)
    expect(isClosed(quarter)).toBe(true)
    expect(isWellFormed(quarter)).toBe(true)
  })

  it('keeps the two halves matched when symmetry is on', () => {
    const context = editContext({ mesh: uvSphereMesh({ segments: 16, rings: 8 }) })
    const after = resultEdit(runOperator('mesh.decimate', context, { symmetry: true }))
    const [left, right] = sides(after)
    expect(left).toBe(right)
    expect(left).toBeGreaterThan(0)
    expect(after.faceCount).toBeLessThan(224)
    expect(isClosed(after)).toBe(true)
    expect(isWellFormed(after)).toBe(true)
  })

  it('collapses a mesh that is triangles already without triangulating it first', () => {
    const context = editContext({ mesh: icoSphereMesh({ subdivisions: 2 }) })
    const after = resultEdit(runOperator('mesh.decimate', context, { triangulate: false }))
    expect(after.faceCount).toBeLessThan(80)
    expect(after.faceCount).toBeGreaterThan(30)
    expect(isClosed(after)).toBe(true)
    expect(isWellFormed(after)).toBe(true)
  })

  it('refuses a mesh of quads when it is told not to triangulate', () => {
    const context = editContext({ mesh: boxMesh(2) })
    expect(runOperator('mesh.decimate', context, { triangulate: false }).error)
      .toBe('None of these edges can be collapsed without tearing the mesh.')
  })

  it('refuses a ratio that asks for the mesh it was given', () => {
    const context = editContext({ mesh: icoSphereMesh({ subdivisions: 2 }) })
    expect(runOperator('mesh.decimate', context, { ratio: 1 }).error)
      .toBe('Set a ratio below 1 for decimate to have anything to collapse.')
  })
})

describe('mesh.degenerateDissolve', () => {
  it('pulls an edge with no length to a point and leaves triangles where quads were', () => {
    const grid = gridMesh({ xSubdivisions: 3, ySubdivisions: 3 })
    const corner = EditMesh.from(grid).position(1)
    const result = runOperator('mesh.degenerateDissolve', editContext({ mesh: moved(grid, [[4, corner]]) }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(8)
    expect(after.edgeCount).toBe(11)
    expect(after.faceCount).toBe(4)
    expect(isWellFormed(after)).toBe(true)
    const survivor = after.slotOfVertex(1)
    expect(after.position(survivor)[0]).toBeCloseTo(corner[0], 12)
    expect(after.position(survivor)[1]).toBeCloseTo(corner[1], 12)
  })

  it('takes away a face with no area and leaves its edges behind', () => {
    const flat = moved(planeMesh(2), [[0, [-1, 0, 0]], [1, [1, 0, 0]], [2, [2, 0, 0]], [3, [0, 0, 0]]])
    const after = resultEdit(runOperator('mesh.degenerateDissolve', editContext({ mesh: flat })))
    expect(after.faceCount).toBe(0)
    expect(after.vertexCount).toBe(4)
    expect(after.edgeCount).toBe(4)
  })

  it('refuses a mesh with nothing degenerate in it', () => {
    expect(runOperator('mesh.degenerateDissolve', editContext({ mesh: boxMesh(2) })).error)
      .toBe('Nothing here is degenerate at that threshold.')
  })

  it('replays with a threshold wide enough to swallow the whole grid', () => {
    const context = editContext({ mesh: gridMesh({ xSubdivisions: 3, ySubdivisions: 3 }) })
    const after = resultEdit(runOperator('mesh.degenerateDissolve', context, { threshold: 1.5 }))
    expect(after.vertexCount).toBeLessThan(9)
    expect(isWellFormed(after)).toBe(true)
  })
})

describe('mesh.makePlanar', () => {
  it('flattens a bent quad onto one plane', () => {
    const bent = moved(planeMesh(2), [[3, [-1, 1, 0.5]]])
    const before = EditMesh.from(bent)
    expect(outOfPlane(before, 0)).toBeGreaterThan(1)
    const after = resultEdit(runOperator('mesh.makePlanar', editContext({ mesh: bent })))
    expect(after.vertexCount).toBe(4)
    expect(after.faceCount).toBe(1)
    expect(outOfPlane(after, 0)).toBeLessThan(1e-9)
    // The lifted corner came most of the way down, and the three others rose to meet it.
    expect(after.position(3)[2]).toBeLessThan(0.5)
    expect(after.position(3)[2]).toBeGreaterThan(0)
    expect(isWellFormed(after)).toBe(true)
  })

  it('replays at half strength, and leaves the quad half as bent', () => {
    const bent = moved(planeMesh(2), [[3, [-1, 1, 0.5]]])
    const context = editContext({ mesh: bent })
    const gentle = resultEdit(runOperator('mesh.makePlanar', context, { factor: 0.5 }))
    expect(outOfPlane(gentle, 0)).toBeGreaterThan(1e-9)
    expect(outOfPlane(gentle, 0)).toBeLessThan(outOfPlane(EditMesh.from(bent), 0))
  })

  it('refuses a mesh with nothing but triangles in it', () => {
    expect(runOperator('mesh.makePlanar', editContext({ mesh: icoSphereMesh({ subdivisions: 1 }) })).error)
      .toBe('No face here has more than three corners, so they are planar already.')
  })
})

describe('mesh.splitNonPlanar', () => {
  it('cuts a bent quad into two triangles', () => {
    const bent = moved(planeMesh(2), [[3, [-1, 1, 0.5]]])
    const result = runOperator('mesh.splitNonPlanar', editContext({ mesh: bent }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(4)
    expect(after.edgeCount).toBe(5)
    expect(after.faceCount).toBe(2)
    expect(everyFaceHas(after, 3)).toBe(true)
    expect(isWellFormed(after)).toBe(true)
  })

  it('refuses a mesh whose faces are flat', () => {
    expect(runOperator('mesh.splitNonPlanar', editContext({ mesh: boxMesh(2) })).error)
      .toBe('Every face here is flat enough to leave alone.')
  })

  it('replays with a wider angle, and leaves the bent quad whole', () => {
    const context = editContext({ mesh: moved(planeMesh(2), [[3, [-1, 1, 0.5]]]) })
    expect(runOperator('mesh.splitNonPlanar', context, { angle: 90 }).error)
      .toBe('Every face here is flat enough to leave alone.')
  })
})

describe('mesh.splitConcave', () => {
  it('cuts a quad that turns back on itself into two triangles', () => {
    const dented = moved(planeMesh(2), [[2, [-0.2, -0.2, 0]]])
    const result = runOperator('mesh.splitConcave', editContext({ mesh: dented }))
    const after = resultEdit(result)
    expect(after.vertexCount).toBe(4)
    expect(after.edgeCount).toBe(5)
    expect(after.faceCount).toBe(2)
    expect(everyFaceHas(after, 3)).toBe(true)
    expect(isWellFormed(after)).toBe(true)
  })

  it('refuses a mesh whose faces are convex', () => {
    expect(runOperator('mesh.splitConcave', editContext({ mesh: boxMesh(2) })).error)
      .toBe('Every face here is convex already.')
  })

  it('replays to nothing left to cut once the face has been split', () => {
    const dented = moved(planeMesh(2), [[2, [-0.2, -0.2, 0]]])
    const context = editContext({ mesh: dented })
    const once = runOperator('mesh.splitConcave', context)
    const twice = runOperator('mesh.splitConcave', { ...context, document: once.document! })
    expect(twice.error).toBe('Every face here is convex already.')
  })
})
