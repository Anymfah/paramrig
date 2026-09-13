import { LINEAR } from '@paramrig/audio/curves'
import { applyMacros, emptyMacros, macroAmount, macrosOf, mapDestination, reanchorMacro, writeMacros, type MacroDestination, type MacroSlot } from '../macros'
import { currentAudioValue, parseAudioProperty, type AudioRig } from '@paramrig/audio/bindings'
import { setBoardValue } from '../board'
import type { AudioPatch } from '@paramrig/audio'
import { clamp } from '../shuffle-draw'
import { fingerprint, LAB_VERSION, type LabCriteria, type LabOrigin, type LabRole, type LabSound } from './model'

/** Roles are declared while building a recipe; arbitrary imported patches remain unknown. */
export function recipeRoles(patch: AudioPatch): LabRole[] {
  return patch.layers.map((layer, index) => {
    if (!layer.enabled) return 'unknown'
    if (index === 0 || (layer.source.kind !== 'noise' && layer.pitch.start < 160)) return 'body'
    if (layer.amp.hold + layer.amp.decay < 0.12 && layer.offset < 0.1) return 'attack'
    if (layer.offset > patch.duration * 0.5) return 'tail'
    if (layer.insertC.kind === 'body' || layer.insertC.kind === 'comb') return 'resonance'
    return layer.source.kind === 'noise' ? 'texture' : 'mechanism'
  })
}

const routeKeys = ['target', 'targetB', 'targetC', 'targetD'] as const
const depthKeys = ['depth', 'depthB', 'depthC', 'depthD'] as const

export function labMacros(patch: AudioPatch, criteria?: LabCriteria): MacroSlot[] {
  const table = emptyMacros()
  const groups: [string, string[]][] = [['Grain', []], ['Bite', []], ['Motion', []], ['Space', []]]
  patch.layers.forEach((layer, i) => {
    if (!layer.enabled) return
    const p = `layers[${i}]`
    if (layer.source.kind !== 'noise' && layer.source.fmIndex > 0) groups[0]![1].push(`${p}.source.fmIndex`)
    if (layer.source.kind === 'table') groups[0]![1].push(`${p}.source.position`)
    for (const slot of ['insertA', 'insertB', 'insertC'] as const) {
      if (layer[slot].kind === 'drive' || layer[slot].kind === 'fold') groups[0]![1].push(`${p}.${slot}.drive`)
      if (layer[slot].kind === 'body') groups[0]![1].push(`${p}.${slot}.character`)
    }
    for (const filter of ['filterA', 'filterB'] as const) {
      if (layer[filter].kind !== 'off' && (filter === 'filterA' || layer.routing !== 'single')) groups[1]![1].push(`${p}.${filter}.cutoff`)
    }
    if (layer.source.voices > 1) groups[3]![1].push(`${p}.spread`)
  })
  for (const [key, mods] of [['mods', patch.mods], ['performers', patch.performers]] as const) {
    mods.forEach((mod, i) => {
      if (!mod.enabled) return
      routeKeys.forEach((target, at) => {
        if (mod[target] !== 'off' && Math.abs(mod[depthKeys[at]!]!) > 0.001) groups[2]![1].push(`${key}[${i}].${depthKeys[at]}`)
      })
    })
  }
  for (const slot of ['x', 'y', 'z'] as const) if (patch.fx[slot].kind !== 'off') groups[3]![1].push(`fx.${slot}.mix`)
  groups[1]![1].push('fx.tone')
  groups[3]![1].push('fx.width')
  groups.forEach(([label, properties], index) => {
    const destinations: MacroDestination[] = []
    for (const property of properties.slice(0, 10)) {
      const spec = parseAudioProperty(property)?.spec
      const current = currentAudioValue(patch, property)
      if (!spec || spec.type !== 'number' || typeof current !== 'number') continue
      const min = criteria?.avoid.includes('sub') && property.endsWith('.filterA.cutoff') ? 160 : spec.min ?? 0
      const max = criteria?.avoid.includes('piercing') && property.endsWith('.filterB.cutoff') ? 5200 : spec.max ?? 1
      let from: number
      let to: number
      // Bite carries the filters, and it is the one control with a place of its own on the relief:
      // two octaves either way, so the line it lights really travels and the edge really changes.
      const span = Math.log(property.endsWith('.cutoff') ? 4 : 1.65)
      if (spec.scale === 'log' && current > 0) {
        const width = Math.min(span, Math.log(current / Math.max(min, 0.001)), Math.log(max / current))
        from = current * Math.exp(-width)
        to = current * Math.exp(width)
      } else {
        // Space carries the effects, the stereo spread and the width, and it has a place of its own
        // on the relief: it reaches nearly half of each range rather than a fifth.
        const reach = /(\.mix|fx\.width|\.spread)$/.test(property) ? 0.42 : 0.2
        const width = Math.min((max - min) * reach, current - min, max - current)
        from = current - width
        to = current + width
      }
      if (to - from < 1e-6) continue
      destinations.push({ property, from, to, invert: false, curve: LINEAR })
    }
    table[index] = { label, value: 0.5, renamed: true, destinations }
  })
  return table
}

export function makeLabSound(patch: AudioPatch, criteria: LabCriteria, origin: LabOrigin, name: string, rig?: AudioRig): LabSound {
  const imported = origin.kind === 'instrument'
  const table = rig ? macrosOf(rig, patch) : labMacros(patch, criteria)
  const controls = timbreControls(table)
  return {
    id: `lab-${origin.seed}-${fingerprint(patch)}`, name, patch: structuredClone(patch),
    criteria: structuredClone(criteria), origin: { ...origin, version: LAB_VERSION },
    rig: rig ?? writeMacros(undefined, table, patch), macros: table, controls,
    roles: imported ? patch.layers.map(() => 'unknown') : recipeRoles(patch), parents: [], fingerprint: fingerprint(patch),
  }
}

/** Imported pitch, layer levels and timing macros remain intact but cannot silently mutate the core. */
export function timbreControls(table: MacroSlot[]): number[] {
  return table.flatMap((slot, i) => slot.destinations.length && slot.destinations.every((dest) => {
    if (parseAudioProperty(dest.property)?.spec.type !== 'number' || dest.legacyTransform) return false
    return !/^(duration|seed|master\.)/.test(dest.property) && !/\.(pitch\.|amp\.|offset$|gain$)/.test(dest.property)
  }) ? [i] : []).slice(0, 4)
}

/** A relative move from the audible anchor, even for an imported macro off its old curve. */
export function adjustReference(sound: LabSound, values: number[]): LabSound {
  let patch = sound.patch
  const table = structuredClone(sound.macros)
  sound.controls.forEach((index, control) => {
    const slot = table[index]!
    const previous = macroAmount(slot)
    const amount = clamp(values[control] ?? previous, 0, 1)
    if (Math.abs(amount - previous) < 1e-9) return
    // A stale imported mapping is recaptured on its first move, on the child only. Keeping its
    // obsolete curve would make the transferred Instrument jump on the very next knob gesture.
    if (slot.destinations.some((dest) => {
      const current = currentAudioValue(sound.patch, dest.property)
      return typeof current === 'number' && Math.abs(mapDestination(previous, dest, parseAudioProperty(dest.property)?.spec.scale) - current) > 1e-8 * Math.max(1, Math.abs(current))
    })) slot.destinations = reanchorMacro(slot, sound.patch).destinations
    slot.destinations.forEach((dest) => {
      const spec = parseAudioProperty(dest.property)?.spec
      const current = currentAudioValue(sound.patch, dest.property)
      if (!spec || spec.type !== 'number' || typeof current !== 'number') return
      const log = spec.scale === 'log' && current > 0 && dest.from > 0 && dest.to > 0
      const before = mapDestination(previous, dest, spec.scale)
      const after = mapDestination(amount, dest, spec.scale)
      const moved = log ? current * after / Math.max(1e-9, before) : current + after - before
      const min = sound.criteria.avoid.includes('sub') && dest.property.endsWith('.filterA.cutoff') ? 160 : spec.min ?? 0
      const max = sound.criteria.avoid.includes('piercing') && dest.property.endsWith('.filterB.cutoff') ? 5200 : spec.max ?? 1
      patch = setBoardValue(patch, dest.property, clamp(moved, min, max))
    })
    slot.value = slot.destinations[0]?.native
      ? destNative(slot, amount) : amount
  })
  if (patch === sound.patch) return sound
  return { ...sound, patch, macros: table, rig: writeMacros(sound.rig, table, patch), fingerprint: fingerprint(patch) }
}

function destNative(slot: MacroSlot, amount: number): number {
  const dest = slot.destinations[0]!
  return mapDestination(amount, dest, parseAudioProperty(dest.property)?.spec.scale)
}

/** Generated mappings agree exactly with their initial patch; this also guards future changes. */
export function mappedPatch(sound: LabSound): AudioPatch {
  return applyMacros(sound.patch, sound.macros)
}
