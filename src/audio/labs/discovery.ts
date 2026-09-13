import { mulberry32 } from '@paramrig/audio/random'
import { EASE_IN, EASE_OUT } from '@paramrig/audio/curves'
import { makeMod, makePatch, makePerformer } from '@paramrig/audio'
import { SCENE_COUNT, STEP_COUNT } from '@paramrig/audio/fields'
import { between, chance, clamp, logBetween, pick } from '../shuffle-draw'
import type { AudioPatch } from '@paramrig/audio'
import { FAMILY_DEFINITIONS, LEGACY_CHARACTERS, LEGACY_MATERIALS, SDK_CHARACTERS, SDK_MATERIALS, SOUND_FAMILIES, isLegacyFamily,
  type FamilyDefinition, type LabCharacter, type LabMaterial, type SoundBehaviour, type SoundFamily, type SynthesisEngine } from './catalog'
import type { LabCriteria, LabRole } from './model'
import { labGestureOptions, type LabGesture } from './selections'
import { applySearchDesign } from './search-design'
import { colourDiscoveryCharacter, colourDiscoveryMaterial, discoveryEnvelope, discoveryVoice } from './discovery-voices'
import { labSubtypeCatalog, SUBTYPE_DEFINITIONS, subtypeBelongsTo, type LabSubtype } from './subtypes'
import { buildFamilyIdentity, articulateFamilyIdentity } from './family-identity'
import { isDetailSubtype } from './detail-catalog'
import { CHORD_DEFINITIONS, hasChord, PITCHED_PERCUSSION, supportsChord, type LabChord, type LabVoicing } from './harmony-catalog'
import { buildChordVoices, finishChord, resolveHarmony } from './harmony'
import { ownsAutoMotion } from './motion-design'

type Rng = () => number
export const DISCOVERY_LAYOUTS = ['solo', 'layered', 'response', 'particles', 'harmonics', 'cascade', 'bed', 'chord'] as const
type Layout = typeof DISCOVERY_LAYOUTS[number]
export type LabRecipe = { family: SoundFamily; engine: SynthesisEngine; layout: Layout; material: LabMaterial; character: LabCharacter; gesture: LabGesture; subtype?: LabSubtype; chord?: LabChord; voicing?: LabVoicing }
const ENGINES: readonly SynthesisEngine[] = ['subtractive', 'fm', 'cascade', 'wavetable', 'vocal', 'comb', 'modal', 'noise', 'additive', 'membrane']
const scales = { chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9] }
const hz = (note: number) => 440 * 2 ** ((note - 69) / 12)

/** The versioned recipe is small enough for history and contains the resolved Any choices. */
export function describeLabRecipe(recipe: string): LabRecipe | null {
  const parts = recipe.split('/')
  const [version, family, engine, layout, material, character, gesture, rawSubtype, chord, voicing] = parts
  const subtype = rawSubtype === '-' ? undefined : rawSubtype
  const harmonic = version === 'discovery-v3' && parts.length === 10 && !!chord && Object.hasOwn(CHORD_DEFINITIONS, chord)
    && (voicing === 'close' || voicing === 'open') && layout === 'chord' && supportsChord(family as SoundFamily, subtype)
    && (rawSubtype === '-' || subtypeBelongsTo(subtype, family as SoundFamily))
  if (!(version === 'discovery-v1' && parts.length === 7 && layout !== 'chord' || version === 'discovery-v2' && parts.length === 8 && layout !== 'chord' && subtypeBelongsTo(subtype, family as SoundFamily) || harmonic)
    || !SOUND_FAMILIES.includes(family as never) || !ENGINES.includes(engine as never) || !DISCOVERY_LAYOUTS.includes(layout as never)
    || !SDK_MATERIALS.includes(material as never) || !SDK_CHARACTERS.includes(character as never)
    || !labGestureOptions(family as SoundFamily).some((option) => option.id === gesture)) return null
  return { family, engine, layout, material, character, gesture, ...(subtype ? { subtype } : {}), ...(harmonic ? { chord, voicing } : {}) } as LabRecipe
}

export function usesDiscovery(criteria: LabCriteria): boolean {
  return !isLegacyFamily(criteria.type) || !(LEGACY_MATERIALS as readonly string[]).includes(criteria.material)
    || !(LEGACY_CHARACTERS as readonly string[]).includes(criteria.character)
    || criteria.diversity !== undefined || criteria.pool !== undefined || criteria.rootNote !== undefined || criteria.scale !== undefined || criteria.subtype !== undefined || hasChord(criteria)
    || ['decelerating', 'irregular', 'alternating'].includes(criteria.motion)
    || ['pure', 'airy', 'gritty', 'hollow', 'shimmer', 'rasp'].includes(criteria.texture ?? '')
}

function fresh<T extends string>(options: readonly T[], recent: readonly string[], rng: Rng): T {
  for (const count of [2, 1, 0]) {
    const excluded = count ? new Set(recent.slice(-count)) : new Set<string>()
    const available = options.filter((option) => !excluded.has(option))
    if (available.length) return pick(rng, available)
  }
  throw new Error('No construction is available for this sound.')
}

function resolveFamily(criteria: LabCriteria, rng: Rng, recent: LabRecipe[]): SoundFamily {
  if (criteria.type !== 'any') return criteria.type
  if (criteria.subtype && criteria.subtype !== 'auto') return SUBTYPE_DEFINITIONS[criteria.subtype].family
  const families = (criteria.pool?.families ?? SOUND_FAMILIES).filter((family) => (!hasChord(criteria) || supportsChord(family, criteria.subtype)) && labGestureOptions(family).some((option) => option.id === (criteria.gesture ?? 'auto') && option.minMs <= criteria.maxMs))
  // Equal domain opportunity: adding ten drum subfamilies must not crowd out nature or interfaces.
  const domains = [...new Set(families.map((family) => FAMILY_DEFINITIONS[family].domain))].sort()
  const domain = fresh(domains, recent.map((r) => FAMILY_DEFINITIONS[r.family].domain), rng)
  return fresh([...families.filter((family) => FAMILY_DEFINITIONS[family].domain === domain)].sort(), recent.map((r) => r.family), rng)
}

function materialFor(criteria: LabCriteria, definition: FamilyDefinition, rng: Rng): LabMaterial {
  if (criteria.material !== 'any') return criteria.material
  if (criteria.pool?.materials) return pick(rng, [...new Set(criteria.pool.materials)].sort())
  const preferred: Record<FamilyDefinition['domain'], LabMaterial[]> = {
    effects: ['metal', 'glass', 'electrical', 'air'], foley: ['wood', 'stone', 'rubber', 'fabric', 'metal', 'sand'],
    nature: ['air', 'liquid', 'fire', 'sand'], creatures: ['air', 'membrane', 'liquid'],
    interface: ['glass', 'electrical', 'wood'], percussion: ['membrane', 'metal', 'wood', 'ceramic'],
    music: ['membrane', 'wood', 'glass', 'electrical'],
  }
  return pick(rng, criteria.diversity === 'wild' ? SDK_MATERIALS.filter((v) => v !== 'any') : [...preferred[definition.domain], ...SDK_MATERIALS.filter((v) => v !== 'any')])
}

function characterFor(criteria: LabCriteria, definition: FamilyDefinition, rng: Rng): LabCharacter {
  if (criteria.character !== 'any') return criteria.character
  if (criteria.pool?.characters) return pick(rng, [...new Set(criteria.pool.characters)].sort())
  const core: LabCharacter[] = definition.domain === 'nature' || definition.domain === 'foley' ? ['acoustic', 'organic', 'clean']
    : definition.domain === 'music' || definition.domain === 'percussion' ? ['analog', 'digital', 'clean', 'retro'] : ['digital', 'futuristic', 'organic']
  return pick(rng, criteria.diversity === 'focused' ? core : [...core, ...SDK_CHARACTERS.filter((v) => v !== 'any')])
}

function rootFrequency(criteria: LabCriteria, definition: FamilyDefinition, rng: Rng): number {
  if (criteria.rootNote !== undefined) return hz(criteria.rootNote)
  const [low, high] = definition.pitch
  const frequency = logBetween(rng, low, high)
  return definition.pitched || hasChord(criteria) ? hz(Math.round(69 + 12 * Math.log2(frequency / 440))) : frequency
}

function defaultGesture(family: SoundFamily, behaviour: SoundBehaviour, duration: number, rng: Rng): LabGesture {
  const preferred: Partial<Record<SoundFamily, LabGesture[]>> = {
    scrape: ['rub', 'ratchet'], roll: ['roll', 'rebounds'], shake: ['shake', 'rattle'], crush: ['crumble', 'fracture'],
    water: behaviour === 'sustain' ? ['sustain'] : ['drip', 'scatter'], fire: ['scatter', 'sustain'], rain: ['scatter', 'sustain'],
    breath: ['breathe', 'swell'], chirp: ['phrase', 'flutter'], alarm: ['pulse', 'sequence'],
    kick: ['single-hit'], snare: ['single-hit'], hat: ['single-hit', 'sequence'],
    confirmation: ['sequence', 'arpeggiate'], error: ['sequence', 'decay'], pluck: ['pluck', 'strum'], keys: ['single-hit', 'strum'],
    explosion: ['single-hit'], engine: ['sustain', 'spin'], spring: ['single-hit', 'decay'], creak: ['rub', 'sustain'],
    tear: ['rub', 'fracture'], pressure: ['surge', 'sustain'], bowed: ['sustain', 'swell'], 'wind-instrument': ['breathe', 'sustain'], choir: ['sustain', 'swell'],
  }
  const generic: Record<SoundBehaviour, LabGesture[]> = {
    strike: ['single-hit', 'pluck', 'ping'], sustain: ['sustain'], phrase: ['phrase', 'sequence', 'pulse'],
    scatter: ['scatter', 'break-apart', 'rattle'], swell: ['swell', 'surge'], sweep: ['sweep', 'move', 'decay'],
  }
  const valid = labGestureOptions(family).filter((option) => option.minMs <= duration * 1000).map((option) => option.id)
  const options = (preferred[family] ?? generic[behaviour]).filter((id) => valid.includes(id))
  return options.length ? pick(rng, options) : 'auto'
}

function articulateDiscovery(patch: AudioPatch, criteria: LabCriteria, family: SoundFamily, rng: Rng, specialized = false): void {
  const motion = criteria.motion
  if (motion !== 'natural' && motion !== 'continuous') {
    const cycles = pick(rng, [2, 3, 4, 5]), phase = rng() * 0.2
    const row = Array.from({ length: STEP_COUNT }, (_, i) => {
      const t = i / (STEP_COUNT - 1)
      if (motion === 'collapsing') return Math.pow(1 - t, 1.7)
      if (motion === 'irregular') return between(rng, 0.05, 1)
      if (motion === 'stuttering') return (i + Math.floor(phase * 10)) % 3 === 0 || rng() > 0.7 ? 1 : 0.05
      const p = motion === 'accelerating' ? t * t : motion === 'decelerating' ? Math.sqrt(t) : t
      return 0.08 + 0.92 * Math.max(0, Math.cos((p * cycles + phase) * Math.PI * 2)) ** 2
    })
    patch.performers[0] = makePerformer({ enabled: true, bipolar: true, shape: 'curve', rate: (STEP_COUNT - 1) / STEP_COUNT,
      target: 'layers[0].cutoff', depth: 0.3, patterns: Array.from({ length: SCENE_COUNT }, () => [...row]) })
  }
  const rate = motion === 'continuous' ? between(rng, 0.15, 1.2) : between(rng, 1, 9)
  patch.mods[2] = makeMod({ enabled: true, shape: motion === 'irregular' ? 'noise' : pick(rng, ['sine', 'triangle']), phase: rng(), rate,
    target: patch.layers[0]!.source.kind === 'table' ? 'layers[0].pulseWidth' : 'layers[0].cutoff', depth: between(rng, 0.08, 0.35) })
  if (patch.layers[1]!.enabled) patch.mods[3] = makeMod({ enabled: true, shape: pick(rng, ['sine', 'triangle', 'noise']), phase: rng(), rate: rate * between(rng, 0.3, 2),
    target: 'layers[1].cutoff', depth: between(rng, 0.08, 0.3) })
  if (motion === 'alternating') {
    patch.mods[7] = makeMod({ enabled: true, shape: 'sine', rate: between(rng, 2, 5), target: 'layers[0].pan', depth: 0.6, targetB: 'layers[1].pan', depthB: -0.6 })
  }
  if (specialized) return
  if (family === 'rise' || family === 'fall') for (const layer of patch.layers.filter((l) => l.enabled)) {
    layer.pitch.slide = (family === 'rise' ? 1 : -1) * between(rng, 12, 30)
    layer.pitch.slideCurve = family === 'rise' ? EASE_IN : EASE_OUT
  }
  if (family === 'whoosh' || family === 'wind' || family === 'breath') {
    const airy = patch.layers.find((l) => l.enabled && l.source.kind === 'noise') ?? patch.layers[1]!
    airy.enabled = true; airy.source.kind = 'noise'; airy.source.colour = 'pink'; airy.source.pmFrom = 'internal'
    airy.filterA.kind = 'bandpass'; airy.filterA.cutoff = logBetween(rng, 700, 4000); airy.filterA.envAmount = family === 'whoosh' ? between(rng, 2, 5) : between(rng, -1, 1)
    airy.insertA.kind = 'off'
  }
  if (family === 'kick') {
    patch.layers[0]!.pitch.slide = -between(rng, 10, 24); patch.layers[0]!.filterA.cutoff = between(rng, 350, 1100)
  }
  if (family === 'snare') {
    const wire = patch.layers[1]!; wire.enabled = true; wire.source.kind = 'noise'; wire.source.colour = 'white'; wire.source.pmFrom = 'internal'
    wire.filterA.kind = 'highpass'; wire.filterA.cutoff = between(rng, 1100, 3500); wire.gain = between(rng, 0.25, 0.4)
    wire.amp = discoveryEnvelope('strike', rng)
  }
  if (family === 'hat') for (const layer of patch.layers.filter((l) => l.enabled)) {
    layer.filterA.kind = 'highpass'; layer.filterA.cutoff = between(rng, 2800, 6200); layer.filterA.envAmount = 0
    if (layer.source.kind === 'noise') layer.source.colour = 'metallic'
  }
  if (family === 'water' || family === 'chirp') {
    patch.layers[0]!.pitch.slide = between(rng, family === 'water' ? -20 : 4, family === 'water' ? -4 : 20)
    patch.layers[0]!.source.fmFall = 0.85
  }
  if (family === 'bass') { patch.layers[0]!.filterA.cutoff = Math.min(patch.layers[0]!.filterA.cutoff, 2800); patch.fx.width = 0.35 }
  if (family === 'footstep') { patch.layers[1]!.offset = between(rng, 0.04, 0.12); patch.layers[1]!.amp = discoveryEnvelope('strike', rng) }
}

/** A different graph, layout and excitation are drawn before continuous parameter variation. */
export function buildDiscovery(criteria: LabCriteria, seed: number, duration: number, recentRecipes: readonly string[]) {
  const recent = recentRecipes.map(describeLabRecipe).filter((r): r is LabRecipe => r !== null).slice(-8)
  const rng = mulberry32(seed ^ 0x59db75b1)
  const family = resolveFamily(criteria, mulberry32(seed ^ 0x316acb91), recent), definition = FAMILY_DEFINITIONS[family]
  const material = materialFor(criteria, definition, mulberry32(seed ^ 0x18ca7f13)), character = characterFor(criteria, definition, mulberry32(seed ^ 0x757d48a1))
  const resolved: LabCriteria = { ...criteria, type: family, material, character }
  const previous = recent.filter((r) => r.family === family)
  // Preserve existing v1 draws unless a subtype is requested. New families always have an identity.
  const expanded = ['explosion', 'engine', 'spring', 'creak', 'tear', 'pressure', 'bowed', 'wind-instrument', 'choir'].includes(family)
  const harmonic = hasChord(criteria), tunedPercussion = harmonic && family === 'percussion'
  const subtypeOptions = labSubtypeCatalog(family).map((option) => option.id).filter((id) => !tunedPercussion || (PITCHED_PERCUSSION as readonly string[]).includes(id))
  const subtype = criteria.subtype && criteria.subtype !== 'auto' ? criteria.subtype
    : (expanded || tunedPercussion || criteria.subtype === 'auto') && subtypeOptions.length ? fresh(subtypeOptions, previous.flatMap((r) => r.subtype ? [r.subtype] : []), mulberry32(seed ^ 0x2be19407)) : undefined
  const harmony = harmonic ? resolveHarmony(criteria, seed, previous) : undefined
  const choices = criteria.diversity === 'focused' ? definition.engines.slice(0, 3) : definition.engines
  // A four-layer chord cannot also reserve an external PM carrier or an unpitched root.
  const engines = harmonic ? [...new Set(choices.map((id) => id === 'cascade' ? 'fm' as const : id === 'noise' ? 'subtractive' as const : id))] : choices
  const engine = fresh(engines, previous.map((r) => r.engine), rng)
  const continuous = criteria.motion === 'continuous' && (!criteria.gesture || criteria.gesture === 'auto')
  const behaviour = continuous ? 'sustain' : pick(rng, definition.behaviours)
  const root = rootFrequency(criteria, definition, mulberry32(seed ^ 0x746ab381))
  const pitched = definition.pitched === true || criteria.rootNote !== undefined || harmonic
  const possible: Layout[] = engine === 'additive' ? ['harmonics', 'layered', 'response'] : engine === 'cascade' ? ['cascade', 'layered']
    : behaviour === 'sustain' || behaviour === 'swell' ? ['layered', 'bed', 'harmonics'] : ['solo', 'layered', 'response', 'particles']
  const layout = fresh(criteria.diversity === 'focused' ? possible.slice(0, 2) : possible, previous.map((r) => r.layout), rng)
  const count = engine === 'additive' ? pick(rng, [3, 4]) : engine === 'cascade' ? pick(rng, [2, 3, 4])
    : layout === 'solo' ? 2 : criteria.diversity === 'wild' ? 4 : pick(rng, [2, 3, 4])
  const layers = [discoveryVoice(engine, root, behaviour, rng, pitched)]
  const roles: LabRole[] = ['body']
  const degrees = scales[criteria.scale ?? 'pentatonic']
  const notes = [0, pick(rng, degrees.filter((n) => n > 0)), 7, 12]
  const partials = [1, pick(rng, [2, 3]), pick(rng, [4, 5]), pick(rng, [6, 7, 8])]
  for (let i = 1; i < count; i++) {
    const additive = engine === 'additive' || layout === 'harmonics'
    const supportEngine: SynthesisEngine = additive ? 'additive' : engine === 'cascade' && i === 1 ? pick(rng, ['fm', 'wavetable'])
      : criteria.diversity === 'wild' ? pick(rng, ENGINES.filter((value) => value !== 'cascade'))
        : pick(rng, pitched ? ['subtractive', 'additive', 'fm', 'noise'] : ['noise', 'modal', 'comb', 'fm'])
    const ratio = additive ? partials[i]! : pitched ? 2 ** (notes[i]! / 12) : pick(rng, [0.5, 1.5, 2.73, 4, 5.09])
    const role: LabRole = additive ? 'resonance' : supportEngine === 'noise' ? behaviour === 'strike' ? 'attack' : 'texture' : engine === 'cascade' && i === 1 ? 'mechanism' : i === count - 1 ? 'tail' : 'resonance'
    const layer = discoveryVoice(supportEngine, clamp(root * ratio, 30, 7800), behaviour, rng, pitched)
    layer.gain = additive ? between(rng, 0.13, 0.3) / Math.sqrt(i + 1) : between(rng, 0.12, 0.3)
    layer.pan = between(rng, -0.55, 0.55)
    layer.offset = layout === 'response' ? i * 0.18 : layout === 'particles' ? between(rng, 0, 0.45) : 0
    if (layout === 'bed') { layer.amp = discoveryEnvelope('sustain', rng); layer.amp.attack = between(rng, 0.18, 0.4) }
    if (layout === 'solo') layer.gain *= 0.28
    layers.push(layer); roles.push(role)
  }
  const patch = makePatch(1, layers, {
    x: { kind: pitched ? pick(rng, ['off', 'chorus', 'phaser']) : pick(rng, ['off', 'phaser', 'flanger', 'chorus']), mix: between(rng, 0.05, 0.22), rate: between(rng, 0.15, 2), depth: between(rng, 0.15, 0.6) },
    y: { kind: chance(rng, 0.4) ? 'delay' : 'off', mode: 'send', time: between(rng, 0.035, 0.2), feedback: between(rng, 0.12, 0.38), mix: between(rng, 0.06, 0.16) },
    z: { kind: chance(rng, definition.domain === 'music' ? 0.45 : 0.25) ? 'reverb' : 'off', mode: 'send', size: between(rng, 0.1, 0.38), damping: between(rng, 0.3, 0.8), mix: between(rng, 0.05, 0.18) },
    width: between(rng, 0.35, 0.8), tone: between(rng, -0.15, 0.12),
  }, { gain: 0.7, limiter: 0.45, fadeOut: 0.05 }, seed % 10000)
  // A modulator's audio envelope and lifetime must cover every carrier it feeds.
  if (engine === 'cascade') {
    patch.layers[1]!.offset = 0; patch.layers[1]!.amp = { ...patch.layers[0]!.amp }
    if (count > 2 && chance(rng, 0.6)) {
      patch.layers[1]!.source.pmFrom = 'layer2'; patch.layers[2]!.offset = 0; patch.layers[2]!.amp = { ...patch.layers[0]!.amp }; roles[2] = 'mechanism'
    }
  }
  if (subtype) buildFamilyIdentity(patch, roles, subtype, mulberry32(seed ^ 0x483ea271))
  if (harmony) buildChordVoices(patch, roles, harmony.chord, harmony.voicing)
  colourDiscoveryMaterial(patch, material, mulberry32(seed ^ 0x174b58f1), subtype || pitched || engine === 'cascade' ? 1 : chance(rng, 0.5) ? 0 : 1)
  colourDiscoveryCharacter(patch, resolved, mulberry32(seed ^ 0x548afd13))
  articulateDiscovery(patch, resolved, family, rng, !!subtype && isDetailSubtype(subtype))
  const gesture = ownsAutoMotion(criteria) ? 'auto' : criteria.gesture && criteria.gesture !== 'auto' ? criteria.gesture : continuous
    ? labGestureOptions(family).some((option) => option.id === 'sustain' && option.minMs <= duration * 1000) ? 'sustain' : 'auto'
      : defaultGesture(family, behaviour, duration, rng)
  // The secondary voice carries texture so "airy bass" still has a bass fundamental.
  applySearchDesign(patch, roles, { ...resolved, gesture }, seed, 1, subtype ? () => articulateFamilyIdentity(patch, roles, subtype, resolved, mulberry32(seed ^ 0x3163fc25)) : undefined, criteria.gesture ?? 'auto')
  if (criteria.texture && criteria.texture !== 'auto') patch.layers[1]!.gain = Math.max(patch.layers[1]!.gain, 0.14 + (criteria.density ?? 0.5) * 0.1)
  // A selected gesture owns layer timing; only automatic family phrasing retains layout offsets.
  patch.layers.forEach((layer, i) => {
    if (!layer.enabled) return
    if (pitched && !['sweep', 'move', 'retract', 'deploy'].includes(gesture)) layer.pitch.slide = 0
    const placeLayers = !ownsAutoMotion(criteria) && (!criteria.gesture || criteria.gesture === 'auto') && (!subtype || !continuous)
    if (placeLayers && engine !== 'cascade' && gesture !== 'strum' && layout === 'response') layer.offset = i * 0.16
    if (placeLayers && engine !== 'cascade' && layout === 'particles') layer.offset = i ? between(rng, 0.02, 0.35) : 0
  })
  // Musical phrasing uses the requested scale. Pitch events are separate from volume contours.
  if (!harmony && (gesture === 'arpeggiate' || family === 'confirmation' || family === 'error' || family === 'alarm')) {
    const tunedRoot = patch.layers[0]!.pitch.start
    const intervals = family === 'error' ? [0, -2, -5, -12] : family === 'alarm' ? [0, 7, 0, 7] : notes
    patch.layers.forEach((layer, i) => {
      if (!layer.enabled || layer.source.kind === 'noise') return
      layer.pitch.start = clamp(tunedRoot * 2 ** (intervals[i]! / 12), 30, 7800)
      layer.pitch.slide = 0; layer.pitch.arpeggioRatio = 2 ** ((intervals[(i + 1) % intervals.length]! - intervals[i]!) / 12); layer.pitch.arpeggioAt = 0.5
    })
  }
  if (criteria.rootNote !== undefined) {
    // Root stays exact; optional layers may supply requested texture and inharmonic resonances.
    patch.layers[0]!.pitch.start = hz(criteria.rootNote)
    patch.layers[0]!.pitch.jitter = 0
  }
  if (harmony) {
    finishChord(patch, resolved, harmony.chord, harmony.voicing, gesture)
    return { patch, roles, resolved, recipe: `discovery-v3/${family}/${engine}/chord/${material}/${character}/${gesture}/${subtype ?? '-'}/${harmony.chord}/${harmony.voicing}` }
  }
  const actualLayout = (ownsAutoMotion(criteria) || criteria.gesture && criteria.gesture !== 'auto') && ['response', 'particles'].includes(layout) ? 'layered' : layout
  return { patch, roles, resolved, recipe: `discovery-${subtype ? 'v2' : 'v1'}/${family}/${engine}/${actualLayout}/${material}/${character}/${gesture}${subtype ? `/${subtype}` : ''}` }
}
