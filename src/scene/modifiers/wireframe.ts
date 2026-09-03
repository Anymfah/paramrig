import { registerModifier, numberOf, switchOf, wholeOf } from '@/scene/modifiers/types'
import { wireableEdges, wireframeBars } from '@/scene/operators/shell'
import { numberParam, switchParam } from '@/scene/operators/types'

/**
 * Wireframe: the mesh as the frame it is drawn with.
 *
 * The bars are the operator's, `wireframeBars` in `operators/shell.ts`, run over every edge of the
 * mesh instead of over a selection. The approximation is stated there and holds here: Blender
 * mitres its tubes into one continuous shell, this builds one closed box per edge, set back from
 * each end so the boxes stay out of each other. The frame reads right and every bar is closed; the
 * joints are open inside, which nothing outside a cutaway will ever see.
 */

const NEEDS_EDGES = 'Wireframe needs edges; this mesh has none.'
const NEEDS_THICKNESS = 'Give Wireframe a thickness; nought has nothing to build.'
const ALL_RIM = 'Every edge of this mesh is on its rim, and Boundary is switched off.'
const TOO_SHORT = 'Every edge of this mesh is too short to carry a bar of that thickness.'

registerModifier({
  kind: 'wireframe',
  label: 'Wireframe',
  category: 'generate',
  description: 'Turn every edge of the mesh into a square bar, and drop the surface it was cut from.',
  icon: 'modifier-wireframe',
  defaults: {
    thickness: 0.02,
    offset: 0,
    even: true,
    relative: false,
    boundary: true,
    replace: true,
    materialOffset: 0,
  },
  schema: [
    numberParam('thickness', 'Thickness', { min: 0, max: 100, step: 0.01, defaultValue: 0.02, unit: 'm' }),
    numberParam('offset', 'Offset', { min: -1, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    switchParam('even', 'Even thickness', true),
    switchParam('relative', 'Relative thickness', false),
    switchParam('boundary', 'Wire the rim too', true),
    switchParam('replace', 'Replace the original', true),
    numberParam('materialOffset', 'Material offset', { min: 0, max: 32, step: 1, defaultValue: 0, view: 'stepper' }),
  ],
  apply: (mesh, params) => {
    if (mesh.edgeCount === 0) return NEEDS_EDGES
    const thickness = numberOf(params.thickness, 0.02, 0, 100)
    if (thickness === 0) return NEEDS_THICKNESS
    const edges: number[] = []
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) edges.push(edge)
    const wired = wireableEdges(mesh, edges, switchOf(params.boundary, true))
    if (wired.length === 0) return ALL_RIM
    // The faces to drop are read before the bars are built, because the bars are faces as well.
    const faces: number[] = []
    for (let face = 0; face < mesh.faceCount; face += 1) faces.push(face)
    const minted = wireframeBars(mesh, wired, {
      thickness,
      offset: numberOf(params.offset, 0, -1, 1),
      even: switchOf(params.even, true),
      relative: switchOf(params.relative, false),
      materialOffset: wholeOf(params.materialOffset, 0, 0, 32),
    })
    if (minted.length === 0) return TOO_SHORT
    if (switchOf(params.replace, true)) {
      // The faces go first and whatever no bar uses goes with them, so a replaced wireframe leaves
      // the frame and not the sheet it was cut from.
      mesh.remove({ faces })
      mesh.dropLoose()
    }
  },
})
