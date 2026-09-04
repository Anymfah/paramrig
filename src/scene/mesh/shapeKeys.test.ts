import { describe, expect, it } from 'vitest'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import {
  applyShapeKeys,
  emptyKey,
  keyFromMix,
  keyFromShape,
  keysActive,
  keyValue,
  remapShapeKeys,
  shapedMesh,
  uniqueKeyName,
} from '@/scene/mesh/shapeKeys'
import type { MeshData, ShapeKey } from '@/scene/types'

/**
 * Shape keys.
 *
 * The thing worth proving over and over is that the stored mesh never moves: everything a key does
 * happens on the way out. That is what lets a key be scrubbed, animated and driven, and it is what
 * makes turning every key back to nought give back exactly the model that was modelled.
 */

function lifted(mesh: MeshData, name: string, height: number): ShapeKey {
  const offsets: Record<string, [number, number, number]> = {}
  for (const id of mesh.vertexIds) offsets[String(id)] = [0, 0, height]
  return { name, value: 0, min: 0, max: 1, offsets }
}

describe('shape keys', () => {
  it('leaves the mesh alone while every key is off', () => {
    const mesh = planeMesh()
    const keys = [lifted(mesh, 'Up', 1)]
    expect(applyShapeKeys(mesh, keys)).toBe(mesh)
    expect(keysActive(keys)).toBe(false)
  })

  it('mixes a key in by its value', () => {
    const mesh = planeMesh()
    const shaped = applyShapeKeys(mesh, [{ ...lifted(mesh, 'Up', 2), value: 0.5 }])
    expect(shaped.vertices[2]).toBeCloseTo((mesh.vertices[2] ?? 0) + 1, 9)
    // And the stored mesh is untouched, which is the whole point.
    expect(mesh.vertices[2]).toBe(0)
  })

  it('adds two keys together, as Blender’s relative keys do', () => {
    const mesh = planeMesh()
    const shaped = applyShapeKeys(mesh, [
      { ...lifted(mesh, 'Up', 1), value: 1 },
      { ...lifted(mesh, 'Higher', 2), value: 0.5 },
    ])
    expect(shaped.vertices[2]).toBeCloseTo(2, 9)
  })

  it('holds a value inside the range the key declares', () => {
    expect(keyValue({ name: 'a', value: 3, min: 0, max: 1, offsets: {} })).toBe(1)
    expect(keyValue({ name: 'a', value: -2, min: -1, max: 1, offsets: {} })).toBe(-1)
  })

  it('makes a key out of a shape, writing down only what moved', () => {
    const mesh = planeMesh()
    const moved = { ...mesh, vertices: mesh.vertices.map((value, index) => (index === 2 ? value + 0.5 : value)) }
    const key = keyFromShape(mesh, moved, 'Bump', [])
    expect(Object.keys(key.offsets)).toHaveLength(1)
    expect(key.offsets[String(mesh.vertexIds[0]!)]).toEqual([0, 0, 0.5])
    // And putting it back at full value reproduces the shape it was made from.
    expect(applyShapeKeys(mesh, [{ ...key, value: 1 }]).vertices).toEqual(moved.vertices)
  })

  it('makes a key out of the mix of the keys that are on', () => {
    const mesh = planeMesh()
    const keys = [{ ...lifted(mesh, 'Up', 1), value: 0.5 }]
    const mixed = keyFromMix(mesh, keys, 'Mix')
    expect(Object.keys(mixed.offsets)).toHaveLength(mesh.vertexIds.length)
    expect(mixed.offsets[String(mesh.vertexIds[0]!)]![2]).toBeCloseTo(0.5, 9)
  })

  it('names a repeat the way Blender numbers one', () => {
    const keys = [emptyKey('Key', []), emptyKey('Key', [emptyKey('Key', [])])]
    expect(keys[1]!.name).toBe('Key.001')
    expect(uniqueKeyName(keys, 'Key')).toBe('Key.002')
  })

  it('drops an offset whose vertex has gone, and keeps the rest', () => {
    const mesh = boxMesh(2)
    const key = lifted(mesh, 'Up', 1)
    const smaller = { ...mesh, vertexIds: mesh.vertexIds.slice(0, 4) }
    const kept = remapShapeKeys([key], smaller)!
    expect(Object.keys(kept[0]!.offsets)).toHaveLength(4)
    // Nothing to drop means the very same array, so nothing downstream sees a change.
    expect(remapShapeKeys([key], mesh)![0]).toBe(key)
  })

  it('gives back the same shaped mesh while nothing about the keys has changed', () => {
    const mesh = planeMesh()
    const keys = [{ ...lifted(mesh, 'Up', 1), value: 1 }]
    const first = shapedMesh(mesh, keys)
    expect(shapedMesh(mesh, keys)).toBe(first)
    // A different value is a different shape, and a different object.
    expect(shapedMesh(mesh, [{ ...keys[0]!, value: 0.5 }])).not.toBe(first)
  })
})
