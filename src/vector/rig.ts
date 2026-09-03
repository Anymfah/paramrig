import type { InspectorCategory, ParameterDef, ParamGroup, ParamValue } from '@/rigs/types'
import { evaluateExpression } from '@/state/expression'
import { fillsOf, fillsPatch, strokesOf, strokesPatch, summaryColor } from '@/vector/paints'
import { BLEND_MODES } from '@/vector/effects'
import type { VectorBlendMode, VectorDocument, VectorElement, VectorPaint } from '@/vector/types'

/**
 * How a control reaches a property. A number can be rescaled on the way — `min`/`max` clamp it,
 * `scale` and `offset` map it, and `expression` replaces all of that with arithmetic over the
 * control's value, written as `value`.
 */
export type BindingTransform = {
  min?: number
  max?: number
  scale?: number
  offset?: number
  expression?: string
}

/** One control writing to one property of one object. */
export type VectorBinding = {
  id: string
  elementId: string
  property: string
  parameterId: string
  transform?: BindingTransform
}

/** What a vector document adds to become a rig: the controls, and where they write. */
export type VectorRig = {
  groups: ParamGroup[]
  parameters: ParameterDef[]
  inspectorCategories?: InspectorCategory[]
  bindings: VectorBinding[]
}

/** The plain properties of an object a control can write to, and the kind each one takes. */
export const SIMPLE_PROPERTIES = {
  x: 'number', y: 'number', width: 'number', height: 'number', rotation: 'number',
  opacity: 'number', visible: 'boolean',
  fill: 'color', stroke: 'color', strokeWidth: 'number', strokeDash: 'number',
  cornerRadius: 'number', cornerSmoothing: 'number',
  text: 'text', fontSize: 'number', fontWeight: 'number', letterSpacing: 'number',
  sides: 'number', innerRatio: 'number', arcStart: 'number', arcSweep: 'number',
  blendMode: 'option',
} as const

export type SimpleProperty = keyof typeof SIMPLE_PROPERTIES
export type PropertyType = (typeof SIMPLE_PROPERTIES)[SimpleProperty] | 'gradient'

/** A property path, read apart so it can be applied without string work at render time. */
export type BindablePath =
  | { kind: 'simple'; key: SimpleProperty; type: PropertyType }
  | { kind: 'paint'; list: 'fills' | 'strokes'; index: number; field: 'color' | 'opacity' | 'stops'; type: PropertyType }
  | { kind: 'effect'; index: number; field: string; type: PropertyType }
  | { kind: 'region'; key: string; type: 'boolean' }
  | { kind: 'node'; nodeId: string; axis: 'x' | 'y'; type: 'number' }

const EFFECT_FIELDS: Record<string, PropertyType> = {
  dx: 'number', dy: 'number', blur: 'number', spread: 'number', opacity: 'number', color: 'color',
}

/**
 * Reads a property path. Anything this does not recognise is refused rather than guessed at, so a
 * binding to a property that no longer exists is dropped instead of writing somewhere random.
 */
export function parseBindableProperty(property: string): BindablePath | null {
  if (Object.hasOwn(SIMPLE_PROPERTIES, property)) {
    const key = property as SimpleProperty
    return { kind: 'simple', key, type: SIMPLE_PROPERTIES[key] }
  }
  const paint = /^(fills|strokes)\[(\d+)\]\.(color|opacity|stops)$/.exec(property)
  if (paint) {
    const field = paint[3] as 'color' | 'opacity' | 'stops'
    return {
      kind: 'paint',
      list: paint[1] as 'fills' | 'strokes',
      index: Number(paint[2]),
      field,
      type: field === 'color' ? 'color' : field === 'stops' ? 'gradient' : 'number',
    }
  }
  const effect = /^effects\[(\d+)\]\.([A-Za-z]+)$/.exec(property)
  if (effect && Object.hasOwn(EFFECT_FIELDS, effect[2]!)) {
    return { kind: 'effect', index: Number(effect[1]), field: effect[2]!, type: EFFECT_FIELDS[effect[2]!]! }
  }
  const region = /^regionsOff\[(.+)\]$/.exec(property)
  if (region) return { kind: 'region', key: region[1]!, type: 'boolean' }
  const node = /^network\.nodes\[([^\]]+)\]\.(x|y)$/.exec(property)
  if (node) return { kind: 'node', nodeId: node[1]!, axis: node[2] as 'x' | 'y', type: 'number' }
  return null
}

/** The parameter kinds that can drive a property of that type. */
export const KINDS_FOR_TYPE: Record<PropertyType, string[]> = {
  number: ['number', 'vector', 'curve'],
  boolean: ['switch'],
  color: ['color'],
  text: ['text', 'select'],
  option: ['select', 'text'],
  gradient: ['gradient'],
}

/** The kind of control a property asks for when it is first exposed. */
export function kindForProperty(type: PropertyType): string {
  return KINDS_FOR_TYPE[type][0]!
}

/** A number put through a binding's transform. Anything that is not finite is left alone. */
export function applyTransform(value: number, transform: BindingTransform | undefined, resolve: (id: string) => number): number {
  if (!transform) return value
  let next = value
  if (transform.expression) {
    try {
      next = evaluateExpression(transform.expression, (id) => (id === 'value' ? value : resolve(id)))
    } catch {
      return value
    }
  } else {
    if (typeof transform.scale === 'number') next *= transform.scale
    if (typeof transform.offset === 'number') next += transform.offset
  }
  if (typeof transform.min === 'number') next = Math.max(transform.min, next)
  if (typeof transform.max === 'number') next = Math.min(transform.max, next)
  return Number.isFinite(next) ? next : value
}

function asNumber(value: ParamValue): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0]
  return null
}

function withPaint(paints: VectorPaint[], index: number, patch: Partial<VectorPaint>): VectorPaint[] | null {
  if (index < 0 || index >= paints.length) return null
  return paints.map((paint, position) => (position === index ? { ...paint, ...patch } : paint))
}

/** One binding written onto one object. Returns the object unchanged when it cannot be applied. */
export function applyBinding(element: VectorElement, binding: VectorBinding, value: ParamValue, resolve: (id: string) => number): VectorElement {
  const path = parseBindableProperty(binding.property)
  if (!path) return element
  const number = () => {
    const raw = asNumber(value)
    return raw === null ? null : applyTransform(raw, binding.transform, resolve)
  }
  if (path.kind === 'simple') {
    if (path.type === 'number') {
      const next = number()
      if (next === null) return element
      if (path.key === 'strokeDash') return { ...element, strokeDash: next > 0 ? [next, element.strokeDash?.[1] ?? next] : undefined }
      return { ...element, [path.key]: next }
    }
    if (path.type === 'boolean') return { ...element, [path.key]: Boolean(value) }
    if (path.type === 'color') {
      if (typeof value !== 'string') return element
      return path.key === 'fill'
        ? { ...element, fill: value, fills: element.fills ? withPaint(element.fills, 0, { color: value, type: 'solid' }) ?? element.fills : undefined }
        : { ...element, stroke: value, strokes: element.strokes ? withPaint(element.strokes, 0, { color: value, type: 'solid' }) ?? element.strokes : undefined }
    }
    if (path.type === 'text') return typeof value === 'string' ? { ...element, text: value } : element
    if (path.type === 'option') {
      return typeof value === 'string' && (BLEND_MODES as readonly string[]).includes(value)
        ? { ...element, blendMode: value === 'normal' ? undefined : (value as VectorBlendMode) }
        : element
    }
    return element
  }
  if (path.kind === 'paint') {
    const paints = path.list === 'fills' ? fillsOf(element) : strokesOf(element)
    let next: VectorPaint[] | null = null
    if (path.field === 'color' && typeof value === 'string') next = withPaint(paints, path.index, { color: value, type: 'solid' })
    if (path.field === 'opacity') {
      const amount = number()
      if (amount !== null) next = withPaint(paints, path.index, { opacity: Math.min(1, Math.max(0, amount)) })
    }
    if (path.field === 'stops' && Array.isArray(value)) {
      const stops = (value as unknown[]).flatMap((stop) => {
        if (!stop || typeof stop !== 'object' || Array.isArray(stop)) return []
        const entry = stop as { t?: unknown; color?: unknown }
        return typeof entry.t === 'number' && typeof entry.color === 'string' ? [{ t: entry.t, color: entry.color }] : []
      })
      if (stops.length > 1) next = withPaint(paints, path.index, { stops, type: paints[path.index]?.type === 'radial' ? 'radial' : 'linear', color: undefined })
    }
    if (!next) return element
    const patch = path.list === 'fills' ? fillsPatch(next) : strokesPatch(next)
    return { ...element, ...patch, ...(path.list === 'fills' ? { fill: summaryColor(next) } : { stroke: summaryColor(next) }) }
  }
  if (path.kind === 'effect') {
    const effects = element.effects ?? []
    if (path.index < 0 || path.index >= effects.length) return element
    if (path.type === 'color') {
      if (typeof value !== 'string') return element
      return { ...element, effects: effects.map((effect, position) => (position === path.index ? { ...effect, color: value } : effect)) }
    }
    const amount = number()
    if (amount === null) return element
    return { ...element, effects: effects.map((effect, position) => (position === path.index ? { ...effect, [path.field]: amount } : effect)) }
  }
  if (path.kind === 'region') {
    const off = new Set(element.regionsOff ?? [])
    // The control says whether the region is filled; `regionsOff` says the opposite.
    if (value) off.delete(path.key)
    else off.add(path.key)
    return { ...element, regionsOff: off.size ? [...off] : undefined }
  }
  const network = element.network
  if (!network) return element
  const amount = number()
  if (amount === null) return element
  return {
    ...element,
    network: {
      ...network,
      nodes: network.nodes.map((node) => (node.id === path.nodeId ? { ...node, [path.axis]: amount } : node)),
    },
  }
}

let cacheKey = ''
let cacheValue: VectorDocument | null = null

/**
 * The document as its controls say it should look. Pure: the editor always writes to the raw
 * document, and this is what the canvas, the thumbnails and the export draw. The result is kept
 * for the last set of values, since a drag asks for the same one many times a second.
 */
export function resolveRigValues(document: VectorDocument, values: Record<string, ParamValue>): VectorDocument {
  const rig = document.rig
  if (!rig || rig.bindings.length === 0) return document
  const key = `${document.id}:${document.updatedAt}:${document.elements.length}:${JSON.stringify(values)}`
  if (key === cacheKey && cacheValue) return cacheValue
  const known = new Set(rig.parameters.map((parameter: ParameterDef) => parameter.id))
  const resolve = (id: string) => {
    const value = values[id]
    if (typeof value !== 'number') throw new Error(`Not a numeric control: ${id}`)
    return value
  }
  const byElement = new Map<string, VectorBinding[]>()
  for (const binding of rig.bindings) {
    if (!known.has(binding.parameterId)) continue
    byElement.set(binding.elementId, [...(byElement.get(binding.elementId) ?? []), binding])
  }
  const resolved: VectorDocument = {
    ...document,
    elements: document.elements.map((element) => {
      const bindings = byElement.get(element.id)
      if (!bindings) return element
      // The last binding on a property wins, which is what writing them in order gives.
      return bindings.reduce((current, binding) => applyBinding(current, binding, values[binding.parameterId] ?? null, resolve), element)
    }),
  }
  cacheKey = key
  cacheValue = resolved
  return resolved
}

/** Drops the memo, so a test can watch the work happen. */
export function clearRigCache(): void {
  cacheKey = ''
  cacheValue = null
}

/** The default value of every control the document defines. */
export function rigDefaults(rig: VectorRig): Record<string, ParamValue> {
  return Object.fromEntries(rig.parameters.map((parameter) => [parameter.id, structuredClone(parameter.defaultValue)]))
}

/** A readable name for a property, used when a field is first exposed. */
export function propertyLabel(property: string): string {
  const path = parseBindableProperty(property)
  if (!path) return property
  if (path.kind === 'simple') return LABELS[path.key] ?? path.key
  if (path.kind === 'paint') return `${path.list === 'fills' ? 'Fill' : 'Stroke'} ${path.index + 1} ${path.field}`
  if (path.kind === 'effect') return `Effect ${path.index + 1} ${path.field}`
  if (path.kind === 'region') return 'Region'
  return `Node ${path.axis.toUpperCase()}`
}

const LABELS: Partial<Record<SimpleProperty, string>> = {
  x: 'X', y: 'Y', width: 'Width', height: 'Height', rotation: 'Rotation',
  opacity: 'Opacity', visible: 'Visible', fill: 'Fill', stroke: 'Stroke',
  strokeWidth: 'Stroke width', strokeDash: 'Dash', cornerRadius: 'Corner radius',
  cornerSmoothing: 'Corner smoothing', text: 'Text', fontSize: 'Font size',
  fontWeight: 'Font weight', letterSpacing: 'Letter spacing', sides: 'Sides',
  innerRatio: 'Star points', arcStart: 'Arc start', arcSweep: 'Arc sweep', blendMode: 'Blend mode',
}

const NUMBER_VIEWS = ['field', 'stepper', 'bar', 'knob', 'angle', 'seed']
const MAX_PARAMETERS = 200
const MAX_BINDINGS = 500

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback
}

function options(value: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as { value?: unknown; label?: unknown }
    const id = text(entry.value, 60)
    return id ? [{ value: id, label: text(entry.label, 60) ?? id }] : []
  })
}

/**
 * One control, read from a file that could say anything. A control whose kind, id or group is
 * missing is dropped rather than repaired: a rig with a control that writes nowhere is worse than
 * a rig with one control fewer.
 */
export function sanitizeParameter(value: unknown, groupIds: Set<string>): ParameterDef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const id = text(source.id, 60)
  const kind = text(source.kind, 20)
  if (!id || !kind) return null
  const label = text(source.label, 80) ?? id
  const group = text(source.group, 60) ?? ''
  if (!groupIds.has(group)) return null
  const base = { id, label, group, ...(source.hidden === true ? { hidden: true as const } : {}) }
  if (kind === 'number') {
    const min = finite(source.min, 0)
    const max = finite(source.max, min + 1)
    const view = text(source.view, 20)
    return {
      ...base,
      kind: 'number',
      min,
      max: max > min ? max : min + 1,
      step: Math.max(0, finite(source.step, 1)),
      defaultValue: finite(source.defaultValue, min),
      ...(text(source.unit, 12) ? { unit: text(source.unit, 12)! } : {}),
      ...(view && NUMBER_VIEWS.includes(view) ? { view: view as 'bar' } : {}),
    }
  }
  if (kind === 'color') return { ...base, kind: 'color', defaultValue: hex(source.defaultValue, '#D4E7E1'), ...(source.alpha === true ? { alpha: true } : {}) }
  if (kind === 'switch') return { ...base, kind: 'switch', defaultValue: source.defaultValue === true }
  if (kind === 'select') {
    const list = options(source.options)
    if (list.length === 0) return null
    const fallback = list[0]!.value
    const chosen = text(source.defaultValue, 60)
    return { ...base, kind: 'select', options: list, defaultValue: chosen && list.some((item) => item.value === chosen) ? chosen : fallback }
  }
  if (kind === 'text') {
    return { ...base, kind: 'text', defaultValue: typeof source.defaultValue === 'string' ? source.defaultValue.slice(0, 2000) : '', ...(source.multiline === true ? { multiline: true } : {}) }
  }
  if (kind === 'gradient') {
    const stops = Array.isArray(source.defaultValue)
      ? source.defaultValue.flatMap((stop) => {
        if (!stop || typeof stop !== 'object') return []
        const entry = stop as { t?: unknown; color?: unknown }
        return typeof entry.t === 'number' ? [{ t: Math.min(1, Math.max(0, entry.t)), color: hex(entry.color, '#D4E7E1') }] : []
      })
      : []
    return { ...base, kind: 'gradient', defaultValue: stops.length > 1 ? stops : [{ t: 0, color: '#1C1D1E' }, { t: 1, color: '#D4E7E1' }] }
  }
  if (kind === 'vector') {
    const values = Array.isArray(source.defaultValue) ? source.defaultValue.map((item) => finite(item, 0)) : [0, 0]
    const axes = Array.isArray(source.axes) ? source.axes.flatMap((axis) => (text(axis, 8) ? [text(axis, 8)!] : [])) : ['X', 'Y']
    if (values.length < 2 || axes.length !== values.length) return null
    const min = finite(source.min, 0)
    const max = finite(source.max, min + 1)
    return { ...base, kind: 'vector', defaultValue: values, axes, min, max: max > min ? max : min + 1, step: Math.max(0, finite(source.step, 1)) }
  }
  return null
}

/** A binding is kept only when both ends of it exist. */
function sanitizeBinding(value: unknown, elementIds: Set<string>, parameterIds: Set<string>): VectorBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const elementId = text(source.elementId, 80)
  const parameterId = text(source.parameterId, 60)
  const property = text(source.property, 120)
  if (!elementId || !parameterId || !property) return null
  if (!elementIds.has(elementId) || !parameterIds.has(parameterId)) return null
  if (!parseBindableProperty(property)) return null
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
    elementId,
    property,
    parameterId,
    ...(Object.keys(transform).length ? { transform } : {}),
  }
}

/**
 * The rig a document carries, read back from storage or from a file. Bindings that point at an
 * object or a control that is not there are dropped; the rest is kept.
 */
export function sanitizeRig(value: unknown, elementIds: Set<string>): VectorRig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const groups = Array.isArray(source.groups)
    ? source.groups.flatMap((group) => {
      if (!group || typeof group !== 'object') return []
      const entry = group as { id?: unknown; label?: unknown; defaultOpen?: unknown; tab?: unknown }
      const id = text(entry.id, 60)
      return id ? [{ id, label: text(entry.label, 80) ?? id, ...(entry.tab ? { tab: text(entry.tab, 60) ?? undefined } : {}), ...(entry.defaultOpen === false ? { defaultOpen: false } : {}) }] : []
    })
    : []
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
      const clean = sanitizeBinding(binding, elementIds, seen)
      return clean ? [clean] : []
    })
  const categories = Array.isArray(source.inspectorCategories)
    ? source.inspectorCategories.flatMap((category) => {
      if (!category || typeof category !== 'object') return []
      const entry = category as { id?: unknown; label?: unknown }
      const id = text(entry.id, 60)
      return id ? [{ id, label: text(entry.label, 80) ?? id }] : []
    })
    : []
  return {
    groups,
    parameters: unique,
    bindings,
    ...(categories.length ? { inspectorCategories: categories } : {}),
  }
}

/** What a rig looks like before anything has been exposed. */
export const DEFAULT_RIG_GROUP: ParamGroup = { id: 'main', label: 'Main' }

export function emptyRig(): VectorRig {
  return { groups: [DEFAULT_RIG_GROUP], parameters: [], bindings: [] }
}

/** What a property reads right now, so a fresh control starts where the drawing already is. */
export function currentValue(element: VectorElement, property: string): ParamValue {
  const path = parseBindableProperty(property)
  if (!path) return null
  if (path.kind === 'simple') {
    if (path.key === 'strokeDash') return element.strokeDash?.[0] ?? 0
    if (path.key === 'cornerRadius') return typeof element.cornerRadius === 'number' ? element.cornerRadius : (element.cornerRadius?.[0] ?? 0)
    if (path.key === 'blendMode') return element.blendMode ?? 'normal'
    const value = element[path.key]
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
    return path.type === 'number' ? 0 : path.type === 'boolean' ? true : ''
  }
  if (path.kind === 'paint') {
    const paint = (path.list === 'fills' ? fillsOf(element) : strokesOf(element))[path.index]
    if (!paint) return null
    if (path.field === 'color') return paint.color ?? '#D4E7E1'
    if (path.field === 'opacity') return paint.opacity
    return paint.stops ?? null
  }
  if (path.kind === 'effect') {
    const effect = element.effects?.[path.index]
    if (!effect) return null
    if (path.field === 'color') return effect.color ?? '#000000'
    const value = effect[path.field as 'blur']
    return typeof value === 'number' ? value : 0
  }
  if (path.kind === 'region') return !(element.regionsOff ?? []).includes(path.key)
  const node = element.network?.nodes.find((item) => item.id === path.nodeId)
  return node ? node[path.axis] : 0
}

/** A control id from what it was called, kept unique against the ones already there. */
export function controlId(label: string, taken: Set<string>): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'control'
  if (!taken.has(base)) return base
  for (let index = 2; index < 500; index += 1) {
    const candidate = `${base}-${index}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

/** A control built for a property, taking its default from what the drawing says today. */
export function parameterForProperty(options: {
  id: string
  label: string
  group: string
  property: string
  element: VectorElement
  min?: number
  max?: number
  step?: number
}): ParameterDef | null {
  const path = parseBindableProperty(options.property)
  if (!path) return null
  const base = { id: options.id, label: options.label, group: options.group }
  const value = currentValue(options.element, options.property)
  if (path.type === 'number') {
    const min = options.min ?? 0
    const max = options.max ?? Math.max(min + 1, typeof value === 'number' ? value * 2 : 100)
    return { ...base, kind: 'number', min, max: max > min ? max : min + 1, step: options.step ?? 1, defaultValue: typeof value === 'number' ? Math.min(max, Math.max(min, value)) : min }
  }
  if (path.type === 'color') return { ...base, kind: 'color', defaultValue: typeof value === 'string' ? value : '#D4E7E1' }
  if (path.type === 'boolean') return { ...base, kind: 'switch', defaultValue: value !== false }
  if (path.type === 'text') return { ...base, kind: 'text', defaultValue: typeof value === 'string' ? value : '' }
  if (path.type === 'option') {
    return { ...base, kind: 'select', options: BLEND_MODES.map((mode) => ({ value: mode, label: mode })), defaultValue: typeof value === 'string' ? value : 'normal' }
  }
  if (path.type === 'gradient') {
    const stops = Array.isArray(value) ? value : null
    return { ...base, kind: 'gradient', defaultValue: (stops as { t: number; color: string }[] | null) ?? [{ t: 0, color: '#1C1D1E' }, { t: 1, color: '#D4E7E1' }] }
  }
  return null
}
