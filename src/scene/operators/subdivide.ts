import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, cross, dot, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import {
  edgeLimitPoint,
  pointAlongSmoothEdge,
  realNumber,
  wholeNumber,
} from '@/scene/operators/loopCut'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, selectParam, switchParam, type OperatorParams } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Everything that cuts a face into smaller faces, and the two operators that put it back.
 *
 * Subdivide, un-subdivide, poke, triangulate, tris to quads, rotate edge and the two edge splits
 * all work the same way underneath: a face is read, a set of loops is worked out for it, and the
 * face is rewritten as the first of them while the rest are minted beside it with its material and
 * its shading. Nothing here removes geometry until the very end of an operator, because a removal
 * renumbers every slot in the mesh and the plans were all drawn in slots.
 *
 * Two decisions run through the file and are worth stating plainly.
 *
 * The first is what `smoothness` means. Blender's subdivide only offsets the vertices it creates,
 * which leaves the corners of a cube exactly where they were; the roadmap asks for a cube that
 * subdivides towards a sphere, and that needs the corners to move too. So smoothness here blends
 * from the plain linear cut towards a full Catmull–Clark step — new edge vertices onto the edge
 * point, the original corners onto the vertex point — and it only moves a corner whose whole fan is
 * being subdivided, so a partial subdivide never drags the rest of the mesh with it.
 *
 * The second is that a face the patterns do not name is left as an n-gon rather than guessed at.
 * A quad with two cut edges has four named shapes and gets one of them; a quad with three does not,
 * so with “Create n-gons” on it simply keeps its new corners, and with it off it is fanned into
 * triangles. Inventing a pattern nobody asked for is how a subdivide ends up with slivers in it.
 */

/* ------------------------------------------------------------------ refusals */

const NOTHING_TO_CUT = 'Select an edge, or two vertices that share one.'
const NOTHING_TO_COARSEN = 'This mesh has nothing left to un-subdivide.'
const ALREADY_TRIANGLES = 'Every selected face is already a triangle.'
const NO_PAIRS = 'No two selected triangles are close enough to join.'
const NO_PAIRED_FACES = 'Rotating an edge needs two faces sharing it.'
const ALREADY_APART = 'Every selected edge is already a boundary.'
const CANNOT_PART = 'These edges cannot come apart on their own: split a whole loop of them.'
const NOTHING_SHARP = 'No edge here is sharp enough to split.'

/** Blender's ceiling on the cuts of one subdivide, and enough to keep a mistyped field harmless. */
const MAX_CUTS = 32

const DEGREES = Math.PI / 180

/* ------------------------------------------------------------ small geometry */

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function midpointOf(mesh: EditMesh, edge: number): Vec3 {
  const [a, b] = mesh.edgeVertices(edge)
  if (a < 0 || b < 0) return [0, 0, 0]
  return scale(add(mesh.position(a), mesh.position(b)), 0.5)
}

/** The angle at `here` between the two neighbours, in radians; 0 where the corner has collapsed. */
function cornerAngle(previous: Vec3, here: Vec3, next: Vec3): number {
  const back = subtract(previous, here)
  const ahead = subtract(next, here)
  const sizes = length(back) * length(ahead)
  if (sizes <= 0) return 0
  return Math.acos(Math.min(1, Math.max(-1, dot(back, ahead) / sizes)))
}

/** The two axes to keep when flattening a polygon, chosen so it never collapses to a line. */
function flatAxes(normal: Vec3): [number, number] {
  const x = Math.abs(normal[0])
  const y = Math.abs(normal[1])
  const z = Math.abs(normal[2])
  if (z >= x && z >= y) return [0, 1]
  if (x >= y) return [1, 2]
  return [2, 0]
}

/**
 * A deterministic number in [0, 1) from a seed and a key. `Math.random` would make the redo panel
 * lie: pressing F9 and changing nothing has to give the mesh back exactly as it was.
 */
function noise(seed: number, key: number, channel: number): number {
  let state = (Math.imul(seed + 1, 0x27d4eb2d) ^ Math.imul(key + 1, 0x165667b1) ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0
  state = Math.imul(state ^ (state >>> 15), 1 | state)
  state ^= state + Math.imul(state ^ (state >>> 7), 61 | state)
  return ((state ^ (state >>> 14)) >>> 0) / 4294967296
}

/* -------------------------------------------------------- writing faces back */

/**
 * Replaces one face with a set of loops: the first keeps the face's id, its material and its
 * shading, and the rest are minted beside it carrying the same. Answers the slots it left behind,
 * or an empty list when the first loop was not one a face could be made from.
 */
function rewriteFace(mesh: EditMesh, face: number, loops: number[][]): number[] {
  const first = loops[0]
  if (!first || first.length < 3) return []
  if (!mesh.setFaceLoop(face, first)) return []
  const made = [face]
  for (let index = 1; index < loops.length; index += 1) {
    const added = mesh.addFace(loops[index]!)
    if (added < 0) continue
    mesh.copyFaceAttributes(face, added)
    made.push(added)
  }
  return made
}

/* ============================================================== subdivide ==== */

type SubdivideParams = OperatorParams & {
  cuts: number
  smoothness: number
  quadCorner: string
  ngon: boolean
  fractal: number
  alongNormal: number
  seed: number
}

/** Everything one edge of the mesh contributed: where it ran, and the vertices put along it. */
type EdgeCut = { ends: [number, number]; points: number[] }

/** One face as it was before anything was split, which is the only form the patterns can read. */
type FacePlan = { face: number; loop: number[]; edges: number[]; cut: boolean[]; whole: boolean }

/**
 * The edges a subdivide acts on: the selected ones, every edge of a selected face, and every edge
 * whose two ends are both selected — which is what “an edge is selected” means in vertex mode.
 */
function edgesToCut(target: EditTarget): Set<number> {
  const mesh = target.mesh
  const edges = new Set(target.edges)
  for (const face of target.faces) for (const edge of mesh.faceEdges(face)) edges.add(edge)
  if (target.vertices.size > 1) {
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      const [a, b] = mesh.edgeVertices(edge)
      if (target.vertices.has(a) && target.vertices.has(b)) edges.add(edge)
    }
  }
  return edges
}

/**
 * Where a Catmull–Clark step would put each vertex and each edge's middle, read from the mesh
 * before anything is cut.
 *
 * A corner only gets a limit of its own when every face and every edge around it is part of the
 * subdivision: moving a corner that half the mesh still shares would pull a crease across the part
 * nobody asked to subdivide.
 */
function limitTargets(mesh: EditMesh, cut: Set<number>): { vertex: Map<number, Vec3>; edge: Map<number, Vec3> } {
  const whole = new Set<number>()
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (mesh.faceEdges(face).every((edge) => cut.has(edge))) whole.add(face)
  }
  const edge = new Map<number, Vec3>()
  for (const slot of cut) {
    const faces = mesh.edgeFaces(slot)
    const smooth = faces.length === 2 && faces.every((face) => whole.has(face))
    edge.set(slot, smooth ? edgeLimitPoint(mesh, slot) : midpointOf(mesh, slot))
  }
  const vertex = new Map<number, Vec3>()
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const around = mesh.vertexFaces(slot)
    const spokes = mesh.vertexEdges(slot)
    // As many faces as edges is what an interior vertex of a closed fan looks like; a boundary
    // vertex always carries one edge more, and stays exactly where it is.
    if (around.length < 3 || around.length !== spokes.length) continue
    if (!around.every((face) => whole.has(face)) || !spokes.every((slot) => cut.has(slot))) continue
    let faceSum: Vec3 = [0, 0, 0]
    for (const face of around) faceSum = add(faceSum, mesh.faceCentre(face))
    let edgeSum: Vec3 = [0, 0, 0]
    for (const spoke of spokes) edgeSum = add(edgeSum, midpointOf(mesh, spoke))
    const valence = spokes.length
    const here = mesh.position(slot)
    vertex.set(slot, scale(add(
      add(scale(faceSum, 1 / valence), scale(scale(edgeSum, 1 / valence), 2)),
      scale(here, valence - 3),
    ), 1 / valence))
  }
  return { vertex, edge }
}

/**
 * Puts `cuts` evenly spaced vertices along every edge named, and answers them in order.
 *
 * `splitEdges` puts one vertex on an edge, so several cuts are several rounds — and each round
 * splits what is left of the edge after the last, which is why its parameter is rescaled into the
 * remaining span. Doing every edge of a round in one call is not an optimisation: a split removes
 * the edge it worked on, and slots held across that would be wrong.
 */
function cutEdgesEvenly(mesh: EditMesh, edges: number[], cuts: number): Map<number, EdgeCut> {
  const table = new Map<number, EdgeCut>()
  const ends = edges.map((edge) => mesh.edgeVertices(edge))
  const heads = ends.map(([head]) => head)
  for (let index = 0; index < edges.length; index += 1) {
    table.set(edges[index]!, { ends: ends[index]!, points: [] })
  }
  for (let round = 1; round <= cuts; round += 1) {
    const already = (round - 1) / (cuts + 1)
    const local = (round / (cuts + 1) - already) / (1 - already)
    const requests: Array<{ edge: number; t: number }> = []
    for (let index = 0; index < edges.length; index += 1) {
      const slot = mesh.edgeSlot(heads[index]!, ends[index]![1])
      if (slot < 0) return new Map()
      // A split is measured along the edge as it is stored, low slot first; the cuts are ordered
      // from the end the caller named, so the parameter is turned round when they disagree.
      const forward = mesh.edgeVertices(slot)[0] === heads[index]
      requests.push({ edge: slot, t: forward ? local : 1 - local })
    }
    const created = mesh.splitEdges(requests)
    if (created.length !== requests.length) return new Map()
    for (let index = 0; index < created.length; index += 1) {
      table.get(edges[index]!)!.points.push(created[index]!)
      heads[index] = created[index]!
    }
  }
  return table
}

/** The vertices an edge gained, ordered from the corner asked for rather than from its low slot. */
function pointsFrom(table: Map<number, EdgeCut>, edge: number, from: number): number[] {
  const entry = table.get(edge)
  if (!entry) return []
  return entry.ends[0] === from ? entry.points : [...entry.points].reverse()
}

/** A face's corners with each cut edge's new vertices threaded in, which is the loop it now has. */
function expandLoop(plan: FacePlan, table: Map<number, EdgeCut>): number[] {
  const loop: number[] = []
  for (let corner = 0; corner < plan.loop.length; corner += 1) {
    loop.push(plan.loop[corner]!)
    if (plan.cut[corner]) loop.push(...pointsFrom(table, plan.edges[corner]!, plan.loop[corner]!))
  }
  return loop
}

/**
 * A quad cut on every side becomes a regular grid of quads. The corners of the grid are the face's
 * own, its sides are the vertices the edges gained, and the inside is a Coons patch of the four —
 * which is a plain bilinear grid when nothing has been smoothed, and follows the smoothed sides
 * when something has.
 */
function gridLoops(mesh: EditMesh, plan: FacePlan, table: Map<number, EdgeCut>, cuts: number, made: number[]): number[][] {
  const span = cuts + 1
  const [first, second, third, fourth] = plan.loop as [number, number, number, number]
  const bottom = pointsFrom(table, plan.edges[0]!, first)
  const right = pointsFrom(table, plan.edges[1]!, second)
  const top = pointsFrom(table, plan.edges[2]!, third)
  const left = pointsFrom(table, plan.edges[3]!, fourth)
  if (bottom.length !== cuts || right.length !== cuts || top.length !== cuts || left.length !== cuts) return []
  const grid: number[][] = []
  for (let column = 0; column <= span; column += 1) grid.push(new Array<number>(span + 1).fill(-1))
  grid[0]![0] = first
  grid[span]![0] = second
  grid[span]![span] = third
  grid[0]![span] = fourth
  for (let step = 1; step <= cuts; step += 1) {
    grid[step]![0] = bottom[step - 1]!
    grid[span]![step] = right[step - 1]!
    grid[step]![span] = top[cuts - step]!
    grid[0]![step] = left[cuts - step]!
  }
  const corners = [mesh.position(first), mesh.position(second), mesh.position(third), mesh.position(fourth)]
  for (let column = 1; column <= cuts; column += 1) {
    for (let row = 1; row <= cuts; row += 1) {
      const u = column / span
      const v = row / span
      const alongV = add(
        scale(mesh.position(grid[column]![0]!), 1 - v),
        scale(mesh.position(grid[column]![span]!), v),
      )
      const alongU = add(
        scale(mesh.position(grid[0]![row]!), 1 - u),
        scale(mesh.position(grid[span]![row]!), u),
      )
      const bilinear = add(
        add(scale(corners[0]!, (1 - u) * (1 - v)), scale(corners[1]!, u * (1 - v))),
        add(scale(corners[2]!, u * v), scale(corners[3]!, (1 - u) * v)),
      )
      const slot = mesh.addVertex(subtract(add(alongV, alongU), bilinear))
      made.push(slot)
      grid[column]![row] = slot
    }
  }
  const loops: number[][] = []
  for (let column = 0; column < span; column += 1) {
    for (let row = 0; row < span; row += 1) {
      loops.push([grid[column]![row]!, grid[column + 1]![row]!, grid[column + 1]![row + 1]!, grid[column]![row + 1]!])
    }
  }
  return loops
}

/** A triangle cut on every side becomes a regular lattice of triangles: four of them for one cut. */
function triangleLoops(mesh: EditMesh, plan: FacePlan, table: Map<number, EdgeCut>, cuts: number, made: number[]): number[][] {
  const span = cuts + 1
  const [first, second, third] = plan.loop as [number, number, number]
  const along = pointsFrom(table, plan.edges[0]!, first)
  const across = pointsFrom(table, plan.edges[1]!, second)
  const back = pointsFrom(table, plan.edges[2]!, third)
  if (along.length !== cuts || across.length !== cuts || back.length !== cuts) return []
  const lattice = new Map<number, number>()
  const at = (column: number, row: number): number => lattice.get(column * (span + 1) + row) ?? -1
  const put = (column: number, row: number, slot: number): void => { lattice.set(column * (span + 1) + row, slot) }
  put(0, 0, first)
  put(span, 0, second)
  put(0, span, third)
  for (let step = 1; step <= cuts; step += 1) {
    put(step, 0, along[step - 1]!)
    put(span - step, step, across[step - 1]!)
    put(0, span - step, back[step - 1]!)
  }
  const corners = [mesh.position(first), mesh.position(second), mesh.position(third)]
  for (let column = 1; column <= cuts; column += 1) {
    for (let row = 1; column + row <= cuts; row += 1) {
      const u = column / span
      const v = row / span
      const slot = mesh.addVertex(add(
        scale(corners[0]!, 1 - u - v),
        add(scale(corners[1]!, u), scale(corners[2]!, v)),
      ))
      made.push(slot)
      put(column, row, slot)
    }
  }
  const loops: number[][] = []
  for (let column = 0; column <= cuts; column += 1) {
    for (let row = 0; column + row <= cuts; row += 1) {
      loops.push([at(column, row), at(column + 1, row), at(column, row + 1)])
      if (column + row < cuts) loops.push([at(column + 1, row), at(column + 1, row + 1), at(column, row + 1)])
    }
  }
  return loops.every((loop) => loop.every((slot) => slot >= 0)) ? loops : []
}

/** A quad cut on two facing sides becomes a ladder of quads, however many cuts there were. */
function ladderLoops(plan: FacePlan, table: Map<number, EdgeCut>, start: number, cuts: number): number[][] {
  const loop = plan.loop
  const first = loop[start]!
  const second = loop[(start + 1) % 4]!
  const third = loop[(start + 2) % 4]!
  const fourth = loop[(start + 3) % 4]!
  const near = pointsFrom(table, plan.edges[start]!, first)
  const far = pointsFrom(table, plan.edges[(start + 2) % 4]!, third)
  if (near.length !== cuts || far.length !== cuts) return []
  const rail = [first, ...near, second]
  const opposite = [fourth, ...[...far].reverse(), third]
  const loops: number[][] = []
  for (let step = 0; step <= cuts; step += 1) {
    loops.push([rail[step]!, rail[step + 1]!, opposite[step + 1]!, opposite[step]!])
  }
  return loops
}

/**
 * The four shapes Blender names for a quad with two neighbouring sides cut, given the corner
 * between them as `second` and the new vertices as `near` and `far`.
 *
 * These follow the shapes the names describe rather than Blender's index tables, which are not
 * published as a specification: an inner vertex where the two cuts would meet, a path of two cuts
 * across the face, one straight cut leaving an n-gon, and a fan of triangles from the far corner.
 */
function cornerLoops(
  mesh: EditMesh,
  corners: [number, number, number, number],
  near: number,
  far: number,
  kind: string,
  ngon: boolean,
  made: number[],
): number[][] {
  const [first, second, third, fourth] = corners
  if (kind === 'inner-vertex') {
    const inner = mesh.addVertex(subtract(add(mesh.position(near), mesh.position(far)), mesh.position(second)))
    made.push(inner)
    return [[near, second, far, inner], [near, inner, fourth, first], [inner, far, third, fourth]]
  }
  if (kind === 'path') {
    return [[near, second, far], [far, third, fourth], [fourth, first, near, far]]
  }
  if (kind === 'fan') {
    return [[fourth, first, near], [fourth, near, second], [fourth, second, far], [fourth, far, third]]
  }
  const straight: number[][] = [[near, second, far]]
  if (ngon) straight.push([near, far, third, fourth, first])
  else straight.push([near, far, third, fourth], [near, fourth, first])
  return straight
}

/** A face nothing else names, cut into triangles from the corner with the most untouched sides. */
function fanLoops(plan: FacePlan, table: Map<number, EdgeCut>): number[][] {
  let apex = 0
  let best = -1
  for (let corner = 0; corner < plan.loop.length; corner += 1) {
    const quiet = (plan.cut[corner] ? 0 : 1) + (plan.cut[(corner + plan.loop.length - 1) % plan.loop.length] ? 0 : 1)
    if (quiet > best) {
      best = quiet
      apex = corner
    }
  }
  const loop = expandLoop(plan, table)
  const start = loop.indexOf(plan.loop[apex]!)
  if (start < 0) return []
  const ordered = [...loop.slice(start), ...loop.slice(0, start)]
  const loops: number[][] = []
  for (let step = 1; step + 1 < ordered.length; step += 1) {
    loops.push([ordered[0]!, ordered[step]!, ordered[step + 1]!])
  }
  return loops
}

/** The loops one face becomes, or an empty list when it is to be left exactly as `splitEdges` left it. */
function subdividedLoops(
  mesh: EditMesh,
  plan: FacePlan,
  table: Map<number, EdgeCut>,
  cuts: number,
  quadCorner: string,
  ngon: boolean,
  made: number[],
): number[][] {
  const sides = plan.loop.length
  if (plan.whole) {
    if (sides === 4) return gridLoops(mesh, plan, table, cuts, made)
    if (sides === 3) return triangleLoops(mesh, plan, table, cuts, made)
    const centre = mesh.addVertex(mesh.median(plan.loop))
    made.push(centre)
    if (cuts === 1) {
      const loops: number[][] = []
      for (let corner = 0; corner < sides; corner += 1) {
        const behind = (corner + sides - 1) % sides
        const ahead = pointsFrom(table, plan.edges[corner]!, plan.loop[corner]!)[0]
        const back = pointsFrom(table, plan.edges[behind]!, plan.loop[behind]!)[0]
        if (ahead === undefined || back === undefined) return []
        loops.push([plan.loop[corner]!, ahead, centre, back])
      }
      return loops
    }
    // More than one cut round an n-gon has no quad pattern; a fan from the centre is well formed
    // and keeps every new vertex, which a coarser answer would throw away.
    const loop = expandLoop(plan, table)
    return loop.map((slot, index) => [slot, loop[(index + 1) % loop.length]!, centre])
  }
  const marked = plan.cut.reduce((total, flag) => total + (flag ? 1 : 0), 0)
  if (sides === 4 && marked === 2) {
    const first = plan.cut.indexOf(true)
    const second = plan.cut.lastIndexOf(true)
    if (second === first + 2) return ladderLoops(plan, table, first, cuts)
    if (cuts === 1) {
      const corner = second === first + 1 ? first : 3
      const rotated: [number, number, number, number] = [
        plan.loop[corner]!,
        plan.loop[(corner + 1) % 4]!,
        plan.loop[(corner + 2) % 4]!,
        plan.loop[(corner + 3) % 4]!,
      ]
      const near = pointsFrom(table, plan.edges[corner]!, rotated[0])[0]
      const far = pointsFrom(table, plan.edges[(corner + 1) % 4]!, rotated[1])[0]
      if (near === undefined || far === undefined) return []
      return cornerLoops(mesh, rotated, near, far, quadCorner, ngon, made)
    }
  }
  return ngon ? [] : fanLoops(plan, table)
}

function runSubdivide(target: EditTarget, params: SubdivideParams): EditOutcome {
  const mesh = target.mesh
  const cut = edgesToCut(target)
  if (cut.size === 0) return NOTHING_TO_CUT
  const cuts = wholeNumber(params.cuts, 1, 1, MAX_CUTS)
  const smoothness = realNumber(params.smoothness, 0, 0, 1)
  const ngon = params.ngon !== false
  const quadCorner = typeof params.quadCorner === 'string' ? params.quadCorner : 'straight-cut'

  const limits = limitTargets(mesh, cut)
  const moved: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const here = mesh.position(slot)
    const limit = limits.vertex.get(slot)
    moved.push(limit && smoothness !== 0 ? lerp(here, limit, smoothness) : here)
  }
  const plans: FacePlan[] = []
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const edges = mesh.faceEdges(face)
    const flags = edges.map((edge) => cut.has(edge))
    if (!flags.some(Boolean)) continue
    plans.push({ face, loop: mesh.faceVertices(face), edges, cut: flags, whole: flags.every(Boolean) })
  }
  const order = [...cut].sort((a, b) => a - b)
  const table = cutEdgesEvenly(mesh, order, cuts)
  if (table.size !== order.length) return NOTHING_TO_CUT

  const fresh: number[] = []
  for (const edge of order) {
    const entry = table.get(edge)!
    const start = moved[entry.ends[0]] ?? mesh.position(entry.ends[0])
    const finish = moved[entry.ends[1]] ?? mesh.position(entry.ends[1])
    const limit = limits.edge.get(edge) ?? scale(add(start, finish), 0.5)
    for (let step = 0; step < entry.points.length; step += 1) {
      const slot = entry.points[step]!
      mesh.setPosition(slot, pointAlongSmoothEdge(start, finish, limit, (step + 1) / (cuts + 1), smoothness))
      fresh.push(slot)
    }
  }
  if (smoothness !== 0) {
    for (const [slot, limit] of limits.vertex) mesh.setPosition(slot, lerp(mesh.position(slot), limit, smoothness))
  }
  for (const plan of plans) {
    const loops = subdividedLoops(mesh, plan, table, cuts, quadCorner, ngon, fresh)
    if (loops.length > 0) rewriteFace(mesh, plan.face, loops)
  }

  const fractal = realNumber(params.fractal, 0, 0, 1000)
  if (fractal > 0) {
    const seed = wholeNumber(params.seed, 0, 0, 1e9)
    const alongNormal = realNumber(params.alongNormal, 0, 0, 1)
    let total = 0
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) total += mesh.edgeLength(edge)
    const size = mesh.edgeCount > 0 ? total / mesh.edgeCount : 1
    for (const slot of fresh) {
      const key = mesh.vertexId(slot)
      const random: Vec3 = [
        noise(seed, key, 0) - 0.5,
        noise(seed, key, 1) - 0.5,
        noise(seed, key, 2) - 0.5,
      ]
      const straight = normalize(random)
      const direction = alongNormal > 0
        ? normalize(add(scale(straight, 1 - alongNormal), scale(mesh.vertexNormal(slot), alongNormal)))
        : straight
      const amount = fractal * size * (noise(seed, key, 3) * 2 - 1)
      mesh.setPosition(slot, add(mesh.position(slot), scale(direction, amount)))
    }
  }

  const chosen = new Set<number>(fresh)
  for (const slot of target.vertices) chosen.add(slot)
  for (const edge of target.edges) for (const end of mesh.edgeVertices(edge)) if (end >= 0) chosen.add(end)
  for (const face of target.faces) for (const corner of mesh.faceVertices(face)) chosen.add(corner)
  return { select: selectionAround(mesh, chosen) }
}

/** Everything wholly inside a set of vertices: what Blender leaves selected after a cut. */
function selectionAround(mesh: EditMesh, vertices: Set<number>): { vertices: number[]; edges: number[]; faces: number[] } {
  const edges: number[] = []
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    const [a, b] = mesh.edgeVertices(edge)
    if (a >= 0 && b >= 0 && vertices.has(a) && vertices.has(b)) edges.push(edge)
  }
  const faces: number[] = []
  for (let face = 0; face < mesh.faceCount; face += 1) {
    if (mesh.faceVertices(face).every((corner) => vertices.has(corner))) faces.push(face)
  }
  return { vertices: [...vertices], edges, faces }
}

registerOperator<SubdivideParams>({
  id: 'mesh.subdivide',
  label: 'Subdivide',
  section: 'Edge',
  icon: 'knife',
  description: 'Cut every selected edge, and the faces around them, into smaller ones.',
  params: [
    numberParam('cuts', 'Cuts', { min: 1, max: MAX_CUTS, step: 1, defaultValue: 1, view: 'stepper' }),
    numberParam('smoothness', 'Smoothness', { min: 0, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    selectParam('quadCorner', 'Quad corner type', [
      { value: 'inner-vertex', label: 'Inner vertex' },
      { value: 'path', label: 'Path' },
      { value: 'straight-cut', label: 'Straight cut' },
      { value: 'fan', label: 'Fan' },
    ], 'straight-cut'),
    switchParam('ngon', 'Create n-gons', true),
    numberParam('fractal', 'Fractal', { min: 0, max: 1000, step: 0.01, defaultValue: 0, view: 'bar' }),
    numberParam('alongNormal', 'Along normal', { min: 0, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    numberParam('seed', 'Seed', { min: 0, max: 1e9, step: 1, defaultValue: 0, view: 'seed' }),
  ],
  defaults: {
    cuts: 1,
    smoothness: 0,
    quadCorner: 'straight-cut',
    ngon: true,
    fractal: 0,
    alongNormal: 0,
    seed: 0,
  },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => runSubdivide(target, params), { label: 'Subdivide' }),
})

/* ============================================================ un-subdivide ==== */

type UnsubdivideParams = OperatorParams & { iterations: number }

/**
 * The vertices a subdivision would have added, told apart from the ones it started with.
 *
 * A vertex a subdivide created is never a diagonal or a side away from another one it created, so
 * the coarse mesh is a largest independent set in the graph of *all* pairs of corners of a face —
 * sides and diagonals together. Taking the least connected vertices first picks the original
 * corners of a subdivided grid, which is exactly the set that has to survive.
 */
function coarseVertices(mesh: EditMesh): Set<number> {
  const near: Array<Set<number>> = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) near.push(new Set())
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    for (let index = 0; index < loop.length; index += 1) {
      for (let other = index + 1; other < loop.length; other += 1) {
        near[loop[index]!]!.add(loop[other]!)
        near[loop[other]!]!.add(loop[index]!)
      }
    }
  }
  const order = near.map((_, slot) => slot).sort((a, b) => near[a]!.size - near[b]!.size || a - b)
  const keep = new Set<number>()
  const blocked = new Set<number>()
  for (const slot of order) {
    if (blocked.has(slot) || near[slot]!.size === 0) continue
    keep.add(slot)
    for (const other of near[slot]!) blocked.add(other)
  }
  return keep
}

/** One level taken back off, on a mesh alone: the operator repeats it, and so does the modifier. */
export function unsubdivideOnce(mesh: EditMesh): boolean {
  const keep = coarseVertices(mesh)
  if (keep.size === 0 || keep.size === mesh.vertexCount) return false
  // Two faces belong to the same coarse face when the edge between them is one a subdivide would
  // have created — both of its ends among the vertices going away.
  const groups: number[][] = []
  const seen = new Set<number>()
  for (let start = 0; start < mesh.faceCount; start += 1) {
    if (seen.has(start)) continue
    const group = [start]
    seen.add(start)
    for (let index = 0; index < group.length; index += 1) {
      for (const edge of mesh.faceEdges(group[index]!)) {
        const [a, b] = mesh.edgeVertices(edge)
        if (keep.has(a) || keep.has(b)) continue
        for (const face of mesh.edgeFaces(edge)) {
          if (seen.has(face)) continue
          seen.add(face)
          group.push(face)
        }
      }
    }
    if (group.length > 1) groups.push(group)
  }
  if (groups.length === 0) return false
  const byId = groups.map((group) => group.map((face) => mesh.faceId(face)))
  let merged = 0
  for (const ids of byId) {
    const slots: number[] = []
    for (const id of ids) {
      const slot = mesh.slotOfFace(id)
      if (slot >= 0) slots.push(slot)
    }
    if (slots.length < 2) continue
    const survivor = mesh.joinFaces(slots)
    if (survivor < 0) continue
    const rim = mesh.faceVertices(survivor).filter((slot) => keep.has(slot))
    if (rim.length < 3 || !mesh.setFaceLoop(survivor, rim)) continue
    merged += 1
  }
  if (merged === 0) return false
  const gone: number[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    if (!keep.has(slot) && mesh.vertexFaces(slot).length === 0) gone.push(slot)
  }
  if (gone.length > 0) mesh.remove({ vertices: gone })
  return true
}

registerOperator<UnsubdivideParams>({
  id: 'mesh.unsubdivide',
  label: 'Un-subdivide',
  section: 'Edge',
  icon: 'mesh',
  description: 'Take a level of subdivision back off, merging faces four at a time.',
  params: [numberParam('iterations', 'Iterations', { min: 1, max: 8, step: 1, defaultValue: 1, view: 'stepper' })],
  defaults: { iterations: 1 },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(context, (target) => {
    const rounds = wholeNumber(params.iterations, 1, 1, 8)
    let done = 0
    for (let round = 0; round < rounds; round += 1) {
      if (!unsubdivideOnce(target.mesh)) break
      done += 1
    }
    if (done === 0) return NOTHING_TO_COARSEN
    // Un-subdivide works on the whole mesh, so what is left of it is what is left selected.
    const all = new Set<number>()
    for (let slot = 0; slot < target.mesh.vertexCount; slot += 1) all.add(slot)
    return { select: selectionAround(target.mesh, all) }
  }, { label: 'Un-subdivide' }),
})

/* =================================================================== poke ==== */

type PokeParams = OperatorParams & { offset: number; useRelative: boolean; centerMode: string }

/** Where a poke puts its new vertex before the offset moves it off the face. */
function pokeCentre(mesh: EditMesh, face: number, mode: string): Vec3 {
  const loop = mesh.faceVertices(face)
  if (mode === 'bounds') return mesh.boundsOf(loop).centre
  if (mode !== 'median-weighted') return mesh.median(loop)
  // Weighting each corner by the two sides meeting there pulls the centre towards the long side
  // of a stretched face, which is what keeps its fan of triangles from collapsing into slivers.
  let weight = 0
  let sum: Vec3 = [0, 0, 0]
  for (let index = 0; index < loop.length; index += 1) {
    const here = mesh.position(loop[index]!)
    const behind = mesh.position(loop[(index + loop.length - 1) % loop.length]!)
    const ahead = mesh.position(loop[(index + 1) % loop.length]!)
    const share = (length(subtract(here, behind)) + length(subtract(ahead, here))) / 2
    sum = add(sum, scale(here, share))
    weight += share
  }
  return weight > 0 ? scale(sum, 1 / weight) : mesh.median(loop)
}

registerOperator<PokeParams>({
  id: 'mesh.poke',
  label: 'Poke faces',
  section: 'Face',
  icon: 'mesh',
  description: 'Split each selected face into a fan of triangles from a new centre vertex.',
  params: [
    numberParam('offset', 'Offset', { min: -100, max: 100, step: 0.01, defaultValue: 0, unit: 'm' }),
    switchParam('useRelative', 'Offset relative', false),
    selectParam('centerMode', 'Centre', [
      { value: 'median', label: 'Median' },
      { value: 'median-weighted', label: 'Weighted median' },
      { value: 'bounds', label: 'Bounds centre' },
    ], 'median'),
  ],
  defaults: { offset: 0, useRelative: false, centerMode: 'median' },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    if (target.faces.size === 0) return null
    const offset = realNumber(params.offset, 0, -100, 100)
    const mode = typeof params.centerMode === 'string' ? params.centerMode : 'median'
    const centres: number[] = []
    for (const face of [...target.faces].sort((a, b) => a - b)) {
      const loop = mesh.faceVertices(face)
      if (loop.length < 3) continue
      const relative = params.useRelative === true && loop.length > 0 ? mesh.facePerimeter(face) / loop.length : 1
      const centre = add(pokeCentre(mesh, face, mode), scale(mesh.faceNormal(face), offset * relative))
      const slot = mesh.addVertex(centre)
      centres.push(slot)
      const loops = loop.map((corner, index) => [slot, corner, loop[(index + 1) % loop.length]!])
      rewriteFace(mesh, face, loops)
    }
    if (centres.length === 0) return null
    const chosen = new Set(centres)
    for (const centre of centres) for (const face of mesh.vertexFaces(centre)) {
      for (const corner of mesh.faceVertices(face)) chosen.add(corner)
    }
    return { select: selectionAround(mesh, chosen) }
  }, { label: 'Poke faces' }),
})

/* ============================================================ triangulate ==== */

type TriangulateParams = OperatorParams & { quadMethod: string; ngonMethod: string }

/** The smallest angle in a triangle, which is the measure both beauty passes try to raise. */
function worstAngle(points: Vec3[], triple: number[]): number {
  const [a, b, c] = triple as [number, number, number]
  return Math.min(
    cornerAngle(points[c]!, points[a]!, points[b]!),
    cornerAngle(points[a]!, points[b]!, points[c]!),
    cornerAngle(points[b]!, points[c]!, points[a]!),
  )
}

/** Whether a corner of the flattened polygon turns the way the polygon as a whole does. */
function turnsForward(flat: Array<[number, number]>, previous: number, here: number, next: number): number {
  const back = flat[here]!
  const first = flat[previous]!
  const second = flat[next]!
  return (back[0] - first[0]) * (second[1] - back[1]) - (back[1] - first[1]) * (second[0] - back[0])
}

/** Ear clipping on the polygon flattened onto its own plane: Blender's “clip” n-gon method. */
function clipEars(points: Vec3[], normal: Vec3): number[][] {
  const [first, second] = flatAxes(normal)
  const flat: Array<[number, number]> = points.map((point) => [point[first]!, point[second]!])
  let area = 0
  for (let index = 0; index < flat.length; index += 1) {
    const here = flat[index]!
    const ahead = flat[(index + 1) % flat.length]!
    area += here[0] * ahead[1] - ahead[0] * here[1]
  }
  const sign = area >= 0 ? 1 : -1
  const remaining = points.map((_, index) => index)
  const triples: number[][] = []
  let guard = points.length * points.length
  while (remaining.length > 3 && guard > 0) {
    guard -= 1
    let clipped = false
    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index + remaining.length - 1) % remaining.length]!
      const here = remaining[index]!
      const next = remaining[(index + 1) % remaining.length]!
      if (turnsForward(flat, previous, here, next) * sign <= 0) continue
      if (remaining.some((other) => other !== previous && other !== here && other !== next
        && insideTriangle(flat, previous, here, next, other, sign))) continue
      triples.push([previous, here, next])
      remaining.splice(index, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  for (let index = 1; index + 1 < remaining.length; index += 1) {
    triples.push([remaining[0]!, remaining[index]!, remaining[index + 1]!])
  }
  return triples
}

function insideTriangle(
  flat: Array<[number, number]>,
  a: number,
  b: number,
  c: number,
  point: number,
  sign: number,
): boolean {
  const corners: Array<[number, number]> = [flat[a]!, flat[b]!, flat[c]!]
  const here = flat[point]!
  for (let index = 0; index < 3; index += 1) {
    const from = corners[index]!
    const to = corners[(index + 1) % 3]!
    const side = (to[0] - from[0]) * (here[1] - from[1]) - (to[1] - from[1]) * (here[0] - from[0])
    if (side * sign < 0) return false
  }
  return true
}

/**
 * Blender's “beauty”: the triangles are clipped first, then every interior diagonal is turned
 * whenever turning it raises the smallest angle of the pair. It stops when nothing improves, so a
 * fan of slivers becomes a well-shaped triangulation without any triangle count changing.
 */
function beautify(triples: number[][], points: Vec3[], normal: Vec3): number[][] {
  const result = triples.map((triple) => [...triple])
  for (let pass = 0; pass < points.length + 4; pass += 1) {
    let turned = false
    const owners = new Map<string, number[]>()
    for (let index = 0; index < result.length; index += 1) {
      const triple = result[index]!
      for (let corner = 0; corner < 3; corner += 1) {
        const a = triple[corner]!
        const b = triple[(corner + 1) % 3]!
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        const list = owners.get(key)
        if (list) list.push(index)
        else owners.set(key, [index])
      }
    }
    for (const [key, list] of owners) {
      if (list.length !== 2) continue
      const [left, right] = list as [number, number]
      const parts = key.split('|').map(Number)
      const near = parts[0]!
      const far = parts[1]!
      const forward = result[left]!.indexOf(near) >= 0 && result[left]![(result[left]!.indexOf(near) + 1) % 3] === far
      const head = forward ? near : far
      const tail = forward ? far : near
      const apex = result[left]!.find((slot) => slot !== near && slot !== far)
      const other = result[right]!.find((slot) => slot !== near && slot !== far)
      if (apex === undefined || other === undefined || apex === other) continue
      const before = Math.min(worstAngle(points, [head, tail, apex]), worstAngle(points, [tail, head, other]))
      const after = Math.min(worstAngle(points, [apex, head, other]), worstAngle(points, [other, tail, apex]))
      if (after <= before + 1e-9) continue
      const first = [apex, head, other]
      const second = [other, tail, apex]
      if (dot(cross(subtract(points[head]!, points[apex]!), subtract(points[other]!, points[apex]!)), normal) <= 0) continue
      if (dot(cross(subtract(points[tail]!, points[other]!), subtract(points[apex]!, points[other]!)), normal) <= 0) continue
      result[left] = first
      result[right] = second
      turned = true
      break
    }
    if (!turned) break
  }
  return result
}

/** The triangles one face becomes, as corner indices into its own loop. */
function faceTriples(mesh: EditMesh, face: number, quadMethod: string, ngonMethod: string): number[][] {
  const loop = mesh.faceVertices(face)
  const points = loop.map((slot) => mesh.position(slot))
  const normal = mesh.faceNormal(face)
  if (loop.length === 4) {
    if (quadMethod === 'fixed') return [[0, 1, 2], [0, 2, 3]]
    if (quadMethod === 'alternate') return [[1, 2, 3], [1, 3, 0]]
    if (quadMethod === 'beauty') {
      const across = Math.min(worstAngle(points, [0, 1, 2]), worstAngle(points, [0, 2, 3]))
      const other = Math.min(worstAngle(points, [1, 2, 3]), worstAngle(points, [1, 3, 0]))
      return across >= other ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]]
    }
    const across = length(subtract(points[2]!, points[0]!))
    const other = length(subtract(points[3]!, points[1]!))
    return across <= other ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]]
  }
  const clipped = clipEars(points, normal)
  return ngonMethod === 'clip' ? clipped : beautify(clipped, points, normal)
}

registerOperator<TriangulateParams>({
  id: 'mesh.triangulate',
  label: 'Triangulate faces',
  section: 'Face',
  shortcut: '⌃T',
  icon: 'mesh',
  description: 'Cut every selected face into triangles.',
  params: [
    selectParam('quadMethod', 'Quad method', [
      { value: 'beauty', label: 'Beauty' },
      { value: 'fixed', label: 'Fixed' },
      { value: 'alternate', label: 'Alternate' },
      { value: 'shortest-diagonal', label: 'Shortest diagonal' },
    ], 'shortest-diagonal'),
    selectParam('ngonMethod', 'N-gon method', [
      { value: 'beauty', label: 'Beauty' },
      { value: 'clip', label: 'Clip' },
    ], 'beauty'),
  ],
  defaults: { quadMethod: 'shortest-diagonal', ngonMethod: 'beauty' },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    const quadMethod = typeof params.quadMethod === 'string' ? params.quadMethod : 'shortest-diagonal'
    const ngonMethod = typeof params.ngonMethod === 'string' ? params.ngonMethod : 'beauty'
    const wanted = [...target.faces].filter((face) => mesh.faceVertices(face).length > 3).sort((a, b) => a - b)
    if (wanted.length === 0) return ALREADY_TRIANGLES
    const made: number[] = []
    for (const face of wanted) {
      const loop = mesh.faceVertices(face)
      const loops = faceTriples(mesh, face, quadMethod, ngonMethod)
        .map((triple) => triple.map((corner) => loop[corner]!))
      made.push(...rewriteFace(mesh, face, loops))
    }
    const chosen = new Set<number>()
    for (const face of made) for (const corner of mesh.faceVertices(face)) chosen.add(corner)
    return { select: selectionAround(mesh, chosen) }
  }, { label: 'Triangulate faces' }),
})

/* =========================================================== tris to quads ==== */

type TrisToQuadsParams = OperatorParams & { faceAngle: number; shapeAngle: number; compareMaterials: boolean }

/** Two triangles either side of an edge, and how good the quad they would make is. */
type Pairing = { left: number; right: number; edge: number; loop: number[]; cost: number }

/**
 * The quad two triangles would make, and what it would cost.
 *
 * Cost is the fold between the two triangles plus the worst that any of the quad's four corners
 * misses a right angle: a pair that is flat and square costs nothing, and the greedy pass takes
 * the cheapest first, which is what makes a triangulated grid come back as the grid it was.
 */
function pairingFor(mesh: EditMesh, edge: number, faceAngle: number, shapeAngle: number, compareMaterials: boolean): Pairing | null {
  const faces = mesh.edgeFaces(edge)
  if (faces.length !== 2) return null
  const [left, right] = faces as [number, number]
  const leftLoop = mesh.faceVertices(left)
  const rightLoop = mesh.faceVertices(right)
  if (leftLoop.length !== 3 || rightLoop.length !== 3) return null
  if (compareMaterials && mesh.faceMaterial(left) !== mesh.faceMaterial(right)) return null
  const [near, far] = mesh.edgeVertices(edge)
  const head = mesh.loopNext(left, near) === far ? near : far
  const tail = head === near ? far : near
  const apex = leftLoop.find((slot) => slot !== near && slot !== far)
  const other = rightLoop.find((slot) => slot !== near && slot !== far)
  if (apex === undefined || other === undefined) return null
  const fold = mesh.dihedral(edge)
  if (fold > faceAngle) return null
  const loop = [tail, apex, head, other]
  const points = loop.map((slot) => mesh.position(slot))
  const normal = mesh.faceNormal(left)
  let worst = 0
  for (let index = 0; index < 4; index += 1) {
    const previous = points[(index + 3) % 4]!
    const here = points[index]!
    const next = points[(index + 1) % 4]!
    // A reflex corner is a quad that folds back on itself, which no shape angle should let through.
    if (dot(cross(subtract(here, previous), subtract(next, here)), normal) <= 0) return null
    worst = Math.max(worst, Math.abs(cornerAngle(previous, here, next) - Math.PI / 2))
  }
  if (worst > shapeAngle) return null
  return { left, right, edge, loop, cost: worst + fold }
}

registerOperator<TrisToQuadsParams>({
  id: 'mesh.trisToQuads',
  label: 'Tris to quads',
  section: 'Face',
  shortcut: '⌥J',
  icon: 'mesh',
  description: 'Join neighbouring selected triangles back into quads, the best pairs first.',
  params: [
    numberParam('faceAngle', 'Max face angle', { min: 0, max: 180, step: 1, defaultValue: 40, unit: '°', view: 'angle' }),
    numberParam('shapeAngle', 'Max shape angle', { min: 0, max: 180, step: 1, defaultValue: 40, unit: '°', view: 'angle' }),
    switchParam('compareMaterials', 'Compare materials', false),
  ],
  defaults: { faceAngle: 40, shapeAngle: 40, compareMaterials: false },
  mode: 'edit',
  available: (context) => requireEdit(context, 'face'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    const faceAngle = realNumber(params.faceAngle, 40, 0, 180) * DEGREES
    const shapeAngle = realNumber(params.shapeAngle, 40, 0, 180) * DEGREES
    const compareMaterials = params.compareMaterials === true
    const pairings: Pairing[] = []
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      const faces = mesh.edgeFaces(edge)
      if (faces.length !== 2 || !faces.every((face) => target.faces.has(face))) continue
      const pairing = pairingFor(mesh, edge, faceAngle, shapeAngle, compareMaterials)
      if (pairing) pairings.push(pairing)
    }
    if (pairings.length === 0) return NO_PAIRS
    pairings.sort((a, b) => a.cost - b.cost || a.edge - b.edge)
    const used = new Set<number>()
    const dead = new Set<number>()
    const gone = new Set<number>()
    const kept: number[] = []
    for (const pairing of pairings) {
      if (used.has(pairing.left) || used.has(pairing.right)) continue
      if (!mesh.setFaceLoop(pairing.left, pairing.loop)) continue
      used.add(pairing.left)
      used.add(pairing.right)
      dead.add(pairing.right)
      gone.add(pairing.edge)
      kept.push(pairing.left)
    }
    if (dead.size === 0) return NO_PAIRS
    const chosen = new Set<number>()
    for (const face of kept) for (const corner of mesh.faceVertices(face)) chosen.add(corner)
    mesh.remove({ faces: dead, edges: gone })
    const slots = new Set<number>()
    for (const slot of chosen) if (mesh.hasVertex(slot)) slots.add(slot)
    return { select: selectionAround(mesh, slots) }
  }, { label: 'Tris to quads' }),
})

/* ============================================================ rotate edge ==== */

type RotateEdgeParams = OperatorParams & { direction: string }

registerOperator<RotateEdgeParams>({
  id: 'mesh.rotateEdge',
  label: 'Rotate edge',
  section: 'Edge',
  shortcut: '⌃E',
  icon: 'rotate',
  description: 'Swing each selected edge onto the next pair of corners of the two faces it joins.',
  params: [
    selectParam('direction', 'Direction', [
      { value: 'cw', label: 'Clockwise' },
      { value: 'ccw', label: 'Counter-clockwise' },
    ], 'cw'),
  ],
  defaults: { direction: 'cw' },
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    const step = params.direction === 'ccw' ? -1 : 1
    // Edges are held by their ends: the rim is rewritten face by face, and the edges that fall out
    // of use are only removed at the end, when nothing is holding a slot any more.
    const wanted = [...target.edges].sort((a, b) => a - b).map((slot) => mesh.edgeVertices(slot))
    const stale = new Set<number>()
    const turned: number[] = []
    for (const [near, far] of wanted) {
      const edge = mesh.edgeSlot(near, far)
      if (edge < 0 || mesh.edgeFaces(edge).length !== 2) continue
      const [left, right] = mesh.edgeFaces(edge) as [number, number]
      const rim = mesh.boundaryLoops([left, right])[0]
      if (!rim || rim.length < 4) continue
      const from = rim.indexOf(near)
      const to = rim.indexOf(far)
      if (from < 0 || to < 0) continue
      const head = rim[(from + step + rim.length) % rim.length]!
      const tail = rim[(to + step + rim.length) % rim.length]!
      if (head === tail) continue
      const first = sliceRim(rim, head, tail)
      const second = sliceRim(rim, tail, head)
      if (first.length < 3 || second.length < 3) continue
      if (!mesh.setFaceLoop(left, first) || !mesh.setFaceLoop(right, second)) continue
      stale.add(edge)
      const made = mesh.edgeSlot(head, tail)
      if (made >= 0) turned.push(made)
    }
    if (turned.length === 0) return NO_PAIRED_FACES
    // The new edges are named by their ends across the removal, which renumbers every edge slot.
    const ends = turned.map((slot) => mesh.edgeVertices(slot))
    const dead = [...stale].filter((slot) => mesh.edgeFaces(slot).length === 0)
    if (dead.length > 0) mesh.remove({ edges: dead })
    const edges: number[] = []
    const vertices = new Set<number>()
    for (const [a, b] of ends) {
      const slot = mesh.edgeSlot(a, b)
      if (slot < 0) continue
      edges.push(slot)
      vertices.add(a)
      vertices.add(b)
    }
    return { select: { vertices: [...vertices], edges } }
  }, { label: 'Rotate edge' }),
})

/** The run of a rim from one vertex round to another, both ends included. */
function sliceRim(rim: number[], from: number, to: number): number[] {
  const start = rim.indexOf(from)
  if (start < 0) return []
  const run: number[] = []
  for (let step = 0; step < rim.length; step += 1) {
    const slot = rim[(start + step) % rim.length]!
    run.push(slot)
    if (slot === to) return run
  }
  return []
}

/* ============================================================= edge split ==== */

/** The faces round one vertex, grouped by what still holds them together once the splits are made. */
function fanGroups(mesh: EditMesh, vertex: number, split: Set<number>): number[][] {
  const around = new Set(mesh.vertexFaces(vertex))
  const seen = new Set<number>()
  const groups: number[][] = []
  for (const start of around) {
    if (seen.has(start)) continue
    const group = [start]
    seen.add(start)
    for (let index = 0; index < group.length; index += 1) {
      for (const edge of mesh.faceEdges(group[index]!)) {
        const [a, b] = mesh.edgeVertices(edge)
        if ((a !== vertex && b !== vertex) || split.has(edge)) continue
        for (const face of mesh.edgeFaces(edge)) {
          if (!around.has(face) || seen.has(face)) continue
          seen.add(face)
          group.push(face)
        }
      }
    }
    groups.push(group)
  }
  return groups
}

/**
 * Pulls the faces apart along a set of edges.
 *
 * The work is per vertex rather than per edge: an edge comes apart because each side of it gets its
 * own copy of both its ends, and which faces share a copy is decided by what is *not* being split —
 * the faces still joined by a whole edge at that vertex keep the vertex they had.
 */
function splitAlongEdges(mesh: EditMesh, split: Set<number>): number[] {
  const touched = new Set<number>()
  for (const edge of split) for (const end of mesh.edgeVertices(edge)) if (end >= 0) touched.add(end)
  const copies: number[] = []
  for (const vertex of [...touched].sort((a, b) => a - b)) {
    const groups = fanGroups(mesh, vertex, split)
    if (groups.length < 2) continue
    for (let index = 1; index < groups.length; index += 1) {
      const copy = mesh.addVertex(mesh.position(vertex))
      copies.push(copy)
      for (const face of groups[index]!) {
        mesh.setFaceLoop(face, mesh.faceVertices(face).map((slot) => (slot === vertex ? copy : slot)))
      }
    }
  }
  return copies
}

/** What an edge split leaves selected, by id, because dropping the loose edges renumbers slots. */
function finishSplit(mesh: EditMesh, touched: Set<number>, copies: number[]): EditOutcome {
  const ids = [...touched, ...copies].map((slot) => mesh.vertexId(slot))
  mesh.dropLoose()
  const chosen = new Set<number>()
  for (const id of ids) {
    const slot = mesh.slotOfVertex(id)
    if (slot >= 0) chosen.add(slot)
  }
  return { select: selectionAround(mesh, chosen) }
}

registerOperator({
  id: 'mesh.edgeSplit',
  label: 'Edge split',
  section: 'Edge',
  icon: 'rip',
  description: 'Double the selected edges so the faces along them come apart.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'edge'),
  run: (context) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    const split = new Set([...target.edges].filter((edge) => mesh.edgeFaces(edge).length === 2))
    if (split.size === 0) return ALREADY_APART
    const touched = new Set<number>()
    for (const edge of split) for (const end of mesh.edgeVertices(edge)) if (end >= 0) touched.add(end)
    const copies = splitAlongEdges(mesh, split)
    // An edge in the middle of a surface would have to become two edges between the same pair of
    // vertices, which this mesh cannot hold; a loop, a ring or a border of edges parts cleanly.
    if (copies.length === 0) return CANNOT_PART
    return finishSplit(mesh, touched, copies)
  }, { label: 'Edge split' }),
})

type EdgeSplitBySharpParams = OperatorParams & { angle: number; useSharpEdges: boolean; useEdgeAngle: boolean }

registerOperator<EdgeSplitBySharpParams>({
  id: 'mesh.edgeSplitBySharp',
  label: 'Edge split by sharp',
  section: 'Edge',
  icon: 'rip',
  description: 'Pull the faces apart along every edge marked sharp, or folded past the angle.',
  params: [
    numberParam('angle', 'Edge angle', { min: 0, max: 180, step: 1, defaultValue: 30, unit: '°', view: 'angle' }),
    switchParam('useSharpEdges', 'Sharp edges', true),
    switchParam('useEdgeAngle', 'Edge angle', true),
  ],
  defaults: { angle: 30, useSharpEdges: true, useEdgeAngle: true },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(context, (target) => {
    const mesh = target.mesh
    const angle = realNumber(params.angle, 30, 0, 180) * DEGREES
    const bySharp = params.useSharpEdges !== false
    const byAngle = params.useEdgeAngle !== false
    const split = new Set<number>()
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      if (mesh.edgeFaces(edge).length !== 2) continue
      if ((bySharp && mesh.edgeFlag(edge, 'sharp')) || (byAngle && mesh.dihedral(edge) > angle)) split.add(edge)
    }
    if (split.size === 0) return NOTHING_SHARP
    const touched = new Set<number>()
    for (const edge of split) for (const end of mesh.edgeVertices(edge)) if (end >= 0) touched.add(end)
    const copies = splitAlongEdges(mesh, split)
    if (copies.length === 0) return NOTHING_SHARP
    return finishSplit(mesh, touched, copies)
  }, { label: 'Edge split by sharp' }),
})
