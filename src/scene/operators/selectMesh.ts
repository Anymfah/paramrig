import {
  growSelection,
  invertSelection,
  propagateDown,
  propagateUp,
  selectAll,
  selectBoundary,
  selectByTrait,
  selectCheckerDeselect,
  selectLinked,
  selectLoop,
  selectNone,
  selectRandom,
  selectRing,
  selectSimilar,
  shrinkSelection,
  toElements,
  type ElementSelection,
  type MeshTrait,
  type SimilarTrait,
} from '@/scene/mesh/selection'
import { elementsFromSlots, requireEdit, runOnMeshes, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import {
  numberParam,
  selectParam,
  switchParam,
  type OperatorContext,
  type OperatorResult,
} from '@/scene/operators/types'
import type { SelectMode } from '@/scene/types'

/**
 * Blender's Select menu, in edit mode.
 *
 * Selecting is not editing: none of these leaves a history entry, because a person who selects four
 * faces and then undoes wants their last *edit* back, not their last click. They are still
 * operators, so they are still in the menus, the palette and the keymap, and so ⇧G with a different
 * trait in the F9 panel re-runs against what was selected before it.
 *
 * Everything here converts through `edit.ts`: the pure functions in `mesh/selection.ts` work in
 * ids, the viewport works in slots, and neither has to know about the other.
 */

/** The element kinds being picked. With several on, an operator runs for each in turn. */
function modes(context: OperatorContext): SelectMode[] {
  const chosen = context.view.selectMode
  const order: SelectMode[] = ['vertex', 'edge', 'face']
  const active = order.filter((mode) => chosen.includes(mode))
  return active.length > 0 ? active : ['vertex']
}

/** Slots for an outcome, from a selection written in ids. */
function slotsOf(target: EditTarget, elements: ElementSelection) {
  const vertices: number[] = []
  for (const id of elements.vertices) {
    const slot = target.mesh.slotOfVertex(id)
    if (slot >= 0) vertices.push(slot)
  }
  const faces: number[] = []
  for (const id of elements.faces) {
    const slot = target.mesh.slotOfFace(id)
    if (slot >= 0) faces.push(slot)
  }
  const edges: number[] = []
  for (const key of elements.edges) {
    const parts = key.split(':')
    const a = target.mesh.slotOfVertex(Number(parts[0]))
    const b = target.mesh.slotOfVertex(Number(parts[1]))
    if (a >= 0 && b >= 0) {
      const slot = target.mesh.edgeSlot(a, b)
      if (slot >= 0) edges.push(slot)
    }
  }
  return { vertices, edges, faces }
}

/** The shape every operator here takes: a selection in ids in, a selection in ids out. */
function selecting(
  context: OperatorContext,
  work: (target: EditTarget, elements: ElementSelection, mode: SelectMode) => ElementSelection,
  label: string,
): OperatorResult {
  return runOnMeshes(context, (target) => {
    let elements = toElements(context.selection, target.object.id)
    for (const mode of modes(context)) elements = work(target, elements, mode)
    // A selection is always kept whole: choosing a face means its edges and corners are chosen too,
    // which is what makes moving a face move its vertices.
    const flushed = propagateUp(target.mesh, propagateDown(target.mesh, elements))
    return { select: slotsOf(target, flushed) }
  }, { label })
}

/* ------------------------------------------------------------------ the all */

registerOperator({
  id: 'mesh.selectAll',
  label: 'Select all',
  section: 'Select',
  shortcut: 'A',
  description: 'Select every vertex, edge and face of the meshes being edited.',
  params: [],
  defaults: {},
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context),
  run: (context) => selecting(context, (target) => selectAll(target.mesh), 'Select all'),
})

registerOperator({
  id: 'mesh.selectNone',
  label: 'Select none',
  section: 'Select',
  shortcut: '⌥A',
  description: 'Deselect everything.',
  params: [],
  defaults: {},
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context),
  run: (context) => runOnMeshes(context, () => ({ select: {}, active: null }), { label: 'Select none' }),
})

registerOperator({
  id: 'mesh.selectInvert',
  label: 'Invert selection',
  section: 'Select',
  shortcut: '⌃I',
  description: 'Select what was not selected, and deselect what was.',
  params: [],
  defaults: {},
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context),
  run: (context) => runOnMeshes(context, (target) => {
    let elements = toElements(context.selection, target.object.id)
    for (const mode of modes(context)) elements = invertSelection(target.mesh, elements, mode)
    return { select: slotsOf(target, elements), active: null }
  }, { label: 'Invert selection' }),
})

/* ---------------------------------------------------------------- by degree */

registerOperator({
  id: 'mesh.selectMore',
  label: 'Select more',
  section: 'Select',
  shortcut: '⌃+',
  description: 'Grow the selection by one ring of neighbours.',
  params: [],
  defaults: {},
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context, 'any'),
  run: (context) => selecting(context, (target, elements, mode) => growSelection(target.mesh, elements, mode), 'Select more'),
})

registerOperator({
  id: 'mesh.selectLess',
  label: 'Select less',
  section: 'Select',
  shortcut: '⌃−',
  description: 'Shrink the selection by one ring, peeling it back from its border.',
  params: [],
  defaults: {},
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context, 'any'),
  run: (context) => selecting(context, (target, elements, mode) => shrinkSelection(target.mesh, elements, mode), 'Select less'),
})

/* -------------------------------------------------------------- by topology */

registerOperator({
  id: 'mesh.selectLinked',
  label: 'Select linked',
  section: 'Select',
  shortcut: '⌃L',
  description: 'Select everything joined to the selection.',
  params: [],
  defaults: {},
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context, 'any'),
  run: (context) => selecting(context, (target, elements) => selectLinked(target.mesh, elements), 'Select linked'),
})

registerOperator({
  id: 'mesh.selectBoundary',
  label: 'Select boundary loop',
  section: 'Select',
  description: 'Select the open border around the selected faces.',
  params: [],
  defaults: {},
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context, 'face'),
  run: (context) => selecting(context, (target, elements) => selectBoundary(target.mesh, elements), 'Select boundary loop'),
})

/**
 * ⌥ click and ⌃⌥ click. The viewport passes the edge it picked; run from the palette, the operator
 * works from the active edge instead, which is where a person's last click left it.
 */
type EdgeRunParams = { edge: number; extend: boolean }

function edgeRun(context: OperatorContext, params: EdgeRunParams, walk: typeof selectLoop, label: string): OperatorResult {
  const wanted = Number(params.edge ?? -1)
  const extend = params.extend
  return runOnMeshes(context, (target) => {
    const edge = wanted >= 0 && target.mesh.hasEdge(wanted)
      ? wanted
      : target.active?.kind === 'edge' ? target.active.slot : -1
    if (edge < 0 || !target.mesh.hasEdge(edge)) return 'Pick an edge first: hold ⌥ and click one.'
    const found = walk(target.mesh, edge)
    const base = extend ? toElements(context.selection, target.object.id) : selectNone()
    for (const id of found.vertices) base.vertices.add(id)
    for (const key of found.edges) base.edges.add(key)
    for (const id of found.faces) base.faces.add(id)
    return { select: slotsOf(target, base), active: { kind: 'edge', slot: edge } }
  }, { label })
}

registerOperator<EdgeRunParams>({
  id: 'mesh.selectLoop',
  label: 'Select edge loop',
  section: 'Select',
  shortcut: '⌥ click',
  description: 'Select the loop of edges running through the one picked.',
  params: [numberParam('edge', 'Edge', { min: -1, max: 1e9, step: 1, defaultValue: -1, view: 'stepper' }), switchParam('extend', 'Extend', false)],
  defaults: { edge: -1, extend: false },
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context),
  run: (context, params) => edgeRun(context, params, selectLoop, 'Select edge loop'),
})

registerOperator<EdgeRunParams>({
  id: 'mesh.selectRing',
  label: 'Select edge ring',
  section: 'Select',
  shortcut: '⌃⌥ click',
  description: 'Select the ring of edges facing the one picked across each quad.',
  params: [numberParam('edge', 'Edge', { min: -1, max: 1e9, step: 1, defaultValue: -1, view: 'stepper' }), switchParam('extend', 'Extend', false)],
  defaults: { edge: -1, extend: false },
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context),
  run: (context, params) => edgeRun(context, params, selectRing, 'Select edge ring'),
})

/* ------------------------------------------------------------------ by kind */

const SIMILAR_TRAITS: Array<{ value: SimilarTrait; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'area', label: 'Area' },
  { value: 'sides', label: 'Number of sides' },
  { value: 'valence', label: 'Amount of connecting edges' },
  { value: 'length', label: 'Length' },
]

registerOperator({
  id: 'mesh.selectSimilar',
  label: 'Select similar',
  section: 'Select',
  shortcut: '⇧G',
  description: 'Select everything that resembles what is already selected.',
  params: [
    selectParam('trait', 'Type', SIMILAR_TRAITS.map(({ value, label }) => ({ value, label })), 'normal'),
    numberParam('threshold', 'Threshold', { min: 0, max: 1, step: 0.01, defaultValue: 0.1, view: 'bar' }),
  ],
  defaults: { trait: 'normal', threshold: 0.1 },
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => selecting(
    context,
    (target, elements, mode) => selectSimilar(target.mesh, elements, mode, params.trait as SimilarTrait, Number(params.threshold)),
    'Select similar',
  ),
})

const TRAITS: Array<{ value: MeshTrait; label: string }> = [
  { value: 'non-manifold', label: 'Non manifold' },
  { value: 'loose', label: 'Loose geometry' },
  { value: 'interior', label: 'Interior faces' },
  { value: 'boundary', label: 'Boundary' },
]

registerOperator({
  id: 'mesh.selectByTrait',
  label: 'Select all by trait',
  section: 'Select',
  description: 'Select the parts of the mesh that share a property: loose, non manifold, interior.',
  params: [
    selectParam('trait', 'Trait', TRAITS.map(({ value, label }) => ({ value, label })), 'non-manifold'),
    numberParam('minSides', 'Fewest sides', { min: 3, max: 32, step: 1, defaultValue: 3, view: 'stepper' }),
    numberParam('maxSides', 'Most sides', { min: 3, max: 32, step: 1, defaultValue: 32, view: 'stepper' }),
  ],
  defaults: { trait: 'non-manifold', minSides: 3, maxSides: 32 },
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context),
  run: (context, params) => selecting(context, (target) => selectByTrait(
    target.mesh,
    params.trait as MeshTrait,
    { min: Number(params.minSides), max: Number(params.maxSides) },
  ), 'Select all by trait'),
})

registerOperator({
  id: 'mesh.selectRandom',
  label: 'Select random',
  section: 'Select',
  description: 'Select a share of the mesh at random, from a seed you can repeat.',
  params: [
    numberParam('ratio', 'Ratio', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' }),
    numberParam('seed', 'Seed', { min: 0, max: 9999, step: 1, defaultValue: 0, view: 'seed' }),
  ],
  defaults: { ratio: 0.5, seed: 0 },
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context),
  run: (context, params) => selecting(
    context,
    (target, _elements, mode) => selectRandom(target.mesh, mode, Number(params.ratio), Number(params.seed)),
    'Select random',
  ),
})

registerOperator({
  id: 'mesh.selectCheckerDeselect',
  label: 'Checker deselect',
  section: 'Select',
  description: 'Keep every nth element of the selection and drop the ones between.',
  params: [
    numberParam('nth', 'Deselected', { min: 1, max: 32, step: 1, defaultValue: 1, view: 'stepper' }),
    numberParam('skip', 'Selected', { min: 1, max: 32, step: 1, defaultValue: 1, view: 'stepper' }),
    numberParam('offset', 'Offset', { min: -32, max: 32, step: 1, defaultValue: 0, view: 'stepper' }),
  ],
  defaults: { nth: 1, skip: 1, offset: 0 },
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => selecting(
    context,
    (_target, elements, mode) => selectCheckerDeselect(elements, mode, Number(params.nth), Number(params.skip), Number(params.offset)),
    'Checker deselect',
  ),
})

/* ----------------------------------------------------------- from the mouse */

/**
 * What a click does, as an operator, so that a click and the palette land in the same place.
 * The viewport passes the element it picked; nothing else can know it.
 */
type PickParams = { kind: SelectMode; slot: number; extend: boolean; toggle: boolean; objectId?: string }

registerOperator<PickParams>({
  id: 'mesh.selectPick',
  label: 'Select element',
  section: 'Select',
  description: 'Select the element under the pointer. Shift adds to the selection.',
  params: [
    selectParam('kind', 'Kind', [
      { value: 'vertex', label: 'Vertex' },
      { value: 'edge', label: 'Edge' },
      { value: 'face', label: 'Face' },
    ], 'vertex'),
    numberParam('slot', 'Element', { min: -1, max: 1e9, step: 1, defaultValue: -1, view: 'stepper' }),
    switchParam('extend', 'Extend', false),
    switchParam('toggle', 'Toggle', false),
  ],
  defaults: { kind: 'vertex', slot: -1, extend: false, toggle: false },
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context),
  run: (context, params) => {
    const kind = params.kind
    const slot = Number(params.slot)
    // Which object was clicked comes from the viewport, which is the only thing that knows; run
    // from the palette there is no click, and the active object is what is meant.
    const objectId = params.objectId ?? context.selection.activeObjectId
    return runOnMeshes(context, (target) => {
      if (target.object.id !== objectId) {
        // A click in one object clears the others, the way Blender's does, unless it is extending.
        return params.extend || params.toggle ? null : { select: {} }
      }
      if (slot < 0) {
        return params.extend ? null : { select: {}, active: null }
      }
      const picked = elementsFromSlots(target.mesh, kind === 'vertex'
        ? { vertices: [slot] }
        : kind === 'edge' ? { edges: [slot] } : { faces: [slot] })
      const base = params.extend || params.toggle
        ? toElements(context.selection, target.object.id)
        : selectNone()
      const already = kind === 'vertex'
        ? [...picked.vertices].every((id) => base.vertices.has(id))
        : kind === 'edge'
          ? [...picked.edges].every((key) => base.edges.has(key))
          : [...picked.faces].every((id) => base.faces.has(id))
      if (params.toggle && already) {
        for (const id of picked.vertices) base.vertices.delete(id)
        for (const key of picked.edges) base.edges.delete(key)
        for (const id of picked.faces) base.faces.delete(id)
        return { select: slotsOf(target, base), active: null }
      }
      for (const id of picked.vertices) base.vertices.add(id)
      for (const key of picked.edges) base.edges.add(key)
      for (const id of picked.faces) base.faces.add(id)
      const flushed = propagateUp(target.mesh, propagateDown(target.mesh, base))
      return { select: slotsOf(target, flushed), active: { kind, slot } }
    }, { label: 'Select element' })
  },
})

/* -------------------------------------------------------- box, circle, lasso */

type RegionFound = { objectId: string; vertices: number[]; edges: number[]; faces: number[] }
type RegionParams = { mode: string; found: RegionFound[] }

/**
 * `found` is deliberately absent from the schema, exactly as the object-mode region operators leave
 * their `ids` out: what a drag covered is not something a person types, and the F9 panel is left
 * offering the one field Blender lets you change afterwards.
 */
registerOperator<RegionParams>({
  id: 'mesh.selectRegion',
  label: 'Select region',
  section: 'Select',
  description: 'Select the elements a dragged box, circle or lasso covered.',
  params: [selectParam('mode', 'Mode', [
    { value: 'new', label: 'New' },
    { value: 'extend', label: 'Extend' },
    { value: 'subtract', label: 'Subtract' },
  ], 'new')],
  defaults: { mode: 'new', found: [] },
  mode: 'edit',
  history: false,
  available: (context) => requireEdit(context),
  run: (context, params) => runOnMeshes(context, (target) => {
    const covered = params.found.find((entry) => entry.objectId === target.object.id)
    const base = params.mode === 'new' ? selectNone() : toElements(context.selection, target.object.id)
    if (!covered) {
      // A drag that missed this object clears it when it is a new selection, and leaves it alone
      // when it is adding to one: an object nobody dragged over should not lose what it had.
      return params.mode === 'new' ? { select: {} } : null
    }
    const picked = elementsFromSlots(target.mesh, covered)
    if (params.mode === 'subtract') {
      for (const id of picked.vertices) base.vertices.delete(id)
      for (const key of picked.edges) base.edges.delete(key)
      for (const id of picked.faces) base.faces.delete(id)
      return { select: slotsOf(target, propagateUp(target.mesh, base)) }
    }
    for (const id of picked.vertices) base.vertices.add(id)
    for (const key of picked.edges) base.edges.add(key)
    for (const id of picked.faces) base.faces.add(id)
    return { select: slotsOf(target, propagateUp(target.mesh, propagateDown(target.mesh, base))) }
  }, { label: 'Select region' }),
})
