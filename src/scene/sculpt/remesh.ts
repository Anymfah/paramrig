import { meshFromPolygons } from '@/scene/mesh/data'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * Voxel remesh: a sculpted surface rebuilt as an even grid of quads.
 *
 * Sculpting stretches the triangles it moves, and a stroke that pulls a nose out of a head leaves
 * the nose with the triangles the head had. Remeshing throws the topology away and builds a new one
 * of an even size everywhere, which is the whole of why a sculptor does it.
 *
 * Two departures from Blender, both deliberate and both worth stating.
 *
 * Blender's voxel remesh is OpenVDB: a narrow-band level set, adaptive, with the mesh extracted by
 * dual contouring. This is a plain grid — every voxel of the bounding box is a sample — so its cost
 * is the volume rather than the surface, and the voxel size that is affordable here is coarser than
 * the one that is affordable there.
 *
 * And the surface is extracted by *naive surface nets* rather than by marching cubes. Surface nets
 * puts one vertex in every cell the surface crosses and joins them into a quad around every crossed
 * edge, which gives quads directly; marching cubes gives triangles, which would then have to be
 * paired back into quads by a second pass that gets it wrong on every ambiguous case. The cost is
 * that surface nets rounds a sharp edge more than marching cubes does — a cube remeshed coarsely
 * comes back with its corners taken off, and no setting here brings them back.
 */

export type RemeshOptions = {
  /** The side of one voxel, in the object's own units. */
  voxelSize: number
  /**
   * Scale the result about its middle until it holds what the original held.
   *
   * A grid rounds every convex feature it meets, and rounding takes volume away: a remeshed head is
   * a slightly smaller head. Blender's option measures the volume before and after and scales to
   * match, and so does this — which is exact for the size and says nothing about the shape, so a
   * model that lost its volume from one thin part gets it back spread over all of it.
   */
  preserveVolume?: boolean
}

/** More samples than this is a wait rather than a remesh; the caller is told to use a larger voxel. */
const MAX_SAMPLES = 8_000_000

/** Nothing is nearer than this to a surface without being on it. */
const NOTHING = 1e-9

export function voxelRemesh(mesh: MeshData, options: RemeshOptions): MeshData | string {
  const voxel = Math.max(1e-4, options.voxelSize)
  const bounds = boundsOf(mesh)
  if (!bounds) return 'That mesh has nothing to remesh.'
  const pad = voxel * 2
  const origin: Vec3 = [bounds.min[0] - pad, bounds.min[1] - pad, bounds.min[2] - pad]
  const size: Vec3 = [
    bounds.max[0] - bounds.min[0] + pad * 2,
    bounds.max[1] - bounds.min[1] + pad * 2,
    bounds.max[2] - bounds.min[2] + pad * 2,
  ]
  const nx = Math.ceil(size[0] / voxel) + 1
  const ny = Math.ceil(size[1] / voxel) + 1
  const nz = Math.ceil(size[2] / voxel) + 1
  if (nx * ny * nz > MAX_SAMPLES) {
    return `A voxel of ${voxel.toFixed(3)} would need ${Math.round((nx * ny * nz) / 1e6)} million samples. Use a larger one.`
  }
  const field = nudgeOffZero(smooth(signedField(mesh, origin, voxel, nx, ny, nz), nx, ny, nz), voxel)
  const built = marchingTetrahedra(field, origin, voxel, nx, ny, nz)
  if (built.faces.length === 0) return 'Nothing came back from that voxel size. Use a smaller one.'
  const points = options.preserveVolume ? scaledToVolume(built, volumeOf(mesh)) : built.points
  return meshFromPolygons(points, built.faces, { smooth: true })
}

/**
 * Samples pushed off the surface, by a twentieth of a voxel.
 *
 * A sample whose value is exactly nought is a sample the surface passes through, and a surface that
 * passes through a sample extracts as a fan of triangles with no area: every edge reaching that
 * sample puts its crossing *at* the sample, so two corners of a triangle land on the same point.
 * On a grid-aligned model — a cube, a wall, a floor — that is not a rare case but whole planes of
 * samples at once, and it costs a tenth of the surface.
 *
 * So nothing is allowed to sit on the surface. The cost is that the surface lands a twentieth of a
 * voxel outside where it should, which is a fiftieth of the error the voxel itself brings.
 */
function nudgeOffZero(field: Float32Array, voxel: number): Float32Array {
  const nudge = voxel * 0.05
  for (let index = 0; index < field.length; index += 1) {
    const value = field[index]!
    if (Math.abs(value) < nudge) field[index] = value < 0 ? -nudge : nudge
  }
  return field
}

/**
 * One pass of averaging over the field.
 *
 * A level set built by counting crossings is exact and jagged: a sample either is inside or is not,
 * and where the surface passes close to a sample the distance changes by a whole voxel between
 * neighbours. Averaging once takes the step out of it, which is what makes the extracted surface
 * follow the model rather than the grid — and it is also what rounds a sharp edge, which is the
 * character of a voxel remesh and the reason a sculptor reaches for one.
 */
function smooth(field: Float32Array, nx: number, ny: number, nz: number): Float32Array {
  const out = new Float32Array(field.length)
  const at = (x: number, y: number, z: number): number => (z * ny + y) * nx + x
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        let total = field[at(x, y, z)]! * 2
        let weight = 2
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
          const nxx = x + dx
          const nyy = y + dy
          const nzz = z + dz
          if (nxx < 0 || nyy < 0 || nzz < 0 || nxx >= nx || nyy >= ny || nzz >= nz) continue
          total += field[at(nxx, nyy, nzz)]!
          weight += 1
        }
        out[at(x, y, z)] = total / weight
      }
    }
  }
  return out
}

/* --------------------------------------------------------------- the field */

/**
 * The signed distance to the surface at every sample of the grid.
 *
 * Two passes, because distance and sign are different questions. The distance comes from the
 * triangles themselves: each one is measured against the samples in its own neighbourhood, and
 * every sample keeps the smallest it hears. The sign comes from counting: a line drawn up through
 * the mesh crosses it an odd number of times below any point that is inside it, which is the oldest
 * inside test there is and the one that needs no normals to be consistent.
 *
 * A sample no triangle reached keeps a distance of a few voxels, signed. That is a lie about how
 * far away the surface is and the truth about which side of it the sample is on, which is all the
 * extraction needs.
 */
function signedField(mesh: MeshData, origin: Vec3, voxel: number, nx: number, ny: number, nz: number): Float32Array {
  const far = voxel * 4
  const field = new Float32Array(nx * ny * nz).fill(far)
  const at = (x: number, y: number, z: number): number => (z * ny + y) * nx + x
  const triangles = trianglesOf(mesh)
  const band = voxel * 2

  for (const [a, b, c] of triangles) {
    const lowX = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - band - origin[0]) / voxel))
    const highX = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) + band - origin[0]) / voxel))
    const lowY = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - band - origin[1]) / voxel))
    const highY = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) + band - origin[1]) / voxel))
    const lowZ = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - band - origin[2]) / voxel))
    const highZ = Math.min(nz - 1, Math.ceil((Math.max(a[2], b[2], c[2]) + band - origin[2]) / voxel))
    for (let z = lowZ; z <= highZ; z += 1) {
      for (let y = lowY; y <= highY; y += 1) {
        for (let x = lowX; x <= highX; x += 1) {
          const point: Vec3 = [origin[0] + x * voxel, origin[1] + y * voxel, origin[2] + z * voxel]
          const distance = pointToTriangle(point, a, b, c)
          const index = at(x, y, z)
          if (distance < field[index]!) field[index] = distance
        }
      }
    }
  }

  /*
   * The sign, column by column.
   *
   * Every column would otherwise be asked about every triangle, which on a mesh of eight thousand
   * faces and seven thousand columns is sixty million tests and half a minute of nothing happening.
   * So the triangles are filed by the columns their shadow covers first: a triangle a tenth of a
   * voxel across is in one column's list, and a column asks only the triangles that could possibly
   * cross it.
   */
  const columns: number[][] = Array.from({ length: nx * ny }, () => [])
  for (let index = 0; index < triangles.length; index += 1) {
    const [a, b, c] = triangles[index]!
    const lowX = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - origin[0]) / voxel))
    const highX = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - origin[0]) / voxel))
    const lowY = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - origin[1]) / voxel))
    const highY = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - origin[1]) / voxel))
    for (let y = lowY; y <= highY; y += 1) {
      for (let x = lowX; x <= highX; x += 1) columns[y * nx + x]!.push(index)
    }
  }

  const crossings: number[] = []
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const nearby = columns[y * nx + x]!
      if (nearby.length === 0) continue
      crossings.length = 0
      /*
       * The ray is cast from a hair off the sample rather than through it.
       *
       * Parity is exact arithmetic asked of floating point: a column that passes exactly along a
       * shared edge of two triangles is counted twice and the parity flips, and on a grid-aligned
       * model — a cube, a wall, anything a person actually builds — that happens on whole rows of
       * columns at once, which shows up as sheets of wrongly-signed samples. Two incommensurate
       * offsets, each a thousandth of a voxel, mean no column lies on an edge; the only samples
       * whose answer changes are the ones within a thousandth of the surface, where the distance is
       * nought either way.
       */
      const px = origin[0] + x * voxel + voxel * 0.0011
      const py = origin[1] + y * voxel + voxel * 0.0007
      for (const index of nearby) {
        const [a, b, c] = triangles[index]!
        const hit = columnCrossing(px, py, a, b, c)
        if (hit !== null) crossings.push(hit)
      }
      if (crossings.length === 0) continue
      crossings.sort((first, second) => first - second)
      for (let z = 0; z < nz; z += 1) {
        const pz = origin[2] + z * voxel
        let below = 0
        for (const crossing of crossings) {
          if (crossing < pz) below += 1
          else break
        }
        if (below % 2 === 1) {
          const index = at(x, y, z)
          field[index] = -field[index]!
        }
      }
    }
  }
  return field
}

/** Where a vertical line through (x, y) crosses this triangle, or null when it misses. */
function columnCrossing(x: number, y: number, a: Vec3, b: Vec3, c: Vec3): number | null {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (Math.abs(area) < NOTHING) return null
  const u = ((b[0] - x) * (c[1] - y) - (b[1] - y) * (c[0] - x)) / area
  const v = ((c[0] - x) * (a[1] - y) - (c[1] - y) * (a[0] - x)) / area
  const w = 1 - u - v
  if (u < 0 || v < 0 || w < 0) return null
  return a[2] * u + b[2] * v + c[2] * w
}

/* ------------------------------------------------------------- the surface */

/**
 * The corners of a cell, and the six tetrahedra it is cut into.
 *
 * Marching *tetrahedra* rather than marching cubes, and the reason is manifoldness. A cube has
 * fifteen distinct sign cases and several of them are ambiguous — two opposite corners inside can
 * mean one surface or two — so the table has to choose, and neighbouring cells that choose
 * differently leave a hole. A tetrahedron has three cases and none of them is ambiguous, so a
 * surface built this way is closed by construction. The cost is more triangles for the same
 * detail, and a faint diagonal grain from the way the cube is cut.
 *
 * Every cell is cut the same way, along the 0–7 diagonal, which is what makes neighbouring cells
 * agree about the faces they share.
 */
const CELL_CORNERS: Array<[number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
]

const TETRAHEDRA: Array<[number, number, number, number]> = [
  [0, 5, 1, 7], [0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7],
]

function marchingTetrahedra(
  field: Float32Array,
  origin: Vec3,
  voxel: number,
  nx: number,
  ny: number,
  nz: number,
): { points: Vec3[]; faces: number[][] } {
  const at = (x: number, y: number, z: number): number => (z * ny + y) * nx + x
  const points: Vec3[] = []
  const triangles: number[][] = []
  /*
   * A vertex is named by the two samples it lies between, so the two tetrahedra either side of a
   * face — in this cell and in the next one — put their corners in the same place and the surface
   * is watertight without a weld afterwards.
   */
  const seen = new Map<number, number>()
  const samples = nx * ny * nz
  const vertexOn = (a: number, b: number, valueA: number, valueB: number): number => {
    const key = a < b ? a * samples + b : b * samples + a
    const kept = seen.get(key)
    if (kept !== undefined) return kept
    const along = Math.abs(valueA - valueB) < NOTHING ? 0.5 : valueA / (valueA - valueB)
    const first = a < b ? a : b
    const second = a < b ? b : a
    const from = sampleAt(first, origin, voxel, nx, ny)
    const to = sampleAt(second, origin, voxel, nx, ny)
    const fraction = a < b ? along : 1 - along
    const index = points.length
    points.push([
      from[0] + (to[0] - from[0]) * fraction,
      from[1] + (to[1] - from[1]) * fraction,
      from[2] + (to[2] - from[2]) * fraction,
    ])
    seen.set(key, index)
    return index
  }

  const corner = new Array<number>(8)
  const value = new Array<number>(8)
  const place = new Array<Vec3>(8)
  for (let z = 0; z + 1 < nz; z += 1) {
    for (let y = 0; y + 1 < ny; y += 1) {
      for (let x = 0; x + 1 < nx; x += 1) {
        let inside = 0
        for (let index = 0; index < 8; index += 1) {
          const [dx, dy, dz] = CELL_CORNERS[index]!
          const sample = at(x + dx, y + dy, z + dz)
          corner[index] = sample
          value[index] = field[sample]!
          place[index] = [origin[0] + (x + dx) * voxel, origin[1] + (y + dy) * voxel, origin[2] + (z + dz) * voxel]
          if (value[index]! < 0) inside += 1
        }
        if (inside === 0 || inside === 8) continue
        for (const tet of TETRAHEDRA) {
          marchOne(tet, corner, value, place, vertexOn, points, triangles)
        }
      }
    }
  }
  return { points, faces: trisToQuads(points, triangles) }
}

/** Where a sample sits in space, from its index in the field. */
function sampleAt(index: number, origin: Vec3, voxel: number, nx: number, ny: number): Vec3 {
  const x = index % nx
  const y = Math.floor(index / nx) % ny
  const z = Math.floor(index / (nx * ny))
  return [origin[0] + x * voxel, origin[1] + y * voxel, origin[2] + z * voxel]
}

/**
 * One tetrahedron's share of the surface: nothing, one triangle, or two.
 *
 * Three cases and no ambiguity, which is the whole reason for cutting the cell into tetrahedra. The
 * triangles are wound so their normals point away from the inside — outwards, the convention every
 * other mesh in the editor keeps — which is checked against a corner that is actually inside rather
 * than assumed from the case.
 */
function marchOne(
  tet: [number, number, number, number],
  corner: number[],
  value: number[],
  place: Vec3[],
  vertexOn: (a: number, b: number, valueA: number, valueB: number) => number,
  points: Vec3[],
  triangles: number[][],
): void {
  const inside = tet.filter((index) => value[index]! < 0)
  const outside = tet.filter((index) => value[index]! >= 0)
  if (inside.length === 0 || outside.length === 0) return
  const cut = (a: number, b: number): number => vertexOn(corner[a]!, corner[b]!, value[a]!, value[b]!)
  const within = place[inside[0]!]!
  const add = (a: number, b: number, c: number): void => {
    if (a === b || b === c || a === c) return
    triangles.push(outwards(points, a, b, c, within) ? [a, b, c] : [a, c, b])
  }
  if (inside.length === 1 || outside.length === 1) {
    // One corner on its own: the surface cuts the three edges that reach it.
    const alone = inside.length === 1 ? inside[0]! : outside[0]!
    const others = tet.filter((index) => index !== alone)
    add(cut(alone, others[0]!), cut(alone, others[1]!), cut(alone, others[2]!))
    return
  }
  // Two and two: the surface cuts the four edges between the pairs, and they make a quad.
  const [i0, i1] = inside as [number, number]
  const [o0, o1] = outside as [number, number]
  const a = cut(i0, o0)
  const b = cut(i0, o1)
  const c = cut(i1, o1)
  const d = cut(i1, o0)
  add(a, b, c)
  add(a, c, d)
}

/** Whether a triangle's normal points away from a place known to be inside the surface. */
function outwards(points: Vec3[], a: number, b: number, c: number, inward: Vec3): boolean {
  const pa = points[a]!
  const pb = points[b]!
  const pc = points[c]!
  const ux = pb[0] - pa[0]
  const uy = pb[1] - pa[1]
  const uz = pb[2] - pa[2]
  const vx = pc[0] - pa[0]
  const vy = pc[1] - pa[1]
  const vz = pc[2] - pa[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  return nx * (pa[0] - inward[0]) + ny * (pa[1] - inward[1]) + nz * (pa[2] - inward[2]) > 0
}

/**
 * Triangles paired into quads, as Blender's Tris to Quads does.
 *
 * A remesh exists to give a sculpt an even topology, and even topology means quads: they subdivide
 * cleanly, they take an edge loop, and they are what every later modelling tool expects. Pairs are
 * taken best first — the flattest, squarest pair of triangles across each shared edge — and a
 * triangle that finds no partner is left as a triangle rather than forced into a quad that folds.
 */
function trisToQuads(points: Vec3[], triangles: number[][]): number[][] {
  const byEdge = new Map<string, number[]>()
  for (let index = 0; index < triangles.length; index += 1) {
    const face = triangles[index]!
    for (let corner = 0; corner < 3; corner += 1) {
      const a = face[corner]!
      const b = face[(corner + 1) % 3]!
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const list = byEdge.get(key)
      if (list) list.push(index)
      else byEdge.set(key, [index])
    }
  }
  type Pair = { first: number; second: number; quad: number[]; quality: number }
  const pairs: Pair[] = []
  for (const [key, faces] of byEdge) {
    if (faces.length !== 2) continue
    const [first, second] = faces as [number, number]
    const [a, b] = key.split(':').map(Number) as [number, number]
    const quad = joinTriangles(triangles[first]!, triangles[second]!, a, b)
    if (!quad) continue
    const quality = quadQuality(points, quad)
    if (quality <= 0) continue
    pairs.push({ first, second, quad, quality })
  }
  pairs.sort((one, other) => other.quality - one.quality)
  const used = new Uint8Array(triangles.length)
  const faces: number[][] = []
  for (const pair of pairs) {
    if (used[pair.first] || used[pair.second]) continue
    used[pair.first] = 1
    used[pair.second] = 1
    faces.push(pair.quad)
  }
  for (let index = 0; index < triangles.length; index += 1) {
    if (!used[index]) faces.push(triangles[index]!)
  }
  return faces
}

/** The quad two triangles make across the edge a–b, keeping the winding of the first. */
function joinTriangles(first: number[], second: number[], a: number, b: number): number[] | null {
  const other = second.find((corner) => corner !== a && corner !== b)
  if (other === undefined) return null
  const quad: number[] = []
  for (let corner = 0; corner < 3; corner += 1) {
    const here = first[corner]!
    quad.push(here)
    const next = first[(corner + 1) % 3]!
    // The far corner of the second triangle goes where the shared edge was.
    if ((here === a && next === b) || (here === b && next === a)) quad.push(other)
  }
  return quad.length === 4 ? quad : null
}

/**
 * How good a quad two triangles would make: nought for one that folds or doubles back.
 *
 * Flat and square is what a remesh is for, so the measure is the pair of them — how nearly the two
 * halves lie in one plane, times how nearly the corners are right angles.
 */
function quadQuality(points: Vec3[], quad: number[]): number {
  const corners = quad.map((index) => points[index]!)
  if (corners.some((corner) => corner === undefined)) return 0
  let flatness = 1
  let squareness = 1
  for (let corner = 0; corner < 4; corner += 1) {
    const previous = corners[(corner + 3) % 4]!
    const here = corners[corner]!
    const next = corners[(corner + 1) % 4]!
    const ux = previous[0] - here[0]
    const uy = previous[1] - here[1]
    const uz = previous[2] - here[2]
    const vx = next[0] - here[0]
    const vy = next[1] - here[1]
    const vz = next[2] - here[2]
    const lengths = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz)
    if (lengths < NOTHING) return 0
    const angle = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy + uz * vz) / lengths)))
    // A reflex or a needle corner is a quad that folds; the pair is refused rather than scored low.
    if (angle <= 0.05 || angle >= Math.PI - 0.05) return 0
    squareness = Math.min(squareness, 1 - Math.abs(angle - Math.PI / 2) / (Math.PI / 2))
  }
  const normalA = normalOf(corners[0]!, corners[1]!, corners[2]!)
  const normalB = normalOf(corners[0]!, corners[2]!, corners[3]!)
  flatness = normalA[0] * normalB[0] + normalA[1] * normalB[1] + normalA[2] * normalB[2]
  if (flatness <= 0) return 0
  return flatness * squareness
}

function normalOf(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz) || 1
  return [nx / length, ny / length, nz / length]
}

/**
 * The points scaled about their middle until the shape holds what it held before.
 *
 * The cube rounds by about a voxel at every edge, and rounding is volume gone; a uniform scale is
 * the cheapest way of putting it back and the only one that cannot change the shape. It is what
 * Blender's own "preserve volume" does, and it has the same limitation: a model that lost its
 * volume at one thin place gets it back everywhere.
 */
function scaledToVolume(built: { points: Vec3[]; faces: number[][] }, wanted: number): Vec3[] {
  const after = Math.abs(volumeOfPolygons(built.points, built.faces))
  if (after < NOTHING || wanted < NOTHING) return built.points
  const factor = Math.cbrt(wanted / after)
  if (!Number.isFinite(factor) || factor <= 0) return built.points
  const centre: Vec3 = [0, 0, 0]
  for (const point of built.points) {
    centre[0] += point[0] / built.points.length
    centre[1] += point[1] / built.points.length
    centre[2] += point[2] / built.points.length
  }
  return built.points.map((point) => [
    centre[0] + (point[0] - centre[0]) * factor,
    centre[1] + (point[1] - centre[1]) * factor,
    centre[2] + (point[2] - centre[2]) * factor,
  ] as Vec3)
}

/** How much a closed mesh holds, by the divergence theorem over its triangles. */
export function volumeOf(mesh: MeshData): number {
  const points: Vec3[] = []
  for (let index = 0; index < mesh.vertexIds.length; index += 1) {
    points.push([mesh.vertices[index * 3] ?? 0, mesh.vertices[index * 3 + 1] ?? 0, mesh.vertices[index * 3 + 2] ?? 0])
  }
  return Math.abs(volumeOfPolygons(points, mesh.faces))
}

function volumeOfPolygons(points: Vec3[], faces: number[][]): number {
  let total = 0
  for (const face of faces) {
    for (let corner = 1; corner + 1 < face.length; corner += 1) {
      const a = points[face[0]!]
      const b = points[face[corner]!]
      const c = points[face[corner + 1]!]
      if (!a || !b || !c) continue
      total += (a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
  }
  return total
}

/* ------------------------------------------------------------- the geometry */

function boundsOf(mesh: MeshData): { min: Vec3; max: Vec3 } | null {
  if (mesh.vertexIds.length === 0 || mesh.faces.length === 0) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < mesh.vertexIds.length; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.vertices[index * 3 + axis] ?? 0
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  return { min, max }
}

/** Every face as triangles, which is what a distance field is measured against. */
function trianglesOf(mesh: MeshData): Array<[Vec3, Vec3, Vec3]> {
  const triangles: Array<[Vec3, Vec3, Vec3]> = []
  const point = (slot: number): Vec3 => [
    mesh.vertices[slot * 3] ?? 0, mesh.vertices[slot * 3 + 1] ?? 0, mesh.vertices[slot * 3 + 2] ?? 0,
  ]
  for (const face of mesh.faces) {
    for (let corner = 1; corner + 1 < face.length; corner += 1) {
      triangles.push([point(face[0]!), point(face[corner]!), point(face[corner + 1]!)])
    }
  }
  return triangles
}

/** The distance from a point to a triangle: the standard closest-point walk over its seven regions. */
function pointToTriangle(point: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const ap: Vec3 = [point[0] - a[0], point[1] - a[1], point[2] - a[2]]
  const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]
  const d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2]
  if (d1 <= 0 && d2 <= 0) return length(ap)

  const bp: Vec3 = [point[0] - b[0], point[1] - b[1], point[2] - b[2]]
  const d3 = ab[0] * bp[0] + ab[1] * bp[1] + ab[2] * bp[2]
  const d4 = ac[0] * bp[0] + ac[1] * bp[1] + ac[2] * bp[2]
  if (d3 >= 0 && d4 <= d3) return length(bp)

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const along = d1 / (d1 - d3)
    return length([ap[0] - ab[0] * along, ap[1] - ab[1] * along, ap[2] - ab[2] * along])
  }

  const cp: Vec3 = [point[0] - c[0], point[1] - c[1], point[2] - c[2]]
  const d5 = ab[0] * cp[0] + ab[1] * cp[1] + ab[2] * cp[2]
  const d6 = ac[0] * cp[0] + ac[1] * cp[1] + ac[2] * cp[2]
  if (d6 >= 0 && d5 <= d6) return length(cp)

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const along = d2 / (d2 - d6)
    return length([ap[0] - ac[0] * along, ap[1] - ac[1] * along, ap[2] - ac[2] * along])
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const along = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    return length([bp[0] - (c[0] - b[0]) * along, bp[1] - (c[1] - b[1]) * along, bp[2] - (c[2] - b[2]) * along])
  }

  const denominator = 1 / (va + vb + vc)
  const v = vb * denominator
  const w = vc * denominator
  return length([ap[0] - ab[0] * v - ac[0] * w, ap[1] - ab[1] * v - ac[1] * w, ap[2] - ab[2] * v - ac[2] * w])
}

function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}
