import type { LabSubtype } from './subtypes'
import type { HarmonySelections } from './harmony-catalog'

/** Shared SDK vocabulary; legacy lists remain available for existing synthesis recipes. */
export const LEGACY_FAMILIES = ['growl', 'impact', 'transformation', 'servo', 'scan', 'glitch', 'pulse', 'drone', 'rise', 'fall', 'burst', 'texture'] as const
export const LEGACY_MATERIALS = ['any', 'metal', 'glass', 'liquid', 'air', 'electrical'] as const
export const LEGACY_CHARACTERS = ['any', 'mechanical', 'futuristic', 'organic', 'alien', 'industrial'] as const
export type LegacyFamily = typeof LEGACY_FAMILIES[number]
export const SOUND_FAMILIES = [...LEGACY_FAMILIES, 'whoosh', 'scrape', 'roll', 'shake', 'crush', 'footstep',
  'wind', 'water', 'fire', 'rain', 'ambience', 'creature', 'chirp', 'breath',
  'notification', 'confirmation', 'error', 'alarm', 'kick', 'snare', 'hat', 'percussion',
  'bass', 'lead', 'pad', 'pluck', 'bell', 'keys',
  'explosion', 'engine', 'spring', 'creak', 'tear', 'pressure', 'bowed', 'wind-instrument', 'choir'] as const
export const SDK_FAMILIES = ['any', ...SOUND_FAMILIES] as const
export const SDK_MATERIALS = [...LEGACY_MATERIALS, 'wood', 'stone', 'sand', 'ice', 'ceramic', 'rubber', 'fabric', 'membrane', 'fire'] as const
export const SDK_CHARACTERS = [...LEGACY_CHARACTERS, 'acoustic', 'analog', 'digital', 'retro', 'ethereal', 'corrupted', 'clean'] as const
export const SDK_MOTIONS = ['natural', 'continuous', 'pulsed', 'stuttering', 'accelerating', 'collapsing', 'decelerating', 'irregular', 'alternating'] as const
export const LAB_DIVERSITIES = ['focused', 'balanced', 'wild'] as const
export const LAB_SCALES = ['chromatic', 'major', 'minor', 'pentatonic'] as const
export type SoundFamily = typeof SOUND_FAMILIES[number]
export type SdkFamily = typeof SDK_FAMILIES[number]
export type LabMaterial = typeof SDK_MATERIALS[number]
export type LabCharacter = typeof SDK_CHARACTERS[number]
export type LabDiversity = typeof LAB_DIVERSITIES[number]
export type LabScale = typeof LAB_SCALES[number]
export type LabDomain = 'effects' | 'foley' | 'nature' | 'creatures' | 'interface' | 'percussion' | 'music'
export type SynthesisEngine = 'subtractive' | 'fm' | 'cascade' | 'wavetable' | 'vocal' | 'comb' | 'modal' | 'noise' | 'additive' | 'membrane'
export type SoundBehaviour = 'strike' | 'sustain' | 'phrase' | 'scatter' | 'swell' | 'sweep'
export type FamilyDefinition = {
  label: string; domain: LabDomain; description: string
  engines: readonly SynthesisEngine[]; behaviours: readonly SoundBehaviour[]; pitch: readonly [number, number]
  /** True means pitches are drawn on a scale and layers keep harmonic relationships by default. */
  pitched?: boolean
}

/** Multiple constructions per family; these are synthesis directions, not recordings or physical models. */
export const FAMILY_DEFINITIONS: Readonly<Record<SoundFamily, FamilyDefinition>> = {
  growl: { label: 'Growl', domain: 'effects', description: 'Moving throats, bass snarls and resonant vocal effects.', engines: ['vocal', 'wavetable', 'fm', 'comb', 'cascade'], behaviours: ['phrase', 'swell', 'sustain'], pitch: [45, 240] },
  impact: { label: 'Impact', domain: 'effects', description: 'Strikes with a body, transient and optional debris.', engines: ['modal', 'membrane', 'fm', 'noise', 'comb'], behaviours: ['strike', 'scatter'], pitch: [45, 700] },
  transformation: { label: 'Transformation', domain: 'effects', description: 'Several interacting events assembling or changing state.', engines: ['cascade', 'comb', 'wavetable', 'fm', 'vocal'], behaviours: ['phrase', 'scatter', 'swell'], pitch: [60, 700] },
  servo: { label: 'Servo', domain: 'effects', description: 'Motors, ratchets and controlled mechanical travel.', engines: ['fm', 'cascade', 'subtractive', 'comb'], behaviours: ['phrase', 'sweep', 'scatter'], pitch: [90, 1100] },
  scan: { label: 'Scan', domain: 'interface', description: 'Sweeps, probes and scanning sequences.', engines: ['fm', 'additive', 'wavetable', 'noise'], behaviours: ['sweep', 'phrase'], pitch: [260, 1800] },
  glitch: { label: 'Glitch', domain: 'effects', description: 'Interrupted, scattered or fractured electronic events.', engines: ['cascade', 'noise', 'wavetable', 'subtractive', 'comb'], behaviours: ['scatter', 'phrase'], pitch: [80, 1500] },
  pulse: { label: 'Pulse', domain: 'effects', description: 'Repeated events with evolving tone and spacing.', engines: ['subtractive', 'fm', 'modal', 'vocal'], behaviours: ['phrase', 'sustain'], pitch: [55, 900] },
  drone: { label: 'Drone', domain: 'effects', description: 'Continuous, slowly evolving tonal or noisy beds.', engines: ['wavetable', 'additive', 'comb', 'noise', 'vocal'], behaviours: ['sustain', 'swell'], pitch: [35, 380] },
  rise: { label: 'Rise', domain: 'effects', description: 'Building energy, pitch or spectral tension.', engines: ['noise', 'wavetable', 'fm', 'comb'], behaviours: ['swell', 'sweep'], pitch: [100, 800] },
  fall: { label: 'Fall', domain: 'effects', description: 'Descending, collapsing and winding-down effects.', engines: ['fm', 'noise', 'modal', 'subtractive'], behaviours: ['sweep', 'strike'], pitch: [220, 2200] },
  burst: { label: 'Burst', domain: 'effects', description: 'Short clusters of energy and fragments.', engines: ['noise', 'cascade', 'modal', 'wavetable'], behaviours: ['scatter', 'strike'], pitch: [100, 1800] },
  texture: { label: 'Texture', domain: 'effects', description: 'Detailed surfaces, grains and abstract sonic matter.', engines: ['noise', 'comb', 'modal', 'vocal', 'wavetable'], behaviours: ['sustain', 'scatter', 'swell'], pitch: [90, 2200] },
  whoosh: { label: 'Whoosh', domain: 'foley', description: 'Passing air, swishes and fast object movement.', engines: ['noise', 'comb', 'subtractive'], behaviours: ['swell', 'sweep'], pitch: [140, 1800] },
  scrape: { label: 'Scrape', domain: 'foley', description: 'Sustained contact, friction and stick-slip motion.', engines: ['noise', 'comb', 'modal', 'fm'], behaviours: ['sustain', 'phrase'], pitch: [100, 2000] },
  roll: { label: 'Roll', domain: 'foley', description: 'Rolling contact with repeated bumps and friction.', engines: ['modal', 'noise', 'membrane', 'comb'], behaviours: ['phrase', 'scatter'], pitch: [60, 700] },
  shake: { label: 'Shake', domain: 'foley', description: 'Loose particles and objects shaken in clusters.', engines: ['noise', 'modal', 'comb', 'fm'], behaviours: ['scatter', 'phrase'], pitch: [300, 3000] },
  crush: { label: 'Crush', domain: 'foley', description: 'Fracture, compression and breaking debris.', engines: ['noise', 'modal', 'membrane', 'comb'], behaviours: ['scatter', 'strike'], pitch: [65, 1200] },
  footstep: { label: 'Footstep', domain: 'foley', description: 'Weight transfer, heel contact and surface scuff.', engines: ['membrane', 'noise', 'modal'], behaviours: ['strike', 'phrase'], pitch: [50, 450] },
  wind: { label: 'Wind', domain: 'nature', description: 'Air beds, gusts and hollow whistles.', engines: ['noise', 'comb', 'additive'], behaviours: ['sustain', 'swell'], pitch: [80, 900] },
  water: { label: 'Water', domain: 'nature', description: 'Synthetic drops, bubbles, streams and splashes.', engines: ['fm', 'comb', 'noise', 'modal'], behaviours: ['scatter', 'phrase', 'sustain'], pitch: [180, 2200] },
  fire: { label: 'Fire', domain: 'nature', description: 'Combustion beds, crackles and flares.', engines: ['noise', 'subtractive', 'modal'], behaviours: ['scatter', 'sustain', 'swell'], pitch: [55, 1000] },
  rain: { label: 'Rain', domain: 'nature', description: 'Dense small drops and splatter over a noise bed.', engines: ['noise', 'modal', 'comb'], behaviours: ['scatter', 'sustain'], pitch: [500, 3800] },
  ambience: { label: 'Ambience', domain: 'nature', description: 'Layered environmental or invented atmosphere segments.', engines: ['noise', 'comb', 'additive', 'wavetable'], behaviours: ['sustain', 'swell'], pitch: [45, 800] },
  creature: { label: 'Creature', domain: 'creatures', description: 'Designed calls, grunts, roars and vocal phrases.', engines: ['vocal', 'fm', 'comb', 'wavetable'], behaviours: ['phrase', 'swell', 'scatter'], pitch: [55, 1000] },
  chirp: { label: 'Chirp', domain: 'creatures', description: 'Small calls, trills and whistles.', engines: ['fm', 'additive', 'subtractive', 'vocal'], behaviours: ['phrase', 'sweep', 'scatter'], pitch: [600, 3600] },
  breath: { label: 'Breath', domain: 'creatures', description: 'Exhalations, hisses and airy vocal pressure.', engines: ['noise', 'vocal', 'comb'], behaviours: ['swell', 'phrase'], pitch: [150, 900] },
  notification: { label: 'Notification', domain: 'interface', description: 'Compact pings, badges and attention cues.', engines: ['additive', 'fm', 'modal', 'subtractive'], behaviours: ['strike', 'phrase'], pitch: [400, 1800], pitched: true },
  confirmation: { label: 'Confirmation', domain: 'interface', description: 'Resolving, ascending acknowledgements.', engines: ['additive', 'fm', 'wavetable'], behaviours: ['phrase', 'strike'], pitch: [300, 1400], pitched: true },
  error: { label: 'Error', domain: 'interface', description: 'Descending or tense rejection cues.', engines: ['subtractive', 'fm', 'additive'], behaviours: ['phrase', 'strike'], pitch: [130, 850], pitched: true },
  alarm: { label: 'Alarm', domain: 'interface', description: 'Insistent alternating tones and warnings.', engines: ['subtractive', 'fm', 'additive'], behaviours: ['phrase', 'sweep'], pitch: [300, 2200], pitched: true },
  kick: { label: 'Kick', domain: 'percussion', description: 'Low drum body, pitch punch and optional click.', engines: ['membrane', 'fm', 'subtractive'], behaviours: ['strike'], pitch: [38, 95] },
  snare: { label: 'Snare', domain: 'percussion', description: 'A pitched drum body with a noisy rattle.', engines: ['membrane', 'noise', 'fm'], behaviours: ['strike'], pitch: [130, 330] },
  hat: { label: 'Hi-hat', domain: 'percussion', description: 'Bright short or open metallic noise percussion.', engines: ['noise', 'fm', 'modal'], behaviours: ['strike', 'phrase'], pitch: [900, 3000] },
  percussion: { label: 'Percussion', domain: 'percussion', description: 'Toms, blocks, shakers and tuned or untuned strikes.', engines: ['membrane', 'modal', 'comb', 'fm', 'noise'], behaviours: ['strike', 'phrase'], pitch: [80, 1300] },
  bass: { label: 'Bass', domain: 'music', description: 'Stable low notes, plucks and moving bass voices.', engines: ['subtractive', 'fm', 'wavetable', 'comb'], behaviours: ['sustain', 'strike', 'phrase'], pitch: [35, 140], pitched: true },
  lead: { label: 'Lead', domain: 'music', description: 'Melodic voices with a clear pitched foreground.', engines: ['subtractive', 'wavetable', 'fm', 'additive'], behaviours: ['sustain', 'phrase'], pitch: [220, 1100], pitched: true },
  pad: { label: 'Pad', domain: 'music', description: 'Soft sustained harmonic layers and evolving chords.', engines: ['additive', 'wavetable', 'subtractive', 'comb'], behaviours: ['swell', 'sustain'], pitch: [100, 650], pitched: true },
  pluck: { label: 'Pluck', domain: 'music', description: 'Excited strings and short articulated synth notes.', engines: ['comb', 'fm', 'subtractive', 'modal'], behaviours: ['strike', 'phrase'], pitch: [110, 1100], pitched: true },
  bell: { label: 'Bell', domain: 'music', description: 'Harmonic or inharmonic struck, ringing tones.', engines: ['fm', 'modal', 'additive'], behaviours: ['strike'], pitch: [220, 1800], pitched: true },
  keys: { label: 'Keys', domain: 'music', description: 'Pitched struck-key and electric-keyboard designs.', engines: ['fm', 'additive', 'comb', 'subtractive'], behaviours: ['strike', 'phrase'], pitch: [130, 1050], pitched: true },
  explosion: { label: 'Explosion', domain: 'effects', description: 'Pressure fronts followed by expanding noise, rumble and debris.', engines: ['noise', 'membrane', 'fm', 'modal'], behaviours: ['strike', 'scatter'], pitch: [40, 160] },
  engine: { label: 'Engine', domain: 'foley', description: 'Combustion pulses, turbines and harmonic propulsion under changing load.', engines: ['subtractive', 'fm', 'wavetable', 'comb'], behaviours: ['sustain', 'sweep', 'phrase'], pitch: [45, 260] },
  spring: { label: 'Spring', domain: 'foley', description: 'Elastic rebounds, vibrating coils and released string tension.', engines: ['comb', 'fm', 'modal', 'membrane'], behaviours: ['strike', 'phrase'], pitch: [90, 650] },
  creak: { label: 'Creak', domain: 'foley', description: 'Intermittent sticking, bending strain and resonant structural groans.', engines: ['comb', 'wavetable', 'fm', 'modal'], behaviours: ['phrase', 'sustain', 'sweep'], pitch: [65, 700] },
  tear: { label: 'Tear', domain: 'foley', description: 'Progressive rupture, separate fibres and a final release of tension.', engines: ['noise', 'comb', 'modal', 'subtractive'], behaviours: ['phrase', 'scatter'], pitch: [140, 1300] },
  pressure: { label: 'Pressure', domain: 'foley', description: 'Valve releases, steam jets and suction with changing air pressure.', engines: ['noise', 'comb', 'fm', 'subtractive'], behaviours: ['swell', 'sustain', 'sweep'], pitch: [110, 900] },
  bowed: { label: 'Bowed', domain: 'music', description: 'Continuous friction excitation, harmonic strings and rubbed resonances.', engines: ['comb', 'subtractive', 'additive', 'modal'], behaviours: ['sustain', 'swell', 'phrase'], pitch: [110, 880], pitched: true },
  'wind-instrument': { label: 'Wind instrument', domain: 'music', description: 'Breath-driven flutes, reeds and brass-like harmonic articulations.', engines: ['subtractive', 'fm', 'additive', 'comb'], behaviours: ['sustain', 'phrase', 'swell'], pitch: [165, 1100], pitched: true },
  choir: { label: 'Choir', domain: 'music', description: 'Layered vowel resonances, breath and slowly drifting vocal ensembles.', engines: ['vocal', 'additive', 'wavetable', 'subtractive'], behaviours: ['sustain', 'swell', 'phrase'], pitch: [110, 700], pitched: true },
}

export type SearchPool = { families?: SoundFamily[]; materials?: Exclude<LabMaterial, 'any'>[]; characters?: Exclude<LabCharacter, 'any'>[] }
export type DiscoverySelections = HarmonySelections & { diversity?: LabDiversity; pool?: SearchPool; rootNote?: number; scale?: LabScale; subtype?: LabSubtype | 'auto' }
export const isLegacyFamily = (value: string): value is LegacyFamily => (LEGACY_FAMILIES as readonly string[]).includes(value)

/** Copies protect shared generation definitions from an editor mutating its returned options. */
export function labFamilyCatalog() {
  return SOUND_FAMILIES.map((id) => ({ id, ...structuredClone(FAMILY_DEFINITIONS[id]) }))
}
export const labMaterialCatalog = () => SDK_MATERIALS.map((id) => ({ id, label: id === 'any' ? 'Any' : id[0]!.toUpperCase() + id.slice(1) }))
export const labCharacterCatalog = () => SDK_CHARACTERS.map((id) => ({ id, label: id === 'any' ? 'Any' : id[0]!.toUpperCase() + id.slice(1) }))
