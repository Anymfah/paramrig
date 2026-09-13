import type { ParamValue, ParameterDef } from '@/rigs/types'
import { collectionHidden, collectionSelectable, descendantObjectIds } from '@/scene/model'
import { registerOperator } from '@/scene/operators/registry'
import { numberParam, selectParam, switchParam, type OperatorContext } from '@/scene/operators/types'
import type { SceneObject, SceneObjectKind, SceneSelection } from '@/scene/types'

/**
 * Choosing what to work on.
 *
 * In object mode a selection is a list of object ids with the last-clicked one active; the active
 * object is what the properties show and what "join to the active" joins into, so it is tracked
 * separately rather than being "the last in the list".
 *
 * Two decisions shape the family. The region selections — box, circle, lasso — are *given* the
 * result of the pick rather than doing it: the viewport is the only thing that knows what a drag
 * covered, so it hands the ids over as a parameter and the operator's whole job is folding them
 * into the selection. That fold is `applySelectMode`, which is therefore testable without a
 * renderer and is the one place the five modes are written down. And every selection that grows an
 * existing one — similar, grouped, pattern, random, by type — extends rather than replaces, the
 * way Blender's do; running `select.none` first is how a person replaces instead.
 */

function selectable(context: OperatorContext): SceneObject[] {
  const local = context.document.view.localObjectIds
  return context.document.objects.filter((object) => {
    if (!object.selectable || !object.visible) return false
    if (local && local.length > 0 && !local.includes(object.id)) return false
    if (collectionHidden(context.document, object.collectionId)) return false
    return collectionSelectable(context.document, object.collectionId)
  })
}

/**
 * The selection with a new list of ids and an active object that is certainly in it. An active id
 * left pointing at something no longer selected is the kind of state the properties panel reads
 * and draws nothing for, so it is resolved here rather than at every call site.
 */
function withSelection(selection: SceneSelection, ids: string[]): SceneSelection {
  const active = selection.activeObjectId
  return {
    ...selection,
    objectIds: ids,
    activeObjectId: active !== null && ids.includes(active) ? active : ids.at(-1) ?? null,
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

/** The options of a select field, and the narrowing back, written once for the whole family. */
function options<Value extends string>(values: readonly Value[], labels: Record<Value, string>): Array<{ value: string; label: string }> {
  return values.map((value) => ({ value, label: labels[value] }))
}

function chosen<Value extends string>(values: readonly Value[], given: ParamValue, fallback: Value): Value {
  return values.find((value) => value === given) ?? fallback
}

/* ----------------------------------------------------------- the vocabulary */

const OBJECT_KINDS: readonly SceneObjectKind[] = ['mesh', 'light', 'camera', 'empty', 'curve', 'text']

// A record over the union rather than a list of pairs: a kind added to the document one day is a
// compile error here, not a menu entry with no label.
const OBJECT_KIND_LABELS: Record<SceneObjectKind, string> = {
  mesh: 'Mesh',
  light: 'Light',
  camera: 'Camera',
  empty: 'Empty',
  curve: 'Curve',
  text: 'Text',
}

/** How a region selection folds what it covered into what was already selected. */
export const REGION_SELECT_MODES = ['new', 'extend', 'subtract', 'invert', 'intersect'] as const

export type RegionSelectMode = (typeof REGION_SELECT_MODES)[number]

const REGION_SELECT_MODE_LABELS: Record<RegionSelectMode, string> = {
  new: 'New',
  extend: 'Extend',
  subtract: 'Subtract',
  invert: 'Invert',
  intersect: 'Intersect',
}

const SIMILAR_TRAITS = ['type', 'collection', 'material', 'data'] as const
type SimilarTrait = (typeof SIMILAR_TRAITS)[number]
const SIMILAR_TRAIT_LABELS: Record<SimilarTrait, string> = {
  type: 'Type',
  collection: 'Collection',
  material: 'Material',
  data: 'Mesh data',
}

const GROUPINGS = ['collection', 'parent', 'children', 'siblings', 'type'] as const
type Grouping = (typeof GROUPINGS)[number]
const GROUPING_LABELS: Record<Grouping, string> = {
  collection: 'Collection',
  parent: 'Parent',
  children: 'Children',
  siblings: 'Siblings',
  type: 'Type',
}

/* ------------------------------------------------------------ all and none */

registerOperator({
  id: 'select.all',
  label: 'All',
  section: 'Select',
  shortcut: 'A',
  description: 'Select everything that can be selected.',
  params: [],
  defaults: {},
  available: (context) => (selectable(context).length > 0 ? true : 'There is nothing here to select.'),
  run: (context) => ({
    selection: withSelection(context.selection, selectable(context).map((object) => object.id)),
    label: 'Select all',
  }),
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
    return { selection: withSelection(context.selection, ids), label: 'Invert selection' }
  },
})

/* -------------------------------------------------- box, circle and lasso */

/**
 * What a region drag does to the selection, given what it covered.
 *
 * The order is part of the answer, not an accident of the implementation: the selection is a list
 * in the order things were picked and its last entry is the fallback active object, so what was
 * already selected keeps its place and what the region adds arrives after it.
 */
export function applySelectMode(current: string[], found: string[], mode: RegionSelectMode): string[] {
  const covered = new Set(found)
  const already = new Set(current)
  if (mode === 'new') return unique(found)
  if (mode === 'subtract') return current.filter((id) => !covered.has(id))
  if (mode === 'intersect') return current.filter((id) => covered.has(id))
  // Invert toggles: what the region covered and was selected comes out, the rest goes in.
  const kept = mode === 'invert' ? current.filter((id) => !covered.has(id)) : current
  return [...kept, ...unique(found).filter((id) => !already.has(id))]
}

const REGION_MODE = selectParam('mode', 'Mode', options(REGION_SELECT_MODES, REGION_SELECT_MODE_LABELS), 'new')

type RegionParams = { mode: string; ids: string[] }

/**
 * `ids` is deliberately absent from the schema. The viewport fills it from what the drag covered,
 * which is not something a person types; the F9 panel is left offering the mode alone, which is
 * exactly the field Blender lets you change after the fact.
 */
function regionOperator(id: string, label: string, icon: string, description: string, shortcut?: string): void {
  registerOperator<RegionParams>({
    id,
    label,
    section: 'Select',
    ...(shortcut ? { shortcut } : {}),
    icon,
    description,
    params: [REGION_MODE],
    defaults: { mode: 'new', ids: [] },
    available: (context) => (selectable(context).length > 0 ? true : 'There is nothing here to select.'),
    run: (context, params) => {
      // Replaying the drag from the F9 panel replays its ids too, and an object may have been
      // deleted since; anything that is no longer there to select is dropped rather than kept.
      const allowed = new Set(selectable(context).map((object) => object.id))
      const found = params.ids.filter((entry) => allowed.has(entry))
      const ids = applySelectMode(context.selection.objectIds, found, chosen(REGION_SELECT_MODES, params.mode, 'new'))
      return { selection: withSelection(context.selection, ids), label }
    },
  })
}

regionOperator('select.box', 'Box select', 'select-box', 'Select everything a dragged rectangle covers.', 'B')
regionOperator('select.circle', 'Circle select', 'select-circle', 'Paint over what to select with a round brush.', 'C')
regionOperator('select.lasso', 'Lasso select', 'select-lasso', 'Select everything a freehand loop encloses.')

/* --------------------------------------------------------------- by trait */

function sharesTrait(object: SceneObject, active: SceneObject, trait: SimilarTrait): boolean {
  switch (trait) {
    case 'type':
      return object.kind === active.kind
    case 'collection':
      return object.collectionId === active.collectionId
    case 'material':
      return object.materialSlots.some((id) => active.materialSlots.includes(id))
    case 'data':
      return object.data.kind === 'mesh' && active.data.kind === 'mesh' && object.data.meshId === active.data.meshId
  }
}

registerOperator({
  id: 'select.similar',
  label: 'Select similar',
  section: 'Select',
  shortcut: '⇧G',
  description: 'Add everything that shares a trait with the active object.',
  params: [selectParam('trait', 'Trait', options(SIMILAR_TRAITS, SIMILAR_TRAIT_LABELS), 'type')],
  defaults: { trait: 'type' },
  available: (context) => (context.active ? true : 'Nothing is active to compare against.'),
  run: (context, params) => {
    const active = context.active
    if (!active) return { error: 'Nothing is active to compare against.' }
    const trait = chosen(SIMILAR_TRAITS, params.trait, 'type')
    // Two objects share data when they show the same mesh; an object with no mesh has nothing for
    // that question to be about, so it is refused rather than answered with an empty selection.
    if (trait === 'data' && active.data.kind !== 'mesh') return { error: 'The active object has no mesh data to match.' }
    const found = selectable(context).filter((object) => sharesTrait(object, active, trait)).map((object) => object.id)
    return { selection: withSelection(context.selection, applySelectMode(context.selection.objectIds, found, 'extend')), label: 'Select similar' }
  },
})

function groupedIds(context: OperatorContext, active: SceneObject, by: Grouping): string[] {
  const objects = context.document.objects
  switch (by) {
    case 'collection':
      return objects.filter((object) => object.collectionId === active.collectionId).map((object) => object.id)
    case 'parent':
      return active.parentId ? [active.parentId] : []
    case 'children':
      return descendantObjectIds(context.document, active.id)
    case 'siblings':
      return objects.filter((object) => object.id !== active.id && object.parentId === active.parentId).map((object) => object.id)
    case 'type':
      return objects.filter((object) => object.kind === active.kind).map((object) => object.id)
  }
}

registerOperator({
  id: 'select.grouped',
  label: 'Select grouped',
  section: 'Select',
  description: 'Add everything grouped with the active object the same way.',
  params: [selectParam('by', 'Grouped by', options(GROUPINGS, GROUPING_LABELS), 'collection')],
  defaults: { by: 'collection' },
  available: (context) => (context.active ? true : 'Nothing is active to group from.'),
  run: (context, params) => {
    const active = context.active
    if (!active) return { error: 'Nothing is active to group from.' }
    const by = chosen(GROUPINGS, params.by, 'collection')
    if (by === 'parent' && !active.parentId) return { error: 'The active object has no parent.' }
    const allowed = new Set(selectable(context).map((object) => object.id))
    const found = groupedIds(context, active, by).filter((id) => allowed.has(id))
    if (found.length === 0) return { error: 'Nothing is grouped with the active object that way.' }
    return { selection: withSelection(context.selection, applySelectMode(context.selection.objectIds, found, 'extend')), label: 'Select grouped' }
  },
})

/* -------------------------------------------------------------- by name */

/**
 * Blender's name matching, which is glob and not regular expression: `*` stands for any run of
 * characters and `?` for exactly one, and every other character stands for itself. Writing the
 * matcher out rather than translating to a `RegExp` is the point — a name like `Cube.001` or
 * `Bolt+Nut` is ordinary, and handing either to a regular expression would quietly match the wrong
 * objects. The loop remembers the last `*` it passed so it can give a character back to it and
 * try again, which is how one pass handles several stars without recursion.
 */
function matchesPattern(name: string, pattern: string): boolean {
  let nameIndex = 0
  let patternIndex = 0
  let starPattern = -1
  let starName = 0
  while (nameIndex < name.length) {
    const token = pattern[patternIndex]
    if (token === '*') {
      starPattern = patternIndex
      starName = nameIndex
      patternIndex += 1
    } else if (token !== undefined && (token === '?' || token === name[nameIndex])) {
      patternIndex += 1
      nameIndex += 1
    } else if (starPattern >= 0) {
      patternIndex = starPattern + 1
      starName += 1
      nameIndex = starName
    } else {
      return false
    }
  }
  while (pattern[patternIndex] === '*') patternIndex += 1
  return patternIndex === pattern.length
}

const PATTERN: ParameterDef = {
  kind: 'text',
  id: 'pattern',
  label: 'Pattern',
  group: 'operator',
  defaultValue: '*',
  maxLength: 120,
}

registerOperator({
  id: 'select.pattern',
  label: 'Select pattern',
  section: 'Select',
  description: 'Add every object whose name matches, with * and ? as wildcards.',
  params: [PATTERN, switchParam('caseSensitive', 'Case sensitive', false)],
  defaults: { pattern: '*', caseSensitive: false },
  available: (context) => (selectable(context).length > 0 ? true : 'There is nothing here to select.'),
  run: (context, params) => {
    const pattern = params.pattern.trim()
    if (!pattern) return { error: 'Type a pattern to match, such as “Cube*”.' }
    const wanted = params.caseSensitive ? pattern : pattern.toLowerCase()
    const found = selectable(context)
      .filter((object) => matchesPattern(params.caseSensitive ? object.name : object.name.toLowerCase(), wanted))
      .map((object) => object.id)
    if (found.length === 0) return { error: 'No name matches that pattern.' }
    return { selection: withSelection(context.selection, applySelectMode(context.selection.objectIds, found, 'extend')), label: 'Select pattern' }
  },
})

/* --------------------------------------------------------------- at random */

/**
 * A xorshift, seeded from the operator's own parameter, because a random selection has to come
 * back the same when the F9 panel replays it or ⇧R repeats it — `Math.random` would give a
 * different set every time the panel's ratio moved by a hundredth.
 */
function randomSequence(seed: number): () => number {
  // Zero is the one state a xorshift cannot leave, so a zero seed starts from the golden ratio
  // constant instead. The seed a person sees is still their own.
  let state = Math.floor(seed) | 0 || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

registerOperator({
  id: 'select.random',
  label: 'Select random',
  section: 'Select',
  description: 'Add a repeatable random share of the objects.',
  params: [
    numberParam('ratio', 'Ratio', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' }),
    numberParam('seed', 'Seed', { min: 0, max: 10000, step: 1, defaultValue: 0, view: 'seed' }),
  ],
  defaults: { ratio: 0.5, seed: 0 },
  available: (context) => (selectable(context).length > 0 ? true : 'There is nothing here to select.'),
  run: (context, params) => {
    const ratio = Math.min(1, Math.max(0, params.ratio))
    const next = randomSequence(params.seed)
    // One draw per candidate, in document order: the same document and the same seed therefore
    // give the same set, whatever the ratio is set to afterwards.
    const found = selectable(context).filter(() => next() < ratio).map((object) => object.id)
    return { selection: withSelection(context.selection, applySelectMode(context.selection.objectIds, found, 'extend')), label: 'Select random' }
  },
})

/* --------------------------------------------------------------- by kind */

registerOperator({
  id: 'select.allByType',
  label: 'All by type',
  section: 'Select',
  description: 'Add every object of one kind.',
  params: [selectParam('kind', 'Type', options(OBJECT_KINDS, OBJECT_KIND_LABELS), 'mesh')],
  defaults: { kind: 'mesh' },
  available: (context) => (selectable(context).length > 0 ? true : 'There is nothing here to select.'),
  run: (context, params) => {
    const kind = chosen(OBJECT_KINDS, params.kind, 'mesh')
    const found = selectable(context).filter((object) => object.kind === kind).map((object) => object.id)
    if (found.length === 0) return { error: `There is no ${OBJECT_KIND_LABELS[kind].toLowerCase()} object here to select.` }
    return { selection: withSelection(context.selection, applySelectMode(context.selection.objectIds, found, 'extend')), label: `Select all ${OBJECT_KIND_LABELS[kind].toLowerCase()} objects` }
  },
})

/* ------------------------------------------------------------ linked data */

registerOperator({
  id: 'select.linkedData',
  label: 'Linked data',
  section: 'Select',
  description: 'Add every object showing the same mesh as the active one.',
  params: [],
  defaults: {},
  available: (context) => {
    if (!context.active) return 'Nothing is active to compare against.'
    if (context.active.data.kind !== 'mesh') return 'The active object has no mesh data to match.'
    return true
  },
  run: (context) => {
    const active = context.active
    if (!active || active.data.kind !== 'mesh') return { error: 'The active object has no mesh data to match.' }
    const found = selectable(context).filter((object) => sharesTrait(object, active, 'data')).map((object) => object.id)
    return { selection: withSelection(context.selection, applySelectMode(context.selection.objectIds, found, 'extend')), label: 'Select linked data' }
  },
})
