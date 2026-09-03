import { EditMesh } from '@/scene/mesh/editMesh'
import { dot, length, subtract } from '@/scene/mesh/normals'
import { applyMatrix } from '@/scene/modifiers/matrix'
import { chosenOf, registerModifier, switchOf, type ModifierInput } from '@/scene/modifiers/types'
import { booleanMeshes, type BooleanOperation } from '@/scene/operators/boolean'
import { selectParam, switchParam } from '@/scene/operators/types'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * The Boolean modifier: another object added to this one, cut out of it, or kept where the two
 * overlap, without either of them being changed.
 *
 * The solver is the object operators' — `booleanMeshes` in `operators/boolean.ts`, which is
 * `three-bvh-csg` with the editor's own triangulation going in and its own weld coming back — so
 * **the result is triangulated geometry recovered approximately, not Blender's topology**: corners
 * within a hundredth of a millimetre are welded into one, triangles with no area are dropped, and
 * neighbours flat to within a thousandth of a radian are gathered back into the n-gon they cover.
 * That gives a cube's square faces and an L-shaped offcut back; it does not give a sphere its quad
 * grid back, and every id in the result is new. Blender pays the same price and says so too.
 *
 * The operand arrives from the stack already measured in this object's frame, so it is put through
 * that matrix before anything else — and turned inside out again when the matrix mirrors it, since
 * a reflected object hands the solver a solid whose faces all point the wrong way.
 *
 * Two of Blender's switches belong to its exact solver, which this build has not got. `Hole
 * tolerant` is read here as what it means to a person — an operand that is not a closed surface is
 * refused unless it is on — and `Self intersection` does nothing at all, exactly as it does nothing
 * in Blender when the solver is Fast.
 */

const OPERATIONS = ['union', 'difference', 'intersect'] as const
const MATERIAL_MODES = ['index', 'transfer'] as const

/** Faces leaning further apart than this came from different surfaces, whichever way they face. */
const FACING = Math.cos((30 * Math.PI) / 180)

/** Nearer than this to a plane is on it: the same hundredth of a millimetre the solver welds at. */
const ON_PLANE = 1e-5

/**
 * How many face-against-face tests the material pass may make. Above it every face comes back on
 * slot 0, because a modifier that is re-evaluated on every frame may not go quadratic on a mesh a
 * person is still moving.
 */
const TRANSFER_BUDGET = 250_000

const NO_FACES = 'Boolean needs faces; this mesh has none.'
const NO_OPERAND = 'Boolean needs another object to work against; choose one in the Operand field.'
const EMPTY_OPERAND = 'The operand has no faces, so there is nothing to work against.'
const OPEN_OPERAND = 'The operand is an open surface; switch on Hole tolerant to cut with it anyway.'

const EMPTY: Record<BooleanOperation, string> = {
  union: 'The union came out empty, which means neither mesh encloses a volume.',
  difference: 'The operand covers this mesh completely, so nothing would be left of it.',
  intersect: 'This mesh and the operand do not overlap, so there is nothing to intersect.',
}

type BooleanModifierParams = {
  operation: string
  operand: string | null
  solver: string
  selfIntersection: boolean
  holeTolerant: boolean
  materialMode: string
}

/** Whether a matrix turns space inside out, which is what a mirrored or negatively scaled object does. */
function mirrors(matrix: number[]): boolean {
  const [a, b, c] = [matrix[0] ?? 1, matrix[1] ?? 0, matrix[2] ?? 0]
  const [d, e, f] = [matrix[4] ?? 0, matrix[5] ?? 1, matrix[6] ?? 0]
  const [g, h, i] = [matrix[8] ?? 0, matrix[9] ?? 0, matrix[10] ?? 1]
  return a * (e * i - h * f) - d * (b * i - h * c) + g * (b * f - e * c) < 0
}

/** The operand where this mesh can see it: through the matrix, and turned back the right way out. */
function placed(input: ModifierInput, data: MeshData): EditMesh {
  const mesh = EditMesh.from(data)
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
    mesh.setPosition(slot, applyMatrix(input.matrix, mesh.position(slot)))
  }
  if (!mirrors(input.matrix)) return mesh
  for (let face = 0; face < mesh.faceCount; face += 1) mesh.flipFace(face)
  return mesh
}

/**
 * Where a face of the result came from: the source face lying in the same plane, facing the same
 * way or the exact other way — a difference keeps the operand's wall with its winding turned round
 * — and nearest to it in that plane. The solver carries no attributes across, so this is the only
 * thing left to read a material and a smooth flag off.
 */
function sourceOf(
  centre: Vec3,
  normal: Vec3,
  sources: Array<{ mesh: EditMesh; shift: number }>,
): { material: number; smooth: boolean } | null {
  let best: { material: number; smooth: boolean; gap: number; span: number } | null = null
  for (const source of sources) {
    for (let face = 0; face < source.mesh.faceCount; face += 1) {
      const facing = source.mesh.faceNormal(face)
      if (Math.abs(dot(normal, facing)) < FACING) continue
      const here = source.mesh.faceCentre(face)
      const gap = Math.abs(dot(facing, subtract(centre, here)))
      const span = length(subtract(centre, here))
      const nearer = best === null
        || (best.gap > ON_PLANE && gap < best.gap - ON_PLANE)
        || (best.gap <= ON_PLANE && gap <= ON_PLANE && span < best.span)
      if (!nearer) continue
      best = { material: source.mesh.faceMaterial(face) + source.shift, smooth: source.mesh.faceSmooth(face), gap, span }
    }
  }
  return best ? { material: best.material, smooth: best.smooth } : null
}

/** The mesh replaced by another in place, which is the only way an `EditMesh` becomes a different one. */
function becomes(mesh: EditMesh, data: MeshData, sources: Array<{ mesh: EditMesh; shift: number }>): void {
  const gone: number[] = []
  for (let slot = 0; slot < mesh.vertexCount; slot += 1) gone.push(slot)
  mesh.remove({ vertices: gone })
  const points = data.vertices
  for (let slot = 0; slot < points.length / 3; slot += 1) {
    mesh.addVertex([points[slot * 3] ?? 0, points[slot * 3 + 1] ?? 0, points[slot * 3 + 2] ?? 0])
  }
  const sourceFaces = sources.reduce((total, source) => total + source.mesh.faceCount, 0)
  const affordable = data.faces.length * sourceFaces <= TRANSFER_BUDGET
  for (const loop of data.faces) {
    const face = mesh.addFace(loop)
    if (face < 0 || !affordable) continue
    const from = sourceOf(mesh.faceCentre(face), mesh.faceNormal(face), sources)
    if (!from) continue
    mesh.setFaceMaterial(face, from.material)
    mesh.setFaceSmooth(face, from.smooth)
  }
}

/** The highest material slot this mesh uses, which is where the operand's own slots would follow on. */
function materialCount(mesh: EditMesh): number {
  let highest = -1
  for (let face = 0; face < mesh.faceCount; face += 1) highest = Math.max(highest, mesh.faceMaterial(face))
  return highest + 1
}

registerModifier<BooleanModifierParams>({
  kind: 'boolean',
  label: 'Boolean',
  category: 'generate',
  description: 'Add another object to this mesh, cut it out of it, or keep only what the two share.',
  icon: 'modifier-boolean',
  defaults: {
    operation: 'difference',
    operand: '',
    solver: 'fast',
    selfIntersection: false,
    holeTolerant: false,
    materialMode: 'index',
  },
  schema: [
    selectParam('operation', 'Operation', [
      { value: 'union', label: 'Union' },
      { value: 'difference', label: 'Difference' },
      { value: 'intersect', label: 'Intersect' },
    ], 'difference'),
    // The panel fills the options in with the mesh objects of the document; the stack reads the id
    // written here and hands the shape over already placed in this object's frame.
    selectParam('operand', 'Operand', [], ''),
    // One choice, because there is one solver. It is a field rather than a line of text so that the
    // exact solver has somewhere to arrive when it is written.
    selectParam('solver', 'Solver', [{ value: 'fast', label: 'Fast' }], 'fast'),
    switchParam('selfIntersection', 'Self intersection', false),
    switchParam('holeTolerant', 'Hole tolerant', false),
    selectParam('materialMode', 'Materials', [
      { value: 'index', label: 'Index based' },
      { value: 'transfer', label: 'Transfer' },
    ], 'index'),
  ],
  objectInputs: ['operand'],
  apply: (mesh, params, context) => {
    if (mesh.faceCount === 0) return NO_FACES
    const input = context.inputs.operand
    if (!input) return NO_OPERAND
    if (!input.mesh || input.mesh.faces.length === 0) return EMPTY_OPERAND
    const operand = placed(input, input.mesh)
    if (!switchOf(params.holeTolerant, false) && operand.boundaryEdges().length > 0) return OPEN_OPERAND

    const operation = chosenOf(params.operation, OPERATIONS, 'difference')
    // Read before anything is rewritten: `becomes` empties this mesh out, and the faces it had are
    // half of what the materials are read back off.
    const before = mesh.toData()
    const built = booleanMeshes({ mesh: before }, [{ mesh: operand.toData() }], operation)
    if (built.faces.length === 0) return EMPTY[operation]

    // Index based leaves the operand's slots as they were written, which is what Blender does with
    // it; transfer moves them past this mesh's own, standing in for its slots being appended here.
    const shift = chosenOf(params.materialMode, MATERIAL_MODES, 'index') === 'transfer' ? materialCount(mesh) : 0
    becomes(mesh, built, [{ mesh: EditMesh.from(before), shift: 0 }, { mesh: operand, shift }])
    return undefined
  },
})
