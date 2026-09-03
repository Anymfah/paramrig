import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import { multiply, rotation, translation } from '@/scene/modifiers/matrix'
import { getModifier, type ModifierInput } from '@/scene/modifiers/types'
import { euler, isClosed, isWellFormed, meshVolume } from '@/scene/operators/editHarness'
import type { MeshData, Modifier } from '@/scene/types'
import '@/scene/modifiers/array'

/**
 * Array, judged by where the copies land and by what the seams cost.
 *
 * A two-metre cube arrayed three times with a relative offset of one steps exactly its own width
 * each time, so the far copy is centred four metres along and the whole run measures six. Merging
 * then has to take away exactly the four vertices each seam shares and nothing else — the counts
 * here are worked out from that arithmetic rather than read off a run, so a weld that grew greedy
 * or an offset that drifted fails.
 */

const module = getModifier('array')!

function array(mesh: EditMesh, params: Modifier['params'] = {}, inputs: Record<string, ModifierInput | null> = {}) {
  return module.apply(mesh, { ...module.defaults, ...params }, { inputs, forRender: false, editing: false })
}

function object(id: string, matrix: number[], mesh: MeshData | null = null): ModifierInput {
  return { id, name: id, matrix, mesh }
}

/** A quarter turn about Z three metres out: the offset that arrays a run of boxes round a corner. */
function turningOffset(): number[] {
  return multiply(translation([3, 0, 0]), rotation([0, 0, 1], Math.PI / 2))
}

/** How many vertices sit on another one: what a weld that did not happen leaves behind. */
function coincident(mesh: EditMesh): number {
  let doubled = 0
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    for (let other = slot + 1; other < mesh.vertexCount; other += 1) {
      const there = mesh.position(other)
      if (Math.hypot(point[0] - there[0], point[1] - there[1], point[2] - there[2]) < 1e-9) doubled += 1
    }
  }
  return doubled
}

describe('the array modifier', () => {
  it('repeats a cube three times along its own width', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(array(mesh, { count: 3 })).toBeUndefined()

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([24, 36, 18])
    expect(euler(mesh)).toBe(6)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(24, 10)
    // Copies centred on 0, 2 and 4: the far one is four metres along, and the run is six long.
    expect(mesh.bounds().min[0]).toBeCloseTo(-1, 10)
    expect(mesh.bounds().max[0]).toBeCloseTo(5, 10)
  })

  it('welds the ring each seam shares when merge is on', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(array(mesh, { count: 3, merge: true })).toBeUndefined()

    // Twenty-four vertices less the four of each of the two seams; the wall between two copies is
    // kept once rather than twice, which is the one face each weld drops.
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([16, 28, 16])
    expect(euler(mesh)).toBe(4)
    expect(isWellFormed(mesh)).toBe(true)
    expect(mesh.bounds().max[0]).toBeCloseTo(5, 10)
  })

  it('fits the count to a length', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(array(mesh, { fitType: 'length', length: 7 })).toBeUndefined()

    // Seven metres at two metres a step is three whole steps, and the mesh itself is the first copy.
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([32, 48, 24])
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(32, 10)
    expect(mesh.bounds().max[0]).toBeCloseTo(7, 10)
  })

  it('turns every copy by an object offset', () => {
    const mesh = EditMesh.from(boxMesh([2, 1, 1]))

    const outcome = array(mesh, { count: 3, useRelative: false, useObject: true, offsetObject: 'turn' }, {
      offsetObject: object('turn', turningOffset()),
    })

    expect(outcome).toBeUndefined()
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([24, 36, 18])
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(6, 10)
    // The second copy lies across the run rather than along it: a quarter turn, then three metres.
    expect(mesh.bounds().max[0]).toBeCloseTo(4, 10)
    expect(mesh.bounds().max[1]).toBeCloseTo(3.5, 10)
    expect(mesh.bounds().min[1]).toBeCloseTo(-1, 10)
  })

  it('welds the last copy onto the first when the run comes back round', () => {
    const open = EditMesh.from(boxMesh(2))
    const closed = EditMesh.from(boxMesh(2))
    const corner = { offsetObject: object('corner', multiply(translation([2, 0, 0]), rotation([0, 0, 1], Math.PI / 2))) }
    const round = { count: 4, useRelative: false, useObject: true, offsetObject: 'corner', merge: true }

    array(open, round, corner)
    array(closed, { ...round, firstLast: true }, corner)

    // Two metres on and a quarter turn, four times, brings the run back to where it started: a
    // two-by-two block of boxes whose corners are a three-by-three grid twice over.
    expect(open.vertexCount).toBe(20)
    expect(coincident(open)).toBe(2)
    expect([closed.vertexCount, closed.edgeCount, closed.faceCount]).toEqual([18, 33, 20])
    expect(coincident(closed)).toBe(0)
    expect(isWellFormed(closed)).toBe(true)
  })

  it('places a cap at each end', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const cap = planeMesh(2)

    const outcome = array(mesh, { count: 2, startCap: 'start', endCap: 'end' }, {
      startCap: object('start', translation([0, 0, 0]), cap),
      endCap: object('end', translation([0, 0, 0]), cap),
    })

    expect(outcome).toBeUndefined()
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([24, 32, 14])
    expect(isWellFormed(mesh)).toBe(true)
    // One step before the first copy and one step after the last: three metres either side of it.
    expect(mesh.bounds().min[0]).toBeCloseTo(-3, 10)
    expect(mesh.bounds().max[0]).toBeCloseTo(5, 10)
  })

  it('refuses to fit a length along an offset of nothing', () => {
    const mesh = EditMesh.from(boxMesh(2))

    const outcome = array(mesh, { fitType: 'length', length: 7, useRelative: false })

    expect(outcome).toBe('Fit length needs an offset that is not zero.')
    expect([mesh.vertexCount, mesh.faceCount]).toEqual([8, 6])
  })

  it('refuses when the offset object it names has gone from the scene', () => {
    const mesh = EditMesh.from(boxMesh(2))

    const outcome = array(mesh, { count: 3, useObject: true, offsetObject: 'gone' }, { offsetObject: null })

    expect(outcome).toBe('The offset object this modifier names is not in the scene any more.')
    expect(mesh.faceCount).toBe(6)
  })

  it('refuses when a cap object it names has gone from the scene', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(array(mesh, { endCap: 'gone' }, { endCap: null }))
      .toBe('The end cap object this modifier names is not in the scene any more.')
  })

  it('offers a field for every default it holds, with the same value', () => {
    const ids = module.schema.map((param) => param.id)

    expect([...ids].sort()).toEqual(Object.keys(module.defaults).sort())
    for (const param of module.schema) expect(module.defaults[param.id]).toEqual(param.defaultValue)
  })
})
