import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, scale } from '@/scene/mesh/normals'
import { chosenOf, defineModifier, switchOf, wholeOf } from '@/scene/modifiers/types'
import { numberParam, selectParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Subdivision surface: Catmull–Clark, one whole level at a time.
 *
 * A level reads the mesh as it stands and writes the next one over it — a face point at every
 * face’s centre, an edge point on every edge, every original vertex pulled towards them, and one
 * quad per corner of every original face. That is why nothing after the first level has to know
 * what a triangle is: subdividing is quads all the way down.
 *
 * Four decisions run through the module.
 *
 * Everything is measured before anything moves. A vertex’s new place is worked out from where its
 * neighbours were, not from where they are going, so the whole level is computed into three lists
 * and only then written back. Half a level applied to itself is not a smoother surface, it is a
 * different one.
 *
 * The rim is not the middle. An edge carrying one face keeps its own midpoint, and a vertex on the
 * rim follows the cubic B-spline of the rim rather than the surface, so an open sheet keeps its
 * outline instead of shrinking away from it. Under “keep corners” a vertex with only two edges,
 * both of them on the rim, is a corner of that outline and does not move at all.
 *
 * A crease sharpens rather than switches. A crease drags an edge point from the smooth rule back
 * towards the plain midpoint, and a vertex with two creased edges follows the crease the way a rim
 * vertex follows the rim; three or more make it a corner and it stays put. A crease of one is
 * exact, and — as OpenSubdiv has it — it is the one strength that survives every level, the rest
 * wearing away by a tenth each time.
 *
 * And the work is bounded before it is done. Four faces come out of every one, so one level too
 * many is not slow, it is fatal: the count is arithmetic, it is done first, and the modifier
 * refuses by naming the level that crossed the line.
 */

/** What this refuses to build past. Blender will happily try; a browser tab will not survive it. */
const FACE_LIMIT = 2_000_000

const NO_FACES = 'Subdivision surface needs faces; this mesh has none.'

const BOUNDARY_SMOOTH = ['all', 'keep-corners'] as const

type SubsurfParams = {
  levels: number
  renderLevels: number
  simple: boolean
  optimalDisplay: boolean
  boundarySmooth: string
  useCreases: boolean
}

/** The three switches that change the arithmetic, read once and carried down every level. */
type Rules = { simple: boolean; keepCorners: boolean; creases: boolean }

function lerp(from: Vec3, to: Vec3, t: number): Vec3 {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]
}

/**
 * Everything a level reads off the mesh before it writes anything back over it.
 *
 * The same four facts about an edge are wanted once by its own point and again by each of its two
 * ends, and the adjacency answers with a fresh little array every time it is asked. Reading them
 * once into flat lists is what keeps a level’s cost in the arithmetic rather than in the collector.
 */
type Level = {
  facePoints: Vec3[]
  midpoints: Vec3[]
  /** The faces each edge carries: two is the middle of a surface, anything else is a rim. */
  carriers: number[][]
  /** Each edge’s crease, clamped — and already nought where creases are switched off. */
  creases: number[]
  ends: Array<[number, number]>
}

function measure(mesh: EditMesh, rules: Rules): Level {
  const facePoints: Vec3[] = []
  for (let face = 0; face < mesh.faceCount; face += 1) facePoints.push(mesh.faceCentre(face))
  const midpoints: Vec3[] = []
  const carriers: number[][] = []
  const creases: number[] = []
  const ends: Array<[number, number]> = []
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    const pair = mesh.edgeVertices(edge)
    ends.push(pair)
    midpoints.push(scale(add(mesh.position(pair[0]), mesh.position(pair[1])), 0.5))
    carriers.push(mesh.edgeFaces(edge))
    creases.push(rules.creases ? Math.min(1, Math.max(0, mesh.edgeNumber(edge, 'crease'))) : 0)
  }
  return { facePoints, midpoints, carriers, creases, ends }
}

/** The end of an edge that is not the one asked about. */
function farEnd(level: Level, edge: number, from: number): number {
  const [a, b] = level.ends[edge]!
  return a === from ? b : a
}

/**
 * The rule a vertex follows when it sits on a line the surface has to keep — a rim, or a crease.
 * It is the cubic B-spline of that line: six eighths of its own weight, an eighth to each side.
 */
function alongLine(mesh: EditMesh, level: Level, vertex: number, line: number[]): Vec3 {
  const here = mesh.position(vertex)
  const back = mesh.position(farEnd(level, line[0]!, vertex))
  const ahead = mesh.position(farEnd(level, line[1]!, vertex))
  return scale(add(scale(here, 6), add(back, ahead)), 1 / 8)
}

/**
 * Where an original vertex goes.
 *
 * Catmull–Clark’s own weights in the middle of a surface — the average of the face points, twice
 * the average of the edge midpoints, and whatever share of the vertex itself is left over. The rim
 * and the creases override that, because each of them names a curve the surface is not allowed to
 * smooth away.
 */
function movedVertex(mesh: EditMesh, vertex: number, level: Level, rules: Rules): Vec3 {
  const here = mesh.position(vertex)
  if (rules.simple) return here
  const edges = mesh.vertexEdges(vertex)
  const faces = mesh.vertexFaces(vertex)
  if (edges.length < 2 || faces.length === 0) return here

  const rim = edges.filter((edge) => level.carriers[edge]?.length !== 2)
  if (rim.length > 0) {
    // Two rim edges are one rim running through the vertex. Anything else is the mesh meeting
    // itself, which names no curve at all, so the vertex is held where a person put it.
    if (rim.length !== 2) return here
    if (rules.keepCorners && edges.length === 2) return here
    return alongLine(mesh, level, vertex, rim)
  }

  const valence = edges.length
  if (valence < 3) return here
  let faceSum: Vec3 = [0, 0, 0]
  for (const face of faces) faceSum = add(faceSum, level.facePoints[face] ?? here)
  let edgeSum: Vec3 = [0, 0, 0]
  for (const edge of edges) edgeSum = add(edgeSum, level.midpoints[edge] ?? here)
  const smooth = scale(
    add(
      add(scale(faceSum, 1 / faces.length), scale(edgeSum, 2 / valence)),
      scale(here, valence - 3),
    ),
    1 / valence,
  )

  const creased = edges.filter((edge) => (level.creases[edge] ?? 0) > 0)
  if (creased.length < 2) return smooth
  let strength = 0
  for (const edge of creased) strength += level.creases[edge] ?? 0
  strength = Math.min(1, strength / creased.length)
  // Two creased edges are a crease passing through; three or more are the point where creases
  // cross, and a crossing is a corner rather than a curve.
  const sharp = creased.length === 2 ? alongLine(mesh, level, vertex, creased) : here
  return lerp(smooth, sharp, strength)
}

/** Where the vertex that splits an edge goes. */
function movedEdge(mesh: EditMesh, edge: number, level: Level, rules: Rules): Vec3 {
  const middle = level.midpoints[edge]!
  const carriers = level.carriers[edge]!
  // A rim edge, and a seam where more than two faces meet, both keep their own midpoint: neither
  // has the pair of face points the smooth rule averages with.
  if (rules.simple || carriers.length !== 2) return middle
  const [a, b] = level.ends[edge]!
  const smooth = scale(
    add(
      add(mesh.position(a), mesh.position(b)),
      add(level.facePoints[carriers[0]!] ?? middle, level.facePoints[carriers[1]!] ?? middle),
    ),
    0.25,
  )
  const crease = level.creases[edge] ?? 0
  return crease <= 0 ? smooth : lerp(smooth, middle, crease)
}

/**
 * What a crease is worth on the level below. OpenSubdiv spends a tenth of one per level, so a
 * half-creased edge is sharp for five levels and smooth after them; a crease of one is the
 * infinite crease, and it never wears out.
 */
function childCrease(crease: number): number {
  return crease >= 1 ? 1 : Math.max(0, crease - 0.1)
}

/** One whole Catmull–Clark step, written over the mesh it read. */
function subdivideOnce(mesh: EditMesh, rules: Rules): void {
  const faceCount = mesh.faceCount
  const edgeCount = mesh.edgeCount
  const vertexCount = mesh.vertexCount

  const level = measure(mesh, rules)
  const edgePoints: Vec3[] = []
  for (let edge = 0; edge < edgeCount; edge += 1) edgePoints.push(movedEdge(mesh, edge, level, rules))
  const vertexPoints: Vec3[] = []
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    vertexPoints.push(movedVertex(mesh, vertex, level, rules))
  }

  const facePointSlots = level.facePoints.map((point) => mesh.addVertex(point))
  const edgePointSlots = edgePoints.map((point) => mesh.addVertex(point))
  for (let vertex = 0; vertex < vertexCount; vertex += 1) mesh.setPosition(vertex, vertexPoints[vertex]!)

  const spent: number[] = []
  for (let face = 0; face < faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    const rim = mesh.faceEdges(face)
    if (loop.length < 3 || rim.length !== loop.length) continue
    spent.push(face)
    for (let corner = 0; corner < loop.length; corner += 1) {
      const ahead = edgePointSlots[rim[corner]!]!
      const behind = edgePointSlots[rim[(corner + loop.length - 1) % loop.length]!]!
      const quad = mesh.addFace([loop[corner]!, ahead, facePointSlots[face]!, behind])
      if (quad >= 0) mesh.copyFaceAttributes(face, quad)
    }
  }

  // Both halves of an edge inherit what it carried, and the edges inside a face carry nothing —
  // which is what keeps a seam a seam and a sharp edge sharp all the way down.
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const [a, b] = level.ends[edge]!
    const middle = edgePointSlots[edge]!
    const seam = mesh.edgeFlag(edge, 'seam')
    const sharp = mesh.edgeFlag(edge, 'sharp')
    const crease = childCrease(mesh.edgeNumber(edge, 'crease'))
    const weight = mesh.edgeNumber(edge, 'bevelWeight')
    for (const half of [mesh.edgeSlot(a, middle), mesh.edgeSlot(middle, b)]) {
      if (half < 0) continue
      if (seam) mesh.setEdgeFlag(half, 'seam', true)
      if (sharp) mesh.setEdgeFlag(half, 'sharp', true)
      if (crease > 0) mesh.setEdgeNumber(half, 'crease', crease)
      if (weight > 0) mesh.setEdgeNumber(half, 'bevelWeight', weight)
    }
  }

  // The removal goes last, because it renumbers every slot the plan above was drawn in — and it is
  // one call rather than two: every original edge is spanned by its own two halves now, and asking
  // for the edges as well as the faces pays for one renumbering instead of a removal and a sweep.
  const originalEdges: number[] = []
  for (let edge = 0; edge < edgeCount; edge += 1) originalEdges.push(edge)
  mesh.remove({ faces: spent, edges: originalEdges })
}

/** How many faces a level ends with: one per corner at the first, four per face at every one after. */
function facesAtLevel(corners: number, level: number): number {
  return corners * 4 ** (level - 1)
}

function tooDense(level: number, faces: number): string {
  if (level <= 1) {
    return `Subdivision stops at two million faces: one level of this mesh would build ${faces}, so it is already too dense to subdivide.`
  }
  return `Subdivision stops at two million faces: level ${level} would build ${faces}. Use level ${level - 1} or fewer.`
}

export const subsurfModifier = defineModifier<SubsurfParams>({
  kind: 'subsurf',
  label: 'Subdivision surface',
  category: 'generate',
  description: 'Smooth the mesh by Catmull–Clark subdivision, keeping its rims and its creases.',
  icon: 'modifier-subsurf',
  defaults: {
    levels: 1,
    renderLevels: 2,
    simple: false,
    optimalDisplay: false,
    boundarySmooth: 'all',
    useCreases: true,
  },
  schema: [
    numberParam('levels', 'Levels viewport', { min: 0, max: 6, step: 1, defaultValue: 1, view: 'stepper' }),
    numberParam('renderLevels', 'Render', { min: 0, max: 6, step: 1, defaultValue: 2, view: 'stepper' }),
    switchParam('simple', 'Simple', false),
    // Nothing here reads this one. Optimal display is about which edges the viewport draws over the
    // result, not about the result, so the module carries the switch and the viewport obeys it.
    switchParam('optimalDisplay', 'Optimal display', false),
    selectParam('boundarySmooth', 'Boundary smooth', [
      { value: 'all', label: 'All' },
      { value: 'keep-corners', label: 'Keep corners' },
    ], 'all'),
    switchParam('useCreases', 'Use creases', true),
  ],
  apply: (mesh, params, context) => {
    if (mesh.faceCount === 0) return NO_FACES
    const levels = context.forRender
      ? wholeOf(params.renderLevels, 2, 0, 6)
      : wholeOf(params.levels, 1, 0, 6)
    if (levels === 0) return undefined

    let corners = 0
    for (let face = 0; face < mesh.faceCount; face += 1) corners += mesh.faceVertices(face).length
    for (let level = 1; level <= levels; level += 1) {
      const built = facesAtLevel(corners, level)
      if (built > FACE_LIMIT) return tooDense(level, built)
    }

    const rules: Rules = {
      simple: switchOf(params.simple, false),
      keepCorners: chosenOf(params.boundarySmooth, BOUNDARY_SMOOTH, 'all') === 'keep-corners',
      creases: switchOf(params.useCreases, true),
    }
    for (let level = 0; level < levels; level += 1) subdivideOnce(mesh, rules)
    return undefined
  },
})
