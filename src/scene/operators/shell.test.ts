import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh, planeMesh } from '@/scene/mesh/primitives'
import {
  allIds,
  editContext,
  euler,
  isClosed,
  isWellFormed,
  meshVolume,
  resultEdit,
  type EditFixture,
} from '@/scene/operators/editHarness'
import { runOperator } from '@/scene/operators/registry'
import '@/scene/operators/shell'

/**
 * Solidify and Wireframe, both judged by the solid they leave behind.
 *
 * A two-metre plane solidified by a quarter of a metre has to enclose 2 × 2 × 0.25 = 1 m³, and four
 * bars of a square section along a two-metre square enclose four times their own length times the
 * square of their thickness. Both numbers are worked out from the shape in the test rather than
 * copied from a run, so a change that quietly thickens or thins the result fails here.
 */

/** A flat two-metre square with its one face selected: the smallest thing worth solidifying. */
function sheet(): EditFixture {
  const mesh = planeMesh(2)
  return { mesh, faces: allIds(mesh, 'face'), selectMode: ['face'] }
}

/** Where the skin under a corner ended up: the nearest vertex to it that is not the corner itself. */
function inner(mesh: EditMesh, corner: [number, number, number]): [number, number, number] {
  let best: [number, number, number] = [0, 0, 0]
  let nearest = Infinity
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    const away = Math.hypot(point[0] - corner[0], point[1] - corner[1], point[2] - corner[2])
    if (away < 1e-9 || away >= nearest) continue
    nearest = away
    best = [point[0], point[1], point[2]]
  }
  return best
}

describe('mesh.solidify', () => {
  it('turns a plane into a closed box of the thickness asked for', () => {
    const result = runOperator('mesh.solidify', editContext(sheet()), { thickness: 0.25, offset: -1 })
    const mesh = resultEdit(result)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(6)
    expect(meshVolume(mesh)).toBeCloseTo(2 * 2 * 0.25, 10)
  })

  it('hangs the second skin under the first when the offset is −1', () => {
    const mesh = resultEdit(runOperator('mesh.solidify', editContext(sheet()), { thickness: 0.25, offset: -1 }))
    const bounds = mesh.bounds()
    expect(bounds.max[2]).toBeCloseTo(0, 10)
    expect(bounds.min[2]).toBeCloseTo(-0.25, 10)
  })

  it('splits the thickness either side of the surface at an offset of nought', () => {
    const mesh = resultEdit(runOperator('mesh.solidify', editContext(sheet()), { thickness: 0.25, offset: 0 }))
    const bounds = mesh.bounds()
    expect(bounds.max[2]).toBeCloseTo(0.125, 10)
    expect(bounds.min[2]).toBeCloseTo(-0.125, 10)
    expect(meshVolume(mesh)).toBeCloseTo(2 * 2 * 0.25, 10)
  })

  it('keeps its thickness across a fold when even is on, and loses it when it is off', () => {
    const mesh = boxMesh(2)
    // The +X face and the +Y face of the cube: a right-angle fold, and the two vertices along the
    // edge they share get a normal leaning forty-five degrees away from both.
    const fixture: EditFixture = { mesh, faces: [mesh.faceIds[3]!, mesh.faceIds[4]!], selectMode: ['face'] }
    const even = resultEdit(runOperator('mesh.solidify', editContext(fixture), { thickness: 0.2, even: true }))
    const plain = resultEdit(runOperator('mesh.solidify', editContext(fixture), { thickness: 0.2, even: false }))
    // The vertex at the fold, (1, 1, −1), is pushed along (1, 1, 0) ⁄ √2. Evened out it lands a
    // clear two tenths in from each face; left alone it only reaches two tenths along the diagonal.
    const foldEven = inner(even, [1, 1, -1])
    const foldPlain = inner(plain, [1, 1, -1])
    expect(1 - foldEven[0]).toBeCloseTo(0.2, 8)
    expect(1 - foldPlain[0]).toBeCloseTo(0.2 / Math.SQRT2, 8)
  })

  it('replays against the sheet as it was, at whatever thickness the panel says', () => {
    const context = editContext(sheet())
    expect(meshVolume(resultEdit(runOperator('mesh.solidify', context, { thickness: 0.25 })))).toBeCloseTo(1, 10)
    expect(meshVolume(resultEdit(runOperator('mesh.solidify', context, { thickness: 0.5 })))).toBeCloseTo(2, 10)
  })

  it('refuses a thickness of nothing', () => {
    expect(runOperator('mesh.solidify', editContext(sheet()), { thickness: 0 }).error)
      .toBe('A thickness of zero has nothing to build.')
  })

  it('says so when no face is selected', () => {
    expect(runOperator('mesh.solidify', editContext({ mesh: planeMesh(2), selectMode: ['face'] })).error)
      .toBe('No faces are selected.')
  })
})

describe('mesh.wireframe', () => {
  it('turns a plane’s four edges into four closed bars', () => {
    const result = runOperator('mesh.wireframe', editContext(sheet()), { thickness: 0.1 })
    const mesh = resultEdit(result)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    // Four boxes: eight vertices, twelve edges and six faces each, and Euler two apiece.
    expect(mesh.vertexCount).toBe(32)
    expect(mesh.edgeCount).toBe(48)
    expect(mesh.faceCount).toBe(24)
    expect(euler(mesh)).toBe(8)
    expect(mesh.looseParts()).toHaveLength(4)
    // Each bar is two metres less a setback of half the thickness at each end, by a tenth square.
    expect(meshVolume(mesh)).toBeCloseTo(4 * (2 - 0.1) * 0.1 * 0.1, 10)
  })

  it('keeps the sheet when it is told not to replace it', () => {
    const mesh = resultEdit(runOperator('mesh.wireframe', editContext(sheet()), { thickness: 0.1, replace: false }))
    expect(isWellFormed(mesh)).toBe(true)
    expect(mesh.faceCount).toBe(25)
    expect(mesh.vertexCount).toBe(36)
    expect(mesh.looseParts()).toHaveLength(5)
  })

  it('sets the bars back further at a sharper corner when even is on', () => {
    const mesh = circleMesh({ vertices: 3, radius: 1 })
    const fixture: EditFixture = { mesh, vertices: allIds(mesh, 'vertex'), selectMode: ['vertex'] }
    const side = Math.sqrt(3)
    const even = resultEdit(runOperator('mesh.wireframe', editContext(fixture), { thickness: 0.1, even: true }))
    const plain = resultEdit(runOperator('mesh.wireframe', editContext(fixture), { thickness: 0.1, even: false }))
    // A triangle's corners are sixty degrees, so a mitre needs 0.05 ⁄ tan 30° of setback at each
    // end rather than the flat 0.05 an even switch that is off would take.
    expect(meshVolume(even)).toBeCloseTo(3 * (side - 2 * 0.05 / Math.tan(Math.PI / 6)) * 0.01, 8)
    expect(meshVolume(plain)).toBeCloseTo(3 * (side - 2 * 0.05) * 0.01, 8)
  })

  it('has nothing left to wire when the rim is left out', () => {
    expect(runOperator('mesh.wireframe', editContext(sheet()), { thickness: 0.1, boundary: false }).error)
      .toBe('Every selected edge is on the rim, and Boundary is switched off.')
  })

  it('wires only the inside of a mesh when the rim is left out', () => {
    const mesh = boxMesh(2)
    const fixture: EditFixture = { mesh, faces: allIds(mesh, 'face'), selectMode: ['face'] }
    const wired = resultEdit(runOperator('mesh.wireframe', editContext(fixture), { thickness: 0.1, boundary: false }))
    // Every edge of a closed cube has two faces, so leaving the rim out leaves all twelve of them.
    expect(wired.faceCount).toBe(72)
    expect(isClosed(wired)).toBe(true)
  })

  it('replays at another thickness, which is what the redo panel does', () => {
    const context = editContext(sheet())
    const thin = resultEdit(runOperator('mesh.wireframe', context, { thickness: 0.1 }))
    const thick = resultEdit(runOperator('mesh.wireframe', context, { thickness: 0.2 }))
    expect(thin.faceCount).toBe(24)
    expect(thick.faceCount).toBe(24)
    expect(meshVolume(thick)).toBeCloseTo(4 * (2 - 0.2) * 0.2 * 0.2, 10)
  })

  it('refuses a thickness of nothing', () => {
    expect(runOperator('mesh.wireframe', editContext(sheet()), { thickness: 0 }).error)
      .toBe('A thickness of zero has nothing to build.')
  })

  it('says so when nothing is selected', () => {
    expect(runOperator('mesh.wireframe', editContext({ mesh: planeMesh(2) })).error).toBe('Nothing is selected.')
  })
})
