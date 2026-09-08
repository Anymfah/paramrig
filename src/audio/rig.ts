import type { InspectorCategory, ParameterDef, ParamGroup, ParamValue } from '@/rigs/types'
import { applyTransform, type BindingTransform } from '@/rigs/binding'
// The controls are the workbench's own, so reading them back is shared with the other two editors.
import { MAX_BINDINGS, MAX_PARAMETERS, rigText as text, sanitizeCategories, sanitizeGroups, sanitizeParameter } from '@/rigs/sanitize'
import { LINEAR } from '@/audio/dsp/curve'
import {
  AUDIO_FIELDS, LAYER_COUNT, LAYER_SECTIONS, TIME_UNITS,
  type AudioPropertyType, type FieldSpec, type LayerSection,
} from '@/audio/fields'
import type { AudioPatch, Layer } from '@/audio/types'

export { applyTransform, controlId, type BindingTransform } from '@/rigs/binding'
export { AUDIO_FIELDS, LAYER_COUNT, LAYER_SECTIONS, type AudioPropertyType, type FieldSpec, type LayerSection } from '@/audio/fields'

/**
 * A patch is a fixed chain, so a path addresses its target completely on its own — there is no
 * object id the way a drawing has an element and a scene has an object. `layers[0].pitch.start`
 * names one number and there is only ever one of it. That is the fixed chain paying for itself a
 * second time: the binding model is a field shorter than either of its siblings.
 */
export type AudioBinding = {
  id: string
  property: string
  parameterId: string
  transform?: BindingTransform
}

/** What a patch adds to become a rig: the controls, and where they write. */
export type AudioRig = {
  groups: ParamGroup[]
  parameters: ParameterDef[]
  inspectorCategories?: InspectorCategory[]
  bindings: AudioBinding[]
}

export type AudioPath =
  | { kind: 'patch'; field: string; spec: FieldSpec }
  | { kind: 'layer'; index: number; section: LayerSection; field: string; spec: FieldSpec }
  | { kind: 'fx'; field: string; spec: FieldSpec }
  | { kind: 'master'; field: string; spec: FieldSpec }

/**
 * Reads a property path, or refuses it. A path this does not know is never guessed at: a binding
 * that writes to something which does not exist is a binding that does nothing while looking as
 * though it works.
 */
export function parseAudioProperty(property: string): AudioPath | null {
  const patch = AUDIO_FIELDS.patch[property]
  if (patch) return { kind: 'patch', field: property, spec: patch }

  const layer = /^layers\[(\d+)\]\.(?:([a-z]+)\.)?([A-Za-z]+)$/.exec(property)
  if (layer) {
    const index = Number(layer[1])
    if (!Number.isInteger(index) || index < 0 || index >= LAYER_COUNT) return null
    const section = (layer[2] ?? 'root') as LayerSection
    if (!Object.hasOwn(LAYER_SECTIONS, section)) return null
    const field = layer[3] ?? ''
    const spec = LAYER_SECTIONS[section][field]
    return spec ? { kind: 'layer', index, section, field, spec } : null
  }

  const fx = /^fx\.([A-Za-z]+)$/.exec(property)
  if (fx) {
    const spec = AUDIO_FIELDS.fx[fx[1] ?? '']
    return spec ? { kind: 'fx', field: fx[1] ?? '', spec } : null
  }

  const master = /^master\.([A-Za-z]+)$/.exec(property)
  if (master) {
    const spec = AUDIO_FIELDS.master[master[1] ?? '']
    return spec ? { kind: 'master', field: master[1] ?? '', spec } : null
  }

  return null
}

/**
 * Every path a binding may name, generated from the same tables the parser reads. The docs page
 * renders this, so a field the synthesiser gains is a documented row on the same commit and a
 * field it loses cannot linger in the documentation.
 */
export const AUDIO_PROPERTY_PATHS: { property: string; label: string; type: AudioPropertyType }[] = [
  ...Object.entries(AUDIO_FIELDS.patch).map(([field, spec]) => ({ property: field, label: spec.label, type: spec.type })),
  ...(Object.keys(LAYER_SECTIONS) as LayerSection[]).flatMap((section) =>
    Object.entries(LAYER_SECTIONS[section]).map(([field, spec]) => ({
      property: section === 'root' ? `layers[i].${field}` : `layers[i].${section}.${field}`,
      label: spec.label,
      type: spec.type,
    })),
  ),
  ...Object.entries(AUDIO_FIELDS.fx).map(([field, spec]) => ({ property: `fx.${field}`, label: spec.label, type: spec.type })),
  ...Object.entries(AUDIO_FIELDS.master).map(([field, spec]) => ({ property: `master.${field}`, label: spec.label, type: spec.type })),
]

/** The parameter kinds that can drive a field of that type. */
export const KINDS_FOR_AUDIO_TYPE: Record<AudioPropertyType, string[]> = {
  number: ['number', 'vector', 'curve'],
  boolean: ['switch'],
  option: ['select', 'text'],
  curve: ['curve'],
}

export function kindForAudioProperty(type: AudioPropertyType): string {
  return KINDS_FOR_AUDIO_TYPE[type][0]!
}

function asNumber(value: ParamValue): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0]
  return null
}

/** The value a field will take, already clamped to what the field admits. */
function coerce(spec: FieldSpec, value: ParamValue, transform: BindingTransform | undefined, resolve: (id: string) => number): unknown {
  if (spec.type === 'boolean') return Boolean(value)
  if (spec.type === 'option') {
    return typeof value === 'string' && spec.options?.includes(value) ? value : null
  }
  if (spec.type === 'curve') {
    return value && typeof value === 'object' && !Array.isArray(value) && (value as { type?: unknown }).type === 'cubic-bezier' ? value : null
  }
  const raw = asNumber(value)
  if (raw === null) return null
  const next = applyTransform(raw, transform, resolve)
  if (!Number.isFinite(next)) return null
  const min = spec.min ?? -Infinity
  const max = spec.max ?? Infinity
  return Math.min(max, Math.max(min, next))
}

/**
 * One binding written onto a patch. The structure is fixed and shallow, so this rebuilds only the
 * branch it touches and returns the patch unchanged when the value cannot be applied.
 */
export function applyAudioBinding(patch: AudioPatch, binding: AudioBinding, value: ParamValue, resolve: (id: string) => number): AudioPatch {
  const path = parseAudioProperty(binding.property)
  if (!path) return patch
  const next = coerce(path.spec, value, binding.transform, resolve)
  if (next === null) return patch

  if (path.kind === 'patch') return { ...patch, [path.field]: next }
  if (path.kind === 'fx') return { ...patch, fx: { ...patch.fx, [path.field]: next } }
  if (path.kind === 'master') return { ...patch, master: { ...patch.master, [path.field]: next } }

  const layer = patch.layers[path.index]
  if (!layer) return patch
  // The section names one of the layer's own objects, and the parser has already checked it is
  // one of them, so this narrow cast is the whole of the dynamic write.
  const written = path.section === 'root'
    ? { ...layer, [path.field]: next }
    : { ...layer, [path.section]: { ...(layer[path.section] as object), [path.field]: next } }
  return { ...patch, layers: patch.layers.map((entry, index) => (index === path.index ? written as Layer : entry)) }
}

let cachePatch: AudioPatch | null = null
let cacheRig: AudioRig | undefined
let cacheValues = ''
let cacheResult: AudioPatch | null = null

/**
 * The patch as its controls say it should sound. Pure, and the twin of `resolveRigValues`: the
 * editor always writes to the raw patch, and this is what the player, the waveform view and the
 * exporter render. Memoised on the last set of values, because a drag asks for the same one many
 * times a second and rendering a buffer is not free.
 */
export function resolveAudioValues(document: { id: string; updatedAt: string; patch: AudioPatch; rig?: AudioRig }, values: Record<string, ParamValue>): AudioPatch {
  const rig = document.rig
  if (!rig || rig.bindings.length === 0) return document.patch
  // Keyed on the patch itself rather than on the document's timestamp. A patch can be replaced
  // without its `updatedAt` moving — an editor writing state, a save that keeps the stamp — and a
  // memo that trusted the stamp would go on serving the sound the patch used to make.
  const key = JSON.stringify(values)
  if (cachePatch === document.patch && cacheRig === rig && key === cacheValues && cacheResult) return cacheResult
  const known = new Set(rig.parameters.map((parameter) => parameter.id))
  const resolve = (id: string) => {
    const value = values[id]
    if (typeof value !== 'number') throw new Error(`Not a numeric control: ${id}`)
    return value
  }
  // The last binding on a property wins, which is what writing them in order gives.
  const resolved = rig.bindings.reduce(
    (current, binding) => (known.has(binding.parameterId) ? applyAudioBinding(current, binding, values[binding.parameterId] ?? null, resolve) : current),
    document.patch,
  )
  cachePatch = document.patch
  cacheRig = rig
  cacheValues = key
  cacheResult = resolved
  return resolved
}

/** Drops the memo, so a test can watch the work happen. */
export function clearAudioRigCache(): void {
  cachePatch = null
  cacheRig = undefined
  cacheValues = ''
  cacheResult = null
}

/** What a field reads right now, so a fresh control starts where the patch already is. */
export function currentAudioValue(patch: AudioPatch, property: string): ParamValue {
  const path = parseAudioProperty(property)
  if (!path) return null
  const read = (source: object, field: string): ParamValue => {
    const value = (source as Record<string, unknown>)[field]
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
    return value && typeof value === 'object' ? (value as ParamValue) : null
  }
  if (path.kind === 'patch') return read(patch, path.field)
  if (path.kind === 'fx') return read(patch.fx, path.field)
  if (path.kind === 'master') return read(patch.master, path.field)
  const layer = patch.layers[path.index]
  if (!layer) return null
  return path.section === 'root' ? read(layer, path.field) : read(layer[path.section] as object, path.field)
}

/** A control built for a field, taking its bounds from the field and its default from the patch. */
export function parameterForAudioProperty(options: {
  id: string
  label: string
  group: string
  property: string
  patch: AudioPatch
}): ParameterDef | null {
  const path = parseAudioProperty(options.property)
  if (!path) return null
  const { spec } = path
  const base = { id: options.id, label: options.label, group: options.group }
  const value = currentAudioValue(options.patch, options.property)

  if (spec.type === 'boolean') return { ...base, kind: 'switch', defaultValue: value !== false }
  if (spec.type === 'option') {
    const choices = spec.options ?? []
    return {
      ...base,
      kind: 'select',
      options: choices.map((choice) => ({ value: choice, label: choice.charAt(0).toUpperCase() + choice.slice(1) })),
      defaultValue: typeof value === 'string' && choices.includes(value) ? value : (choices[0] ?? ''),
    }
  }
  if (spec.type === 'curve') {
    const curve = value && typeof value === 'object' && !Array.isArray(value) ? value : LINEAR
    return { ...base, kind: 'curve', defaultValue: curve as typeof LINEAR }
  }
  const min = spec.min ?? 0
  const max = spec.max ?? 1
  return {
    ...base,
    kind: 'number',
    min,
    max: max > min ? max : min + 1,
    step: spec.step ?? 0.01,
    defaultValue: typeof value === 'number' ? Math.min(max, Math.max(min, value)) : min,
    ...(spec.unit ? { unit: spec.unit } : {}),
    ...(spec.scale ? { scale: spec.scale } : {}),
    ...(spec.unit === 'ms' ? { units: TIME_UNITS } : {}),
  }
}

/** A readable name for a field, used when it is first exposed. */
export function audioPropertyLabel(property: string): string {
  const path = parseAudioProperty(property)
  if (!path) return property
  if (path.kind === 'layer') return `Layer ${path.index + 1} · ${path.spec.label}`
  return path.spec.label
}

/** A binding is kept only when both ends of it exist. */
function sanitizeBinding(value: unknown, parameterIds: Set<string>): AudioBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const parameterId = text(source.parameterId, 60)
  const property = text(source.property, 120)
  if (!parameterId || !property) return null
  if (!parameterIds.has(parameterId)) return null
  if (!parseAudioProperty(property)) return null
  const raw = source.transform && typeof source.transform === 'object' ? source.transform as Record<string, unknown> : null
  const transform: BindingTransform = {}
  if (raw) {
    for (const key of ['min', 'max', 'scale', 'offset'] as const) {
      if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) transform[key] = raw[key] as number
    }
    const expression = text(raw.expression, 1000)
    if (expression) transform.expression = expression
  }
  return {
    id: text(source.id, 80) ?? crypto.randomUUID(),
    property,
    parameterId,
    ...(Object.keys(transform).length ? { transform } : {}),
  }
}

/**
 * The rig a patch carries, read back from storage or from a file. Bindings naming a control that
 * is not there, or a field that no longer exists, are dropped; the rest is kept.
 */
export function sanitizeAudioRig(value: unknown): AudioRig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const groups = sanitizeGroups(source.groups)
  if (groups.length === 0) return undefined
  const groupIds = new Set(groups.map((group) => group.id))
  const parameters = (Array.isArray(source.parameters) ? source.parameters : [])
    .slice(0, MAX_PARAMETERS)
    .flatMap((parameter) => {
      const clean = sanitizeParameter(parameter, groupIds)
      return clean ? [clean] : []
    })
  const seen = new Set<string>()
  const unique = parameters.filter((parameter) => (seen.has(parameter.id) ? false : (seen.add(parameter.id), true)))
  const bindings = (Array.isArray(source.bindings) ? source.bindings : [])
    .slice(0, MAX_BINDINGS)
    .flatMap((binding) => {
      const clean = sanitizeBinding(binding, seen)
      return clean ? [clean] : []
    })
  const categories = sanitizeCategories(source.inspectorCategories)
  return { groups, parameters: unique, bindings, ...(categories.length ? { inspectorCategories: categories } : {}) }
}

export const DEFAULT_RIG_GROUP: ParamGroup = { id: 'main', label: 'Main' }

export function emptyAudioRig(): AudioRig {
  return { groups: [DEFAULT_RIG_GROUP], parameters: [], bindings: [] }
}
