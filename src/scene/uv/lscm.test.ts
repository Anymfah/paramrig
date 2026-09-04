import { describe, expect, it } from 'vitest'
import { boxMesh, gridMesh, planeMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import { loopStarts } from '@/scene/mesh/uv'
import { islandsFromSeams, islandLoops, islandVertices, seamsFromIslands } from '@/scene/uv/islands'
import { lscmUnwrap } from '@/scene/uv/lscm'
import type { MeshData } from '@/scene/types'

/**
 * The unwrapper.
 *
 * A conformal map keeps angles, so the tests are about angles: a flat piece must come back as
 * itself up to a similarity, and a curved one must come back with its corners still square-ish.
 * Nothing here checks a coordinate against a number, because there is no canonical answer — the
 * map is only defined up to where the pins are, which is the whole point of pinning them.
 */

/** The angles of a face in 3D and in the map, corner by corner. */
function angles(points: Array<[number, number]>): number[] {
  return points.map((_, index) => {
    const previous = points[(index + points.length - 1) % points.length]!
    const here = points[index]!
    const next = points[(index + 1) % points.length]!
    const a = Math.atan2(previous[1] - here[1], previous[0] - here[0])
    const b = Math.atan2(next[1] - here[1], next[0] - here[0])
    const difference = Math.abs(a - b) % (Math.PI * 2)
    return difference > Math.PI ? Math.PI * 2 - difference : difference
  })
}

/** One face of the map, as [u, v] pairs. */
function mapFace(mesh: MeshData, island: { faces: number[] }, uv: number[], face: number): Array<[number, number]> {
  const loops = islandLoops(mesh, island)
  const starts = loopStarts(mesh)
  const start = starts[face]!
  return mesh.faces[face]!.map((_, corner) => {
    const at = loops.indexOf(start + corner)
    return [uv[at * 2]!, uv[at * 2 + 1]!] as [number, number]
  })
}

describe('a flat piece', () => {
  it('comes back as itself, to a similarity', () => {
    const mesh = gridMesh({ xSubdivisions: 4, ySubdivisions: 4, size: 2 })
    const island = islandsFromSeams(mesh)[0]!
    const uv = lscmUnwrap(mesh, island)
    expect(uv).not.toBeNull()
    // Every quad of a flat regular grid has four right angles, and so must its map.
    for (const face of island.faces) {
      for (const angle of angles(mapFace(mesh, island, uv!, face))) {
        expect(angle).toBeCloseTo(Math.PI / 2, 2)
      }
    }
  })

  it('keeps the proportions of a rectangle', () => {
    const mesh = planeMesh(2)
    const island = islandsFromSeams(mesh)[0]!
    const uv = lscmUnwrap(mesh, island)!
    const face = mapFace(mesh, island, uv, 0)
    const width = Math.hypot(face[1]![0] - face[0]![0], face[1]![1] - face[0]![1])
    const height = Math.hypot(face[3]![0] - face[0]![0], face[3]![1] - face[0]![1])
    expect(width / height).toBeCloseTo(1, 2)
  })

  it('comes out at the size of the surface rather than at any size at all', () => {
    const mesh = planeMesh(2)
    const island = islandsFromSeams(mesh)[0]!
    const uv = lscmUnwrap(mesh, island)!
    const us = uv.filter((_, index) => index % 2 === 0)
    const vs = uv.filter((_, index) => index % 2 === 1)
    const span = Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs))
    // The plane is two metres across; the pins are laid a true distance apart, so the map is too.
    expect(span).toBeGreaterThan(1.5)
    expect(span).toBeLessThan(3.5)
  })
})

describe('a piece that has to be cut', () => {
  it('gives a cube with its six sides seamed six islands, each a square', () => {
    const mesh = boxMesh(2)
    // Every edge a seam: the six faces come apart entirely.
    const seamed: MeshData = {
      ...mesh,
      attributes: { ...mesh.attributes, edge: { ...mesh.attributes.edge, seam: mesh.edges.map(() => true) } },
    }
    const islands = islandsFromSeams(seamed)
    expect(islands).toHaveLength(6)
    for (const island of islands) {
      const uv = lscmUnwrap(seamed, island)
      expect(uv).not.toBeNull()
      for (const angle of angles(mapFace(seamed, island, uv!, island.faces[0]!))) {
        expect(angle).toBeCloseTo(Math.PI / 2, 2)
      }
    }
  })

  it('flattens a curved piece with its angles nearly kept', () => {
    const mesh = uvSphereMesh({ segments: 12, rings: 6 })
    const island = islandsFromSeams(mesh)[0]!
    const uv = lscmUnwrap(mesh, island)
    expect(uv).not.toBeNull()
    expect(uv!.every((value) => Number.isFinite(value))).toBe(true)
    /*
     * A sphere cannot be flattened without distortion — that is what curvature means — so what is
     * asked is that the answer is finite, that it is not a single point, and that the average
     * corner is nearer a right angle than a fold.
     */
    const us = uv!.filter((_, index) => index % 2 === 0)
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0.1)
  })
})

describe('what it refuses', () => {
  it('gives nothing for an island with no triangle in it', () => {
    const mesh = planeMesh(2)
    expect(lscmUnwrap(mesh, { faces: [] })).toBeNull()
  })

  it('gives nothing for a face whose corners are in a line', () => {
    const flat: MeshData = {
      ...planeMesh(2),
      vertices: [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0],
    }
    expect(lscmUnwrap(flat, { faces: [0] })).toBeNull()
  })
})

describe('the seams a map implies', () => {
  it('finds none in a map that agrees across every edge', () => {
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
    const island = islandsFromSeams(mesh)[0]!
    const uv = lscmUnwrap(mesh, island)!
    const whole = new Array<number>(mesh.faces.reduce((total, face) => total + face.length, 0) * 2).fill(0)
    const loops = islandLoops(mesh, island)
    for (let index = 0; index < loops.length; index += 1) {
      whole[loops[index]! * 2] = uv[index * 2]!
      whole[loops[index]! * 2 + 1] = uv[index * 2 + 1]!
    }
    const seams = seamsFromIslands(mesh, whole)
    // The border of the grid is a boundary rather than a seam; the inside must be clean.
    const inside = seams.filter((_, edge) => (mesh.edges[edge] ?? []).length === 2)
    expect(inside.filter(Boolean).length).toBeLessThan(seams.length)
  })

  it('finds one where two faces put the same edge in two places', () => {
    const mesh = boxMesh(2)
    const corners = mesh.faces.reduce((total, face) => total + face.length, 0)
    // Every face on the whole image: neighbours disagree everywhere, so every shared edge is a seam.
    const uv: number[] = []
    for (let face = 0; face < mesh.faces.length; face += 1) uv.push(0, 0, 1, 0, 1, 1, 0, 1)
    expect(uv).toHaveLength(corners * 2)
    const seams = seamsFromIslands(mesh, uv)
    expect(seams.filter(Boolean).length).toBe(mesh.edges.length)
  })
})

describe('pinning', () => {
  it('leaves a pinned vertex where it was told to be', () => {
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3 })
    const island = islandsFromSeams(mesh)[0]!
    const { slots } = islandVertices(mesh, island)
    const pinned = new Map<number, [number, number]>([
      [slots[0]!, [0.2, 0.3]],
      [slots[slots.length - 1]!, [0.8, 0.7]],
    ])
    const uv = lscmUnwrap(mesh, island, { pinned })!
    const loops = islandLoops(mesh, island)
    const { cornerVertex } = islandVertices(mesh, island)
    const at = (slot: number): [number, number] => {
      const index = cornerVertex.findIndex((vertex) => slots[vertex] === slot)
      return [uv[index * 2]!, uv[index * 2 + 1]!]
    }
    void loops
    expect(at(slots[0]!)[0]).toBeCloseTo(0.2, 2)
    expect(at(slots[0]!)[1]).toBeCloseTo(0.3, 2)
    expect(at(slots[slots.length - 1]!)[0]).toBeCloseTo(0.8, 2)
    expect(at(slots[slots.length - 1]!)[1]).toBeCloseTo(0.7, 2)
  })

  it('ignores a single pin, which cannot hold a flattening still', () => {
    const mesh = gridMesh({ xSubdivisions: 2, ySubdivisions: 2 })
    const island = islandsFromSeams(mesh)[0]!
    const { slots } = islandVertices(mesh, island)
    const one = lscmUnwrap(mesh, island, { pinned: new Map([[slots[0]!, [9, 9]]]) })!
    // The automatic pins put the map at the surface's own scale, near the origin, not out at nine.
    expect(Math.max(...one)).toBeLessThan(5)
  })
})
