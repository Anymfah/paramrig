import { meshFromPolygons } from '@/scene/mesh/data'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * The meshes the Add menu can make. Every one is a quad-first polygon mesh with outward-facing
 * loops, so an extrude or a bevel on a fresh primitive behaves the way it does in Blender.
 */

/** A box centred on the origin, `size` across each way. Blender's cube is 2 m. */
export function boxMesh(size: number | Vec3 = 2): MeshData {
  const [x, y, z] = typeof size === 'number' ? [size, size, size] : size
  const hx = x / 2
  const hy = y / 2
  const hz = z / 2
  const positions: Vec3[] = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ]
  // Counter-clockwise seen from outside, with Z up.
  const faces = [
    [0, 3, 2, 1], // bottom, seen from below
    [4, 5, 6, 7], // top
    [0, 1, 5, 4], // -Y
    [1, 2, 6, 5], // +X
    [2, 3, 7, 6], // +Y
    [3, 0, 4, 7], // -X
  ]
  return meshFromPolygons(positions, faces)
}

/** A flat quad on the XY plane, `size` across. */
export function planeMesh(size = 2): MeshData {
  const half = size / 2
  return meshFromPolygons(
    [[-half, -half, 0], [half, -half, 0], [half, half, 0], [-half, half, 0]],
    [[0, 1, 2, 3]],
  )
}
