import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { cylinderMesh, gridMesh, planeMesh } from '@/scene/mesh/primitives'
import { translation } from '@/scene/modifiers/matrix'
import '@/scene/modifiers/simpleDeform'
import { getModifier, type ModifierContext, type ModifierInput, type ModifierOutcome } from '@/scene/modifiers/types'
import { euler, isClosed, isWellFormed } from '@/scene/operators/editHarness'
import type { Modifier, Vec3 } from '@/scene/types'

/*
 * Four deformations with one thing to prove each time: where a named vertex ends up. A tube of four
 * sides is the mesh for three of them because its eight vertices are two rings a person can name —
 * the one that is deformed and the one that is not — and a flat grid is the mesh for the bend
 * because a bend of a flat thing is an arc, and an arc is a circle a test can measure against.
 *
 * The deformation is anchored at the frame's origin, so the standing cases place an origin object
 * at the foot of the tube: that is what makes “the bottom untouched, the top fully turned” true
 * rather than “each end turned half way”, which is what a mesh centred on its origin gives.
 */

const module = getModifier('simpleDeform')!

function run(
  mesh: EditMesh,
  params: Modifier['params'] = {},
  inputs: ModifierContext['inputs'] = {},
): ModifierOutcome {
  return module.apply(mesh, { ...module.defaults, ...params }, { inputs, forRender: false, editing: false })
}

/** An object standing where the deformation should act from. */
function originAt(place: Vec3): ModifierInput {
  return { id: 'empty', name: 'Empty', matrix: translation(place), mesh: null }
}

/** A four-sided tube two metres tall: a ring at −1 and a ring at +1, both of radius one. */
function tube(): EditMesh {
  return EditMesh.from(cylinderMesh({ vertices: 4, radius: 1, depth: 2 }))
}

function slotNear(mesh: EditMesh, point: Vec3): number {
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const here = mesh.position(slot)
    if (Math.hypot(here[0] - point[0], here[1] - point[1], here[2] - point[2]) < 1e-9) return slot
  }
  throw new Error(`No vertex stands at ${point.join(', ')}.`)
}

function expectPosition(mesh: EditMesh, slot: number, expected: Vec3): void {
  const point = mesh.position(slot)
  expect(point[0]).toBeCloseTo(expected[0], 10)
  expect(point[1]).toBeCloseTo(expected[1], 10)
  expect(point[2]).toBeCloseTo(expected[2], 10)
}

function positions(mesh: EditMesh): Vec3[] {
  const points: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) points.push(mesh.position(slot))
  return points
}

describe('the simple deform modifier', () => {
  it('twists a standing tube a quarter turn at the top and leaves its foot alone', () => {
    const mesh = tube()
    const foot = slotNear(mesh, [1, 0, -1])
    const head = slotNear(mesh, [1, 0, 1])

    const outcome = run(mesh, { mode: 'twist', axis: 'z', angle: 90 }, { origin: originAt([0, 0, -1]) })

    expect(outcome).toBeUndefined()
    expectPosition(mesh, foot, [1, 0, -1])
    expectPosition(mesh, head, [0, 1, 1])
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('twists each way about the origin when the mesh is centred on it', () => {
    const mesh = tube()
    const bottom = slotNear(mesh, [1, 0, -1])
    const top = slotNear(mesh, [1, 0, 1])

    run(mesh, { mode: 'twist', axis: 'z', angle: 90 })

    // Half the angle each way: the anchor is the origin, and the tube stands astride it.
    expectPosition(mesh, top, [Math.SQRT1_2, Math.SQRT1_2, 1])
    expectPosition(mesh, bottom, [Math.SQRT1_2, -Math.SQRT1_2, -1])
  })

  it('bends a flat grid onto the arc of a circle', () => {
    const mesh = EditMesh.from(gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 }))
    const near = slotNear(mesh, [-1, 0, 0])
    const middle = slotNear(mesh, [0, 0, 0])
    const far = slotNear(mesh, [1, 0, 0])

    run(mesh, { mode: 'bend', axis: 'z', angle: 90 })

    // Two metres of grid over a quarter turn is a circle of radius 2 ÷ (π ÷ 2), touched at the middle.
    const radius = 4 / Math.PI
    expectPosition(mesh, near, [-radius * Math.SQRT1_2, radius * (1 - Math.SQRT1_2), 0])
    expectPosition(mesh, middle, [0, 0, 0])
    expectPosition(mesh, far, [radius * Math.SQRT1_2, radius * (1 - Math.SQRT1_2), 0])
    for (const slot of [near, middle, far]) {
      const point = mesh.position(slot)
      expect(Math.hypot(point[0], point[1] - radius)).toBeCloseTo(radius, 10)
    }
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([9, 12, 4])
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('tapers a standing tube to nothing at its head', () => {
    const mesh = tube()
    const foot = slotNear(mesh, [1, 0, -1])
    const head = slotNear(mesh, [1, 0, 1])

    // The factor is read along the axis, so a negative one narrows what a positive one widens.
    run(mesh, { mode: 'taper', axis: 'z', factor: -1 }, { origin: originAt([0, 0, -1]) })

    expectPosition(mesh, foot, [1, 0, -1])
    expectPosition(mesh, head, [0, 0, 1])
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('widens the head of a standing tube at a positive factor', () => {
    const mesh = tube()
    const head = slotNear(mesh, [1, 0, 1])

    run(mesh, { mode: 'taper', axis: 'z', factor: 1 }, { origin: originAt([0, 0, -1]) })

    expectPosition(mesh, head, [2, 0, 1])
  })

  it('stretches along the axis and thins the waist across it', () => {
    const mesh = tube()
    const end = slotNear(mesh, [1, 0, -1])
    const waist = slotNear(mesh, [0, 1, -1])

    run(mesh, { mode: 'stretch', axis: 'x', factor: 0.5 })

    expectPosition(mesh, end, [1.5, 0, -1])
    expectPosition(mesh, waist, [0, 0.5, -0.5])
  })

  it('confines the twist to the band between its limits', () => {
    const mesh = tube()
    const bottom = slotNear(mesh, [1, 0, -1])
    const top = slotNear(mesh, [1, 0, 1])

    run(mesh, { mode: 'twist', axis: 'z', angle: 90, limitLow: 0.5, limitHigh: 1 })

    // The band is the upper half, so the lower ring is carried along untouched and the upper one
    // takes the whole angle rather than half of it.
    expectPosition(mesh, bottom, [1, 0, -1])
    expectPosition(mesh, top, [0, 1, 1])
  })

  it('keeps a locked axis exactly where it was', () => {
    const mesh = tube()
    const top = slotNear(mesh, [1, 0, 1])
    const before = positions(mesh)

    run(mesh, { mode: 'twist', axis: 'z', angle: 90, lockX: true })

    expect(mesh.position(top)[0]).toBe(before[top]![0])
    expect(mesh.position(top)[1]).toBeCloseTo(Math.SQRT1_2, 10)
  })

  it('does nothing at all with no angle to twist by', () => {
    const mesh = tube()
    const before = positions(mesh)

    expect(run(mesh, { mode: 'twist', axis: 'z', angle: 0 })).toBeUndefined()

    expect(positions(mesh)).toEqual(before)
  })

  it('refuses an axis the mesh has no length along', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(run(mesh, { mode: 'twist', axis: 'z', angle: 90 }))
      .toBe('The mesh has no length along Z; deform it about another axis.')
  })

  it('refuses two limits at the same place', () => {
    const mesh = tube()

    expect(run(mesh, { mode: 'twist', axis: 'z', angle: 90, limitLow: 0.5, limitHigh: 0.5 }))
      .toBe('The two limits are at the same place; move them apart to leave a band to deform.')
  })

  it('refuses a mesh with no vertices to move', () => {
    const mesh = EditMesh.from(meshFromPolygons([], []))

    expect(run(mesh)).toBe('Simple deform needs vertices to move, and this mesh has none.')
  })
})
