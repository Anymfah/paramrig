import { meshFromPolygons } from '@/scene/mesh/data'
import { cachedTriangulation } from '@/scene/mesh/triangulate'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * STL, binary and ASCII.
 *
 * STL is a bag of triangles: three corners and a normal each, no vertex sharing, no materials, no
 * names. That is why it is the format every printer takes and the one that loses the most — a cube
 * leaves as twelve triangles with thirty-six corners, and comes back as thirty-six loose vertices
 * unless they are welded on the way in.
 *
 * So reading welds by position. The tolerance is a hundredth of a millimetre, which is far below
 * anything a model means and far above the drift a float32 introduces — without it, a cube read
 * back has eight corners in name and thirty-six in fact, and every operator that walks an edge
 * loop finds nothing to walk.
 *
 * Writing takes the evaluated mesh triangulated, because that is all the format can hold, and says
 * so where the caller can see it rather than pretending an n-gon survived.
 */

/** Two positions nearer than this are the same vertex. A hundredth of a millimetre, in metres. */
const WELD = 1e-5

/* -------------------------------------------------------------------- read */

export function readStl(data: ArrayBuffer): MeshData {
  return isAscii(data) ? readAsciiStl(new TextDecoder().decode(data)) : readBinaryStl(data)
}

/**
 * A binary STL is 80 bytes of header, a count, then fifty bytes a triangle. An ASCII one starts
 * with "solid" — but so do some binary files written by careless tools, so the length is checked
 * against what the count promises before believing the word.
 */
function isAscii(data: ArrayBuffer): boolean {
  if (data.byteLength < 84) return true
  const view = new DataView(data)
  const triangles = view.getUint32(80, true)
  if (84 + triangles * 50 === data.byteLength) return false
  const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(5, data.byteLength)))
  return head.toLowerCase() === 'solid'
}

function readBinaryStl(data: ArrayBuffer): MeshData {
  const view = new DataView(data)
  const count = view.getUint32(80, true)
  const corners: Vec3[] = []
  for (let index = 0; index < count; index += 1) {
    const at = 84 + index * 50 + 12
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = at + corner * 12
      corners.push([view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)])
    }
  }
  return weld(corners)
}

function readAsciiStl(text: string): MeshData {
  const corners: Vec3[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('vertex')) continue
    const parts = line.split(/\s+/)
    corners.push([Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0])
  }
  return weld(corners)
}

/**
 * Loose corners into a mesh, three at a time, sharing every position that repeats.
 *
 * The grid is what keeps it linear: a position is looked up by the cell it falls in rather than
 * against every vertex so far, so a model of a hundred thousand triangles is read in one pass
 * instead of ten billion comparisons.
 */
function weld(corners: Vec3[]): MeshData {
  const cells = new Map<string, number>()
  const positions: Vec3[] = []
  const slotOf = (point: Vec3): number => {
    const key = `${Math.round(point[0] / WELD)}|${Math.round(point[1] / WELD)}|${Math.round(point[2] / WELD)}`
    const seen = cells.get(key)
    if (seen !== undefined) return seen
    const slot = positions.length
    cells.set(key, slot)
    positions.push(point)
    return slot
  }
  const faces: number[][] = []
  for (let index = 0; index + 2 < corners.length; index += 3) {
    const loop = [slotOf(corners[index]!), slotOf(corners[index + 1]!), slotOf(corners[index + 2]!)]
    // A triangle whose corners welded together is a sliver the file should not have held.
    if (new Set(loop).size === 3) faces.push(loop)
  }
  return meshFromPolygons(positions, faces)
}

/* ------------------------------------------------------------------- write */

export type StlPart = {
  mesh: MeshData
  /** The object's world matrix, column-major, when the mesh is not already in world space. */
  matrix?: number[]
}

/**
 * The binary form, which is a fifth the size of the ASCII one and what every tool expects.
 *
 * The per-triangle normal is written from the geometry rather than from the mesh's own normals: STL
 * readers disagree about whether to trust it, and a normal that does not match its winding is the
 * commonest reason a printed model comes out inside out.
 */
export function writeStl(parts: StlPart[], options: { name?: string } = {}): ArrayBuffer {
  const triangles: Array<[Vec3, Vec3, Vec3]> = []
  for (const part of parts) {
    const triangulation = cachedTriangulation(part.mesh)
    for (let index = 0; index < triangulation.triangleCount; index += 1) {
      const corners = [0, 1, 2].map((corner) => {
        const slot = triangulation.indices[index * 3 + corner] ?? 0
        return apply(part.matrix, [
          part.mesh.vertices[slot * 3] ?? 0,
          part.mesh.vertices[slot * 3 + 1] ?? 0,
          part.mesh.vertices[slot * 3 + 2] ?? 0,
        ])
      })
      triangles.push([corners[0]!, corners[1]!, corners[2]!])
    }
  }

  const buffer = new ArrayBuffer(84 + triangles.length * 50)
  const view = new DataView(buffer)
  const header = `ParamRig ${options.name ?? 'scene'}`.slice(0, 79)
  for (let index = 0; index < header.length; index += 1) view.setUint8(index, header.charCodeAt(index) & 0x7f)
  view.setUint32(80, triangles.length, true)
  triangles.forEach(([a, b, c], index) => {
    const at = 84 + index * 50
    const normal = faceNormal(a, b, c)
    view.setFloat32(at, normal[0], true)
    view.setFloat32(at + 4, normal[1], true)
    view.setFloat32(at + 8, normal[2], true)
    ;[a, b, c].forEach((point, corner) => {
      const offset = at + 12 + corner * 12
      view.setFloat32(offset, point[0], true)
      view.setFloat32(offset + 4, point[1], true)
      view.setFloat32(offset + 8, point[2], true)
    })
    view.setUint16(at + 48, 0, true)
  })
  return buffer
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const normal: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const length = Math.hypot(normal[0], normal[1], normal[2])
  return length < 1e-12 ? [0, 0, 0] : [normal[0] / length, normal[1] / length, normal[2] / length]
}

function apply(matrix: number[] | undefined, point: Vec3): Vec3 {
  if (!matrix || matrix.length < 16) return point
  const [x, y, z] = point
  return [
    (matrix[0] ?? 1) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 1) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 1) * z + (matrix[14] ?? 0),
  ]
}
