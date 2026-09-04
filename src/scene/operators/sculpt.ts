import { Vector3 } from 'three'
import { meshOf, withMesh } from '@/scene/document'
import { worldMatrix } from '@/scene/objects'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, switchParam, type OperatorContext, type OperatorResult } from '@/scene/operators/types'
import { voxelRemesh } from '@/scene/sculpt/remesh'
import type { SceneObject } from '@/scene/types'

/**
 * Remesh: the sculpt's topology thrown away and built again, evenly.
 *
 * Sculpting stretches what it moves. A stroke that pulls a nose out of a head gives the nose the
 * triangles the cheek had — a handful of them, stretched to a fifth of their density — and no
 * amount of brushing puts detail into a surface that has no vertices to hold it. Remeshing is the
 * answer, and it is why Blender's sculpt header carries it beside the brush.
 *
 * It is a whole-mesh operation with no undo of its own beyond the ordinary one: the shape survives,
 * the topology does not, and neither do the UV maps, the selections or the mask that were expressed
 * in terms of it.
 */

/** The one mesh a remesh would rebuild: the active object's. */
function target(context: OperatorContext): SceneObject | null {
  const id = context.selection.activeObjectId
  const object = context.document.objects.find((candidate) => candidate.id === id)
  return object?.data.kind === 'mesh' ? object : null
}

registerOperator({
  id: 'mesh.remesh',
  label: 'Remesh',
  section: 'Mesh',
  description: 'Rebuild the mesh as an even grid of quads, at the voxel size given.',
  params: [
    numberParam('voxelSize', 'Voxel size', { min: 0.005, max: 2, step: 0.005, defaultValue: 0.1, unit: 'm' }),
    switchParam('preserveVolume', 'Preserve volume', true),
  ],
  defaults: { voxelSize: 0.1, preserveVolume: true },
  available: (context) => (target(context) ? true : 'Select a mesh to remesh first.'),
  run: (context, params): OperatorResult => {
    const object = target(context)
    if (!object || object.data.kind !== 'mesh') return { error: 'Select a mesh to remesh first.' }
    const mesh = meshOf(context.document, object)
    if (!mesh) return { error: 'Select a mesh to remesh first.' }
    /*
     * The voxel is given in the units a person sees — the scene's — and the mesh is sculpted in its
     * own. An object scaled to a tenth would otherwise be remeshed ten times as finely as its
     * neighbour at the same setting, which is not what "a centimetre" means to anybody.
     */
    const scale = new Vector3().setFromMatrixScale(worldMatrix(context.document, object))
    const average = (scale.x + scale.y + scale.z) / 3
    const built = voxelRemesh(mesh, {
      voxelSize: Number(params.voxelSize ?? 0.1) / (average > 1e-6 ? average : 1),
      preserveVolume: Boolean(params.preserveVolume),
    })
    if (typeof built === 'string') return { error: built }
    return {
      document: withMesh(context.document, object.data.meshId, built),
      /*
       * Everything the old topology carried goes with it. Saying so in the label is the only honest
       * place: a selection of vertices that no longer exist cannot be kept, and neither can a UV map
       * whose corners were the old corners.
       */
      selection: { ...context.selection, elements: {}, active: null, elementHistory: [], uv: {} },
      label: 'Remesh',
    }
  },
})
