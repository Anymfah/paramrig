import { length, normalize } from '@/scene/mesh/normals'
import { applyMatrix, IDENTITY, invert } from '@/scene/modifiers/matrix'
import { numberOf, registerModifier, switchOf } from '@/scene/modifiers/types'
import { bisectFaces } from '@/scene/operators/bisect'
import { numberParam, selectParam, switchParam } from '@/scene/operators/types'
import type { EditMesh } from '@/scene/mesh/editMesh'
import type { Vec3 } from '@/scene/types'

/**
 * Mirror: the other half of a model, kept as a description rather than as geometry.
 *
 * Three decisions run through this file.
 *
 * A reflection turns space inside out, so a mirrored loop read in the order the source was wound
 * faces *into* the model. Every mirrored face is therefore wound backwards, which is what keeps the
 * two halves one surface with one outside — and it is why `flip` exists at all: it puts the loop
 * back the way the source had it, for the case where the source itself is inside out.
 *
 * Welding is by the pair rather than by the plane: a mirrored vertex that lands within the merge
 * distance of the vertex it came from becomes that vertex instead of a second one. That is what
 * makes half a cube close into a cube rather than into two shells touching along a seam, and it is
 * the only place the modifier changes what it was given rather than adding to it.
 *
 * The plane is the origin's, unless a mirror object names another one; then it is that object's,
 * read through the matrix the stack placed it in this mesh's frame with. Its normal is a row of the
 * inverse rather than a column of the matrix, because a plane does not travel with the geometry it
 * cuts — it travels with the inverse transpose, which under a non-uniform scale is a different
 * direction altogether.
 */

type Axis = 0 | 1 | 2

const NO_AXIS = 'Mirror has no axis switched on, so there is nothing to reflect.'
const NO_OBJECT = 'The mirror object this modifier names is not in the scene any more.'

/**
 * How far from the plane a vertex still counts as being on it when bisecting. Blender offers this
 * as “Bisect Distance”; it is fixed here, because the only value that is ever right is the one that
 * catches the vertices a person already snapped onto the plane and nothing else.
 */
const BISECT_DISTANCE = 0.001

type MirrorParams = {
  axisX: boolean
  axisY: boolean
  axisZ: boolean
  bisectX: boolean
  bisectY: boolean
  bisectZ: boolean
  flipX: boolean
  flipY: boolean
  flipZ: boolean
  mirrorObject: string
  merge: boolean
  mergeDistance: number
  /** Read by the transform session, not by `apply`: see the note beside the schema. */
  clipping: boolean
}

/** The frame the reflection happens in: the mirror object's, or the mesh's own. */
type Frame = { there: number[]; back: number[] }

/** A point reflected through the plane where `axis` reads zero in the frame. */
function reflected(frame: Frame, axis: Axis, point: Vec3): Vec3 {
  const local = applyMatrix(frame.back, point)
  const turned: Vec3 = [local[0], local[1], local[2]]
  turned[axis] = -turned[axis]
  return applyMatrix(frame.there, turned)
}

function apart(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * Cuts everything on the far side of the plane away before the reflection is built.
 *
 * A model drawn a little past the middle mirrors into a model that overlaps itself, and no merge
 * distance can weld an overlap. Bisecting first is Blender's answer and it is this one: the source
 * is trimmed to the side the copy is made from, so the two halves meet exactly.
 */
function bisectAt(mesh: EditMesh, frame: Frame, axis: Axis): void {
  const normal = normalize([frame.back[axis]!, frame.back[4 + axis]!, frame.back[8 + axis]!])
  if (length(normal) === 0) return
  const faces: number[] = []
  for (let face = 0; face < mesh.faceCount; face += 1) faces.push(face)
  if (faces.length === 0) return
  // A plane that misses the mesh answers a refusal, and answers it before cutting anything: there
  // is nothing on the far side, which is not a reason for the modifier to stop.
  bisectFaces(mesh, faces, { point: applyMatrix(frame.there, [0, 0, 0]), normal }, {
    fill: false,
    clearInner: true,
    clearOuter: false,
    threshold: BISECT_DISTANCE,
  })
}

/** One reflection: every vertex, face and wire edge of the mesh copied through the plane. */
function mirrorAxis(
  mesh: EditMesh,
  frame: Frame,
  axis: Axis,
  options: { merge: boolean; distance: number; flip: boolean },
): void {
  const vertices = mesh.vertexCount
  const faces = mesh.faceCount
  const edges = mesh.edgeCount
  // Read before anything is added: a wire edge is one no face holds up, and the copy adds faces.
  const wires: Array<[number, number]> = []
  for (let edge = 0; edge < edges; edge += 1) {
    if (mesh.edgeFaces(edge).length === 0) wires.push(mesh.edgeVertices(edge))
  }

  const twin: number[] = []
  for (let slot = 0; slot < vertices; slot += 1) {
    const here = mesh.position(slot)
    const there = reflected(frame, axis, here)
    twin.push(options.merge && apart(here, there) <= options.distance ? slot : mesh.addVertex(there))
  }

  for (let face = 0; face < faces; face += 1) {
    const loop = mesh.faceVertices(face)
    const mapped = loop.map((slot) => twin[slot] ?? slot)
    // A face every corner of which welded onto itself lies in the plane and is its own reflection;
    // adding it again would lay a second face exactly on the first, which nothing could tell apart.
    if (mapped.every((slot, corner) => slot === loop[corner])) continue
    const added = mesh.addFace(options.flip ? mapped : [...mapped].reverse())
    if (added < 0) continue
    mesh.copyFaceAttributes(face, added)
  }

  for (const [a, b] of wires) mesh.addEdge(twin[a] ?? a, twin[b] ?? b)

  for (let edge = 0; edge < edges; edge += 1) {
    const [a, b] = mesh.edgeVertices(edge)
    const mirror = mesh.edgeSlot(twin[a] ?? a, twin[b] ?? b)
    if (mirror < 0 || mirror === edge) continue
    // Only what is set is carried: writing a false onto a fresh edge would mint the whole attribute
    // array for a mesh that has no seams and no creases at all.
    if (mesh.edgeFlag(edge, 'seam')) mesh.setEdgeFlag(mirror, 'seam', true)
    if (mesh.edgeFlag(edge, 'sharp')) mesh.setEdgeFlag(mirror, 'sharp', true)
    const crease = mesh.edgeNumber(edge, 'crease')
    if (crease > 0) mesh.setEdgeNumber(mirror, 'crease', crease)
    const weight = mesh.edgeNumber(edge, 'bevelWeight')
    if (weight > 0) mesh.setEdgeNumber(mirror, 'bevelWeight', weight)
  }
}

registerModifier<MirrorParams>({
  kind: 'mirror',
  label: 'Mirror',
  category: 'generate',
  description: 'Reflect the mesh about one, two or three planes, welding what meets on them.',
  icon: 'modifier-mirror',
  defaults: {
    axisX: true,
    axisY: false,
    axisZ: false,
    bisectX: false,
    bisectY: false,
    bisectZ: false,
    flipX: false,
    flipY: false,
    flipZ: false,
    mirrorObject: '',
    merge: true,
    mergeDistance: 0.001,
    clipping: false,
  },
  schema: [
    switchParam('axisX', 'Axis X', true),
    switchParam('axisY', 'Axis Y', false),
    switchParam('axisZ', 'Axis Z', false),
    switchParam('bisectX', 'Bisect X', false),
    switchParam('bisectY', 'Bisect Y', false),
    switchParam('bisectZ', 'Bisect Z', false),
    switchParam('flipX', 'Flip X', false),
    switchParam('flipY', 'Flip Y', false),
    switchParam('flipZ', 'Flip Z', false),
    selectParam('mirrorObject', 'Mirror object', [{ value: '', label: 'None' }], ''),
    switchParam('merge', 'Merge', true),
    numberParam('mergeDistance', 'Merge distance', { min: 0, max: 100, step: 0.001, defaultValue: 0.001, unit: 'm' }),
    // Read by the transform session rather than by `apply`: clipping is a rule about where a vertex
    // may be dragged, and a modifier never sees a drag. `transform/elements.ts` enforces it.
    switchParam('clipping', 'Clipping', false),
  ],
  objectInputs: ['mirrorObject'],
  apply: (mesh, params, context) => {
    const axes: Axis[] = []
    if (switchOf(params.axisX, true)) axes.push(0)
    if (switchOf(params.axisY, false)) axes.push(1)
    if (switchOf(params.axisZ, false)) axes.push(2)
    if (axes.length === 0) return NO_AXIS

    const named = typeof params.mirrorObject === 'string' && params.mirrorObject !== ''
    const input = context.inputs.mirrorObject ?? null
    if (named && !input) return NO_OBJECT
    const there = input ? input.matrix : IDENTITY
    const frame: Frame = { there, back: input ? invert(there) : IDENTITY }

    const bisect = [switchOf(params.bisectX, false), switchOf(params.bisectY, false), switchOf(params.bisectZ, false)]
    const flip = [switchOf(params.flipX, false), switchOf(params.flipY, false), switchOf(params.flipZ, false)]
    const merge = switchOf(params.merge, true)
    const distance = numberOf(params.mergeDistance, 0.001, 0, 100)

    // Axis after axis on what the one before left, so X and Y together give four quarters and all
    // three give eight — which is how Blender's three switches compose.
    for (const axis of axes) {
      if (bisect[axis] === true) bisectAt(mesh, frame, axis)
      mirrorAxis(mesh, frame, axis, { merge, distance, flip: flip[axis] === true })
    }
    return undefined
  },
})
