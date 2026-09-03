import { numberOf, registerModifier, switchOf } from '@/scene/modifiers/types'
import { splitAlongEdges } from '@/scene/operators/subdivide'
import { numberParam, switchParam } from '@/scene/operators/types'

/**
 * Edge split: the modifier that makes a fold read as a fold.
 *
 * Shading blends a normal across every edge two faces share, so a cube with one smooth face group
 * has rounded corners it never asked for. Splitting the mesh along the edges that are meant to be
 * hard gives each side its own copy of the vertices there, and the blend has nothing left to blend
 * across. The mesh looks exactly the same; only its normals come apart.
 *
 * The geometry is `splitAlongEdges` from `operators/subdivide.ts`, which is what the Edge split
 * operator runs on a selection — the modifier is the same thing chosen by angle and by flag rather
 * than by hand, so it calls that function rather than carrying a second copy of it.
 *
 * Two things are deliberate. An edge already on a rim, or where more than two faces meet, is never
 * split: the first has nothing to come apart from and the second has no single fold to measure.
 * And with both tests switched off the modifier refuses instead of quietly passing the mesh
 * through, because a modifier that does nothing and says nothing is a bug a person cannot see.
 */

const NOTHING_CHOSEN = 'Edge split needs an angle or the sharp edges; both are switched off.'
const NOTHING_SHARP = 'No edge here is sharp enough to split.'

const DEGREES = Math.PI / 180

type EdgeSplitParams = {
  angle: number
  useAngle: boolean
  useSharp: boolean
}

registerModifier<EdgeSplitParams>({
  kind: 'edgeSplit',
  label: 'Edge split',
  category: 'generate',
  description: 'Pull the faces apart along every edge marked sharp, or folded past the angle.',
  defaults: { angle: 30, useAngle: true, useSharp: true },
  schema: [
    numberParam('angle', 'Edge angle', { min: 0, max: 180, step: 1, defaultValue: 30, unit: '°', view: 'angle' }),
    switchParam('useAngle', 'Edge angle', true),
    switchParam('useSharp', 'Sharp edges', true),
  ],
  apply: (mesh, params) => {
    const byAngle = switchOf(params.useAngle, true)
    const bySharp = switchOf(params.useSharp, true)
    if (!byAngle && !bySharp) return NOTHING_CHOSEN
    const angle = numberOf(params.angle, 30, 0, 180) * DEGREES

    const split = new Set<number>()
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      if (mesh.edgeFaces(edge).length !== 2) continue
      if ((bySharp && mesh.edgeFlag(edge, 'sharp')) || (byAngle && mesh.dihedral(edge) > angle)) split.add(edge)
    }
    if (split.size === 0) return NOTHING_SHARP

    const copies = splitAlongEdges(mesh, split)
    if (copies.length === 0) return NOTHING_SHARP
    // The edges that were doubled are spanned by the copies now, and the originals are left over.
    mesh.dropLoose()
    return undefined
  },
})
