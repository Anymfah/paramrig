import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import { getModifier } from '@/scene/modifiers/types'
import { euler, isClosed, isWellFormed } from '@/scene/operators/editHarness'
import '@/scene/modifiers/edgeSplit'

/**
 * Edge split, judged by what stops being shared.
 *
 * A cube split along all twelve of its edges is six loose quads: 6 × 4 = 24 vertices, 24 edges and
 * the same 6 faces, with every edge carrying one face and every corner still exactly on ±1 —
 * nothing moves, the mesh only stops being joined up.
 */

const edgeSplit = getModifier('edgeSplit')!

type Params = Record<string, number | string | boolean>

function run(mesh: EditMesh, params: Params = {}): string | void {
  return edgeSplit.apply(mesh, { ...edgeSplit.defaults, ...params }, { inputs: {}, forRender: false, editing: false })
}

/** Whether any edge is still shared, which is exactly what a split is meant to leave behind. */
function sharesAnEdge(mesh: EditMesh): boolean {
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    if (mesh.edgeFaces(edge).length > 1) return true
  }
  return false
}

/** The four edges around the face looking up. */
function topEdges(mesh: EditMesh): number[] {
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (mesh.faceCentre(face)[2] > 0.99) return mesh.faceEdges(face)
  }
  return []
}

describe('the edge split modifier', () => {
  it('takes a cube apart into six loose quads at thirty degrees', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh, { angle: 30 })).toBeUndefined()

    expect(mesh.vertexCount).toBe(24)
    expect(mesh.edgeCount).toBe(24)
    expect(mesh.faceCount).toBe(6)
    expect(sharesAnEdge(mesh)).toBe(false)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(false)
    expect(euler(mesh)).toBe(6)
  })

  it('leaves every corner exactly where it was', () => {
    const mesh = EditMesh.from(boxMesh(2))

    run(mesh, { angle: 30 })

    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      for (const value of mesh.position(slot)) expect(Math.abs(value)).toBeCloseTo(1, 12)
    }
  })

  it('splits only the edges marked sharp when the angle is switched off', () => {
    const mesh = EditMesh.from(boxMesh(2))
    for (const edge of topEdges(mesh)) mesh.setEdgeFlag(edge, 'sharp', true)

    expect(run(mesh, { useAngle: false, useSharp: true })).toBeUndefined()

    // The top face lifts off and the other five stay joined: four corners doubled, no more.
    expect(mesh.vertexCount).toBe(12)
    expect(mesh.edgeCount).toBe(16)
    expect(mesh.faceCount).toBe(6)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('says so when no fold is wide enough and nothing is marked sharp', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh, { angle: 120 })).toBe('No edge here is sharp enough to split.')
    expect(mesh.vertexCount).toBe(8)
  })

  it('says so when a sheet has no shared edge to split at all', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(run(mesh, { angle: 1 })).toBe('No edge here is sharp enough to split.')
    expect(mesh.faceCount).toBe(1)
  })

  it('says so when both tests are switched off', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh, { useAngle: false, useSharp: false })).toBe(
      'Edge split needs an angle or the sharp edges; both are switched off.',
    )
    expect(mesh.vertexCount).toBe(8)
  })
})
