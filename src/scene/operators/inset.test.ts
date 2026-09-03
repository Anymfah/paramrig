import { describe, expect, it } from 'vitest'
import type { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import { editContext, euler, isClosed, isWellFormed, meshVolume, resultEdit, resultSelection } from '@/scene/operators/editHarness'
import '@/scene/operators/inset'
import { runOperator } from '@/scene/operators/registry'
import type { OperatorParams, OperatorResult } from '@/scene/operators/types'

/*
 * `boxMesh` numbers its faces bottom, top, −Y, +X, +Y, −X, and a fresh primitive's ids are its
 * slots — so face 1 is the top of the cube and faces 1 and 3 are two faces meeting at an edge,
 * which is the pair every region case here is about.
 */

const TOP = 1
const SIDE = 3

function inset(faces: number[], params: Partial<OperatorParams> = {}, mesh = boxMesh(2)): OperatorResult {
  return runOperator('mesh.inset', editContext({ mesh, faces, selectMode: ['face'] }), params)
}

/** The box round one face, which is what says how far in the inset moved its rim. */
function faceBounds(mesh: EditMesh, id: number) {
  return mesh.boundsOf(mesh.faceVertices(mesh.slotOfFace(id)))
}

/** How many corners two faces have in common: two of them is one shared edge. */
function shared(mesh: EditMesh, first: number, second: number): number {
  const corners = new Set(mesh.faceVertices(mesh.slotOfFace(first)))
  return mesh.faceVertices(mesh.slotOfFace(second)).filter((slot) => corners.has(slot)).length
}

describe('inset of one face', () => {
  it('lays a border inside a face of a cube and leaves it closed', () => {
    const mesh = resultEdit(inset([TOP], { thickness: 0.25 }))
    expect(mesh.vertexCount).toBe(12)
    expect(mesh.edgeCount).toBe(20)
    expect(mesh.faceCount).toBe(10)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('moves the inner face in by the thickness and leaves it selected', () => {
    const result = inset([TOP], { thickness: 0.25 })
    const bounds = faceBounds(resultEdit(result), TOP)
    expect(bounds.min[0]).toBeCloseTo(-0.75, 10)
    expect(bounds.max[0]).toBeCloseTo(0.75, 10)
    expect(bounds.min[1]).toBeCloseTo(-0.75, 10)
    expect(bounds.max[2]).toBeCloseTo(1, 10)
    expect(resultSelection(result).faces).toEqual([TOP])
  })

  it('pushes the inner face along the normal when it is given a depth', () => {
    const bounds = faceBounds(resultEdit(inset([TOP], { thickness: 0.25, depth: 0.5 })), TOP)
    expect(bounds.min[2]).toBeCloseTo(1.5, 10)
    expect(bounds.max[2]).toBeCloseTo(1.5, 10)
    expect(bounds.max[0]).toBeCloseTo(0.75, 10)
  })

  it('walks the plain bisector, and no further, when offset even is off', () => {
    // The corner of a square is a right angle, so an even offset is longer by √2 than an uneven one.
    const bounds = faceBounds(resultEdit(inset([TOP], { thickness: 0.25, offsetEven: false })), TOP)
    expect(bounds.max[0]).toBeCloseTo(1 - 0.25 / Math.SQRT2, 10)
  })

  it('scales the thickness by the face itself when the offset is relative', () => {
    // Every edge of the cube is two metres, so a relative quarter is half a metre of thickness.
    const bounds = faceBounds(resultEdit(inset([TOP], { thickness: 0.25, offsetRelative: true })), TOP)
    expect(bounds.max[0]).toBeCloseTo(0.5, 10)
  })

  it('selects the border rather than the inner face when it is asked to', () => {
    const result = inset([TOP], { thickness: 0.25, selectOuter: true })
    expect(resultSelection(result).faces).toEqual([6, 7, 8, 9])
  })

  it('gives the border the material and the shading of the face it grew from', () => {
    const mesh = boxMesh(2)
    mesh.attributes.face.material[TOP] = 2
    mesh.attributes.face.smooth[TOP] = true
    const after = resultEdit(inset([TOP], { thickness: 0.25 }, mesh))
    for (const face of [6, 7, 8, 9]) {
      const slot = after.slotOfFace(face)
      expect(after.faceMaterial(slot)).toBe(2)
      expect(after.faceSmooth(slot)).toBe(true)
    }
  })
})

describe('inset of a region', () => {
  it('borders two adjacent faces once, and leaves them joined', () => {
    const mesh = resultEdit(inset([TOP, SIDE], { thickness: 0.25 }))
    expect(mesh.vertexCount).toBe(14)
    expect(mesh.edgeCount).toBe(24)
    expect(mesh.faceCount).toBe(12)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(shared(mesh, TOP, SIDE)).toBe(2)
  })

  it('keeps a rim vertex on the crease it sits on', () => {
    // The vertex at (1, −1, 1) is shared by the two faces; the only move that is a quarter of a
    // metre from both of the rim edges meeting there runs along the crease between them.
    const mesh = resultEdit(inset([TOP, SIDE], { thickness: 0.25 }))
    const corners = mesh.faceVertices(mesh.slotOfFace(TOP)).map((slot) => mesh.position(slot))
    const onCrease = corners.find((point) => Math.abs(point[0] - 1) < 1e-9 && Math.abs(point[2] - 1) < 1e-9)
    expect(onCrease).toBeDefined()
    expect(onCrease![1]).toBeCloseTo(-0.75, 10)
  })

  it('frames every face of a closed cube, six inside and twenty-four around', () => {
    const result = inset([0, 1, 2, 3, 4, 5], { thickness: 0.25 })
    const mesh = resultEdit(result)
    expect(resultSelection(result).faces).toEqual([0, 1, 2, 3, 4, 5])
    expect(resultSelection(inset([0, 1, 2, 3, 4, 5], { thickness: 0.25, selectOuter: true })).faces).toHaveLength(24)
    expect(mesh.faceCount).toBe(30)
    expect(mesh.vertexCount).toBe(32)
    expect(mesh.edgeCount).toBe(60)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('gives each face its own border when individual is on', () => {
    const mesh = resultEdit(inset([TOP, SIDE], { thickness: 0.25, individual: true }))
    expect(mesh.vertexCount).toBe(16)
    expect(mesh.edgeCount).toBe(28)
    expect(mesh.faceCount).toBe(14)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(shared(mesh, TOP, SIDE)).toBe(0)
  })
})

describe('outset', () => {
  it('grows the border outside the region and leaves the face the size it was', () => {
    const mesh = resultEdit(inset([TOP], { thickness: 0.25, outset: true }))
    expect(mesh.faceCount).toBe(10)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    const face = faceBounds(mesh, TOP)
    expect(face.max[0]).toBeCloseTo(1, 10)
    expect(face.max[2]).toBeCloseTo(1, 10)
    const whole = mesh.bounds()
    expect(whole.max[0]).toBeCloseTo(1.25, 10)
    expect(whole.max[2]).toBeCloseTo(1, 10)
    // The cube now flares towards its top, so it holds more than the eight cubic metres it did.
    expect(meshVolume(mesh)).toBeGreaterThan(8)
  })
})

describe('what inset refuses', () => {
  it('says so when no face is selected', () => {
    const result = runOperator('mesh.inset', editContext({ mesh: boxMesh(2), selectMode: ['face'] }), { thickness: 0.25 })
    expect(result.error).toBe('No faces are selected.')
    expect(result.document).toBeUndefined()
  })

  it('leaves the open rim of a plane alone when boundary is off', () => {
    const result = inset([0], { thickness: 0.25, boundary: false }, planeMesh(2))
    expect(result.document).toBeUndefined()
    expect(result.error).toBe('Nothing to do here.')
  })
})

describe('adjusting the last inset', () => {
  it('replays against the mesh as it was, with the new thickness and depth', () => {
    const context = editContext({ mesh: boxMesh(2), faces: [TOP], selectMode: ['face'] })
    const first = resultEdit(runOperator('mesh.inset', context, { thickness: 0.25 }))
    expect(faceBounds(first, TOP).max[0]).toBeCloseTo(0.75, 10)

    const again = resultEdit(runOperator('mesh.inset', context, { thickness: 0.5, depth: -0.5 }))
    expect(again.vertexCount).toBe(12)
    expect(again.faceCount).toBe(10)
    const bounds = faceBounds(again, TOP)
    expect(bounds.max[0]).toBeCloseTo(0.5, 10)
    expect(bounds.max[2]).toBeCloseTo(0.5, 10)
    expect(isClosed(again)).toBe(true)
  })
})
