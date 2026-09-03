import { describe, expect, it } from 'vitest'
import { edgeKey } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { dot, length, subtract } from '@/scene/mesh/normals'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import {
  allEdgeKeys,
  allIds,
  editContext,
  euler,
  isClosed,
  isWellFormed,
  meshVolume,
  resultEdit,
  resultMesh,
  resultSelection,
} from '@/scene/operators/editHarness'
import { runOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorParams, OperatorResult } from '@/scene/operators/types'
import type { MeshData, Vec3 } from '@/scene/types'
// Registering the family is a side effect of loading it, and the tests run it through the registry
// exactly as a menu entry and the F9 panel do.
import '@/scene/operators/extrude'

/* The cube is two metres across, so its faces sit at ±1 and every position below is exact. */

function run(id: string, context: OperatorContext, params: Partial<OperatorParams> = {}): OperatorResult {
  return runOperator(id, context, params)
}

function near(a: Vec3, b: Vec3): boolean {
  return length(subtract(a, b)) < 1e-9
}

/** The id of the face pointing a given way, so a test can say “the top of the cube”. */
function faceFacing(mesh: MeshData, direction: Vec3): number {
  const edit = EditMesh.from(mesh)
  for (let face = 0; face < edit.faceCount; face += 1) {
    if (dot(edit.faceNormal(face), direction) > 0.99) return edit.faceId(face)
  }
  throw new Error('No face points that way.')
}

function vertexAt(mesh: MeshData, point: Vec3): number {
  const edit = EditMesh.from(mesh)
  for (let slot = 0; slot < edit.vertexCount; slot += 1) {
    if (near(edit.position(slot), point)) return edit.vertexId(slot)
  }
  throw new Error(`No vertex at ${point.join(', ')}.`)
}

function slotAt(mesh: EditMesh, point: Vec3): number {
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    if (near(mesh.position(slot), point)) return slot
  }
  return -1
}

function hasPoint(mesh: EditMesh, point: Vec3): boolean {
  return slotAt(mesh, point) >= 0
}

/** The edge between two places, or -1: how a test asks whether an edge survived an extrusion. */
function edgeBetween(mesh: EditMesh, from: Vec3, to: Vec3): number {
  const a = slotAt(mesh, from)
  const b = slotAt(mesh, to)
  return a < 0 || b < 0 ? -1 : mesh.edgeSlot(a, b)
}

function faceById(mesh: EditMesh, id: number): { centre: Vec3; normal: Vec3; corners: Vec3[] } {
  const slot = mesh.slotOfFace(id)
  if (slot < 0) throw new Error(`Face ${id} is gone.`)
  return {
    centre: mesh.faceCentre(slot),
    normal: mesh.faceNormal(slot),
    corners: mesh.faceVertices(slot).map((corner) => mesh.position(corner)),
  }
}

function counts(mesh: EditMesh): { vertices: number; edges: number; faces: number } {
  return { vertices: mesh.vertexCount, edges: mesh.edgeCount, faces: mesh.faceCount }
}

/**
 * Two faces meeting at an edge run along it in opposite directions, everywhere in the mesh.
 *
 * That is the whole of “the walls face outwards”: a wall wound the wrong way round would still
 * close the surface and still pass `isClosed`, and would only be caught by looking at the seam it
 * makes with its neighbours. The harness has no such check, so it is written here.
 */
function isConsistentlyWound(mesh: EditMesh): boolean {
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    for (let index = 0; index < loop.length; index += 1) {
      const from = loop[index]!
      const to = loop[(index + 1) % loop.length]!
      for (const other of mesh.edgeFaces(mesh.edgeSlot(from, to))) {
        if (other !== face && mesh.loopNext(other, from) === to) return false
      }
    }
  }
  return true
}

const CUBE = boxMesh(2)
const PLANE = planeMesh(2)
const TOP = faceFacing(CUBE, [0, 0, 1])
const RIGHT = faceFacing(CUBE, [1, 0, 0])

function cubeFaces(faces: number[]) {
  return editContext({ mesh: CUBE, faces, selectMode: ['face'] })
}

describe('extrude region', () => {
  it('lifts a face of a cube and leaves it closed', () => {
    const result = run('mesh.extrudeRegion', cubeFaces([TOP]), { offset: [0, 0, 1] })
    const mesh = resultEdit(result)
    expect(counts(mesh)).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)

    const top = faceById(mesh, TOP)
    expect(top.centre).toEqual([0, 0, 2])
    // Still facing away from the middle of the mesh, which is what the walls were wound for.
    expect(dot(top.normal, [0, 0, 1])).toBeCloseTo(1, 9)
  })

  it('selects the face it moved, and the vertices it made', () => {
    const context = cubeFaces([TOP])
    const selection = resultSelection(run('mesh.extrudeRegion', context, { offset: [0, 0, 1] }))
    expect(selection.faces).toEqual([TOP])
    expect(selection.vertices).toHaveLength(4)
    // The copies are new ids, so none of the cube's own eight vertices stayed selected.
    expect(selection.vertices.every((id) => !allIds(CUBE, 'vertex').includes(id))).toBe(true)
    expect(selection.edges).toHaveLength(4)
  })

  it('builds no wall between two faces that went up together', () => {
    const result = run('mesh.extrudeRegion', cubeFaces([TOP, RIGHT]), { offset: [0, 0, 1] })
    const mesh = resultEdit(result)
    // Six walls around the rim of the pair, not seven: the edge they share is inside the region.
    expect(counts(mesh)).toEqual({ vertices: 14, edges: 24, faces: 12 })
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    // The edge the two faces used to share carries no face at all now, so it went with them —
    // while its two ends, which the rim runs through, stayed where they were.
    expect(edgeBetween(mesh, [1, -1, 1], [1, 1, 1])).toBe(-1)
    expect(hasPoint(mesh, [1, 1, 1])).toBe(true)
  })

  it('makes a quad from a selected edge, wound like the face beside it', () => {
    const context = editContext({
      mesh: PLANE,
      edges: [edgeKey(vertexAt(PLANE, [-1, -1, 0]), vertexAt(PLANE, [1, -1, 0]))],
      selectMode: ['edge'],
    })
    const mesh = resultEdit(run('mesh.extrudeRegion', context, { offset: [0, -1, 0] }))
    expect(counts(mesh)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    const walls = [...Array(mesh.faceCount).keys()].filter((face) => mesh.faceCentre(face)[1] < -1)
    expect(walls).toHaveLength(1)
    // The plane faces +Z; a wall that disagreed with it would face −Z.
    expect(dot(mesh.faceNormal(walls[0]!), [0, 0, 1])).toBeCloseTo(1, 9)
  })

  it('extrudes the face when its four corners are picked in vertex mode', () => {
    const context = editContext({ mesh: PLANE, vertices: allIds(PLANE, 'vertex'), selectMode: ['vertex'] })
    const mesh = resultEdit(run('mesh.extrudeRegion', context, { offset: [0, 0, 1] }))
    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 5 })
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('carries the material, the shading and the seams onto what it mints', () => {
    const dressed = structuredClone(CUBE)
    dressed.attributes.face.material[TOP] = 1
    dressed.attributes.face.smooth[TOP] = true
    const edit = EditMesh.from(dressed)
    const seams = dressed.attributes.edge.seam ?? []
    seams[edit.edgeSlot(slotAt(edit, [-1, -1, 1]), slotAt(edit, [1, -1, 1]))] = true
    dressed.attributes.edge.seam = seams

    const context = editContext({ mesh: dressed, faces: [TOP], selectMode: ['face'] })
    const mesh = resultEdit(run('mesh.extrudeRegion', context, { offset: [0, 0, 1] }))
    const walls = [...Array(mesh.faceCount).keys()].filter((face) => Math.abs(mesh.faceCentre(face)[2] - 1.5) < 1e-9)
    expect(walls).toHaveLength(4)
    for (const wall of walls) {
      expect(mesh.faceMaterial(wall)).toBe(1)
      expect(mesh.faceSmooth(wall)).toBe(true)
    }
    expect(mesh.edgeFlag(edgeBetween(mesh, [-1, -1, 2], [1, -1, 2]), 'seam')).toBe(true)
  })

  it('refuses when nothing is selected', () => {
    expect(run('mesh.extrudeRegion', editContext({ mesh: CUBE })).error).toBe('Nothing is selected.')
  })

  it('replays with another offset', () => {
    const context = cubeFaces([TOP])
    expect(faceById(resultEdit(run('mesh.extrudeRegion', context, { offset: [0, 0, 1] })), TOP).centre)
      .toEqual([0, 0, 2])
    expect(faceById(resultEdit(run('mesh.extrudeRegion', context, { offset: [0, 0, 3] })), TOP).centre)
      .toEqual([0, 0, 4])
  })
})

describe('extrude faces along normals', () => {
  it('keeps the region one shell and each face flat', () => {
    const result = run('mesh.extrudeAlongNormals', cubeFaces([TOP, RIGHT]), { offset: 0.5, offsetEven: true })
    const mesh = resultEdit(result)
    expect(counts(mesh)).toEqual({ vertices: 14, edges: 24, faces: 12 })
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)

    // Offset even: each face lands exactly half a metre from where it was, so it is still flat.
    for (const corner of faceById(mesh, TOP).corners) expect(corner[2]).toBeCloseTo(1.5, 9)
    for (const corner of faceById(mesh, RIGHT).corners) expect(corner[0]).toBeCloseTo(1.5, 9)
    // The corner the two faces share went diagonally, and there is still only one of it.
    expect(hasPoint(mesh, [1.5, 1, 1.5])).toBe(true)
    expect(hasPoint(mesh, [1.5, -1, 1.5])).toBe(true)
  })

  it('follows the plain average of the normals when the offset is not even', () => {
    const result = run('mesh.extrudeAlongNormals', cubeFaces([TOP, RIGHT]), { offset: 0.5, offsetEven: false })
    const mesh = resultEdit(result)
    const diagonal = 1 + 0.5 / Math.SQRT2
    expect(hasPoint(mesh, [diagonal, 1, diagonal])).toBe(true)
    // Without the even correction the shared corner falls short, so the faces are no longer flat.
    expect(faceById(mesh, TOP).corners.some((corner) => Math.abs(corner[2] - 1.5) > 1e-6)).toBe(true)
  })

  it('lifts one face straight along its own normal', () => {
    const mesh = resultEdit(run('mesh.extrudeAlongNormals', cubeFaces([TOP]), { offset: 0.5 }))
    expect(counts(mesh)).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(isClosed(mesh)).toBe(true)
    expect(faceById(mesh, TOP).centre).toEqual([0, 0, 1.5])
  })

  it('refuses when no faces are selected', () => {
    expect(run('mesh.extrudeAlongNormals', editContext({ mesh: CUBE })).error).toBe('No faces are selected.')
  })

  it('replays with another offset', () => {
    const context = cubeFaces([TOP])
    expect(faceById(resultEdit(run('mesh.extrudeAlongNormals', context, { offset: 0.5 })), TOP).centre[2])
      .toBeCloseTo(1.5, 9)
    expect(faceById(resultEdit(run('mesh.extrudeAlongNormals', context, { offset: 2 })), TOP).centre[2])
      .toBeCloseTo(3, 9)
  })
})

describe('extrude individual faces', () => {
  it('gives every face of a cube its own lid and its own walls', () => {
    const context = cubeFaces(allIds(CUBE, 'face'))
    const mesh = resultEdit(run('mesh.extrudeIndividual', context, { offset: 0.5 }))
    // Six lids and four walls apiece, on twenty-four copies of the eight corners.
    expect(counts(mesh)).toEqual({ vertices: 32, edges: 60, faces: 30 })
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    // Eight cubic metres and six slabs of two, which is what six lids half a metre out enclose.
    expect(meshVolume(mesh)).toBeCloseTo(20, 9)
  })

  it('splits a corner two faces shared into two', () => {
    const mesh = resultEdit(run('mesh.extrudeIndividual', cubeFaces([TOP, RIGHT]), { offset: 0.5 }))
    expect(counts(mesh)).toEqual({ vertices: 16, edges: 28, faces: 14 })
    expect(isClosed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    expect(hasPoint(mesh, [1, 1, 1.5])).toBe(true)
    expect(hasPoint(mesh, [1.5, 1, 1])).toBe(true)
    // Nothing went diagonally: the two lids share nothing at all.
    expect(hasPoint(mesh, [1.5, 1, 1.5])).toBe(false)
  })

  it('refuses when no faces are selected', () => {
    expect(run('mesh.extrudeIndividual', editContext({ mesh: CUBE })).error).toBe('No faces are selected.')
  })

  it('replays with another offset', () => {
    const context = cubeFaces(allIds(CUBE, 'face'))
    expect(meshVolume(resultEdit(run('mesh.extrudeIndividual', context, { offset: 0.5 })))).toBeCloseTo(20, 9)
    expect(meshVolume(resultEdit(run('mesh.extrudeIndividual', context, { offset: 1 })))).toBeCloseTo(32, 9)
  })
})

describe('extrude manifold', () => {
  it('leaves no skin inside the solid when a face is pushed into it', () => {
    const mesh = resultEdit(run('mesh.extrudeManifold', cubeFaces([TOP]), { offset: [0, 0, -0.5] }))
    // The walls the cube already had took the new rim, so the cube is simply shorter.
    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 6 })
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(6, 9)
    expect(faceById(mesh, TOP).centre).toEqual([0, 0, 0.5])
  })

  it('lengthens the walls when the face is pulled out instead', () => {
    const mesh = resultEdit(run('mesh.extrudeManifold', cubeFaces([TOP]), { offset: [0, 0, 0.5] }))
    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 6 })
    expect(meshVolume(mesh)).toBeCloseTo(10, 9)
  })

  it('extrudes as a region when there is nothing beside the rim to dissolve', () => {
    const context = editContext({ mesh: PLANE, faces: allIds(PLANE, 'face'), selectMode: ['face'] })
    const mesh = resultEdit(run('mesh.extrudeManifold', context, { offset: [0, 0, 1] }))
    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 5 })
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('refuses an offset only some of the faces around the rim run along', () => {
    const result = run('mesh.extrudeManifold', cubeFaces([TOP]), { offset: [0.5, 0, 0.5] })
    expect(result.error).toBe(
      'Only some of the faces around the selection run along this offset. Extrude region instead, or offset along the region’s own normal.',
    )
  })

  it('refuses when no faces are selected', () => {
    expect(run('mesh.extrudeManifold', editContext({ mesh: CUBE })).error).toBe('No faces are selected.')
  })

  it('replays with another offset', () => {
    const context = cubeFaces([TOP])
    expect(meshVolume(resultEdit(run('mesh.extrudeManifold', context, { offset: [0, 0, -0.5] })))).toBeCloseTo(6, 9)
    expect(meshVolume(resultEdit(run('mesh.extrudeManifold', context, { offset: [0, 0, -1.5] })))).toBeCloseTo(2, 9)
  })
})

describe('extrude edges only', () => {
  function planeEdges() {
    return editContext({ mesh: PLANE, edges: allEdgeKeys(PLANE), selectMode: ['edge'] })
  }

  it('makes a face from each of a plane’s four boundary edges', () => {
    const result = run('mesh.extrudeEdges', planeEdges(), { offset: [0, 0, 1] })
    const mesh = resultEdit(result)
    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 5 })
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    expect(euler(mesh)).toBe(1)

    const selection = resultSelection(result)
    expect(selection.vertices).toHaveLength(4)
    expect(selection.edges).toHaveLength(4)
    // The walls are not selected: what a person extruded is the four edges, and G moves those.
    expect(selection.faces).toEqual([])
  })

  it('winds each wall the way the face beside it is wound', () => {
    const mesh = resultEdit(run('mesh.extrudeEdges', planeEdges(), { offset: [0, 0, 1] }))
    const wall = [...Array(mesh.faceCount).keys()].find((face) => near(mesh.faceCentre(face), [0, -1, 0.5]))
    expect(wall).toBeDefined()
    // Agreeing with a cap that faces +Z puts the wall's normal towards the middle, as Blender does.
    expect(dot(mesh.faceNormal(wall!), [0, 1, 0])).toBeCloseTo(1, 9)
  })

  it('refuses when no edges are selected', () => {
    expect(run('mesh.extrudeEdges', cubeFaces([TOP])).error).toBe('No edges are selected.')
  })

  it('replays with another offset', () => {
    expect(hasPoint(resultEdit(run('mesh.extrudeEdges', planeEdges(), { offset: [0, 0, 1] })), [1, 1, 1])).toBe(true)
    expect(hasPoint(resultEdit(run('mesh.extrudeEdges', planeEdges(), { offset: [0, 0, 2] })), [1, 1, 2])).toBe(true)
  })
})

describe('extrude vertices only', () => {
  function planeCorner(corners: Vec3[] = [[-1, -1, 0]]) {
    return editContext({ mesh: PLANE, vertices: corners.map((point) => vertexAt(PLANE, point)), selectMode: ['vertex'] })
  }

  it('makes one edge and no face from a corner of a plane', () => {
    const result = run('mesh.extrudeVertices', planeCorner(), { offset: [0, 0, 1] })
    const mesh = resultEdit(result)
    expect(counts(mesh)).toEqual({ vertices: 5, edges: 5, faces: 1 })
    expect(isWellFormed(mesh)).toBe(true)
    expect(hasPoint(mesh, [-1, -1, 1])).toBe(true)

    const selection = resultSelection(result)
    expect(selection.vertices).toHaveLength(1)
    expect(selection.edges).toEqual([])
    expect(selection.faces).toEqual([])
  })

  it('makes an edge each from two corners, where E would have made a quad', () => {
    const mesh = resultEdit(run('mesh.extrudeVertices', planeCorner([[-1, -1, 0], [1, -1, 0]]), { offset: [0, 0, 1] }))
    expect(counts(mesh)).toEqual({ vertices: 6, edges: 6, faces: 1 })
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('refuses when no vertices are selected', () => {
    expect(run('mesh.extrudeVertices', editContext({ mesh: PLANE })).error).toBe('No vertices are selected.')
  })

  it('replays with another offset', () => {
    expect(hasPoint(resultEdit(run('mesh.extrudeVertices', planeCorner(), { offset: [0, 0, 1] })), [-1, -1, 1])).toBe(true)
    expect(hasPoint(resultEdit(run('mesh.extrudeVertices', planeCorner(), { offset: [0, 2, 0] })), [-1, 1, 0])).toBe(true)
  })
})

describe('extrude to cursor', () => {
  it('drops the new vertex on the point, a click at a time', () => {
    const first = run('mesh.extrudeToCursor', editContext({
      mesh: PLANE,
      vertices: [vertexAt(PLANE, [-1, -1, 0])],
      selectMode: ['vertex'],
    }), { target: [3, 3, 0] })
    const drawn = resultMesh(first)
    expect(counts(resultEdit(first))).toEqual({ vertices: 5, edges: 5, faces: 1 })
    expect(hasPoint(resultEdit(first), [3, 3, 0])).toBe(true)

    // The polyline: what the first click left selected is what the second one extrudes.
    const second = run('mesh.extrudeToCursor', editContext({
      mesh: drawn,
      vertices: resultSelection(first).vertices,
      selectMode: ['vertex'],
    }), { target: [5, 3, 0] })
    const mesh = resultEdit(second)
    expect(counts(mesh)).toEqual({ vertices: 6, edges: 6, faces: 1 })
    expect(hasPoint(mesh, [5, 3, 0])).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('lands a whole face with its middle on the point', () => {
    const mesh = resultEdit(run('mesh.extrudeToCursor', cubeFaces([TOP]), { target: [0, 0, 4] }))
    expect(counts(mesh)).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(isClosed(mesh)).toBe(true)
    expect(faceById(mesh, TOP).centre).toEqual([0, 0, 4])
  })

  it('refuses when nothing is selected', () => {
    expect(run('mesh.extrudeToCursor', editContext({ mesh: PLANE })).error).toBe('Nothing is selected.')
  })

  it('replays with another point', () => {
    const context = cubeFaces([TOP])
    expect(faceById(resultEdit(run('mesh.extrudeToCursor', context, { target: [0, 0, 4] })), TOP).centre)
      .toEqual([0, 0, 4])
    expect(faceById(resultEdit(run('mesh.extrudeToCursor', context, { target: [2, 0, 0] })), TOP).centre)
      .toEqual([2, 0, 0])
  })
})

describe('extrude repeat', () => {
  it('extrudes the region three times in a row', () => {
    const mesh = resultEdit(run('mesh.extrudeRepeat', cubeFaces([TOP]), { offset: [0, 0, 0.5], steps: 3 }))
    // Four vertices, eight edges and four walls per step, on top of the cube.
    expect(counts(mesh)).toEqual({ vertices: 20, edges: 36, faces: 18 })
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    expect(faceById(mesh, TOP).centre).toEqual([0, 0, 2.5])
  })

  it('is one extrusion when it is asked for one step', () => {
    const mesh = resultEdit(run('mesh.extrudeRepeat', cubeFaces([TOP]), { offset: [0, 0, 1], steps: 1 }))
    expect(counts(mesh)).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(faceById(mesh, TOP).centre).toEqual([0, 0, 2])
  })

  it('refuses when nothing is selected', () => {
    expect(run('mesh.extrudeRepeat', editContext({ mesh: CUBE })).error).toBe('Nothing is selected.')
  })

  it('replays with another number of steps', () => {
    const context = cubeFaces([TOP])
    const two = resultEdit(run('mesh.extrudeRepeat', context, { offset: [0, 0, 0.5], steps: 2 }))
    expect(counts(two)).toEqual({ vertices: 16, edges: 28, faces: 14 })
    expect(faceById(two, TOP).centre).toEqual([0, 0, 2])
    const four = resultEdit(run('mesh.extrudeRepeat', context, { offset: [0, 0, 0.5], steps: 4 }))
    expect(faceById(four, TOP).centre).toEqual([0, 0, 3])
  })
})
