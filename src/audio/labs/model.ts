import type { LabThumbnail } from './thumbnail'
import type { AudioPatch } from '@paramrig/audio'
import type { AudioRig } from '@paramrig/audio/bindings'
import type { MacroSlot } from '../macros'
import { AUDIO_FIELDS } from '@paramrig/audio/fields'
import { DEFAULT_SELECTIONS, type LabSelections } from './selections'
import { LEGACY_FAMILIES, LEGACY_MATERIALS, LEGACY_CHARACTERS, type SdkFamily, type LabMaterial, type LabCharacter, type SDK_MOTIONS } from './catalog'

export const LAB_VERSION = 1
// These three lists intentionally describe the current UI. The SDK exports the full catalog.
export const LAB_TYPES = LEGACY_FAMILIES
export const LAB_MATERIALS = LEGACY_MATERIALS
export const LAB_CHARACTERS = LEGACY_CHARACTERS
export const LAB_MOTIONS = ['natural', 'continuous', 'pulsed', 'stuttering', 'accelerating', 'collapsing'] as const
export const LAB_WEIGHTS = ['light', 'balanced', 'heavy'] as const
export const LAB_AVOID = ['piercing', 'sub', 'reverb', 'click'] as const
export const CONTRIBUTIONS = ['texture', 'attack', 'motion', 'resonance'] as const
export const LAB_MODES = ['create', 'vary', 'fuse'] as const
export const LAB_AMOUNTS = ['subtle', 'medium', 'strong'] as const
/** What the bench draws of the current sound: the relief, the waveform strip, or both. */
export const RELIEF_VIEWS = ['spectrum', 'waveform', 'both'] as const
export type ReliefView = typeof RELIEF_VIEWS[number]
export type LabType = SdkFamily
export type LabMotion = typeof SDK_MOTIONS[number]
export type Contribution = typeof CONTRIBUTIONS[number]
export type LabMode = typeof LAB_MODES[number]
export type LabAmount = typeof LAB_AMOUNTS[number]
export type LabRole = 'body' | 'attack' | 'mechanism' | 'texture' | 'resonance' | 'tail' | 'unknown'
export type LabCriteria = LabSelections & {
  type: LabType
  material: LabMaterial
  character: LabCharacter
  motion: LabMotion
  weight: typeof LAB_WEIGHTS[number]
  minMs: number
  maxMs: number
  avoid: (typeof LAB_AVOID[number])[]
}
export const DURATION_MIN = Math.round(AUDIO_FIELDS.patch.duration!.min! * 1000)
export const DURATION_MAX = Math.round(AUDIO_FIELDS.patch.duration!.max! * 1000)
export const DEFAULT_CRITERIA: LabCriteria = {
  ...DEFAULT_SELECTIONS,
  type: 'growl', material: 'metal', character: 'futuristic', motion: 'natural', weight: 'balanced',
  minMs: 300, maxMs: 1600, avoid: [],
}
export type LabOrigin = {
  kind: 'generated' | 'variation' | 'fusion' | 'instrument'
  recipe: string
  version: number
  seed: number
  parentIds: string[]
  contribution?: Contribution
  settings?: { values?: number[]; locks?: boolean[]; amount?: LabAmount; varyDuration?: boolean; influence?: number }
}
/** Parent snapshots have no nested parents: ancestry never becomes an exponential JSON tree. */
export type LabSource = {
  id: string
  name: string
  patch: AudioPatch
  rig?: AudioRig
  roles: LabRole[]
}
export type LabSound = LabSource & {
  criteria: LabCriteria
  origin: LabOrigin
  macros: MacroSlot[]
  controls: number[]
  parents: LabSource[]
  /** Patch fingerprint invalidates role claims after edits outside Labs. */
  fingerprint: string
  /** An actual snapshot edit must not be mistaken for legacy missing metadata on reload. */
  rolesInvalidated?: true
  preview?: { fingerprint: string; bins: number[]; detail?: LabThumbnail }
}
/**
 * The research state a project carries.
 *
 * The history is automatic: every sound that was generated or brought to the bench, the last
 * twenty, oldest first. The reserve is deliberate: what somebody chose to keep. The current sound
 * is whichever of them is on the bench, and may also be the reference itself.
 */
export type LabSession = {
  version: 1
  criteria: LabCriteria
  mode: LabMode
  history: LabSound[]
  current: string | null
  reserve: LabSound[]
  reference: LabSound | null
  references: LabSound[]
  locks: boolean[]
  amount: LabAmount
  varyDuration: boolean
  contribution: Contribution
  influence: number
  principal: string | null
  contributor: string | null
}
export const MAX_RESERVE = 24
export const MAX_HISTORY = 20
export const MAX_REFERENCES = 8
export function emptyLabSession(): LabSession {
  return {
    version: 1, criteria: structuredClone(DEFAULT_CRITERIA), mode: 'create', history: [], current: null, reserve: [],
    reference: null, references: [], locks: [false, false, false, false], amount: 'subtle', varyDuration: false,
    contribution: 'texture', influence: 0.4, principal: null, contributor: null,
  }
}
export type LabRequest = {
  mode: LabMode
  criteria: LabCriteria
  seed: number
  reference?: LabSound
  /** Recent generated recipes for this intent. Metadata only; no audio buffers or patches. */
  recentRecipes?: string[]
  contributor?: LabSound
  values?: number[]
  locks?: boolean[]
  amount?: LabAmount
  varyDuration?: boolean
  contribution?: Contribution
  influence?: number
  /** How many sounds the batch stops at. One is what the bench asks for; the tests ask for four. */
  count?: number
}
export function fingerprint(patch: AudioPatch): string {
  const value = JSON.stringify(patch)
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(36)
}
export const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
export function labSources(session: LabSession | undefined): LabSource[] {
  if (!session) return []
  const sounds = [...session.reserve, ...session.history, ...session.references, ...(session.reference ? [session.reference] : [])]
  return [...sounds, ...sounds.flatMap((sound) => sound.parents)]
}
/** The sound on the bench: a history entry first, then a kept one, then the reference itself. */
export function currentSound(session: LabSession): LabSound | null {
  if (!session.current) return null
  return session.history.find((sound) => sound.id === session.current)
    ?? session.reserve.find((sound) => sound.id === session.current)
    ?? (session.reference?.id === session.current ? session.reference : null)
}
