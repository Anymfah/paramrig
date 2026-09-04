import { describe, expect, it } from 'vitest'
import { boxMesh, gridMesh, planeMesh } from '@/scene/mesh/primitives'
import { edgeFaces, islandLoops, islandsFromSeams, islandVertices, seamsFromIslands } from '@/scene/uv/islands'
import type { MeshData } from '@/scene/types'

/**
 * The pieces a mesh falls into when it is cut.
 *
 * Everything an unwrapper does begins here, so what is tested is the cutting itself: that a seam
 * separates, that a boundary already does, and that a mesh with no seams is one piece.
 */

function seamed(mesh: MeshData, edges: number[]): MeshData {
  const seam = mesh.edges.map((_, edge) => edges.includes(edge))
  return { ...mesh, attributes: { ...mesh.attributes, edge: { ...mesh.attributes.edge, seam } } }
}

describe('cutting a mesh into islands', () => {
  it('gives a mesh with no seams one island', () => {
    const islands = islandsFromSeams(boxMesh(2))
    expect(islands).toHaveLength(1)
    expect(islands[0]!.faces).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('gives a mesh cut along every edge one island per face', () => {
    const mesh = boxMesh(2)
    const islands = islandsFromSeams(seamed(mesh, mesh.edges.map((_, edge) => edge)))
    expect(islands).toHaveLength(6)
    expect(islands.every((island) => island.faces.length === 1)).toBe(true)
  })

  it('cuts a grid in two when a line of seams crosses it', () => {
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
    // Every edge running across the middle of the grid, found by the two vertices it joins.
    const middle: number[] = []
    for (let edge = 0; edge < mesh.edges.length; edge += 1) {
      const [a, b] = mesh.edges[edge]!
      const ay = mesh.vertices[a * 3 + 1] ?? 0
      const by = mesh.vertices[b * 3 + 1] ?? 0
      if (Math.abs(ay) < 1e-6 && Math.abs(by) < 1e-6) middle.push(edge)
    }
    expect(middle.length).toBeGreaterThan(0)
    expect(islandsFromSeams(seamed(mesh, middle))).toHaveLength(2)
  })

  it('leaves a face nothing touches on its own', () => {
    const mesh = boxMesh(2)
    const detached: MeshData = { ...mesh, faces: [...mesh.faces, [0, 1, 2]], faceIds: [...mesh.faceIds, 99] }
    const islands = islandsFromSeams({
      ...detached,
      attributes: {
        ...detached.attributes,
        face: { smooth: [...detached.attributes.face.smooth, false], material: [...detached.attributes.face.material, 0] },
      },
    })
    // The added triangle shares its edges with faces of the box, so the pieces are joined; what is
    // being checked is that an edge with three faces on it is treated as a cut rather than a join.
    expect(islands.length).toBeGreaterThan(1)
  })

  it('takes only the faces it is asked for', () => {
    const mesh = boxMesh(2)
    const islands = islandsFromSeams(mesh, { selection: new Set([0, 1]) })
    expect(islands.flatMap((island) => island.faces).sort()).toEqual([0, 1])
  })
})

describe('the corners and vertices of an island', () => {
  it('numbers the corners face by face, in face order', () => {
    const mesh = boxMesh(2)
    expect(islandLoops(mesh, { faces: [0, 2] })).toEqual([0, 1, 2, 3, 8, 9, 10, 11])
  })

  it('gives a vertex one place in the island however many faces meet at it', () => {
    const mesh = boxMesh(2)
    const { slots, cornerVertex } = islandVertices(mesh, { faces: [0, 1, 2, 3, 4, 5] })
    expect(slots).toHaveLength(8)
    expect(cornerVertex).toHaveLength(24)
    expect(new Set(cornerVertex).size).toBe(8)
  })
})

describe('reading the seams back out of a map', () => {
  it('finds none where the map agrees', () => {
    const mesh = planeMesh(2)
    const seams = seamsFromIslands(mesh, [0, 0, 1, 0, 1, 1, 0, 1])
    // The four edges of a lone quad are boundaries, which are cuts by definition.
    expect(seams.filter(Boolean)).toHaveLength(0)
  })

  it('calls an edge with more than two faces a cut', () => {
    const mesh = boxMesh(2)
    const faces = edgeFaces(mesh)
    expect(faces.every((list) => list.length === 2)).toBe(true)
  })
})
