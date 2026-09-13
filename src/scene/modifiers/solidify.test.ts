import { initializeBuiltinModifiers } from '@/scene/modifiers'
initializeBuiltinModifiers()
import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { boxMesh, circleMesh, gridMesh, planeMesh } from '@/scene/mesh/primitives'

import { getModifier, type ModifierContext, type ModifierOutcome } from '@/scene/modifiers/types'
import {
  euler,
  isClosed,
  isConsistentlyWound,
  isWellFormed,
  meshVolume,
  signedVolume,
} from '@/scene/operators/editHarness'
import type { Modifier } from '@/scene/types'

/**
 * Solidify as a modifier, judged by the solid it leaves behind.
 *
 * A two-metre sheet given two tenths of thickness has to enclose 2 × 2 × 0.2 = 0.8 m³, and a cube
 * given the same has to enclose the difference between itself and the cube two tenths inside it.
 * Both numbers are worked out from the shape here rather than copied from a run, so a change that
 * quietly thickens the shell or loses a corner to the evening-out fails in this file.
 */

function solidify(
  mesh: EditMesh,
  params: Modifier['params'] = {},
  context: Partial<ModifierContext> = {},
): ModifierOutcome {
  const module = getModifier('solidify')!
  return module.apply(mesh, { ...module.defaults, ...params }, {
    inputs: {},
    forRender: false,
    editing: false,
    ...context,
  })
}

/** The faces sitting at one height, which is how the outer skin, the inner one and the rim are told apart. */
function facesAt(mesh: EditMesh, height: number): number[] {
  const found: number[] = []
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (Math.abs(mesh.faceCentre(face)[2] - height) < 1e-9) found.push(face)
  }
  return found
}

describe('the solidify modifier', () => {
  it('turns a plane into a closed box of the thickness asked for', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(solidify(mesh, { thickness: 0.2 })).toBeUndefined()

    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(6)
    expect(meshVolume(mesh)).toBeCloseTo(2 * 2 * 0.2, 3)
  })

  it('fills the rim, and winds it outwards with the rest of the shell', () => {
    const mesh = EditMesh.from(planeMesh(2))

    solidify(mesh, { thickness: 0.2 })

    // Four quads standing between the two skins, one along each side of the sheet.
    expect(facesAt(mesh, -0.1)).toHaveLength(4)
    expect(isConsistentlyWound(mesh)).toBe(true)
    // Positive means the faces face out of the solid rather than into it, which no count can see.
    expect(signedVolume(mesh)).toBeGreaterThan(0)
  })

  it('hangs the second skin under the surface at an offset of −1, and splits it at nought', () => {
    const under = EditMesh.from(planeMesh(2))
    solidify(under, { thickness: 0.2, offset: -1 })
    expect(under.bounds().max[2]).toBeCloseTo(0, 10)
    expect(under.bounds().min[2]).toBeCloseTo(-0.2, 10)

    const centred = EditMesh.from(planeMesh(2))
    solidify(centred, { thickness: 0.2, offset: 0 })
    expect(centred.bounds().max[2]).toBeCloseTo(0.1, 10)
    expect(centred.bounds().min[2]).toBeCloseTo(-0.1, 10)
    expect(meshVolume(centred)).toBeCloseTo(2 * 2 * 0.2, 10)
  })

  it('leaves the two skins unjoined when the rim is not filled', () => {
    const mesh = EditMesh.from(planeMesh(2))

    solidify(mesh, { thickness: 0.2, rim: false })

    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(false)
    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(8)
    expect(mesh.faceCount).toBe(2)
    // Two loose sheets, each with its own four-sided border and nothing bridging them.
    expect(mesh.boundaryEdges()).toHaveLength(8)
  })

  it('keeps the band and drops both skins when only the rim is wanted', () => {
    const mesh = EditMesh.from(planeMesh(2))

    solidify(mesh, { thickness: 0.2, onlyRim: true })

    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(false)
    expect(mesh.vertexCount).toBe(8)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(4)
    // A tube open at both ends: eight vertices, twelve edges, four quads, and Euler nought.
    expect(euler(mesh)).toBe(0)
    expect(mesh.boundaryEdges()).toHaveLength(8)
  })

  it('sends the inner skin’s faces the material offset along, and leaves the rest alone', () => {
    const mesh = EditMesh.from(planeMesh(2))

    solidify(mesh, { thickness: 0.2, materialOffset: 2 })

    const inner = facesAt(mesh, -0.2)
    const outer = facesAt(mesh, 0)
    expect(inner).toHaveLength(1)
    expect(outer).toHaveLength(1)
    expect(mesh.faceMaterial(inner[0]!)).toBe(2)
    expect(mesh.faceMaterial(outer[0]!)).toBe(0)
    for (const face of facesAt(mesh, -0.1)) expect(mesh.faceMaterial(face)).toBe(0)
  })

  it('creases the rim’s edges and no others', () => {
    // A three-by-three grid has four edges inside it that the rim never touches, which is what
    // makes it possible to say that the crease landed on the border and nowhere else.
    const mesh = EditMesh.from(gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 }))

    solidify(mesh, { thickness: 0.2, crease: 0.5 })

    let creased = 0
    let plain = 0
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      if (mesh.edgeNumber(edge, 'crease') > 0) creased += 1
      else plain += 1
    }
    // Eight edges round the sheet, eight round its copy and eight standing between them.
    expect(creased).toBe(24)
    expect(plain).toBe(8)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
  })

  it('turns the shell inside out when it is told to flip the normals', () => {
    const mesh = EditMesh.from(planeMesh(2))

    solidify(mesh, { thickness: 0.2, flipNormals: true })

    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(isConsistentlyWound(mesh)).toBe(true)
    expect(signedVolume(mesh)).toBeCloseTo(-0.8, 3)
  })

  it('keeps its thickness into a cube’s corners when even is on, and loses it when it is off', () => {
    const even = EditMesh.from(boxMesh(2))
    solidify(even, { thickness: 0.2, even: true })
    // A closed mesh has no border, so there is no rim: an outer cube and an inner one facing it.
    expect(isClosed(even)).toBe(true)
    expect(even.faceCount).toBe(12)
    expect(even.vertexCount).toBe(16)
    // Evened out, the corner is pushed 0.2 along each axis, so the hollow is a 1.6 metre cube.
    expect(meshVolume(even)).toBeCloseTo(2 ** 3 - 1.6 ** 3, 10)

    const plain = EditMesh.from(boxMesh(2))
    solidify(plain, { thickness: 0.2, even: false })
    // Left alone it only reaches 0.2 along the corner’s diagonal, so the hollow is bigger.
    expect(meshVolume(plain)).toBeCloseTo(2 ** 3 - (2 - (2 * 0.2) / Math.sqrt(3)) ** 3, 10)
  })

  it('says so when the mesh has no faces to thicken', () => {
    const mesh = EditMesh.from(circleMesh({ vertices: 4, radius: 1 }))

    expect(solidify(mesh, { thickness: 0.2 })).toBe('Solidify needs faces; this mesh has none.')
  })

  it('refuses a thickness of nothing', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(solidify(mesh, { thickness: 0 })).toBe('Give Solidify a thickness; nought has nothing to build.')
  })
})
