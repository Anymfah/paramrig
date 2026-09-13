import { readThumbnail } from './thumbnail'
import { sanitizeAudioPatch } from '@paramrig/audio'
import { sanitizeAudioRig } from '@paramrig/audio/bindings'
import { SUBTYPE_DEFINITIONS } from './subtypes'
import { makeLabSound, recipeRoles } from './design'
import type { AudioPatch } from '@paramrig/audio'
import { labGestureOptions, sanitizeSelections } from './selections'
import { SDK_CHARACTERS as LAB_CHARACTERS, SDK_FAMILIES as LAB_TYPES, SDK_MATERIALS as LAB_MATERIALS, SDK_MOTIONS as LAB_MOTIONS, SOUND_FAMILIES } from './catalog'
import { hasChord, supportsChord } from './harmony-catalog'
import { CONTRIBUTIONS, DEFAULT_CRITERIA, DURATION_MAX, DURATION_MIN, LAB_AMOUNTS, LAB_AVOID, LAB_MODES, LAB_WEIGHTS, MAX_HISTORY, MAX_REFERENCES, MAX_RESERVE, emptyLabSession, fingerprint, type LabCriteria, type LabRole, type LabSession, type LabSound, type LabSource } from './model'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown, fallback = '') => typeof value === 'string' ? value.slice(0, 120) : fallback
const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
function choice<T extends string>(value: unknown, options: readonly T[], fallback: T): T { return options.includes(value as T) ? value as T : fallback }

export function sanitizeCriteria(value: unknown): LabCriteria {
  const source = object(value)
  const minMs = Math.round(number(source.minMs, DEFAULT_CRITERIA.minMs, DURATION_MIN, DURATION_MAX))
  const maxMs = Math.max(minMs, Math.round(number(source.maxMs, DEFAULT_CRITERIA.maxMs, DURATION_MIN, DURATION_MAX)))
  const type = choice(source.type, LAB_TYPES, 'growl')
  const selections = sanitizeSelections(source, type, maxMs)
  const subtypeFamily = selections.subtype && selections.subtype !== 'auto' ? SUBTYPE_DEFINITIONS[selections.subtype].family : null
  const eligible = (subtypeFamily ? [subtypeFamily] : selections.pool?.families ?? SOUND_FAMILIES).filter((family) => !hasChord(selections) || supportsChord(family, selections.subtype))
  if (type === 'any' && !eligible.some((family) => labGestureOptions(family).some((option) => option.id === selections.gesture && option.minMs <= maxMs))) selections.gesture = 'auto'
  return {
    ...selections,
    type, material: choice(source.material, LAB_MATERIALS, 'metal'),
    character: choice(source.character, LAB_CHARACTERS, 'futuristic'), motion: choice(source.motion, LAB_MOTIONS, 'natural'),
    weight: choice(source.weight, LAB_WEIGHTS, 'balanced'), minMs, maxMs,
    avoid: LAB_AVOID.filter((key) => Array.isArray(source.avoid) && source.avoid.includes(key)),
  }
}

const ROLES: LabRole[] = ['body', 'attack', 'mechanism', 'texture', 'resonance', 'tail', 'unknown']
function readSource(value: unknown): LabSource | null {
  const source = object(value)
  if (!string(source.id) || !source.patch || !Array.isArray(object(source.patch).layers)) return null
  const patch = sanitizeAudioPatch(source.patch)
  return { id: string(source.id), name: string(source.name, 'Sound'), patch,
    rig: sanitizeAudioRig(source.rig) ?? undefined,
    roles: patch.layers.map((_, i) => choice(Array.isArray(source.roles) ? source.roles[i] : null, ROLES, 'unknown')) }
}

export function sanitizeLabSound(value: unknown): LabSound | null {
  const source = object(value)
  const base = readSource(value)
  if (!base) return null
  const origin = object(source.origin)
  const settings = object(origin.settings)
  const sound = makeLabSound(base.patch, sanitizeCriteria(source.criteria), {
    kind: choice(origin.kind, ['generated', 'variation', 'fusion', 'instrument'], 'instrument'),
    recipe: typeof origin.recipe === 'string' ? origin.recipe.slice(0, 512) : 'imported', version: 1, seed: number(origin.seed, 0, 0, 0xffffffff),
    parentIds: Array.isArray(origin.parentIds) ? origin.parentIds.slice(0, 2).map((id) => string(id)) : [],
    ...(CONTRIBUTIONS.includes(origin.contribution as typeof CONTRIBUTIONS[number]) ? { contribution: origin.contribution as typeof CONTRIBUTIONS[number] } : {}),
    ...(origin.settings ? { settings: {
      ...(Array.isArray(settings.values) ? { values: settings.values.slice(0, 4).map((value) => number(value, 0.5, 0, 1)) } : {}),
      ...(Array.isArray(settings.locks) ? { locks: settings.locks.slice(0, 4).map((value) => value === true) } : {}),
      ...(settings.amount ? { amount: choice(settings.amount, LAB_AMOUNTS, 'subtle') } : {}),
      ...(typeof settings.varyDuration === 'boolean' ? { varyDuration: settings.varyDuration } : {}),
      ...(typeof settings.influence === 'number' ? { influence: number(settings.influence, 0.4, 0.05, 0.85) } : {}),
    } } : {}),
  }, base.name, base.rig)
  sound.id = base.id
  const preview = object(source.preview)
  if (preview.fingerprint === sound.fingerprint && Array.isArray(preview.bins) && preview.bins.length === 112) sound.preview = { fingerprint: sound.fingerprint, bins: preview.bins.map((value) => number(value, 0, 0, 1)), detail: readThumbnail(preview.detail) }
  // Check the stored snapshot before normalization adds defaults or reorders properties.
  const intact = source.fingerprint === fingerprint(source.patch as AudioPatch) || source.fingerprint === sound.fingerprint
  const invalidated = source.rolesInvalidated === true || !intact
  const knownRecipe = typeof origin.recipe === 'string' && (SOUND_FAMILIES.includes(origin.recipe as typeof SOUND_FAMILIES[number]) || /^explore-v[234]\//.test(origin.recipe))
  const legacyRoles = base.roles.every((role) => role === 'unknown') && knownRecipe && sound.origin.kind !== 'instrument'
  sound.roles = !invalidated && origin.version === 1 ? legacyRoles ? recipeRoles(base.patch) : base.roles : base.roles.map(() => 'unknown')
  if (invalidated) sound.rolesInvalidated = true
  sound.parents = (Array.isArray(source.parents) ? source.parents.slice(0, 2) : []).flatMap((parent) => { const result = readSource(parent); return result ? [result] : [] })
  return sound
}

export function sanitizeLabSession(value: unknown): LabSession {
  const source = object(value)
  const empty = emptyLabSession()
  if (source.version !== 1) return empty
  const sounds = (value: unknown, limit: number) => (Array.isArray(value) ? value.slice(-limit) : []).flatMap((row) => { const sound = sanitizeLabSound(row); return sound ? [sound] : [] })
  const reference = sanitizeLabSound(source.reference)
  // `results` is what the four-candidate bench called its list; it reads straight into the history.
  const history = sounds(Array.isArray(source.history) && source.history.length ? source.history : source.results, MAX_HISTORY)
  const reserve = sounds(source.reserve, MAX_RESERVE)
  const wanted = string(source.current)
  const known = new Set([...history, ...reserve, ...(reference ? [reference] : [])].map((sound) => sound.id))
  return {
    ...empty, criteria: sanitizeCriteria(source.criteria), reference, history, reserve,
    current: wanted && known.has(wanted) ? wanted : history.at(-1)?.id ?? null,
    references: sounds(source.references, MAX_REFERENCES),
    locks: Array.from({ length: 4 }, (_, i) => Array.isArray(source.locks) && source.locks[i] === true),
    amount: choice(source.amount, LAB_AMOUNTS, 'subtle'), varyDuration: source.varyDuration === true,
    contribution: choice(source.contribution, CONTRIBUTIONS, 'texture'), influence: number(source.influence, 0.4, 0.05, 0.85),
    mode: choice(source.mode, LAB_MODES, 'create'),
    principal: string(source.principal) || null, contributor: string(source.contributor) || null,
  }
}
