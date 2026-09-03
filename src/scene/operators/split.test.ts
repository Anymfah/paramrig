import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, gridMesh } from '@/scene/mesh/primitives'
import {
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
import '@/scene/operators/split'
import type { OperatorParams, OperatorResult } from '@/scene/operators/types'
import type { EdgeKey, MeshData, Vec3 } from '@/scene/types'

/*
 * Importing '@/scene/operators/split' is what registers the family, so every test here runs through
 * the registry — the same path the Split, Rip and Separate menu entries take.
 */

function run(id: string, fixture: EditFixture, params: Partial<OperatorParams> = {}): OperatorResult {
  const result = runOperator(id, editContext(fixture), params)
  if (!result.document) throw new Error(`${id} refused: ${result.error ?? 'it returned no document'}`)
  return result
}

function edgeOf(mesh: MeshData, a: number, b: number): EdgeKey {
  return keyOf(EditMesh.from(mesh), a, b)
}

/** The mesh of one object of the document an operator answered with. */
function meshOfObject(result: OperatorResult, index: number): EditMesh {
  const object = result.document?.objects[index]
  if (!object || object.data.kind !== 'mesh') throw new Error(`There is no mesh object at ${index}.`)
  const mesh = result.document?.meshes[object.data.meshId]
  if (!mesh) throw new Error(`The object at ${index} points at a mesh that is not there.`)
  return EditMesh.from(mesh)
}

/** Two meshes in one, the second moved by `offset`: the loose parts a separate has to tell apart. */
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

const GRID_3 = () => gridMesh({ xSubdivisions: 3, ySubdivisions: 3 })

/* ----------------------------------------------------------------- split */

describe('split selection', () => {
  it('takes a face of a cube away from its neighbours', () => {
    const result = run('mesh.splitSelection', { mesh: boxMesh(2), faces: [1], selectMode: ['face'] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(12)
    expect(mesh.edgeCount).toBe(16)
    expect(mesh.faceCount).toBe(6)
    expect(euler(mesh)).toBe(2)
    expect(isClosed(mesh)).toBe(false)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('leaves the copies exactly where the corners were', () => {
    const mesh = resultEdit(run('mesh.splitSelection', { mesh: boxMesh(2), faces: [1], selectMode: ['face'] }))
    const corners = mesh.faceVertices(1).map((slot) => mesh.position(slot))

    expect(corners).toEqual([[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]])
    for (let slot = 8; slot < mesh.vertexCount; slot += 1) {
      expect(mesh.position(slot)[2]).toBe(1)
    }
  })

  it('leaves the face that came away selected', () => {
    const result = run('mesh.splitSelection', { mesh: boxMesh(2), faces: [1], selectMode: ['face'] })

    expect(resultSelection(result).faces).toEqual([1])
    expect(resultSelection(result).vertices.length).toBe(4)
  })

  it('refuses a selection that is already the whole mesh', () => {
    const cube = boxMesh(2)
    const result = runOperator('mesh.splitSelection', editContext({ mesh: cube, faces: allIds(cube, 'face'), selectMode: ['face'] }))

    expect(result.error).toBe('That part of the mesh is already on its own.')
  })

  it('refuses when no face is selected', () => {
    const result = runOperator('mesh.splitSelection', editContext({ mesh: boxMesh(2), selectMode: ['face'] }))

    expect(result.error).toBe('No faces are selected.')
  })
})

describe('split faces by edges', () => {
  it('parts the two faces that met along the edge', () => {
    const grid = GRID_3()
    const result = run('mesh.splitFacesByEdges', { mesh: grid, edges: [edgeOf(grid, 1, 4)], selectMode: ['edge'] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(10)
    expect(mesh.edgeCount).toBe(13)
    expect(mesh.faceCount).toBe(4)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('leaves the vertex whose fan is still in one piece alone', () => {
    const grid = GRID_3()
    const mesh = resultEdit(run('mesh.splitFacesByEdges', { mesh: grid, edges: [edgeOf(grid, 1, 4)], selectMode: ['edge'] }))

    expect(mesh.vertexFaces(4).length).toBe(4)
    expect(mesh.vertexFaces(1).length).toBe(1)
  })

  it('refuses an edge with only one face, which parts nothing', () => {
    const grid = GRID_3()
    const result = runOperator('mesh.splitFacesByEdges', editContext({ mesh: grid, edges: [edgeOf(grid, 0, 1)], selectMode: ['edge'] }))

    expect(result.error).toBe('Those edges are already on a rim, with nothing to part.')
  })
})

describe('split faces & edges by vertices', () => {
  it('gives every face at the vertex its own copy of it', () => {
    const mesh = resultEdit(run('mesh.splitEdgesFaces', { mesh: GRID_3(), vertices: [4] }))

    expect(mesh.vertexCount).toBe(12)
    expect(mesh.edgeCount).toBe(16)
    expect(mesh.faceCount).toBe(4)
    expect(mesh.vertexFaces(4).length).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('refuses a vertex only one face was using', () => {
    const result = runOperator('mesh.splitEdgesFaces', editContext({ mesh: GRID_3(), vertices: [0] }))

    expect(result.error).toBe('Those vertices are used by one face each, so there is nothing to part.')
  })
})

/* ------------------------------------------------------------------- rip */

describe('rip', () => {
  it('tears the fan in two and moves the side the pointer was on', () => {
    const result = run('mesh.rip', { mesh: GRID_3(), vertices: [4] }, { direction: [0.2, 0, 0] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(10)
    expect(mesh.edgeCount).toBe(14)
    expect(mesh.faceCount).toBe(4)
    expect(mesh.position(9)).toEqual([0.2, 0, 0])
    expect(mesh.position(4)).toEqual([0, 0, 0])
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('leaves the ripped copy selected, which is what the move then takes hold of', () => {
    const result = run('mesh.rip', { mesh: GRID_3(), vertices: [4] }, { direction: [0.2, 0, 0] })

    expect(resultSelection(result).vertices).toEqual([9])
  })

  it('replays the other way about and moves the other side', () => {
    const result = run('mesh.rip', { mesh: GRID_3(), vertices: [4] }, { direction: [-0.2, 0, 0] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(10)
    expect(mesh.position(9)).toEqual([-0.2, 0, 0])
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('closes the gap when the fill is on', () => {
    const result = run('mesh.rip', { mesh: GRID_3(), vertices: [4] }, { direction: [0.2, 0, 0], fill: true })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(10)
    expect(mesh.faceCount).toBe(6)
    expect(mesh.edgeCount).toBe(15)
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('fills by default under ⌥V', () => {
    const result = run('mesh.ripFill', { mesh: GRID_3(), vertices: [4] }, { direction: [0.2, 0, 0] })

    expect(resultEdit(result).faceCount).toBe(6)
  })

  it('rips an edge by taking both of its ends', () => {
    const grid = GRID_3()
    const result = run('mesh.rip', { mesh: grid, edges: [edgeOf(grid, 1, 4)], selectMode: ['edge'] }, { direction: [0.2, 0, 0] })
    const mesh = resultEdit(result)

    expect(mesh.vertexCount).toBe(11)
    expect(mesh.faceCount).toBe(4)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('fills the gap along a ripped edge with one quad', () => {
    const grid = GRID_3()
    const fixture: EditFixture = { mesh: grid, edges: [edgeOf(grid, 1, 4)], selectMode: ['edge'] }
    const mesh = resultEdit(run('mesh.ripFill', fixture, { direction: [0.2, 0, 0] }))
    const filled = [...Array(mesh.faceCount).keys()].filter((face) => mesh.faceArea(face) < 0.5)

    expect(mesh.vertexCount).toBe(11)
    expect(mesh.faceCount).toBe(6)
    expect(mesh.faceVertices(filled[0]!).length).toBe(4)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('gives the faces it fills with the shading of the face they came from', () => {
    const source = EditMesh.from(GRID_3())
    for (let face = 0; face < source.faceCount; face += 1) source.setFaceSmooth(face, true)
    const mesh = resultEdit(run('mesh.ripFill', { mesh: source.toData(), vertices: [4] }, { direction: [0.2, 0, 0] }))

    for (let face = 0; face < mesh.faceCount; face += 1) expect(mesh.faceSmooth(face)).toBe(true)
  })

  it('refuses until the pointer has said which way', () => {
    const result = runOperator('mesh.rip', editContext({ mesh: GRID_3(), vertices: [4] }))

    expect(result.error).toBe('Drag towards the side to rip away.')
  })

  it('refuses ⌥V until the pointer has said which way as well', () => {
    const result = runOperator('mesh.ripFill', editContext({ mesh: GRID_3(), vertices: [4] }))

    expect(result.error).toBe('Drag towards the side to rip away.')
  })

  it('refuses a fan that is all on one side', () => {
    const result = runOperator('mesh.rip', editContext({ mesh: GRID_3(), vertices: [0] }), { direction: [1, 1, 0] })

    expect(result.error).toBe('Every face is on that side of the selection, so there is nothing to rip.')
  })
})

/* -------------------------------------------------------------- separate */

describe('separate', () => {
  it('moves the selected faces into an object of their own', () => {
    const result = run('mesh.separate', { mesh: boxMesh(2), faces: [1], selectMode: ['face'] })
    const source = meshOfObject(result, 0)
    const made = meshOfObject(result, 1)

    expect(result.document?.objects.length).toBe(2)
    expect(source.faceCount).toBe(5)
    expect(source.vertexCount).toBe(8)
    expect(source.edgeCount).toBe(12)
    expect(made.faceCount).toBe(1)
    expect(made.vertexCount).toBe(4)
    expect(made.edgeCount).toBe(4)
    expect(isWellFormed(made)).toBe(true)
  })

  it('gives the new object the source’s frame and a name of its own', () => {
    const result = run('mesh.separate', { mesh: boxMesh(2), faces: [1], selectMode: ['face'] })
    const made = result.document?.objects[1]

    expect(made?.name).toBe('object-under-test.001')
    expect(made?.transform.position).toEqual([0, 0, 0])
    expect(made?.materialSlots).toEqual(result.document?.objects[0]?.materialSlots)
    expect(result.selection?.objectIds).toContain(made?.id)
    expect(result.label).toBe('Separate')
  })

  it('takes the faces the new object holds out of the mesh they came from', () => {
    const result = run('mesh.separate', { mesh: boxMesh(2), faces: [1], selectMode: ['face'] })
    const source = meshOfObject(result, 0)
    const top = [...Array(source.faceCount).keys()].filter((face) => source.faceCentre(face)[2] > 0.9)

    expect(top).toEqual([])
    expect(isWellFormed(source)).toBe(true)
  })

  it('makes one object per loose part', () => {
    const result = run('mesh.separate', { mesh: joined(boxMesh(2), boxMesh(2), [5, 0, 0]) }, { mode: 'loose' })
    const source = meshOfObject(result, 0)
    const made = meshOfObject(result, 1)

    expect(result.document?.objects.length).toBe(2)
    expect(source.vertexCount).toBe(8)
    expect(source.faceCount).toBe(6)
    expect(isClosed(source)).toBe(true)
    expect(made.vertexCount).toBe(8)
    expect(made.faceCount).toBe(6)
    expect(isClosed(made)).toBe(true)
  })

  it('makes one object per material after the first', () => {
    const source = EditMesh.from(boxMesh(2))
    for (const face of [3, 4, 5]) source.setFaceMaterial(face, 1)
    const result = run('mesh.separate', { mesh: source.toData() }, { mode: 'material' })
    const made = meshOfObject(result, 1)

    expect(meshOfObject(result, 0).faceCount).toBe(3)
    expect(made.faceCount).toBe(3)
    expect(made.vertexCount).toBe(8)
    expect(isWellFormed(made)).toBe(true)
  })

  it('refuses a mesh that is all one piece', () => {
    const result = runOperator('mesh.separate', editContext({ mesh: boxMesh(2) }), { mode: 'loose' })

    expect(result.error).toBe('This mesh is all one piece, so there is nothing to separate.')
  })

  it('refuses a mesh that uses one material', () => {
    const result = runOperator('mesh.separate', editContext({ mesh: boxMesh(2) }), { mode: 'material' })

    expect(result.error).toBe('This mesh uses one material, so there is nothing to separate.')
  })

  it('refuses when nothing is selected to separate', () => {
    const result = runOperator('mesh.separate', editContext({ mesh: boxMesh(2) }))

    expect(result.error).toBe('No faces are selected.')
  })
})
