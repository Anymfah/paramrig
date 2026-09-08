import type { BezierCurve, InspectorCategory, ParameterDef, ParamGroup, Vec2 } from '@/rigs/types'

/**
 * Reading a rig back from a file that could say anything.
 *
 * The parameters, groups and categories of a rig are the workbench's own types, and a rig written
 * for the drawing editor has to mean the same thing to the scene editor — so the reading of them
 * lives here, once, rather than in each editor. What differs between the two is which *properties*
 * exist to bind to, and that stays in each editor's own `rig.ts`.
 *
 * The rule throughout: a control whose kind, id or group is missing is dropped rather than
 * repaired. A rig with a control that writes nowhere is worse than a rig with one control fewer.
 */

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

/** A display unit a number can be read in. The stored value stays in the base unit regardless. */
function unitList(value: unknown): Array<{ value: string; label: string; factor: number; step?: number }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as { value?: unknown; label?: unknown; factor?: unknown; step?: unknown }
    const id = text(entry.value, 12)
    const factor = entry.factor
    if (!id || typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return []
    const step = entry.step
    return [{
      value: id,
      label: text(entry.label, 40) ?? id,
      factor,
      ...(typeof step === 'number' && Number.isFinite(step) && step > 0 ? { step } : {}),
    }]
  })
}

function point(value: unknown): Vec2 | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const [x, y] = value
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  return ok(x) && ok(y) ? [x, y] : null
}

function bezier(value: unknown): BezierCurve | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (source.type !== 'cubic-bezier') return null
  const p0 = point(source.p0)
  const p1 = point(source.p1)
  const p2 = point(source.p2)
  const p3 = point(source.p3)
  return p0 && p1 && p2 && p3 ? { type: 'cubic-bezier', p0, p1, p2, p3 } : null
}

const LINEAR_CURVE: BezierCurve = { type: 'cubic-bezier', p0: [0, 0], p1: [0.33, 0.33], p2: [0.67, 0.67], p3: [1, 1] }

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
 * One control. `extended` lets the richer kinds of the catalogue through — a scene binds a whole
 * transform to a `gizmo3d` and a camera to a `camera`, where a drawing has nothing to put in one.
 */
export function sanitizeParameter(value: unknown, groupIds: Set<string>, allow: { extended?: boolean } = {}): ParameterDef | null {
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
    const scale = text(source.scale, 8)
    const units = unitList(source.units)
    return {
      ...base,
      kind: 'number',
      min,
      max: max > min ? max : min + 1,
      step: Math.max(0, finite(source.step, 1)),
      defaultValue: finite(source.defaultValue, min),
      ...(text(source.unit, 12) ? { unit: text(source.unit, 12)! } : {}),
      ...(view && NUMBER_VIEWS.includes(view) ? { view: view as 'bar' } : {}),
      // A frequency read on a linear slider is not the same control. The scale and the display
      // units are part of what the field is, not decoration, so they survive the round trip.
      ...(scale === 'log' || scale === 'linear' ? { scale } : {}),
      ...(units.length ? { units } : {}),
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
  if (kind === 'curve') {
    // Repaired rather than dropped, on the gradient's precedent above: a curve control that opens
    // on a straight line is still the control the rig asked for.
    return { ...base, kind: 'curve', defaultValue: bezier(source.defaultValue) ?? LINEAR_CURVE }
  }
  if (allow.extended === true && (kind === 'gizmo3d' || kind === 'camera')) {
    // Both carry an object rather than a number, and their shape is the controller's business;
    // what matters here is that the default is an object at all.
    const defaultValue = source.defaultValue && typeof source.defaultValue === 'object' && !Array.isArray(source.defaultValue)
      ? source.defaultValue
      : null
    if (!defaultValue) return null
    return { ...base, kind, defaultValue } as ParameterDef
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

/** The groups a rig declares. A rig with no group has nowhere to put a control, so it has no rig. */
export function sanitizeGroups(value: unknown): ParamGroup[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((group) => {
    if (!group || typeof group !== 'object') return []
    const entry = group as { id?: unknown; label?: unknown; defaultOpen?: unknown; tab?: unknown }
    const id = text(entry.id, 60)
    if (!id) return []
    return [{
      id,
      label: text(entry.label, 80) ?? id,
      ...(entry.tab ? { tab: text(entry.tab, 60) ?? undefined } : {}),
      ...(entry.defaultOpen === false ? { defaultOpen: false } : {}),
    }]
  })
}

/** The inspector's own tabs, when a rig asks for more than one. */
export function sanitizeCategories(value: unknown): InspectorCategory[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((category) => {
    if (!category || typeof category !== 'object') return []
    const entry = category as { id?: unknown; label?: unknown }
    const id = text(entry.id, 60)
    return id ? [{ id, label: text(entry.label, 80) ?? id }] : []
  })
}

/** The two ceilings a file is held to, shared so that both editors refuse the same sizes. */
export { MAX_PARAMETERS, MAX_BINDINGS }

/** The small readers the sanitisers are built from, exported for the editors' own binding readers. */
export { text as rigText, finite as rigFinite }
