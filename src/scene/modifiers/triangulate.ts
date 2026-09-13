import { chosenOf, defineModifier, wholeOf } from '@/scene/modifiers/types'
import { faceTriples, rewriteFace } from '@/scene/operators/subdivide'
import { numberParam, selectParam } from '@/scene/operators/types'

/**
 * Triangulate: every face of the mesh cut into triangles, without touching the mesh a person edits.
 *
 * It is the same cut as the Triangulate faces operator, and it calls the same two functions from
 * `operators/subdivide.ts`: `faceTriples` chooses the diagonals and `rewriteFace` writes the
 * triangles back over the face, keeping its id, its material and its shading. A second copy of an
 * ear-clipper would be a second set of slivers to explain.
 *
 * The only thing the modifier adds is `minVertices`: a floor on how many corners a face must have
 * before it is worth cutting, which is how Blender lets a mesh keep its quads and lose only its
 * n-gons. A triangle is never cut whatever the floor says, so the real floor is four.
 */

const NOTHING_TO_CUT = 'No face here has enough corners to triangulate.'

const QUAD_METHODS = ['beauty', 'fixed', 'alternate', 'shortest-diagonal'] as const
const NGON_METHODS = ['beauty', 'clip'] as const

type TriangulateParams = {
  quadMethod: string
  ngonMethod: string
  minVertices: number
}

export const triangulateModifier = defineModifier<TriangulateParams>({
  kind: 'triangulate',
  label: 'Triangulate',
  category: 'generate',
  description: 'Cut every face of the mesh into triangles, by the diagonal each method asks for.',
  defaults: { quadMethod: 'shortest-diagonal', ngonMethod: 'beauty', minVertices: 4 },
  schema: [
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
    numberParam('minVertices', 'Minimum vertices', { min: 4, max: 64, step: 1, defaultValue: 4, view: 'stepper' }),
  ],
  apply: (mesh, params) => {
    const quadMethod = chosenOf(params.quadMethod, QUAD_METHODS, 'shortest-diagonal')
    const ngonMethod = chosenOf(params.ngonMethod, NGON_METHODS, 'beauty')
    const minVertices = Math.max(4, wholeOf(params.minVertices, 4, 4, 64))

    // Gathered before anything is cut: `rewriteFace` mints faces beside the one it rewrites, and a
    // loop that read `faceCount` as it went would go on to triangulate the triangles it just made.
    const wanted: number[] = []
    for (let face = 0; face < mesh.faceCount; face += 1) {
      if (mesh.faceVertices(face).length >= minVertices) wanted.push(face)
    }
    if (wanted.length === 0) return NOTHING_TO_CUT

    for (const face of wanted) {
      const loop = mesh.faceVertices(face)
      const loops = faceTriples(mesh, face, quadMethod, ngonMethod)
        .map((triple) => triple.map((corner) => loop[corner]!))
      rewriteFace(mesh, face, loops)
    }
    return undefined
  },
})
