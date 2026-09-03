import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, cross, dot, length, normalize, subtract } from '@/scene/mesh/normals'
import { triangulateFace } from '@/scene/mesh/triangulate'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam } from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Closing what is open: fill, beauty fill, grid fill and fill holes.
 *
 * All four start from the same question — where are the rims? A rim is a cycle of edges that could
 * still carry a face: a boundary edge with one face on it, or a wire edge with none. The cycle is
 * wound *against* the face already sitting on it, because a new face has to run their shared edge
 * the other way round; wound the same way, the two faces would look opposite ways and the seam
 * would draw as a crack.
 *
 * The rim walk, the pairing of two rims and the band of quads between them are exported from here.
 * Bridge needs exactly those three, and an operator family has no shared module of its own to put
 * them in — so they live where they were first needed and are imported from there, rather than
 * being written twice and drifting apart.
 */

/** Below this a length is rounding noise rather than a distance. */
const NEARLY_ZERO = 1e-9

const NO_RIM = 'Select a rim of edges to close, or two vertices to join.'

/* --------------------------------------------------------------- the rims */

/** Edges a new face could still be built on: fewer than two faces, and both ends selected. */
export function fillableEdges(target: EditTarget): Set<number> {
  const vertices = selectedVertices(target)
  const edges = new Set<number>()
  for (let edge = 0; edge < target.mesh.edgeCount; edge += 1) {
    if (target.mesh.edgeFaces(edge).length >= 2) continue
    const [a, b] = target.mesh.edgeVertices(edge)
    if (a < 0 || b < 0) continue
    if (vertices.has(a) && vertices.has(b)) edges.add(edge)
  }
  return edges
}

/**
 * The closed cycles a set of edges makes, each wound so that a face built on it agrees with the
 * face already there. Chains that do not close, and cycles that touch themselves, are dropped:
 * neither is a rim a face can be laid across.
 *
 * The rims that carry a face and the ones made of wire are walked apart from each other. A rim edge
 * has a direction — the face on it runs it one way, so the face being laid on it runs it the other
 * — and following those directed steps gives the cycle and its winding in one go, and gives the
 * same answer however the edges were numbered. Wire has no direction to follow, so it is walked
 * undirected, and a stray wire edge hanging off a rim can no longer send that walk down it. The
 * cost of splitting them is that a cycle made of both — a hole half bounded by faces and half by
 * wire — is found by neither walk, which is a rim nobody draws on purpose.
 */
export function loopsOf(mesh: EditMesh, edges: Iterable<number>): number[][] {
  const rim: number[] = []
  const wire: number[] = []
  for (const edge of edges) {
    if (!mesh.hasEdge(edge)) continue
    const faces = mesh.edgeFaces(edge).length
    if (faces === 1) rim.push(edge)
    else if (faces === 0) wire.push(edge)
  }
  return [...rimLoops(mesh, rim), ...wireLoops(mesh, wire)]
}

function rimLoops(mesh: EditMesh, edges: number[]): number[][] {
  const onward = new Map<number, number[]>()
  for (const edge of edges) {
    const face = mesh.edgeFaces(edge)[0]
    if (face === undefined) continue
    const [a, b] = mesh.edgeVertices(edge)
    const from = mesh.loopNext(face, a) === b ? b : a
    const to = from === a ? b : a
    const list = onward.get(from)
    if (list) list.push(to)
    else onward.set(from, [to])
  }
  const used = new Set<string>()
  const loops: number[][] = []
  for (const [start, targets] of onward) {
    for (const first of targets) {
      if (used.has(`${start}>${first}`)) continue
      const loop: number[] = [start]
      let from = start
      let to = first
      for (;;) {
        used.add(`${from}>${to}`)
        if (to === start) break
        loop.push(to)
        const step = (onward.get(to) ?? []).find((candidate) => !used.has(`${to}>${candidate}`))
        if (step === undefined) {
          loop.length = 0
          break
        }
        from = to
        to = step
      }
      if (loop.length >= 3) loops.push(loop)
    }
  }
  return loops
}

function wireLoops(mesh: EditMesh, edges: number[]): number[][] {
  const around = new Map<number, number[]>()
  for (const edge of edges) {
    const [a, b] = mesh.edgeVertices(edge)
    if (a < 0 || b < 0) continue
    for (const end of [a, b]) {
      const list = around.get(end)
      if (list) list.push(edge)
      else around.set(end, [edge])
    }
  }
  const used = new Set<number>()
  const loops: number[][] = []
  for (const start of edges) {
    if (used.has(start)) continue
    const [first, second] = mesh.edgeVertices(start)
    if (first < 0 || second < 0) continue
    used.add(start)
    const loop = [first, second]
    const seen = new Set<number>([first, second])
    let vertex = second
    let closed = false
    for (;;) {
      const onward = (around.get(vertex) ?? []).find((edge) => !used.has(edge))
      if (onward === undefined) break
      used.add(onward)
      const [one, other] = mesh.edgeVertices(onward)
      const ahead = one === vertex ? other : one
      if (ahead === first) {
        closed = true
        break
      }
      if (seen.has(ahead)) break
      seen.add(ahead)
      loop.push(ahead)
      vertex = ahead
    }
    if (closed && loop.length >= 3) loops.push(loop)
  }
  return loops
}

/** Every rim of the mesh itself, which is what fill holes works from. */
function meshRims(mesh: EditMesh): number[][] {
  return loopsOf(mesh, mesh.boundaryEdges())
}

/** A face on a rim, given the material and the shading of whatever it was laid against. */
function mintFace(mesh: EditMesh, loop: number[]): number {
  const face = mesh.addFace(loop)
  if (face < 0) return -1
  for (let index = 0; index < loop.length; index += 1) {
    const edge = mesh.edgeSlot(loop[index]!, loop[(index + 1) % loop.length]!)
    if (edge < 0) continue
    const neighbour = mesh.edgeFaces(edge).find((candidate) => candidate !== face)
    if (neighbour === undefined) continue
    mesh.copyFaceAttributes(neighbour, face)
    return face
  }
  return face
}

/* ------------------------------------------------------- rim against rim */

export function lerp3(from: Vec3, to: Vec3, t: number): Vec3 {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]
}

/**
 * The second rim, re-ordered so that its `index`-th vertex is the one to pair with the first rim's.
 *
 * Two things are settled here. The rims are aligned on the pair of vertices that are closest, which
 * is what a person means by “these two ends belong together”; and the second is walked backwards,
 * because the band between them has to run each rim's shared edge the way that rim is wound —
 * forwards along one is backwards along the other. `twist` steps that pairing round by a vertex.
 */
export function pairRims(mesh: EditMesh, first: number[], second: number[], twist = 0): number[] {
  const count = first.length
  let bestFirst = 0
  let bestSecond = 0
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < count; index += 1) {
    const here = mesh.position(first[index]!)
    for (let other = 0; other < second.length; other += 1) {
      const span = length(subtract(mesh.position(second[other]!), here))
      if (span >= best) continue
      best = span
      bestFirst = index
      bestSecond = other
    }
  }
  const anchor = bestSecond + bestFirst + Math.round(twist)
  return first.map((_, index) => second[(((anchor - index) % count) + count) % count]!)
}

/**
 * A band of quads between two rims already paired, `rows` quads deep. The rings in between are
 * placed by the caller — a bridge curves them, a grid fill runs them straight — which is the only
 * difference between the two.
 */
export function bandBetween(
  mesh: EditMesh,
  first: number[],
  paired: number[],
  rows: number,
  place: (index: number, t: number) => Vec3,
): number[] {
  const count = first.length
  const rings: number[][] = [first]
  for (let row = 1; row < rows; row += 1) {
    const t = row / rows
    rings.push(first.map((_, index) => mesh.addVertex(place(index, t))))
  }
  rings.push(paired)
  const faces: number[] = []
  for (let row = 0; row < rows; row += 1) {
    const near = rings[row]!
    const far = rings[row + 1]!
    for (let index = 0; index < count; index += 1) {
      const ahead = (index + 1) % count
      const face = mintFace(mesh, [near[index]!, near[ahead]!, far[ahead]!, far[index]!])
      if (face >= 0) faces.push(face)
    }
  }
  return faces
}

/* ------------------------------------------------------------------ fill */

function fillRims(target: EditTarget, beauty: boolean): EditOutcome {
  const mesh = target.mesh
  const vertices = selectedVertices(target)
  const loops = loopsOf(mesh, fillableEdges(target))
  if (loops.length === 0) {
    if (vertices.size !== 2) return NO_RIM
    const [a, b] = [...vertices] as [number, number]
    if (mesh.edgeSlot(a, b) >= 0) return 'These two vertices are already joined by an edge.'
    if (mesh.vertexFaces(a).some((face) => mesh.vertexFaces(b).includes(face))) {
      return 'Select two vertices that no face already joins.'
    }
    const edge = mesh.addEdge(a, b)
    return edge < 0 ? NO_RIM : { select: { edges: [edge] } }
  }
  const made: number[] = []
  for (const loop of loops) {
    const face = mintFace(mesh, loop)
    if (face >= 0) made.push(face)
  }
  if (made.length === 0) return NO_RIM
  if (!beauty) return { select: { faces: made } }
  const region = triangulateRegion(mesh, made)
  beautify(mesh, region)
  return { select: { faces: [...region] } }
}

registerOperator({
  id: 'mesh.fill',
  label: 'Fill',
  section: 'Face',
  shortcut: 'F',
  description: 'Close the selected rim with one face, or join two vertices with an edge.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context) => runOnMeshes(context, (target) => fillRims(target, false), { label: 'Fill' }),
})

registerOperator({
  id: 'mesh.beautyFill',
  label: 'Beauty fill',
  section: 'Face',
  shortcut: '⌥F',
  description: 'Close the selected rim with triangles, as near equilateral as the rim allows.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context) => runOnMeshes(context, (target) => fillRims(target, true), { label: 'Beauty fill' }),
})

/* ---------------------------------------------------------- beauty fill */

/** How many sweeps of flipping to allow. Each one only ever improves, so this is a stop, not a plan. */
const BEAUTY_SWEEPS = 8

/** Cuts faces into triangles in place. Nothing is removed, so no slot anybody holds moves. */
function triangulateRegion(mesh: EditMesh, faces: number[]): Set<number> {
  const region = new Set<number>()
  for (const face of faces) {
    const triangles = triangulateFace(mesh.toData(), face)
    region.add(face)
    if (triangles.length === 0) continue
    mesh.setFaceLoop(face, triangles[0]!)
    for (let index = 1; index < triangles.length; index += 1) {
      const added = mesh.addFace(triangles[index]!)
      if (added < 0) continue
      mesh.copyFaceAttributes(face, added)
      region.add(added)
    }
  }
  return region
}

/**
 * Blender's beautify: turn each shared diagonal round while doing so widens the narrowest angle of
 * the two triangles that carry it. That is the Delaunay flip written as a measurement a person can
 * check, and it is why an ear-clipped fan comes out as a fan of near-equilateral triangles instead.
 */
function beautify(mesh: EditMesh, faces: Set<number>): void {
  const vacated: Array<[number, number]> = []
  for (let sweep = 0; sweep < BEAUTY_SWEEPS; sweep += 1) {
    let changed = false
    const edges = new Set<number>()
    for (const face of faces) for (const edge of mesh.faceEdges(face)) edges.add(edge)
    for (const edge of edges) {
      const users = mesh.edgeFaces(edge).filter((face) => faces.has(face))
      if (users.length !== 2) continue
      const left = users[0]!
      const right = users[1]!
      if (mesh.faceVertices(left).length !== 3 || mesh.faceVertices(right).length !== 3) continue
      const [a, b] = alongFace(mesh, left, edge)
      const c = mesh.faceVertices(left).find((slot) => slot !== a && slot !== b)
      const d = mesh.faceVertices(right).find((slot) => slot !== a && slot !== b)
      if (c === undefined || d === undefined || c === d) continue
      if (mesh.edgeSlot(c, d) >= 0) continue
      if (!worthTurning(mesh, a, b, c, d)) continue
      if (!mesh.setFaceLoop(left, [a, d, c])) continue
      mesh.setFaceLoop(right, [d, b, c])
      vacated.push([mesh.vertexId(a), mesh.vertexId(b)])
      changed = true
    }
    if (!changed) break
  }
  const dead = new Set<number>()
  for (const [a, b] of vacated) {
    const edge = mesh.edgeSlot(mesh.slotOfVertex(a), mesh.slotOfVertex(b))
    if (edge >= 0 && mesh.edgeFaces(edge).length === 0) dead.add(edge)
  }
  if (dead.size > 0) mesh.remove({ edges: dead })
}

/** An edge's two ends in the order the face runs them, which is what a flip has to be written in. */
function alongFace(mesh: EditMesh, face: number, edge: number): [number, number] {
  const [one, other] = mesh.edgeVertices(edge)
  return mesh.loopNext(face, one) === other ? [one, other] : [other, one]
}

function worthTurning(mesh: EditMesh, a: number, b: number, c: number, d: number): boolean {
  const first = mesh.position(a)
  const second = mesh.position(b)
  const third = mesh.position(c)
  const fourth = mesh.position(d)
  const before = Math.min(narrowestAngle(first, second, third), narrowestAngle(second, first, fourth))
  const after = Math.min(narrowestAngle(first, fourth, third), narrowestAngle(fourth, second, third))
  if (after <= before + NEARLY_ZERO) return false
  // A quad that folds — reflex at c or at d — has no diagonal to turn to: the two triangles the
  // flip would make face opposite ways, and the surface would crease through itself.
  const reference = add(facing(first, second, third), facing(second, first, fourth))
  return dot(facing(first, fourth, third), reference) > 0 && dot(facing(fourth, second, third), reference) > 0
}

function facing(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return cross(subtract(b, a), subtract(c, a))
}

function narrowestAngle(a: Vec3, b: Vec3, c: Vec3): number {
  return Math.min(angleAt(a, b, c), angleAt(b, c, a), angleAt(c, a, b))
}

function angleAt(corner: Vec3, one: Vec3, other: Vec3): number {
  const first = normalize(subtract(one, corner))
  const second = normalize(subtract(other, corner))
  return Math.acos(Math.min(1, Math.max(-1, dot(first, second))))
}

/* ------------------------------------------------------------- grid fill */

type GridParams = { span: number; offset: number; simpleBlending: boolean }

function gridFill(target: EditTarget, params: GridParams): EditOutcome {
  const mesh = target.mesh
  const loops = loopsOf(mesh, fillableEdges(target))
  if (loops.length === 1) return gridInsideRim(mesh, loops[0]!, params)
  if (loops.length === 2) return gridAcrossRims(mesh, loops[0]!, loops[1]!, params)
  return 'Grid fill works on one rim with an even number of edges, or on two rims of the same length.'
}

/**
 * One closed rim becomes a rectangle of quads: the rim is cut into four sides, two of `span` edges
 * and two of the rest, and the inside is a Coons patch of the four — the surface that meets all
 * four sides exactly rather than a plane stretched over them. Simple blending drops the two side
 * curves and runs straight lines between the opposite ones, which is what Blender's switch does.
 */
function gridInsideRim(mesh: EditMesh, rim: number[], params: GridParams): EditOutcome {
  const total = rim.length
  if (total % 2 !== 0) return 'This rim has an odd number of edges; grid fill needs an even one.'
  const half = total / 2
  if (half < 2) return 'This rim is too small to lay a grid inside.'
  const wanted = Math.round(params.span) > 0 ? Math.round(params.span) : Math.floor(half / 2)
  const columns = Math.min(half - 1, Math.max(1, wanted))
  const rows = half - columns
  const turn = (((Math.round(params.offset) % total) + total) % total)
  const at = (index: number): number => rim[(index + turn) % total]!

  const grid: number[][] = []
  for (let column = 0; column <= columns; column += 1) grid.push(new Array<number>(rows + 1).fill(-1))
  for (let column = 0; column <= columns; column += 1) {
    grid[column]![0] = at(column)
    grid[column]![rows] = at(half + columns - column)
  }
  for (let row = 0; row <= rows; row += 1) {
    grid[columns]![row] = at(columns + row)
    grid[0]![row] = at((total - row) % total)
  }
  for (let column = 1; column < columns; column += 1) {
    for (let row = 1; row < rows; row += 1) {
      grid[column]![row] = mesh.addVertex(
        params.simpleBlending
          ? straightInside(mesh, grid, column, row, rows)
          : coonsInside(mesh, grid, column, row, columns, rows),
      )
    }
  }
  const faces: number[] = []
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const face = mintFace(mesh, [
        grid[column]![row]!,
        grid[column + 1]![row]!,
        grid[column + 1]![row + 1]!,
        grid[column]![row + 1]!,
      ])
      if (face >= 0) faces.push(face)
    }
  }
  return faces.length === 0 ? 'This rim is too small to lay a grid inside.' : { select: { faces } }
}

function straightInside(mesh: EditMesh, grid: number[][], column: number, row: number, rows: number): Vec3 {
  return lerp3(mesh.position(grid[column]![0]!), mesh.position(grid[column]![rows]!), row / rows)
}

function coonsInside(mesh: EditMesh, grid: number[][], column: number, row: number, columns: number, rows: number): Vec3 {
  const u = column / columns
  const v = row / rows
  const top = mesh.position(grid[column]![0]!)
  const bottom = mesh.position(grid[column]![rows]!)
  const left = mesh.position(grid[0]![row]!)
  const right = mesh.position(grid[columns]![row]!)
  const corners: Vec3[] = [
    mesh.position(grid[0]![0]!),
    mesh.position(grid[columns]![0]!),
    mesh.position(grid[0]![rows]!),
    mesh.position(grid[columns]![rows]!),
  ]
  const weights = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v]
  const point: Vec3 = [0, 0, 0]
  for (let axis = 0; axis < 3; axis += 1) {
    let corner = 0
    for (let index = 0; index < corners.length; index += 1) corner += corners[index]![axis]! * weights[index]!
    point[axis] = (1 - v) * top[axis]! + v * bottom[axis]! + (1 - u) * left[axis]! + u * right[axis]! - corner
  }
  return point
}

/** Two rims of the same length become a band `span` quads deep, straight across the gap. */
function gridAcrossRims(mesh: EditMesh, first: number[], second: number[], params: GridParams): EditOutcome {
  if (first.length !== second.length) return 'The two rims must have the same number of edges.'
  const rows = Math.max(1, Math.round(params.span))
  const paired = pairRims(mesh, first, second, params.offset)
  const from = first.map((slot) => mesh.position(slot))
  const to = paired.map((slot) => mesh.position(slot))
  const faces = bandBetween(mesh, first, paired, rows, (index, t) => lerp3(from[index]!, to[index]!, t))
  return faces.length === 0 ? 'The two rims must have the same number of edges.' : { select: { faces } }
}

registerOperator<GridParams>({
  id: 'mesh.gridFill',
  label: 'Grid fill',
  section: 'Face',
  description: 'Lay a grid of quads inside one rim, or across two rims of the same length.',
  params: [
    numberParam('span', 'Span', { min: 0, max: 512, step: 1, defaultValue: 0, view: 'stepper' }),
    numberParam('offset', 'Offset', { min: -512, max: 512, step: 1, defaultValue: 0, view: 'stepper' }),
    switchParam('simpleBlending', 'Simple blending', false),
  ],
  defaults: { span: 0, offset: 0, simpleBlending: false },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => gridFill(target, params), { label: 'Grid fill' }),
})

/* ------------------------------------------------------------ fill holes */

type HoleParams = { sides: number }

function fillHoles(target: EditTarget, sides: number): EditOutcome {
  const mesh = target.mesh
  const limit = Math.max(0, Math.round(sides))
  const rims = meshRims(mesh)
  if (rims.length === 0) return 'There are no holes in this mesh.'
  const faces: number[] = []
  for (const rim of rims) {
    if (limit > 0 && rim.length > limit) continue
    const face = mintFace(mesh, rim)
    if (face >= 0) faces.push(face)
  }
  if (faces.length === 0) return 'Every hole here has more sides than the limit allows.'
  return { select: { faces } }
}

registerOperator<HoleParams>({
  id: 'mesh.fillHoles',
  label: 'Fill holes',
  section: 'Mesh',
  description: 'Close every hole in the mesh with one face, up to the number of sides allowed.',
  params: [numberParam('sides', 'Sides', { min: 0, max: 1000, step: 1, defaultValue: 4, view: 'stepper' })],
  defaults: { sides: 4 },
  mode: 'edit',
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(context, (target) => fillHoles(target, params.sides), { label: 'Fill holes' }),
})
