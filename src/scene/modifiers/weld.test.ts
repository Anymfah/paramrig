import { describe, expect, it } from 'vitest'
import { emptyMesh } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { planeMesh } from '@/scene/mesh/primitives'
import { getModifier } from '@/scene/modifiers/types'
import { isWellFormed } from '@/scene/operators/editHarness'
import type { Vec3 } from '@/scene/types'
import '@/scene/modifiers/weld'

/**
 * Weld, judged on a plane whose four corners were each doubled.
 *
 * Eight vertices sitting in four places is what a mirror, an array or an import leaves behind, and
 * a weld has to give the four back — with the face still a quad, the survivors still on ±1, and
 * the doubles gone rather than left loose in the middle of the mesh.
 */

const weld = getModifier('weld')!

type Params = Record<string, number | string | boolean>

function run(mesh: EditMesh, params: Params = {}): string | void {
  return weld.apply(mesh, { ...weld.defaults, ...params }, { inputs: {}, forRender: false, editing: false })
}

/** A two-metre square with a second, unattached copy of each of its corners on top of the first. */
function doubledCorners(offset = 0): EditMesh {
  const mesh = EditMesh.from(planeMesh(2))
  for (let slot = 0; slot < 4; slot += 1) {
    const point = mesh.position(slot)
    mesh.addVertex([point[0] + offset, point[1], point[2]])
  }
  return mesh
}

function points(mesh: EditMesh): Vec3[] {
  const all: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) all.push(mesh.position(slot))
  return all
}

describe('the weld modifier', () => {
  it('gives four corners back to a plane whose corners were doubled', () => {
    const mesh = doubledCorners()
    expect(mesh.vertexCount).toBe(8)

    expect(run(mesh)).toBeUndefined()

    expect(mesh.vertexCount).toBe(4)
    expect(mesh.edgeCount).toBe(4)
    expect(mesh.faceCount).toBe(1)
    expect(mesh.faceVertices(0)).toHaveLength(4)
    expect(isWellFormed(mesh)).toBe(true)
    for (const point of points(mesh)) {
      expect(Math.abs(point[0])).toBeCloseTo(1, 12)
      expect(Math.abs(point[1])).toBeCloseTo(1, 12)
      expect(point[2]).toBeCloseTo(0, 12)
    }
  })

  it('leaves the survivor exactly where it was rather than moving it to the middle', () => {
    const mesh = doubledCorners(0.02)

    expect(run(mesh, { distance: 0.05 })).toBeUndefined()

    expect(mesh.vertexCount).toBe(4)
    // The copies were a fiftieth of a metre along X; the four that stayed are the originals.
    const xs = points(mesh).map((point) => Math.abs(point[0])).sort((a, b) => a - b)
    expect(xs).toEqual([1, 1, 1, 1])
  })

  it('reaches no further than the distance it was given', () => {
    const mesh = doubledCorners(0.02)

    expect(run(mesh, { distance: 0.001 })).toBeUndefined()

    expect(mesh.vertexCount).toBe(8)
    expect(mesh.faceCount).toBe(1)
  })

  it('welds only along an edge in connected mode', () => {
    const mesh = doubledCorners()
    // One of the four copies is joined to the corner it doubles; the other three are not.
    mesh.addEdge(0, 4)

    expect(run(mesh, { mode: 'connected' })).toBeUndefined()

    expect(mesh.vertexCount).toBe(7)
    expect(mesh.faceCount).toBe(1)
    expect(mesh.faceVertices(0)).toHaveLength(4)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('leaves unattached doubles alone in connected mode', () => {
    const mesh = doubledCorners()

    expect(run(mesh, { mode: 'connected' })).toBeUndefined()

    expect(mesh.vertexCount).toBe(8)
  })

  it('says so when there is nothing to weld at all', () => {
    const mesh = EditMesh.from(emptyMesh())

    expect(run(mesh)).toBe('Weld needs vertices; this mesh has none.')
  })
})
