import { AUDIO_FIELDS, FX_SLOTS, LAYER_SECTIONS, type FieldSpec, type LayerSection } from './fields.ts'
import { applyMacros, type MacroSlot } from './macros.ts'
import { parseAudioProperty } from './rig.ts'
import { mulberry32 } from './dsp/rng.ts'
import type { AudioPatch, InsertKind, Layer, Performer } from './types.ts'
import { buildArchitecture, chooseFamily, SOUND_FAMILIES, type RandomFamily } from './shuffle-architectures.ts'
import { clamp, probePatch, settleCandidate } from './shuffle-draw.ts'

export type { RandomFamily, SoundFamily } from './shuffle-architectures.ts'
export { SOUND_FAMILIES }

export const MUTATE_AMOUNTS = ['subtle', 'medium', 'strong'] as const
export type MutateAmount = typeof MUTATE_AMOUNTS[number]

export const MUTATE_TARGETS = ['balanced', 'timbre', 'motion', 'space'] as const
export type MutateTarget = typeof MUTATE_TARGETS[number]

export type MutateOptions = {
  amount?: MutateAmount | number
  target?: MutateTarget
  macros?: MacroSlot[]
}

export type RandomizeOptions = {
  family?: RandomFamily
  /** Skip the render-and-level pass. Structure tests use this; the button never does. */
  settle?: boolean
}

const MAX_ATTEMPTS = 4

export function randomPatch(seed: number, sampleRate = 44100, options: RandomizeOptions = {}): AudioPatch {
  const requested = options.family ?? 'any'
  let result: AudioPatch | null = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const random = mulberry32(seed + attempt * 7919)
    const family = chooseFamily(random, requested)
    const drawn = buildArchitecture(random, family, seed + attempt)
    if (options.settle === false) return drawn
    const settled = settleCandidate(drawn, sampleRate)
    result = settled.patch
    if (settled.ok) return settled.patch
  }
  return result ?? buildArchitecture(mulberry32(seed), chooseFamily(mulberry32(seed), requested), seed)
}

type Scale = {
  oct: number
  time: number
  timeAbs: number
  db: number
  unit: number
  pan: number
  res: number
  fm: number
}

const SCALES: Record<MutateAmount, Scale> = {
  subtle: { oct: 0.07, time: 0.08, timeAbs: 0.002, db: 1.15, unit: 0.03, pan: 0.05, res: 0.035, fm: 0.22 },
  medium: { oct: 0.18, time: 0.18, timeAbs: 0.006, db: 2.5, unit: 0.075, pan: 0.12, res: 0.075, fm: 0.55 },
  strong: { oct: 0.4, time: 0.32, timeAbs: 0.014, db: 4.4, unit: 0.13, pan: 0.22, res: 0.12, fm: 1.05 },
}

function resolveAmount(amount?: MutateAmount | number): MutateAmount {
  if (amount === 'subtle' || amount === 'medium' || amount === 'strong') return amount
  if (typeof amount !== 'number') return 'subtle'
  if (amount <= 0.16) return 'subtle'
  if (amount <= 0.35) return 'medium'
  return 'strong'
}

type Group = 'timbre' | 'motion' | 'space' | 'structure' | 'level'

function fieldGroup(property: string, spec: FieldSpec): Group {
  if (spec.type !== 'number') return 'structure'
  const name = property.split('.').pop() ?? property
  if (name === 'duration' || name === 'seed' || name === 'scene') return 'structure'
  if (name === 'enabled' || name === 'voices' || name === 'grid' || name === 'partials' || name === 'bitDepth') {
    return name === 'bitDepth' || name === 'partials' ? 'timbre' : 'structure'
  }
  if (name === 'pan' || property === 'fx.width' || name === 'spread' && !property.includes('insert')) return 'space'
  if (property.startsWith('fx.') && (name === 'mix' || name === 'size' || name === 'damping' || name === 'width' || name === 'time' || name === 'rate' || name === 'depth' || name === 'feedback')) {
    return name === 'rate' || name === 'depth' ? 'motion' : 'space'
  }
  if (name === 'gain' || name === 'limiter') return 'level'
  if (
    name === 'attack' || name === 'hold' || name === 'decay' || name === 'sustain' || name === 'release'
    || name === 'curve' || name === 'offset' || name === 'slide' || name === 'vibratoRate' || name === 'vibratoDepth'
    || name === 'arpeggioRatio' || name === 'arpeggioAt' || name === 'jitter' || name === 'envAmount' || name === 'fmFall'
    || name === 'delay' || name === 'phase' || (property.includes('mods[') && (name === 'rate' || name === 'depth' || name === 'depthB' || name === 'depthC' || name === 'depthD'))
    || property.includes('performers[')
  ) return 'motion'
  return 'timbre'
}

function insertUsed(kind: InsertKind): Set<string> {
  if (kind === 'drive') return new Set(['amount', 'drive'])
  if (kind === 'crusher') return new Set(['amount', 'bitDepth', 'crush'])
  if (kind === 'ring') return new Set(['amount', 'ratio'])
  if (kind === 'fold') return new Set(['amount', 'drive'])
  if (kind === 'body') return new Set(['amount', 'frequency', 'spread', 'decay', 'partials', 'character'])
  if (kind === 'comb') return new Set(['amount', 'time', 'feedback'])
  return new Set()
}

function fxUsed(kind: string): Set<string> {
  if (kind === 'flanger' || kind === 'chorus' || kind === 'phaser') return new Set(['mix', 'rate', 'depth', 'feedback'])
  if (kind === 'delay') return new Set(['mix', 'time', 'feedback'])
  if (kind === 'reverb') return new Set(['mix', 'size', 'damping'])
  if (kind === 'widener') return new Set(['mix', 'width', 'rate', 'depth'])
  return new Set()
}

function dormantLayerField(layer: Layer, section: LayerSection, field: string, intensity: MutateAmount): boolean {
  if (!layer.enabled) return true
  if (section === 'filterB' && layer.routing === 'single') return true
  if (section === 'root' && field === 'filterMix' && layer.routing !== 'parallel') return true
  if (section === 'root' && field === 'spread' && layer.source.voices <= 1) return true
  if (section === 'source') {
    if (field === 'table' || field === 'position') return layer.source.kind !== 'table'
    if (field === 'colour') return layer.source.kind !== 'noise'
    if (field === 'wave' || field === 'pulseWidth') return layer.source.kind === 'noise'
    if (field === 'detune') return layer.source.voices <= 1
    if (field === 'fmRatio' || field === 'fmFall') return layer.source.fmIndex <= 0 && intensity === 'subtle'
    if (field === 'fmIndex' && layer.source.fmIndex <= 0 && intensity === 'subtle') return true
  }
  if (section === 'filterA' || section === 'filterB') {
    if (layer[section].kind === 'off' && field !== 'kind') return true
  }
  if (section === 'insertA' || section === 'insertB' || section === 'insertC') {
    const slot = layer[section]
    if (slot.kind === 'off') return field !== 'kind'
    if (field === 'kind' || field === 'place' || field === 'profile') return true
    if (!insertUsed(slot.kind).has(field)) return true
    if (field === 'amount' && slot.amount <= 0 && intensity === 'subtle') return true
  }
  if (section === 'pitch') {
    if ((field === 'vibratoRate' || field === 'vibratoDepth') && layer.pitch.vibratoDepth <= 0 && intensity === 'subtle') return true
    if ((field === 'arpeggioRatio' || field === 'arpeggioAt') && Math.abs(layer.pitch.arpeggioRatio - 1) < 0.02 && intensity === 'subtle') return true
  }
  return false
}

function targets(target: MutateTarget, random: () => number): Set<Group> {
  if (target === 'timbre' || target === 'motion' || target === 'space') return new Set([target])
  const groups: Group[] = ['timbre', 'motion', 'space']
  for (let i = groups.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const hold = groups[i]!
    groups[i] = groups[j]!
    groups[j] = hold
  }
  return new Set(groups.slice(0, random() < 0.45 ? 1 : 2))
}

function nudge(random: () => number, current: number, spec: FieldSpec, property: string, intensity: MutateAmount): number {
  const min = spec.min ?? 0
  const max = spec.max ?? 1
  const scale = SCALES[intensity]
  const name = property.split('.').pop() ?? property
  const nearTop = (current - min) / Math.max(1e-9, max - min)
  const cautious = (span: number) => span * (0.45 + 0.55 * (1 - Math.max(0, nearTop - 0.55) / 0.45))

  let next = current
  if (spec.scale === 'log' || name === 'start' || name === 'cutoff' || name === 'frequency') {
    next = current * (2 ** ((random() * 2 - 1) * scale.oct))
  } else if (spec.unit === 'ms' || name === 'attack' || name === 'hold' || name === 'decay' || name === 'release' || name === 'offset' || name === 'fadeOut' || name === 'time' && spec.unit === 'ms') {
    const relative = current * (1 + (random() * 2 - 1) * scale.time)
    next = relative + (random() * 2 - 1) * scale.timeAbs
  } else if (name === 'gain' || name === 'limiter') {
    if (current <= 1e-6 && intensity === 'subtle') return current
    next = current <= 1e-6 ? (10 ** ((random() * scale.db * 0.25) / 20) - 1) : current * (10 ** (((random() * 2 - 1) * scale.db) / 20))
  } else if (name === 'pan' || name === 'spread' && !property.includes('insert') || name === 'width') {
    next = current + (random() * 2 - 1) * scale.pan
  } else if (name === 'resonance' || name === 'feedback') {
    next = current + (random() * 2 - 1) * cautious(scale.res)
  } else if (name === 'fmIndex' || name === 'drive') {
    if (current <= 1e-6 && intensity === 'subtle') return current
    next = current + (random() * 2 - 1) * cautious(scale.fm)
  } else if (name === 'mix' || name === 'amount' || name === 'depth' || name === 'depthB' || name === 'depthC' || name === 'depthD') {
    if (Math.abs(current) <= 1e-6 && intensity === 'subtle') return current
    next = current + (random() * 2 - 1) * scale.unit
  } else {
    next = current + (random() * 2 - 1) * scale.unit * Math.max(0.15, max - min)
  }
  const moved = clamp(next, min, max)
  return spec.step && spec.step >= 1 ? Math.round(moved) : moved
}

function macroGroup(slot: MacroSlot): Group | 'mixed' | 'empty' {
  const groups = new Set<Group>()
  for (const dest of slot.destinations) {
    const spec = parseAudioProperty(dest.property)?.spec
    if (!spec) continue
    groups.add(fieldGroup(dest.property, spec))
  }
  groups.delete('structure')
  if (groups.size === 0) return 'empty'
  if (groups.size === 1) return [...groups][0]!
  return 'mixed'
}

function mutatePerformer(performer: Performer, scene: number, random: () => number, intensity: MutateAmount): Performer {
  if (!performer.enabled) return performer
  const scale = SCALES[intensity]
  const depth = clamp(performer.depth + (random() * 2 - 1) * scale.unit, 0, 1)
  const rate = clamp(performer.rate + (random() * 2 - 1) * (intensity === 'subtle' ? 0 : intensity === 'medium' ? 0.25 : 0.5), 0.25, 8)
  const row = performer.patterns[scene]?.slice() ?? []
  const curves = performer.curves[scene]?.slice() ?? []
  const count = intensity === 'subtle' ? 3 : intensity === 'medium' ? 4 : 5
  const used = new Set<number>()
  for (let n = 0; n < count && row.length; n += 1) {
    let index = Math.floor(random() * row.length)
    let guard = 0
    while (used.has(index) && guard < 8) { index = Math.floor(random() * row.length); guard += 1 }
    used.add(index)
    const current = row[index] ?? 0
    const prev = row[(index + row.length - 1) % row.length] ?? 0
    const next = row[(index + 1) % row.length] ?? 0
    const accent = current >= prev && current >= next && current > 0.55
    let moved = clamp(current + (random() * 2 - 1) * scale.unit * 1.4, 0, 1)
    if (accent) moved = Math.max(moved, Math.max(prev, next) * 0.9, 0.55)
    row[index] = moved
    if (curves.length && random() < 0.45) {
      curves[index] = clamp((curves[index] ?? 1) + (random() * 2 - 1) * scale.unit, 0, 1)
    }
  }
  return {
    ...performer,
    depth,
    rate,
    patterns: performer.patterns.map((entry, index) => (index === scene ? row : entry)),
    curves: performer.curves.map((entry, index) => (index === scene ? curves : entry)),
  }
}

type Branch = { table: Record<string, FieldSpec>; source: Record<string, unknown>; path: string; dormant: (field: string) => boolean }

function branches(patch: AudioPatch, intensity: MutateAmount): Branch[] {
  const layers = patch.layers.flatMap((layer, index) =>
    (Object.keys(LAYER_SECTIONS) as LayerSection[]).map((section) => ({
      table: LAYER_SECTIONS[section],
      source: (section === 'root' ? layer : layer[section]) as unknown as Record<string, unknown>,
      path: `layers[${index}]${section === 'root' ? '' : `.${section}`}`,
      dormant: (field: string) => dormantLayerField(layer, section, field, intensity),
    })),
  )
  return [
    ...layers,
    ...patch.mods.map((mod, index) => ({
      table: AUDIO_FIELDS.mod,
      source: mod as unknown as Record<string, unknown>,
      path: `mods[${index}]`,
      dormant: (field: string) => !mod.enabled || field === 'enabled' || field === 'kind' || field === 'shape' || field === 'target' || field === 'targetB' || field === 'targetC' || field === 'targetD' || ((field === 'depth' && mod.target === 'off') || (field === 'depthB' && mod.targetB === 'off') || (field === 'depthC' && mod.targetC === 'off') || (field === 'depthD' && mod.targetD === 'off')),
    })),
    ...patch.performers.map((performer, index) => ({
      table: AUDIO_FIELDS.performer,
      source: performer as unknown as Record<string, unknown>,
      path: `performers[${index}]`,
      dormant: (field: string) => !performer.enabled || field === 'enabled' || field === 'shape' || field === 'bipolar' || field === 'grid' || field.startsWith('target') || field === 'patterns' || field === 'curves',
    })),
    ...FX_SLOTS.map((slot) => ({
      table: AUDIO_FIELDS.fxSlot,
      source: patch.fx[slot] as unknown as Record<string, unknown>,
      path: `fx.${slot}`,
      dormant: (field: string) => {
        const kind = patch.fx[slot].kind
        if (kind === 'off') return field !== 'kind'
        if (field === 'kind' || field === 'mode') return true
        return !fxUsed(kind).has(field)
      },
    })),
    { table: AUDIO_FIELDS.fx, source: patch.fx as unknown as Record<string, unknown>, path: 'fx', dormant: () => false },
    { table: AUDIO_FIELDS.master, source: patch.master as unknown as Record<string, unknown>, path: 'master', dormant: (field) => field === 'gain' },
  ]
}

function protectedProperties(): Set<string> {
  return new Set(['duration', 'seed', 'scene'])
}

export function mutatePatch(patch: AudioPatch, seed: number, amount: number | MutateOptions = 0.12, sampleRate = 44100): AudioPatch {
  return mutateSound(patch, seed, typeof amount === 'number' ? { amount } : amount, sampleRate).patch
}

/**
 * Same sound, moved. Distances follow the parameter, not a fraction of its full range: a cutoff
 * travels in octaves, a gain in decibels, a 4 ms attack by a few milliseconds. Inactive modules
 * stay asleep, and a mapped macro is moved once rather than having its destinations walked again.
 */
export function mutateSound(patch: AudioPatch, seed: number, options: MutateOptions = {}, sampleRate = 44100): { patch: AudioPatch; macros?: MacroSlot[] } {
  const random = mulberry32(seed)
  const intensity = resolveAmount(options.amount)
  const wanted = targets(options.target ?? 'balanced', random)
  const next = structuredClone(patch)
  const skip = protectedProperties()
  let macros = options.macros ? options.macros.map((slot) => ({ ...slot, destinations: slot.destinations.map((dest) => ({ ...dest })) })) : undefined

  if (macros) {
    const mutated: number[] = []
    macros = macros.map((slot, index) => {
      const group = macroGroup(slot)
      if (group === 'empty' || group === 'mixed' || group === 'structure' || group === 'level') return slot
      if (!wanted.has(group)) return slot
      slot.destinations.forEach((entry) => skip.add(entry.property))
      mutated.push(index)
      if (slot.destinations[0]?.native) {
        const dest = slot.destinations[0]
        const spec: FieldSpec = { type: 'number', min: dest.from, max: dest.to, label: dest.property }
        return { ...slot, value: nudge(random, slot.value, spec, dest.property, intensity) }
      }
      const drift = (random() * 2 - 1) * SCALES[intensity].unit * 1.6
      return { ...slot, value: clamp(slot.value + drift, 0, 1) }
    })
    for (const index of mutated) {
      Object.assign(next, applyMacros(next, macros, undefined, index))
    }
  }

  for (const branch of branches(next, intensity)) {
    for (const [field, spec] of Object.entries(branch.table)) {
      if (spec.type !== 'number') continue
      const property = branch.path ? `${branch.path}.${field}` : field
      const trimmed = property.replace(/^\./, '')
      if (skip.has(trimmed) || skip.has(property) || skip.has(field) && branch.path === '') continue
      if (branch.dormant(field)) continue
      const group = fieldGroup(trimmed, spec)
      if (group === 'structure' || group === 'level') continue
      if (!wanted.has(group)) continue
      const current = branch.source[field]
      if (typeof current !== 'number') continue
      branch.source[field] = nudge(random, current, spec, trimmed, intensity)
    }
  }

  if (wanted.has('motion')) {
    next.performers = next.performers.map((performer) => mutatePerformer(performer, next.scene, random, intensity))
  }

  const original = probePatch(patch, sampleRate)
  const settled = settleCandidate(next, sampleRate, 0.75, original)
  return { patch: settled.patch, macros }
}
