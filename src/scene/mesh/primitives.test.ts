import { describe, expect, it } from 'vitest'
import { vertexPosition } from '@/scene/mesh/data'
import {
  dot,
  faceArea,
  faceCentre,
  faceNormal,
  length,
  meshBounds,
  newellNormal,
  normalize,
  subtract,
} from '@/scene/mesh/normals'
import {
  boxMesh,
  circleMesh,
  coneMesh,
  cylinderMesh,
  gridMesh,
  icoSphereMesh,
  paramRigMarkMesh,
  planeMesh,
  torusMesh,
  uvSphereMesh,
} from '@/scene/mesh/primitives'
import type { MeshData, Vec3 } from '@/scene/types'

/* ------------------------------------------------------------- vocabulary */

function counts(mesh: MeshData): { vertices: number; edges: number; faces: number } {
  return { vertices: mesh.vertexIds.length, edges: mesh.edges.length, faces: mesh.faces.length }
}

/** V - E + F: two for a closed surface of genus zero, zero for a torus, one for a disc. */
function euler(mesh: MeshData): number {
  return mesh.vertexIds.length - mesh.edges.length + mesh.faces.length
}

/**
 * How the face loops use each edge. A closed manifold surface uses every edge exactly twice and
 * never walks the same edge the same way twice — the second condition is what makes the winding
 * consistent rather than merely paired.
 */
function edgeUse(mesh: MeshData): { shared: number; boundary: number; crowded: number; consistent: boolean } {
  const sides = new Map<string, number>()
  const walked = new Set<string>()
  let consistent = true
  for (const face of mesh.faces) {
    for (let corner = 0; corner < face.length; corner += 1) {
      const from = face[corner]!
      const to = face[(corner + 1) % face.length]!
      const key = from < to ? `${from}:${to}` : `${to}:${from}`
      sides.set(key, (sides.get(key) ?? 0) + 1)
      const directed = `${from}>${to}`
      if (walked.has(directed)) consistent = false
      walked.add(directed)
    }
  }
  let shared = 0
  let boundary = 0
  let crowded = 0
  for (const uses of sides.values()) {
    if (uses === 2) shared += 1
    else if (uses === 1) boundary += 1
    else crowded += 1
  }
  return { shared, boundary, crowded, consistent }
}

/** A normal that is +Z, without asking a signed zero to compare equal to an unsigned one. */
function expectFacesUp(normal: Vec3): void {
  expect(normal[0]).toBeCloseTo(0, 12)
  expect(normal[1]).toBeCloseTo(0, 12)
  expect(normal[2]).toBeCloseTo(1, 12)
}

/** Every face normal leans away from the point the face is a skin over. */
function expectFacesLookOut(mesh: MeshData, inside: (centre: Vec3) => Vec3 = () => [0, 0, 0]): void {
  expect(mesh.faces.length).toBeGreaterThan(0)
  for (let slot = 0; slot < mesh.faces.length; slot += 1) {
    const centre = faceCentre(mesh, slot)
    const outward = normalize(subtract(centre, inside(centre)))
    expect(dot(faceNormal(mesh, slot), outward)).toBeGreaterThan(0)
  }
}

/**
 * The divergence theorem read backwards: a closed surface whose loops are all wound outward
 * encloses a positive volume, whatever its genus. It is the only outward test a torus can pass,
 * since half of a torus faces its own axis.
 */
function enclosedVolume(mesh: MeshData): number {
  let total = 0
  for (let slot = 0; slot < mesh.faces.length; slot += 1) {
    total += dot(faceCentre(mesh, slot), faceNormal(mesh, slot)) * faceArea(mesh, slot)
  }
  return total / 3
}

function radii(mesh: MeshData): number[] {
  return mesh.vertexIds.map((_, slot) => length(vertexPosition(mesh, slot)))
}

function facePoints(mesh: MeshData, slot: number): Vec3[] {
  return mesh.faces[slot]!.map((corner) => vertexPosition(mesh, corner))
}

/* -------------------------------------------------------------------- flat */

describe('the plane', () => {
  it('is one quad of Blender’s two metres, lying on XY', () => {
    const mesh = planeMesh()

    expect(counts(mesh)).toEqual({ vertices: 4, edges: 4, faces: 1 })
    expect(mesh.faces[0]).toHaveLength(4)
    expect(meshBounds(mesh)).toMatchObject({ min: [-1, -1, 0], max: [1, 1, 0] })
  })

  it('faces up, by the Newell normal of its only loop', () => {
    expectFacesUp(newellNormal(facePoints(planeMesh(), 0)))
  })

  it('is open: its four edges are all boundary, so it is not closed', () => {
    expect(edgeUse(planeMesh())).toMatchObject({ shared: 0, boundary: 4, crowded: 0, consistent: true })
  })

  it('takes its size from the argument', () => {
    expect(meshBounds(planeMesh(5)).size).toEqual([5, 5, 0])
  })
})

describe('the cube', () => {
  it('has eight corners, twelve edges and six quads', () => {
    const mesh = boxMesh()

    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 6 })
    expect(mesh.faces.every((face) => face.length === 4)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('is closed, manifold and wound outward', () => {
    const mesh = boxMesh()

    expect(edgeUse(mesh)).toMatchObject({ shared: 12, boundary: 0, crowded: 0, consistent: true })
    expectFacesLookOut(mesh)
    expect(enclosedVolume(mesh)).toBeCloseTo(8, 6)
  })

  it('takes a size per axis as well as one size for all three', () => {
    expect(meshBounds(boxMesh([1, 2, 4])).size).toEqual([1, 2, 4])
    expect(meshBounds(boxMesh(3)).size).toEqual([3, 3, 3])
  })
})

describe('the grid', () => {
  it('counts subdivisions the way Blender does: ten a side is a hundred vertices and 81 quads', () => {
    const mesh = gridMesh()

    expect(counts(mesh)).toEqual({ vertices: 100, edges: 180, faces: 81 })
    expect(mesh.faces.every((face) => face.length === 4)).toBe(true)
    expect(meshBounds(mesh)).toMatchObject({ min: [-1, -1, 0], max: [1, 1, 0] })
  })

  it('is open, with a boundary of 36 edges all the way round', () => {
    expect(edgeUse(gridMesh())).toMatchObject({ shared: 144, boundary: 36, crowded: 0, consistent: true })
  })

  it('faces up, every quad of it', () => {
    const mesh = gridMesh({ xSubdivisions: 4, ySubdivisions: 3 })

    for (let slot = 0; slot < mesh.faces.length; slot += 1) {
      expectFacesUp(newellNormal(facePoints(mesh, slot)))
    }
  })

  it('changes shape with its two subdivision counts', () => {
    expect(counts(gridMesh({ xSubdivisions: 4, ySubdivisions: 3 }))).toEqual({ vertices: 12, edges: 17, faces: 6 })
    expect(counts(gridMesh({ xSubdivisions: 2, ySubdivisions: 2 }))).toEqual({ vertices: 4, edges: 4, faces: 1 })
  })

  it('refuses a subdivision count below two, which would leave no face at all', () => {
    expect(counts(gridMesh({ xSubdivisions: 0, ySubdivisions: 1 }))).toEqual({ vertices: 4, edges: 4, faces: 1 })
  })
})

describe('the circle', () => {
  it('is a bare loop of 32 vertices by default, with no face', () => {
    const mesh = circleMesh()

    expect(counts(mesh)).toEqual({ vertices: 32, edges: 32, faces: 0 })
    for (const radius of radii(mesh)) expect(radius).toBeCloseTo(1, 12)
  })

  it('closes the loop: every vertex is on exactly two edges', () => {
    const mesh = circleMesh({ vertices: 8 })
    const touches = new Map<number, number>()
    for (const [a, b] of mesh.edges) {
      touches.set(a, (touches.get(a) ?? 0) + 1)
      touches.set(b, (touches.get(b) ?? 0) + 1)
    }

    expect(counts(mesh)).toEqual({ vertices: 8, edges: 8, faces: 0 })
    expect([...touches.values()]).toEqual(new Array(8).fill(2))
  })

  it('fills with one n-gon that faces up', () => {
    const mesh = circleMesh({ fill: 'ngon' })

    expect(counts(mesh)).toEqual({ vertices: 32, edges: 32, faces: 1 })
    expect(mesh.faces[0]).toHaveLength(32)
    expectFacesUp(newellNormal(facePoints(mesh, 0)))
  })

  it('fills with a fan of triangles round an added centre', () => {
    const mesh = circleMesh({ fill: 'triangle-fan' })

    expect(counts(mesh)).toEqual({ vertices: 33, edges: 64, faces: 32 })
    expect(mesh.faces.every((face) => face.length === 3)).toBe(true)
    // A disc: one face short of closed, so Euler lands on one rather than two.
    expect(euler(mesh)).toBe(1)
    expect(vertexPosition(mesh, 32)).toEqual([0, 0, 0])
    for (let slot = 0; slot < mesh.faces.length; slot += 1) {
      expectFacesUp(newellNormal(facePoints(mesh, slot)))
    }
  })

  it('takes its radius and its vertex count', () => {
    const mesh = circleMesh({ vertices: 6, radius: 3, fill: 'ngon' })

    expect(counts(mesh)).toEqual({ vertices: 6, edges: 6, faces: 1 })
    for (const radius of radii(mesh)) expect(radius).toBeCloseTo(3, 12)
  })

  it('refuses fewer than three vertices, which would not be a circle', () => {
    expect(counts(circleMesh({ vertices: 1 }))).toEqual({ vertices: 3, edges: 3, faces: 0 })
  })
})

/* ---------------------------------------------------------------- rounded */

describe('the UV sphere', () => {
  it('matches Blender at 32 segments and 16 rings: 482 vertices, 992 edges, 512 faces', () => {
    const mesh = uvSphereMesh()

    expect(counts(mesh)).toEqual({ vertices: 482, edges: 992, faces: 512 })
    expect(euler(mesh)).toBe(2)
  })

  it('is quads except at the poles, where a ring meets a single vertex', () => {
    const mesh = uvSphereMesh()
    const triangles = mesh.faces.filter((face) => face.length === 3)

    expect(triangles).toHaveLength(64)
    expect(mesh.faces.filter((face) => face.length === 4)).toHaveLength(448)
    expect(mesh.faces.every((face) => face.length === 3 || face.length === 4)).toBe(true)
  })

  it('is closed, manifold and wound outward', () => {
    const mesh = uvSphereMesh({ segments: 12, rings: 8 })

    expect(edgeUse(mesh)).toMatchObject({ boundary: 0, crowded: 0, consistent: true })
    expectFacesLookOut(mesh)
  })

  it('puts every vertex on the sphere', () => {
    for (const radius of radii(uvSphereMesh({ radius: 2.5, segments: 9, rings: 5 }))) {
      expect(radius).toBeCloseTo(2.5, 12)
    }
  })

  it('changes its counts with segments and rings', () => {
    expect(counts(uvSphereMesh({ segments: 8, rings: 4 }))).toEqual({ vertices: 26, edges: 56, faces: 32 })
    // Two rings is the floor: the two triangle fans meet, with no quad between them.
    expect(counts(uvSphereMesh({ segments: 6, rings: 2 }))).toEqual({ vertices: 8, edges: 18, faces: 12 })
  })

  it('arrives shaded smooth, as the plan asks of spheres alone', () => {
    expect(uvSphereMesh({ segments: 4, rings: 3 }).attributes.face.smooth.every(Boolean)).toBe(true)
    expect(boxMesh().attributes.face.smooth.some(Boolean)).toBe(false)
  })
})

describe('the ico sphere', () => {
  it('is a bare icosahedron at one subdivision', () => {
    const mesh = icoSphereMesh({ subdivisions: 1 })

    expect(counts(mesh)).toEqual({ vertices: 12, edges: 30, faces: 20 })
    expect(mesh.faces.every((face) => face.length === 3)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('matches Blender’s default of two subdivisions: 42 vertices, 120 edges, 80 faces', () => {
    expect(counts(icoSphereMesh())).toEqual({ vertices: 42, edges: 120, faces: 80 })
  })

  it('quadruples its faces at every level without leaving a duplicate vertex behind', () => {
    for (let level = 1; level <= 5; level += 1) {
      const faces = 20 * 4 ** (level - 1)
      expect(counts(icoSphereMesh({ subdivisions: level }))).toEqual({
        vertices: faces / 2 + 2,
        edges: (faces * 3) / 2,
        faces,
      })
    }
  })

  it('welds the midpoints of shared edges, so the surface has no boundary', () => {
    const mesh = icoSphereMesh({ subdivisions: 3 })

    expect(edgeUse(mesh)).toMatchObject({ shared: 480, boundary: 0, crowded: 0, consistent: true })
    expect(euler(mesh)).toBe(2)
  })

  it('puts every vertex on the sphere, the subdivided ones included', () => {
    for (const radius of radii(icoSphereMesh({ subdivisions: 3, radius: 4 }))) {
      expect(radius).toBeCloseTo(4, 12)
    }
  })

  it('is wound outward at every level', () => {
    expectFacesLookOut(icoSphereMesh({ subdivisions: 1 }))
    expectFacesLookOut(icoSphereMesh({ subdivisions: 3 }))
  })

  it('clamps the subdivision count to the one to five the plan allows', () => {
    expect(counts(icoSphereMesh({ subdivisions: 0 }))).toEqual(counts(icoSphereMesh({ subdivisions: 1 })))
    expect(counts(icoSphereMesh({ subdivisions: 9 }))).toEqual(counts(icoSphereMesh({ subdivisions: 5 })))
  })
})

/* ----------------------------------------------------------------- swept */

describe('the cylinder', () => {
  it('matches Blender at 32 sides with n-gon caps: 64 vertices, 96 edges, 34 faces', () => {
    const mesh = cylinderMesh()

    expect(counts(mesh)).toEqual({ vertices: 64, edges: 96, faces: 34 })
    expect(euler(mesh)).toBe(2)
    expect(mesh.faces.filter((face) => face.length === 4)).toHaveLength(32)
    expect(mesh.faces.filter((face) => face.length === 32)).toHaveLength(2)
  })

  it('is closed, manifold and wound outward when its caps are on', () => {
    const mesh = cylinderMesh({ vertices: 10 })

    expect(edgeUse(mesh)).toMatchObject({ shared: 30, boundary: 0, crowded: 0, consistent: true })
    expectFacesLookOut(mesh)
  })

  it('stands on Z, a radius from the axis and a depth tall', () => {
    const mesh = cylinderMesh({ radius: 3, depth: 5, vertices: 12 })

    expect(meshBounds(mesh).size[2]).toBeCloseTo(5, 12)
    for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
      const [x, y, z] = vertexPosition(mesh, slot)
      expect(Math.hypot(x, y)).toBeCloseTo(3, 12)
      expect(Math.abs(z)).toBeCloseTo(2.5, 12)
    }
  })

  it('leaves both ends open on fill none, and says so: 64 boundary edges', () => {
    const mesh = cylinderMesh({ fill: 'none' })

    expect(counts(mesh)).toEqual({ vertices: 64, edges: 96, faces: 32 })
    expect(edgeUse(mesh)).toMatchObject({ shared: 32, boundary: 64, crowded: 0, consistent: true })
    // A tube is not a closed surface, so Euler is zero rather than two.
    expect(euler(mesh)).toBe(0)
    expectFacesLookOut(mesh)
  })

  it('adds a centre vertex to each end on a triangle fan', () => {
    const mesh = cylinderMesh({ fill: 'triangle-fan' })

    expect(counts(mesh)).toEqual({ vertices: 66, edges: 160, faces: 96 })
    expect(euler(mesh)).toBe(2)
    expectFacesLookOut(mesh)
  })

  it('changes its counts with the number of sides', () => {
    expect(counts(cylinderMesh({ vertices: 3 }))).toEqual({ vertices: 6, edges: 9, faces: 5 })
    expect(counts(cylinderMesh({ vertices: 64 }))).toEqual({ vertices: 128, edges: 192, faces: 66 })
  })
})

describe('the cone', () => {
  it('matches Blender at 32 sides to a point: 33 vertices, 64 edges, 33 faces', () => {
    const mesh = coneMesh()

    expect(counts(mesh)).toEqual({ vertices: 33, edges: 64, faces: 33 })
    expect(euler(mesh)).toBe(2)
    expect(mesh.faces.filter((face) => face.length === 3)).toHaveLength(32)
    expect(mesh.faces.filter((face) => face.length === 32)).toHaveLength(1)
  })

  it('collapses its top ring to one apex, and puts the base a depth below it', () => {
    const mesh = coneMesh({ vertices: 8, radius1: 2, depth: 6 })
    const apex = mesh.vertexIds.length - 1

    expect(vertexPosition(mesh, apex)).toEqual([0, 0, 3])
    for (let slot = 0; slot < apex; slot += 1) {
      const [x, y, z] = vertexPosition(mesh, slot)
      expect(Math.hypot(x, y)).toBeCloseTo(2, 12)
      expect(z).toBeCloseTo(-3, 12)
    }
  })

  it('is closed, manifold and wound outward', () => {
    const mesh = coneMesh({ vertices: 9 })

    expect(edgeUse(mesh)).toMatchObject({ shared: 18, boundary: 0, crowded: 0, consistent: true })
    expectFacesLookOut(mesh)
  })

  it('becomes a frustum of quads once the top radius is raised', () => {
    const mesh = coneMesh({ radius2: 0.5 })

    expect(counts(mesh)).toEqual({ vertices: 64, edges: 96, faces: 34 })
    expect(mesh.faces.filter((face) => face.length === 4)).toHaveLength(32)
    expectFacesLookOut(mesh)
  })

  it('stands on its point when the base radius is the one that collapses', () => {
    const mesh = coneMesh({ vertices: 12, radius1: 0, radius2: 1 })

    expect(counts(mesh)).toEqual({ vertices: 13, edges: 24, faces: 13 })
    expect(vertexPosition(mesh, 0)).toEqual([0, 0, -1])
    expectFacesLookOut(mesh)
  })

  it('leaves its base open on fill none, and fans it on triangle fan', () => {
    expect(counts(coneMesh({ fill: 'none' }))).toEqual({ vertices: 33, edges: 64, faces: 32 })
    expect(counts(coneMesh({ fill: 'triangle-fan' }))).toEqual({ vertices: 34, edges: 96, faces: 64 })
  })

  it('refuses two collapsed radii, which would be a line and not a mesh', () => {
    expect(counts(coneMesh({ radius1: 0, radius2: 0 }))).toEqual({ vertices: 0, edges: 0, faces: 0 })
  })
})

describe('the torus', () => {
  it('matches Blender at 48 by 12: 576 vertices, 1 152 edges, 576 quads', () => {
    const mesh = torusMesh()

    expect(counts(mesh)).toEqual({ vertices: 576, edges: 1152, faces: 576 })
    expect(mesh.faces.every((face) => face.length === 4)).toBe(true)
  })

  it('is closed and manifold, with the Euler characteristic of a torus rather than a sphere', () => {
    const mesh = torusMesh({ majorSegments: 12, minorSegments: 6 })

    expect(edgeUse(mesh)).toMatchObject({ shared: 144, boundary: 0, crowded: 0, consistent: true })
    expect(euler(mesh)).toBe(0)
  })

  it('keeps every vertex a minor radius from the ring it is swept around', () => {
    const mesh = torusMesh({ majorRadius: 3, minorRadius: 0.5, majorSegments: 16, minorSegments: 8 })

    for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
      const [x, y, z] = vertexPosition(mesh, slot)
      const across = Math.hypot(x, y) - 3
      expect(Math.hypot(across, z)).toBeCloseTo(0.5, 12)
    }
  })

  it('faces away from the tube it is wrapped round, not away from the origin', () => {
    const mesh = torusMesh({ majorSegments: 20, minorSegments: 10 })
    const spine = (centre: Vec3): Vec3 => {
      const across = Math.hypot(centre[0], centre[1])
      return [centre[0] / across, centre[1] / across, 0]
    }

    expectFacesLookOut(mesh, spine)
    expect(enclosedVolume(mesh)).toBeGreaterThan(0)
  })

  it('changes its counts with both segment counts', () => {
    expect(counts(torusMesh({ majorSegments: 8, minorSegments: 4 }))).toEqual({ vertices: 32, edges: 64, faces: 32 })
    expect(counts(torusMesh({ majorSegments: 3, minorSegments: 3 }))).toEqual({ vertices: 9, edges: 18, faces: 9 })
  })
})

describe('the ParamRig mark', () => {
  it('is a few hundred quads and nothing else', () => {
    const mesh = paramRigMarkMesh()

    expect(counts(mesh)).toEqual({ vertices: 384, edges: 768, faces: 384 })
    expect(mesh.faces.every((face) => face.length === 4)).toBe(true)
  })

  it('is closed and manifold, a ring by topology', () => {
    const mesh = paramRigMarkMesh()

    expect(edgeUse(mesh)).toMatchObject({ shared: 768, boundary: 0, crowded: 0, consistent: true })
    expect(euler(mesh)).toBe(0)
  })

  it('is wound outward, which for a closed surface means it encloses a positive volume', () => {
    expect(enclosedVolume(paramRigMarkMesh())).toBeGreaterThan(0)
  })

  it('has no degenerate face for a bevel or an extrude to trip over', () => {
    const mesh = paramRigMarkMesh()

    for (let slot = 0; slot < mesh.faces.length; slot += 1) expect(faceArea(mesh, slot)).toBeGreaterThan(1e-6)
  })

  it('keeps a hole in the middle, and stays inside the two-metre box of the other primitives', () => {
    const mesh = paramRigMarkMesh()
    const inner = Math.min(...mesh.vertexIds.map((_, slot) => {
      const [x, y] = vertexPosition(mesh, slot)
      return Math.hypot(x, y)
    }))

    expect(inner).toBeGreaterThan(0.5)
    expect(meshBounds(mesh).size[0]).toBeLessThanOrEqual(2.6)
    expect(meshBounds(mesh).size[2]).toBeCloseTo(0.22, 12)
  })

  it('is the same mesh every time, since it takes no parameters', () => {
    expect(paramRigMarkMesh().vertices).toEqual(paramRigMarkMesh().vertices)
  })
})

/* ---------------------------------------------------------------- refusals */

describe('a primitive handed a value it cannot use', () => {
  it('falls back to the Blender default rather than making a mesh of NaN', () => {
    expect(counts(circleMesh({ vertices: Number.NaN }))).toEqual(counts(circleMesh()))
    expect(counts(uvSphereMesh({ segments: Number.NaN, rings: Number.NaN }))).toEqual(counts(uvSphereMesh()))
    expect(counts(torusMesh({ majorSegments: Number.POSITIVE_INFINITY }))).toEqual(counts(torusMesh()))
  })

  it('clamps a negative radius to nothing rather than turning the mesh inside out', () => {
    const mesh = circleMesh({ radius: -2, vertices: 4 })

    for (const radius of radii(mesh)) expect(radius).toBe(0)
  })

  it('rounds a fractional count to a whole number of segments', () => {
    expect(counts(circleMesh({ vertices: 7.4 }))).toEqual(counts(circleMesh({ vertices: 7 })))
  })
})
