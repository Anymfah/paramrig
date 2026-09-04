import { describe, expect, it } from 'vitest'
import { meshCounts } from '@/scene/mesh/data'
import { boxMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import { readStl, writeStl } from '@/scene/io/stl'
import type { MeshData } from '@/scene/types'

/**
 * STL holds triangles and nothing else, so the round trip is not about keeping a mesh but about
 * what survives: the shape, the volume, and a topology that can be walked afterwards — which is
 * what the weld on the way in is for.
 */

/** The mesh's signed volume, which says both how big it is and which way its faces point. */
function volume(mesh: MeshData): number {
  let total = 0
  for (const loop of mesh.faces) {
    for (let index = 1; index + 1 < loop.length; index += 1) {
      const [a, b, c] = [loop[0]!, loop[index]!, loop[index + 1]!].map((corner) => [
        mesh.vertices[corner * 3]!, mesh.vertices[corner * 3 + 1]!, mesh.vertices[corner * 3 + 2]!,
      ])
      total += (
        a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!)
        - a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!)
        + a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)
      ) / 6
    }
  }
  return total
}

describe('binary STL', () => {
  it('writes a cube as twelve triangles and reads back a closed cube', () => {
    const data = writeStl([{ mesh: boxMesh(2) }])
    // 84 bytes of header and count, fifty a triangle.
    expect(data.byteLength).toBe(84 + 12 * 50)
    expect(new DataView(data).getUint32(80, true)).toBe(12)

    const read = readStl(data)
    // Welded: eight corners, not thirty-six, or nothing downstream could walk an edge.
    expect(meshCounts(read)).toMatchObject({ vertices: 8, edges: 18, faces: 12 })
    expect(volume(read)).toBeCloseTo(8, 4)
  })

  it('writes in world space when a matrix is given', () => {
    const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]
    const read = readStl(writeStl([{ mesh: boxMesh(1), matrix }]))
    expect(volume(read)).toBeCloseTo(8, 4)
  })

  it('keeps every part of a scene in one file', () => {
    const data = writeStl([
      { mesh: boxMesh(1) },
      { mesh: boxMesh(1), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] },
    ])
    expect(new DataView(data).getUint32(80, true)).toBe(24)
    const read = readStl(data)
    expect(read.faces).toHaveLength(24)
    // Two cubes five metres apart: sixteen corners, none of them shared.
    expect(read.vertexIds).toHaveLength(16)
  })

  it('survives a mesh with more triangles than a cube', () => {
    const sphere = uvSphereMesh({ segments: 16, rings: 8, radius: 1 })
    const read = readStl(writeStl([{ mesh: sphere }]))
    expect(volume(read)).toBeCloseTo(volume(sphere), 3)
  })
})

describe('reading someone else’s STL', () => {
  it('reads the ASCII form', () => {
    const text = [
      'solid cube',
      'facet normal 0 0 1',
      '  outer loop',
      '    vertex 0 0 0',
      '    vertex 1 0 0',
      '    vertex 0 1 0',
      '  endloop',
      'endfacet',
      'endsolid cube',
    ].join('\n')
    const read = readStl(new TextEncoder().encode(text).buffer as ArrayBuffer)
    expect(read.faces).toHaveLength(1)
    expect(read.vertexIds).toHaveLength(3)
  })

  it('reads a binary file whose header starts with the word “solid”', () => {
    const data = writeStl([{ mesh: boxMesh(1) }])
    const view = new DataView(data)
    'solid'.split('').forEach((letter, index) => view.setUint8(index, letter.charCodeAt(0)))
    // The length agrees with the count, so the word is not taken at face value.
    expect(readStl(data).faces).toHaveLength(12)
  })

  it('drops a triangle whose corners weld into each other', () => {
    const text = [
      'solid sliver',
      'facet normal 0 0 1',
      '  outer loop',
      '    vertex 0 0 0',
      '    vertex 0 0 0',
      '    vertex 0 1 0',
      '  endloop',
      'endfacet',
      'endsolid sliver',
    ].join('\n')
    expect(readStl(new TextEncoder().encode(text).buffer as ArrayBuffer).faces).toHaveLength(0)
  })
})
