import { initializeBuiltinModifiers } from '@/scene/modifiers'
initializeBuiltinModifiers()
import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh, planeMesh } from '@/scene/mesh/primitives'

import { IDENTITY, translation } from '@/scene/modifiers/matrix'
import { getModifier, type ModifierInput, type ModifierOutcome } from '@/scene/modifiers/types'
import { euler, isClosed, isWellFormed, meshVolume } from '@/scene/operators/editHarness'
import type { MeshData, Modifier, Vec3 } from '@/scene/types'

/*
 * Every volume here is worked out from the shapes rather than copied from a run: two cubes two
 * metres across, the operand offset by one metre on each axis, overlap in a cube one metre across.
 * So the union is 8 + 8 − 1 m³, the difference is 8 − 1 m³ and the intersection is 1 m³, and a
 * solver that drifts from those numbers is wrong however plausible its mesh looks. Two per cent is
 * the margin the weld and the dropped slivers are allowed to cost.
 */

const CUBE = 2 ** 3
const OVERLAP = 1 ** 3
const MARGIN = 0.02

const module = getModifier('boolean')!

function operandInput(mesh: MeshData | null, matrix: number[] = IDENTITY): ModifierInput {
  return { id: 'operand', name: 'Operand', matrix, mesh }
}

function boolean(
  mesh: EditMesh,
  params: Modifier['params'],
  operand: ModifierInput | null,
): ModifierOutcome {
  return module.apply(mesh, { ...module.defaults, ...params }, {
    inputs: { operand },
    forRender: false,
    editing: false,
  })
}

/** The other cube, one metre along each axis, as the stack would hand it over. */
function offsetCube(offset: Vec3 = [1, 1, 1], mesh: MeshData = boxMesh(2)): ModifierInput {
  return operandInput(mesh, translation(offset))
}

describe('the boolean modifier', () => {
  it('fuses the operand into this mesh and keeps the volume the two shapes say', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(boolean(mesh, { operation: 'union' }, offsetCube())).toBeUndefined()

    const wanted = CUBE * 2 - OVERLAP
    expect(meshVolume(mesh) / wanted).toBeGreaterThan(1 - MARGIN)
    expect(meshVolume(mesh) / wanted).toBeLessThan(1 + MARGIN)
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    // Twelve flat faces, six from each cube, rather than the solver's triangles.
    expect(mesh.faceCount).toBe(12)
    expect(mesh.vertexCount).toBe(32)
  })

  it('reaches from one cube to the other, since the operand comes through its matrix', () => {
    const mesh = EditMesh.from(boxMesh(2))

    boolean(mesh, { operation: 'union' }, offsetCube())

    const bounds = mesh.bounds()
    expect(bounds.min.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([-1, -1, -1])
    expect(bounds.max.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([2, 2, 2])
  })

  it('cuts the operand out, and keeps only what the two share', () => {
    const cut = EditMesh.from(boxMesh(2))
    expect(boolean(cut, { operation: 'difference' }, offsetCube())).toBeUndefined()
    expect(meshVolume(cut) / (CUBE - OVERLAP)).toBeGreaterThan(1 - MARGIN)
    expect(meshVolume(cut) / (CUBE - OVERLAP)).toBeLessThan(1 + MARGIN)
    expect(isClosed(cut)).toBe(true)
    expect(isWellFormed(cut)).toBe(true)
    expect(cut.faceCount).toBe(9)

    const shared = EditMesh.from(boxMesh(2))
    expect(boolean(shared, { operation: 'intersect' }, offsetCube())).toBeUndefined()
    expect(meshVolume(shared) / OVERLAP).toBeGreaterThan(1 - MARGIN)
    expect(meshVolume(shared) / OVERLAP).toBeLessThan(1 + MARGIN)
    expect(isClosed(shared)).toBe(true)
    expect(shared.faceCount).toBe(6)
    expect(shared.bounds().min.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([0, 0, 0])
  })

  it('refuses without an operand, and with one that carries no faces', () => {
    expect(boolean(EditMesh.from(boxMesh(2)), { operation: 'union' }, null))
      .toBe('Boolean needs another object to work against; choose one in the Operand field.')
    // An object chosen that carries no mesh of its own — an empty, a light — is the same refusal as
    // a mesh with no faces: there is a name in the field and nothing behind it to cut with.
    expect(boolean(EditMesh.from(boxMesh(2)), { operation: 'union' }, operandInput(null)))
      .toBe('The operand has no faces, so there is nothing to work against.')
    expect(boolean(EditMesh.from(boxMesh(2)), { operation: 'union' }, operandInput(circleMesh({ vertices: 8, fill: 'none' }))))
      .toBe('The operand has no faces, so there is nothing to work against.')
  })

  it('refuses an operand that is not closed until it is told to tolerate one', () => {
    const open = operandInput(planeMesh(4), translation([0, 0, 0]))

    expect(boolean(EditMesh.from(boxMesh(2)), { operation: 'difference' }, open))
      .toBe('The operand is an open surface; switch on Hole tolerant to cut with it anyway.')
    expect(boolean(EditMesh.from(boxMesh(2)), { operation: 'difference', holeTolerant: true }, open))
      .not.toBe('The operand is an open surface; switch on Hole tolerant to cut with it anyway.')
  })

  it('says what came out empty rather than handing on a mesh with nothing in it', () => {
    const swallowed = EditMesh.from(boxMesh(1))
    expect(boolean(swallowed, { operation: 'difference' }, operandInput(boxMesh(4))))
      .toBe('The operand covers this mesh completely, so nothing would be left of it.')
    // The refusal leaves the mesh as it was: the stack carries on past it with the cube it had.
    expect(swallowed.faceCount).toBe(6)

    const apart = EditMesh.from(boxMesh(2))
    expect(boolean(apart, { operation: 'intersect' }, offsetCube([8, 0, 0])))
      .toBe('This mesh and the operand do not overlap, so there is nothing to intersect.')
  })

  it('reads each face’s material off the surface it came from, and moves the operand’s along on transfer', () => {
    const marked = EditMesh.from(boxMesh(2))
    for (let face = 0; face < marked.faceCount; face += 1) marked.setFaceMaterial(face, 1)
    const operand = offsetCube([1, 1, 1], marked.toData())

    const kept = EditMesh.from(boxMesh(2))
    boolean(kept, { operation: 'union', materialMode: 'index' }, operand)
    const materials = new Set<number>()
    for (let face = 0; face < kept.faceCount; face += 1) materials.add(kept.faceMaterial(face))
    expect(materials).toEqual(new Set([0, 1]))

    const moved = EditMesh.from(boxMesh(2))
    boolean(moved, { operation: 'union', materialMode: 'transfer' }, operand)
    const shifted = new Set<number>()
    for (let face = 0; face < moved.faceCount; face += 1) shifted.add(moved.faceMaterial(face))
    // This mesh uses one slot, so the operand's first slot follows it: its material 1 becomes 2.
    expect(shifted).toEqual(new Set([0, 2]))
  })
})
