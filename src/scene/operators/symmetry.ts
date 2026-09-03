import type { EditMesh } from '@/scene/mesh/editMesh'
import { length, normalize, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, selectedVertices, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, selectParam } from '@/scene/operators/types'
import type { SceneObject, Transform, Vec3 } from '@/scene/types'

/**
 * Symmetrize, snap to symmetry, and ⌃M mirror.
 *
 * All three read the same idea from different ends. Symmetrize is topological: it cuts the mesh at
 * the plane, throws the destination half away and mirrors the source half onto it, so the two
 * halves become the same geometry rather than merely similar. Snap to symmetry is metric: the mesh
 * is already nearly symmetrical, and each vertex is pulled towards where its partner’s mirror says
 * it should be. Mirror moves the selection through the plane and leaves everything else alone.
 *
 * `symmetryMap` is the piece they share, and it is exported because the lead’s transform code needs
 * it too: symmetric editing is one lookup from a moved vertex to the vertex that has to move with
 * it. Pairing is by position rather than by topology, which is what makes it survive an edit that
 * was made on one side only — and what makes the threshold matter.
 *
 * Two approximations are deliberate, and are written out at the operators that make them: symmetrize
 * works on the whole mesh being edited rather than on the selection, and mirror turns the selection
 * around its own median rather than around whichever pivot the header names.
 */

/** Under this a threshold is not a distance but a rounding error, and the grid would have no cells. */
const MINIMUM_THRESHOLD = 1e-9

/* ------------------------------------------------------------ the plane */

type Axis = 0 | 1 | 2

/** A direction of symmetry: which axis the plane cuts, and which side of it the geometry comes from. */
type Direction = { axis: Axis; sign: 1 | -1; source: string }

const DIRECTIONS: Record<string, Direction> = {
  '+x-to-x': { axis: 0, sign: 1, source: '+X' },
  'x-to-+x': { axis: 0, sign: -1, source: '−X' },
  '+y-to-y': { axis: 1, sign: 1, source: '+Y' },
  'y-to-+y': { axis: 1, sign: -1, source: '−Y' },
  '+z-to-z': { axis: 2, sign: 1, source: '+Z' },
  'z-to-+z': { axis: 2, sign: -1, source: '−Z' },
}

const DIRECTION_PARAM = selectParam('direction', 'Direction', [
  { value: '+x-to-x', label: '+X to −X' },
  { value: 'x-to-+x', label: '−X to +X' },
  { value: '+y-to-y', label: '+Y to −Y' },
  { value: 'y-to-+y', label: '−Y to +Y' },
  { value: '+z-to-z', label: '+Z to −Z' },
  { value: 'z-to-+z', label: '−Z to +Z' },
], '+x-to-x')

function readDirection(value: unknown): Direction {
  return DIRECTIONS[String(value)] ?? DIRECTIONS['+x-to-x']!
}

/** A number a parameter carried, held inside the range its schema offers; anything else reads as `low`. */
function clamped(value: unknown, low: number, high: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : low
}

function withAxis(point: Vec3, axis: Axis, value: number): Vec3 {
  const next: Vec3 = [point[0], point[1], point[2]]
  next[axis] = value
  return next
}

function mirrored(point: Vec3, axis: Axis): Vec3 {
  return withAxis(point, axis, -point[axis])
}

/* ---------------------------------------------------------- symmetry map */

/**
 * Each vertex to the vertex that mirrors it, by position, within the threshold.
 *
 * A vertex sitting on the plane is its own mirror and is left out, because a caller moving it does
 * not want a second move of the same vertex; a vertex whose mirror is missing is left out too. The
 * search is over a grid of cells one threshold across, so a mesh of twenty thousand vertices costs
 * one pass and twenty-seven cell lookups each rather than a scan per vertex.
 */
export function symmetryMap(mesh: EditMesh, axis: Axis, threshold: number): Map<number, number> {
  const reach = Math.max(threshold, MINIMUM_THRESHOLD)
  const cells = new Map<string, number[]>()
  const cellKey = (point: Vec3): string =>
    `${Math.floor(point[0] / reach)}|${Math.floor(point[1] / reach)}|${Math.floor(point[2] / reach)}`
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const key = cellKey(mesh.position(slot))
    const cell = cells.get(key)
    if (cell) cell.push(slot)
    else cells.set(key, [slot])
  }

  const pairs = new Map<number, number>()
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    if (Math.abs(point[axis]) <= threshold) continue
    const wanted = mirrored(point, axis)
    const base: [number, number, number] = [
      Math.floor(wanted[0] / reach),
      Math.floor(wanted[1] / reach),
      Math.floor(wanted[2] / reach),
    ]
    let partner = -1
    let closest = Number.POSITIVE_INFINITY
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const candidate of cells.get(`${base[0] + dx}|${base[1] + dy}|${base[2] + dz}`) ?? []) {
            if (candidate === slot) continue
            const gap = length(subtract(mesh.position(candidate), wanted))
            if (gap > threshold || gap >= closest) continue
            closest = gap
            partner = candidate
          }
        }
      }
    }
    if (partner >= 0) pairs.set(slot, partner)
  }
  return pairs
}

/* ------------------------------------------------------------- symmetrize */

const THRESHOLD_PARAM = numberParam('threshold', 'Threshold', {
  min: 0,
  max: 1,
  step: 0.001,
  defaultValue: 0.0001,
  unit: 'm',
})

const CROSSED_TWICE =
  'A face crosses the mirror plane in more than two places, so this mesh cannot be symmetrised.'

/**
 * Cuts the mesh at the plane, drops the destination half and mirrors the source half onto it.
 *
 * The cut comes first and in two steps — every crossing edge split at the plane, then every face
 * that still has corners on both sides divided along the two corners now sitting on it — because a
 * half taken away without cutting would take the faces that straddle with it and leave a hole where
 * the mesh used to close. Vertices already within the threshold of the plane are moved onto it
 * exactly, which is what welds the mirrored half to the original one: they are shared corners
 * afterwards rather than a doubled pair.
 *
 * Answers a refusal, or null when the mesh has been symmetrised.
 */
function symmetrise(mesh: EditMesh, direction: Direction, threshold: number): string | null {
  const { axis, sign } = direction
  const side = (slot: number): number => sign * mesh.position(slot)[axis]

  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    const point = mesh.position(slot)
    if (Math.abs(point[axis]) <= threshold) mesh.setPosition(slot, withAxis(point, axis, 0))
  }

  let source = false
  for (let slot = 0; slot < mesh.vertexCount && !source; slot += 1) if (side(slot) > 0) source = true
  if (!source) return `There is nothing on the ${direction.source} side to mirror.`

  const cuts: Array<{ edge: number; t: number }> = []
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    const [a, b] = mesh.edgeVertices(edge)
    const from = side(a)
    const to = side(b)
    if ((from > 0 && to < 0) || (from < 0 && to > 0)) cuts.push({ edge, t: from / (from - to) })
  }
  // Split in one call: each removal renumbers the edges, so cutting them one at a time would be
  // cutting a list of stale numbers after the first.
  for (const fresh of mesh.splitEdges(cuts)) mesh.setPosition(fresh, withAxis(mesh.position(fresh), axis, 0))

  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    if (!loop.some((slot) => side(slot) > 0) || !loop.some((slot) => side(slot) < 0)) continue
    const onPlane = loop.filter((slot) => side(slot) === 0)
    if (onPlane.length !== 2) return CROSSED_TWICE
    if (mesh.splitFace(face, onPlane[0]!, onPlane[1]!) < 0) return CROSSED_TWICE
  }

  const doomed: number[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) if (side(slot) < 0) doomed.push(slot)
  if (doomed.length > 0) mesh.remove({ vertices: doomed })

  const twin = new Map<number, number>()
  const vertices = mesh.vertexCount
  for (let slot = 0; slot < vertices; slot += 1) {
    twin.set(slot, side(slot) > 0 ? mesh.addVertex(mirrored(mesh.position(slot), axis)) : slot)
  }
  const faces = mesh.faceCount
  const edges = mesh.edgeCount
  const wires: Array<[number, number]> = []
  for (let edge = 0; edge < edges; edge += 1) {
    if (mesh.edgeFaces(edge).length === 0) wires.push(mesh.edgeVertices(edge))
  }
  for (let face = 0; face < faces; face += 1) {
    const loop = mesh.faceVertices(face)
    // A face lying in the plane is its own mirror; adding it again would double it exactly.
    if (loop.every((slot) => side(slot) === 0)) continue
    // Reflecting turns a loop inside out, so the mirrored loop is read backwards to face outwards.
    const added = mesh.addFace(loop.map((slot) => twin.get(slot) ?? slot).reverse())
    if (added >= 0) mesh.copyFaceAttributes(face, added)
  }
  for (const [a, b] of wires) mesh.addEdge(twin.get(a) ?? a, twin.get(b) ?? b)
  for (let edge = 0; edge < edges; edge += 1) {
    const [a, b] = mesh.edgeVertices(edge)
    const mirror = mesh.edgeSlot(twin.get(a) ?? a, twin.get(b) ?? b)
    if (mirror < 0 || mirror === edge) continue
    mesh.setEdgeFlag(mirror, 'seam', mesh.edgeFlag(edge, 'seam'))
    mesh.setEdgeFlag(mirror, 'sharp', mesh.edgeFlag(edge, 'sharp'))
    mesh.setEdgeNumber(mirror, 'crease', mesh.edgeNumber(edge, 'crease'))
    mesh.setEdgeNumber(mirror, 'bevelWeight', mesh.edgeNumber(edge, 'bevelWeight'))
  }
  return null
}

/** Every slot of a mesh, which is what an operator that renumbered everything leaves selected. */
function everything(mesh: EditMesh) {
  const range = (count: number): number[] => Array.from({ length: count }, (_, index) => index)
  return { vertices: range(mesh.vertexCount), edges: range(mesh.edgeCount), faces: range(mesh.faceCount) }
}

registerOperator<{ direction: string; threshold: number }>({
  id: 'mesh.symmetrize',
  label: 'Symmetrize',
  section: 'Mesh',
  icon: 'modifier-mirror',
  description: 'Cut the mesh at the plane and mirror one half onto the other, welding what sits on it.',
  params: [DIRECTION_PARAM, THRESHOLD_PARAM],
  defaults: { direction: '+x-to-x', threshold: 0.0001 },
  mode: 'edit',
  // Blender symmetrises the selected geometry; this cuts and mirrors the whole mesh being edited,
  // because a cut that stops halfway through a face leaves the hole this operator exists to avoid.
  // A selection is still what offers it, so the menu entry reads the way Blender’s does.
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => {
    const direction = readDirection(params.direction)
    const threshold = clamped(params.threshold, 0, 1)
    return runOnMeshes(context, (target) => {
      const refusal = symmetrise(target.mesh, direction, threshold)
      if (refusal) return refusal
      // The removal renumbered every slot, so the selection is written out rather than carried: what
      // is left is one symmetrical mesh, and all of it is what a person goes on to work with.
      return { select: everything(target.mesh), active: null }
    }, { label: 'Symmetrize' })
  },
})

/* -------------------------------------------------------- snap to symmetry */

const FACTOR_PARAM = numberParam('factor', 'Factor', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' })

const SNAP_THRESHOLD = numberParam('threshold', 'Threshold', {
  min: 0,
  max: 1,
  step: 0.001,
  defaultValue: 0.05,
  unit: 'm',
})

const NOTHING_TO_SNAP = 'Nothing has a mirror within the threshold, so there is nothing to snap.'

registerOperator<{ direction: string; threshold: number; factor: number }>({
  id: 'mesh.snapToSymmetry',
  label: 'Snap to symmetry',
  section: 'Mesh',
  icon: 'modifier-mirror',
  description: 'Pull each selected vertex towards where its mirror on the other side says it should be.',
  params: [DIRECTION_PARAM, SNAP_THRESHOLD, FACTOR_PARAM],
  defaults: { direction: '+x-to-x', threshold: 0.05, factor: 0.5 },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => {
    const { axis, sign } = readDirection(params.direction)
    const threshold = clamped(params.threshold, 0, 1)
    const factor = clamped(params.factor, 0, 1)
    return runOnMeshes(context, (target) => {
      const chosen = selectedVertices(target)
      if (chosen.size === 0) return null
      const pairs = symmetryMap(target.mesh, axis, threshold)
      // Every move is read off the mesh as it was and applied afterwards, or a vertex already moved
      // would be the partner the next one aims at.
      const moves: Array<[number, Vec3]> = []
      for (const slot of chosen) {
        const point = target.mesh.position(slot)
        if (Math.abs(point[axis]) <= threshold) {
          moves.push([slot, withAxis(point, axis, point[axis] * (1 - factor))])
          continue
        }
        // The source half is the one being copied from, so it is the half that does not move.
        if (sign * point[axis] > 0) continue
        const partner = pairs.get(slot)
        if (partner === undefined) continue
        const wanted = mirrored(target.mesh.position(partner), axis)
        moves.push([slot, [
          point[0] + (wanted[0] - point[0]) * factor,
          point[1] + (wanted[1] - point[1]) * factor,
          point[2] + (wanted[2] - point[2]) * factor,
        ]])
      }
      if (moves.length === 0) return NOTHING_TO_SNAP
      for (const [slot, point] of moves) target.mesh.setPosition(slot, point)
      return {}
    }, { label: 'Snap to symmetry' })
  },
})

/* ------------------------------------------------------------------ mirror */

const AXIS_PARAM = selectParam('axis', 'Axis', [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
], 'x')

const SPACE_PARAM = selectParam('space', 'Orientation', [
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
], 'global')

type Rows = [Vec3, Vec3, Vec3]

const IDENTITY_ROWS: Rows = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

function multiplyRows(a: Rows, b: Rows): Rows {
  const row = (index: 0 | 1 | 2): Vec3 => {
    const left = a[index]
    return [
      left[0] * b[0][0] + left[1] * b[1][0] + left[2] * b[2][0],
      left[0] * b[0][1] + left[1] * b[1][1] + left[2] * b[2][1],
      left[0] * b[0][2] + left[1] * b[1][2] + left[2] * b[2][2],
    ]
  }
  return [row(0), row(1), row(2)]
}

function axisRotation(letter: string, degrees: number): Rows {
  const angle = (degrees * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  if (letter === 'X') return [[1, 0, 0], [0, cosine, -sine], [0, sine, cosine]]
  if (letter === 'Y') return [[cosine, 0, sine], [0, 1, 0], [-sine, 0, cosine]]
  return [[cosine, -sine, 0], [sine, cosine, 0], [0, 0, 1]]
}

/**
 * The object’s rotation as three rows.
 *
 * Written out rather than borrowed from three.js: this is a mesh operator, and the mesh modules are
 * pure so that they can be tested without a renderer. The Euler order is read the way the document
 * names it — 'XYZ' is Rx·Ry·Rz — which is the order three.js applies and so the order the viewport
 * draws.
 */
function rotationRows(transform: Transform): Rows {
  if (transform.rotationMode === 'quaternion') {
    const [x, y, z, w] = transform.quaternion ?? [0, 0, 0, 1]
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
  }
  const order = transform.rotationMode ?? 'XYZ'
  const angles: Record<string, number> = { X: transform.rotation[0], Y: transform.rotation[1], Z: transform.rotation[2] }
  let rows = IDENTITY_ROWS
  for (const letter of order) rows = multiplyRows(rows, axisRotation(letter, angles[letter] ?? 0))
  return rows
}

/**
 * A world axis as a mirror plane seen from inside the object.
 *
 * A plane’s normal does not travel with the geometry: it travels with the transpose of the matrix
 * that carries the geometry. For a transform of a rotation and a scale that transpose is the
 * rotation’s own row, taken component by component against the scale — which is why this is nine
 * multiplications and not a matrix library. The parent chain is not walked, so an object under a
 * rotated parent mirrors about its own world axis rather than the scene’s.
 */
function planeNormal(object: SceneObject, axis: Axis, space: string): Vec3 {
  if (space === 'local') return withAxis([0, 0, 0], axis, 1)
  const row = rotationRows(object.transform)[axis]
  const scale = object.transform.scale
  const pulled: Vec3 = [row[0] * scale[0], row[1] * scale[1], row[2] * scale[2]]
  const normal = normalize(pulled)
  return length(normal) === 0 ? withAxis([0, 0, 0], axis, 1) : normal
}

function reflect(point: Vec3, pivot: Vec3, normal: Vec3): Vec3 {
  const offset = subtract(point, pivot)
  const twice = 2 * (offset[0] * normal[0] + offset[1] * normal[1] + offset[2] * normal[2])
  return [
    point[0] - twice * normal[0],
    point[1] - twice * normal[1],
    point[2] - twice * normal[2],
  ]
}

function mirrorSelection(target: EditTarget, normal: Vec3): boolean {
  const moved = selectedVertices(target)
  if (moved.size === 0) return false
  const pivot = target.mesh.median(moved)
  for (const slot of moved) target.mesh.setPosition(slot, reflect(target.mesh.position(slot), pivot, normal))
  // Reflecting turns every face it moved wholly inside out; turning those loops round again is what
  // keeps the surface facing the way it faced before.
  for (let face = 0; face < target.mesh.faceCount; face += 1) {
    if (target.mesh.faceVertices(face).every((slot) => moved.has(slot))) target.mesh.flipFace(face)
  }
  return true
}

registerOperator<{ axis: string; space: string }>({
  id: 'mesh.mirror',
  label: 'Mirror',
  section: 'Transform',
  shortcut: '⌃M',
  icon: 'modifier-mirror',
  description: 'Reflect the selection through its own centre, and turn the faces it moved back outwards.',
  params: [AXIS_PARAM, SPACE_PARAM],
  defaults: { axis: 'x', space: 'global' },
  // ⌃M is a session in Blender: the key arms it and X, Y or Z chooses the axis, a second press of
  // the same letter switching to local. What reaches the mesh is those two choices, so `run` is a
  // whole function of them and the F9 panel replays it by changing either.
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => {
    const axis: Axis = String(params.axis) === 'y' ? 1 : String(params.axis) === 'z' ? 2 : 0
    const space = String(params.space) === 'local' ? 'local' : 'global'
    return runOnMeshes(context, (target) => {
      // The pivot is the median of what is moving. Blender turns around whichever pivot the header
      // names, and the cursor and the active element among them are in the world’s frame, which a
      // mesh operator has no matrix to reach; the median is in the mesh’s own.
      const done = mirrorSelection(target, planeNormal(target.object, axis, space))
      return done ? {} : null
    }, { label: `Mirror ${String(params.axis).toUpperCase()}` })
  },
})
