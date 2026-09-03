import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh, gridMesh, planeMesh } from '@/scene/mesh/primitives'
import { getModifier } from '@/scene/modifiers/types'
import { euler, isClosed, isConsistentlyWound, isWellFormed, meshVolume } from '@/scene/operators/editHarness'
import type { Vec3 } from '@/scene/types'
import '@/scene/modifiers/subsurf'

/**
 * Subdivision surface, judged by numbers worked out from the shape rather than copied from a run.
 *
 * A cube of side two has 8 corners, 12 edges and 6 faces, so one level is 8 + 12 + 6 = 26 vertices,
 * 2 × 12 + 4 × 6 = 48 edges and 4 × 6 = 24 quads, and the second level is 98, 192 and 96. A corner
 * of that cube lands at five ninths of the way out, which is Catmull–Clark’s own answer for a
 * vertex of valence three, and the middle of every face stays exactly on the face’s centre.
 */

const subsurf = getModifier('subsurf')!

type Params = Record<string, number | string | boolean>

function run(mesh: EditMesh, params: Params = {}, forRender = false): string | void {
  return subsurf.apply(mesh, { ...subsurf.defaults, ...params }, { inputs: {}, forRender, editing: false })
}

/** The slot holding a point, or −1: the only way to name a vertex a modifier has just minted. */
function slotAt(mesh: EditMesh, point: Vec3): number {
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const here = mesh.position(slot)
    if (Math.hypot(here[0] - point[0], here[1] - point[1], here[2] - point[2]) < 1e-9) return slot
  }
  return -1
}

function holds(mesh: EditMesh, point: Vec3): boolean {
  return slotAt(mesh, point) >= 0
}

/** Every edge of the mesh creased to the hilt, which is what a cube with hard edges arrives as. */
function creaseEverything(mesh: EditMesh): void {
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) mesh.setEdgeNumber(edge, 'crease', 1)
}

/** The face looking up, and the four edges around it: the ring the crease test creases. */
function topFace(mesh: EditMesh): number {
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (mesh.faceCentre(face)[2] > 0.99) return face
  }
  return -1
}

describe('the subdivision surface modifier', () => {
  it('turns a cube into twenty-four quads at one level, and leaves it closed', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh)).toBeUndefined()

    expect(mesh.vertexCount).toBe(26)
    expect(mesh.edgeCount).toBe(48)
    expect(mesh.faceCount).toBe(24)
    for (let face = 0; face < mesh.faceCount; face += 1) expect(mesh.faceVertices(face)).toHaveLength(4)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('puts the middle of a face on the face’s own centre, and pulls a corner in to five ninths', () => {
    const mesh = EditMesh.from(boxMesh(2))

    run(mesh)

    expect(holds(mesh, [0, 0, 1])).toBe(true)
    expect(holds(mesh, [0, 0, -1])).toBe(true)
    expect(holds(mesh, [1, 0, 0])).toBe(true)
    expect(holds(mesh, [5 / 9, 5 / 9, 5 / 9])).toBe(true)
    expect(holds(mesh, [-5 / 9, 5 / 9, -5 / 9])).toBe(true)
    // The edge point of a cube edge: the two ends and the two face centres, quartered.
    expect(holds(mesh, [0.75, 0.75, 0])).toBe(true)
  })

  it('counts up again at the second level', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh, { levels: 2 })).toBeUndefined()

    expect(mesh.vertexCount).toBe(98)
    expect(mesh.edgeCount).toBe(192)
    expect(mesh.faceCount).toBe(96)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('cuts without smoothing when Simple is on, so the corners stay at ±1', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh, { simple: true })).toBeUndefined()

    expect(mesh.vertexCount).toBe(26)
    expect(mesh.faceCount).toBe(24)
    expect(holds(mesh, [1, 1, 1])).toBe(true)
    expect(holds(mesh, [-1, -1, -1])).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(8, 10)
  })

  it('keeps a cube exactly when every edge of it is creased to one', () => {
    const mesh = EditMesh.from(boxMesh(2))
    creaseEverything(mesh)

    expect(run(mesh)).toBeUndefined()

    expect(mesh.vertexCount).toBe(26)
    expect(mesh.faceCount).toBe(24)
    for (const corner of [[1, 1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, -1], [-1, -1, -1]] as Vec3[]) {
      expect(holds(mesh, corner)).toBe(true)
    }
    // Every edge kept its own midpoint, so the shape is the cube with each face cut into four.
    expect(holds(mesh, [1, 1, 0])).toBe(true)
    expect(holds(mesh, [0, 1, 1])).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(8, 10)
  })

  it('carries a crease onto both halves of the edge it was on', () => {
    const mesh = EditMesh.from(boxMesh(2))
    creaseEverything(mesh)

    run(mesh)

    const corner = slotAt(mesh, [1, 1, 1])
    const middle = slotAt(mesh, [1, 1, 0])
    expect(corner).toBeGreaterThanOrEqual(0)
    expect(middle).toBeGreaterThanOrEqual(0)
    expect(mesh.edgeNumber(mesh.edgeSlot(corner, middle), 'crease')).toBe(1)
  })

  it('holds a creased ring of edges on its own midpoints, and rounds it off without the crease', () => {
    const creased = EditMesh.from(boxMesh(2))
    for (const edge of creased.faceEdges(topFace(creased))) creased.setEdgeNumber(edge, 'crease', 1)

    run(creased)

    for (const point of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]] as Vec3[]) {
      expect(holds(creased, point)).toBe(true)
    }

    const plain = EditMesh.from(boxMesh(2))
    run(plain)
    expect(holds(plain, [1, 0, 1])).toBe(false)
    expect(holds(plain, [0.75, 0, 0.75])).toBe(true)
  })

  it('ignores the creases when it is told to', () => {
    const mesh = EditMesh.from(boxMesh(2))
    creaseEverything(mesh)

    expect(run(mesh, { useCreases: false })).toBeUndefined()

    expect(holds(mesh, [1, 1, 1])).toBe(false)
    expect(holds(mesh, [5 / 9, 5 / 9, 5 / 9])).toBe(true)
  })

  it('keeps the rim of a plane where it was under “keep corners”', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(run(mesh, { boundarySmooth: 'keep-corners' })).toBeUndefined()

    expect(mesh.vertexCount).toBe(9)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(4)
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
    for (const point of [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 0], [0, -1, 0]] as Vec3[]) {
      expect(holds(mesh, point)).toBe(true)
    }
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) expect(mesh.position(slot)[2]).toBeCloseTo(0, 12)
  })

  it('rounds the corners of the same plane off when the boundary is smoothed in full', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(run(mesh, { boundarySmooth: 'all' })).toBeUndefined()

    expect(mesh.vertexCount).toBe(9)
    expect(holds(mesh, [1, 1, 0])).toBe(false)
    expect(holds(mesh, [0.75, 0.75, 0])).toBe(true)
    // The middle of each rim edge is still exactly where it was: only the corners give way.
    expect(holds(mesh, [1, 0, 0])).toBe(true)
  })

  it('takes the render levels when the evaluation is for the render', () => {
    const viewport = EditMesh.from(boxMesh(2))
    const render = EditMesh.from(boxMesh(2))

    run(viewport)
    run(render, {}, true)

    expect(viewport.vertexCount).toBe(26)
    expect(render.vertexCount).toBe(98)
  })

  it('leaves the mesh alone at level zero', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh, { levels: 0 })).toBeUndefined()

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(6)
  })

  it('gives every quad the material and the shading of the face it came out of', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const top = topFace(mesh)
    mesh.setFaceMaterial(top, 2)
    mesh.setFaceSmooth(top, true)

    run(mesh)

    const above: number[] = []
    const rest: number[] = []
    for (let face = 0; face < mesh.faceCount; face += 1) {
      if (mesh.faceMaterial(face) === 2) above.push(face)
      else rest.push(face)
    }
    // One face of six becomes four of twenty-four, and every one of them is still the top face.
    expect(above).toHaveLength(4)
    expect(rest).toHaveLength(20)
    for (const face of above) {
      expect(mesh.faceSmooth(face)).toBe(true)
      expect(mesh.faceCentre(face)[2]).toBeGreaterThan(0.7)
    }
    for (const face of rest) expect(mesh.faceSmooth(face)).toBe(false)
  })

  it('takes a five-hundred-face grid down two levels and keeps the counts a disk has', () => {
    // 22 × 22 quads: 1 936 faces at one level and 7 744 at two, which is the size the roadmap asks
    // this to stay quick at.
    const mesh = EditMesh.from(gridMesh({ xSubdivisions: 23, ySubdivisions: 23 }))
    expect(mesh.faceCount).toBe(484)

    expect(run(mesh, { levels: 2 })).toBeUndefined()

    expect(mesh.vertexCount).toBe(7921)
    expect(mesh.edgeCount).toBe(15664)
    expect(mesh.faceCount).toBe(7744)
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('refuses a mesh with no faces, and says so', () => {
    const mesh = EditMesh.from(circleMesh({ vertices: 8 }))

    expect(run(mesh)).toBe('Subdivision surface needs faces; this mesh has none.')
  })

  it('refuses the level that would pass two million faces, and names it', () => {
    // A hundred vertices a side is 9 801 quads: 39 204 faces at one level, and 2 509 056 at four.
    const mesh = EditMesh.from(gridMesh({ xSubdivisions: 100, ySubdivisions: 100 }))

    expect(run(mesh, { levels: 4 })).toBe(
      'Subdivision stops at two million faces: level 4 would build 2509056. Use level 3 or fewer.',
    )
    // Refused means untouched: the mesh is not left half-built.
    expect(mesh.faceCount).toBe(9801)
  })
})
