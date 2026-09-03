import { describe, expect, it } from 'vitest'
import { SCENE_ICONS } from '@/scene/iconRegistry'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh, gridMesh, icoSphereMesh, planeMesh } from '@/scene/mesh/primitives'
import {
  allEdgeKeys,
  allIds,
  editContext,
  euler,
  isClosed,
  isWellFormed,
  keyOf,
  resultEdit,
  resultMesh,
  resultSelection,
  type EditFixture,
} from '@/scene/operators/editHarness'
import { getOperator, runOperator } from '@/scene/operators/registry'
import '@/scene/operators/subdivide'
import type { OperatorParams } from '@/scene/operators/types'
import type { MeshData, Vec3 } from '@/scene/types'

/*
 * Importing '@/scene/operators/subdivide' is what registers the family, so every test below goes
 * through the registry — the same path the menus, the keymap and the redo panel take.
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

/** Everything of a mesh selected, in all three kinds, which is how most of these cases start. */
function allOf(mesh: MeshData): EditFixture {
  return {
    mesh,
    vertices: allIds(mesh, 'vertex'),
    edges: allEdgeKeys(mesh),
    faces: allIds(mesh, 'face'),
    selectMode: ['vertex'],
  }
}

function rounded(value: number): number {
  // The `+ 0` is not decoration: it turns −0 into 0, which a deep comparison tells apart.
  return Math.round(value * 1e6) / 1e6 + 0
}

/* ----------------------------------------------------------------- the family */

const REGISTERED = [
  'mesh.subdivide',
  'mesh.unsubdivide',
  'mesh.poke',
  'mesh.triangulate',
  'mesh.trisToQuads',
  'mesh.rotateEdge',
  'mesh.edgeSplit',
  'mesh.edgeSplitBySharp',
]

describe('the subdivide family', () => {
  it('is registered for edit mode, each with a label, a description and an icon', () => {
    for (const id of REGISTERED) {
      const operator = getOperator(id)
      expect(operator, id).toBeDefined()
      expect(operator?.mode, id).toBe('edit')
      expect(operator?.label, id).toBeTruthy()
      expect(operator?.description, id).toBeTruthy()
      expect(Object.hasOwn(SCENE_ICONS, operator?.icon ?? ''), `${id} icon`).toBe(true)
    }
  })

  it('gives every parameter a default that matches its schema, which is what F9 starts from', () => {
    for (const id of REGISTERED) {
      const operator = getOperator(id)!
      expect(Object.keys(operator.defaults).sort(), id).toEqual(operator.params.map((param) => param.id).sort())
      for (const param of operator.params) {
        expect(operator.defaults[param.id], `${id}.${param.id}`).toEqual(param.defaultValue)
      }
    }
  })

  it('carries the material and the shading onto every face it mints', () => {
    const hexagon = circleMesh({ vertices: 6, fill: 'ngon' })
    const painted: MeshData = {
      ...hexagon,
      attributes: { ...hexagon.attributes, face: { smooth: [true], material: [3] } },
    }

    for (const [id, params] of [
      ['mesh.subdivide', { cuts: 1 }],
      ['mesh.poke', {}],
      ['mesh.triangulate', {}],
    ] as Array<[string, OperatorParams]>) {
      const mesh = resultEdit(ran(id, allOf(painted), params))
      expect(mesh.faceCount, id).toBeGreaterThan(1)
      for (let face = 0; face < mesh.faceCount; face += 1) {
        expect(mesh.faceMaterial(face), `${id} face ${face}`).toBe(3)
        expect(mesh.faceSmooth(face), `${id} face ${face}`).toBe(true)
      }
    }
  })
})

/* ------------------------------------------------------------------ subdivide */

describe('subdivide', () => {
  it('turns a plane into a nine-quad grid at two cuts', () => {
    const plane = planeMesh(2)

    const mesh = resultEdit(ran('mesh.subdivide', allOf(plane), { cuts: 2 }))

    expect(counts(mesh)).toEqual({ vertices: 16, edges: 24, faces: 9 })
    expect(new Set(sides(mesh))).toEqual(new Set([4]))
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('spaces the new grid evenly across the face', () => {
    const plane = planeMesh(2)

    const mesh = resultEdit(ran('mesh.subdivide', allOf(plane), { cuts: 2 }))
    const across = [...new Set(points(mesh).map((point) => rounded(point[0])))].sort((a, b) => a - b)

    expect(across).toEqual([-1, -0.333333, 0.333333, 1])
    expect(points(mesh).every((point) => point[2] === 0)).toBe(true)
  })

  it('gives a quad four quads round a new centre vertex at one cut', () => {
    const plane = planeMesh(2)

    const mesh = resultEdit(ran('mesh.subdivide', allOf(plane), { cuts: 1 }))

    expect(counts(mesh)).toEqual({ vertices: 9, edges: 12, faces: 4 })
    expect(new Set(sides(mesh))).toEqual(new Set([4]))
    expect(points(mesh).filter((point) => point[0] === 0 && point[1] === 0)).toHaveLength(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('gives a triangle four triangles at one cut', () => {
    const triangle = circleMesh({ vertices: 3, fill: 'ngon' })

    const mesh = resultEdit(ran('mesh.subdivide', allOf(triangle), { cuts: 1 }))

    expect(counts(mesh)).toEqual({ vertices: 6, edges: 9, faces: 4 })
    expect(new Set(sides(mesh))).toEqual(new Set([3]))
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('gives an n-gon a quad per corner at one cut', () => {
    const hexagon = circleMesh({ vertices: 6, fill: 'ngon' })

    const mesh = resultEdit(ran('mesh.subdivide', allOf(hexagon), { cuts: 1 }))

    expect(counts(mesh)).toEqual({ vertices: 13, edges: 18, faces: 6 })
    expect(new Set(sides(mesh))).toEqual(new Set([4]))
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('keeps a cube where it was when nothing is smoothed', () => {
    const cube = boxMesh(2)

    const mesh = resultEdit(ran('mesh.subdivide', allOf(cube), { cuts: 1 }))
    const corners = points(mesh).filter((point) => point.every((value) => Math.abs(value) === 1))

    expect(counts(mesh)).toEqual({ vertices: 26, edges: 48, faces: 24 })
    expect(corners).toHaveLength(8)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('pulls a fully smoothed cube towards a sphere, every vertex within a tenth of one radius', () => {
    const cube = boxMesh(2)

    const mesh = resultEdit(ran('mesh.subdivide', allOf(cube), { cuts: 1, smoothness: 1 }))
    const radii = points(mesh).map((point) => Math.hypot(point[0], point[1], point[2]))
    const average = radii.reduce((total, value) => total + value, 0) / radii.length

    expect(counts(mesh)).toEqual({ vertices: 26, edges: 48, faces: 24 })
    expect(Math.max(...radii.map((radius) => Math.abs(radius / average - 1)))).toBeLessThan(0.1)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('cuts a quad across when two facing sides are selected', () => {
    const plane = planeMesh(2)
    const mesh = EditMesh.from(plane)
    const fixture: EditFixture = { mesh: plane, edges: [keyOf(mesh, 0, 1), keyOf(mesh, 2, 3)], selectMode: ['edge'] }

    const cut = resultEdit(ran('mesh.subdivide', fixture))

    expect(counts(cut)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(new Set(sides(cut))).toEqual(new Set([4]))
    expect(isWellFormed(cut)).toBe(true)
  })

  it('offers Blender’s four shapes for a quad with two neighbouring sides selected', () => {
    const plane = planeMesh(2)
    const mesh = EditMesh.from(plane)
    const fixture: EditFixture = { mesh: plane, edges: [keyOf(mesh, 0, 1), keyOf(mesh, 1, 2)], selectMode: ['edge'] }

    const inner = resultEdit(ran('mesh.subdivide', fixture, { quadCorner: 'inner-vertex' }))
    const path = resultEdit(ran('mesh.subdivide', fixture, { quadCorner: 'path' }))
    const straight = resultEdit(ran('mesh.subdivide', fixture, { quadCorner: 'straight-cut' }))
    const fan = resultEdit(ran('mesh.subdivide', fixture, { quadCorner: 'fan' }))

    expect(counts(inner)).toEqual({ vertices: 7, edges: 9, faces: 3 })
    expect(new Set(sides(inner))).toEqual(new Set([4]))
    expect(counts(path)).toEqual({ vertices: 6, edges: 8, faces: 3 })
    expect(sides(path).sort()).toEqual([3, 3, 4])
    expect(counts(straight)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(sides(straight).sort()).toEqual([3, 5])
    expect(counts(fan)).toEqual({ vertices: 6, edges: 9, faces: 4 })
    expect(new Set(sides(fan))).toEqual(new Set([3]))
    for (const mesh of [inner, path, straight, fan]) {
      expect(isWellFormed(mesh)).toBe(true)
      expect(euler(mesh)).toBe(1)
    }
  })

  it('puts the inner vertex where the two cuts would meet', () => {
    const plane = planeMesh(2)
    const mesh = EditMesh.from(plane)
    const fixture: EditFixture = { mesh: plane, edges: [keyOf(mesh, 0, 1), keyOf(mesh, 1, 2)], selectMode: ['edge'] }

    const inner = resultEdit(ran('mesh.subdivide', fixture, { quadCorner: 'inner-vertex' }))

    expect(points(inner).filter((point) => point[0] === 0 && point[1] === 0)).toHaveLength(1)
  })

  it('leaves a face the patterns do not name as one n-gon, or fans it when n-gons are off', () => {
    const plane = planeMesh(2)
    const mesh = EditMesh.from(plane)
    const fixture: EditFixture = { mesh: plane, edges: [keyOf(mesh, 0, 1)], selectMode: ['edge'] }

    const kept = resultEdit(ran('mesh.subdivide', fixture, { ngon: true }))
    const fanned = resultEdit(ran('mesh.subdivide', fixture, { ngon: false }))

    expect(counts(kept)).toEqual({ vertices: 5, edges: 5, faces: 1 })
    expect(sides(kept)).toEqual([5])
    expect(counts(fanned)).toEqual({ vertices: 5, edges: 7, faces: 3 })
    expect(new Set(sides(fanned))).toEqual(new Set([3]))
    expect(isWellFormed(kept)).toBe(true)
    expect(isWellFormed(fanned)).toBe(true)
  })

  it('displaces the new vertices from the seed, and only from the seed', () => {
    const plane = planeMesh(2)

    const once = points(resultEdit(ran('mesh.subdivide', allOf(plane), { fractal: 0.5, seed: 7 })))
    const again = points(resultEdit(ran('mesh.subdivide', allOf(plane), { fractal: 0.5, seed: 7 })))
    const other = points(resultEdit(ran('mesh.subdivide', allOf(plane), { fractal: 0.5, seed: 8 })))
    const flat = points(resultEdit(ran('mesh.subdivide', allOf(plane), { fractal: 0 })))

    expect(once).toEqual(again)
    expect(once).not.toEqual(other)
    expect(flat.filter((point) => point[0] === 0 && point[1] === 0 && point[2] === 0)).toHaveLength(1)
  })

  it('leaves the whole cut region selected', () => {
    const plane = planeMesh(2)

    const selection = resultSelection(ran('mesh.subdivide', allOf(plane), { cuts: 1 }))

    expect(selection.vertices).toHaveLength(9)
    expect(selection.edges).toHaveLength(12)
    expect(selection.faces).toHaveLength(4)
  })

  it('replays with a different number of cuts', () => {
    const plane = planeMesh(2)
    const context = editContext(allOf(plane))

    const once = runOperator('mesh.subdivide', context, { cuts: 1 })
    const twice = runOperator('mesh.subdivide', context, { cuts: 2 })

    expect(counts(resultEdit(once))).toEqual({ vertices: 9, edges: 12, faces: 4 })
    expect(counts(resultEdit(twice))).toEqual({ vertices: 16, edges: 24, faces: 9 })
  })

  it('says so when nothing is selected, and when the selection holds no whole edge', () => {
    expect(refused('mesh.subdivide', { mesh: planeMesh(2) })).toBe('Nothing is selected.')
    expect(refused('mesh.subdivide', { mesh: planeMesh(2), vertices: [0] }))
      .toBe('Select an edge, or two vertices that share one.')
  })
})

/* --------------------------------------------------------------- un-subdivide */

describe('un-subdivide', () => {
  it('gives back the cube a subdivide was made from', () => {
    const cube = boxMesh(2)
    const finer = resultMesh(ran('mesh.subdivide', allOf(cube), { cuts: 1 }))

    const mesh = resultEdit(ran('mesh.unsubdivide', allOf(finer), { iterations: 1 }))

    expect(counts(mesh)).toEqual({ vertices: 8, edges: 12, faces: 6 })
    expect(new Set(sides(mesh))).toEqual(new Set([4]))
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('puts the corners back exactly where the cube had them', () => {
    const cube = boxMesh(2)
    const finer = resultMesh(ran('mesh.subdivide', allOf(cube), { cuts: 1 }))

    const mesh = resultEdit(ran('mesh.unsubdivide', allOf(finer), { iterations: 1 }))
    const corners = points(mesh).map((point) => point.join(' ')).sort()

    expect(corners).toEqual(points(EditMesh.from(cube)).map((point) => point.join(' ')).sort())
  })

  it('takes one level per iteration', () => {
    const cube = boxMesh(2)
    const once = resultMesh(ran('mesh.subdivide', allOf(cube), { cuts: 1 }))
    const twice = resultMesh(ran('mesh.subdivide', allOf(once), { cuts: 1 }))
    const context = editContext(allOf(twice))

    const one = runOperator('mesh.unsubdivide', context, { iterations: 1 })
    const two = runOperator('mesh.unsubdivide', context, { iterations: 2 })

    expect(counts(EditMesh.from(twice))).toEqual({ vertices: 98, edges: 192, faces: 96 })
    expect(counts(resultEdit(one))).toEqual({ vertices: 26, edges: 48, faces: 24 })
    expect(counts(resultEdit(two))).toEqual({ vertices: 8, edges: 12, faces: 6 })
  })

  it('says so when there is nothing left to take off', () => {
    expect(refused('mesh.unsubdivide', allOf(planeMesh(2))))
      .toBe('This mesh has nothing left to un-subdivide.')
  })
})

/* ------------------------------------------------------------------ poke faces */

describe('poke faces', () => {
  it('turns a quad into four triangles round a new centre', () => {
    const plane = planeMesh(2)

    const mesh = resultEdit(ran('mesh.poke', allOf(plane)))

    expect(counts(mesh)).toEqual({ vertices: 5, edges: 8, faces: 4 })
    expect(new Set(sides(mesh))).toEqual(new Set([3]))
    expect(points(mesh)[4]).toEqual([0, 0, 0])
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('lifts the centre along the face normal, absolutely or relative to the face', () => {
    const plane = planeMesh(2)

    const lifted = resultEdit(ran('mesh.poke', allOf(plane), { offset: 0.5 }))
    const relative = resultEdit(ran('mesh.poke', allOf(plane), { offset: 0.5, useRelative: true }))

    expect(points(lifted)[4]).toEqual([0, 0, 0.5])
    // The plane is 2 m across, so its average side is 2 m and the offset is doubled.
    expect(points(relative)[4]).toEqual([0, 0, 1])
  })

  it('takes the centre from the bounding box when asked to', () => {
    const triangle = circleMesh({ vertices: 3, fill: 'ngon' })

    const median = resultEdit(ran('mesh.poke', allOf(triangle), { centerMode: 'median' }))
    const bounds = resultEdit(ran('mesh.poke', allOf(triangle), { centerMode: 'bounds' }))

    expect(points(median)[3]!.map(rounded)).toEqual([0, 0, 0])
    expect(points(bounds)[3]!.map(rounded)).toEqual([0.25, 0, 0])
  })

  it('leaves the poked faces selected', () => {
    const plane = planeMesh(2)

    const selection = resultSelection(ran('mesh.poke', allOf(plane)))

    expect(selection.vertices).toHaveLength(5)
    expect(selection.faces).toHaveLength(4)
  })

  it('replays with a different offset', () => {
    const context = editContext(allOf(planeMesh(2)))

    const flat = runOperator('mesh.poke', context, { offset: 0 })
    const raised = runOperator('mesh.poke', context, { offset: 1 })

    expect(points(resultEdit(flat))[4]).toEqual([0, 0, 0])
    expect(points(resultEdit(raised))[4]).toEqual([0, 0, 1])
  })

  it('says so when no face is selected', () => {
    expect(refused('mesh.poke', { mesh: planeMesh(2) })).toBe('No faces are selected.')
  })
})

/* ----------------------------------------------------------------- triangulate */

describe('triangulate faces', () => {
  it('cuts every face of a cube in two and leaves it closed', () => {
    const cube = boxMesh(2)

    const mesh = resultEdit(ran('mesh.triangulate', allOf(cube), { quadMethod: 'fixed' }))

    expect(counts(mesh)).toEqual({ vertices: 8, edges: 18, faces: 12 })
    expect(new Set(sides(mesh))).toEqual(new Set([3]))
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('takes the shorter diagonal of a stretched quad, and the named one when told to', () => {
    // No primitive makes a trapezium, and a square’s two diagonals are the same length.
    const trapezium = meshFromPolygons(
      [[0, 0, 0], [3, 0, 0], [4, 1, 0], [0, 1, 0]],
      [[0, 1, 2, 3]],
    )

    const shortest = resultEdit(ran('mesh.triangulate', allOf(trapezium), { quadMethod: 'shortest-diagonal' }))
    const fixed = resultEdit(ran('mesh.triangulate', allOf(trapezium), { quadMethod: 'fixed' }))

    expect(shortest.edgeSlot(1, 3)).toBeGreaterThanOrEqual(0)
    expect(shortest.edgeSlot(0, 2)).toBe(-1)
    expect(fixed.edgeSlot(0, 2)).toBeGreaterThanOrEqual(0)
    expect(fixed.edgeSlot(1, 3)).toBe(-1)
  })

  it('clips an n-gon into as many triangles as it has corners, less two', () => {
    const hexagon = circleMesh({ vertices: 6, fill: 'ngon' })

    const clipped = resultEdit(ran('mesh.triangulate', allOf(hexagon), { ngonMethod: 'clip' }))
    const beautiful = resultEdit(ran('mesh.triangulate', allOf(hexagon), { ngonMethod: 'beauty' }))

    for (const mesh of [clipped, beautiful]) {
      expect(counts(mesh)).toEqual({ vertices: 6, edges: 9, faces: 4 })
      expect(new Set(sides(mesh))).toEqual(new Set([3]))
      expect(euler(mesh)).toBe(1)
      expect(isWellFormed(mesh)).toBe(true)
    }
  })

  it('replays with a different quad method, which turns the diagonal', () => {
    const context = editContext(allOf(planeMesh(2)))

    const first = resultEdit(runOperator('mesh.triangulate', context, { quadMethod: 'fixed' }))
    const second = resultEdit(runOperator('mesh.triangulate', context, { quadMethod: 'alternate' }))

    expect(first.edgeSlot(0, 2)).toBeGreaterThanOrEqual(0)
    expect(second.edgeSlot(1, 3)).toBeGreaterThanOrEqual(0)
  })

  it('says so when every selected face is already a triangle', () => {
    const triangle = circleMesh({ vertices: 3, fill: 'ngon' })

    expect(refused('mesh.triangulate', allOf(triangle))).toBe('Every selected face is already a triangle.')
  })
})

/* --------------------------------------------------------------- tris to quads */

describe('tris to quads', () => {
  it('gives a triangulated grid back the faces it had', () => {
    const grid = gridMesh({ xSubdivisions: 4, ySubdivisions: 4 })
    const cut = resultMesh(ran('mesh.triangulate', allOf(grid), { quadMethod: 'fixed' }))

    const mesh = resultEdit(ran('mesh.trisToQuads', allOf(cut)))

    expect(counts(EditMesh.from(cut))).toEqual({ vertices: 16, edges: 33, faces: 18 })
    expect(counts(mesh)).toEqual({ vertices: 16, edges: 24, faces: 9 })
    expect(new Set(sides(mesh))).toEqual(new Set([4]))
    expect(euler(mesh)).toBe(1)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('will not pair triangles of different materials when told to compare them', () => {
    const cut = resultMesh(ran('mesh.triangulate', allOf(planeMesh(2)), { quadMethod: 'fixed' }))
    const painted: MeshData = {
      ...cut,
      attributes: { ...cut.attributes, face: { ...cut.attributes.face, material: [0, 1] } },
    }

    const joined = resultEdit(ran('mesh.trisToQuads', allOf(painted), { compareMaterials: false }))

    expect(counts(joined)).toEqual({ vertices: 4, edges: 4, faces: 1 })
    expect(refused('mesh.trisToQuads', allOf(painted), { compareMaterials: true }))
      .toBe('No two selected triangles are close enough to join.')
  })

  it('replays with a wider face angle, which is what lets an icosahedron pair up', () => {
    const ico = icoSphereMesh({ subdivisions: 1 })
    const context = editContext(allOf(ico))

    const wide = runOperator('mesh.trisToQuads', context, { faceAngle: 45 })
    const narrow = runOperator('mesh.trisToQuads', context, { faceAngle: 30 })

    expect(resultEdit(wide).faceCount).toBeLessThan(20)
    expect(sides(resultEdit(wide)).filter((count) => count === 4).length).toBeGreaterThan(0)
    expect(isWellFormed(resultEdit(wide))).toBe(true)
    expect(isClosed(resultEdit(wide))).toBe(true)
    expect(narrow.error).toBe('No two selected triangles are close enough to join.')
  })
})

/* ---------------------------------------------------------------- rotate edge */

describe('rotate edge', () => {
  it('swaps the diagonal shared by two triangles', () => {
    const cut = resultMesh(ran('mesh.triangulate', allOf(planeMesh(2)), { quadMethod: 'fixed' }))
    const mesh = EditMesh.from(cut)
    const fixture: EditFixture = { mesh: cut, edges: [keyOf(mesh, 0, 2)], selectMode: ['edge'] }

    const turned = resultEdit(ran('mesh.rotateEdge', fixture))

    expect(counts(turned)).toEqual({ vertices: 4, edges: 5, faces: 2 })
    expect(turned.edgeSlot(0, 2)).toBe(-1)
    expect(turned.edgeSlot(1, 3)).toBeGreaterThanOrEqual(0)
    expect(new Set(sides(turned))).toEqual(new Set([3]))
    expect(isWellFormed(turned)).toBe(true)
  })

  it('replays the other way round, which turns the shared edge of two quads the other way', () => {
    const strip = gridMesh({ xSubdivisions: 3, ySubdivisions: 2 })
    const mesh = EditMesh.from(strip)
    const context = editContext({ mesh: strip, edges: [keyOf(mesh, 1, 4)], selectMode: ['edge'] })

    const clockwise = resultEdit(runOperator('mesh.rotateEdge', context, { direction: 'cw' }))
    const other = resultEdit(runOperator('mesh.rotateEdge', context, { direction: 'ccw' }))

    expect(counts(clockwise)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(counts(other)).toEqual({ vertices: 6, edges: 7, faces: 2 })
    expect(clockwise.edgeSlot(2, 3)).toBeGreaterThanOrEqual(0)
    expect(other.edgeSlot(0, 5)).toBeGreaterThanOrEqual(0)
    expect(isWellFormed(clockwise)).toBe(true)
    expect(isWellFormed(other)).toBe(true)
  })

  it('leaves the turned edge selected', () => {
    const cut = resultMesh(ran('mesh.triangulate', allOf(planeMesh(2)), { quadMethod: 'fixed' }))
    const mesh = EditMesh.from(cut)

    const selection = resultSelection(ran('mesh.rotateEdge', {
      mesh: cut,
      edges: [keyOf(mesh, 0, 2)],
      selectMode: ['edge'],
    }))

    expect(selection.edges).toEqual([keyOf(mesh, 1, 3)])
  })

  it('refuses an edge with only one face beside it', () => {
    const plane = planeMesh(2)
    const mesh = EditMesh.from(plane)

    expect(refused('mesh.rotateEdge', { mesh: plane, edges: [keyOf(mesh, 0, 1)], selectMode: ['edge'] }))
      .toBe('Rotating an edge needs two faces sharing it.')
  })
})

/* ----------------------------------------------------------------- edge split */

describe('edge split', () => {
  it('pulls every face of a cube apart when every edge is selected', () => {
    const cube = boxMesh(2)

    const mesh = resultEdit(ran('mesh.edgeSplit', allOf(cube)))

    expect(counts(mesh)).toEqual({ vertices: 24, edges: 24, faces: 6 })
    expect(new Set(sides(mesh))).toEqual(new Set([4]))
    expect(isClosed(mesh)).toBe(false)
    expect(euler(mesh)).toBe(6)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('lifts one face off the cube when only its border is selected', () => {
    const cube = boxMesh(2)
    const mesh = EditMesh.from(cube)
    const border = [keyOf(mesh, 4, 5), keyOf(mesh, 5, 6), keyOf(mesh, 6, 7), keyOf(mesh, 7, 4)]

    const split = resultEdit(ran('mesh.edgeSplit', { mesh: cube, edges: border, selectMode: ['edge'] }))

    expect(counts(split)).toEqual({ vertices: 12, edges: 16, faces: 6 })
    expect(euler(split)).toBe(2)
    expect(isWellFormed(split)).toBe(true)
    // The copies land on the corners they came from, so nothing moves on screen.
    expect(points(split).filter((point) => point.every((value) => Math.abs(value) === 1))).toHaveLength(12)
  })

  it('gives the same answer when the redo panel runs it again', () => {
    const context = editContext(allOf(boxMesh(2)))

    const first = runOperator('mesh.edgeSplit', context, {})
    const second = runOperator('mesh.edgeSplit', context, {})

    expect(points(resultEdit(first))).toEqual(points(resultEdit(second)))
    expect(counts(resultEdit(second))).toEqual({ vertices: 24, edges: 24, faces: 6 })
  })

  it('says so when every selected edge is already a border', () => {
    expect(refused('mesh.edgeSplit', allOf(planeMesh(2)))).toBe('Every selected edge is already a boundary.')
  })

  it('says so when a lone edge in the middle of a surface cannot come apart', () => {
    const cube = boxMesh(2)
    const mesh = EditMesh.from(cube)

    expect(refused('mesh.edgeSplit', { mesh: cube, edges: [keyOf(mesh, 0, 4)], selectMode: ['edge'] }))
      .toBe('These edges cannot come apart on their own: split a whole loop of them.')
  })
})

describe('edge split by sharp', () => {
  it('parts every fold of a cube sharper than the angle', () => {
    const cube = boxMesh(2)

    const mesh = resultEdit(ran('mesh.edgeSplitBySharp', { mesh: cube }, { angle: 30 }))

    expect(counts(mesh)).toEqual({ vertices: 24, edges: 24, faces: 6 })
    expect(new Set(sides(mesh))).toEqual(new Set([4]))
    expect(euler(mesh)).toBe(6)
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('parts the edges the sharp attribute names, with the angle switched off', () => {
    const cube = boxMesh(2)
    const mesh = EditMesh.from(cube)
    const sharp = cube.edges.map(([a, b]) => [a, b].every((slot) => slot >= 4))
    const marked: MeshData = {
      ...cube,
      attributes: { ...cube.attributes, edge: { ...cube.attributes.edge, sharp } },
    }
    expect(sharp.filter(Boolean)).toHaveLength(4)
    expect(mesh.edgeCount).toBe(12)

    const split = resultEdit(ran('mesh.edgeSplitBySharp', { mesh: marked }, { useEdgeAngle: false }))

    expect(counts(split)).toEqual({ vertices: 12, edges: 16, faces: 6 })
    expect(euler(split)).toBe(2)
    expect(isWellFormed(split)).toBe(true)
    expect(points(split).filter((point) => point.every((value) => Math.abs(value) === 1))).toHaveLength(12)
  })

  it('replays with a wider angle, which leaves the cube alone', () => {
    const context = editContext({ mesh: boxMesh(2) })

    const sharp = runOperator('mesh.edgeSplitBySharp', context, { angle: 30 })
    const blunt = runOperator('mesh.edgeSplitBySharp', context, { angle: 100 })

    expect(counts(resultEdit(sharp))).toEqual({ vertices: 24, edges: 24, faces: 6 })
    expect(blunt.error).toBe('No edge here is sharp enough to split.')
  })

  it('says so when nothing is sharp and the angle is switched off', () => {
    expect(refused('mesh.edgeSplitBySharp', { mesh: boxMesh(2) }, { useEdgeAngle: false }))
      .toBe('No edge here is sharp enough to split.')
  })
})
