import { EditMesh } from '@/scene/mesh/editMesh'
import { applyMatrix, IDENTITY, invert, multiply, translation } from '@/scene/modifiers/matrix'
import { chosenOf, numberOf, registerModifier, switchOf, vectorOf, wholeOf } from '@/scene/modifiers/types'
import { weldVertices, type WeldCluster } from '@/scene/operators/merge'
import { numberParam, selectParam, switchParam, vectorParam } from '@/scene/operators/types'
import type { ModifierInput } from '@/scene/modifiers/types'
import type { Vec3 } from '@/scene/types'

/**
 * Array: the same mesh again, and again, one step further along each time.
 *
 * The step is one matrix, built from three things that add up rather than exclude each other — a
 * share of the mesh's own bounds, a distance in metres, and another object's transform — and copy
 * number *n* is that matrix to the power of *n*. That is what makes a ring: an object offset that
 * turns by a fifteenth of a circle and moves outwards, taken twenty-four times, closes on itself,
 * and “merge first and last” is what welds the ends of it together.
 *
 * Two decisions are worth knowing. The copies are welded by `weldVertices` from the merge operator
 * rather than by a weld written again here, so a seam in an array and a merge by distance leave
 * exactly the same topology behind — including the rule that a face welded onto the same corners as
 * another is dropped, which is what stops each seam from carrying two coincident walls.
 *
 * And a cap is placed in its own object's coordinates, one step before the first copy or one step
 * after the last, with the cap object's own position ignored. That is Blender's behaviour and it is
 * the only one that composes: a cap that carried its own transform would move when the object it
 * came from moved, and a person moves that object out of the way as soon as they have made it.
 */

type ArrayParams = {
  fitType: string
  count: number
  length: number
  relativeOffset: Vec3
  useRelative: boolean
  constantOffset: Vec3
  useConstant: boolean
  offsetObject: string
  useObject: boolean
  merge: boolean
  mergeDistance: number
  firstLast: boolean
  startCap: string
  endCap: string
}

const FIT_TYPES = ['fixed', 'length'] as const

const NO_STEP = 'Fit length needs an offset that is not zero.'

/** Below this a step is not a distance and dividing a length by it would answer a million copies. */
const SHORTEST_STEP = 1e-9

/** A named object that has gone from the scene, said the same way whichever field named it. */
function missing(field: string): string {
  return `The ${field} this modifier names is not in the scene any more.`
}

/* ------------------------------------------------------------------- a copy */

/**
 * A mesh read out as something that can be placed again: positions, loops with their shading, and
 * every edge with its flags. It is taken once, before anything is added, because the copies are
 * added to the very mesh they are copies of.
 */
type Piece = {
  positions: Vec3[]
  faces: Array<{ loop: number[]; material: number; smooth: boolean }>
  edges: Array<{ ends: [number, number]; wire: boolean; seam: boolean; sharp: boolean; crease: number; bevelWeight: number }>
}

function pieceOf(mesh: EditMesh): Piece {
  const positions: Vec3[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) positions.push(mesh.position(slot))
  const faces: Piece['faces'] = []
  for (let face = 0; face < mesh.faceCount; face += 1) {
    faces.push({ loop: mesh.faceVertices(face), material: mesh.faceMaterial(face), smooth: mesh.faceSmooth(face) })
  }
  const edges: Piece['edges'] = []
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    edges.push({
      ends: mesh.edgeVertices(edge),
      wire: mesh.edgeFaces(edge).length === 0,
      seam: mesh.edgeFlag(edge, 'seam'),
      sharp: mesh.edgeFlag(edge, 'sharp'),
      crease: mesh.edgeNumber(edge, 'crease'),
      bevelWeight: mesh.edgeNumber(edge, 'bevelWeight'),
    })
  }
  return { positions, faces, edges }
}

/** One copy of a piece, placed by a matrix; the vertex slots it landed on, in the piece's order. */
function place(mesh: EditMesh, piece: Piece, matrix: number[]): number[] {
  const slots = piece.positions.map((point) => mesh.addVertex(applyMatrix(matrix, point)))
  for (const face of piece.faces) {
    const added = mesh.addFace(face.loop.map((index) => slots[index] ?? -1))
    if (added < 0) continue
    mesh.setFaceMaterial(added, face.material)
    mesh.setFaceSmooth(added, face.smooth)
  }
  for (const edge of piece.edges) {
    const a = slots[edge.ends[0]] ?? -1
    const b = slots[edge.ends[1]] ?? -1
    if (a < 0 || b < 0) continue
    // A wire edge has no face to mint it, so it is minted here; every other edge came with its face.
    const slot = edge.wire ? mesh.addEdge(a, b) : mesh.edgeSlot(a, b)
    if (slot < 0) continue
    // Only what is set is carried, so an array of a mesh with no seams keeps its attributes empty.
    if (edge.seam) mesh.setEdgeFlag(slot, 'seam', true)
    if (edge.sharp) mesh.setEdgeFlag(slot, 'sharp', true)
    if (edge.crease > 0) mesh.setEdgeNumber(slot, 'crease', edge.crease)
    if (edge.bevelWeight > 0) mesh.setEdgeNumber(slot, 'bevelWeight', edge.bevelWeight)
  }
  return slots
}

/* ------------------------------------------------------------------ the seam */

/**
 * The welds between two copies: each vertex of `drop` onto the nearest vertex of `keep` within the
 * distance, or onto nothing.
 *
 * The search is over a grid of cells one distance across rather than over every pair, so a hundred
 * copies of a thousand vertices costs a pass and twenty-seven lookups each rather than the square.
 */
function seam(mesh: EditMesh, keep: number[], drop: number[], distance: number): WeldCluster[] {
  const reach = Math.max(distance, SHORTEST_STEP)
  const cells = new Map<string, number[]>()
  const cellKey = (point: Vec3): string =>
    `${Math.floor(point[0] / reach)}|${Math.floor(point[1] / reach)}|${Math.floor(point[2] / reach)}`
  for (const slot of keep) {
    const key = cellKey(mesh.position(slot))
    const cell = cells.get(key)
    if (cell) cell.push(slot)
    else cells.set(key, [slot])
  }

  const clusters: WeldCluster[] = []
  for (const slot of drop) {
    const point = mesh.position(slot)
    const base = [Math.floor(point[0] / reach), Math.floor(point[1] / reach), Math.floor(point[2] / reach)]
    let partner = -1
    let closest = Number.POSITIVE_INFINITY
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const candidate of cells.get(`${base[0]! + dx}|${base[1]! + dy}|${base[2]! + dz}`) ?? []) {
            const other = mesh.position(candidate)
            const gap = Math.hypot(point[0] - other[0], point[1] - other[1], point[2] - other[2])
            if (gap > distance || gap >= closest) continue
            closest = gap
            partner = candidate
          }
        }
      }
    }
    if (partner >= 0) clusters.push({ keep: partner, drop: [slot] })
  }
  return clusters
}

/* ---------------------------------------------------------------- the offset */

/** The step from one copy to the next: the relative and constant offsets, then the object's. */
function stepMatrix(mesh: EditMesh, params: ArrayParams, offsetObject: ModifierInput | null): number[] {
  const size = mesh.bounds().size
  const relative = vectorOf(params.relativeOffset, [1, 0, 0])
  const constant = vectorOf(params.constantOffset, [0, 0, 0])
  const along: Vec3 = [0, 0, 0]
  if (switchOf(params.useRelative, true)) {
    for (const axis of [0, 1, 2] as const) along[axis] += relative[axis] * size[axis]
  }
  if (switchOf(params.useConstant, false)) {
    for (const axis of [0, 1, 2] as const) along[axis] += constant[axis]
  }
  const step = translation(along)
  if (!switchOf(params.useObject, false) || !offsetObject) return step
  return multiply(step, offsetObject.matrix)
}

/** The object a cap parameter names, as a piece; null when the field is empty or holds no mesh. */
function capPiece(input: ModifierInput | null): Piece | null {
  if (!input?.mesh) return null
  return pieceOf(EditMesh.from(input.mesh))
}

registerModifier<ArrayParams>({
  kind: 'array',
  label: 'Array',
  category: 'generate',
  description: 'Repeat the mesh along an offset, with caps at the ends and the seams welded.',
  icon: 'modifier-array',
  defaults: {
    fitType: 'fixed',
    count: 2,
    length: 0,
    relativeOffset: [1, 0, 0],
    useRelative: true,
    constantOffset: [0, 0, 0],
    useConstant: false,
    offsetObject: '',
    useObject: false,
    merge: false,
    mergeDistance: 0.01,
    firstLast: false,
    startCap: '',
    endCap: '',
  },
  schema: [
    selectParam('fitType', 'Fit type', [
      { value: 'fixed', label: 'Fixed count' },
      { value: 'length', label: 'Fit length' },
    ], 'fixed'),
    numberParam('count', 'Count', { min: 1, max: 1000, step: 1, defaultValue: 2, view: 'stepper' }),
    numberParam('length', 'Length', { min: 0, max: 10000, step: 0.1, defaultValue: 0, unit: 'm' }),
    switchParam('useRelative', 'Relative offset', true),
    vectorParam('relativeOffset', 'Factor', { defaultValue: [1, 0, 0], step: 0.01 }),
    switchParam('useConstant', 'Constant offset', false),
    vectorParam('constantOffset', 'Distance', { defaultValue: [0, 0, 0], step: 0.01, unit: 'm' }),
    switchParam('useObject', 'Object offset', false),
    selectParam('offsetObject', 'Offset object', [{ value: '', label: 'None' }], ''),
    switchParam('merge', 'Merge', false),
    numberParam('mergeDistance', 'Merge distance', { min: 0, max: 100, step: 0.001, defaultValue: 0.01, unit: 'm' }),
    switchParam('firstLast', 'Merge first and last', false),
    selectParam('startCap', 'Start cap', [{ value: '', label: 'None' }], ''),
    selectParam('endCap', 'End cap', [{ value: '', label: 'None' }], ''),
  ],
  objectInputs: ['offsetObject', 'startCap', 'endCap'],
  apply: (mesh, params, context) => {
    // A field naming an object that has gone is a refusal rather than a silent nothing — except the
    // offset object while its own switch is off, which is a field nobody is reading.
    const named = (value: unknown): boolean => typeof value === 'string' && value !== ''
    if (switchOf(params.useObject, false) && named(params.offsetObject) && !context.inputs.offsetObject) {
      return missing('offset object')
    }
    if (named(params.startCap) && !context.inputs.startCap) return missing('start cap object')
    if (named(params.endCap) && !context.inputs.endCap) return missing('end cap object')

    const step = stepMatrix(mesh, params, context.inputs.offsetObject ?? null)
    const span = Math.hypot(step[12]!, step[13]!, step[14]!)
    let count = wholeOf(params.count, 2, 1, 1000)
    if (chosenOf(params.fitType, FIT_TYPES, 'fixed') === 'length') {
      if (span < SHORTEST_STEP) return NO_STEP
      // The first copy is the mesh itself, so a length of exactly one step asks for two copies.
      count = Math.min(1000, Math.floor(numberOf(params.length, 0, 0, 10000) / span) + 1)
    }

    const piece = pieceOf(mesh)
    if (piece.positions.length === 0) return undefined
    const copies: number[][] = [piece.positions.map((_, index) => index)]
    let transform = [...IDENTITY]
    for (let index = 1; index < count; index += 1) {
      transform = multiply(step, transform)
      copies.push(place(mesh, piece, transform))
    }

    const start = capPiece(context.inputs.startCap ?? null)
    const end = capPiece(context.inputs.endCap ?? null)
    const startSlots = start ? place(mesh, start, invert(step)) : []
    const endSlots = end ? place(mesh, end, multiply(step, transform)) : []

    if (switchOf(params.merge, false)) {
      const distance = numberOf(params.mergeDistance, 0.01, 0, 100)
      const clusters: WeldCluster[] = []
      for (let index = 1; index < copies.length; index += 1) {
        clusters.push(...seam(mesh, copies[index - 1]!, copies[index]!, distance))
      }
      if (startSlots.length > 0) clusters.push(...seam(mesh, copies[0]!, startSlots, distance))
      if (endSlots.length > 0) clusters.push(...seam(mesh, copies[copies.length - 1]!, endSlots, distance))
      // Last onto first closes a ring, and it comes last so that a copy already welded to the one
      // before it is carried onto the first through the chain rather than pulled two ways at once.
      if (switchOf(params.firstLast, false) && copies.length > 1) {
        clusters.push(...seam(mesh, copies[0]!, copies[copies.length - 1]!, distance))
      }
      if (clusters.length > 0) weldVertices(mesh, clusters)
    }
    return undefined
  },
})
