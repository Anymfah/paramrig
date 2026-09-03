import { registerOperator } from '@/scene/operators/registry'
import type { OperatorContext } from '@/scene/operators/types'
import type { SceneObject } from '@/scene/types'

/**
 * Choosing what to work on.
 *
 * In object mode a selection is a list of object ids with the last-clicked one active; the active
 * object is what the properties show and what "join to the active" joins into, so it is tracked
 * separately rather than being "the last in the list".
 */

function selectable(context: OperatorContext): SceneObject[] {
  const local = context.document.view.localObjectIds
  return context.document.objects.filter((object) => {
    if (!object.selectable || !object.visible) return false
    if (local && local.length > 0 && !local.includes(object.id)) return false
    const collection = context.document.collections.find((entry) => entry.id === object.collectionId)
    if (collection?.hidden || collection?.excluded || collection?.selectable === false) return false
    return true
  })
}

registerOperator({
  id: 'select.all',
  label: 'All',
  section: 'Select',
  shortcut: 'A',
  description: 'Select everything that can be selected.',
  params: [],
  defaults: {},
  available: (context) => (selectable(context).length > 0 ? true : 'There is nothing here to select.'),
  run: (context) => {
    const ids = selectable(context).map((object) => object.id)
    return {
      selection: { ...context.selection, objectIds: ids, activeObjectId: context.selection.activeObjectId ?? ids.at(-1) ?? null },
      label: 'Select all',
    }
  },
})

registerOperator({
  id: 'select.none',
  label: 'None',
  section: 'Select',
  shortcut: '⌥A',
  description: 'Clear the selection.',
  params: [],
  defaults: {},
  available: (context) => (context.selection.objectIds.length > 0 ? true : 'Nothing is selected.'),
  run: (context) => ({ selection: { ...context.selection, objectIds: [], activeObjectId: null }, label: 'Select none' }),
})

registerOperator({
  id: 'select.invert',
  label: 'Invert',
  section: 'Select',
  shortcut: '⌃I',
  description: 'Select what was not selected, and clear what was.',
  params: [],
  defaults: {},
  available: (context) => (selectable(context).length > 0 ? true : 'There is nothing here to select.'),
  run: (context) => {
    const ids = selectable(context)
      .filter((object) => !context.selection.objectIds.includes(object.id))
      .map((object) => object.id)
    return {
      selection: {
        ...context.selection,
        objectIds: ids,
        activeObjectId: ids.includes(context.selection.activeObjectId ?? '') ? context.selection.activeObjectId : ids.at(-1) ?? null,
      },
      label: 'Invert selection',
    }
  },
})
