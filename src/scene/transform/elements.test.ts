import { describe, expect, it } from 'vitest'
import { meshOf } from '@/scene/document'
import { boxMesh } from '@/scene/mesh/primitives'
import { editContext } from '@/scene/operators/editHarness'
import { applyElementTargets, elementTargetId } from '@/scene/transform/elements'
import type { TransformResult } from '@/scene/transform/session'
import type { Modifier, SceneDocument, SceneObject, Vec3 } from '@/scene/types'

/**
 * Mirror clipping, which is a rule about where a vertex may end up rather than about the mesh, and
 * therefore lives with the code that writes positions back rather than with the modifier.
 *
 * The cube is two metres across the origin, so four of its corners sit at x = −1 and four at
 * x = +1: none of them starts on the plane, and a drag across it is what clipping has to stop.
 */

function scene(modifiers: Modifier[]): { document: SceneDocument; object: SceneObject } {
  const context = editContext({ mesh: boxMesh(2), mode: 'edit' })
  const object = { ...context.document.objects[0]!, modifiers }
  return { document: { ...context.document, objects: [object] }, object }
}

function mirror(params: Modifier['params']): Modifier {
  return {
    id: 'modifier-mirror',
    kind: 'mirror',
    name: 'Mirror',
    enabled: { viewport: true, render: true, editMode: true, onCage: false },
    params: { axisX: true, mergeDistance: 0.001, ...params },
  }
}

/** The world position of one vertex, moved to `to`, as a transform result. */
function move(object: SceneObject, vertexId: number, to: Vec3): TransformResult {
  return { id: elementTargetId(object.id, vertexId), transform: { position: to, rotation: [0, 0, 0], scale: [1, 1, 1] } }
}

function positionOf(document: SceneDocument, object: SceneObject, vertexId: number): Vec3 {
  const mesh = meshOf(document, object)!
  const slot = mesh.vertexIds.indexOf(vertexId)
  return [mesh.vertices[slot * 3]!, mesh.vertices[slot * 3 + 1]!, mesh.vertices[slot * 3 + 2]!]
}

describe('mirror clipping', () => {
  it('lets a vertex move freely when no modifier asks for it', () => {
    const { document, object } = scene([mirror({ clipping: false })])
    const id = meshOf(document, object)!.vertexIds[0]!
    const before = positionOf(document, object, id)
    const across: Vec3 = [-before[0]! * 2, before[1]!, before[2]!]
    const next = applyElementTargets(document, [move(object, id, across)])
    expect(positionOf(next, object, id)[0]).toBeCloseTo(across[0], 6)
  })

  it('stops a vertex at the plane instead of letting it cross', () => {
    const { document, object } = scene([mirror({ clipping: true })])
    const mesh = meshOf(document, object)!
    const positive = mesh.vertexIds.find((_, slot) => mesh.vertices[slot * 3]! > 0)!
    const next = applyElementTargets(document, [move(object, positive, [-3, 0.5, 0.25])])
    const landed = positionOf(next, object, positive)
    expect(landed[0]).toBeCloseTo(0, 6)
    // Only the axis it would have crossed is held: the drag's other two components are kept.
    expect(landed[1]).toBeCloseTo(0.5, 6)
    expect(landed[2]).toBeCloseTo(0.25, 6)
  })

  it('leaves a vertex alone while it stays on its own side', () => {
    const { document, object } = scene([mirror({ clipping: true })])
    const mesh = meshOf(document, object)!
    const positive = mesh.vertexIds.find((_, slot) => mesh.vertices[slot * 3]! > 0)!
    const next = applyElementTargets(document, [move(object, positive, [0.25, 0, 0])])
    expect(positionOf(next, object, positive)[0]).toBeCloseTo(0.25, 6)
  })

  it('holds a vertex that started on the plane onto it', () => {
    const { document, object } = scene([mirror({ clipping: true, mergeDistance: 0.01 })])
    const mesh = meshOf(document, object)!
    const first = mesh.vertexIds[0]!
    // Put it on the seam first, with clipping off, so the test moves a vertex that starts there.
    const seated = applyElementTargets(
      { ...document, objects: [{ ...object, modifiers: [] }] },
      [move(object, first, [0, 1, 1])],
    )
    const onSeam = { ...seated, objects: [object] }
    const next = applyElementTargets(onSeam, [move(object, first, [0.9, 1, 1])])
    expect(positionOf(next, object, first)[0]).toBeCloseTo(0, 6)
    expect(positionOf(next, object, first)[1]).toBeCloseTo(1, 6)
  })

  it('clips on each switched-on axis, and only those', () => {
    const { document, object } = scene([mirror({ clipping: true, axisX: true, axisZ: true })])
    const mesh = meshOf(document, object)!
    const slot = mesh.vertexIds.findIndex((_, index) => (
      mesh.vertices[index * 3]! > 0 && mesh.vertices[index * 3 + 1]! > 0 && mesh.vertices[index * 3 + 2]! > 0
    ))
    const id = mesh.vertexIds[slot]!
    const next = applyElementTargets(document, [move(object, id, [-2, -2, -2])])
    const landed = positionOf(next, object, id)
    expect(landed[0]).toBeCloseTo(0, 6)
    expect(landed[2]).toBeCloseTo(0, 6)
    expect(landed[1]).toBeCloseTo(-2, 6)
  })

  it('ignores a mirror that is switched off for edit mode', () => {
    const off = mirror({ clipping: true })
    const { document, object } = scene([{ ...off, enabled: { ...off.enabled, editMode: false } }])
    const mesh = meshOf(document, object)!
    const positive = mesh.vertexIds.find((_, slot) => mesh.vertices[slot * 3]! > 0)!
    const next = applyElementTargets(document, [move(object, positive, [-3, 0, 0])])
    expect(positionOf(next, object, positive)[0]).toBeCloseTo(-3, 6)
  })
})
