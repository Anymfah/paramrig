import { describe, expect, it } from 'vitest'
import type { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import '@/scene/operators/bisect'
import { allIds, editContext, euler, isClosed, isWellFormed, meshVolume, resultEdit, resultSelection } from '@/scene/operators/editHarness'
import { getOperator, runOperator } from '@/scene/operators/registry'
import type { EditFixture } from '@/scene/operators/editHarness'
import type { OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
import type { MeshData, Vec3 } from '@/scene/types'

/*
 * Importing '@/scene/operators/bisect' is what registers it, so every case below runs through the
 * registry — the same path the menus and the F9 panel take. Bisect works on the selection, so every
 * fixture selects the whole mesh, which is what a person pressing A first would have.
 */

const MISSES = 'The plane misses the mesh; move it so that it crosses the geometry.'

function everything(mesh: MeshData, extra: Partial<EditFixture> = {}): OperatorContext {
  return editContext({ mesh, faces: allIds(mesh, 'face'), selectMode: ['face'], ...extra })
}

function bisect(mesh: MeshData, params: OperatorParams = {}): OperatorResult {
  return runOperator('mesh.bisect', everything(mesh), params)
}

function counts(mesh: EditMesh): { vertices: number; edges: number; faces: number } {
  return { vertices: mesh.vertexCount, edges: mesh.edgeCount, faces: mesh.faceCount }
}

/**
 * The cap: the face lying in the cut plane, found by its centre and by facing along the axis the
 * plane does — which is what tells it apart from the side faces whose centres share the height.
 */
function capFace(mesh: EditMesh, axis: 0 | 1 | 2, at: number): number {
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (Math.abs(mesh.faceCentre(face)[axis] - at) > 1e-6) continue
    if (Math.abs(Math.abs(mesh.faceNormal(face)[axis]) - 1) < 1e-6) return face
  }
  return -1
}

function heightsOf(mesh: EditMesh): number[] {
  const heights: number[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) heights.push(mesh.position(slot)[2])
  return heights
}

/* ------------------------------------------------------------------ the family */

describe('the bisect operator', () => {
  it('registers under Mesh, in edit mode, with a default for every parameter', () => {
    const operator = getOperator('mesh.bisect')

    expect(operator?.section).toBe('Mesh')
    expect(operator?.mode).toBe('edit')
    expect(Object.keys(operator?.defaults ?? {}).sort()).toEqual((operator?.params ?? []).map((param) => param.id).sort())
  })
})

/* -------------------------------------------------------------------- cutting */

describe('bisect', () => {
  it('cuts a cube through the origin and fills the seam', () => {
    const mesh = resultEdit(bisect(boxMesh(2), { fill: true }))

    expect(counts(mesh)).toEqual({ vertices: 12, edges: 20, faces: 11 })
    expect(heightsOf(mesh).filter((height) => Math.abs(height) < 1e-9)).toHaveLength(4)
    expect(isWellFormed(mesh)).toBe(true)
    const cap = capFace(mesh, 2, 0)
    expect(mesh.faceVertices(cap)).toHaveLength(4)
    expect(mesh.faceNormal(cap)[2]).toBeCloseTo(-1, 9)
  })

  it('leaves the cut open when nothing is filled', () => {
    const mesh = resultEdit(bisect(boxMesh(2)))

    expect(counts(mesh)).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(meshVolume(mesh)).toBeCloseTo(8, 9)
  })

  it('leaves a closed half of a cube once the inner side is cleared', () => {
    const mesh = resultEdit(bisect(boxMesh(2), { fill: true, clearInner: true }))

    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 6 })
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(meshVolume(mesh)).toBeCloseTo(4, 9)
    expect(Math.min(...heightsOf(mesh))).toBeCloseTo(0, 9)
    expect(mesh.faceNormal(capFace(mesh, 2, 0))[2]).toBeCloseTo(-1, 9)
  })

  it('keeps the other half, capped the other way, when the outer side is cleared', () => {
    const mesh = resultEdit(bisect(boxMesh(2), { fill: true, clearOuter: true }))

    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 6 })
    expect(isClosed(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(4, 9)
    expect(Math.max(...heightsOf(mesh))).toBeCloseTo(0, 9)
    expect(mesh.faceNormal(capFace(mesh, 2, 0))[2]).toBeCloseTo(1, 9)
  })

  it('leaves the cut open on a mesh that is open, since no loop closes there', () => {
    const mesh = resultEdit(bisect(planeMesh(2), { planeNormal: [0, 1, 0], fill: true }))

    expect(counts(mesh)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(1)
  })

  it('leaves the four new vertices and the four edges between them selected', () => {
    const selection = resultSelection(bisect(boxMesh(2)))

    expect(selection.vertices).toEqual([8, 9, 10, 11])
    expect(selection.edges).toHaveLength(4)
    for (const key of selection.edges) {
      for (const end of key.split(':')) expect(selection.vertices).toContain(Number(end))
    }
  })

  it('refuses a plane that misses the mesh, and changes nothing', () => {
    const result = bisect(boxMesh(2), { planePoint: [0, 0, 5] })

    expect(result.error).toBe(MISSES)
    expect(result.document).toBeUndefined()
  })

  it('takes a vertex within the threshold as being on the plane rather than cutting beside it', () => {
    const grazing = resultEdit(bisect(boxMesh(2), { planePoint: [0, 0, 0.99995], fill: true }))
    expect(counts(grazing)).toEqual({ vertices: 8, edges: 12, faces: 6 })

    const exact = resultEdit(bisect(boxMesh(2), { planePoint: [0, 0, 0.99995], threshold: 0 }))
    expect(counts(exact)).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(isWellFormed(exact)).toBe(true)
  })

  it('cuts along a plane that is not upright', () => {
    const mesh = resultEdit(bisect(boxMesh(2), { planeNormal: [1, 0, 0], fill: true, clearInner: true }))

    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 6 })
    expect(isClosed(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(4, 9)
    expect(mesh.faceNormal(capFace(mesh, 0, 0))[0]).toBeCloseTo(-1, 9)
  })

  it('replays against the document it started from, with the plane moved', () => {
    const context = everything(boxMesh(2))

    const middle = resultEdit(runOperator('mesh.bisect', context, { fill: true }))
    const higher = resultEdit(runOperator('mesh.bisect', context, { fill: true, planePoint: [0, 0, 0.5] }))

    expect(counts(middle)).toEqual(counts(higher))
    expect(heightsOf(middle).filter((height) => Math.abs(height) < 1e-9)).toHaveLength(4)
    expect(heightsOf(higher).filter((height) => Math.abs(height - 0.5) < 1e-9)).toHaveLength(4)
    expect(higher.faceCentre(capFace(higher, 2, 0.5))[2]).toBeCloseTo(0.5, 9)
  })

  it('refuses when nothing is selected, since it cuts the selection', () => {
    const result = runOperator('mesh.bisect', editContext({ mesh: boxMesh(2) }), {})

    expect(result.error).toBe('Nothing is selected.')
  })
})

/* ----------------------------------------------------------------- one corner */

describe('bisect on part of a mesh', () => {
  it('cuts only the faces that are selected', () => {
    const mesh = boxMesh(2)
    const context = editContext({ mesh, faces: [mesh.faceIds[2]!], selectMode: ['face'] })
    const cut = resultEdit(runOperator('mesh.bisect', context, {}))

    expect(counts(cut)).toEqual({ vertices: 10, edges: 15, faces: 7 })
    expect(isWellFormed(cut)).toBe(true)
    expect(heightsOf(cut).filter((height) => Math.abs(height) < 1e-9)).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ the plane */

describe('the plane the panel shows', () => {
  it('reads the plane in world metres, through the object it is cutting', () => {
    const mesh = boxMesh(2)
    const context = everything(mesh)
    const moved: OperatorContext = {
      ...context,
      document: {
        ...context.document,
        objects: context.document.objects.map((object) => ({
          ...object,
          transform: { ...object.transform, position: [0, 0, 4] as Vec3 },
        })),
      },
    }

    const cut = resultEdit(runOperator('mesh.bisect', moved, { planePoint: [0, 0, 4] }))

    expect(counts(cut)).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(heightsOf(cut).filter((height) => Math.abs(height) < 1e-9)).toHaveLength(4)
  })
})
