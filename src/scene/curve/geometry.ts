import { ShapeUtils, Vector2 } from 'three'
import { emptyAttributes, meshFromPolygons } from '@/scene/mesh/data'
import {
  add, cross, dot, length3, normalized, sampleSpline, scaled, signedArea, subtract,
  type SampledSpline,
} from '@/scene/curve/spline'
import { pointInPolygon } from '@/scene/curve/spline'
import type { CurveData, CurveFill, MeshData, Vec3 } from '@/scene/types'

/**
 * What a curve or a text object is, once it is geometry.
 *
 * A curve in Blender is not drawn: it is *evaluated* into a surface, and the surface is what the
 * modifier stack, the materials and the exporter see. That is the shape of this module — one
 * function that takes the data and gives back a `MeshData`, and the rest of the editor none the
 * wiser. Text arrives here too, through `solidFromContours`, because a glyph is a set of closed
 * outlines with holes and so is a filled 2D curve.
 *
 * Three shapes come out of it, in Blender's own order of precedence:
 *
 *   - a bevel depth turns the curve into a swept tube, and nothing else applies;
 *   - otherwise a closed spline is filled, and an extrude gives the fill depth;
 *   - otherwise the curve is a line, and comes back as vertices and edges with no faces at all.
 */

export type Contour = Vec3[]

/** One filled outline and the outlines that punch holes in it. */
export type FilledShape = { outer: Contour; holes: Contour[] }

export type SolidOptions = {
  /** Half the depth: the solid runs from -extrude to +extrude, the way Blender's does. */
  extrude: number
  fill: CurveFill
  /** Rounds the edge between a cap and the wall, by pulling the cap in as it goes out. */
  bevelDepth?: number
  bevelResolution?: number
}

const MAX_BEVEL_SIDES = 64

/* ------------------------------------------------------------------ curve */

export function curveMesh(data: CurveData, taper?: SampledSpline | null): MeshData {
  const flat = data.dimensions === '2D'
  const sampled = data.splines
    .map((spline) => sampleSpline(spline, data.resolution))
    .filter((entry) => entry.points.length >= 2)
    .map((entry) => (flat ? flatten(entry) : entry))
  if (sampled.length === 0) return meshFromPolygons([], [])

  if (data.bevelDepth > 0) {
    const positions: Vec3[] = []
    const faces: number[][] = []
    for (const entry of sampled) {
      sweep(entry, {
        depth: data.bevelDepth,
        sides: bevelSides(data.bevelResolution),
        capped: data.fill !== 'none',
        taper: taper ? taperProfile(taper) : null,
      }, positions, faces)
    }
    return meshFromPolygons(positions, faces, { smooth: true })
  }

  const closed = sampled.filter((entry) => entry.closed)
  if (closed.length > 0 && (data.fill !== 'none' || data.extrude > 0)) {
    const shapes = nestContours(closed.map((entry) => entry.points))
    const solid = solidFromContours(shapes, { extrude: data.extrude, fill: data.fill })
    const open = sampled.filter((entry) => !entry.closed)
    if (open.length === 0) return solid
    return joinMeshes([solid, ribbons(open, data.extrude)])
  }
  if (data.extrude > 0) return ribbons(sampled, data.extrude)
  return lines(sampled)
}

/** A 2D curve is exactly that: every knot is read at z = 0, whatever the document says. */
function flatten(entry: SampledSpline): SampledSpline {
  return { ...entry, points: entry.points.map(([x, y]) => [x, y, 0] as Vec3) }
}

/** Blender's round profile: four quadrants, each cut into `resolution + 1` pieces. */
export function bevelSides(resolution: number): number {
  const quarters = Math.max(0, Math.min(15, Math.round(resolution))) + 1
  return Math.min(MAX_BEVEL_SIDES, quarters * 4)
}

/* ------------------------------------------------------------------ lines */

/** The curve as it is: a polyline, no faces. The viewport draws it as an edge loop. */
function lines(splines: SampledSpline[]): MeshData {
  const positions: Vec3[] = []
  const edges: Array<[number, number]> = []
  for (const spline of splines) {
    const base = positions.length
    positions.push(...spline.points)
    for (let index = 1; index < spline.points.length; index += 1) edges.push([base + index - 1, base + index])
    if (spline.closed) edges.push([base + spline.points.length - 1, base])
  }
  const mesh = meshFromPolygons(positions, [])
  mesh.edges = edges
  mesh.attributes = emptyAttributes(0, edges.length)
  return mesh
}

/** An open curve given depth: a wall standing on the polyline, seen from both sides. */
function ribbons(splines: SampledSpline[], extrude: number): MeshData {
  const depth = Math.max(extrude, 1e-4)
  const positions: Vec3[] = []
  const faces: number[][] = []
  for (const spline of splines) {
    const base = positions.length
    for (const point of spline.points) positions.push([point[0], point[1], point[2] - depth])
    for (const point of spline.points) positions.push([point[0], point[1], point[2] + depth])
    const count = spline.points.length
    const spans = spline.closed ? count : count - 1
    for (let index = 0; index < spans; index += 1) {
      const next = (index + 1) % count
      faces.push([base + index, base + next, base + count + next, base + count + index])
    }
  }
  return meshFromPolygons(positions, faces)
}

/* ------------------------------------------------------------------ sweep */

type SweepOptions = {
  depth: number
  sides: number
  capped: boolean
  /** A thickness along the length, sampled 0 to 1, from a taper object. */
  taper?: ((along: number) => number) | null
}

/**
 * The curve swept into a tube.
 *
 * The frames are carried along by double reflection rather than built from a fixed up vector: a
 * fixed one flips where the curve turns vertical, and the tube shears there. A closed curve does
 * not generally come back to the frame it started in, so the leftover turn is spread evenly along
 * the length — which is what stops a bevelled circle from having a seam.
 */
function sweep(spline: SampledSpline, options: SweepOptions, positions: Vec3[], faces: number[][]): void {
  const base = positions.length
  const points = spline.points
  const count = points.length
  const frames = transportFrames(points, spline.closed)
  let twist = 0
  if (spline.closed && count > 2) {
    const first = frames[0]!
    const last = frames[count - 1]!
    const forward = tangentAt(points, count - 1, true)
    const projected = normalized(subtract(first.normal, scaled(forward, dot(first.normal, forward))))
    const angle = Math.atan2(dot(cross(last.normal, projected), forward), dot(last.normal, projected))
    twist = angle / count
  }
  for (let index = 0; index < count; index += 1) {
    const frame = frames[index]!
    const along = count > 1 ? index / (count - 1) : 0
    const scale = options.depth * (spline.radii[index] ?? 1) * (options.taper ? options.taper(along) : 1)
    const tilt = ((spline.tilts[index] ?? 0) * Math.PI) / 180 + twist * index
    for (let side = 0; side < options.sides; side += 1) {
      const angle = (side / options.sides) * Math.PI * 2 + tilt
      const offset = add(scaled(frame.normal, Math.cos(angle) * scale), scaled(frame.binormal, Math.sin(angle) * scale))
      positions.push(add(points[index]!, offset))
    }
  }
  const rings = spline.closed ? count : count - 1
  for (let index = 0; index < rings; index += 1) {
    const here = base + index * options.sides
    const there = base + ((index + 1) % count) * options.sides
    for (let side = 0; side < options.sides; side += 1) {
      const next = (side + 1) % options.sides
      faces.push([here + side, there + side, there + next, here + next])
    }
  }
  if (options.capped && !spline.closed) {
    const start: number[] = []
    const end: number[] = []
    for (let side = 0; side < options.sides; side += 1) {
      start.push(base + (options.sides - 1 - side))
      end.push(base + (count - 1) * options.sides + side)
    }
    faces.push(start, end)
  }
}

type Frame = { normal: Vec3; binormal: Vec3 }

function tangentAt(points: readonly Vec3[], index: number, closed: boolean): Vec3 {
  const count = points.length
  const previous = index > 0 ? points[index - 1]! : (closed ? points[count - 1]! : points[index]!)
  const next = index < count - 1 ? points[index + 1]! : (closed ? points[0]! : points[index]!)
  const direction = normalized(subtract(next, previous))
  return length3(direction) > 1e-9 ? direction : [0, 0, 1]
}

function transportFrames(points: readonly Vec3[], closed: boolean): Frame[] {
  const frames: Frame[] = []
  let tangent = tangentAt(points, 0, closed)
  const reference: Vec3 = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  let normal = normalized(cross(reference, tangent))
  if (length3(normal) < 1e-9) normal = normalized(cross([0, 1, 0], tangent))
  frames.push({ normal, binormal: normalized(cross(tangent, normal)) })
  for (let index = 1; index < points.length; index += 1) {
    const next = tangentAt(points, index, closed)
    // Double reflection: the frame is rotated by exactly the turn the tangent made, and no more.
    const axis = cross(tangent, next)
    if (length3(axis) > 1e-9) {
      const angle = Math.atan2(length3(axis), dot(tangent, next))
      normal = rotateAbout(normal, normalized(axis), angle)
    }
    tangent = next
    frames.push({ normal, binormal: normalized(cross(tangent, normal)) })
  }
  return frames
}

function rotateAbout(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return add(
    add(scaled(vector, cosine), scaled(cross(axis, vector), sine)),
    scaled(axis, dot(axis, vector) * (1 - cosine)),
  )
}

/** A taper curve read as thickness: its height above X, over the span its X covers. */
export function taperProfile(taper: SampledSpline): (along: number) => number {
  const points = taper.points
  if (points.length < 2) return () => 1
  const xs = points.map((point) => point[0])
  const start = Math.min(...xs)
  const span = Math.max(...xs) - start
  if (span < 1e-9) return () => 1
  return (along: number) => {
    const at = start + along * span
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!
      const b = points[index]!
      if ((a[0] <= at && at <= b[0]) || (b[0] <= at && at <= a[0])) {
        const width = b[0] - a[0]
        const t = Math.abs(width) < 1e-9 ? 0 : (at - a[0]) / width
        return Math.abs(a[1] + (b[1] - a[1]) * t)
      }
    }
    return Math.abs(points[points.length - 1]![1])
  }
}

/* ------------------------------------------------------------------ fills */

/**
 * Which outline holds which.
 *
 * A letter "A" is two closed contours and the inner one is a hole; so is a washer, and so is any
 * curve drawn inside another. Depth by containment settles it the way a font does: a contour with
 * an odd number of contours around it is a hole in the innermost of them, and an even one is an
 * outline of its own.
 */
export function nestContours(rings: readonly Contour[]): FilledShape[] {
  const usable = rings.map((ring) => cleanRing(ring)).filter((ring) => ring.length >= 3)
  const depths = usable.map((ring, index) => (
    usable.reduce((depth, other, otherIndex) => (
      otherIndex !== index && contains(other, ring) ? depth + 1 : depth
    ), 0)
  ))
  const shapes = new Map<number, FilledShape>()
  usable.forEach((ring, index) => {
    if (depths[index]! % 2 === 0) shapes.set(index, { outer: wound(ring, true), holes: [] })
  })
  usable.forEach((ring, index) => {
    if (depths[index]! % 2 === 0) return
    // The hole belongs to the smallest outline that holds it, which is the deepest one containing it.
    let owner: FilledShape | null = null
    let ownerDepth = -1
    for (const [outerIndex, shape] of shapes) {
      if (!contains(usable[outerIndex]!, ring)) continue
      if (depths[outerIndex]! > ownerDepth) {
        owner = shape
        ownerDepth = depths[outerIndex]!
      }
    }
    if (owner) owner.holes.push(wound(ring, false))
  })
  return [...shapes.values()]
}

/**
 * A ring with the points that say nothing taken out: the ones on top of their neighbour, and the
 * ones sitting on the straight line between them.
 *
 * It is not tidiness. The ear clipper drops such points on its way through, and the triangles it
 * gives back then use fewer vertices than the wall does — which leaves the cap short of the wall by
 * exactly those points, and a letter with a hole in its side. A glyph is full of them: a font stores
 * a counter as four points when three of them are a triangle.
 */
export function cleanRing(ring: Contour, epsilon = 1e-7): Contour {
  const apart: Contour = ring.filter((point, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length]!
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > epsilon
  })
  if (apart.length < 3) return apart
  const kept: Contour = apart.filter((point, index) => {
    const previous = apart[(index + apart.length - 1) % apart.length]!
    const next = apart[(index + 1) % apart.length]!
    const turn = (point[0] - previous[0]) * (next[1] - previous[1]) - (point[1] - previous[1]) * (next[0] - previous[0])
    return Math.abs(turn) > epsilon
  })
  return kept.length >= 3 ? kept : apart
}

function contains(outer: Contour, inner: Contour): boolean {
  const point = inner[0]!
  return pointInPolygon([point[0], point[1]], outer)
}

/** The ring in the direction asked for: counter-clockwise for an outline, clockwise for a hole. */
function wound(ring: Contour, counterClockwise: boolean): Contour {
  const area = signedArea(ring)
  return (area >= 0) === counterClockwise ? ring.slice() : ring.slice().reverse()
}

/**
 * The filled outlines given depth.
 *
 * The caps are triangulated by three's own ear clipper, which is the one its `ExtrudeGeometry`
 * uses; the walls are quads, one ring at a time, wound so that an outline faces out and a hole
 * faces into its own emptiness. A bevel pulls the cap in as it lifts, in a quarter circle.
 */
export function solidFromContours(shapes: readonly FilledShape[], options: SolidOptions): MeshData {
  const positions: Vec3[] = []
  const faces: number[][] = []
  const depth = Math.max(0, options.extrude)
  const bevel = Math.max(0, options.bevelDepth ?? 0)
  const steps = bevel > 0 ? Math.max(1, Math.min(8, Math.round(options.bevelResolution ?? 2)) + 1) : 0
  const front = options.fill === 'front' || options.fill === 'both'
  const back = options.fill === 'back' || options.fill === 'both'

  for (const shape of shapes) {
    const rings = [shape.outer, ...shape.holes]
    const counts = rings.map((ring) => ring.length)
    const triangles = triangulate(shape)
    if (depth <= 0 && bevel <= 0) {
      // Nothing to give the fill depth, so it is one flat face and there is no wall to build.
      const base = positions.length
      pushLevel(positions, rings, 0)
      if (back && !front) for (const triangle of triangles) faces.push([base + triangle[0]!, base + triangle[2]!, base + triangle[1]!])
      else for (const triangle of triangles) faces.push([base + triangle[0]!, base + triangle[1]!, base + triangle[2]!])
      continue
    }
    /*
     * Every ring is laid down once per level: the two bevel runs and the two caps. A level is the
     * ring inset by how far the bevel has come in, lifted to where it has come out, so level 0 is
     * the widest and the last is the cap itself.
     */
    const levels: Contour[][] = []
    const heights: number[] = []
    for (let step = 0; step <= steps; step += 1) {
      const angle = steps === 0 ? 0 : (step / steps) * (Math.PI / 2)
      heights.push(bevel * Math.sin(angle))
      levels.push(insetRings(rings, bevel * (1 - Math.cos(angle))))
    }

    const base = positions.length
    const ringWidth = counts.reduce((total, count) => total + count, 0)
    const levelCount = levels.length
    // Bottom levels run upward from -depth-bevel; top levels mirror them.
    for (let step = 0; step < levelCount; step += 1) {
      pushLevel(positions, levels[step]!, -depth - bevel + heights[step]!)
    }
    for (let step = levelCount - 1; step >= 0; step -= 1) {
      pushLevel(positions, levels[step]!, depth + bevel - heights[step]!)
    }
    const totalLevels = levelCount * 2
    for (let level = 0; level < totalLevels - 1; level += 1) {
      // The two innermost levels are the same ring at two heights: that pair is the wall.
      wallBetween(faces, base + level * ringWidth, base + (level + 1) * ringWidth, counts)
    }
    const bottom = base
    const top = base + (totalLevels - 1) * ringWidth
    if (back) for (const triangle of triangles) faces.push([bottom + triangle[0]!, bottom + triangle[2]!, bottom + triangle[1]!])
    if (front) for (const triangle of triangles) faces.push([top + triangle[0]!, top + triangle[1]!, top + triangle[2]!])
  }
  return meshFromPolygons(positions, faces)
}

function pushLevel(positions: Vec3[], rings: readonly Contour[], height: number): void {
  for (const ring of rings) for (const point of ring) positions.push([point[0], point[1], height])
}

function wallBetween(faces: number[][], lower: number, upper: number, counts: readonly number[]): void {
  let offset = 0
  for (const count of counts) {
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count
      faces.push([lower + offset + index, lower + offset + next, upper + offset + next, upper + offset + index])
    }
    offset += count
  }
}

/**
 * Every ring pulled in by `distance` along the bisector at each corner.
 *
 * It is the cheap offset, and it is honest about it: a bevel deeper than the thinnest part of the
 * shape folds the ring through itself, exactly as Blender's does, and the miter is capped so that
 * a sharp corner does not shoot off to infinity.
 */
function insetRings(rings: readonly Contour[], distance: number): Contour[] {
  if (distance <= 0) return rings.map((ring) => ring.slice())
  return rings.map((ring) => {
    const area = signedArea(ring)
    const side = area >= 0 ? 1 : -1
    return ring.map((point, index) => {
      const previous = ring[(index + ring.length - 1) % ring.length]!
      const next = ring[(index + 1) % ring.length]!
      const into = bisector(previous, point, next, side)
      return [point[0] + into[0] * distance, point[1] + into[1] * distance, point[2]] as Vec3
    })
  })
}

function bisector(previous: Vec3, point: Vec3, next: Vec3, side: number): [number, number] {
  const back = normalize2(point[0] - previous[0], point[1] - previous[1])
  const forward = normalize2(next[0] - point[0], next[1] - point[1])
  // The inward normal of each edge, for a ring wound the way `side` says, then their average.
  const first: [number, number] = [back[1] * -side, back[0] * side]
  const second: [number, number] = [forward[1] * -side, forward[0] * side]
  const sum = normalize2(first[0] + second[0], first[1] + second[1])
  const miter = Math.max(0.25, (sum[0] * first[0] + sum[1] * first[1]))
  const limit = Math.min(4, 1 / miter)
  return [sum[0] * limit, sum[1] * limit]
}

function normalize2(x: number, y: number): [number, number] {
  const size = Math.hypot(x, y)
  return size > 1e-9 ? [x / size, y / size] : [0, 0]
}

function triangulate(shape: FilledShape): number[][] {
  const contour = shape.outer.map((point) => new Vector2(point[0], point[1]))
  const holes = shape.holes.map((hole) => hole.map((point) => new Vector2(point[0], point[1])))
  try {
    return ShapeUtils.triangulateShape(contour, holes)
  } catch {
    // A contour that crosses itself has no triangulation; the walls still stand, and that is what
    // Blender shows too when a curve is drawn through itself.
    return []
  }
}

/* ----------------------------------------------------------------- joining */

/** Two built meshes side by side. Vertex ids are renumbered, which is what `meshFromPolygons` does. */
export function joinMeshes(parts: readonly MeshData[]): MeshData {
  const positions: Vec3[] = []
  const faces: number[][] = []
  const edges: Array<[number, number]> = []
  for (const part of parts) {
    const base = positions.length
    for (let index = 0; index < part.vertexIds.length; index += 1) {
      positions.push([part.vertices[index * 3] ?? 0, part.vertices[index * 3 + 1] ?? 0, part.vertices[index * 3 + 2] ?? 0])
    }
    for (const face of part.faces) faces.push(face.map((slot) => slot + base))
    for (const [a, b] of part.edges) edges.push([a + base, b + base])
  }
  const mesh = meshFromPolygons(positions, faces)
  for (const [a, b] of edges) {
    if (!mesh.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) mesh.edges.push([a, b])
  }
  return mesh
}
