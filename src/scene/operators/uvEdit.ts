import { activeUv, withActiveUv, withPinned } from '@/scene/mesh/uv'
import { meshOf, withMesh } from '@/scene/document'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, selectParam, type OperatorContext, type OperatorResult } from '@/scene/operators/types'
import {
  alignUvs,
  clampUvsToImage,
  mirrorUvs,
  snapUvsToPixels,
  stitchUvs,
  straightenUvs,
  weldUvs,
  type AlignAxis,
} from '@/scene/uv/tools'
import type { MeshData, SceneDocument } from '@/scene/types'

/**
 * The UV editor's own menu: everything that moves a map by hand rather than by unwrapping it.
 *
 * These read the *UV* selection rather than the mesh selection, which is the one difference between
 * them and every other operator in the editor. A corner of a map is not an element of a mesh — two
 * of them can sit on one vertex and be moved apart — so the selection they work on is the one the
 * UV editor keeps, and an operator with nothing selected there says so rather than doing something
 * surprising to the whole map.
 */

/** The object being edited, its mesh, and the corners the UV editor has selected. */
function target(context: OperatorContext): { objectId: string; meshId: string; mesh: MeshData; loops: number[] } | string {
  if (context.mode !== 'edit') return 'This works in edit mode. Press Tab.'
  const objectId = context.selection.activeObjectId ?? ''
  const object = context.document.objects.find((candidate) => candidate.id === objectId)
  if (!object || object.data.kind !== 'mesh') return 'Open a mesh for editing first.'
  const mesh = meshOf(context.document, object)
  if (!mesh) return 'Open a mesh for editing first.'
  const loops = context.selection.uv?.[objectId] ?? []
  if (loops.length === 0) return 'Select something in the UV editor first.'
  return { objectId, meshId: object.data.meshId, mesh, loops }
}

/** Whether the menu entry is offered at all, in the words it refuses with. */
function available(context: OperatorContext): true | string {
  const found = target(context)
  return typeof found === 'string' ? found : true
}

/** The frame every one of these runs in: read the map, write a new one, hand the document back. */
function editUv(
  context: OperatorContext,
  label: string,
  change: (mesh: MeshData, uv: number[], loops: number[]) => number[],
): OperatorResult {
  const found = target(context)
  if (typeof found === 'string') return { error: found }
  const uv = activeUv(found.mesh)
  if (!uv) return { error: 'That mesh has no UV map yet. Unwrap it with U.' }
  return {
    document: withMesh(context.document, found.meshId, withActiveUv(found.mesh, change(found.mesh, uv, found.loops))),
    label,
  }
}

/** The same, for the two that change the mesh rather than the map. */
function editMesh(context: OperatorContext, label: string, change: (mesh: MeshData, loops: number[]) => MeshData): OperatorResult {
  const found = target(context)
  if (typeof found === 'string') return { error: found }
  const document: SceneDocument = withMesh(context.document, found.meshId, change(found.mesh, found.loops))
  return { document, label }
}

registerOperator({
  id: 'uv.pin',
  label: 'Pin',
  section: 'UV',
  shortcut: 'P',
  description: 'Hold these corners where they are, so an unwrap solves around them.',
  params: [],
  defaults: {},
  mode: 'edit',
  available,
  run: (context) => editMesh(context, 'Pin', (mesh, loops) => withPinned(mesh, loops, true)),
})

registerOperator({
  id: 'uv.unpin',
  label: 'Unpin',
  section: 'UV',
  shortcut: '⌥P',
  description: 'Let an unwrap move these corners again.',
  params: [],
  defaults: {},
  mode: 'edit',
  available,
  run: (context) => editMesh(context, 'Unpin', (mesh, loops) => withPinned(mesh, loops, false)),
})

registerOperator({
  id: 'uv.weld',
  label: 'Weld',
  section: 'UV',
  description: 'Bring every selected corner of the map onto one point.',
  params: [],
  defaults: {},
  mode: 'edit',
  available,
  run: (context) => editUv(context, 'Weld', weldUvs),
})

registerOperator({
  id: 'uv.stitch',
  label: 'Stitch',
  section: 'UV',
  shortcut: 'V',
  description: 'Move the selected islands onto the ones they were cut from.',
  params: [],
  defaults: {},
  mode: 'edit',
  available,
  run: (context) => editUv(context, 'Stitch', stitchUvs),
})

registerOperator({
  id: 'uv.align',
  label: 'Align',
  section: 'UV',
  description: 'Put the selected corners on one line, across or down.',
  params: [
    selectParam('axis', 'Axis', [
      { value: 'auto', label: 'Auto' },
      { value: 'u', label: 'X' },
      { value: 'v', label: 'Y' },
    ], 'auto'),
  ],
  defaults: { axis: 'auto' },
  mode: 'edit',
  available,
  run: (context, params) => editUv(context, 'Align', (mesh, uv, loops) => (
    alignUvs(mesh, uv, loops, String(params.axis ?? 'auto') as AlignAxis)
  )),
})

registerOperator({
  id: 'uv.straighten',
  label: 'Straighten',
  section: 'UV',
  description: 'Drop the selected corners onto the straight line that fits them best.',
  params: [],
  defaults: {},
  mode: 'edit',
  available,
  run: (context) => editUv(context, 'Straighten', straightenUvs),
})

registerOperator({
  id: 'uv.mirror',
  label: 'Mirror',
  section: 'UV',
  description: 'Flip the selected corners about the middle of what is selected.',
  params: [
    selectParam('axis', 'Axis', [{ value: 'u', label: 'X' }, { value: 'v', label: 'Y' }], 'u'),
  ],
  defaults: { axis: 'u' },
  mode: 'edit',
  available,
  run: (context, params) => editUv(context, 'Mirror', (mesh, uv, loops) => (
    mirrorUvs(mesh, uv, loops, params.axis === 'v' ? 'v' : 'u')
  )),
})

registerOperator({
  id: 'uv.snapToPixels',
  label: 'Snap to pixels',
  section: 'UV',
  description: 'Round the selected corners onto the texel grid of an image this size.',
  params: [numberParam('size', 'Image size', { min: 2, max: 8192, step: 1, defaultValue: 512, unit: 'px' })],
  defaults: { size: 512 },
  mode: 'edit',
  available,
  run: (context, params) => editUv(context, 'Snap to pixels', (mesh, uv, loops) => (
    snapUvsToPixels(mesh, uv, loops, Number(params.size ?? 512))
  )),
})

registerOperator({
  id: 'uv.constrainToImage',
  label: 'Constrain to image bounds',
  section: 'UV',
  description: 'Bring every corner of the map inside the image.',
  params: [],
  defaults: {},
  mode: 'edit',
  available: (context) => (context.mode === 'edit' ? true : 'This works in edit mode. Press Tab.'),
  run: (context) => {
    const objectId = context.selection.activeObjectId ?? ''
    const object = context.document.objects.find((candidate) => candidate.id === objectId)
    if (!object || object.data.kind !== 'mesh') return { error: 'Open a mesh for editing first.' }
    const mesh = meshOf(context.document, object)
    const uv = mesh ? activeUv(mesh) : null
    if (!mesh || !uv) return { error: 'That mesh has no UV map yet. Unwrap it with U.' }
    return {
      document: withMesh(context.document, object.data.meshId, withActiveUv(mesh, clampUvsToImage(uv))),
      label: 'Constrain to image bounds',
    }
  },
})
