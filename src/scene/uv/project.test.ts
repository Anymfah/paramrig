import { describe, expect, it } from 'vitest'
import { boxMesh, cylinderMesh, planeMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import { loopCount, loopStarts } from '@/scene/mesh/uv'
import {
  cubeProjection,
  cylinderProjection,
  dominantAxis,
  planarProjection,
  resetProjection,
  sphereProjection,
} from '@/scene/uv/project'
import type { MeshData } from '@/scene/types'

/**
 * The projections.
 *
 * What is worth testing is not the arithmetic but the two properties a projection has to have:
 * every corner gets a number, and a face never comes apart — which on anything that wraps means
 * the seam repair, the only part of this that is not obvious.
 */

/** Every corner of a face, as [u, v] pairs. */
function faceUvs(mesh: MeshData, data: number[], face: number): Array<[number, number]> {
  const start = loopStarts(mesh)[face]!
  return mesh.faces[face]!.map((_, corner) => [data[(start + corner) * 2]!, data[(start + corner) * 2 + 1]!])
}

describe('every projection', () => {
  const mesh = boxMesh()
  const projections = {
    cube: cubeProjection(mesh),
    cylinder: cylinderProjection(mesh),
    sphere: sphereProjection(mesh),
    planar: planarProjection(mesh),
    reset: resetProjection(mesh),
  }

  it('gives two numbers for every corner of the mesh', () => {
    for (const [name, data] of Object.entries(projections)) {
      expect(data.length, name).toBe(loopCount(mesh) * 2)
      expect(data.every((value) => Number.isFinite(value)), name).toBe(true)
    }
  })
})

describe('reset, which is what a box is born with', () => {
  it('puts every quad on the whole square', () => {
    const mesh = boxMesh()
    const data = resetProjection(mesh)
    expect(faceUvs(mesh, data, 0)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]])
    expect(faceUvs(mesh, data, 5)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]])
  })

  it('lays a face that is not a quad round the same square', () => {
    const mesh: MeshData = {
      ...planeMesh(),
      faces: [[0, 1, 2]],
      faceIds: [0],
      attributes: { face: { smooth: [false], material: [0] }, edge: {}, vertex: {}, loop: {} },
    }
    const data = resetProjection(mesh)
    expect(data).toHaveLength(6)
    expect(data[0]).toBeCloseTo(1, 5)
    expect(data[1]).toBeCloseTo(0.5, 5)
  })
})

describe('cube projection', () => {
  it('gives each face of a box a unit square, whichever way it faces', () => {
    const mesh = boxMesh(2)
    const data = cubeProjection(mesh)
    for (let face = 0; face < mesh.faces.length; face += 1) {
      const corners = faceUvs(mesh, data, face)
      const us = corners.map(([u]) => u)
      const vs = corners.map(([, v]) => v)
      expect(Math.max(...us) - Math.min(...us), `face ${face} u`).toBeCloseTo(1, 5)
      expect(Math.max(...vs) - Math.min(...vs), `face ${face} v`).toBeCloseTo(1, 5)
    }
  })

  it('scales with the mesh rather than with the world, so a small box is not a small image', () => {
    const small = cubeProjection(boxMesh(0.2))
    const large = cubeProjection(boxMesh(20))
    expect(small.slice(0, 8)).toEqual(large.slice(0, 8))
  })

  it('reads a normal for the axis it points along', () => {
    expect(dominantAxis([0.9, 0.1, 0])).toBe(0)
    expect(dominantAxis([0, -1, 0.2])).toBe(1)
    expect(dominantAxis([0.3, 0.3, -0.9])).toBe(2)
  })
})

describe('the projections that wrap', () => {
  it('keeps the side faces of a cylinder in one piece across the seam', () => {
    const mesh = cylinderMesh({ vertices: 8, radius: 1, depth: 2 })
    const data = cylinderProjection(mesh)
    // The two caps are excluded on purpose: a cap goes all the way round the axis, so there is no
    // angle it can be given. Blender's cylinder projection stretches them in exactly the same way,
    // and the answer to a cap is a different projection rather than a cleverer seam.
    const sides = mesh.faces.map((_, face) => face).filter((face) => mesh.faces[face]!.length === 4)
    expect(sides.length).toBe(8)
    for (const face of sides) {
      const us = faceUvs(mesh, data, face).map(([u]) => u)
      expect(Math.max(...us) - Math.min(...us), `face ${face}`).toBeLessThan(0.5)
    }
  })

  it('keeps a sphere’s faces in one piece too, poles included', () => {
    const mesh = uvSphereMesh({ segments: 12, rings: 6 })
    const data = sphereProjection(mesh)
    for (let face = 0; face < mesh.faces.length; face += 1) {
      const us = faceUvs(mesh, data, face).map(([u]) => u)
      expect(Math.max(...us) - Math.min(...us), `face ${face}`).toBeLessThan(0.5)
    }
  })

  it('runs the sphere from pole to pole down the v axis', () => {
    const mesh = uvSphereMesh({ segments: 8, rings: 4 })
    const data = sphereProjection(mesh)
    const vs = data.filter((_, index) => index % 2 === 1)
    expect(Math.min(...vs)).toBeCloseTo(0, 3)
    expect(Math.max(...vs)).toBeCloseTo(1, 3)
  })
})

describe('planar projection', () => {
  it('lays a plane on the square, the long side filling it', () => {
    const mesh = planeMesh(2)
    const data = planarProjection(mesh, 2)
    expect(faceUvs(mesh, data, 0)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]])
  })

  it('projects along the axis it is given', () => {
    const mesh = boxMesh(2)
    const alongX = planarProjection(mesh, 0)
    const alongZ = planarProjection(mesh, 2)
    expect(alongX).not.toEqual(alongZ)
    expect(alongX).toHaveLength(alongZ.length)
  })
})
