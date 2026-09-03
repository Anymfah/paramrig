import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import type { MeshData, Vec3 } from '@/scene/types'

/* ------------------------------------------------------------ the canonical meshes */

/** Blender's cube: two metres across, six quads wound counter-clockwise seen from outside. */
function cube(): MeshData {
  const positions: Vec3[] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ]
  return meshFromPolygons(positions, [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ])
}

/** A plane on XY cut into `cuts` quads each way, laid out row by row from the origin. */
function plane(cuts: number): MeshData {
  const side = cuts + 1
  const positions: Vec3[] = []
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) positions.push([column, row, 0])
  }
  const faces: number[][] = []
  for (let row = 0; row < cuts; row += 1) {
    for (let column = 0; column < cuts; column += 1) {
      const corner = row * side + column
      faces.push([corner, corner + 1, corner + side + 1, corner + side])
    }
  }
  return meshFromPolygons(positions, faces)
}

/**
 * An open cylinder along Z with `segments` bands of quads. The caps are left off on purpose: a
 * capped cylinder's rim vertices have three edges, and an edge loop needs four to step through.
 */
function cylinder(radial: number, segments: number): MeshData {
  const positions: Vec3[] = []
  for (let ring = 0; ring <= segments; ring += 1) {
    for (let step = 0; step < radial; step += 1) {
      const angle = (step / radial) * Math.PI * 2
      positions.push([Math.cos(angle), Math.sin(angle), ring - segments / 2])
    }
  }
  const faces: number[][] = []
  for (let ring = 0; ring < segments; ring += 1) {
    for (let step = 0; step < radial; step += 1) {
      const low = ring * radial + step
      const next = ring * radial + ((step + 1) % radial)
      faces.push([low, next, next + radial, low + radial])
    }
  }
  return meshFromPolygons(positions, faces)
}

/** Three quads hinged on one edge, so that one edge has three sides to it. */
function threeFacesOnAnEdge(): MeshData {
  const positions: Vec3[] = [
    [0, 0, 0], [0, 0, 1],
    [1, 0, 0], [1, 0, 1],
    [0, 1, 0], [0, 1, 1],
    [-1, -1, 0], [-1, -1, 1],
  ]
  return meshFromPolygons(positions, [[0, 1, 3, 2], [0, 1, 5, 4], [0, 1, 7, 6]])
}

/** Two quads touching at one corner and nowhere else. Every edge looks fine; the corner does not. */
function bowTie(): MeshData {
  const positions: Vec3[] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [2, 1, 0], [2, 2, 0], [1, 2, 0],
  ]
  return meshFromPolygons(positions, [[0, 1, 2, 3], [2, 4, 5, 6]])
}

/** Two cubes with clear water between them, for the questions about parts. */
function twoCubes(): MeshData {
  const first = cube()
  const near: Vec3[] = []
  for (let slot = 0; slot < 8; slot += 1) {
    near.push([first.vertices[slot * 3]!, first.vertices[slot * 3 + 1]!, first.vertices[slot * 3 + 2]!])
  }
  const positions = [...near, ...near.map((point): Vec3 => [point[0] + 8, point[1], point[2]])]
  const faces = [...first.faces, ...first.faces.map((face) => face.map((slot) => slot + 8))]
  return meshFromPolygons(positions, faces)
}

function eulerCharacteristic(mesh: EditMesh): number {
  return mesh.vertexCount - mesh.edgeCount + mesh.faceCount
}

function expectVector(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 10)
  expect(actual[1]).toBeCloseTo(expected[1], 10)
  expect(actual[2]).toBeCloseTo(expected[2], 10)
}

const ascending = (values: number[]): number[] => [...values].sort((a, b) => a - b)

/* ----------------------------------------------------------------------- building */

describe('building an edit mesh', () => {
  it('reads a cube as eight corners, twelve edges and six quads', () => {
    const mesh = EditMesh.from(cube())

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(6)
    expect(eulerCharacteristic(mesh)).toBe(2)
  })

  it('gives every cube edge two faces and every cube corner three of each', () => {
    const mesh = EditMesh.from(cube())

    for (let edge = 0; edge < mesh.edgeCount; edge += 1) expect(mesh.edgeFaces(edge)).toHaveLength(2)
    for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
      expect(mesh.vertexEdges(vertex)).toHaveLength(3)
      expect(mesh.vertexFaces(vertex)).toHaveLength(3)
    }
  })

  it('lists a face’s edges in step with its corners, so the two can be walked together', () => {
    const mesh = EditMesh.from(plane(4))

    for (let face = 0; face < mesh.faceCount; face += 1) {
      const corners = mesh.faceVertices(face)
      const edges = mesh.faceEdges(face)
      expect(edges).toHaveLength(corners.length)
      for (let index = 0; index < corners.length; index += 1) {
        const from = corners[index]!
        const to = corners[(index + 1) % corners.length]!
        expect(edges[index]).toBe(mesh.edgeSlot(from, to))
      }
    }
  })

  it('keeps no hold on the mesh it was built from, in either direction', () => {
    const source = cube()
    const mesh = EditMesh.from(source)

    source.vertices[0] = 99
    expect(mesh.position(0)[0]).toBe(-1)

    mesh.setPosition(0, [5, 5, 5])
    expect(source.vertices[1]).toBe(-1)

    const data = mesh.toData()
    data.vertices[3] = 42
    expect(mesh.position(1)[0]).toBe(1)
  })

  it('clones into a mesh that can be edited without touching the original', () => {
    const mesh = EditMesh.from(cube())
    const copy = mesh.clone()

    copy.removeVertices([0])

    expect(mesh.vertexCount).toBe(8)
    expect(copy.vertexCount).toBe(7)
  })
})

/* ---------------------------------------------------------------- ids and slots */

describe('identifiers', () => {
  it('finds a vertex by its id, and says so plainly when the id is gone', () => {
    const mesh = EditMesh.from(cube())

    expect(mesh.slotOfVertex(mesh.vertexId(5))).toBe(5)
    expect(mesh.slotOfVertex(404)).toBe(-1)
    expect(mesh.vertexId(99)).toBe(-1)
    expect(mesh.slotOfFace(mesh.faceId(2))).toBe(2)
    expect(mesh.slotOfFace(404)).toBe(-1)
  })

  it('renumbers slots when a vertex goes, and renumbers no identifier at all', () => {
    const mesh = EditMesh.from(cube())
    const before = new Map<number, Vec3>()
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) before.set(mesh.vertexId(slot), mesh.position(slot))

    mesh.removeVertices([0])

    expect(mesh.vertexCount).toBe(7)
    expect(mesh.toData().vertexIds).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(mesh.slotOfVertex(0)).toBe(-1)
    for (const [id, point] of before) {
      if (id === 0) continue
      const slot = mesh.slotOfVertex(id)
      expect(slot).toBeGreaterThanOrEqual(0)
      expect(mesh.position(slot)).toEqual(point)
    }
  })

  it('keeps the identifiers of the faces a deletion did not touch', () => {
    const mesh = EditMesh.from(cube())

    mesh.removeFaces([0, 2])

    expect(mesh.faceCount).toBe(4)
    expect(mesh.toData().faceIds).toEqual([1, 3, 4, 5])
    expect(mesh.slotOfFace(5)).toBe(3)
    expect(mesh.slotOfFace(0)).toBe(-1)
  })

  it('never hands a new vertex the identifier of one that has been removed', () => {
    const mesh = EditMesh.from(cube())

    mesh.removeVertices([0, 1])
    const added = mesh.addVertex([9, 9, 9])

    expect(mesh.vertexId(added)).toBe(8)
    expect(mesh.slotOfVertex(0)).toBe(-1)
    expect(mesh.slotOfVertex(1)).toBe(-1)
    expect(mesh.toData().nextVertexId).toBe(9)
  })

  it('leaves one part’s identifiers where they were while the other part is taken apart', () => {
    const mesh = EditMesh.from(twoCubes())
    const farSide = new Map<number, Vec3>()
    for (let slot = 8; slot < 16; slot += 1) farSide.set(mesh.vertexId(slot), mesh.position(slot))

    mesh.removeVertices([0, 1, 2, 3])

    for (const [id, point] of farSide) {
      expect(mesh.position(mesh.slotOfVertex(id))).toEqual(point)
    }
  })
})

/* ------------------------------------------------------------------- adjacency */

describe('walking a mesh', () => {
  it('finds an edge from its two corners, and refuses the pairs that are not edges', () => {
    const mesh = EditMesh.from(cube())

    const edge = mesh.edgeSlot(0, 1)
    expect(edge).toBeGreaterThanOrEqual(0)
    expect(mesh.edgeSlot(1, 0)).toBe(edge)
    expect(mesh.edgeVertices(edge)).toEqual([0, 1])
    expect(mesh.edgeSlot(0, 6)).toBe(-1)
    expect(mesh.edgeSlot(3, 3)).toBe(-1)
    expect(mesh.edgeVertices(99)).toEqual([-1, -1])
  })

  it('steps round a face’s loop and back again', () => {
    const mesh = EditMesh.from(cube())

    expect(mesh.faceVertices(1)).toEqual([4, 5, 6, 7])
    expect(mesh.loopNext(1, 7)).toBe(4)
    expect(mesh.loopPrev(1, 4)).toBe(7)
    expect(mesh.loopNext(1, 5)).toBe(6)
    expect(mesh.loopNext(1, 0)).toBe(-1)
    expect(mesh.loopPrev(99, 4)).toBe(-1)
  })

  it('hands back copies, so a caller cannot edit the adjacency by accident', () => {
    const mesh = EditMesh.from(cube())

    mesh.vertexEdges(0).push(999)
    mesh.faceVertices(0).push(999)

    expect(mesh.vertexEdges(0)).toHaveLength(3)
    expect(mesh.faceVertices(0)).toHaveLength(4)
  })
})

/* --------------------------------------------------------------- manifoldness */

describe('manifoldness', () => {
  it('calls a cube and a plane manifold', () => {
    expect(EditMesh.from(cube()).isManifold()).toBe(true)
    expect(EditMesh.from(plane(4)).isManifold()).toBe(true)
    expect(EditMesh.from(cylinder(8, 3)).isManifold()).toBe(true)
  })

  it('refuses an edge with three faces on it, and names that edge', () => {
    const mesh = EditMesh.from(threeFacesOnAnEdge())
    const hinge = mesh.edgeSlot(0, 1)

    expect(mesh.edgeFaces(hinge)).toHaveLength(3)
    expect(mesh.isEdgeManifold(hinge)).toBe(false)
    expect(mesh.isManifold()).toBe(false)
  })

  it('refuses a bow-tie even though every one of its edges is beyond reproach', () => {
    const mesh = EditMesh.from(bowTie())

    for (let edge = 0; edge < mesh.edgeCount; edge += 1) expect(mesh.isEdgeManifold(edge)).toBe(true)
    expect(mesh.vertexFaces(2)).toHaveLength(2)
    expect(mesh.isManifold()).toBe(false)
  })

  it('refuses an edge left with no face beside it', () => {
    const mesh = EditMesh.from(cube())

    mesh.removeFaces([0, 1, 2, 3, 4, 5])

    expect(mesh.edgeCount).toBe(12)
    expect(mesh.isEdgeManifold(0)).toBe(false)
    expect(mesh.isManifold()).toBe(false)
  })

  it('counts a closed mesh’s boundary as nothing and an open one’s as its rim', () => {
    expect(EditMesh.from(cube()).boundaryEdges()).toEqual([])
    expect(EditMesh.from(plane(4)).boundaryEdges()).toHaveLength(16)
    expect(EditMesh.from(cylinder(8, 3)).boundaryEdges()).toHaveLength(16)

    const plate = EditMesh.from(plane(1))
    expect(plate.isBoundaryEdge(0)).toBe(true)
    expect(plate.isBoundaryEdge(99)).toBe(false)
  })
})

/* --------------------------------------------------------------- loops, rings */

describe('edge loops and edge rings', () => {
  it('stops a plane’s loop at the boundary, having crossed the whole row', () => {
    const mesh = EditMesh.from(plane(4))
    const loop = mesh.edgeLoop(mesh.edgeSlot(11, 12))

    expect(loop).toHaveLength(4)
    expect(new Set(loop).size).toBe(4)
    expect(loop).toContain(mesh.edgeSlot(10, 11))
    expect(loop).toContain(mesh.edgeSlot(13, 14))
  })

  it('takes a cylinder’s loop all the way round, and closes it', () => {
    const mesh = EditMesh.from(cylinder(8, 3))
    const loop = mesh.edgeLoop(mesh.edgeSlot(8, 9))

    expect(loop).toHaveLength(8)
    for (let step = 0; step < 8; step += 1) {
      expect(loop).toContain(mesh.edgeSlot(8 + step, 8 + ((step + 1) % 8)))
    }
  })

  it('stops a cylinder’s upright loop at both open ends', () => {
    const mesh = EditMesh.from(cylinder(8, 3))

    expect(mesh.edgeLoop(mesh.edgeSlot(1, 9))).toEqual([
      mesh.edgeSlot(1, 9), mesh.edgeSlot(9, 17), mesh.edgeSlot(17, 25),
    ])
  })

  it('gives a cube no loop beyond the edge itself, every corner being a pole', () => {
    const mesh = EditMesh.from(cube())

    expect(mesh.edgeLoop(mesh.edgeSlot(0, 1))).toEqual([mesh.edgeSlot(0, 1)])
  })

  it('rings a cube in four edges, and comes back to where it started', () => {
    const mesh = EditMesh.from(cube())
    const ring = mesh.edgeRing(mesh.edgeSlot(0, 1))

    expect(ascending(ring)).toEqual(ascending([
      mesh.edgeSlot(0, 1), mesh.edgeSlot(4, 5), mesh.edgeSlot(6, 7), mesh.edgeSlot(2, 3),
    ]))
  })

  it('rings a cylinder’s upright edge round the tube, and its ring edge up the tube', () => {
    const mesh = EditMesh.from(cylinder(8, 3))

    expect(mesh.edgeRing(mesh.edgeSlot(1, 9))).toHaveLength(8)
    expect(ascending(mesh.edgeRing(mesh.edgeSlot(8, 9)))).toEqual(ascending([
      mesh.edgeSlot(0, 1), mesh.edgeSlot(8, 9), mesh.edgeSlot(16, 17), mesh.edgeSlot(24, 25),
    ]))
  })

  it('answers with nothing when asked about an edge that is not there', () => {
    const mesh = EditMesh.from(cube())

    expect(mesh.edgeLoop(99)).toEqual([])
    expect(mesh.edgeRing(99)).toEqual([])
  })
})

/* ------------------------------------------------------------ reach and parts */

describe('what is joined to what', () => {
  it('reaches one cube from a corner of it and stops at the water', () => {
    const mesh = EditMesh.from(twoCubes())

    expect(ascending(mesh.linked(0))).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(mesh.linked(9)).toHaveLength(8)
    expect(mesh.linked(99)).toEqual([])
  })

  it('counts two cubes as two parts, and a lone vertex as a third', () => {
    const mesh = EditMesh.from(twoCubes())
    mesh.addVertex([0, 0, 40])

    const parts = mesh.looseParts()

    expect(parts).toHaveLength(3)
    expect(ascending(parts.map((part) => part.length))).toEqual([1, 8, 8])
  })

  it('walks the shortest way across a grid, and returns empty when there is no way', () => {
    const mesh = EditMesh.from(plane(4))

    expect(mesh.shortestPath(0, 4)).toEqual([0, 1, 2, 3, 4])

    const across = mesh.shortestPath(0, 24)
    expect(across).toHaveLength(9)
    expect(across[0]).toBe(0)
    expect(across[across.length - 1]).toBe(24)
    for (let step = 0; step + 1 < across.length; step += 1) {
      expect(mesh.edgeSlot(across[step]!, across[step + 1]!)).toBeGreaterThanOrEqual(0)
    }

    expect(mesh.shortestPath(7, 7)).toEqual([7])
    expect(mesh.shortestPath(-1, 4)).toEqual([])
    expect(EditMesh.from(twoCubes()).shortestPath(0, 9)).toEqual([])
  })

  it('counts the length of the edges rather than their number', () => {
    // Four short steps along the row, or two very long ones through the vertex out at y = 20.
    const positions: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [2, 20, 0]]
    const mesh = EditMesh.from(meshFromPolygons(positions, [[0, 1, 5], [1, 2, 5], [2, 3, 5], [3, 4, 5]]))

    expect(mesh.shortestPath(0, 4)).toEqual([0, 1, 2, 3, 4])
  })
})

/* --------------------------------------------------------------------- measures */

describe('measuring', () => {
  it('points a cube’s face normals out of the cube', () => {
    const mesh = EditMesh.from(cube())

    expectVector(mesh.faceNormal(1), [0, 0, 1])
    expectVector(mesh.faceNormal(0), [0, 0, -1])
    expectVector(mesh.faceNormal(3), [1, 0, 0])
  })

  it('leans a cube’s corner normal into the corner', () => {
    const mesh = EditMesh.from(cube())
    const share = 1 / Math.sqrt(3)

    expectVector(mesh.vertexNormal(6), [share, share, share])
  })

  it('boxes a cube around the origin', () => {
    expect(EditMesh.from(cube()).bounds()).toEqual({
      min: [-1, -1, -1], max: [1, 1, 1], centre: [0, 0, 0], size: [2, 2, 2],
    })
  })
})

/* ----------------------------------------------------------- building blocks */

describe('the building blocks', () => {
  it('adds a face over new vertices and mints the edges it needs', () => {
    const mesh = EditMesh.from(plane(1))
    const a = mesh.addVertex([2, 0, 0])
    const b = mesh.addVertex([3, 0, 0])
    const c = mesh.addVertex([3, 1, 0])

    const face = mesh.addFace([a, b, c])

    expect(face).toBe(1)
    expect(mesh.faceId(face)).toBe(1)
    expect(mesh.faceCount).toBe(2)
    expect(mesh.faceEdges(face)).toHaveLength(3)
    expect(mesh.edgeSlot(a, b)).toBeGreaterThanOrEqual(0)
    expect(mesh.vertexFaces(a)).toEqual([face])
    expect(mesh.toData().attributes.face.smooth).toEqual([false, false])
  })

  it('reuses an edge a new face shares with an old one', () => {
    const mesh = EditMesh.from(plane(1))
    const before = mesh.edgeCount
    const a = mesh.addVertex([2, 0, 0])
    const b = mesh.addVertex([2, 1, 0])

    mesh.addFace([1, a, b, 3])

    expect(mesh.edgeCount).toBe(before + 3)
    expect(mesh.edgeFaces(mesh.edgeSlot(1, 3))).toHaveLength(2)
    expect(mesh.isManifold()).toBe(true)
  })

  it('refuses a face with fewer than three distinct corners', () => {
    const mesh = EditMesh.from(plane(1))

    expect(mesh.addFace([0, 1])).toBe(-1)
    expect(mesh.addFace([0, 0, 0])).toBe(-1)
    expect(mesh.addFace([0, 1, 99])).toBe(-1)
    expect(mesh.faceCount).toBe(1)
  })

  it('leaves a deleted face’s edges and corners behind', () => {
    const mesh = EditMesh.from(cube())

    mesh.removeFaces([1])

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(5)

    mesh.dropLoose()

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
  })

  it('drops the wire an operator leaves behind, and nothing that is still in use', () => {
    const mesh = EditMesh.from(plane(1))
    const loose = mesh.vertexId(mesh.addVertex([5, 5, 5]))
    mesh.addVertex([6, 5, 5])

    mesh.dropLoose()

    expect(mesh.vertexCount).toBe(4)
    expect(mesh.edgeCount).toBe(4)
    expect(mesh.faceCount).toBe(1)
    expect(mesh.slotOfVertex(loose)).toBe(-1)
  })

  it('drops a whole cube once every face has gone from it', () => {
    const mesh = EditMesh.from(cube())

    mesh.removeFaces([0, 1, 2, 3, 4, 5])
    mesh.dropLoose()

    expect(mesh.vertexCount).toBe(0)
    expect(mesh.edgeCount).toBe(0)
    expect(mesh.toData().vertices).toEqual([])
  })

  it('takes a face with the edge it was hanging from', () => {
    const mesh = EditMesh.from(cube())

    mesh.removeEdges([mesh.edgeSlot(0, 1)])

    expect(mesh.edgeCount).toBe(11)
    expect(mesh.faceCount).toBe(4)
    expect(mesh.vertexCount).toBe(8)
    expect(mesh.toData().faceIds).toEqual([1, 3, 4, 5])
  })

  it('takes the edges and faces of a vertex that goes', () => {
    const mesh = EditMesh.from(cube())

    mesh.removeVertices([0])

    expect(mesh.vertexCount).toBe(7)
    expect(mesh.edgeCount).toBe(9)
    expect(mesh.faceCount).toBe(3)
    expect(mesh.toData().faces.every((face) => face.every((slot) => slot >= 0 && slot < 7))).toBe(true)
  })

  it('does nothing at all when asked to remove what is not there', () => {
    const mesh = EditMesh.from(cube())
    const before = mesh.toData()

    mesh.removeFaces([])
    mesh.removeEdges([99, -1])
    mesh.removeVertices([1.5])

    expect(mesh.toData()).toEqual(before)
  })

  it('turns a face round without moving its first corner or its identifier', () => {
    const mesh = EditMesh.from(cube())

    mesh.flipFace(1)

    expect(mesh.faceVertices(1)).toEqual([4, 7, 6, 5])
    expect(mesh.faceId(1)).toBe(1)
    expectVector(mesh.faceNormal(1), [0, 0, -1])
    expect(mesh.faceEdges(1)).toHaveLength(4)
    expect(mesh.edgeFaces(mesh.edgeSlot(4, 5))).toContain(1)
    expect(mesh.faceEdges(1)[0]).toBe(mesh.edgeSlot(4, 7))
  })

  it('rebuilds an adjacency that still answers after geometry has gone', () => {
    const mesh = EditMesh.from(plane(4))

    mesh.removeFaces([0])
    mesh.dropLoose()

    expect(mesh.faceCount).toBe(15)
    expect(mesh.vertexCount).toBe(24)
    expect(mesh.edgeCount).toBe(38)
    for (let face = 0; face < mesh.faceCount; face += 1) {
      expect(mesh.faceEdges(face)).toHaveLength(4)
      for (const edge of mesh.faceEdges(face)) expect(mesh.edgeFaces(edge)).toContain(face)
    }
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      for (const end of mesh.edgeVertices(edge)) expect(mesh.vertexEdges(end)).toContain(edge)
    }
  })
})
