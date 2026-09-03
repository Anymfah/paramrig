import type { ParameterDef, ParamValue } from '@/rigs/types'
import type { EditorMode, SceneDocument, SceneObject, SceneSelection, Vec3, ViewState } from '@/scene/types'

/**
 * Everything an operator can be asked to do, and everything it is allowed to know.
 *
 * An operator is the one shape every editing action in the scene editor takes: adding a cube,
 * extruding a face, setting an origin, joining two objects. Because they are all one shape, the
 * menus, the palette, the keymap, the "Adjust last operation" panel, the tooltips and the
 * documentation are all *derived* from the registry rather than written out four times and left to
 * drift apart. An operator is a pure function of a document and its parameters, which is what lets
 * the F9 panel replay it against the document as it was before, with different numbers.
 */

/** An operator's parameters, addressed by the ids in its schema. */
export type OperatorParams = Record<string, ParamValue>

/** The panel's fields, in the order they are shown. Each `id` is a key in the operator's params. */
export type ParamSchema = ParameterDef[]

export type OperatorContext = {
  document: SceneDocument
  selection: SceneSelection
  mode: EditorMode
  view: ViewState
  cursor: { position: Vec3; rotation: Vec3 }
  /** The object the last click landed on; the one an operator that needs a target uses. */
  active: SceneObject | null
  /** Where the pointer was when the operator ran, for the operators placed by pointing. */
  pointer?: { world: Vec3 | null; screen: [number, number] }
}

export type OperatorResult = {
  document?: SceneDocument
  selection?: SceneSelection
  /** What the history entry is called. Defaults to the operator's label. */
  label?: string
  /** Set instead of a document when the operator declines; shown in the status bar, never silent. */
  error?: string
}

/**
 * Whether an operator can run here. `true` means yes; a string is the reason it cannot, which is
 * what a greyed-out menu entry says in its tooltip — a refusal a person can read beats one they
 * have to guess at.
 */
export type Availability = true | string

export type OperatorSection =
  | 'Add' | 'Object' | 'Mesh' | 'Vertex' | 'Edge' | 'Face' | 'UV'
  | 'Select' | 'View' | 'Transform' | 'Collection' | 'File' | 'Mode'

export type Operator<Params extends OperatorParams = OperatorParams> = {
  id: string
  label: string
  section: OperatorSection
  /** Shown in menus and tooltips, written the way the keymap writes it: `⇧D`, `⌃R`, `Numpad .`. */
  shortcut?: string
  /** The name of an icon in `src/scene/icons.tsx`. */
  icon?: string
  /** One line for the tooltip and the generated documentation. */
  description?: string
  params: ParamSchema
  defaults: Params
  /** A modal operator takes over the pointer until Escape or a click; the header says so. */
  modal?: boolean
  /**
   * Set to false for an operator that changes the document but does not belong in the history.
   * Moving the view is the only such thing: nobody wants their last five undos to be camera moves.
   */
  history?: boolean
  /** Which mode it belongs to. An operator with no mode is offered in both. */
  mode?: EditorMode
  available: (context: OperatorContext) => Availability
  run: (context: OperatorContext, params: Params) => OperatorResult
}

/** The defaults an operator's schema declares, which is what the F9 panel starts from. */
export function schemaDefaults(schema: ParamSchema): OperatorParams {
  return Object.fromEntries(schema.map((param) => [param.id, param.defaultValue as ParamValue]))
}

/** Params with anything missing filled in from the schema, so a partial replay is still valid. */
export function withDefaults<Params extends OperatorParams>(operator: Operator<Params>, params: Partial<Params>): Params {
  return { ...operator.defaults, ...params } as Params
}

/**
 * A parameter of an operator, written the short way. The group is the operator's own id, so the
 * F9 panel and the sidebar can lay several operators' fields out without their ids colliding.
 */
export function numberParam(id: string, label: string, options: {
  min: number
  max: number
  step: number
  defaultValue: number
  unit?: string
  view?: 'field' | 'stepper' | 'bar' | 'knob' | 'angle' | 'seed'
  scale?: 'linear' | 'log'
}): ParameterDef {
  return {
    kind: 'number',
    id,
    label,
    group: 'operator',
    min: options.min,
    max: options.max,
    step: options.step,
    defaultValue: options.defaultValue,
    ...(options.unit ? { unit: options.unit } : {}),
    view: options.view ?? 'field',
    ...(options.scale ? { scale: options.scale } : {}),
  }
}

export function switchParam(id: string, label: string, defaultValue: boolean): ParameterDef {
  return { kind: 'switch', id, label, group: 'operator', defaultValue }
}

export function selectParam(id: string, label: string, options: Array<{ value: string; label: string }>, defaultValue: string): ParameterDef {
  return { kind: 'select', id, label, group: 'operator', options, defaultValue }
}

export function vectorParam(id: string, label: string, options: {
  defaultValue: Vec3
  min?: number
  max?: number
  step?: number
  unit?: string
  axes?: string[]
  view?: 'fields' | 'xy' | 'dimensions' | 'direction' | 'rotation' | 'anchor'
}): ParameterDef {
  return {
    kind: 'vector',
    id,
    label,
    group: 'operator',
    defaultValue: [...options.defaultValue],
    axes: options.axes ?? ['X', 'Y', 'Z'],
    min: options.min ?? -1e6,
    max: options.max ?? 1e6,
    step: options.step ?? 0.1,
    ...(options.unit ? { unit: options.unit } : {}),
    ...(options.view ? { view: options.view } : {}),
  }
}

export function colorParam(id: string, label: string, defaultValue: string): ParameterDef {
  return { kind: 'color', id, label, group: 'operator', defaultValue }
}
