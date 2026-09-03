import { convertSelectMode, fromElements, toElements } from '@/scene/mesh/selection'
import { editTargets } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import { switchParam, type OperatorContext, type OperatorResult } from '@/scene/operators/types'
import type { EditorMode, SceneDocument, SceneSelection, SelectMode, ViewState } from '@/scene/types'

/**
 * Tab, and the three element kinds.
 *
 * The mode is part of the document's view, not of the page's state, so that closing a scene in edit
 * mode opens it in edit mode, and so that an operator can ask what mode it is in without the page
 * having to tell it. Which objects are open for editing is part of the *selection*, because that is
 * what it is: Blender edits every selected mesh at once, each keeping its own selection, and the
 * active object is the one the header names.
 *
 * Leaving edit mode keeps every element selection exactly as it was. A person who tabs out to look
 * at the whole scene and tabs back in has not asked to lose their work, and Blender does not make
 * them pay for the trip.
 */

function withView(document: SceneDocument, view: Partial<ViewState>): SceneDocument {
  return { ...document, view: { ...document.view, ...view } }
}

/** Every selected mesh, active first: what Tab opens. */
function editableObjects(context: OperatorContext): string[] {
  const ids = context.selection.objectIds.filter((id) => {
    const object = context.document.objects.find((candidate) => candidate.id === id)
    return object?.data.kind === 'mesh' && object.visible
  })
  const active = context.selection.activeObjectId
  if (active && ids.includes(active)) return [active, ...ids.filter((id) => id !== active)]
  return ids
}

function enterEdit(context: OperatorContext, mode: EditorMode): OperatorResult {
  const ids = editableObjects(context)
  if (ids.length === 0) return { error: 'Select a mesh to edit first.' }
  const selection: SceneSelection = {
    ...context.selection,
    activeObjectId: ids[0]!,
    editObjectIds: ids,
    // Anything the document remembers from last time is kept; an object opened for the first time
    // starts with nothing selected, which is what Blender's fresh cube does.
    elements: Object.fromEntries(ids.map((id) => [id, context.selection.elements?.[id] ?? { vertices: [], edges: [], faces: [] }])),
  }
  return {
    document: withView(context.document, { mode }),
    selection,
    label: mode === 'edit' ? 'Edit mode' : 'Sculpt mode',
  }
}

function leaveEdit(context: OperatorContext): OperatorResult {
  return {
    document: withView(context.document, { mode: 'object' }),
    selection: { ...context.selection, editObjectIds: [] },
    label: 'Object mode',
  }
}

registerOperator({
  id: 'mode.toggleEdit',
  label: 'Toggle edit mode',
  section: 'Mode',
  shortcut: 'Tab',
  icon: 'mesh',
  description: 'Open the selected meshes for editing, or close them again.',
  params: [],
  defaults: {},
  available: (context) => {
    if (context.document.view.mode !== 'object') return true
    return editableObjects(context).length > 0 ? true : 'Select a mesh to edit first.'
  },
  run: (context) => (context.document.view.mode === 'object' ? enterEdit(context, 'edit') : leaveEdit(context)),
})

registerOperator({
  id: 'mode.object',
  label: 'Object mode',
  section: 'Mode',
  description: 'Leave edit mode and work on whole objects again.',
  params: [],
  defaults: {},
  available: (context) => (context.document.view.mode === 'object' ? 'Already in object mode.' : true),
  run: (context) => leaveEdit(context),
})

registerOperator({
  id: 'mode.edit',
  label: 'Edit mode',
  section: 'Mode',
  description: 'Open the selected meshes for editing.',
  params: [],
  defaults: {},
  available: (context) => {
    if (context.document.view.mode === 'edit') return 'Already in edit mode.'
    return editableObjects(context).length > 0 ? true : 'Select a mesh to edit first.'
  },
  run: (context) => enterEdit(context, 'edit'),
})

registerOperator({
  id: 'mode.sculpt',
  label: 'Sculpt mode',
  section: 'Mode',
  description: 'Sculpt the active mesh with brushes.',
  params: [],
  defaults: {},
  // Declared so the mode pie is the whole pie and its gap is explained rather than mysterious.
  available: () => 'Sculpt mode arrives with the sculpting tools.',
  run: () => ({ error: 'Sculpt mode arrives with the sculpting tools.' }),
})

/* -------------------------------------------------------------- select mode */

/**
 * 1, 2 and 3, with shift to hold more than one at a time.
 *
 * Changing which kind is selected converts what was selected rather than dropping it: coming down
 * from faces to vertices keeps the corners, going up from vertices to faces keeps the faces whose
 * every corner was chosen. That conversion is the whole reason the modes are usable at all, and it
 * happens here, once, for every object open for editing.
 */
function setSelectMode(context: OperatorContext, kind: SelectMode, extend: boolean): OperatorResult {
  const current = context.document.view.selectMode
  let next: SelectMode[]
  if (!extend) next = [kind]
  else if (current.includes(kind)) {
    next = current.filter((mode) => mode !== kind)
    if (next.length === 0) return { error: 'One of vertex, edge or face has to stay on.' }
  } else {
    next = [...current, kind]
  }
  const ordered: SelectMode[] = (['vertex', 'edge', 'face'] as SelectMode[]).filter((mode) => next.includes(mode))
  let selection = context.selection
  for (const target of editTargets(context)) {
    const elements = toElements(selection, target.object.id)
    const converted = convertSelectMode(target.mesh, elements, current, ordered)
    selection = {
      ...selection,
      elements: { ...(selection.elements ?? {}), [target.object.id]: fromElements(converted) },
    }
  }
  return {
    document: withView(context.document, { selectMode: ordered }),
    selection,
    label: ordered.length === 1 ? `${label(kind)} select` : 'Select mode',
    // Which kind of element is being picked is a way of looking, not a change to the document.
  }
}

function label(kind: SelectMode): string {
  return kind === 'vertex' ? 'Vertex' : kind === 'edge' ? 'Edge' : 'Face'
}

/**
 * The parameter type is written out rather than inferred: inference reads `false` as the literal
 * type `false`, and a switch that can only ever be false is a switch that does nothing.
 */
type ExtendParams = { extend: boolean }

for (const [kind, shortcut] of [['vertex', '1'], ['edge', '2'], ['face', '3']] as Array<[SelectMode, string]>) {
  registerOperator<ExtendParams>({
    id: `mode.select${label(kind)}`,
    label: `${label(kind)} select`,
    section: 'Mode',
    shortcut,
    description: `Pick ${kind === 'face' ? 'faces' : `${kind}s`}. Hold shift to pick more than one kind at a time.`,
    params: [switchParam('extend', 'Extend', false)],
    defaults: { extend: false },
    mode: 'edit',
    history: false,
    available: (context) => (context.document.view.mode === 'edit' ? true : 'This works in edit mode. Press Tab.'),
    run: (context, params) => setSelectMode(context, kind, params.extend),
  })
}
