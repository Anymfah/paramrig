import { initializeBuiltinModifiers } from '@/scene/modifiers'
initializeBuiltinModifiers()
import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { gridMesh, planeMesh } from '@/scene/mesh/primitives'
import { getModifier, type ModifierContext, type ModifierOutcome } from '@/scene/modifiers/types'

import { euler, isClosed, isWellFormed, meshVolume } from '@/scene/operators/editHarness'
import type { Modifier } from '@/scene/types'

/**
 * Wireframe as a modifier, judged by the bars it leaves behind.
 *
 * A bar along a two-metre edge is that edge less a setback at each end, by the thickness square, so
 * four of them round a two-metre sheet enclose 4 × (2 − t) × t². The number is worked out from the
 * shape here rather than copied from a run, and it is what catches a setback that has stopped
 * following the corner or a section that has stopped being square.
 */

function wireframe(
  mesh: EditMesh,
  params: Modifier['params'] = {},
  context: Partial<ModifierContext> = {},
): ModifierOutcome {
  const module = getModifier('wireframe')!
  return module.apply(mesh, { ...module.defaults, ...params }, {
    inputs: {},
    forRender: false,
    editing: false,
    ...context,
  })
}

describe('the wireframe modifier', () => {
  it('turns a plane’s four edges into four closed bars and drops the sheet', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(wireframe(mesh, { thickness: 0.1 })).toBeUndefined()

    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    // Four boxes: eight vertices, twelve edges and six faces each, standing apart from each other.
    expect(mesh.vertexCount).toBe(4 * 8)
    expect(mesh.edgeCount).toBe(4 * 12)
    expect(mesh.faceCount).toBe(4 * 6)
    expect(mesh.looseParts()).toHaveLength(4)
    // Euler is 2 for each closed box and they are separate solids, so it is 2 × 4 for the frame:
    // 32 − 48 + 24. A frame that had grown a hole or lost a lid would not come to eight.
    expect(euler(mesh)).toBe(8)
    // Each bar is two metres less an even setback of half the thickness at each right-angled end.
    expect(meshVolume(mesh)).toBeCloseTo(4 * (2 - 0.1) * 0.1 * 0.1, 10)
  })

  it('keeps the surface when it is told not to replace the original', () => {
    const mesh = EditMesh.from(planeMesh(2))

    wireframe(mesh, { thickness: 0.1, replace: false })

    expect(isWellFormed(mesh)).toBe(true)
    expect(mesh.faceCount).toBe(4 * 6 + 1)
    expect(mesh.vertexCount).toBe(4 * 8 + 4)
    expect(mesh.looseParts()).toHaveLength(5)
  })

  it('scales the bars by the edges around them when relative is on', () => {
    const mesh = EditMesh.from(planeMesh(2))

    wireframe(mesh, { thickness: 0.1, relative: true })

    // Every corner of the sheet has two two-metre edges on it, so a tenth becomes two tenths.
    expect(isClosed(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(4 * (2 - 0.2) * 0.2 * 0.2, 10)
  })

  it('wires only the edges inside a grid when the rim is left out', () => {
    // Nine vertices in a three-by-three grid: eight edges round the outside, four across the middle.
    const mesh = EditMesh.from(gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 }))

    wireframe(mesh, { thickness: 0.1, boundary: false })

    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(mesh.faceCount).toBe(4 * 6)
    expect(mesh.looseParts()).toHaveLength(4)
  })

  it('sends every bar the material offset along from the face its edge was cut from', () => {
    const mesh = EditMesh.from(planeMesh(2))

    wireframe(mesh, { thickness: 0.1, materialOffset: 3 })

    for (let face = 0; face < mesh.faceCount; face += 1) expect(mesh.faceMaterial(face)).toBe(3)
  })

  it('has nothing left to wire when the rim is left out of a sheet', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(wireframe(mesh, { thickness: 0.1, boundary: false }))
      .toBe('Every edge of this mesh is on its rim, and Boundary is switched off.')
  })

  it('refuses a thickness of nothing', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(wireframe(mesh, { thickness: 0 })).toBe('Give Wireframe a thickness; nought has nothing to build.')
  })

  it('says so when the mesh has no edges to wire', () => {
    const mesh = EditMesh.from(planeMesh(2))
    // Taking the edges takes the face with them and leaves four loose vertices: a mesh no primitive
    // makes, and the one thing a wireframe has nothing at all to say about.
    mesh.remove({ edges: [0, 1, 2, 3] })

    expect(wireframe(mesh, { thickness: 0.1 })).toBe('Wireframe needs edges; this mesh has none.')
  })
})
