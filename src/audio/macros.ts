import type { BezierCurve, ParameterDef, ParamValue } from '@/rigs/types'
import type { BindingTransform } from '@/rigs/binding'
import { LINEAR, mapAmount } from '@/audio/dsp/curve'
import {
  applyAudioBinding, currentAudioValue, emptyAudioRig,
  parseAudioProperty, type AudioBinding, type AudioRig,
} from '@/audio/rig'
import type { AudioPatch } from '@/audio/types'

/**
 * The sixteen macros are the document's rig: each is a control, and each control may write to
 * several fields. A property still belongs to one macro at a time — the last one assigned to it
 * takes it, and the one that had it lets go. Mixing two macros on one knob is the thing this
 * file exists not to do.
 */

export const MACRO_COUNT = 16
export const MACRO_GROUP = 'main'

export type MacroDestination = {
  property: string
  from: number
  to: number
  invert: boolean
  curve: BezierCurve
  /** Older single-target controls keep their native units and transform. */
  native?: boolean
  legacyTransform?: BindingTransform
}

export type MacroSlot = {
  label: string
  /** True once the user has named it; a reassignment must not overwrite that name. */
  renamed: boolean
  destinations: MacroDestination[]
  /** 0..1 when the macro has a mapped range; otherwise the native value of its only destination. */
  value: number
}

const DEFAULT_LABELS = [
  'Pos1', 'Level1', 'Pos2', 'Level2', 'Cutoff', 'Reso', 'Attack', 'Release',
  'PM', 'Detune', 'Spread', 'Delay', 'Verb', 'Width', 'Limit', 'Fade',
] as const

const DEFAULT_PROPERTIES = [
  'layers[0].pitch.start', 'layers[0].gain', 'layers[1].pitch.start', 'layers[1].gain',
  'layers[0].filterA.cutoff', 'layers[0].filterA.resonance', 'layers[0].amp.attack', 'layers[0].amp.release',
  'layers[0].source.fmIndex', 'layers[0].source.detune', 'layers[0].spread', 'fx.y.mix',
  'fx.z.mix', 'fx.width', 'master.limiter', 'master.fadeOut',
] as const

export const macroBindingId = (index: number, dest = 0) =>
  dest === 0 ? `macro-${index + 1}` : `macro-${index + 1}-d${dest}`

export const macroParameterId = (index: number) => `macro-${index + 1}`

const isMacroBinding = (id: string) => /^macro-\d+(?:-d\d+)?$/.test(id)
const macroIndexOf = (id: string) => {
  const found = /^macro-(\d+)/.exec(id)
  return found ? Number(found[1]) - 1 : -1
}

/** A short name for a property: the field's own, and the layer's number when it has one. */
export function macroPropertyLabel(property: string): string {
  const path = parseAudioProperty(property)
  const layer = /^layers\[(\d)\]/.exec(property)
  const label = path?.spec.label ?? property
  return layer ? `${label} ${Number(layer[1]) + 1}` : label
}

function defaultDestination(property: string, _patch: AudioPatch): MacroDestination | null {
  const path = parseAudioProperty(property)
  if (!path || path.spec.editorOnly) return null
  const spec = path.spec
  if (spec.type !== 'number') {
    return { property, from: 0, to: 1, invert: false, curve: LINEAR }
  }
  const min = spec.min ?? 0
  const max = spec.max ?? 1
  return { property, from: min, to: max, invert: false, curve: LINEAR }
}

function mapped(transform: BindingTransform | undefined): boolean {
  return typeof transform?.from === 'number' && typeof transform?.to === 'number'
}

/** Map a 0..1 amount through a destination, honouring log fields. */
export function mapDestination(amount: number, dest: Pick<MacroDestination, 'from' | 'to' | 'invert' | 'curve'>, scale?: 'linear' | 'log'): number {
  return mapAmount(amount, dest.from, dest.to, { invert: dest.invert, curve: dest.curve, scale })
}

function amountOf(value: number, dest: MacroDestination, specScale?: 'linear' | 'log'): number {
  if (dest.from === dest.to) return 0
  if (specScale === 'log' && dest.from > 0 && dest.to > 0 && value > 0) {
    return (Math.log(value) - Math.log(dest.from)) / (Math.log(dest.to) - Math.log(dest.from))
  }
  return (value - dest.from) / (dest.to - dest.from)
}

export function emptyMacros(): MacroSlot[] {
  return Array.from({ length: MACRO_COUNT }, () => ({ label: '', renamed: false, destinations: [], value: 0 }))
}

export function defaultMacros(patch: AudioPatch): MacroSlot[] {
  return Array.from({ length: MACRO_COUNT }, (_, index) => {
    const property = DEFAULT_PROPERTIES[index] ?? ''
    const dest = defaultDestination(property, patch)
    const path = parseAudioProperty(property)
    const current = currentAudioValue(patch, property)
    const value = dest && path?.spec.type === 'number' && typeof current === 'number'
      ? Math.min(1, Math.max(0, amountOf(current, dest, path.spec.scale)))
      : 0
    return {
      label: DEFAULT_LABELS[index] ?? `Macro ${index + 1}`,
      renamed: false,
      destinations: dest ? [dest] : [],
      value,
    }
  })
}

/**
 * The macros a rig describes. Numbered bindings (`macro-1` …) are the plate's own; anything else
 * is left on the rig untouched. A document with no rig at all still shows the sixteen defaults.
 */
export function macrosOf(rig: AudioRig | undefined, patch: AudioPatch): MacroSlot[] {
  if (!rig) return defaultMacros(patch)
  const numbered = rig.bindings.some((binding) => isMacroBinding(binding.id)) || rig.parameters.some((parameter) => isMacroBinding(parameter.id))
  const slots = emptyMacros()
  for (const parameter of rig.parameters) {
    const index = macroIndexOf(parameter.id)
    if (numbered && slots[index]) {
      slots[index]!.label = parameter.label
      slots[index]!.renamed = true
    }
  }
  const mine = rig.bindings.filter((binding) => (numbered ? isMacroBinding(binding.id) : true))
  for (const binding of mine) {
    const index = numbered ? macroIndexOf(binding.id) : mine.indexOf(binding)
    if (index < 0 || index >= MACRO_COUNT) continue
    const slot = slots[index]
    const parameter = rig.parameters.find((entry) => entry.id === binding.parameterId)
    if (!slot || !parameter) continue
    const path = parseAudioProperty(binding.property)
    if (!path) continue
    const transform = binding.transform
    const dest: MacroDestination = mapped(transform)
      ? {
        property: binding.property,
        from: transform!.from!,
        to: transform!.to!,
        invert: transform?.invert === true,
        curve: transform?.curve ?? LINEAR,
      }
      : {
        property: binding.property,
        from: path.spec.min ?? 0,
        to: path.spec.max ?? 1,
        invert: false,
        curve: LINEAR,
        native: true,
        legacyTransform: transform,
      }
    slot.destinations.push(dest)
    slot.label = parameter.label
    slot.renamed = parameter.label !== macroPropertyLabel(binding.property)
    if (parameter.kind === 'number') {
      const native = parameter.defaultValue
      slot.value = mapped(transform) || slot.destinations.length > 1
        ? Math.min(1, Math.max(0, native))
        : (typeof currentAudioValue(patch, binding.property) === 'number' && !transform
          ? currentAudioValue(patch, binding.property) as number : native)
    }
  }
  return slots
}

function destinationTransform(dest: MacroDestination): BindingTransform | undefined {
  if (dest.native) return dest.legacyTransform
  return {
    from: dest.from,
    to: dest.to,
    ...(dest.invert ? { invert: true } : {}),
    ...(dest.curve === LINEAR ? {} : { curve: dest.curve }),
  }
}

function macroParameter(slot: MacroSlot, index: number, patch: AudioPatch): ParameterDef | null {
  if (slot.destinations.length === 0 && !slot.label) return null
  const first = slot.destinations[0]
  const path = first ? parseAudioProperty(first.property) : null
  const mappedRange = macroIsMapped(slot)
  if (mappedRange || !path || path.spec.type !== 'number') {
    return {
      kind: 'number',
      id: macroParameterId(index),
      label: slot.label || `Macro ${index + 1}`,
      group: MACRO_GROUP,
      min: 0,
      max: 1,
      step: 0.001,
      defaultValue: Math.min(1, Math.max(0, slot.value)),
    }
  }
  const spec = path.spec
  const current = currentAudioValue(patch, first!.property)
  return {
    kind: 'number',
    id: macroParameterId(index),
    label: slot.label || spec.label,
    group: MACRO_GROUP,
    min: spec.min ?? 0,
    max: spec.max ?? 1,
    step: spec.step ?? 0.01,
    defaultValue: first?.legacyTransform ? slot.value : typeof current === 'number' ? current : (spec.min ?? 0),
    ...(spec.unit ? { unit: spec.unit } : {}),
    ...(spec.scale ? { scale: spec.scale } : {}),
  }
}

/**
 * Write the sixteen slots back onto a rig without touching anyone else's controls.
 *
 * One parameter per occupied macro, one binding per destination. A property already driven by
 * another of the sixteen is stolen: it leaves that macro and joins this one.
 */
export function writeMacros(rig: AudioRig | undefined, table: MacroSlot[], patch: AudioPatch): AudioRig {
  const base = rig ?? emptyAudioRig()
  const numbered = base.bindings.some((binding) => isMacroBinding(binding.id)) || base.parameters.some((parameter) => isMacroBinding(parameter.id))
  const mine = new Set((numbered
    ? base.bindings.filter((entry) => isMacroBinding(entry.id))
    : base.bindings.slice(0, MACRO_COUNT)).map((entry) => entry.id))
  const bindings = base.bindings.filter((entry) => !mine.has(entry.id))
  const letGo = new Set(base.bindings.filter((entry) => mine.has(entry.id)).map((entry) => entry.parameterId))
  const stillDriven = new Set(bindings.map((entry) => entry.parameterId))
  const parameters = base.parameters.filter((entry) => (!letGo.has(entry.id) && !isMacroBinding(entry.id)) || stillDriven.has(entry.id))
  table.forEach((slot, index) => {
    const parameter = macroParameter(slot, index, patch)
    if (!parameter) return
    parameters.push(parameter)
    slot.destinations.forEach((dest, destIndex) => {
      bindings.push({
        id: macroBindingId(index, destIndex),
        property: dest.property,
        parameterId: parameter.id,
        transform: destinationTransform(dest),
      })
    })
  })
  const groups = base.groups.some((group) => group.id === MACRO_GROUP)
    ? base.groups
    : [...base.groups, { id: MACRO_GROUP, label: 'Main' }]
  return { ...base, groups, parameters, bindings }
}

/** Last assigned macro owns a property. Adding never clears the destinations already on this slot. */
export function bindMacro(table: MacroSlot[], index: number, property: string, patch: AudioPatch): MacroSlot[] {
  const dest = defaultDestination(property, patch)
  if (!dest) return table
  return table.map((slot, at) => {
    if (at === index) {
      if (slot.destinations.some((entry) => entry.property === property)) return slot
      const label = slot.renamed || slot.destinations.length > 0 ? slot.label : macroPropertyLabel(property)
      const wasNative = slot.destinations[0]?.native
      const value = wasNative ? macroAmount(slot) : slot.destinations.length ? slot.value : amountOf(Number(currentAudioValue(patch, property)), dest, parseAudioProperty(property)?.spec.scale)
      return { ...slot, label, value: Math.min(1, Math.max(0, value)), destinations: [...slot.destinations.map((entry) => wasNative ? { ...entry, native: false, legacyTransform: undefined } : entry), dest] }
    }
    return { ...slot, destinations: slot.destinations.filter((entry) => entry.property !== property) }
  })
}

/** A 0..1 amount rather than the native field: several destinations, or an explicit range. */
export function macroIsMapped(slot: MacroSlot): boolean {
  const first = slot.destinations[0]
  return slot.destinations.length > 1 || (first != null && mapped(destinationTransform(first)))
}

export function unbindMacro(table: MacroSlot[], index: number, property?: string): MacroSlot[] {
  return table.map((slot, at) => {
    if (at !== index) return slot
    if (!property) return { ...slot, destinations: [], value: 0 }
    return { ...slot, destinations: slot.destinations.filter((entry) => entry.property !== property) }
  })
}

export function renameMacro(table: MacroSlot[], index: number, label: string): MacroSlot[] {
  const next = label.trim().slice(0, 40)
  return table.map((slot, at) => (at === index ? { ...slot, label: next || slot.label, renamed: true } : slot))
}

export function setMacroDestination(table: MacroSlot[], index: number, property: string, patch: Partial<MacroDestination>): MacroSlot[] {
  const spec = parseAudioProperty(property)?.spec
  if (!spec) return table
  const safe = { ...patch }
  for (const key of ['from', 'to'] as const) {
    const value = safe[key]
    if (value !== undefined) {
      if (!Number.isFinite(value)) return table
      safe[key] = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, value))
    }
  }
  return table.map((slot, at) => {
    if (at !== index) return slot
    return {
      ...slot,
      value: slot.destinations[0]?.native ? amountOf(slot.value, slot.destinations[0], parseAudioProperty(property)?.spec.scale) : slot.value,
      destinations: slot.destinations.map((dest) => (dest.property === property ? { ...dest, ...safe, native: false, legacyTransform: undefined, property: dest.property } : dest)),
    }
  })
}

export function setMacroValue(table: MacroSlot[], index: number, value: number): MacroSlot[] {
  return table.map((slot, at) => (at === index ? { ...slot, value } : slot))
}

/**
 * The patch as the macros currently stand. Each destination is written through its range; a
 * property with no macro on it is left as the base patch has it.
 *
 * Bindings that are not the plate's sixteen are applied afterwards, in order, last writer winning
 * the way `resolveAudioValues` always has.
 */
export function applyMacros(patch: AudioPatch, table: MacroSlot[], rest?: AudioRig, onlyIndex?: number): AudioPatch {
  let next = patch
  const resolve = () => 0
  table.forEach((slot, index) => {
    if (onlyIndex !== undefined && index !== onlyIndex) return
    const amount = slot.value
    for (const dest of slot.destinations) {
      const path = parseAudioProperty(dest.property)
      if (!path) continue
      const binding: AudioBinding = {
        id: macroBindingId(index, slot.destinations.indexOf(dest)),
        property: dest.property,
        parameterId: macroParameterId(index),
        transform: destinationTransform(dest),
      }
      if (path.spec.type === 'number' && (slot.destinations.length > 1 || mapped(binding.transform))) {
        const written = mapDestination(amount, dest, path.spec.scale)
        const current = currentAudioValue(next, dest.property)
        // Logarithmic round trips can move a resting value by a few ULPs. Keeping it exact
        // matters to quantised noise and combs, where that drift can change the rendered samples.
        if (typeof current === 'number' && Number.isFinite(current) && Number.isFinite(written) && Math.abs(written - current) <= Number.EPSILON * 16 * Math.max(1, Math.abs(current), Math.abs(written))) continue
        next = applyAudioBinding(next, { ...binding, transform: undefined }, written, resolve)
      } else {
        next = applyAudioBinding(next, binding, amount, resolve)
      }
    }
  })
  if (!rest || onlyIndex !== undefined) return next
  const mine = new Set(rest.bindings.filter((entry) => isMacroBinding(entry.id)).map((entry) => entry.id))
  const known = new Set(rest.parameters.map((parameter) => parameter.id))
  const values: Record<string, ParamValue> = Object.fromEntries(
    rest.parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
  )
  const lookup = (id: string) => {
    const value = values[id]
    if (typeof value !== 'number') throw new Error(`Not a numeric control: ${id}`)
    return value
  }
  return rest.bindings.reduce(
    (current, binding) => (mine.has(binding.id) || !known.has(binding.parameterId)
      ? current
      : applyAudioBinding(current, binding, values[binding.parameterId] ?? null, lookup)),
    next,
  )
}

export function destinationsOf(table: MacroSlot[], property: string): { index: number; dest: MacroDestination } | null {
  for (let index = 0; index < table.length; index += 1) {
    const dest = table[index]?.destinations.find((entry) => entry.property === property)
    if (dest) return { index, dest }
  }
  return null
}


/** Normalized value stored by a gesture, including older controls with native units. */
export function macroAmount(slot: MacroSlot): number {
  const first = slot.destinations[0]
  return first?.native ? Math.min(1, Math.max(0, amountOf(slot.value, first, parseAudioProperty(first.property)?.spec.scale))) : slot.value
}

/**
 * How a generated patch is taken back by the sixteen macros.
 *
 * A random draw is not a single knob position. Re-applying the stored amounts would undo the
 * draw, and rewriting the user's ranges would throw away the mapping they made. So:
 *
 * 1. Names, assignments, ranges and curves stay as they are.
 * 2. When every destination of a mapped macro still agrees on one amount, that amount is shown.
 * 3. When they disagree, the knob is left where it was and those destinations are parked: the
 *    patch keeps what was generated, and the next movement recaptures the current values as the
 *    origin of the existing ranges so the sound does not jump.
 */
const PARK_SPREAD = 0.05

/** The 0..1 amount a destination would need to produce this field value. */
export function impliedDestinationAmount(dest: MacroDestination, value: number, scale?: 'linear' | 'log'): number {
  const raw = amountOf(value, dest, scale)
  const inverted = dest.invert ? 1 - raw : raw
  return Math.min(1, Math.max(0, inverted))
}

function destinationScale(property: string): 'linear' | 'log' | undefined {
  return parseAudioProperty(property)?.spec.scale
}

function impliedAmounts(slot: MacroSlot, patch: AudioPatch): number[] {
  const amounts: number[] = []
  for (const dest of slot.destinations) {
    const path = parseAudioProperty(dest.property)
    if (!path || path.spec.type !== 'number') continue
    const current = currentAudioValue(patch, dest.property)
    if (typeof current !== 'number' || !Number.isFinite(current)) continue
    amounts.push(impliedDestinationAmount(dest, current, path.spec.scale))
  }
  return amounts
}

/** True when a mapped macro cannot represent the patch with one amount. */
export function macroIsParked(slot: MacroSlot, patch: AudioPatch): boolean {
  if (!macroIsMapped(slot)) return false
  const amounts = impliedAmounts(slot, patch)
  if (amounts.length < 2) return false
  return Math.max(...amounts) - Math.min(...amounts) > PARK_SPREAD
}

/** Destinations whose implied amount is away from the knob: shown as inactive until the next move. */
export function inactiveMacroDestinations(slot: MacroSlot, patch: AudioPatch): string[] {
  if (!macroIsMapped(slot) || slot.destinations.length < 2) return []
  const shown = macroAmount(slot)
  return slot.destinations.flatMap((dest) => {
    const path = parseAudioProperty(dest.property)
    if (!path || path.spec.type !== 'number') return []
    const current = currentAudioValue(patch, dest.property)
    if (typeof current !== 'number' || !Number.isFinite(current)) return [dest.property]
    const implied = impliedDestinationAmount(dest, current, path.spec.scale)
    return Math.abs(implied - shown) > PARK_SPREAD ? [dest.property] : []
  })
}

/**
 * Update displayed amounts from the patch. Destinations that still agree move the knob;
 * destinations that do not are left parked rather than rewritten onto the sound.
 */
export function syncMacrosToPatch(table: MacroSlot[], patch: AudioPatch): MacroSlot[] {
  return table.map((slot) => {
    if (slot.destinations.length === 0) return slot
    if (!macroIsMapped(slot)) {
      const first = slot.destinations[0]
      if (!first) return slot
      const current = currentAudioValue(patch, first.property)
      if (typeof current !== 'number' || !Number.isFinite(current)) return slot
      return { ...slot, value: first.native ? current : impliedDestinationAmount(first, current, destinationScale(first.property)) }
    }
    const amounts = impliedAmounts(slot, patch)
    if (amounts.length === 0) return slot
    const spread = Math.max(...amounts) - Math.min(...amounts)
    if (spread > PARK_SPREAD) return slot
    const median = [...amounts].sort((a, b) => a - b)[Math.floor(amounts.length / 2)] ?? slot.value
    return { ...slot, value: median }
  })
}

/**
 * Recapture the current patch as the origin of this macro's ranges, so the next movement
 * continues from what is heard rather than jumping back to a stale mapping.
 */
export function reanchorMacro(slot: MacroSlot, patch: AudioPatch): MacroSlot {
  const amount = macroAmount(slot)
  return {
    ...slot,
    destinations: slot.destinations.map((dest) => {
      const path = parseAudioProperty(dest.property)
      if (!path || path.spec.type !== 'number') return dest
      const current = currentAudioValue(patch, dest.property)
      if (typeof current !== 'number' || !Number.isFinite(current)) return dest
      const min = path.spec.min ?? 0
      const max = path.spec.max ?? 1
      const held = Math.min(max, Math.max(min, current))
      const log = path.spec.scale === 'log' && dest.from > 0 && dest.to > 0 && held > 0 && min > 0
      const project = (value: number) => (log ? Math.log(Math.max(1e-9, value)) : value)
      const unproject = (value: number) => (log ? Math.exp(value) : value)
      const alpha = mapAmount(amount, 0, 1, { invert: dest.invert, curve: dest.curve })
      const centre = project(held)
      const lo = project(min)
      const hi = project(max)
      const sign = dest.to >= dest.from ? 1 : -1
      const before = sign > 0 ? centre - lo : hi - centre
      const after = sign > 0 ? hi - centre : centre - lo
      const wanted = Math.abs(project(dest.to) - project(dest.from))
      const fitted = Math.min(wanted, alpha > 1e-9 ? before / alpha : Infinity, alpha < 1 - 1e-9 ? after / (1 - alpha) : Infinity)
      const from = unproject(centre - sign * alpha * fitted)
      const to = unproject(centre + sign * (1 - alpha) * fitted)
      return { ...dest, from, to, native: false, legacyTransform: undefined }
    }),
  }
}

/**
 * The table to write when a parked macro is moved: recapture first, then set the new amount,
 * so the first motion after Randomize is continuous.
 */
export function prepareMacroMove(table: MacroSlot[], index: number, nextValue: number, patch: AudioPatch): MacroSlot[] {
  const slot = table[index]
  if (!slot) return table
  const live = macroIsParked(slot, patch) ? reanchorMacro(slot, patch) : slot
  return table.map((entry, at) => (at === index ? { ...live, value: nextValue } : entry))
}
