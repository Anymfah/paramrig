import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, gridMesh, planeMesh } from '@/scene/mesh/primitives'
import {
  allEdgeKeys,
  allIds,
  editContext,
  euler,
  isClosed,
  isWellFormed,
  keyOf,
  resultEdit,
  resultSelection,
  type EditFixture,
} from '@/scene/operators/editHarness'
import { runOperator } from '@/scene/operators/registry'
import '@/scene/operators/remove'
import type { EdgeKey, MeshData } from '@/scene/types'
import type { OperatorParams, OperatorResult } from '@/scene/operators/types'

/*
 * Importing '@/scene/operators/remove' is what registers the family, so every test here runs
 * through the registry — the same path the X and ⌃X menus take.
 */

function run(id: string, fixture: EditFixture, params: Partial<OperatorParams> = {}): OperatorResult {
  const result = runOperator(id, editContext(fixture), params)
  if (!result.document) throw new Error(`${id} refused: ${result.error ?? 'it returned no document'}`)
  return result
}

/** One edge of a mesh named by the slots of its ends, which is how a test points at an edge. */
function edgeOf(mesh: MeshData, a: number, b: number): EdgeKey {
  return keyOf(EditMesh.from(mesh), a, b)
}

const GRID_3 = () => gridMesh({ xSubdivisions: 3, ySubdivisions: 3 })

/** Two quads sharing an edge, folded by `degrees`: what a limited dissolve has to measure. */
function gentleFold(degrees: number): MeshData {
  const rise = Math.tan((degrees * Math.PI) / 180)
  return meshFromPolygons(
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, rise], [2, 1, rise]],
    [[0, 1, 2, 3], [1, 4, 5, 2]],
  )
}

/* ------------------------------------------------------------------ delete */

describe('delete vertices', () => {
  it('takes every face and edge the vertex was part of with it', () => {
    const mesh = resultEdit(run('mesh.deleteVertices', { mesh: boxMesh(2), vertices: [0] }))

    expect(mesh.vertexCount).toBe(7)
    expect(mesh.edgeCount).toBe(9)
    expect(mesh.faceCount).toBe(3)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('leaves nothing selected, because nothing it named is there any more', () => {
    const result = run('mesh.deleteVertices', { mesh: boxMesh(2), vertices: [0] })

    expect(resultSelection(result)).toEqual({ vertices: [], edges: [], faces: [] })
  })

  it('refuses when nothing is selected', () => {
    const result = runOperator('mesh.deleteVertices', editContext({ mesh: boxMesh(2) }))

    expect(result.error).toBe('No vertices are selected.')
  })
})

describe('delete faces', () => {
  it('leaves a cube’s edges and vertices behind when one face goes', () => {
    const mesh = resultEdit(run('mesh.deleteFaces', { mesh: boxMesh(2), faces: [1], selectMode: ['face'] }))

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(5)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(false)
  })

  it('takes the whole cube when every face goes, since nothing is drawn on it any more', () => {
    const cube = boxMesh(2)
    const mesh = resultEdit(run('mesh.deleteFaces', { mesh: cube, faces: allIds(cube, 'face'), selectMode: ['face'] }))

    expect(mesh.vertexCount).toBe(0)
    expect(mesh.edgeCount).toBe(0)
    expect(mesh.faceCount).toBe(0)
  })

  it('refuses when no face is selected', () => {
    const result = runOperator('mesh.deleteFaces', editContext({ mesh: boxMesh(2), selectMode: ['face'] }))

    expect(result.error).toBe('No faces are selected.')
  })
})

describe('delete only faces', () => {
  it('refuses when no face is selected', () => {
    const result = runOperator('mesh.deleteOnlyFaces', editContext({ mesh: boxMesh(2), selectMode: ['face'] }))

    expect(result.error).toBe('No faces are selected.')
  })

  it('keeps every edge and vertex, however many faces go', () => {
    const cube = boxMesh(2)
    const mesh = resultEdit(run('mesh.deleteOnlyFaces', { mesh: cube, faces: allIds(cube, 'face'), selectMode: ['face'] }))

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(0)
    expect(isWellFormed(mesh)).toBe(true)
  })
})

describe('delete edges', () => {
  it('takes the faces that used the edge, and leaves the vertices that still hold something', () => {
    const cube = boxMesh(2)
    const mesh = resultEdit(run('mesh.deleteEdges', { mesh: cube, edges: [edgeOf(cube, 0, 1)], selectMode: ['edge'] }))

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(11)
    expect(mesh.faceCount).toBe(4)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('refuses when the selection names no edge', () => {
    const result = runOperator('mesh.deleteEdges', editContext({ mesh: boxMesh(2), vertices: [0, 6] }))

    expect(result.error).toBe('No edges are selected.')
  })

  it('takes the vertices that are left holding nothing', () => {
    const plane = planeMesh(2)
    const mesh = resultEdit(run('mesh.deleteEdges', { mesh: plane, edges: allEdgeKeys(plane), selectMode: ['edge'] }))

    expect(mesh.vertexCount).toBe(0)
    expect(mesh.faceCount).toBe(0)
  })
})

describe('delete only edges & faces', () => {
  it('keeps the vertices where they are', () => {
    const plane = planeMesh(2)
    const mesh = resultEdit(run('mesh.deleteOnlyEdgesFaces', { mesh: plane, edges: allEdgeKeys(plane), selectMode: ['edge'] }))

    expect(mesh.vertexCount).toBe(4)
    expect(mesh.edgeCount).toBe(0)
    expect(mesh.faceCount).toBe(0)
  })

  it('refuses when no edge is named by the selection', () => {
    const result = runOperator('mesh.deleteOnlyEdgesFaces', editContext({ mesh: boxMesh(2), vertices: [0, 6] }))

    expect(result.error).toBe('No edges are selected.')
  })
})

/* ---------------------------------------------------------------- dissolve */

describe('dissolve vertices', () => {
  it('merges the fan around the vertex into a single face', () => {
    const mesh = resultEdit(run('mesh.dissolveVertices', { mesh: GRID_3(), vertices: [4] }))

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(8)
    expect(mesh.faceCount).toBe(1)
    expect(mesh.faceVertices(0).length).toBe(8)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('cuts the fan back into faces when “face split” is on', () => {
    const mesh = resultEdit(run('mesh.dissolveVertices', { mesh: GRID_3(), vertices: [4] }, { faceSplit: true }))
    const sides = [...Array(mesh.faceCount).keys()].map((face) => mesh.faceVertices(face).length).sort()

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.faceCount).toBe(5)
    expect(sides).toEqual([3, 3, 3, 3, 4])
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('joins the two faces at a boundary vertex', () => {
    const mesh = resultEdit(run('mesh.dissolveVertices', { mesh: GRID_3(), vertices: [1] }))

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.faceCount).toBe(3)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('leaves them apart when “tear boundary” is on', () => {
    const mesh = resultEdit(run('mesh.dissolveVertices', { mesh: GRID_3(), vertices: [1] }, { tearBoundary: true }))

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.faceCount).toBe(4)
    expect(mesh.edgeCount).toBe(11)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('takes the corner off a lone face rather than the face itself', () => {
    const source = EditMesh.from(planeMesh(2))
    const middle = source.splitEdge(source.edgeSlot(0, 1), 0.5)
    const mesh = resultEdit(run('mesh.dissolveVertices', { mesh: source.toData(), vertices: [source.vertexId(middle)] }))

    expect(mesh.faceCount).toBe(1)
    expect(mesh.faceVertices(0).length).toBe(4)
    expect(mesh.vertexCount).toBe(4)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('refuses a vertex that is part of no face', () => {
    const source = EditMesh.from(planeMesh(2))
    const loose = source.addVertex([0, 0, 1])
    const result = runOperator('mesh.dissolveVertices', editContext({ mesh: source.toData(), vertices: [source.vertexId(loose)] }))

    expect(result.error).toBe('Dissolving needs vertices that are part of a face.')
  })
})

describe('dissolve edges', () => {
  it('leaves a subdivided plane as one face', () => {
    const grid = GRID_3()
    const inner = [edgeOf(grid, 1, 4), edgeOf(grid, 3, 4), edgeOf(grid, 4, 5), edgeOf(grid, 4, 7)]
    const mesh = resultEdit(run('mesh.dissolveEdges', { mesh: grid, edges: inner, selectMode: ['edge'] }))

    expect(mesh.faceCount).toBe(1)
    expect(mesh.vertexCount).toBe(4)
    expect(mesh.edgeCount).toBe(4)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('keeps the vertices it left behind when “dissolve verts” is off', () => {
    const grid = GRID_3()
    const inner = [edgeOf(grid, 1, 4), edgeOf(grid, 3, 4), edgeOf(grid, 4, 5), edgeOf(grid, 4, 7)]
    const mesh = resultEdit(run('mesh.dissolveEdges', { mesh: grid, edges: inner, selectMode: ['edge'] }, { dissolveVerts: false }))

    expect(mesh.faceCount).toBe(1)
    expect(mesh.vertexCount).toBe(9)
    expect(mesh.edgeCount).toBe(8)
    expect(mesh.faceVertices(0).length).toBe(8)
  })

  it('refuses an edge that has not got two faces to merge', () => {
    const plane = planeMesh(2)
    const result = runOperator('mesh.dissolveEdges', editContext({ mesh: plane, edges: [edgeOf(plane, 0, 1)], selectMode: ['edge'] }))

    expect(result.error).toBe('These edges have no two faces to merge.')
  })
})

describe('dissolve faces', () => {
  it('merges two faces of a cube into one and leaves it closed', () => {
    const mesh = resultEdit(run('mesh.dissolveFaces', { mesh: boxMesh(2), faces: [0, 2], selectMode: ['face'] }))

    expect(mesh.faceCount).toBe(5)
    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(11)
    expect(euler(mesh)).toBe(2)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('refuses a single face, which has nothing to merge with', () => {
    const result = runOperator('mesh.dissolveFaces', editContext({ mesh: boxMesh(2), faces: [0], selectMode: ['face'] }))

    expect(result.error).toBe('Select faces that touch: dissolving them needs a region to merge.')
  })
})

describe('limited dissolve', () => {
  it('leaves a flat subdivided plane as one face', () => {
    const grid = GRID_3()
    const mesh = resultEdit(run('mesh.dissolveLimited', { mesh: grid, vertices: allIds(grid, 'vertex') }))

    expect(mesh.faceCount).toBe(1)
    expect(mesh.vertexCount).toBe(8)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('takes the flat run of boundary vertices too when “all boundaries” is on', () => {
    const grid = GRID_3()
    const mesh = resultEdit(run('mesh.dissolveLimited', { mesh: grid, vertices: allIds(grid, 'vertex') }, { allBoundaries: true }))

    expect(mesh.faceCount).toBe(1)
    expect(mesh.vertexCount).toBe(4)
    expect(mesh.edgeCount).toBe(4)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('leaves a cube alone at five degrees', () => {
    const cube = boxMesh(2)
    const result = run('mesh.dissolveLimited', { mesh: cube, vertices: allIds(cube, 'vertex') })
    const mesh = resultEdit(result)

    expect(mesh.faceCount).toBe(6)
    expect(mesh.vertexCount).toBe(8)
    expect(isClosed(mesh)).toBe(true)
    expect(result.label).toBe('Limited dissolve — Nothing was flat enough to dissolve.')
  })

  it('replays at a wider angle and takes a fold that a narrower one kept', () => {
    const fold = gentleFold(3)
    const ids = allIds(fold, 'vertex')

    expect(resultEdit(run('mesh.dissolveLimited', { mesh: fold, vertices: ids }, { angle: 1 })).faceCount).toBe(2)
    expect(resultEdit(run('mesh.dissolveLimited', { mesh: fold, vertices: ids }, { angle: 5 })).faceCount).toBe(1)
  })

  it('refuses when nothing is selected', () => {
    const result = runOperator('mesh.dissolveLimited', editContext({ mesh: boxMesh(2) }))

    expect(result.error).toBe('Nothing is selected.')
  })
})

/* ------------------------------------------------------- collapse and loops */

describe('edge collapse', () => {
  it('pulls an edge of a cube down to one vertex at its middle', () => {
    const cube = boxMesh(2)
    const result = run('mesh.dissolveEdgeCollapse', { mesh: cube, edges: [edgeOf(cube, 0, 1)], selectMode: ['edge'] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(7)
    expect(mesh.edgeCount).toBe(11)
    expect(mesh.faceCount).toBe(6)
    expect(euler(mesh)).toBe(2)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(mesh.position(mesh.slotOfVertex(0))).toEqual([0, -1, -1])
    expect(result.label).toBe('Edge collapse — Removed 1 vertex')
  })

  it('collapses each run of edges on its own', () => {
    const cube = boxMesh(2)
    const result = run('mesh.dissolveEdgeCollapse', {
      mesh: cube,
      edges: [edgeOf(cube, 0, 1), edgeOf(cube, 6, 7)],
      selectMode: ['edge'],
    })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(6)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(result.label).toBe('Edge collapse — Removed 2 vertices')
  })

  it('refuses when no edge is selected', () => {
    const result = runOperator('mesh.dissolveEdgeCollapse', editContext({ mesh: boxMesh(2), vertices: [0, 6] }))

    expect(result.error).toBe('No edges are selected.')
  })
})

describe('dissolve edge loops', () => {
  it('follows the loop across the grid and merges the faces on either side', () => {
    const grid = gridMesh({ xSubdivisions: 4, ySubdivisions: 3 })
    const mesh = resultEdit(run('mesh.dissolveEdgeLoops', { mesh: grid, edges: [edgeOf(grid, 1, 5)], selectMode: ['edge'] }))
    const sides = [...Array(mesh.faceCount).keys()].map((face) => mesh.faceVertices(face).length)

    expect(mesh.faceCount).toBe(4)
    expect(mesh.vertexCount).toBe(9)
    expect(mesh.edgeCount).toBe(12)
    expect(sides).toEqual([4, 4, 4, 4])
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('refuses when no edge is selected', () => {
    const result = runOperator('mesh.dissolveEdgeLoops', editContext({ mesh: boxMesh(2), vertices: [0, 6] }))

    expect(result.error).toBe('No edges are selected.')
  })
})
