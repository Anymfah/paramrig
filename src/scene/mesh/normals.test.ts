import { describe, expect, it } from 'vitest'
import { emptyMesh, meshFromPolygons } from '@/scene/mesh/data'
import {
  add,
  cross,
  dot,
  faceArea,
  faceCentre,
  faceNormal,
  faceNormals,
  length,
  meshBounds,
  newellNormal,
  normalize,
  scale,
  subtract,
  vertexNormal,
  vertexNormals,
} from '@/scene/mesh/normals'
import { boxMesh } from '@/scene/mesh/primitives'
import type { MeshData, Vec3 } from '@/scene/types'

/** A plane on Z = 0, one unit across, cut into `divisions` quads each way and wound anticlockwise. */
function gridMesh(divisions: number): MeshData {
  const positions: Vec3[] = []
  for (let row = 0; row <= divisions; row += 1) {
    for (let column = 0; column <= divisions; column += 1) {
      positions.push([column / divisions - 0.5, row / divisions - 0.5, 0])
    }
  }
  const stride = divisions + 1
  const faces: number[][] = []
  for (let row = 0; row < divisions; row += 1) {
    for (let column = 0; column < divisions; column += 1) {
      const corner = row * stride + column
      faces.push([corner, corner + 1, corner + stride + 1, corner + stride])
    }
  }
  return meshFromPolygons(positions, faces)
}

/** Four corners that do not share a plane: opposite corners lifted, the other two left down. */
function saddleQuad(): MeshData {
  return meshFromPolygons([[0, 0, 1], [1, 0, 0], [1, 1, 1], [0, 1, 0]], [[0, 1, 2, 3]])
}

function expectVector(actual: Vec3, expected: Vec3, digits = 6): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits)
  expect(actual[1]).toBeCloseTo(expected[1], digits)
  expect(actual[2]).toBeCloseTo(expected[2], digits)
}

describe('the vector arithmetic', () => {
  it('adds, subtracts and scales one component at a time', () => {
    expect(add([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33])
    expect(subtract([1, 2, 3], [10, 20, 30])).toEqual([-9, -18, -27])
    expect(scale([1, 2, 3], -2)).toEqual([-2, -4, -6])
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32)
    expect(length([3, 4, 0])).toBe(5)
  })

  it('crosses right-handed, the way the winding of a face assumes', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1])
    expect(cross([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1])
  })

  it('leaves a vector of no length alone rather than dividing by zero', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0])
    expect(normalize([0, 0, 4])).toEqual([0, 0, 1])
  })
})

describe('the normal of a loop', () => {
  it('faces the side the loop is wound anticlockwise from', () => {
    expectVector(newellNormal([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]), [0, 0, 1])
  })

  it('turns over when the loop does', () => {
    expectVector(newellNormal([[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]]), [0, 0, -1])
  })

  it('reads the plane of every corner, where two edges would only read three of them', () => {
    const points: Vec3[] = [[0, 0, 1], [1, 0, 0], [1, 1, 1], [0, 1, 0]]

    expectVector(newellNormal(points), [0, 0, 1])
    // The first two edges alone tilt the answer by 55 degrees, which is what Newell is here to avoid.
    expect(dot(normalize(cross(subtract(points[1]!, points[0]!), subtract(points[2]!, points[1]!))), [0, 0, 1])).toBeLessThan(0.6)
  })

  it('answers +Z instead of NaN when every corner sits on one line', () => {
    const normal = newellNormal([[0, 0, 0], [1, 0, 0], [2, 0, 0]])

    expect(normal).toEqual([0, 0, 1])
    expect(normal.every((component) => Number.isFinite(component))).toBe(true)
  })

  it('answers +Z for a loop too short to have a plane', () => {
    expect(newellNormal([])).toEqual([0, 0, 1])
    expect(newellNormal([[0, 0, 0], [1, 0, 0]])).toEqual([0, 0, 1])
  })
})

describe('the faces of a cube', () => {
  it('all point away from the centre', () => {
    const mesh = boxMesh()

    for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
      expect(dot(faceNormal(mesh, faceSlot), faceCentre(mesh, faceSlot))).toBeCloseTo(1, 6)
    }
  })

  it('name the six axis directions once each', () => {
    const mesh = boxMesh()
    const directions = Array.from({ length: mesh.faces.length }, (_, faceSlot) => faceNormal(mesh, faceSlot).join())

    expect(new Set(directions).size).toBe(6)
    expect(directions).toContain('0,0,1')
    expect(directions).toContain('0,0,-1')
  })

  it('sit two metres apart, and measure four square metres each', () => {
    const mesh = boxMesh()

    expectVector(faceCentre(mesh, 1), [0, 0, 1])
    for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
      expect(faceArea(mesh, faceSlot)).toBeCloseTo(4, 6)
    }
  })

  it('report a face nothing answers to as no face at all', () => {
    const mesh = boxMesh()

    expect(faceNormal(mesh, 99)).toEqual([0, 0, 1])
    expect(faceCentre(mesh, 99)).toEqual([0, 0, 0])
    expect(faceArea(mesh, 99)).toBe(0)
  })
})

describe('the area of a face', () => {
  it('measures a triangle by half its base times its height', () => {
    const mesh = meshFromPolygons([[0, 0, 0], [4, 0, 0], [0, 3, 0]], [[0, 1, 2]])

    expect(faceArea(mesh, 0)).toBeCloseTo(6, 6)
  })

  it('measures a face that is not planar on the plane it best fits', () => {
    expect(faceArea(saddleQuad(), 0)).toBeCloseTo(1, 6)
  })

  it('is zero for a face on one line', () => {
    const mesh = meshFromPolygons([[0, 0, 0], [1, 0, 0], [2, 0, 0]], [[0, 1, 2]])

    expect(faceArea(mesh, 0)).toBeCloseTo(0, 12)
  })
})

describe('the normal of a vertex', () => {
  it('splits the difference between the three faces of a cube corner', () => {
    const mesh = boxMesh()
    const corner = mesh.vertices.slice(18, 21)

    expect(corner).toEqual([1, 1, 1])
    expectVector(vertexNormal(mesh, 6), normalize([1, 1, 1]))
  })

  it('stays flat across a subdivided plane', () => {
    const mesh = gridMesh(4)

    for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
      expectVector(vertexNormal(mesh, slot), [0, 0, 1])
    }
  })

  it('ignores a face with no area rather than taking its fallback direction', () => {
    // The sliver shares an edge with the quad; if its +Z fallback counted, the answer would tilt.
    const mesh = meshFromPolygons(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0]],
      [[0, 1, 2, 3], [0, 1, 4]],
    )
    const flat = meshFromPolygons([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 1, 2, 3]])

    expectVector(vertexNormal(mesh, 0), vertexNormal(flat, 0))
  })

  it('gives a loose vertex a direction anyway, so the renderer has something to upload', () => {
    const mesh = meshFromPolygons([[0, 0, 0], [1, 0, 0], [1, 1, 0], [5, 5, 5]], [[0, 1, 2]])

    expect(vertexNormal(mesh, 3)).toEqual([0, 0, 1])
    expect(mesh.vertexIds).toHaveLength(4)
  })
})

describe('the buffers a renderer asks for', () => {
  it('hold three floats per face, in slot order', () => {
    const mesh = boxMesh()
    const buffer = faceNormals(mesh)

    expect(buffer).toHaveLength(mesh.faces.length * 3)
    for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
      const normal = faceNormal(mesh, faceSlot)
      expect(buffer[faceSlot * 3]).toBeCloseTo(normal[0], 5)
      expect(buffer[faceSlot * 3 + 1]).toBeCloseTo(normal[1], 5)
      expect(buffer[faceSlot * 3 + 2]).toBeCloseTo(normal[2], 5)
    }
  })

  it('hold three floats per vertex, and agree with the vertex asked for on its own', () => {
    const mesh = boxMesh()
    const buffer = vertexNormals(mesh)

    expect(buffer).toHaveLength(mesh.vertexIds.length * 3)
    for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
      const normal = vertexNormal(mesh, slot)
      expect(buffer[slot * 3]).toBeCloseTo(normal[0], 5)
      expect(buffer[slot * 3 + 1]).toBeCloseTo(normal[1], 5)
      expect(buffer[slot * 3 + 2]).toBeCloseTo(normal[2], 5)
      expect(Math.hypot(buffer[slot * 3]!, buffer[slot * 3 + 1]!, buffer[slot * 3 + 2]!)).toBeCloseTo(1, 5)
    }
  })

  it('are empty for an empty mesh', () => {
    expect(faceNormals(emptyMesh())).toHaveLength(0)
    expect(vertexNormals(emptyMesh())).toHaveLength(0)
  })
})

describe('the bounds of a mesh', () => {
  it('box a cube of two metres around the origin', () => {
    expect(meshBounds(boxMesh())).toEqual({ min: [-1, -1, -1], max: [1, 1, 1], centre: [0, 0, 0], size: [2, 2, 2] })
  })

  it('are flat on the axis a flat mesh is flat on', () => {
    expect(meshBounds(gridMesh(4)).size).toEqual([1, 1, 0])
  })

  it('sit at the origin when there is nothing to box', () => {
    expect(meshBounds(emptyMesh())).toEqual({ min: [0, 0, 0], max: [0, 0, 0], centre: [0, 0, 0], size: [0, 0, 0] })
  })
})
