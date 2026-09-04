import { describe, expect, it } from 'vitest'
import { boxMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import { voxelRemesh } from '@/scene/sculpt/remesh'
import type { MeshData } from '@/scene/types'

/**
 * A remesh is judged by three things, and none of them is the shape of a face.
 *
 * It has to be closed — a surface with a hole in it is not a surface, and every seam a level set
 * fails to close is a place a later boolean or a later print goes wrong. It has to be made of
 * quads, because that is the point of remeshing a sculpt. And it has to be the same *size* as what
 * it replaced, which is the one number that says whether the grid ate the model.
 */

/** Whether every edge of the mesh has exactly two faces on it: what closed means. */
function closed(mesh: MeshData): { open: number; edges: number } {
  const counts = new Map<string, number>()
  for (const face of mesh.faces) {
    for (let corner = 0; corner < face.length; corner += 1) {
      const a = face[corner]!
      const b = face[(corner + 1) % face.length]!
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let open = 0
  for (const count of counts.values()) if (count !== 2) open += 1
  return { open, edges: counts.size }
}

/** The volume of a closed mesh, by the divergence theorem over its triangles. */
function volume(mesh: MeshData): number {
  const point = (slot: number): [number, number, number] => [
    mesh.vertices[slot * 3] ?? 0, mesh.vertices[slot * 3 + 1] ?? 0, mesh.vertices[slot * 3 + 2] ?? 0,
  ]
  let total = 0
  for (const face of mesh.faces) {
    for (let corner = 1; corner + 1 < face.length; corner += 1) {
      const a = point(face[0]!)
      const b = point(face[corner]!)
      const c = point(face[corner + 1]!)
      total += (a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
  }
  return Math.abs(total)
}

describe('the voxel remesh', () => {
  it('rebuilds a cube as a closed grid of quads', () => {
    const remeshed = voxelRemesh(boxMesh(2), { voxelSize: 0.2 })
    expect(typeof remeshed, String(remeshed)).not.toBe('string')
    const mesh = remeshed as MeshData
    expect(closed(mesh).open, 'open edges').toBe(0)
    expect(mesh.faces.length).toBeGreaterThan(100)
    // Quads, which is the point of remeshing a sculpt; the few that find no partner stay triangles.
    const quads = mesh.faces.filter((face) => face.length === 4).length
    expect(quads / mesh.faces.length).toBeGreaterThan(0.9)
  })

  it('keeps a cube’s volume within a twentieth of what it was, even before it is asked to', () => {
    // The grid rounds every edge of a cube, which is the worst case for a level set and still
    // inside the budget: what it loses at twelve edges is a few per cent of what it holds.
    const plain = volume(voxelRemesh(boxMesh(2), { voxelSize: 0.15 }) as MeshData)
    expect(Math.abs(plain - 8) / 8, `${plain.toFixed(3)} against 8`).toBeLessThan(0.05)
  })

  it('and puts back exactly what the rounding took when it is asked to', () => {
    const kept = volume(voxelRemesh(boxMesh(2), { voxelSize: 0.15, preserveVolume: true }) as MeshData)
    expect(kept).toBeCloseTo(8, 3)
    const sphere = uvSphereMesh({ segments: 24, rings: 12, radius: 1 })
    const after = volume(voxelRemesh(sphere, { voxelSize: 0.12, preserveVolume: true }) as MeshData)
    expect(after).toBeCloseTo(volume(sphere), 3)
  })

  it('a sphere comes back round, and closed', () => {
    const sphere = uvSphereMesh({ segments: 24, rings: 12, radius: 1 })
    const mesh = voxelRemesh(sphere, { voxelSize: 0.12 }) as MeshData
    expect(closed(mesh).open).toBe(0)
    let far = 0
    let near = Infinity
    for (let index = 0; index < mesh.vertexIds.length; index += 1) {
      const distance = Math.hypot(mesh.vertices[index * 3]!, mesh.vertices[index * 3 + 1]!, mesh.vertices[index * 3 + 2]!)
      far = Math.max(far, distance)
      near = Math.min(near, distance)
    }
    // Every point within a voxel of the sphere it was made from.
    expect(far, `furthest ${far.toFixed(3)}`).toBeLessThan(1.12)
    expect(near, `nearest ${near.toFixed(3)}`).toBeGreaterThan(0.88)
  })

  it('a coarser voxel gives fewer faces, which is what the setting is for', () => {
    const fine = voxelRemesh(boxMesh(2), { voxelSize: 0.15 }) as MeshData
    const coarse = voxelRemesh(boxMesh(2), { voxelSize: 0.4 }) as MeshData
    expect(coarse.faces.length).toBeLessThan(fine.faces.length / 2)
    expect(closed(coarse).open).toBe(0)
  })

  it('refuses a voxel so small it would be a wait rather than a remesh', () => {
    expect(voxelRemesh(boxMesh(2), { voxelSize: 0.001 })).toMatch(/million samples/)
  })

  it('says so rather than throwing when there is nothing to remesh', () => {
    const empty = { ...boxMesh(2), faces: [], faceIds: [], attributes: { ...boxMesh(2).attributes, face: { smooth: [], material: [] } } }
    expect(voxelRemesh(empty, { voxelSize: 0.2 })).toMatch(/nothing to remesh/)
  })
})
