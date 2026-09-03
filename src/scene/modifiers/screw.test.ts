import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { circleMesh } from '@/scene/mesh/primitives'
import { rotation } from '@/scene/modifiers/matrix'
import '@/scene/modifiers/screw'
import {
  getModifier,
  type ModifierContext,
  type ModifierInput,
  type ModifierOutcome,
} from '@/scene/modifiers/types'
import { euler, isClosed, isConsistentlyWound, isWellFormed } from '@/scene/operators/editHarness'
import type { Modifier } from '@/scene/types'

/**
 * Screw as a modifier, judged by the surface a profile sweeps out.
 *
 * The profile is Blender's usual lathe starting point: a four-vertex circle with no face in it,
 * lying in the XY plane and turned about the X axis, so profile and axis are coplanar and a whole
 * turn makes a torus rather than a knot. Eight steps of it is a shape small enough to count by hand
 * and closed enough to say something about.
 */

/** The open four-vertex profile, `reach` metres away from the X axis. */
function profile(reach: number): EditMesh {
  const mesh = EditMesh.from(circleMesh({ vertices: 4, radius: 0.5 }))
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    mesh.setPosition(slot, [point[0], point[1] + reach, point[2]])
  }
  return mesh
}

function screw(
  mesh: EditMesh,
  params: Modifier['params'] = {},
  context: Partial<ModifierContext> = {},
): ModifierOutcome {
  const module = getModifier('screw')!
  return module.apply(mesh, { ...module.defaults, ...params }, {
    inputs: {},
    forRender: false,
    editing: false,
    ...context,
  })
}

function input(matrix: number[]): ModifierInput {
  return { id: 'axis-empty', name: 'Axis', matrix, mesh: null }
}

describe('the screw modifier', () => {
  it('closes a four-vertex profile into a torus over a whole turn in eight steps', () => {
    const mesh = profile(2)

    expect(screw(mesh, { axis: 'x', angle: 360, steps: 8 })).toBeUndefined()

    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    // Eight rings of four, each bridged to the next by four quads and the eighth bridged back onto
    // the first: 32 vertices, 32 profile edges plus 32 along the sweep, 32 quads, and Euler nought.
    expect(mesh.vertexCount).toBe(32)
    expect(mesh.edgeCount).toBe(64)
    expect(mesh.faceCount).toBe(32)
    expect(euler(mesh)).toBe(0)
    for (let face = 0; face < mesh.faceCount; face += 1) expect(mesh.faceVertices(face)).toHaveLength(4)
  })

  it('leaves the profile where it was across the axis and sweeps it two and a half metres out', () => {
    const mesh = profile(2)

    screw(mesh, { axis: 'x', angle: 360, steps: 8 })

    // Nothing moves along the axis without a rise, so the sweep is half a metre deep either way,
    // and the far side of the profile traces a circle of two and a half metres.
    const bounds = mesh.bounds()
    expect(bounds.min[0]).toBeCloseTo(-0.5, 10)
    expect(bounds.max[0]).toBeCloseTo(0.5, 10)
    expect(bounds.max[1]).toBeCloseTo(2.5, 10)
    expect(bounds.min[1]).toBeCloseTo(-2.5, 10)
    expect(bounds.max[2]).toBeCloseTo(2.5, 10)
  })

  it('shades every face it makes smooth unless it is told not to', () => {
    const smooth = profile(2)
    screw(smooth, { axis: 'x', angle: 360, steps: 8 })
    for (let face = 0; face < smooth.faceCount; face += 1) expect(smooth.faceSmooth(face)).toBe(true)

    const flat = profile(2)
    screw(flat, { axis: 'x', angle: 360, steps: 8, smooth: false })
    for (let face = 0; face < flat.faceCount; face += 1) expect(flat.faceSmooth(face)).toBe(false)
  })

  it('climbs the rise on every turn, so two turns of a metre end two metres along the axis', () => {
    const mesh = profile(2)

    screw(mesh, { axis: 'x', angle: 360, steps: 8, iterations: 2, screw: 1 })

    // Blender multiplies angle, rise and steps by the iteration count, so this is two whole turns
    // in sixteen steps climbing a metre each: seventeen rings, the last of them home again but two
    // metres along. A rise stops the sweep closing onto its first ring, so no ring is shared.
    expect(mesh.vertexCount).toBe(17 * 4)
    expect(mesh.faceCount).toBe(16 * 4)
    expect(isWellFormed(mesh)).toBe(true)
    const last = [mesh.vertexCount - 4, mesh.vertexCount - 3, mesh.vertexCount - 2, mesh.vertexCount - 1]
    const centre = mesh.median(last)
    expect(centre[0]).toBeCloseTo(2, 10)
    expect(centre[1]).toBeCloseTo(2, 10)
    expect(centre[2]).toBeCloseTo(0, 10)
  })

  it('uses the render steps rather than the viewport’s when the stack is being rendered', () => {
    const drawn = profile(2)
    screw(drawn, { axis: 'x', angle: 360, steps: 8, renderSteps: 4 })
    expect(drawn.vertexCount).toBe(32)

    const rendered = profile(2)
    screw(rendered, { axis: 'x', angle: 360, steps: 8, renderSteps: 4 }, { forRender: true })
    expect(rendered.vertexCount).toBe(16)
    expect(rendered.faceCount).toBe(16)
    expect(isClosed(rendered)).toBe(true)
  })

  it('welds a profile that touches the axis into one point when merge is on', () => {
    // This profile has a vertex sitting exactly on the axis, so the sweep leaves eight copies of it
    // in the same place — the cone tip that Merge vertices exists for.
    const loose = profile(0.5)
    screw(loose, { axis: 'x', angle: 360, steps: 8 })
    expect(loose.vertexCount).toBe(32)

    const merged = profile(0.5)
    screw(merged, { axis: 'x', angle: 360, steps: 8, merge: true, mergeDistance: 0.01 })

    expect(isWellFormed(merged)).toBe(true)
    expect(merged.vertexCount).toBe(25)
    let onAxis = 0
    for (let slot = 0; slot < merged.vertexCount; slot += 1) {
      const point = merged.position(slot)
      if (Math.hypot(point[0], point[1], point[2]) < 1e-9) onAxis += 1
    }
    expect(onAxis).toBe(1)
  })

  it('turns about the axis of an object when it is given one', () => {
    // The object's own Z points along the world's X, so naming it and asking for Z is asking for X.
    const mesh = profile(2)

    screw(mesh, { axis: 'z', axisObject: 'axis-empty' }, {
      inputs: { axisObject: input(rotation([0, 1, 0], Math.PI / 2)) },
    })

    expect(isClosed(mesh)).toBe(true)
    expect(mesh.vertexCount).toBe(16 * 4)
    const bounds = mesh.bounds()
    expect(bounds.min[0]).toBeCloseTo(-0.5, 10)
    expect(bounds.max[0]).toBeCloseTo(0.5, 10)
    expect(bounds.max[1]).toBeCloseTo(2.5, 10)
  })

  it('takes the profile’s edges as the mesh holds them when calculate order is off', () => {
    const mesh = profile(2)

    screw(mesh, { axis: 'x', angle: 360, steps: 8, calcOrder: false })

    // The counts are the same either way; what the walk buys is the winding. A circle's edges are
    // stored low slot first, so the one that closes the loop runs backwards and the wall it sweeps
    // comes out facing into the tube.
    expect(mesh.vertexCount).toBe(32)
    expect(mesh.faceCount).toBe(32)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(false)
  })

  it('refuses a sweep with neither an angle nor a rise', () => {
    const mesh = profile(2)

    expect(screw(mesh, { axis: 'x', angle: 0, screw: 0 }))
      .toBe('Give Screw an angle to turn through or a rise to climb; with neither there is nothing to sweep.')
  })

  it('says so when the object it turns about has left the scene', () => {
    const mesh = profile(2)

    expect(screw(mesh, { axis: 'z', axisObject: 'axis-empty' }))
      .toBe('Screw turns about an object that is not in the scene any more; choose another for Axis object.')
  })

  it('says so when there is no profile to sweep', () => {
    const mesh = EditMesh.from(circleMesh({ vertices: 4, radius: 0.5 }))
    mesh.remove({ vertices: [0, 1, 2, 3] })

    expect(screw(mesh, { axis: 'x' })).toBe('Screw needs a profile; this mesh has no vertices.')
  })
})
