import { describe, expect, it } from 'vitest'
import { SCENE_ICONS } from '@/scene/iconRegistry'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh, cylinderMesh, gridMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import {
  editContext,
  euler,
  isClosed,
  isWellFormed,
  keyOf,
  resultEdit,
  resultSelection,
  type EditFixture,
} from '@/scene/operators/editHarness'
import { loopCutPreview } from '@/scene/operators/loopCut'
import { getOperator, runOperator } from '@/scene/operators/registry'
import type { OperatorParams } from '@/scene/operators/types'
import type { MeshData, Vec3 } from '@/scene/types'

/*
 * Importing '@/scene/operators/loopCut' is what registers the family, so every test below goes
 * through the registry — the same path the keymap and the redo panel take.
 */

function ran(id: string, fixture: EditFixture, params: OperatorParams = {}) {
  const result = runOperator(id, editContext(fixture), params)
  if (!result.document) throw new Error(`${id} refused: ${result.error ?? 'it returned no document'}`)
  return result
}

function refused(id: string, fixture: EditFixture, params: OperatorParams = {}): string {
  const result = runOperator(id, editContext(fixture), params)
  if (result.document) throw new Error(`${id} did not refuse.`)
  return result.error ?? ''
}

function counts(mesh: EditMesh): { vertices: number; edges: number; faces: number } {
  return { vertices: mesh.vertexCount, edges: mesh.edgeCount, faces: mesh.faceCount }
}

function sides(mesh: EditMesh): number[] {
  const list: number[] = []
  for (let face = 0; face < mesh.faceCount; face += 1) list.push(mesh.faceVertices(face).length)
  return list
}

function points(mesh: EditMesh): Vec3[] {
  const list: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) list.push(mesh.position(slot))
  return list
}

/** The slot of the edge between two vertex slots of a freshly built mesh, which the redo panel replays. */
function edgeOf(mesh: MeshData, a: number, b: number): number {
  return EditMesh.from(mesh).edgeSlot(a, b)
}

/* ------------------------------------------------------------------ the family */

const REGISTERED = ['mesh.loopCut', 'mesh.offsetEdgeLoop', 'mesh.subdivideEdgeRing']

describe('the ring operators', () => {
  it('are registered for edit mode, each with a label, a description and an icon', () => {
    for (const id of REGISTERED) {
      const operator = getOperator(id)
      expect(operator, id).toBeDefined()
      expect(operator?.mode, id).toBe('edit')
      expect(operator?.section, id).toBe('Edge')
      expect(operator?.label, id).toBeTruthy()
      expect(operator?.description, id).toBeTruthy()
      expect(Object.hasOwn(SCENE_ICONS, operator?.icon ?? ''), `${id} icon`).toBe(true)
    }
  })

  it('give every parameter a default that matches its schema, which is what F9 starts from', () => {
    for (const id of REGISTERED) {
      const operator = getOperator(id)!
      expect(Object.keys(operator.defaults).sort(), id).toEqual(operator.params.map((param) => param.id).sort())
      for (const param of operator.params) {
        expect(operator.defaults[param.id], `${id}.${param.id}`).toEqual(param.defaultValue)
      }
    }
  })
})

/* ------------------------------------------------------------------ loop cut */

describe('loop cut', () => {
  it('cuts a closed ring right round a cube and leaves every face a quad', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)

    const mesh = resultEdit(ran('mesh.loopCut', { mesh: cube }, { edge }))

    expect(counts(mesh)).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(new Set(sides(mesh))).toEqual(new Set([4]))
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('puts the new loop half way along the ring, one vertex on each of its edges', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)

    const mesh = resultEdit(ran('mesh.loopCut', { mesh: cube }, { edge }))
    const cut = points(mesh).filter((point) => Math.abs(point[2]) < 1e-9)

    expect(cut).toHaveLength(4)
    expect(cut.map(([x, y]) => `${x} ${y}`).sort()).toEqual(['-1 -1', '-1 1', '1 -1', '1 1'])
  })

  it('leaves the new loop selected, and nothing else', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)

    const result = ran('mesh.loopCut', { mesh: cube, vertices: [0, 1] }, { edge })
    const selection = resultSelection(result)

    expect(selection.vertices).toHaveLength(4)
    expect(selection.edges).toHaveLength(4)
    expect(selection.faces).toHaveLength(0)
    expect(result.selection?.active?.kind).toBe('edge')
  })

  it('goes all the way round an open cylinder', () => {
    const tube = cylinderMesh({ vertices: 8, fill: 'none' })
    const edge = edgeOf(tube, 0, 8)

    const mesh = resultEdit(ran('mesh.loopCut', { mesh: tube }, { edge }))

    expect(counts(mesh)).toEqual({ vertices: 24, edges: 40, faces: 16 })
    expect(new Set(sides(mesh))).toEqual(new Set([4]))
    expect(euler(mesh)).toBe(0)
    expect(isWellFormed(mesh)).toBe(true)
    expect(points(mesh).filter((point) => Math.abs(point[2]) < 1e-9)).toHaveLength(8)
  })

  it('stops at the triangles of a sphere’s poles and cuts only the quads it reached', () => {
    const sphere = uvSphereMesh({ segments: 8, rings: 4 })
    const before = EditMesh.from(sphere)
    const middle = before.edgeSlot(9, 10)
    expect(before.edgeFaces(middle)).toHaveLength(2)
    expect(sides(before).filter((count) => count === 3)).toHaveLength(16)

    const mesh = resultEdit(ran('mesh.loopCut', { mesh: sphere }, { edge: middle }))

    expect(counts(before)).toEqual({ vertices: 26, edges: 56, faces: 32 })
    expect(counts(mesh)).toEqual({ vertices: 29, edges: 61, faces: 34 })
    // Two of the sixteen quads were cut in half; the two triangles the ring stopped against are
    // not cut, but they carry the vertex that landed on the edge they share, so they become quads.
    expect(sides(mesh).filter((count) => count === 3)).toHaveLength(14)
    expect(sides(mesh).filter((count) => count === 4)).toHaveLength(20)
    expect(euler(mesh)).toBe(2)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('spaces three cuts evenly along the ring', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)

    const mesh = resultEdit(ran('mesh.loopCut', { mesh: cube }, { edge, cuts: 3 }))
    const levels = [...new Set(points(mesh).map((point) => Math.round(point[2] * 1000) / 1000))].sort((a, b) => a - b)

    expect(counts(mesh)).toEqual({ vertices: 20, edges: 36, faces: 18 })
    expect(levels).toEqual([-1, -0.5, 0, 0.5, 1])
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('slides the cut with the factor, and flipping turns the slide round', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)

    const slid = resultEdit(ran('mesh.loopCut', { mesh: cube }, { edge, factor: 0.5 }))
    const flipped = resultEdit(ran('mesh.loopCut', { mesh: cube }, { edge, factor: 0.5, flipped: true }))

    expect(points(slid).filter((point) => Math.abs(point[2] - 0.5) < 1e-9)).toHaveLength(4)
    expect(points(flipped).filter((point) => Math.abs(point[2] + 0.5) < 1e-9)).toHaveLength(4)
  })

  it('keeps an even cut the same distance in where the ring’s edges differ in length', () => {
    const sphere = uvSphereMesh({ segments: 8, rings: 4 })
    const before = EditMesh.from(sphere)
    const middle = before.edgeSlot(9, 10)
    const reference = before.edgeLength(middle)
    const ring = [before.edgeSlot(1, 2), middle, before.edgeSlot(17, 18)]

    const even = points(resultEdit(ran('mesh.loopCut', { mesh: sphere }, { edge: middle, even: true })))
      .slice(before.vertexCount)
    const plain = points(resultEdit(ran('mesh.loopCut', { mesh: sphere }, { edge: middle })))
      .slice(before.vertexCount)

    expect(even).toHaveLength(3)
    // Even measures the cut in metres from the edge it was dragged from; plain measures it as a
    // fraction, which on a ring of unequal edges is the midpoint of each.
    expect(even.map((point) => rounded(reach(before, ring, point))).sort())
      .toEqual([reference / 2, reference / 2, reference / 2].map(rounded).sort())
    expect(plain.map((point) => rounded(reach(before, ring, point))).sort())
      .toEqual(ring.map((slot) => rounded(before.edgeLength(slot) / 2)).sort())
  })

  it('pulls a smoothed cut off the straight line between the ring’s ends', () => {
    const sphere = uvSphereMesh({ segments: 8, rings: 4 })
    const before = EditMesh.from(sphere)
    const middle = before.edgeSlot(9, 10)

    const straight = resultEdit(ran('mesh.loopCut', { mesh: sphere }, { edge: middle }))
    const smooth = resultEdit(ran('mesh.loopCut', { mesh: sphere }, { edge: middle, smoothness: 1 }))
    const moved = points(smooth).slice(before.vertexCount)
    const flat = points(straight).slice(before.vertexCount)

    expect(moved.some((point, index) => distance(point, flat[index]!) > 1e-3)).toBe(true)
    expect(isWellFormed(smooth)).toBe(true)
    expect(isClosed(smooth)).toBe(true)
  })

  it('replays with a different number of cuts, which is what the redo panel does', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)
    const context = editContext({ mesh: cube })

    const once = runOperator('mesh.loopCut', context, { edge, cuts: 1 })
    const thrice = runOperator('mesh.loopCut', context, { edge, cuts: 3 })

    expect(counts(resultEdit(once))).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(counts(resultEdit(thrice))).toEqual({ vertices: 20, edges: 36, faces: 18 })
  })

  it('carries the material and the shading of every face it cuts in two', () => {
    const cube = boxMesh(2)
    const painted: MeshData = {
      ...cube,
      attributes: {
        ...cube.attributes,
        face: { smooth: cube.attributes.face.smooth.map(() => true), material: [0, 1, 2, 3, 4, 5] },
      },
    }
    const edge = edgeOf(cube, 0, 4)

    const mesh = resultEdit(ran('mesh.loopCut', { mesh: painted }, { edge }))
    const materials: number[] = []
    for (let face = 0; face < mesh.faceCount; face += 1) {
      materials.push(mesh.faceMaterial(face))
      expect(mesh.faceSmooth(face)).toBe(true)
    }

    // The four faces of the ring became eight, each half keeping the material its face had.
    expect(materials.sort()).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  })

  it('asks to be pointed at an edge when nothing names one', () => {
    expect(refused('mesh.loopCut', { mesh: boxMesh(2) })).toBe(
      'Point at an edge: a loop cut follows the ring of the edge under the pointer.')
  })

  it('refuses an edge with no ring of quads to cut across', () => {
    const fan = circleMesh({ vertices: 4, fill: 'triangle-fan' })

    expect(refused('mesh.loopCut', { mesh: fan }, { edge: 0 })).toBe(
      'This edge has no ring of quads to cut across.')
  })
})

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function rounded(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/** How far a new vertex is from the far end of the ring edge it was put on, which “even” fixes. */
function reach(mesh: EditMesh, ring: number[], point: Vec3): number {
  for (const slot of ring) {
    const [a, b] = mesh.edgeVertices(slot)
    const near = distance(point, mesh.position(a))
    const far = distance(point, mesh.position(b))
    if (Math.abs(near + far - mesh.edgeLength(slot)) < 1e-9) return Math.max(near, far)
  }
  return Number.NaN
}

/* ------------------------------------------------------------------- preview */

describe('the loop cut preview', () => {
  it('gives one polyline per cut, a point for every edge of the ring', () => {
    const cube = boxMesh(2)
    const mesh = EditMesh.from(cube)
    const edge = mesh.edgeSlot(0, 4)

    const lines = loopCutPreview(mesh, edge, 3, 0)

    expect(lines).toHaveLength(3)
    expect(lines.every((line) => line.length === 4)).toBe(true)
    expect(lines.map((line) => Math.round(line[0]![2] * 1000) / 1000)).toEqual([-0.5, 0, 0.5])
  })

  it('leaves the mesh exactly as it found it, because the viewport calls it on every move', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const before = counts(mesh)

    loopCutPreview(mesh, mesh.edgeSlot(0, 4), 5, 0.4)

    expect(counts(mesh)).toEqual(before)
  })

  it('answers with nothing rather than throwing when the edge has no ring', () => {
    const mesh = EditMesh.from(circleMesh({ vertices: 4, fill: 'triangle-fan' }))

    expect(loopCutPreview(mesh, 0, 1, 0)).toEqual([])
    expect(loopCutPreview(mesh, -1, 1, 0)).toEqual([])
  })

  it('stays under 4 ms on a mesh of ten thousand faces', () => {
    const grid = gridMesh({ xSubdivisions: 101, ySubdivisions: 101 })
    const mesh = EditMesh.from(grid)
    expect(mesh.faceCount).toBe(10000)
    const edge = mesh.edgeSlot(50 * 101 + 50, 50 * 101 + 51)
    expect(loopCutPreview(mesh, edge, 1, 0)[0]).toHaveLength(101)

    for (let warm = 0; warm < 5; warm += 1) loopCutPreview(mesh, edge, 1, 0)
    const started = performance.now()
    const rounds = 20
    for (let round = 0; round < rounds; round += 1) loopCutPreview(mesh, edge, 1, 0)
    const each = (performance.now() - started) / rounds

    expect(each).toBeLessThan(4)
  })
})

/* ------------------------------------------------------------ offset edge loop */

describe('offset edge loop', () => {
  it('puts a loop either side of the edge and leaves the cube closed', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)

    const mesh = resultEdit(ran('mesh.offsetEdgeLoop', { mesh: cube }, { edge }))

    expect(counts(mesh)).toEqual({ vertices: 12, edges: 18, faces: 8 })
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('caps the ends of an open loop with a triangle each', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)

    const mesh = resultEdit(ran('mesh.offsetEdgeLoop', { mesh: cube }, { edge, capEndpoint: true }))

    expect(counts(mesh)).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(sides(mesh).filter((count) => count === 3)).toHaveLength(2)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('places the two loops by the factor, measured out from the loop', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)

    const half = resultEdit(ran('mesh.offsetEdgeLoop', { mesh: cube }, { edge, factor: 0.5 }))
    const near = resultEdit(ran('mesh.offsetEdgeLoop', { mesh: cube }, { edge, factor: 0.25 }))

    expect(points(half).slice(8).map((point) => Math.abs(point[0]) + Math.abs(point[1])))
      .toEqual([1, 1, 1, 1])
    expect(points(near).slice(8).map((point) => Math.abs(point[0]) + Math.abs(point[1])))
      .toEqual([1.5, 1.5, 1.5, 1.5])
  })

  it('leaves both new loops selected', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)

    const selection = resultSelection(ran('mesh.offsetEdgeLoop', { mesh: cube }, { edge }))

    expect(selection.vertices).toHaveLength(4)
    expect(selection.edges).toHaveLength(2)
  })

  it('replays with a different factor', () => {
    const cube = boxMesh(2)
    const edge = edgeOf(cube, 0, 4)
    const context = editContext({ mesh: cube })

    const wide = runOperator('mesh.offsetEdgeLoop', context, { edge, factor: 0.5 })
    const tight = runOperator('mesh.offsetEdgeLoop', context, { edge, factor: 0.1 })

    expect(points(resultEdit(wide)).slice(8)).not.toEqual(points(resultEdit(tight)).slice(8))
  })

  it('asks to be pointed at an edge when nothing names one', () => {
    expect(refused('mesh.offsetEdgeLoop', { mesh: boxMesh(2) })).toBe(
      'Point at an edge: a loop cut follows the ring of the edge under the pointer.')
  })

  it('refuses a loop with no quad beside it', () => {
    const fan = circleMesh({ vertices: 4, fill: 'triangle-fan' })

    expect(refused('mesh.offsetEdgeLoop', { mesh: fan }, { edge: 0 })).toBe(
      'This edge’s loop has no quad beside it to offset into.')
  })
})

/* --------------------------------------------------------- subdivide edge ring */

describe('subdivide edge ring', () => {
  it('cuts the ring of every selected edge, evenly', () => {
    const cube = boxMesh(2)
    const mesh = EditMesh.from(cube)
    const fixture: EditFixture = { mesh: cube, edges: [keyOf(mesh, 0, 4)], selectMode: ['edge'] }

    const cut = resultEdit(ran('mesh.subdivideEdgeRing', fixture, { cuts: 2 }))

    expect(counts(cut)).toEqual({ vertices: 16, edges: 28, faces: 14 })
    expect(new Set(sides(cut))).toEqual(new Set([4]))
    expect(isClosed(cut)).toBe(true)
    expect(euler(cut)).toBe(2)
    expect(isWellFormed(cut)).toBe(true)
  })

  it('spaces its cuts evenly along the ring', () => {
    const cube = boxMesh(2)
    const mesh = EditMesh.from(cube)
    const fixture: EditFixture = { mesh: cube, edges: [keyOf(mesh, 0, 4)], selectMode: ['edge'] }

    const cut = resultEdit(ran('mesh.subdivideEdgeRing', fixture, { cuts: 2 }))
    const levels = [...new Set(points(cut).map((point) => Math.round(point[2] * 1000) / 1000))].sort((a, b) => a - b)

    expect(levels).toEqual([-1, -0.333, 0.333, 1])
  })

  it('replays with a different number of cuts', () => {
    const cube = boxMesh(2)
    const mesh = EditMesh.from(cube)
    const context = editContext({ mesh: cube, edges: [keyOf(mesh, 0, 4)], selectMode: ['edge'] })

    const once = runOperator('mesh.subdivideEdgeRing', context, { cuts: 1 })
    const twice = runOperator('mesh.subdivideEdgeRing', context, { cuts: 2 })

    expect(counts(resultEdit(once))).toEqual({ vertices: 12, edges: 20, faces: 10 })
    expect(counts(resultEdit(twice))).toEqual({ vertices: 16, edges: 28, faces: 14 })
  })

  it('says so when no edge is selected', () => {
    expect(refused('mesh.subdivideEdgeRing', { mesh: boxMesh(2) })).toBe('No edges are selected.')
  })

  it('refuses an edge whose ring has no quad', () => {
    const fan = circleMesh({ vertices: 4, fill: 'triangle-fan' })
    const mesh = EditMesh.from(fan)
    const [a, b] = mesh.edgeVertices(0)

    expect(refused('mesh.subdivideEdgeRing', { mesh: fan, edges: [keyOf(mesh, a, b)], selectMode: ['edge'] }))
      .toBe('This edge has no ring of quads to cut across.')
  })
})
