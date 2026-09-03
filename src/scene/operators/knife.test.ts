import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import type { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import { editContext, euler, isClosed, isWellFormed, meshVolume, resultEdit, resultSelection } from '@/scene/operators/editHarness'
import '@/scene/operators/knife'
import { getOperator, runOperator } from '@/scene/operators/registry'
import type { OperatorParams, OperatorResult } from '@/scene/operators/types'
import type { EditFixture } from '@/scene/operators/editHarness'
import type { Vec3 } from '@/scene/types'

/*
 * Importing '@/scene/operators/knife' is what registers the family, so every case below runs
 * through the registry — the same path the menus, the keymap and the F9 panel take.
 *
 * Every line is drawn looking straight down, so that the projection the cut happens in is the XY
 * plane and a person reading the test can see where the line falls without doing any arithmetic.
 */

const FROM_ABOVE = { yaw: 0, pitch: 90 }

const NO_FACE = 'The knife line crosses no face; draw it across the geometry to cut it.'
const STOPS_INSIDE = 'The knife line stops inside a face; take it right across the face to cut it.'
const NO_SOURCE = 'Select another object to project onto this one.'

function knife(fixture: EditFixture, params: OperatorParams): OperatorResult {
  return runOperator('mesh.knife', editContext({ ...fixture, view: FROM_ABOVE }), params)
}

function line(...points: Vec3[]): string {
  return JSON.stringify(points)
}

function counts(mesh: EditMesh): { vertices: number; edges: number; faces: number } {
  return { vertices: mesh.vertexCount, edges: mesh.edgeCount, faces: mesh.faceCount }
}

/** The slot of the vertex at a point, or -1 — which is how a positions assertion names one. */
function slotAt(mesh: EditMesh, point: Vec3): number {
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const here = mesh.position(slot)
    if (Math.hypot(here[0] - point[0], here[1] - point[1], here[2] - point[2]) < 1e-6) return slot
  }
  return -1
}

function cutMesh(fixture: EditFixture, params: OperatorParams): EditMesh {
  return resultEdit(knife(fixture, params))
}

/* ------------------------------------------------------------------ the family */

describe('the knife operators', () => {
  it('registers the knife and the projection under Mesh, in edit mode', () => {
    for (const id of ['mesh.knife', 'mesh.knifeProject']) {
      const operator = getOperator(id)
      expect(operator?.section).toBe('Mesh')
      expect(operator?.mode).toBe('edit')
    }
    expect(getOperator('mesh.knife')?.shortcut).toBe('K')
    expect(getOperator('mesh.knifeProject')?.shortcut).toBe('⇧K')
  })

  it('declares a default for every parameter it takes', () => {
    for (const id of ['mesh.knife', 'mesh.knifeProject']) {
      const operator = getOperator(id)!
      expect(Object.keys(operator.defaults).sort()).toEqual(operator.params.map((param) => param.id).sort())
    }
  })
})

/* -------------------------------------------------------------------- cutting */

describe('the knife', () => {
  it('cuts a plane in two along a line across its middle', () => {
    const mesh = cutMesh({ mesh: planeMesh(2) }, { path: line([-2, 0, 1], [2, 0, 1]) })

    expect(counts(mesh)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(slotAt(mesh, [-1, 0, 0])).toBeGreaterThanOrEqual(0)
    expect(slotAt(mesh, [1, 0, 0])).toBeGreaterThanOrEqual(0)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(1)
  })

  it('leaves the two new vertices and the edge between them selected', () => {
    const result = knife({ mesh: planeMesh(2) }, { path: line([-2, 0, 1], [2, 0, 1]) })

    expect(resultSelection(result).vertices).toEqual([4, 5])
    expect(resultSelection(result).edges).toEqual(['4:5'])
  })

  it('uses the vertex a line passes through rather than adding one on top of it', () => {
    const mesh = cutMesh({ mesh: planeMesh(2) }, { path: line([-2, -2, 1], [2, 2, 1]) })

    expect(counts(mesh)).toEqual({ vertices: 4, edges: 5, faces: 2 })
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(1)
  })

  it('refuses a line that stops inside a face', () => {
    const result = knife({ mesh: planeMesh(2) }, { path: line([-2, 0, 1], [0, 0, 1]) })

    expect(result.error).toBe(STOPS_INSIDE)
    expect(result.document).toBeUndefined()
  })

  it('refuses a line that crosses nothing at all', () => {
    const result = knife({ mesh: planeMesh(2) }, { path: line([0, 0, 1], [0.5, 0.5, 1]) })

    expect(result.error).toBe(NO_FACE)
  })

  it('refuses a line of fewer than two points, which is what the panel opens with', () => {
    expect(knife({ mesh: planeMesh(2) }, {}).error).toBe('The knife line needs at least two points.')
    expect(knife({ mesh: planeMesh(2) }, { path: 'not json' }).error).toBe('That parameter is not valid JSON.')
  })

  it('cuts only the near face of a cube, and both faces when it cuts through', () => {
    const cube: EditFixture = { mesh: boxMesh(2) }
    const path = line([0, -2, 2], [0, 2, 2])

    const near = cutMesh(cube, { path })
    expect(counts(near)).toEqual({ vertices: 10, edges: 15, faces: 7 })
    expect(slotAt(near, [0, -1, 1])).toBeGreaterThanOrEqual(0)
    expect(slotAt(near, [0, -1, -1])).toBe(-1)

    const through = cutMesh(cube, { path, cutThrough: true })
    expect(counts(through)).toEqual({ vertices: 12, edges: 18, faces: 8 })
    expect(slotAt(through, [0, -1, -1])).toBeGreaterThanOrEqual(0)
    expect(slotAt(through, [0, 1, -1])).toBeGreaterThanOrEqual(0)
    expect(isClosed(through)).toBe(true)
    expect(isWellFormed(through)).toBe(true)
    expect(euler(through)).toBe(2)
    expect(meshVolume(through)).toBeCloseTo(8, 9)
  })

  it('cuts only the front-most of two faces standing one behind the other, unless occlusion is off', () => {
    // Two flat quads, one a metre above the other: no primitive makes a mesh that hides itself.
    const stacked: EditFixture = {
      mesh: meshFromPolygons(
        [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
        [[0, 1, 2, 3], [4, 5, 6, 7]],
      ),
    }
    const path = line([-2, 0, 2], [2, 0, 2])

    const occluded = cutMesh(stacked, { path })
    expect(counts(occluded)).toEqual({ vertices: 10, edges: 11, faces: 3 })
    expect(slotAt(occluded, [1, 0, 1])).toBeGreaterThanOrEqual(0)
    expect(slotAt(occluded, [1, 0, 0])).toBe(-1)

    const both = cutMesh(stacked, { path, occlude: false })
    expect(counts(both)).toEqual({ vertices: 12, edges: 14, faces: 4 })
    expect(slotAt(both, [1, 0, 0])).toBeGreaterThanOrEqual(0)
    expect(isWellFormed(both)).toBe(true)
  })

  it('puts a crossing on the middle of the edge it lands on when snapping to midpoints', () => {
    const plane: EditFixture = { mesh: planeMesh(2) }
    const path = line([-2, -0.5, 1], [2, 0.5, 1])

    const free = cutMesh(plane, { path })
    expect(slotAt(free, [1, 0.25, 0])).toBeGreaterThanOrEqual(0)
    expect(slotAt(free, [-1, -0.25, 0])).toBeGreaterThanOrEqual(0)

    const snapped = cutMesh(plane, { path, midpointSnap: true })
    expect(counts(snapped)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(slotAt(snapped, [1, 0, 0])).toBeGreaterThanOrEqual(0)
    expect(slotAt(snapped, [-1, 0, 0])).toBeGreaterThanOrEqual(0)
  })

  it('turns a leg of the line to the nearest forty-five degrees when it is constrained', () => {
    const plane: EditFixture = { mesh: planeMesh(2) }
    const path = line([-2, -0.5, 1], [2, 0.5, 1])

    const constrained = cutMesh(plane, { path, angleConstrain: true })
    expect(counts(constrained)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(slotAt(constrained, [1, -0.5, 0])).toBeGreaterThanOrEqual(0)
    expect(slotAt(constrained, [-1, -0.5, 0])).toBeGreaterThanOrEqual(0)
    expect(isWellFormed(constrained)).toBe(true)
  })

  it('replays against the document it started from, with the line moved', () => {
    const context = editContext({ mesh: planeMesh(2), view: FROM_ABOVE })

    const first = resultEdit(runOperator('mesh.knife', context, { path: line([-2, 0, 1], [2, 0, 1]) }))
    const again = resultEdit(runOperator('mesh.knife', context, { path: line([-2, 0.5, 1], [2, 0.5, 1]) }))

    expect(counts(first)).toEqual(counts(again))
    expect(slotAt(first, [1, 0, 0])).toBeGreaterThanOrEqual(0)
    expect(slotAt(again, [1, 0, 0])).toBe(-1)
    expect(slotAt(again, [1, 0.5, 0])).toBeGreaterThanOrEqual(0)
    expect(slotAt(again, [-1, 0.5, 0])).toBeGreaterThanOrEqual(0)
  })
})

/* ------------------------------------------------------------- knife project */

describe('knife project', () => {
  const cutter = {
    id: 'cutter',
    mesh: boxMesh(2),
    transform: { position: [1, 0.5, 3] as Vec3, rotation: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 },
    selected: true,
  }

  function project(mesh: EditFixture['mesh'], params: OperatorParams = {}): OperatorResult {
    return runOperator('mesh.knifeProject', editContext({ mesh, others: [cutter], view: FROM_ABOVE }), params)
  }

  it('cuts a plane along the outline another object casts through the view', () => {
    const mesh = resultEdit(project(planeMesh(2)))

    expect(counts(mesh)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(slotAt(mesh, [1, -0.5, 0])).toBeGreaterThanOrEqual(0)
    expect(slotAt(mesh, [0, 1, 0])).toBeGreaterThanOrEqual(0)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(1)
  })

  it('replays with cut through, and reaches the far side of a cube', () => {
    const near = resultEdit(project(boxMesh(2)))
    expect(counts(near)).toEqual({ vertices: 10, edges: 15, faces: 7 })

    const through = resultEdit(project(boxMesh(2), { cutThrough: true }))
    expect(counts(through)).toEqual({ vertices: 12, edges: 18, faces: 8 })
    expect(isClosed(through)).toBe(true)
    expect(isWellFormed(through)).toBe(true)
    expect(euler(through)).toBe(2)
    expect(meshVolume(through)).toBeCloseTo(8, 9)
  })

  it('refuses when there is no other object to project', () => {
    const result = runOperator('mesh.knifeProject', editContext({ mesh: planeMesh(2), view: FROM_ABOVE }), {})

    expect(result.error).toBe(NO_SOURCE)
  })
})
