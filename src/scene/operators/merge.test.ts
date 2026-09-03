import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import {
  editContext,
  euler,
  HARNESS_OBJECT_ID,
  isClosed,
  isWellFormed,
  keyOf,
  resultEdit,
  resultSelection,
  type EditFixture,
} from '@/scene/operators/editHarness'
import '@/scene/operators/merge'
import { runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
import type { MeshData, Vec3 } from '@/scene/types'

/*
 * Importing '@/scene/operators/merge' is what registers the family, so every test here runs through
 * the registry — the same path the M menu and the keymap take.
 */

/** Runs a merge and insists it worked: a refusal is the failure unless the test is about one. */
function merge(id: string, fixture: EditFixture, params: Partial<OperatorParams> = {}): OperatorResult {
  const result = runOperator(id, editContext(fixture), params)
  if (!result.document) throw new Error(`${id} refused: ${result.error ?? 'it returned no document'}`)
  return result
}

/** Two meshes in one, the second moved by `offset`: the loose parts a collapse has to tell apart. */
function joined(first: MeshData, second: MeshData, offset: Vec3): MeshData {
  const mesh = EditMesh.from(first)
  const source = EditMesh.from(second)
  const slots = new Map<number, number>()
  for (let vertex = 0; vertex < source.vertexCount; vertex += 1) {
    const [x, y, z] = source.position(vertex)
    slots.set(vertex, mesh.addVertex([x + offset[0], y + offset[1], z + offset[2]]))
  }
  for (let face = 0; face < source.faceCount; face += 1) {
    mesh.addFace(source.faceVertices(face).map((slot) => slots.get(slot)!))
  }
  return mesh.toData()
}

/** A plane whose every corner has been duplicated where it stands: what a merge by distance is for. */
function doubledPlane(): MeshData {
  const mesh = EditMesh.from(planeMesh(2))
  for (const corner of [0, 1, 2, 3]) mesh.addVertex(mesh.position(corner))
  return mesh.toData()
}

/** Two quads folded at a right angle, each carrying its own copy of the two corners they share. */
function foldedPair(): MeshData {
  return meshFromPolygons(
    [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1],
    ],
    [[0, 1, 2, 3], [4, 5, 6, 7]],
  )
}

function positionOf(mesh: EditMesh, id: number): Vec3 {
  return mesh.position(mesh.slotOfVertex(id))
}

/* ------------------------------------------------------------- at a point */

describe('merge at centre', () => {
  it('welds two corners of a cube into one and leaves the cube closed', () => {
    const result = merge('mesh.mergeAtCentre', { mesh: boxMesh(2), vertices: [0, 1] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(7)
    expect(mesh.edgeCount).toBe(11)
    expect(mesh.faceCount).toBe(6)
    expect(euler(mesh)).toBe(2)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('puts the survivor at the middle of the two, and says how many went', () => {
    const result = merge('mesh.mergeAtCentre', { mesh: boxMesh(2), vertices: [0, 1] })
    const mesh = resultEdit(result)

    expect(positionOf(mesh, 0)).toEqual([0, -1, -1])
    expect(result.label).toBe('Removed 1 vertex')
    expect(resultSelection(result).vertices).toEqual([0])
  })

  it('leaves the two triangles it made behind, rather than faces of two corners', () => {
    const mesh = resultEdit(merge('mesh.mergeAtCentre', { mesh: boxMesh(2), vertices: [0, 1] }))
    const sides = [...Array(mesh.faceCount).keys()].map((face) => mesh.faceVertices(face).length).sort()

    expect(sides).toEqual([3, 3, 4, 4, 4, 4])
  })

  it('refuses one vertex, because one vertex is not two', () => {
    const result = runOperator('mesh.mergeAtCentre', editContext({ mesh: boxMesh(2), vertices: [0] }))

    expect(result.error).toBe('Select at least two vertices to merge.')
    expect(result.document).toBeUndefined()
  })

  it('merges again on what it left, which is what pressing M twice does', () => {
    const once = merge('mesh.mergeAtCentre', { mesh: boxMesh(2), vertices: [0, 1] })
    const twice = merge('mesh.mergeAtCentre', { mesh: once.document!.meshes['mesh-under-test']!, vertices: [0, 2] })
    const mesh = resultEdit(twice)

    expect(mesh.vertexCount).toBe(6)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
  })
})

describe('merge at cursor', () => {
  it('takes the selection to where the cursor is', () => {
    const result = merge('mesh.mergeAtCursor', { mesh: boxMesh(2), vertices: [4, 5], cursor: [0, 0, 2] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(7)
    expect(positionOf(mesh, 4)).toEqual([0, 0, 2])
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(result.label).toBe('Removed 1 vertex')
  })

  it('moves a single vertex to the cursor without welding anything', () => {
    const result = merge('mesh.mergeAtCursor', { mesh: boxMesh(2), vertices: [4], cursor: [0.5, 0.5, 3] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(8)
    expect(positionOf(mesh, 4)).toEqual([0.5, 0.5, 3])
    expect(result.label).toBe('Removed 0 vertices')
  })

  it('reads the cursor in the object’s own frame, not the world’s', () => {
    const context = editContext({ mesh: boxMesh(2), vertices: [0, 1], cursor: [3, 0, 0] })
    const moved = {
      ...context,
      document: {
        ...context.document,
        objects: context.document.objects.map((object) => object.id === HARNESS_OBJECT_ID
          ? { ...object, transform: { ...object.transform, position: [2, 0, 0] as Vec3 } }
          : object),
      },
    }
    const result = runOperator('mesh.mergeAtCursor', moved)
    const mesh = resultEdit(result)

    expect(positionOf(mesh, 0)).toEqual([1, 0, 0])
  })

  it('refuses when nothing is selected', () => {
    const result = runOperator('mesh.mergeAtCursor', editContext({ mesh: boxMesh(2) }))

    expect(result.error).toBe('No vertices are selected.')
  })
})

/* ---------------------------------------------------------------- islands */

describe('merge collapse', () => {
  it('merges each island of the selection on its own', () => {
    const result = merge('mesh.mergeCollapse', { mesh: joined(boxMesh(2), boxMesh(2), [5, 0, 0]), vertices: [0, 1, 8, 9] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(14)
    expect(mesh.faceCount).toBe(12)
    expect(euler(mesh)).toBe(4)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(result.label).toBe('Removed 2 vertices')
  })

  it('puts each island’s survivor at that island’s own middle', () => {
    const result = merge('mesh.mergeCollapse', { mesh: joined(boxMesh(2), boxMesh(2), [5, 0, 0]), vertices: [0, 1, 8, 9] })
    const mesh = resultEdit(result)

    expect(positionOf(mesh, 0)).toEqual([0, -1, -1])
    expect(positionOf(mesh, 8)).toEqual([5, -1, -1])
  })

  it('refuses a selection whose vertices touch nothing', () => {
    const result = runOperator('mesh.mergeCollapse', editContext({ mesh: boxMesh(2), vertices: [0, 6] }))

    expect(result.error).toBe('Select at least two vertices to merge.')
  })
})

/* ------------------------------------------------------------ first, last */

describe('merge at first and at last', () => {
  const fixture: EditFixture = { mesh: boxMesh(2), vertices: [0, 1], active: { kind: 'vertex', id: '1' } }

  /** The picks in order, which is what the two operators read and the harness only holds one of. */
  function picked(order: number[]): OperatorContext {
    const context = editContext(fixture)
    return {
      ...context,
      selection: {
        ...context.selection,
        elementHistory: order.map((id) => ({ kind: 'vertex' as const, objectId: HARNESS_OBJECT_ID, id: String(id) })),
      },
    }
  }

  it('merges onto the vertex that was picked first', () => {
    const result = runOperator('mesh.mergeAtFirst', picked([0, 1]))
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(7)
    expect(positionOf(mesh, 0)).toEqual([-1, -1, -1])
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('merges onto the vertex that was picked last', () => {
    const result = runOperator('mesh.mergeAtLast', picked([1, 0]))
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(7)
    expect(positionOf(mesh, 1)).toEqual([1, -1, -1])
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('says so rather than guessing when nothing was picked in order', () => {
    const context = editContext({ mesh: boxMesh(2), vertices: [0, 1] })

    expect(runOperator('mesh.mergeAtFirst', context).error)
      .toBe('Pick the vertices one at a time: this merges onto the first of them.')
    expect(runOperator('mesh.mergeAtLast', context).error)
      .toBe('Pick the vertices one at a time: this merges onto the last of them.')
  })
})

/* ----------------------------------------------------------- by distance */

describe('merge by distance', () => {
  it('welds a plane’s doubled corners back into four', () => {
    const result = merge('mesh.mergeByDistance', { mesh: doubledPlane(), vertices: [0, 1, 2, 3, 4, 5, 6, 7] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(4)
    expect(mesh.edgeCount).toBe(4)
    expect(mesh.faceCount).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
    expect(result.label).toBe('Removed 4 vertices')
  })

  it('leaves the corners it kept exactly where they were', () => {
    const mesh = resultEdit(merge('mesh.mergeByDistance', { mesh: doubledPlane(), vertices: [0, 1, 2, 3, 4, 5, 6, 7] }))

    expect(positionOf(mesh, 0)).toEqual([-1, -1, 0])
    expect(positionOf(mesh, 2)).toEqual([1, 1, 0])
  })

  it('welds nothing when only the loose copies are selected', () => {
    const result = merge('mesh.mergeByDistance', { mesh: doubledPlane(), vertices: [4, 5, 6, 7] })

    expect(resultEdit(result).vertexCount).toBe(8)
    expect(result.label).toBe('Removed 0 vertices')
  })

  it('welds them onto the corners they sit on when “unselected” is on', () => {
    const result = merge('mesh.mergeByDistance', { mesh: doubledPlane(), vertices: [4, 5, 6, 7] }, { unselected: true })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(4)
    expect(mesh.faceCount).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
    expect(positionOf(mesh, 0)).toEqual([-1, -1, 0])
  })

  it('replays with a wider distance and takes the whole plane with it', () => {
    const result = merge('mesh.mergeByDistance', { mesh: doubledPlane(), vertices: [0, 1, 2, 3, 4, 5, 6, 7] }, { distance: 2.9 })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(1)
    expect(mesh.faceCount).toBe(0)
    expect(mesh.edgeCount).toBe(0)
    expect(result.label).toBe('Removed 7 vertices')
  })

  it('marks the fold it welded shut as sharp when “sharp edges” is on', () => {
    const fixture: EditFixture = { mesh: foldedPair(), vertices: [0, 1, 2, 3, 4, 5, 6, 7] }
    const result = merge('mesh.mergeByDistance', fixture, { sharpEdges: true })
    const mesh = resultEdit(result)
    const fold = mesh.edgeSlot(mesh.slotOfVertex(0), mesh.slotOfVertex(3))

    expect(mesh.vertexCount).toBe(6)
    expect(mesh.faceCount).toBe(2)
    expect(mesh.edgeFaces(fold).length).toBe(2)
    expect(mesh.edgeFlag(fold, 'sharp')).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('leaves the fold alone when “sharp edges” is off', () => {
    const fixture: EditFixture = { mesh: foldedPair(), vertices: [0, 1, 2, 3, 4, 5, 6, 7] }
    const mesh = resultEdit(merge('mesh.mergeByDistance', fixture))
    const fold = mesh.edgeSlot(mesh.slotOfVertex(0), mesh.slotOfVertex(3))

    expect(mesh.edgeFlag(fold, 'sharp')).toBe(false)
  })

  it('carries a seam across the weld', () => {
    const source = EditMesh.from(doubledPlane())
    source.setEdgeFlag(source.edgeSlot(0, 1), 'seam', true)
    const mesh = resultEdit(merge('mesh.mergeByDistance', { mesh: source.toData(), vertices: [0, 1, 2, 3, 4, 5, 6, 7] }))
    const seam = mesh.edgeSlot(mesh.slotOfVertex(0), mesh.slotOfVertex(1))

    expect(mesh.edgeFlag(seam, 'seam')).toBe(true)
  })

  it('refuses when nothing is selected', () => {
    const result = runOperator('mesh.mergeByDistance', editContext({ mesh: doubledPlane() }))

    expect(result.error).toBe('No vertices are selected.')
  })

  it('keeps the edge keys of what it kept, so the selection still names them', () => {
    const result = merge('mesh.mergeByDistance', { mesh: doubledPlane(), vertices: [0, 1, 2, 3, 4, 5, 6, 7] })
    const mesh = resultEdit(result)

    expect(keyOf(mesh, mesh.slotOfVertex(0), mesh.slotOfVertex(1))).toBe('0:1')
    expect(resultSelection(result).vertices).toEqual([0, 1, 2, 3])
  })
})
