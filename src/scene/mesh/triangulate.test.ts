import { beforeEach, describe, expect, it } from 'vitest'
import { meshFromPolygons, vertexPosition } from '@/scene/mesh/data'
import { cross, dot, faceArea, faceNormal, length, newellNormal, subtract } from '@/scene/mesh/normals'
import { boxMesh } from '@/scene/mesh/primitives'
import {
  cachedTriangulation,
  clearTriangulationCache,
  triangulateFace,
  triangulateMesh,
  type Triangulation,
} from '@/scene/mesh/triangulate'
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

/** A two-by-two square with one square metre bitten out of its far corner: one reflex corner. */
function lHexagon(): MeshData {
  return meshFromPolygons(
    [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]],
    [[0, 1, 2, 3, 4, 5]],
  )
}

/** One regular n-gon of circumradius one, on Z = 0. */
function ringMesh(sides: number): MeshData {
  const positions: Vec3[] = Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2
    return [Math.cos(angle), Math.sin(angle), 0]
  })
  return meshFromPolygons(positions, [positions.map((_, index) => index)])
}

/** Four corners that do not share a plane: opposite corners lifted, the other two left down. */
function saddleQuad(): MeshData {
  return meshFromPolygons([[0, 0, 1], [1, 0, 0], [1, 1, 1], [0, 1, 0]], [[0, 1, 2, 3]])
}

function faceCorners(mesh: MeshData, faceSlot: number): Vec3[] {
  return (mesh.faces[faceSlot] ?? []).map((slot) => vertexPosition(mesh, slot))
}

function triangleOf(mesh: MeshData, triangulation: Triangulation, triangle: number): Vec3[] {
  return [0, 1, 2].map((corner) => vertexPosition(mesh, triangulation.indices[triangle * 3 + corner]!))
}

function triangleArea(points: Vec3[]): number {
  return length(cross(subtract(points[1]!, points[0]!), subtract(points[2]!, points[0]!))) / 2
}

function centroid(points: Vec3[]): Vec3 {
  return [
    (points[0]![0] + points[1]![0] + points[2]![0]) / 3,
    (points[0]![1] + points[1]![1] + points[2]![1]) / 3,
    (points[0]![2] + points[1]![2] + points[2]![2]) / 3,
  ]
}

/** Ray casting on X and Y, which is enough for the flat polygons these tests check. */
function insideXY(polygon: Vec3[], point: Vec3): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index]!
    const before = polygon[previous]!
    const straddles = current[1] > point[1] !== before[1] > point[1]
    if (!straddles) continue
    const crossing = ((before[0] - current[0]) * (point[1] - current[1])) / (before[1] - current[1]) + current[0]
    if (point[0] < crossing) inside = !inside
  }
  return inside
}

/** How many triangles a mesh owes: one fewer than two per corner, for every face that has area. */
function expectedTriangles(mesh: MeshData): number {
  let total = 0
  for (let faceSlot = 0; faceSlot < mesh.faces.length; faceSlot += 1) {
    if (faceArea(mesh, faceSlot) <= 1e-12) continue
    total += mesh.faces[faceSlot]!.length - 2
  }
  return total
}

beforeEach(() => {
  clearTriangulationCache()
})

describe('triangulating a whole mesh', () => {
  it('cuts each quad of a cube in two', () => {
    const mesh = boxMesh()
    const triangulation = triangulateMesh(mesh)

    expect(triangulation.triangleCount).toBe(12)
    expect(triangulation.indices).toHaveLength(36)
    expect(triangulation.triangleFace).toHaveLength(12)
    expect(triangulation.triangleCorner).toHaveLength(36)
    const perFace = new Map<number, number>()
    for (const faceSlot of triangulation.triangleFace) perFace.set(faceSlot, (perFace.get(faceSlot) ?? 0) + 1)
    expect([...perFace.values()]).toEqual([2, 2, 2, 2, 2, 2])
  })

  it('keeps the winding of every face it had to split', () => {
    for (const mesh of [boxMesh(), gridMesh(3), lHexagon(), ringMesh(100), saddleQuad()]) {
      const triangulation = triangulateMesh(mesh)

      expect(triangulation.triangleCount).toBeGreaterThan(0)
      for (let triangle = 0; triangle < triangulation.triangleCount; triangle += 1) {
        const towards = newellNormal(triangleOf(mesh, triangulation, triangle))
        expect(dot(towards, faceNormal(mesh, triangulation.triangleFace[triangle]!))).toBeGreaterThan(0)
      }
    }
  })

  it('owes one triangle fewer than two per corner, on every face that has area', () => {
    const mixed = meshFromPolygons(
      [
        [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
        [2, 0, 0], [3, 0, 0], [2.5, 1, 0],
        [4, 0, 0], [6, 0, 0], [6, 1, 0], [5, 1, 0], [5, 2, 0], [4, 2, 0],
      ],
      [[0, 1, 2, 3], [4, 5, 6], [7, 8, 9, 10, 11, 12]],
    )

    for (const mesh of [boxMesh(), gridMesh(4), lHexagon(), ringMesh(100), mixed]) {
      expect(triangulateMesh(mesh).triangleCount).toBe(expectedTriangles(mesh))
    }
    expect(triangulateMesh(gridMesh(4)).triangleCount).toBe(32)
    expect(triangulateMesh(ringMesh(100)).triangleCount).toBe(98)
    expect(triangulateMesh(mixed).triangleCount).toBe(7)
  })

  it('says which face and which corner every index came from', () => {
    const mesh = lHexagon()
    const triangulation = triangulateMesh(mesh)

    for (let index = 0; index < triangulation.indices.length; index += 1) {
      const face = mesh.faces[triangulation.triangleFace[Math.floor(index / 3)]!]!
      expect(face[triangulation.triangleCorner[index]!]).toBe(triangulation.indices[index])
    }
  })

  it('covers a subdivided plane exactly once over', () => {
    const mesh = gridMesh(4)
    const triangulation = triangulateMesh(mesh)
    let covered = 0
    for (let triangle = 0; triangle < triangulation.triangleCount; triangle += 1) {
      covered += triangleArea(triangleOf(mesh, triangulation, triangle))
    }

    expect(covered).toBeCloseTo(1, 9)
  })

  it('has nothing to say about a mesh with no faces', () => {
    const triangulation = triangulateMesh(meshFromPolygons([[0, 0, 0], [1, 0, 0]], []))

    expect(triangulation.triangleCount).toBe(0)
    expect(triangulation.indices).toHaveLength(0)
    expect(triangulation.triangleFace).toHaveLength(0)
  })
})

describe('a quad', () => {
  it('splits along its shorter diagonal, whichever of the two that is', () => {
    const wide = meshFromPolygons([[0, 0, 0], [4, 0, 0], [4, 1, 0], [1, 1, 0]], [[0, 1, 2, 3]])
    const rolled = meshFromPolygons([[1, 1, 0], [0, 0, 0], [4, 0, 0], [4, 1, 0]], [[0, 1, 2, 3]])

    expect(triangulateFace(wide, 0)).toEqual([[1, 2, 3], [1, 3, 0]])
    expect(triangulateFace(rolled, 0)).toEqual([[0, 1, 2], [0, 2, 3]])
  })

  it('splits a quad whose corners do not share a plane, both halves facing its own way', () => {
    const mesh = saddleQuad()
    const triangulation = triangulateMesh(mesh)

    expect(triangulation.triangleCount).toBe(2)
    for (let triangle = 0; triangle < 2; triangle += 1) {
      expect(dot(newellNormal(triangleOf(mesh, triangulation, triangle)), faceNormal(mesh, 0))).toBeGreaterThan(0.5)
    }
  })

  it('goes round the reflex corner of a concave quad rather than across it', () => {
    // The arrowhead's shorter diagonal joins its two barbs and passes outside it: the wrong cut, and
    // one that would turn a triangle over as well as cover ground the face does not.
    const arrowhead = meshFromPolygons([[0, 0, 0], [4, -1, 0], [3, 0, 0], [4, 1, 0]], [[0, 1, 2, 3]])
    const triangulation = triangulateMesh(arrowhead)
    const outline = faceCorners(arrowhead, 0)

    expect(triangulation.triangleCount).toBe(2)
    let covered = 0
    for (let triangle = 0; triangle < 2; triangle += 1) {
      const points = triangleOf(arrowhead, triangulation, triangle)
      covered += triangleArea(points)
      expect(insideXY(outline, centroid(points))).toBe(true)
      expect(dot(newellNormal(points), faceNormal(arrowhead, 0))).toBeGreaterThan(0.99)
    }
    expect(covered).toBeCloseTo(3, 9)
    expect(faceArea(arrowhead, 0)).toBeCloseTo(3, 9)
  })
})

describe('a concave n-gon', () => {
  it('keeps every triangle inside the polygon', () => {
    const mesh = lHexagon()
    const triangulation = triangulateMesh(mesh)
    const outline = faceCorners(mesh, 0)

    expect(triangulation.triangleCount).toBe(4)
    for (let triangle = 0; triangle < triangulation.triangleCount; triangle += 1) {
      expect(insideXY(outline, centroid(triangleOf(mesh, triangulation, triangle)))).toBe(true)
    }
  })

  it('covers the polygon and no more of the plane than that', () => {
    const mesh = lHexagon()
    const triangulation = triangulateMesh(mesh)
    let covered = 0
    for (let triangle = 0; triangle < triangulation.triangleCount; triangle += 1) {
      covered += triangleArea(triangleOf(mesh, triangulation, triangle))
    }

    expect(faceArea(mesh, 0)).toBeCloseTo(3, 9)
    expect(covered).toBeCloseTo(3, 9)
  })

  it('faces the way it is wound, even when that is down the negative side of an axis', () => {
    // The flattening keeps the same pair of axes whichever way the normal points, so a face looking
    // down -Z arrives at the ear clipper wound the other way: the triangles have to be turned back.
    const facingDown = meshFromPolygons(
      [[0, 0, 0], [0, 2, 0], [1, 2, 0], [1, 1, 0], [2, 1, 0], [2, 0, 0]],
      [[0, 1, 2, 3, 4, 5]],
    )
    const facingBackwards = meshFromPolygons(
      [[0, 0, 0], [0, 0, 2], [0, 1, 2], [0, 1, 1], [0, 2, 1], [0, 2, 0]],
      [[0, 1, 2, 3, 4, 5]],
    )

    for (const mesh of [facingDown, facingBackwards]) {
      const triangulation = triangulateMesh(mesh)
      let covered = 0

      expect(triangulation.triangleCount).toBe(4)
      for (let triangle = 0; triangle < triangulation.triangleCount; triangle += 1) {
        const points = triangleOf(mesh, triangulation, triangle)
        covered += triangleArea(points)
        expect(dot(newellNormal(points), faceNormal(mesh, 0))).toBeGreaterThan(0.99)
      }
      expect(covered).toBeCloseTo(3, 9)
    }
    expect(faceNormal(facingDown, 0)).toEqual([0, 0, -1])
    expect(faceNormal(facingBackwards, 0)).toEqual([-1, 0, 0])
  })

  it('is cut the same way whichever plane it stands in', () => {
    // The projection drops the axis the normal leans on; a face standing on its edge must survive it.
    const upright = meshFromPolygons(
      [[0, 0, 0], [0, 2, 0], [0, 2, 1], [0, 1, 1], [0, 1, 2], [0, 0, 2]],
      [[0, 1, 2, 3, 4, 5]],
    )
    const triangulation = triangulateMesh(upright)
    let covered = 0
    for (let triangle = 0; triangle < triangulation.triangleCount; triangle += 1) {
      covered += triangleArea(triangleOf(upright, triangulation, triangle))
    }

    expect(triangulation.triangleCount).toBe(4)
    expect(covered).toBeCloseTo(3, 9)
  })
})

describe('a ring of a hundred corners', () => {
  it('comes out as ninety-eight triangles that cover it', () => {
    const mesh = ringMesh(100)
    const triangulation = triangulateMesh(mesh)
    const outline = faceCorners(mesh, 0)
    let covered = 0
    for (let triangle = 0; triangle < triangulation.triangleCount; triangle += 1) {
      const points = triangleOf(mesh, triangulation, triangle)
      covered += triangleArea(points)
      expect(insideXY(outline, centroid(points))).toBe(true)
    }

    expect(triangulation.triangleCount).toBe(98)
    // A regular polygon of circumradius one, which approaches pi from below as the sides multiply.
    expect(covered).toBeCloseTo((100 / 2) * Math.sin((2 * Math.PI) / 100), 9)
  })
})

describe('a face that cannot be triangulated', () => {
  it('gives no triangles rather than throwing', () => {
    const line = meshFromPolygons([[0, 0, 0], [1, 0, 0], [2, 0, 0]], [[0, 1, 2]])
    const triangulation = triangulateMesh(line)

    expect(triangulation.triangleCount).toBe(0)
    expect(triangulation.indices).toHaveLength(0)
    expect(triangulateFace(line, 0)).toEqual([])
  })

  it('leaves the faces around it alone, and is not counted', () => {
    const mesh = meshFromPolygons(
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0]],
      [[0, 1, 2, 3], [0, 1, 4]],
    )
    const triangulation = triangulateMesh(mesh)

    expect(mesh.faces).toHaveLength(2)
    expect(triangulation.triangleCount).toBe(2)
    expect([...triangulation.triangleFace]).toEqual([0, 0])
  })

  it('answers nothing for a face slot the mesh does not have', () => {
    expect(triangulateFace(boxMesh(), 99)).toEqual([])
  })
})

describe('one face on its own', () => {
  it('comes back as vertex slots of that face, not as corner numbers', () => {
    const mesh = gridMesh(2)

    expect(triangulateFace(mesh, 3)).toEqual([[4, 5, 8], [4, 8, 7]])
    expect(mesh.faces[3]).toEqual([4, 5, 8, 7])
  })
})

describe('the cache', () => {
  it('hands back the very same triangulation for the same mesh', () => {
    const mesh = boxMesh()

    expect(cachedTriangulation(mesh)).toBe(cachedTriangulation(mesh))
  })

  it('recognises a mesh it has never seen but that draws the same', () => {
    expect(cachedTriangulation(boxMesh())).toBe(cachedTriangulation(boxMesh()))
  })

  it('builds again once a vertex has moved', () => {
    const mesh = boxMesh()
    const first = cachedTriangulation(mesh)
    mesh.vertices[0] = -5

    const second = cachedTriangulation(mesh)
    expect(second).not.toBe(first)
    expect(second.triangleCount).toBe(12)
  })

  it('is emptied on demand', () => {
    const mesh = boxMesh()
    const first = cachedTriangulation(mesh)
    clearTriangulationCache()

    expect(cachedTriangulation(mesh)).not.toBe(first)
  })

  it('drops its oldest entry rather than growing with the scene', () => {
    const oldest = ringMesh(5)
    const first = cachedTriangulation(oldest)
    for (let sides = 6; sides <= 40; sides += 1) cachedTriangulation(ringMesh(sides))

    expect(cachedTriangulation(oldest)).not.toBe(first)
  })

  it('keeps an entry alive by using it', () => {
    const kept = ringMesh(5)
    const first = cachedTriangulation(kept)
    for (let sides = 6; sides <= 50; sides += 1) {
      cachedTriangulation(ringMesh(sides))
      cachedTriangulation(kept)
    }

    expect(cachedTriangulation(kept)).toBe(first)
  })
})
