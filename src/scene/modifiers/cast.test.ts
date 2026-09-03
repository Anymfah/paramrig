import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, gridMesh, torusMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import '@/scene/modifiers/cast'
import { translation } from '@/scene/modifiers/matrix'
import { getModifier, type ModifierContext, type ModifierOutcome } from '@/scene/modifiers/types'
import { euler, isClosed, isWellFormed } from '@/scene/operators/editHarness'
import type { Modifier, Vec3 } from '@/scene/types'

/*
 * A cast is a blend towards a shape, so every case here is a position that can be written down: the
 * radius a vertex ends at, the box side it lands on, the halfway point at half a factor. The two
 * numbers that read alike are tested apart — the radius as a limit on which vertices are touched,
 * the size as how big the shape is — because that is where Blender's panel is easiest to misread.
 */

const module = getModifier('cast')!

function run(
  mesh: EditMesh,
  params: Modifier['params'] = {},
  inputs: ModifierContext['inputs'] = {},
): ModifierOutcome {
  return module.apply(mesh, { ...module.defaults, ...params }, { inputs, forRender: false, editing: false })
}

function positions(mesh: EditMesh): Vec3[] {
  const points: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) points.push(mesh.position(slot))
  return points
}

function distanceFrom(point: Vec3, centre: Vec3 = [0, 0, 0]): number {
  return Math.hypot(point[0] - centre[0], point[1] - centre[1], point[2] - centre[2])
}

/** The slot standing at a place, so a case can name a vertex by where it is rather than by its number. */
function slotNear(mesh: EditMesh, point: Vec3): number {
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    if (distanceFrom(mesh.position(slot), point) < 1e-9) return slot
  }
  throw new Error(`No vertex stands at ${point.join(', ')}.`)
}

describe('the cast modifier', () => {
  it('puts every vertex of a torus on one sphere, and changes no count', () => {
    const mesh = EditMesh.from(torusMesh({ majorSegments: 8, minorSegments: 6 }))

    expect(run(mesh, { castType: 'sphere', factor: 1, size: 1 })).toBeUndefined()

    for (const point of positions(mesh)) expect(distanceFrom(point)).toBeCloseTo(1, 3)
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([48, 96, 48])
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(0)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('stops halfway at half a factor', () => {
    const half = EditMesh.from(boxMesh(2))
    const whole = EditMesh.from(boxMesh(2))
    const before = positions(half)

    run(half, { castType: 'sphere', factor: 0.5, size: 1 })
    run(whole, { castType: 'sphere', factor: 1, size: 1 })

    for (let slot = 0; slot < half.vertexCount; slot += 1) {
      const midpoint = before[slot]!.map((value, axis) => (value + whole.position(slot)[axis]!) / 2)
      expect(half.position(slot)[0]).toBeCloseTo(midpoint[0]!, 10)
      expect(half.position(slot)[1]).toBeCloseTo(midpoint[1]!, 10)
      expect(half.position(slot)[2]).toBeCloseTo(midpoint[2]!, 10)
    }
    expect([half.vertexCount, half.edgeCount, half.faceCount]).toEqual([8, 12, 6])
  })

  it('takes the size from the mesh when none is given', () => {
    const mesh = EditMesh.from(gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 }))
    mesh.setPosition(slotNear(mesh, [0, 0, 0]), [0, 0, 3])
    const average = positions(mesh).reduce((total, point) => total + distanceFrom(point), 0) / mesh.vertexCount

    run(mesh, { castType: 'sphere', factor: 1, size: 0 })

    for (const point of positions(mesh)) expect(distanceFrom(point)).toBeCloseTo(average, 10)
  })

  it('casts to a cylinder about Z, leaving the heights alone', () => {
    const mesh = EditMesh.from(boxMesh(2))

    run(mesh, { castType: 'cylinder', factor: 1, size: 1 })

    for (const point of positions(mesh)) {
      expect(Math.hypot(point[0], point[1])).toBeCloseTo(1, 10)
      expect(Math.abs(point[2])).toBeCloseTo(1, 10)
    }
    expect(isClosed(mesh)).toBe(true)
  })

  it('casts a sphere onto the sides and corners of a box', () => {
    const mesh = EditMesh.from(uvSphereMesh({ segments: 8, rings: 4, radius: 1 }))
    const corner = slotNear(mesh, [Math.SQRT1_2, Math.SQRT1_2, 0])

    run(mesh, { castType: 'cuboid', factor: 1, size: 1 })

    for (const point of positions(mesh)) {
      expect(Math.max(Math.abs(point[0]), Math.abs(point[1]), Math.abs(point[2]))).toBeCloseTo(1, 10)
    }
    // The vertex that stood between two sides ends where they meet, on the box's edge.
    expect(mesh.position(corner)[0]).toBeCloseTo(1, 10)
    expect(mesh.position(corner)[1]).toBeCloseTo(1, 10)
    expect(mesh.position(corner)[2]).toBeCloseTo(0, 10)
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([26, 56, 32])
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('casts about the object it is given rather than about the origin', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const centre: Vec3 = [1, 0, 0]

    run(mesh, { castType: 'sphere', factor: 1, size: 1 }, {
      object: { id: 'empty', name: 'Empty', matrix: translation(centre), mesh: null },
    })

    for (const point of positions(mesh)) expect(distanceFrom(point, centre)).toBeCloseTo(1, 10)
  })

  it('touches only the vertices inside the radius', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const before = positions(mesh)

    // The corners of a two metre cube stand at √3 from its middle, so a limit of one leaves them all.
    run(mesh, { castType: 'sphere', factor: 1, size: 1, radius: 1 })

    expect(positions(mesh)).toEqual(before)
  })

  it('uses the radius as the size when it is asked to', () => {
    const mesh = EditMesh.from(boxMesh(2))

    run(mesh, { castType: 'sphere', factor: 1, radius: 2, useRadiusAsSize: true })

    for (const point of positions(mesh)) expect(distanceFrom(point)).toBeCloseTo(2, 10)
  })

  it('leaves the axes that are switched off exactly where they were', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const before = positions(mesh)

    run(mesh, { castType: 'sphere', factor: 1, size: 1, axisZ: false })

    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      expect(mesh.position(slot)[2]).toBe(before[slot]![2])
      expect(mesh.position(slot)[0]).not.toBe(before[slot]![0])
    }
  })

  it('refuses when every axis is switched off', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh, { axisX: false, axisY: false, axisZ: false }))
      .toBe('Leave at least one axis on, or nothing can move.')
  })

  it('refuses a mesh with no vertices to move', () => {
    const mesh = EditMesh.from(meshFromPolygons([], []))

    expect(run(mesh)).toBe('Cast needs vertices to move, and this mesh has none.')
  })
})
