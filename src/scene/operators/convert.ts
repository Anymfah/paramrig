import { objectById } from '@/scene/document'
import { objectMesh } from '@/scene/modifiers/stack'
import { textCurveData } from '@/scene/curve/text'
import { registerOperator } from '@/scene/operators/registry'
import type { OperatorContext, OperatorResult } from '@/scene/operators/types'
import type { MeshData, SceneObject } from '@/scene/types'

/**
 * Object ▸ Convert: a curve or a text object turned into what it was drawing.
 *
 * Blender's convert is destructive and one-way — the knots are gone, the letters are gone, and what
 * is left is the mesh they evaluated to. It is one step of history like any other, so undo brings
 * the curve back; that is the whole of the reversibility on offer, and it is the reversibility that
 * matters, because a converted mesh is a mesh a person has since edited.
 */

/** The object a convert would act on: the active one, if it is a curve or a text object. */
function target(context: OperatorContext, kinds: Array<'curve' | 'text'>): SceneObject | null {
  const object = objectById(context.document, context.selection.activeObjectId ?? '')
  if (!object) return null
  return kinds.includes(object.data.kind as 'curve') ? object : null
}

/** A fresh id, the way every other operator here makes one. */
function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

registerOperator({
  id: 'object.convertToMesh',
  label: 'Convert to mesh',
  section: 'Object',
  icon: 'mesh',
  description: 'Replace a curve or a text object with the mesh it evaluates to.',
  params: [],
  defaults: {},
  available: (context) => {
    if (context.mode !== 'object') return 'Leave edit mode to convert an object.'
    return target(context, ['curve', 'text']) ? true : 'Select a curve or a text object to convert.'
  },
  run: (context): OperatorResult => {
    const object = target(context, ['curve', 'text'])
    if (!object) return { error: 'Select a curve or a text object to convert.' }
    const built = objectMesh(context.document, object)
    if (!built || built.faces.length === 0) {
      /*
       * A curve with nothing to fill and no depth evaluates to bare edges, and a text object whose
       * font has not landed evaluates to nothing at all. Converting either would leave a mesh with
       * no surface, which reads as "the object vanished"; refusing says what is missing instead.
       */
      return { error: built && built.edges.length > 0
        ? 'This curve has no surface yet: give it a fill, an extrude or a bevel first.'
        : 'There is nothing to convert yet.' }
    }
    const id = newId('mesh')
    const mesh: MeshData = built
    return {
      document: {
        ...context.document,
        meshes: { ...context.document.meshes, [id]: mesh },
        objects: context.document.objects.map((entry) => (
          entry.id === object.id ? { ...entry, kind: 'mesh' as const, data: { kind: 'mesh' as const, meshId: id } } : entry
        )),
      },
      label: 'Convert to mesh',
    }
  },
})

registerOperator({
  id: 'object.convertToCurve',
  label: 'Convert to curve',
  section: 'Object',
  icon: 'curve',
  description: 'Replace a text object with the curves its letters are made of.',
  params: [],
  defaults: {},
  available: (context) => {
    if (context.mode !== 'object') return 'Leave edit mode to convert an object.'
    return target(context, ['text']) ? true : 'Select a text object to convert.'
  },
  run: (context): OperatorResult => {
    const object = target(context, ['text'])
    if (!object || object.data.kind !== 'text') return { error: 'Select a text object to convert.' }
    const curve = textCurveData(object.data)
    if (!curve) return { error: 'The font has not loaded yet, so there are no outlines to convert.' }
    return {
      document: {
        ...context.document,
        objects: context.document.objects.map((entry) => (
          entry.id === object.id ? { ...entry, kind: 'curve' as const, data: curve } : entry
        )),
      },
      label: 'Convert to curve',
    }
  },
})
