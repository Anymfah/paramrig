import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { gridMesh } from '@/scene/mesh/primitives'
import '@/scene/modifiers/smooth'
import { getModifier, type ModifierOutcome } from '@/scene/modifiers/types'
import { isWellFormed } from '@/scene/operators/editHarness'
import type { Modifier, Vec3 } from '@/scene/types'

/*
 * Smooth moves vertices and nothing else, which makes it the one modifier whose every answer can be
 * written down: the average of four neighbours is a number, not a shape. So the cases here are a
 * spike over a flat grid with its exact heights asserted pass by pass, rather than a mesh that
 * merely looks rounder afterwards.
 */

const module = getModifier('smooth')!

function run(mesh: EditMesh, params: Modifier['params'] = {}): ModifierOutcome {
  return module.apply(mesh, { ...module.defaults, ...params }, { inputs: {}, forRender: false, editing: false })
}

/** A three by three grid with its middle vertex lifted: four neighbours at nought, a tip at `height`. */
function spike(height: number): EditMesh {
  const mesh = EditMesh.from(gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 }))
  mesh.setPosition(slotAt(mesh, 0, 0), [0, 0, height])
  return mesh
}

/** The slot of the vertex standing over a place on the grid, found rather than counted to. */
function slotAt(mesh: EditMesh, x: number, y: number): number {
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    if (Math.abs(point[0] - x) < 1e-9 && Math.abs(point[1] - y) < 1e-9) return slot
  }
  throw new Error(`No vertex stands at ${x}, ${y}.`)
}

function positions(mesh: EditMesh): Vec3[] {
  const points: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) points.push(mesh.position(slot))
  return points
}

describe('the smooth modifier', () => {
  it('drops the tip of a spike onto the average of its neighbours, and changes no count', () => {
    const mesh = spike(3)
    const tip = slotAt(mesh, 0, 0)

    expect(run(mesh, { factor: 1, repeat: 1 })).toBeUndefined()

    expect(mesh.position(tip)[2]).toBeCloseTo(0, 10)
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([9, 12, 4])
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('moves the tip a third of the way at a third of a factor', () => {
    const mesh = spike(3)
    const tip = slotAt(mesh, 0, 0)

    run(mesh, { factor: 0.333, repeat: 1 })

    expect(mesh.position(tip)[2]).toBeCloseTo(3 * (1 - 0.333), 10)
  })

  it('smooths again on what the pass before it left', () => {
    const mesh = spike(3)
    const tip = slotAt(mesh, 0, 0)
    const side = slotAt(mesh, 1, 0)
    const corner = slotAt(mesh, 1, 1)

    run(mesh, { factor: 0.5, repeat: 2 })

    // Pass one leaves the tip at 1.5 and its four neighbours at 0.5; pass two averages those.
    expect(mesh.position(tip)[2]).toBeCloseTo(1, 10)
    expect(mesh.position(side)[2]).toBeCloseTo(0.5, 10)
    expect(mesh.position(corner)[2]).toBeCloseTo(0.25, 10)
  })

  it('leaves the axes that are switched off exactly where they were', () => {
    const mesh = spike(3)
    const before = positions(mesh)
    const tip = slotAt(mesh, 0, 0)

    run(mesh, { factor: 1, repeat: 1, axisX: false, axisY: false, axisZ: true })

    expect(mesh.position(tip)[2]).toBeCloseTo(0, 10)
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      expect(mesh.position(slot)[0]).toBe(before[slot]![0])
      expect(mesh.position(slot)[1]).toBe(before[slot]![1])
    }
  })

  it('does nothing at all with a repeat of nought', () => {
    const mesh = spike(3)
    const before = positions(mesh)

    expect(run(mesh, { factor: 1, repeat: 0 })).toBeUndefined()

    expect(positions(mesh)).toEqual(before)
  })

  it('refuses when every axis is switched off', () => {
    const mesh = spike(3)

    expect(run(mesh, { axisX: false, axisY: false, axisZ: false }))
      .toBe('Leave at least one axis on, or nothing can move.')
  })

  it('refuses a mesh with no edges to average along', () => {
    const mesh = EditMesh.from(meshFromPolygons([[0, 0, 0], [1, 0, 0]], []))

    expect(run(mesh)).toBe('Smooth averages along the edges, and this mesh has none.')
  })
})
