import { clampNumber, meshFromPolygons } from '@/scene/mesh/data'
import { withActiveUv } from '@/scene/mesh/uv'
import { cubeProjection, cylinderProjection, planarProjection, resetProjection, sphereProjection, torusProjection } from '@/scene/uv/project'
import type { MeshData, Vec2, Vec3 } from '@/scene/types'

/**
 * The meshes the Add menu can make. Every one is a quad-first polygon mesh with outward-facing
 * loops, so an extrude or a bevel on a fresh primitive behaves the way it does in Blender.
 *
 * The world is Z up: a plane lies on XY, and the axis of a sphere, a cylinder or a cone is Z. The
 * defaults are Blender's own — a cube two metres across, a circle of thirty-two vertices, a torus
 * of forty-eight by twelve — so a hand used to Blender gets the mesh it expects without having to
 * open the redo panel first.
 *
 * Every one arrives with a UV map, as Blender's do. A primitive knows how it is parametrised —
 * a sphere by its two angles, a cylinder by its angle and its height — so the map it is born with
 * is the one an unwrapper would have to work to find, and a texture lands on it from the start.
 */

/** What closes the flat end of a circle, a cylinder or a cone; Blender offers exactly these three. */
export type CapFill = 'none' | 'ngon' | 'triangle-fan'

const TAU = Math.PI * 2

/**
 * A ceiling on every segment count. Blender's own limits differ per primitive and go into the
 * hundreds of thousands; one bound in the low hundreds is enough for an editor that draws every
 * face, and it keeps a mistyped field from building a million-face mesh before anyone can undo.
 */
const MAX_SEGMENTS = 512

/* ------------------------------------------------------------------ flat */

/** A flat quad on the XY plane, `size` across. */
export function planeMesh(size = 2): MeshData {
  const half = size / 2
  const mesh = meshFromPolygons(
    [[-half, -half, 0], [half, -half, 0], [half, half, 0], [-half, half, 0]],
    [[0, 1, 2, 3]],
  )
  return withActiveUv(mesh, resetProjection(mesh))
}

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
  // Blender's cube gives every face the whole image, which is what a checker is read on.
  const mesh = meshFromPolygons(positions, faces)
  return withActiveUv(mesh, resetProjection(mesh))
}

/**
 * A grid on the XY plane. Blender counts subdivisions as vertices per side, not as cuts, so the
 * default of ten by ten is a hundred vertices and eighty-one quads.
 */
export function gridMesh(options: { xSubdivisions?: number; ySubdivisions?: number; size?: number } = {}): MeshData {
  // Two is the smallest count that still leaves a face; one would give a bare row of vertices.
  const columns = wholeCount(options.xSubdivisions, 2, MAX_SEGMENTS, 10)
  const rows = wholeCount(options.ySubdivisions, 2, MAX_SEGMENTS, 10)
  const size = measure(options.size, 2)
  const positions: Vec3[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      positions.push([
        size * (column / (columns - 1) - 0.5),
        size * (row / (rows - 1) - 0.5),
        0,
      ])
    }
  }
  const faces: number[][] = []
  for (let row = 0; row + 1 < rows; row += 1) {
    for (let column = 0; column + 1 < columns; column += 1) {
      const corner = row * columns + column
      faces.push([corner, corner + 1, corner + columns + 1, corner + columns])
    }
  }
  const mesh = meshFromPolygons(positions, faces)
  return withActiveUv(mesh, planarProjection(mesh, 2))
}

/**
 * A circle on the XY plane. Blender's default fill is 'none', which leaves a closed loop of wire
 * with no face at all — the usual starting point for a spin or a screw.
 */
export function circleMesh(options: { vertices?: number; radius?: number; fill?: CapFill } = {}): MeshData {
  const count = wholeCount(options.vertices, 3, MAX_SEGMENTS, 32)
  const radius = measure(options.radius, 1)
  const positions = ring(count, radius, 0)
  const rim = positions.map((_, index) => index)
  const fill = options.fill ?? 'none'
  if (fill !== 'none') {
    const filled = meshFromPolygons(positions, capFaces(positions, rim, 0, fill, true))
    return withActiveUv(filled, planarProjection(filled, 2))
  }
  const wire: Array<[number, number]> = rim.map((slot, index) => [slot, rim[(index + 1) % count]!])
  return withLooseEdges(meshFromPolygons(positions, []), wire)
}

/* --------------------------------------------------------------- rounded */

/**
 * A sphere of latitude rings and longitude segments, poles on Z. The two rings that touch a pole
 * are triangles because a pole is one vertex; everything between them is quads, as in Blender.
 */
export function uvSphereMesh(options: { segments?: number; rings?: number; radius?: number } = {}): MeshData {
  const segments = wholeCount(options.segments, 3, MAX_SEGMENTS, 32)
  const rings = wholeCount(options.rings, 2, MAX_SEGMENTS, 16)
  const radius = measure(options.radius, 1)
  const positions: Vec3[] = [[0, 0, radius]]
  for (let band = 1; band < rings; band += 1) {
    const polar = (Math.PI * band) / rings
    positions.push(...ring(segments, radius * Math.sin(polar), radius * Math.cos(polar)))
  }
  positions.push([0, 0, -radius])
  const south = positions.length - 1
  const at = (band: number, step: number): number => 1 + (band - 1) * segments + (step % segments)

  const faces: number[][] = []
  for (let step = 0; step < segments; step += 1) faces.push([0, at(1, step), at(1, step + 1)])
  for (let band = 1; band + 1 < rings; band += 1) {
    for (let step = 0; step < segments; step += 1) {
      faces.push([at(band, step), at(band + 1, step), at(band + 1, step + 1), at(band, step + 1)])
    }
  }
  for (let step = 0; step < segments; step += 1) faces.push([south, at(rings - 1, step + 1), at(rings - 1, step)])
  // Spheres are the one family the plan shades smooth on creation; every other primitive is flat.
  const mesh = meshFromPolygons(positions, faces, { smooth: true })
  return withActiveUv(mesh, sphereProjection(mesh))
}

/**
 * An icosahedron whose triangles are split into four, level after level, each new vertex pushed
 * out onto the sphere. One subdivision is the bare icosahedron: twelve vertices, twenty faces.
 */
export function icoSphereMesh(options: { subdivisions?: number; radius?: number } = {}): MeshData {
  // The plan caps the editor at five, where the mesh is already 5 120 faces.
  const subdivisions = wholeCount(options.subdivisions, 1, 5, 2)
  const radius = measure(options.radius, 1)
  const points = icosahedronPoints()
  let faces = icosahedronFaces()
  for (let level = 1; level < subdivisions; level += 1) faces = subdivideOnSphere(points, faces)
  const mesh = meshFromPolygons(points.map((point) => scaled(point, radius)), faces, { smooth: true })
  return withActiveUv(mesh, sphereProjection(mesh))
}

/* ------------------------------------------------------------------ swept */

/** A tube along Z, capped at both ends. Blender's cylinder is 32-sided, 2 m across and 2 m deep. */
export function cylinderMesh(options: { vertices?: number; radius?: number; depth?: number; fill?: CapFill } = {}): MeshData {
  const count = wholeCount(options.vertices, 3, MAX_SEGMENTS, 32)
  const radius = measure(options.radius, 1)
  const depth = measure(options.depth, 2)
  return tubeMesh(count, radius, radius, depth, options.fill ?? 'ngon')
}

/**
 * A cone along Z. `radius1` is the base at -Z and `radius2` the top at +Z: leave the top at zero
 * for a point, raise it for a frustum. A radius of zero collapses its ring to a single vertex, so
 * the side faces there come out as triangles rather than as quads with a doubled corner.
 */
export function coneMesh(options: { vertices?: number; radius1?: number; radius2?: number; depth?: number; fill?: CapFill } = {}): MeshData {
  const count = wholeCount(options.vertices, 3, MAX_SEGMENTS, 32)
  const radius1 = measure(options.radius1, 1)
  const radius2 = measure(options.radius2, 0)
  const depth = measure(options.depth, 2)
  return tubeMesh(count, radius1, radius2, depth, options.fill ?? 'ngon')
}

/** A torus around Z: `majorSegments` around the ring, `minorSegments` around the tube, all quads. */
export function torusMesh(options: { majorSegments?: number; minorSegments?: number; majorRadius?: number; minorRadius?: number } = {}): MeshData {
  const major = wholeCount(options.majorSegments, 3, MAX_SEGMENTS, 48)
  const minor = wholeCount(options.minorSegments, 3, MAX_SEGMENTS, 12)
  const majorRadius = measure(options.majorRadius, 1)
  const minorRadius = measure(options.minorRadius, 0.25)
  const positions: Vec3[] = []
  for (let around = 0; around < major; around += 1) {
    const angle = (TAU * around) / major
    for (let through = 0; through < minor; through += 1) {
      const sweep = (TAU * through) / minor
      const distance = majorRadius + minorRadius * Math.cos(sweep)
      positions.push([distance * Math.cos(angle), distance * Math.sin(angle), minorRadius * Math.sin(sweep)])
    }
  }
  const at = (around: number, through: number): number => (around % major) * minor + (through % minor)
  const faces: number[][] = []
  for (let around = 0; around < major; around += 1) {
    for (let through = 0; through < minor; through += 1) {
      faces.push([at(around, through), at(around + 1, through), at(around + 1, through + 1), at(around, through + 1)])
    }
  }
  const mesh = meshFromPolygons(positions, faces)
  return withActiveUv(mesh, torusProjection(mesh, majorRadius))
}

/**
 * The mark ParamRig adds where Blender adds its monkey, swept rather than typed in.
 *
 * The path is a circle with six shallow lobes, so the silhouette reads as an aperture and not as a
 * plain torus. Along it rides a chamfered rectangular section — a flat outer rim, a flat inner
 * wall, and four bevels, the front pair wider than the back pair so the mark has a face. Forty-
 * eight samples of an eight-sided section give 384 quads: closed, manifold, and a torus by
 * topology, so its Euler characteristic is zero rather than two.
 */
export function paramRigMarkMesh(): MeshData {
  const samples = 48
  const lobes = 6
  // The lobes bend the path hard enough that a wider band would fold through itself on the inside:
  // the tightest radius of curvature here is about 0.32, comfortably clear of the 0.18 half-width.
  const lobeDepth = 0.07
  const halfWidth = 0.18
  const halfThickness = 0.11
  const frontChamfer = 0.05
  const backChamfer = 0.03
  /** The section in the plane of (outward, Z), wound counter-clockwise so the sweep faces out. */
  const section: Vec2[] = [
    [halfWidth, halfThickness - frontChamfer],
    [halfWidth - frontChamfer, halfThickness],
    [frontChamfer - halfWidth, halfThickness],
    [-halfWidth, halfThickness - frontChamfer],
    [-halfWidth, backChamfer - halfThickness],
    [backChamfer - halfWidth, -halfThickness],
    [halfWidth - backChamfer, -halfThickness],
    [halfWidth, backChamfer - halfThickness],
  ]

  const positions: Vec3[] = []
  for (let sample = 0; sample < samples; sample += 1) {
    const angle = (TAU * sample) / samples
    const distance = 1 + lobeDepth * Math.cos(lobes * angle)
    const slope = -lobes * lobeDepth * Math.sin(lobes * angle)
    // The section rides the path's own normal rather than the radial direction, so the chamfers
    // stay square to the band where a lobe bends it instead of shearing.
    const tangent: Vec2 = [
      slope * Math.cos(angle) - distance * Math.sin(angle),
      slope * Math.sin(angle) + distance * Math.cos(angle),
    ]
    const span = Math.hypot(tangent[0], tangent[1])
    const outward: Vec2 = [tangent[1] / span, -tangent[0] / span]
    const centre: Vec2 = [distance * Math.cos(angle), distance * Math.sin(angle)]
    for (const [offset, height] of section) {
      positions.push([centre[0] + offset * outward[0], centre[1] + offset * outward[1], height])
    }
  }

  const at = (sample: number, corner: number): number =>
    (sample % samples) * section.length + (corner % section.length)
  const faces: number[][] = []
  for (let sample = 0; sample < samples; sample += 1) {
    for (let corner = 0; corner < section.length; corner += 1) {
      faces.push([at(sample, corner), at(sample + 1, corner), at(sample + 1, corner + 1), at(sample, corner + 1)])
    }
  }
  const mesh = meshFromPolygons(positions, faces)
  return withActiveUv(mesh, cubeProjection(mesh))
}

/* ----------------------------------------------------------------- shared */

/**
 * A cylinder, a cone and a frustum are one sweep with two radii. Either end collapses to a single
 * vertex when its radius is zero, and a collapsed end takes no cap: there is nothing to fill.
 */
function tubeMesh(count: number, bottomRadius: number, topRadius: number, depth: number, fill: CapFill): MeshData {
  // Two collapsed ends would be a line segment, which is not a mesh anyone asked for.
  if (bottomRadius <= 0 && topRadius <= 0) return meshFromPolygons([], [])
  const half = depth / 2
  const positions: Vec3[] = []
  const bottom = ringSlots(positions, count, bottomRadius, -half)
  const top = ringSlots(positions, count, topRadius, half)

  const faces: number[][] = []
  for (let step = 0; step < count; step += 1) {
    const next = (step + 1) % count
    // A collapsed end repeats its apex here; `meshFromPolygons` drops the repeat, leaving a triangle.
    faces.push([bottom[step]!, bottom[next]!, top[next]!, top[step]!])
  }
  if (fill !== 'none' && topRadius > 0) faces.push(...capFaces(positions, top, half, fill, true))
  if (fill !== 'none' && bottomRadius > 0) faces.push(...capFaces(positions, bottom, -half, fill, false))
  const mesh = meshFromPolygons(positions, faces)
  return withActiveUv(mesh, cylinderProjection(mesh))
}

/** Appends a ring of points, or one apex when the radius has collapsed, and returns a slot per step. */
function ringSlots(positions: Vec3[], count: number, radius: number, z: number): number[] {
  const first = positions.length
  if (radius <= 0) {
    positions.push([0, 0, z])
    return new Array<number>(count).fill(first)
  }
  positions.push(...ring(count, radius, z))
  return Array.from({ length: count }, (_, step) => first + step)
}

/**
 * The face or faces that close one end of a ring. `upward` says which way the cap has to look, and
 * a triangle fan appends its own centre vertex — which is why `positions` is written to here.
 */
function capFaces(positions: Vec3[], rim: number[], z: number, fill: CapFill, upward: boolean): number[][] {
  const loop = upward ? rim.slice() : rim.slice().reverse()
  if (fill !== 'triangle-fan') return [loop]
  const centre = positions.length
  positions.push([0, 0, z])
  return loop.map((slot, index) => [centre, slot, loop[(index + 1) % loop.length]!])
}

/** A closed ring of points on a circle in a plane of constant `z`; angle zero is +X. */
function ring(count: number, radius: number, z: number, offset = 0): Vec3[] {
  const points: Vec3[] = []
  for (let step = 0; step < count; step += 1) {
    const angle = offset + (TAU * step) / count
    points.push([radius * Math.cos(angle), radius * Math.sin(angle), z])
  }
  return points
}

/**
 * `meshFromPolygons` reads its edges off the face loops, so a mesh with no faces comes back with
 * none at all. A circle with fill 'none' is exactly that — a closed loop of wire — so the loop is
 * added here, along with the per-edge attributes whose lengths have to keep matching it.
 */
function withLooseEdges(mesh: MeshData, pairs: Array<[number, number]>): MeshData {
  const seen = new Set(mesh.edges.map((edge) => `${edge[0]}:${edge[1]}`))
  for (const [a, b] of pairs) {
    if (a === b) continue
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    const key = `${low}:${high}`
    if (seen.has(key)) continue
    seen.add(key)
    mesh.edges.push([low, high])
    mesh.attributes.edge.seam?.push(false)
    mesh.attributes.edge.sharp?.push(false)
    mesh.attributes.edge.crease?.push(0)
    mesh.attributes.edge.bevelWeight?.push(0)
  }
  return mesh
}

/** The twelve corners of a unit icosahedron, poles on Z the way Blender orients its ico sphere. */
function icosahedronPoints(): Vec3[] {
  const elevation = Math.atan(0.5)
  const bandHeight = Math.sin(elevation)
  const bandRadius = Math.cos(elevation)
  return [
    [0, 0, 1],
    ...ring(5, bandRadius, bandHeight),
    // Half a step round, so each lower corner sits under the gap between two upper ones.
    ...ring(5, bandRadius, -bandHeight, Math.PI / 5),
    [0, 0, -1],
  ]
}

/** Its twenty faces: a cap of five, two interlocking bands of five, and a cap of five. */
function icosahedronFaces(): Array<[number, number, number]> {
  const upper = (step: number): number => 1 + (step % 5)
  const lower = (step: number): number => 6 + (step % 5)
  const faces: Array<[number, number, number]> = []
  for (let step = 0; step < 5; step += 1) faces.push([0, upper(step), upper(step + 1)])
  for (let step = 0; step < 5; step += 1) faces.push([upper(step), lower(step), upper(step + 1)])
  for (let step = 0; step < 5; step += 1) faces.push([lower(step), lower(step + 1), upper(step + 1)])
  for (let step = 0; step < 5; step += 1) faces.push([11, lower(step + 1), lower(step)])
  return faces
}

/**
 * One level of four-into-one subdivision, appending the new midpoints to `points`.
 *
 * Midpoints are keyed by the edge that made them, never by a rounded position: two triangles that
 * share an edge must land on the same vertex, and a position key would weld corners that only
 * happen to coincide while leaving a seam wherever the rounding fell either side of a boundary.
 */
function subdivideOnSphere(points: Vec3[], faces: Array<[number, number, number]>): Array<[number, number, number]> {
  const midpoints = new Map<string, number>()
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const found = midpoints.get(key)
    if (found !== undefined) return found
    const slot = points.length
    const start = points[a]!
    const end = points[b]!
    points.push(onUnitSphere([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2]))
    midpoints.set(key, slot)
    return slot
  }
  const split: Array<[number, number, number]> = []
  for (const [a, b, c] of faces) {
    const ab = midpoint(a, b)
    const bc = midpoint(b, c)
    const ca = midpoint(c, a)
    split.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca])
  }
  return split
}

function onUnitSphere(point: Vec3): Vec3 {
  const distance = Math.hypot(point[0], point[1], point[2])
  // Only the centre of the sphere has no direction, and no midpoint of an icosahedron edge is there.
  if (distance === 0) return [0, 0, 1]
  return [point[0] / distance, point[1] / distance, point[2] / distance]
}

function scaled(point: Vec3, factor: number): Vec3 {
  return [point[0] * factor, point[1] * factor, point[2] * factor]
}

/** A count the redo panel could show: whole, inside its bounds, and never NaN. */
function wholeCount(value: number | undefined, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback))
}

/** A length in metres. Negative is meaningless for a radius or a depth, so it clamps to zero. */
function measure(value: number | undefined, fallback: number): number {
  return clampNumber(value, 0, Number.MAX_VALUE, fallback)
}
