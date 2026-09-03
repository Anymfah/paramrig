import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh } from '@/scene/mesh/primitives'
import '@/scene/operators/boolean'
import {
  allIds,
  editContext,
  euler,
  isClosed,
  isWellFormed,
  meshVolume,
  resultEdit,
  type EditFixture,
} from '@/scene/operators/editHarness'
import { runOperator } from '@/scene/operators/registry'
import type { OperatorContext } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * The boolean family: two solids against each other, and one part of a mesh against the rest.
 *
 * Every volume here is worked out from the shapes rather than copied from a run: two cubes two
 * metres across, the second offset by one metre on each axis, overlap in a cube one metre across.
 * So the union is 8 + 8 − 1 = 15 m³, the difference is 8 − 1 = 7 m³ and the intersection is 1 m³,
 * and a solver that drifts from those numbers is wrong however plausible its mesh looks.
 */

const CUBE = 2 ** 3
const OVERLAP = 1 ** 3

/** The two cubes, the active one at the origin and the other offset, both selected, in object mode. */
function twoCubes(offset: Vec3): OperatorContext {
  const fixture: EditFixture = {
    mesh: boxMesh(2),
    others: [{
      id: 'other',
      mesh: boxMesh(2),
      transform: { position: offset, rotation: [0, 0, 0], scale: [1, 1, 1] },
      selected: true,
    }],
  }
  // The harness builds an edit-mode context because that is what most of the family needs; the
  // object booleans declare no mode and are reached from the Object menu, so they are tested there.
  return { ...editContext(fixture), mode: 'object' }
}

/** Two quads crossing at right angles in one mesh: no primitive makes a cross, and the knife needs one. */
function crossingQuads(): EditFixture {
  const positions: Vec3[] = [
    [-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0],
    [-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1],
  ]
  const mesh = meshFromPolygons(positions, [[0, 1, 2, 3], [4, 5, 6, 7]])
  return { mesh, faces: [mesh.faceIds[0]!], selectMode: ['face'] }
}

describe('mesh.booleanUnion', () => {
  it('fuses two cubes offset by half their size into one closed solid', () => {
    const result = runOperator('mesh.booleanUnion', twoCubes([1, 1, 1]))
    const mesh = resultEdit(result)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(meshVolume(mesh)).toBeCloseTo(CUBE * 2 - OVERLAP, 1)
    expect(meshVolume(mesh) / (CUBE * 2 - OVERLAP)).toBeGreaterThan(0.98)
    expect(meshVolume(mesh) / (CUBE * 2 - OVERLAP)).toBeLessThan(1.02)
  })

  it('recovers flat faces rather than leaving the solver’s triangles', () => {
    const mesh = resultEdit(runOperator('mesh.booleanUnion', twoCubes([1, 1, 1])))
    // Twelve flat faces, six from each cube: three the other cube bites into, which come back as
    // eight-cornered L shapes, and three it leaves alone, which keep six corners because the cut on
    // the neighbouring face lands on their rim. Not one of them is a triangle.
    expect(mesh.faceCount).toBe(12)
    expect(mesh.vertexCount).toBe(32)
    expect(mesh.edgeCount).toBe(42)
    const corners = Array.from({ length: mesh.faceCount }, (_, face) => mesh.faceVertices(face).length)
    expect(corners.filter((count) => count === 8)).toHaveLength(6)
    expect(corners.filter((count) => count === 6)).toHaveLength(6)
  })

  it('takes the other object out of the document, and keeps it when asked to', () => {
    const context = twoCubes([1, 1, 1])
    const consumed = runOperator('mesh.booleanUnion', context)
    expect(consumed.document?.objects).toHaveLength(1)
    expect(consumed.selection?.objectIds).toEqual(['object-under-test'])

    const kept = runOperator('mesh.booleanUnion', context, { keepOthers: true })
    expect(kept.document?.objects).toHaveLength(2)
    expect(meshVolume(resultEdit(kept))).toBeCloseTo(CUBE * 2 - OVERLAP, 1)
  })
})

describe('mesh.booleanDifference', () => {
  it('cuts the other cube out and leaves seven of the eight cubic metres', () => {
    const mesh = resultEdit(runOperator('mesh.booleanDifference', twoCubes([1, 1, 1])))
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(mesh.faceCount).toBe(9)
    expect(meshVolume(mesh)).toBeCloseTo(CUBE - OVERLAP, 1)
  })

  it('refuses when the other object swallows the active one whole', () => {
    const context = { ...editContext({
      mesh: boxMesh(1),
      others: [{ id: 'other', mesh: boxMesh(4), selected: true }],
    }), mode: 'object' as const }
    const result = runOperator('mesh.booleanDifference', context)
    expect(result.error).toBe('The other objects cover this one completely, so nothing would be left of it.')
    expect(result.document).toBeUndefined()
  })
})

describe('mesh.booleanIntersect', () => {
  it('keeps the metre cube the two cubes share', () => {
    const mesh = resultEdit(runOperator('mesh.booleanIntersect', twoCubes([1, 1, 1])))
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(6)
    expect(meshVolume(mesh)).toBeCloseTo(OVERLAP, 2)
    const bounds = mesh.bounds()
    expect(bounds.min.map(Math.round)).toEqual([0, 0, 0])
    expect(bounds.max.map(Math.round)).toEqual([1, 1, 1])
  })

  it('replays against the document as it was, keeping the other cube the second time', () => {
    const context = twoCubes([1, 1, 1])
    expect(runOperator('mesh.booleanIntersect', context).document?.objects).toHaveLength(1)
    const kept = runOperator('mesh.booleanIntersect', context, { keepOthers: true })
    expect(kept.document?.objects).toHaveLength(2)
    expect(meshVolume(resultEdit(kept))).toBeCloseTo(OVERLAP, 2)
  })

  it('refuses, and leaves the mesh alone, when the two objects do not touch', () => {
    const result = runOperator('mesh.booleanIntersect', twoCubes([8, 0, 0]))
    expect(result.error).toBe('The selected objects do not overlap, so there is nothing to intersect.')
    expect(result.document).toBeUndefined()
  })

})

describe('every object boolean', () => {
  it.each(['mesh.booleanUnion', 'mesh.booleanDifference', 'mesh.booleanIntersect'])(
    '%s says what to do when it is handed one object',
    (id) => {
      const context = { ...editContext({ mesh: boxMesh(2) }), mode: 'object' as const }
      expect(runOperator(id, context).error).toBe('Select a second mesh: a boolean needs something to work against.')
    },
  )
})

describe('mesh.intersectKnife', () => {
  it('cuts the selected quad where the other one passes through it', () => {
    const before = crossingQuads()
    const mesh = resultEdit(runOperator('mesh.intersectKnife', editContext(before)))
    expect(isWellFormed(mesh)).toBe(true)
    // The two edges the cutting plane crosses gain a vertex each, and the chord between them turns
    // one quad into two. The cutter itself is not touched.
    expect(mesh.vertexCount).toBe(10)
    expect(mesh.faceCount).toBe(3)
    expect(mesh.edgeCount).toBe(11)
    expect(mesh.looseParts()).toHaveLength(2)
    const cut = mesh.slotOfVertex(8) >= 0 ? mesh.position(mesh.slotOfVertex(8)) : null
    expect(cut?.[1]).toBeCloseTo(0, 10)
  })

  it('tears the pieces apart when separate is on', () => {
    const context = editContext(crossingQuads())
    const mesh = resultEdit(runOperator('mesh.intersectKnife', context, { separate: true }))
    expect(isWellFormed(mesh)).toBe(true)
    expect(mesh.faceCount).toBe(3)
    // The two halves each keep their own copy of the cut, so the quad comes apart into two islands.
    expect(mesh.vertexCount).toBe(12)
    expect(mesh.looseParts()).toHaveLength(3)
  })

  it('needs something unselected to cut with', () => {
    const fixture = crossingQuads()
    const context = editContext({ ...fixture, faces: allIds(fixture.mesh, 'face') })
    expect(runOperator('mesh.intersectKnife', context).error)
      .toBe('Leave some faces unselected: they are what does the cutting.')
  })

  it('says so when the selected faces cross nothing', () => {
    const mesh = boxMesh(2)
    const context = editContext({ mesh, faces: [mesh.faceIds[0]!], selectMode: ['face'] })
    expect(runOperator('mesh.intersectKnife', context).error)
      .toBe('The selected faces do not cross the rest of the mesh.')
  })

  it('refuses in face mode with nothing selected', () => {
    const context = editContext({ mesh: boxMesh(2), selectMode: ['face'] })
    expect(runOperator('mesh.intersectKnife', context).error).toBe('No faces are selected.')
  })
})

describe('the conversion back from the solver', () => {
  it('welds the corners the solver mints per triangle instead of leaving them apart', () => {
    // A cube through the solver comes back as twelve triangles with thirty-six separate corners;
    // eight vertices is the proof the weld ran, and a closed mesh the proof it welded the right ones.
    const result = runOperator('mesh.booleanUnion', twoCubes([0, 0, 0]))
    const mesh = resultEdit(result)
    expect(mesh.vertexCount).toBe(8)
    expect(isClosed(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(CUBE, 2)
  })

  it('leaves a mesh a boolean did not touch exactly as it was', () => {
    const context = twoCubes([1, 1, 1])
    const untouched = EditMesh.from(context.document.meshes['mesh-other']!)
    runOperator('mesh.booleanUnion', context, { keepOthers: true })
    expect(untouched.vertexCount).toBe(8)
    expect(context.document.meshes['mesh-under-test']!.vertexIds).toHaveLength(8)
  })
})
