import { initializeBuiltinModifiers } from '@/scene/modifiers'
initializeBuiltinModifiers()
import { describe, expect, it } from 'vitest'
import { EditMesh } from '@/scene/mesh/editMesh'
import { length, subtract } from '@/scene/mesh/normals'
import { boxMesh, planeMesh, uvSphereMesh } from '@/scene/mesh/primitives'

import { IDENTITY, translation } from '@/scene/modifiers/matrix'
import { getModifier, type ModifierContext, type ModifierInput } from '@/scene/modifiers/types'
import { isClosed, isWellFormed } from '@/scene/operators/editHarness'
import type { MeshData, Modifier, Vec3 } from '@/scene/types'

/*
 * Displace moves vertices and nothing else, so the counts are asserted everywhere and the positions
 * are the point of every case. The case with no texture is the one that can be asserted exactly:
 * every vertex moves by `(1 − midlevel) × strength`, whatever the mesh.
 */

const module = getModifier('displace')!

function run(mesh: EditMesh, params: Modifier['params'] = {}, inputs: ModifierContext['inputs'] = {}) {
  return module.apply(mesh, { ...module.defaults, ...params }, { inputs, forRender: false, editing: false })
}

function positions(mesh: EditMesh): Vec3[] {
  return Array.from({ length: mesh.vertexCount }, (_, slot) => mesh.position(slot))
}

/** How far each vertex moved, in the order the mesh holds them. */
function travel(before: Vec3[], after: Vec3[]): number[] {
  return before.map((point, slot) => length(subtract(after[slot]!, point)))
}

function textureObject(matrix: number[], mesh: MeshData | null = null): ModifierInput {
  return { id: 'texture-frame', name: 'Frame', matrix, mesh }
}

describe('the displace modifier', () => {
  it('moves every vertex half a metre along its normal, and changes no count', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const before = positions(mesh)

    const outcome = run(mesh, { texture: 'none', strength: 1, midlevel: 0.5, direction: 'normal' })

    expect(outcome).toBeUndefined()
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    for (const distance of travel(before, positions(mesh))) expect(distance).toBeCloseTo(0.5, 12)
    // A cube's corner normal points along the diagonal, so half a metre along it is 0.5 / √3 each way.
    const step = 0.5 / Math.sqrt(3)
    expect(mesh.position(0)).toEqual([
      expect.closeTo(-1 - step, 12), expect.closeTo(-1 - step, 12), expect.closeTo(-1 - step, 12),
    ])
  })

  it('lifts a plane straight up by what the midlevel and the strength say', () => {
    const mesh = EditMesh.from(planeMesh(2))

    expect(run(mesh, { texture: 'none', strength: 3, midlevel: 0.25 })).toBeUndefined()

    // (1 − 0.25) × 3 = 2.25 m, along +Z because that is the way the plane faces.
    for (const point of positions(mesh)) {
      expect(point[2]).toBeCloseTo(2.25, 12)
    }
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([4, 4, 1])
    expect(isWellFormed(mesh)).toBe(true)
  })

  it('moves only along Z when the direction is Z', () => {
    const mesh = EditMesh.from(uvSphereMesh({ segments: 12, rings: 6 }))
    const before = positions(mesh)

    expect(run(mesh, { texture: 'noise', direction: 'z', strength: 2, seed: 5 })).toBeUndefined()

    const after = positions(mesh)
    let moved = 0
    for (let slot = 0; slot < after.length; slot += 1) {
      expect(after[slot]![0]).toBeCloseTo(before[slot]![0], 12)
      expect(after[slot]![1]).toBeCloseTo(before[slot]![1], 12)
      if (Math.abs(after[slot]![2] - before[slot]![2]) > 1e-6) moved += 1
    }
    expect(moved).toBeGreaterThan(after.length * 0.9)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
  })

  it('moves nothing at all when the midlevel is one and there is no texture', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const before = positions(mesh)

    expect(run(mesh, { texture: 'none', strength: 1, midlevel: 1 })).toBeUndefined()

    expect(positions(mesh)).toEqual(before)
  })

  it('normalises the custom direction, so its length is not a second strength', () => {
    const along = EditMesh.from(boxMesh(2))
    const far = EditMesh.from(boxMesh(2))

    run(along, { texture: 'none', direction: 'custom', customDirection: [0, 0, 1], strength: 1 })
    run(far, { texture: 'none', direction: 'custom', customDirection: [0, 0, 7], strength: 1 })

    expect(positions(far)).toEqual(positions(along))
    // The box sits between −1 and 1, and the whole of it went half a metre up.
    expect(positions(along).map((point) => Math.round(point[2] * 1e9) / 1e9).sort((a, b) => a - b)).toEqual([
      -0.5, -0.5, -0.5, -0.5, 1.5, 1.5, 1.5, 1.5,
    ])
  })

  it('gives the same mesh again under the same seed, and another one under a different seed', () => {
    const first = EditMesh.from(uvSphereMesh({ segments: 16, rings: 8 }))
    const again = EditMesh.from(uvSphereMesh({ segments: 16, rings: 8 }))
    const other = EditMesh.from(uvSphereMesh({ segments: 16, rings: 8 }))
    const noise = { texture: 'noise', strength: 0.6, scale: 3 }

    run(first, { ...noise, seed: 11 })
    run(again, { ...noise, seed: 11 })
    run(other, { ...noise, seed: 12 })

    const seeded = positions(first)
    expect(positions(again)).toEqual(seeded)
    const differences = positions(other).filter((point, slot) => length(subtract(point, seeded[slot]!)) > 1e-9)
    expect(differences.length).toBeGreaterThan(first.vertexCount * 0.9)
    expect(isWellFormed(first)).toBe(true)
    expect(isClosed(first)).toBe(true)
  })

  it('keeps every vertex inside the reach the strength and the midlevel allow', () => {
    // A sample is in 0..1, so with a midlevel of a half no vertex can travel more than half the
    // strength: a displacement that ran away would be a texture that had left its range.
    for (const texture of ['noise', 'clouds', 'voronoi', 'wood']) {
      const mesh = EditMesh.from(uvSphereMesh({ segments: 12, rings: 6 }))
      const before = positions(mesh)

      expect(run(mesh, { texture, strength: 2, midlevel: 0.5, detail: 4, distortion: 1 })).toBeUndefined()

      const distances = travel(before, positions(mesh))
      for (const distance of distances) expect(distance).toBeLessThanOrEqual(1 + 1e-12)
      expect(Math.max(...distances)).toBeGreaterThan(0.1)
      expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([62, 132, 72])
      expect(isWellFormed(mesh)).toBe(true)
      expect(isClosed(mesh)).toBe(true)
    }
  })

  it('reads the texture in a texture object’s frame, and moves the pattern when the object moves', () => {
    const noise = { texture: 'noise', strength: 0.5, scale: 4 }
    const plain = EditMesh.from(uvSphereMesh({ segments: 12, rings: 6 }))
    const same = EditMesh.from(uvSphereMesh({ segments: 12, rings: 6 }))
    const shifted = EditMesh.from(uvSphereMesh({ segments: 12, rings: 6 }))

    run(plain, noise)
    run(same, { ...noise, textureObject: 'texture-frame' }, { textureObject: textureObject([...IDENTITY]) })
    run(shifted, { ...noise, textureObject: 'texture-frame' }, { textureObject: textureObject(translation([3, 0, 0])) })

    // An object sitting on the origin is no frame at all, so the pattern is where it was.
    const unframed = positions(plain)
    expect(positions(same)).toEqual(unframed)
    const moved = positions(shifted).filter((point, slot) => length(subtract(point, unframed[slot]!)) > 1e-9)
    expect(moved.length).toBeGreaterThan(plain.vertexCount * 0.9)
  })

  it('refuses global coordinates, because the stack does not hand it the object’s place', () => {
    const mesh = EditMesh.from(boxMesh(2))
    const before = positions(mesh)

    const outcome = run(mesh, { space: 'global', texture: 'noise' })

    expect(outcome).toBe('Displace cannot sample in global space: the stack does not give a modifier the object’s place in the world. Use local coordinates, or a texture object.')
    expect(positions(mesh)).toEqual(before)
  })

  it('refuses a texture object that is not in the document any more', () => {
    const mesh = EditMesh.from(boxMesh(2))

    const outcome = run(mesh, { texture: 'noise', textureObject: 'gone' }, { textureObject: null })

    expect(outcome).toBe('Displace cannot find the object it takes its texture frame from. Choose another, or clear the field.')
  })

  it('refuses a custom direction of zero rather than doing nothing quietly', () => {
    const mesh = EditMesh.from(boxMesh(2))

    const outcome = run(mesh, { direction: 'custom', customDirection: [0, 0, 0], texture: 'none' })

    expect(outcome).toBe('Displace has no way to go: the custom direction is zero. Give it a direction, or choose one of the axes.')
  })

  it('reads a parameter a hand-edited file spoiled rather than putting a NaN in the mesh', () => {
    const mesh = EditMesh.from(boxMesh(2))

    expect(run(mesh, {
      texture: 'noise',
      strength: 'a lot' as unknown as number,
      midlevel: null,
      scale: Number.NaN as unknown as number,
      seed: '3' as unknown as number,
    })).toBeUndefined()

    for (const point of positions(mesh)) {
      for (const axis of point) expect(Number.isFinite(axis)).toBe(true)
    }
  })

  it('declares every parameter of its schema in its defaults, with the same value', () => {
    for (const parameter of module.schema) {
      expect(module.defaults).toHaveProperty(parameter.id)
      expect(module.defaults[parameter.id]).toEqual(parameter.defaultValue)
    }
    expect(Object.keys(module.defaults).sort()).toEqual(module.schema.map((parameter) => parameter.id).sort())
  })
})
