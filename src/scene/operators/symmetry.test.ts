import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, cylinderMesh } from '@/scene/mesh/primitives'
import {
  allEdgeKeys,
  allIds,
  editContext,
  euler,
  isClosed,
  isWellFormed,
  resultEdit,
  resultSelection,
} from '@/scene/operators/editHarness'
import { runOperator } from '@/scene/operators/registry'
import { symmetryMap } from '@/scene/operators/symmetry'
import type { OperatorContext } from '@/scene/operators/types'
import type { MeshData, Vec3 } from '@/scene/types'

/*
 * Symmetry is asserted in three ways here. The counts say what the cut and the mirror did to the
 * topology — a cube gains the ring of vertices the plane cuts through it, a four-sided cylinder
 * already has one and gains nothing. The volume says the result is closed and wound outwards, since
 * a mirrored half read the same way round would come back negative. And the positions say the two
 * halves are the same geometry rather than merely the same size.
 */

/** The volume with its sign kept: mirroring reverses it, and turning the faces round is what puts it back. */
function signedVolume(mesh: EditMesh): number {
  let total = 0
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    for (let index = 1; index + 1 < loop.length; index += 1) {
      const a = mesh.position(loop[0]!)
      const b = mesh.position(loop[index]!)
      const c = mesh.position(loop[index + 1]!)
      total += (
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])
      ) / 6
    }
  }
  return total
}

function moved(source: MeshData, pick: (point: Vec3) => boolean, to: (point: Vec3) => Vec3): MeshData {
  const mesh = EditMesh.from(source)
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    if (pick(point)) mesh.setPosition(slot, to(point))
  }
  return mesh.toData()
}

function withSeam(source: MeshData, a: number, b: number): MeshData {
  const mesh = EditMesh.from(source)
  mesh.setEdgeFlag(mesh.edgeSlot(a, b), 'seam', true)
  return mesh.toData()
}

function withSmoothFaces(source: MeshData): MeshData {
  const mesh = EditMesh.from(source)
  for (let face = 0; face < mesh.faceCount; face += 1) mesh.setFaceSmooth(face, true)
  return mesh.toData()
}

/** Everything selected, in all three kinds, which is where a person symmetrises from. */
function wholeMesh(mesh: MeshData, cursor?: Vec3): OperatorContext {
  return editContext({
    mesh,
    vertices: allIds(mesh, 'vertex'),
    edges: allEdgeKeys(mesh),
    faces: allIds(mesh, 'face'),
    selectMode: ['vertex'],
    ...(cursor ? { cursor } : {}),
  })
}

function positionsAt(mesh: EditMesh, axis: 0 | 1 | 2, value: number): Vec3[] {
  const found: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    if (Math.abs(point[axis] - value) < 1e-9) found.push(point)
  }
  return found
}

function seamCount(mesh: EditMesh): number {
  let total = 0
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) if (mesh.edgeFlag(edge, 'seam')) total += 1
  return total
}

/** A cube whose +X half has been pulled out to x = 2, which is the mesh symmetrize is asked about. */
function lopsidedCube(): MeshData {
  return moved(boxMesh(2), (point) => point[0] > 0, (point) => [2, point[1], point[2]])
}

/* -------------------------------------------------------------- symmetryMap */

describe('symmetryMap', () => {
  it('pairs all eight vertices of a cube across X', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const pairs = symmetryMap(mesh, 0, 0.001)
    expect(pairs.size).toBe(8)
    for (const [slot, partner] of pairs) {
      const point = mesh.position(slot)
      expect(mesh.position(partner)).toEqual([-point[0], point[1], point[2]])
    }
  })

  it('leaves out the vertices sitting on the plane', () => {
    // A four-sided cylinder puts two of each ring exactly on the X plane, and one on each side.
    const mesh = EditMesh.from(cylinderMesh({ vertices: 4, radius: 1, depth: 2 }))
    expect(mesh.vertexCount).toBe(8)
    expect(symmetryMap(mesh, 0, 0.001).size).toBe(4)
  })

  it('leaves out a vertex whose mirror is further away than the threshold', () => {
    const data = moved(boxMesh(2), (point) => point[0] > 0 && point[1] > 0 && point[2] > 0, () => [1, 0.5, 1])
    const pairs = symmetryMap(EditMesh.from(data), 0, 0.01)
    // The moved vertex and the one that used to mirror it both lose their partner; six are left.
    expect(pairs.size).toBe(6)
  })

  it('pairs across Y and Z as well as X', () => {
    const mesh = EditMesh.from(boxMesh(2))
    expect(symmetryMap(mesh, 1, 0.001).size).toBe(8)
    expect(symmetryMap(mesh, 2, 0.001).size).toBe(8)
  })
})

/* --------------------------------------------------------------- symmetrize */

describe('mesh.symmetrize', () => {
  it('mirrors the +X half of a lopsided cube onto the −X half, cutting the ring the plane needs', () => {
    const data = withSmoothFaces(withSeam(lopsidedCube(), 1, 2))
    const result = runOperator('mesh.symmetrize', wholeMesh(data))
    const mesh = resultEdit(result)

    // Eight corners plus the four the plane cuts: the cube had no geometry on the plane to weld to.
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([12, 20, 10])
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(signedVolume(mesh)).toBeCloseTo(16, 9)

    expect(positionsAt(mesh, 0, 0)).toHaveLength(4)
    const source = positionsAt(mesh, 0, 2)
    const mirror = positionsAt(mesh, 0, -2)
    expect(source).toHaveLength(4)
    expect(mirror.map((point) => [-point[0], point[1], point[2]]).sort()).toEqual(source.sort())
    for (let face = 0; face < mesh.faceCount; face += 1) expect(mesh.faceSmooth(face)).toBe(true)
    expect(seamCount(mesh)).toBe(2)
    expect(resultSelection(result).vertices).toHaveLength(12)
  })

  it('leaves the vertex count alone when the mesh already has a ring on the plane', () => {
    const data = moved(
      cylinderMesh({ vertices: 4, radius: 1, depth: 2 }),
      (point) => point[0] > 0.5,
      (point) => [2, point[1], point[2]],
    )
    const mesh = resultEdit(runOperator('mesh.symmetrize', wholeMesh(data)))

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 14, 8])
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    // A rhombus 4 m across and 2 m deep, swept 2 m: the two halves are now the same shape.
    expect(signedVolume(mesh)).toBeCloseTo(8, 9)
    expect(positionsAt(mesh, 0, -2)).toHaveLength(2)
  })

  it('replays the other way round, mirroring the −X half onto the +X one', () => {
    const context = wholeMesh(lopsidedCube())
    const mesh = resultEdit(runOperator('mesh.symmetrize', context, { direction: 'x-to-+x' }))
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([12, 20, 10])
    expect(isClosed(mesh)).toBe(true)
    // The −X half was the untouched one, so the answer is the cube it came from.
    expect(signedVolume(mesh)).toBeCloseTo(8, 9)
    expect(positionsAt(mesh, 0, 2)).toHaveLength(0)
    expect(positionsAt(mesh, 0, 1)).toHaveLength(4)
  })

  it('symmetrises across Z as readily as across X', () => {
    const data = moved(boxMesh(2), (point) => point[2] > 0, (point) => [point[0], point[1], 3])
    const mesh = resultEdit(runOperator('mesh.symmetrize', wholeMesh(data), { direction: '+z-to-z' }))
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([12, 20, 10])
    expect(isClosed(mesh)).toBe(true)
    expect(signedVolume(mesh)).toBeCloseTo(24, 9)
  })

  it('refuses when the source side is empty', () => {
    const data = moved(boxMesh(2), () => true, (point) => [point[0] - 3, point[1], point[2]])
    const result = runOperator('mesh.symmetrize', wholeMesh(data))
    expect(result.error).toBe('There is nothing on the +X side to mirror.')
    expect(result.document).toBeUndefined()
  })

  it('refuses a face that crosses the plane more than twice rather than leaving a hole', () => {
    // A comb: its rim crosses x = 0 four times, so there is no single line to cut it along.
    const comb = meshFromPolygons(
      [[-2, 0, 0], [2, 0, 0], [2, 1, 0], [-1, 1, 0], [-1, 2, 0], [2, 2, 0], [2, 3, 0], [-2, 3, 0]],
      [[0, 1, 2, 3, 4, 5, 6, 7]],
    )
    const result = runOperator('mesh.symmetrize', wholeMesh(comb))
    expect(result.error).toBe('A face crosses the mirror plane in more than two places, so this mesh cannot be symmetrised.')
  })

  it('refuses when nothing is selected', () => {
    expect(runOperator('mesh.symmetrize', editContext({ mesh: boxMesh(2) })).error).toBe('Nothing is selected.')
  })
})

/* --------------------------------------------------------- snap to symmetry */

/** A cube with one corner nudged 40 mm out: near enough to symmetrical to be snapped back. */
function nudgedCube(): MeshData {
  return moved(
    boxMesh(2),
    (point) => point[0] > 0 && point[1] < 0 && point[2] < 0,
    (point) => [1.04, point[1], point[2]],
  )
}

describe('mesh.snapToSymmetry', () => {
  it('pulls the −X corner all the way onto the mirror of its partner', () => {
    const data = nudgedCube()
    const mesh = resultEdit(runOperator('mesh.snapToSymmetry', wholeMesh(data), { threshold: 0.1, factor: 1 }))

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(mesh.position(mesh.slotOfVertex(0))[0]).toBeCloseTo(-1.04, 12)
    // The source half is what is being copied from, so it does not move.
    expect(mesh.position(mesh.slotOfVertex(1))).toEqual([1.04, -1, -1])
    expect(mesh.position(mesh.slotOfVertex(3))).toEqual([-1, 1, -1])
  })

  it('replays half way when the factor says so', () => {
    const context = wholeMesh(nudgedCube())
    const half = resultEdit(runOperator('mesh.snapToSymmetry', context, { threshold: 0.1, factor: 0.5 }))
    expect(half.position(half.slotOfVertex(0))[0]).toBeCloseTo(-1.02, 12)
    const none = resultEdit(runOperator('mesh.snapToSymmetry', context, { threshold: 0.1, factor: 0 }))
    expect(none.position(none.slotOfVertex(0))).toEqual([-1, -1, -1])
  })

  it('pulls a vertex within the threshold of the plane onto the plane itself', () => {
    const data = moved(boxMesh(2), (point) => point[0] < 0, (point) => [-0.02, point[1], point[2]])
    const mesh = resultEdit(runOperator('mesh.snapToSymmetry', wholeMesh(data), { threshold: 0.05, factor: 1 }))
    for (const slot of [0, 3, 4, 7]) expect(mesh.position(mesh.slotOfVertex(slot))[0]).toBeCloseTo(0, 12)
  })

  it('refuses when nothing has a mirror close enough to snap to', () => {
    const result = runOperator('mesh.snapToSymmetry', wholeMesh(lopsidedCube()), { threshold: 0.05 })
    expect(result.error).toBe('Nothing has a mirror within the threshold, so there is nothing to snap.')
    expect(result.document).toBeUndefined()
  })

  it('refuses when nothing is selected', () => {
    expect(runOperator('mesh.snapToSymmetry', editContext({ mesh: boxMesh(2) })).error).toBe('Nothing is selected.')
  })
})

/* ------------------------------------------------------------------ mirror */

/** A cube with one corner pulled out, so a reflection has something to show. */
function skewedCube(): MeshData {
  return moved(boxMesh(2), (point) => point[0] > 0 && point[1] > 0 && point[2] > 0, () => [1.5, 1, 1])
}

/** The same context with the object turned a quarter turn about Z, which local and global disagree about. */
function turnedAboutZ(context: OperatorContext): OperatorContext {
  const object = context.document.objects[0]!
  const turned = { ...object, transform: { ...object.transform, rotation: [0, 0, 90] as Vec3 } }
  return { ...context, document: { ...context.document, objects: [turned] }, active: turned }
}

describe('mesh.mirror', () => {
  it('reflects the selection through its own median and turns the faces back outwards', () => {
    const data = skewedCube()
    const before = EditMesh.from(data)
    const mesh = resultEdit(runOperator('mesh.mirror', wholeMesh(data)))

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    // The median of the eight corners sits at x = 0.0625, so every x lands at 0.125 − x.
    expect(mesh.position(mesh.slotOfVertex(0))[0]).toBeCloseTo(1.125, 12)
    expect(mesh.position(mesh.slotOfVertex(1))[0]).toBeCloseTo(-0.875, 12)
    expect(mesh.position(mesh.slotOfVertex(6))[0]).toBeCloseTo(-1.375, 12)
    expect(mesh.position(mesh.slotOfVertex(6))[1]).toBeCloseTo(1, 12)
    expect(signedVolume(mesh)).toBeCloseTo(signedVolume(before), 12)
    expect(signedVolume(mesh)).toBeGreaterThan(0)
  })

  it('replays on another axis', () => {
    const context = wholeMesh(skewedCube())
    const mesh = resultEdit(runOperator('mesh.mirror', context, { axis: 'y' }))
    // The corner was pulled out along X, so the median of the eight sits at y = 0 and y simply
    // changes sign; x is left alone.
    expect(mesh.position(mesh.slotOfVertex(6))[1]).toBeCloseTo(-1, 12)
    expect(mesh.position(mesh.slotOfVertex(6))[0]).toBeCloseTo(1.5, 12)
    expect(signedVolume(mesh)).toBeGreaterThan(0)
  })

  it('mirrors about the world axis when the object is turned, and about its own when asked for local', () => {
    const context = turnedAboutZ(wholeMesh(skewedCube()))
    // A quarter turn about Z carries local +X onto world +Y, so the world X plane is the local Y one.
    const global = resultEdit(runOperator('mesh.mirror', context, { axis: 'x', space: 'global' }))
    expect(global.position(global.slotOfVertex(6))[1]).toBeCloseTo(-1, 12)
    expect(global.position(global.slotOfVertex(6))[0]).toBeCloseTo(1.5, 12)

    const local = resultEdit(runOperator('mesh.mirror', context, { axis: 'x', space: 'local' }))
    expect(local.position(local.slotOfVertex(6))[0]).toBeCloseTo(-1.375, 12)
    expect(local.position(local.slotOfVertex(6))[1]).toBeCloseTo(1, 12)
    expect(signedVolume(local)).toBeGreaterThan(0)
  })

  it('refuses when nothing is selected', () => {
    const result = runOperator('mesh.mirror', editContext({ mesh: boxMesh(2) }))
    expect(result.error).toBe('Nothing is selected.')
    expect(result.document).toBeUndefined()
  })
})
