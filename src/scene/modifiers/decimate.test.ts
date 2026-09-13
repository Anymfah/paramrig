import { initializeBuiltinModifiers } from '@/scene/modifiers'
initializeBuiltinModifiers()
import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh, gridMesh, uvSphereMesh } from '@/scene/mesh/primitives'

import { getModifier, type ModifierOutcome } from '@/scene/modifiers/types'
import { isClosed, isWellFormed } from '@/scene/operators/editHarness'
import type { Modifier, Vec3 } from '@/scene/types'

/*
 * The sphere here is a small one — sixteen segments by eight rings, 128 faces — because what is
 * being tested is the arithmetic of the ratio and the health of what comes back, and both of those
 * are the same on a sphere of five hundred faces and slower to reach.
 */

const module = getModifier('decimate')!

function decimate(mesh: EditMesh, params: Modifier['params'] = {}): ModifierOutcome {
  return module.apply(mesh, { ...module.defaults, ...params }, { inputs: {}, forRender: false, editing: false })
}

/** The points of a mesh, rounded, so that a set of them can be compared. */
function points(mesh: EditMesh): string[] {
  const round = (value: number): number => Math.round(value * 1e6) / 1e6
  const all: string[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    all.push(`${round(point[0])} ${round(point[1])} ${round(point[2])}`)
  }
  return all.sort()
}

describe('the decimate modifier', () => {
  it('collapses a sphere to about half its triangles and leaves it closed', () => {
    const mesh = EditMesh.from(uvSphereMesh({ segments: 16, rings: 8 }))
    expect(mesh.faceCount).toBe(128)

    expect(decimate(mesh, { ratio: 0.5 })).toBeUndefined()

    // Triangulate runs first, so the ratio is half of 224 triangles rather than half of 128 faces.
    // A range rather than a number: each collapse takes exactly two triangles away, and the walk
    // stops early when every remaining edge would tear the surface or fold a neighbour over — so
    // the count lands on the target when there is room and a little above it when there is not.
    expect(mesh.faceCount).toBeGreaterThanOrEqual(112)
    expect(mesh.faceCount).toBeLessThanOrEqual(126)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('leaves the mesh alone at a ratio of one, and refuses a mesh with no faces', () => {
    const mesh = EditMesh.from(uvSphereMesh({ segments: 16, rings: 8 }))

    expect(decimate(mesh, { ratio: 1 })).toBeUndefined()

    expect(mesh.faceCount).toBe(128)
    expect(decimate(EditMesh.from(circleMesh({ vertices: 8, fill: 'none' })), { ratio: 0.5 }))
      .toBe('Decimate needs faces; this mesh has none.')
  })

  it('keeps a sphere symmetric about the axis it is given', () => {
    const mesh = EditMesh.from(uvSphereMesh({ segments: 16, rings: 8 }))

    expect(decimate(mesh, { ratio: 0.5, symmetry: true, symmetryAxis: 'y' })).toBeUndefined()

    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    const here = points(mesh)
    const mirrored: string[] = []
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      const point = mesh.position(slot)
      const round = (value: number): number => Math.round(value * 1e6) / 1e6
      mirrored.push(`${round(point[0])} ${round(-point[1])} ${round(point[2])}`)
    }
    expect(mirrored.sort()).toEqual(here)
  })

  it('merges a subdivided plane back into the one face it is', () => {
    const mesh = EditMesh.from(gridMesh({ xSubdivisions: 4, ySubdivisions: 4, size: 2 }))
    expect(mesh.faceCount).toBe(9)

    expect(decimate(mesh, { mode: 'planar', angleLimit: 5 })).toBeUndefined()

    // Nine coplanar quads are one quad: the twelve inner edges go, the four vertices they held go
    // with them, and the eight left standing in a straight run along the rim are taken out too.
    expect(mesh.faceCount).toBe(1)
    expect(mesh.vertexCount).toBe(4)
    expect(mesh.edgeCount).toBe(4)
    expect(isWellFormed(mesh)).toBe(true)
    const corners: Vec3[] = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]]
    expect(points(mesh)).toEqual(corners.map((point) => point.join(' ')).sort())
  })

  it('leaves a cube alone in planar mode, since none of its faces lie flat against each other', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(decimate(mesh, { mode: 'planar', angleLimit: 5 })).toBeUndefined()

    expect(mesh.faceCount).toBe(6)
    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
  })

  it('takes a level of subdivision off a grid, one to an iteration', () => {
    const once = EditMesh.from(gridMesh({ xSubdivisions: 5, ySubdivisions: 5, size: 4 }))
    const twice = EditMesh.from(gridMesh({ xSubdivisions: 5, ySubdivisions: 5, size: 4 }))

    expect(decimate(once, { mode: 'unsubdivide', iterations: 1 })).toBeUndefined()
    expect(decimate(twice, { mode: 'unsubdivide', iterations: 2 })).toBeUndefined()

    expect(once.faceCount).toBe(4)
    expect(once.vertexCount).toBe(9)
    expect(once.edgeCount).toBe(12)
    expect(isWellFormed(once)).toBe(true)
    expect(twice.faceCount).toBe(1)
    expect(twice.vertexCount).toBe(4)
  })
})
