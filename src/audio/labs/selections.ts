import type { LabCriteria, LabType } from './model'
import { type DiscoverySelections } from './catalog'
import { discoverySelectionKey, sanitizeDiscoverySelections, validateDiscoverySelections } from './discovery-selections'

export const LAB_REGISTERS = ['auto', 'low', 'mid', 'high', 'full'] as const
export const LAB_TEXTURES = ['auto', 'vocal', 'buzz', 'friction', 'crackle', 'resonant', 'pure', 'airy', 'gritty', 'hollow', 'shimmer', 'rasp'] as const
export const LAB_ENDINGS = ['auto', 'cut', 'fade', 'ring'] as const
export const LAB_MASSES = ['light', 'balanced', 'heavy'] as const
export const LAB_GESTURES = ['auto', 'assemble-lock', 'deploy', 'retract', 'break-apart', 'charge-impact',
  'single-hit', 'rebounds', 'fracture', 'move', 'spin', 'ratchet', 'stop', 'sustain', 'phrase', 'surge',
  'sweep', 'ping', 'sequence', 'stutter', 'scatter', 'pulse', 'swell', 'decay',
  'rub', 'roll', 'shake', 'breathe', 'flutter', 'drip', 'rattle', 'strum', 'pluck', 'arpeggiate', 'crumble'] as const
export type LabGesture = typeof LAB_GESTURES[number]
export type LabRegister = typeof LAB_REGISTERS[number]
export type LabTexture = typeof LAB_TEXTURES[number]
export type LabEnding = typeof LAB_ENDINGS[number]
export type LabMass = typeof LAB_MASSES[number]

/** Optional at the input boundary so pre-selection documents and callers remain valid. */
export type LabSelections = DiscoverySelections & {
  gesture?: LabGesture
  register?: LabRegister
  texture?: LabTexture
  /** null/omitted means automatic; an explicit zero is the gentle/sparse endpoint. */
  intensity?: number | null
  density?: number | null
  ending?: LabEnding
  /** Omitted retains legacy weight behaviour; an explicit mass never transposes the patch. */
  mass?: LabMass
}
export const DEFAULT_SELECTIONS = {
  gesture: 'auto', register: 'auto', texture: 'auto', intensity: null, density: null, ending: 'auto',
} as const

export type LabGestureOption = { id: LabGesture; label: string; minMs: number }
const gestureDetails: Record<LabGesture, [string, number]> = {
  auto: ['Auto', 20], 'assemble-lock': ['Assemble → Lock', 240], deploy: ['Deploy', 160],
  retract: ['Retract', 160], 'break-apart': ['Break apart', 200], 'charge-impact': ['Charge → Impact', 240],
  'single-hit': ['Single hit', 20], rebounds: ['Rebounds', 200], fracture: ['Fracture', 160],
  move: ['Move', 80], spin: ['Spin', 120], ratchet: ['Ratchet', 160], stop: ['Stop', 120],
  sustain: ['Sustain', 80], phrase: ['Phrase', 200], surge: ['Surge', 120], sweep: ['Sweep', 80],
  ping: ['Ping', 20], sequence: ['Sequence', 200], stutter: ['Stutter', 160], scatter: ['Scatter', 160],
  pulse: ['Pulse', 120], swell: ['Swell', 120], decay: ['Decay', 80],
  rub: ['Rub', 120], roll: ['Roll', 180], shake: ['Shake', 160], breathe: ['Breathe', 200],
  flutter: ['Flutter', 120], drip: ['Drip', 100], rattle: ['Rattle', 140], strum: ['Strum', 100],
  pluck: ['Pluck', 20], arpeggiate: ['Arpeggiate', 180], crumble: ['Crumble', 180],
}
const familyGestures: Record<LabType, readonly LabGesture[]> = {
  any: LAB_GESTURES,
  growl: ['auto', 'sustain', 'phrase', 'surge'],
  impact: ['auto', 'single-hit', 'rebounds', 'fracture', 'charge-impact'],
  transformation: ['auto', 'assemble-lock', 'deploy', 'retract', 'break-apart', 'charge-impact'],
  servo: ['auto', 'move', 'spin', 'ratchet', 'stop'],
  scan: ['auto', 'sweep', 'ping', 'sequence'],
  glitch: ['auto', 'stutter', 'scatter', 'break-apart'],
  pulse: ['auto', 'pulse', 'sequence', 'surge'],
  drone: ['auto', 'sustain', 'swell', 'surge'],
  rise: ['auto', 'swell', 'charge-impact', 'deploy'],
  fall: ['auto', 'decay', 'retract', 'break-apart'],
  burst: ['auto', 'single-hit', 'scatter', 'rebounds'],
  texture: ['auto', 'sustain', 'swell', 'scatter'],
  whoosh: ['auto', 'sweep', 'swell', 'move', 'flutter'],
  scrape: ['auto', 'rub', 'move', 'ratchet', 'sustain'],
  roll: ['auto', 'roll', 'rebounds', 'stop'],
  shake: ['auto', 'shake', 'rattle', 'scatter'],
  crush: ['auto', 'fracture', 'crumble', 'single-hit', 'break-apart'],
  footstep: ['auto', 'single-hit', 'sequence', 'rub'],
  wind: ['auto', 'sustain', 'swell', 'flutter', 'surge'],
  water: ['auto', 'drip', 'scatter', 'sustain', 'surge'],
  fire: ['auto', 'sustain', 'scatter', 'surge', 'crumble'],
  rain: ['auto', 'scatter', 'sustain', 'drip', 'swell'],
  ambience: ['auto', 'sustain', 'swell', 'surge', 'scatter'],
  creature: ['auto', 'phrase', 'breathe', 'surge', 'rattle'],
  chirp: ['auto', 'phrase', 'flutter', 'ping', 'sequence'],
  breath: ['auto', 'breathe', 'swell', 'surge'],
  notification: ['auto', 'ping', 'single-hit', 'sequence', 'arpeggiate'],
  confirmation: ['auto', 'ping', 'sequence', 'arpeggiate'],
  error: ['auto', 'single-hit', 'sequence', 'decay'],
  alarm: ['auto', 'pulse', 'sequence', 'sweep'],
  kick: ['auto', 'single-hit', 'rebounds', 'sequence'],
  snare: ['auto', 'single-hit', 'rattle', 'sequence'],
  hat: ['auto', 'single-hit', 'sequence', 'flutter'],
  percussion: ['auto', 'single-hit', 'sequence', 'rattle', 'roll'],
  bass: ['auto', 'sustain', 'pluck', 'phrase', 'arpeggiate'],
  lead: ['auto', 'sustain', 'phrase', 'arpeggiate', 'surge'],
  pad: ['auto', 'sustain', 'swell', 'strum'],
  pluck: ['auto', 'pluck', 'strum', 'arpeggiate'],
  bell: ['auto', 'single-hit', 'sequence', 'strum'],
  keys: ['auto', 'single-hit', 'strum', 'arpeggiate', 'sustain'],
  explosion: ['auto', 'single-hit', 'charge-impact', 'fracture', 'rebounds'],
  engine: ['auto', 'sustain', 'spin', 'deploy', 'stop', 'pulse'],
  spring: ['auto', 'single-hit', 'rebounds', 'pluck', 'decay'],
  creak: ['auto', 'rub', 'move', 'ratchet', 'sustain'],
  tear: ['auto', 'rub', 'fracture', 'crumble', 'break-apart'],
  pressure: ['auto', 'sustain', 'surge', 'decay', 'breathe', 'stop'],
  bowed: ['auto', 'sustain', 'swell', 'phrase', 'strum'],
  'wind-instrument': ['auto', 'sustain', 'breathe', 'phrase', 'flutter'],
  choir: ['auto', 'sustain', 'swell', 'phrase', 'arpeggiate'],
}

/** Fresh metadata for any frontend. A too-short range can disable an option with a reason. */
export function labGestureOptions(type: LabType): LabGestureOption[] {
  return familyGestures[type].map((id) => ({ id, label: gestureDetails[id][0], minMs: gestureDetails[id][1] }))
}

export function minimumGestureMs(criteria: LabSelections): number {
  return gestureDetails[criteria.gesture ?? 'auto'][1]
}

const choice = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback
const amount = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null

/** Tolerant document import. Incompatible stale gestures reset when the family changes. */
export function sanitizeSelections(source: Record<string, unknown>, type: LabType, maxMs: number): LabSelections {
  const gesture = choice(source.gesture, familyGestures[type], 'auto')
  return {
    ...sanitizeDiscoverySelections(source),
    gesture: gestureDetails[gesture][1] <= maxMs ? gesture : 'auto',
    register: choice(source.register, LAB_REGISTERS, 'auto'), texture: choice(source.texture, LAB_TEXTURES, 'auto'),
    intensity: amount(source.intensity), density: amount(source.density), ending: choice(source.ending, LAB_ENDINGS, 'auto'),
    ...(LAB_MASSES.includes(source.mass as LabMass) ? { mass: source.mass as LabMass } : {}),
  }
}

/** Strict generation boundary: unsupported requests must not quietly claim a different intent. */
export function validateSelections(criteria: LabCriteria): void {
  validateDiscoverySelections(criteria)
  for (const [key, options] of [['gesture', LAB_GESTURES], ['register', LAB_REGISTERS], ['texture', LAB_TEXTURES], ['ending', LAB_ENDINGS], ['mass', LAB_MASSES]] as const) {
    if (criteria[key] !== undefined && !(options as readonly unknown[]).includes(criteria[key])) throw new Error(`Unknown ${key} selection.`)
  }
  for (const key of ['intensity', 'density'] as const) {
    const value = criteria[key]
    if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) throw new Error(`${key} must be null (Auto) or a number between 0 and 1.`)
  }
  const gesture = criteria.gesture ?? 'auto'
  if (!familyGestures[criteria.type]?.includes(gesture)) throw new Error(`The ${gesture} gesture is not available for ${criteria.type}.`)
  if (minimumGestureMs(criteria) > criteria.maxMs) throw new Error(`${gestureDetails[gesture][0]} needs at least ${minimumGestureMs(criteria)} ms. Increase the maximum duration or choose another gesture.`)
}

export function selectionKey(criteria: LabSelections): string {
  return JSON.stringify([criteria.gesture ?? 'auto', criteria.register ?? 'auto', criteria.texture ?? 'auto',
    criteria.intensity ?? null, criteria.density ?? null, criteria.ending ?? 'auto', criteria.mass ?? null, ...discoverySelectionKey(criteria)])
}
export const hasSelections = (criteria: LabSelections): boolean => selectionKey(criteria) !== selectionKey({})

/** History diversity must compare the entire intent, not only the original six fields. */
export function labCriteriaKey(criteria: LabCriteria): string {
  return JSON.stringify([criteria.type, criteria.material, criteria.character, criteria.motion, criteria.weight,
    criteria.minMs, criteria.maxMs, [...new Set(criteria.avoid)].sort(), selectionKey(criteria)])
}

export function assertReferenceSelections(criteria: LabCriteria, reference: LabCriteria): void {
  if (selectionKey(criteria) !== selectionKey(reference) || criteria.type !== reference.type || criteria.material !== reference.material || criteria.character !== reference.character || criteria.motion !== reference.motion || criteria.weight !== reference.weight) throw new Error('Keep the reference search selections for variations and fusion. Generate a new sound to change its family, material, character or search intent.')
}
