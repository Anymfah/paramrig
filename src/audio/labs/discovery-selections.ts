import { LAB_DIVERSITIES, LAB_SCALES, SDK_CHARACTERS, SDK_MATERIALS, SOUND_FAMILIES, type DiscoverySelections, type SearchPool } from './catalog'
import type { LabCriteria } from './model'
import { labGestureOptions } from './selections'
import { SUBTYPE_DEFINITIONS, subtypeBelongsTo } from './subtypes'
import { hasChord, LAB_CHORDS, LAB_VOICINGS, supportsChord } from './harmony-catalog'

const poolChoices = { families: SOUND_FAMILIES, materials: SDK_MATERIALS.filter((id) => id !== 'any'), characters: SDK_CHARACTERS.filter((id) => id !== 'any') }
const selector = { families: 'type', materials: 'material', characters: 'character' } as const

export function validateDiscoverySelections(criteria: LabCriteria): void {
  if (criteria.subtype !== undefined && criteria.subtype !== 'auto' && !subtypeBelongsTo(criteria.subtype, criteria.type)) throw new Error('Unknown subtype or incompatible sound family.')
  if (criteria.diversity !== undefined && !LAB_DIVERSITIES.includes(criteria.diversity)) throw new Error('Unknown diversity selection.')
  if (criteria.scale !== undefined && !LAB_SCALES.includes(criteria.scale)) throw new Error('Unknown musical scale.')
  if (criteria.chord !== undefined && !LAB_CHORDS.includes(criteria.chord)) throw new Error('Unknown chord selection.')
  if (criteria.voicing !== undefined && !LAB_VOICINGS.includes(criteria.voicing)) throw new Error('Unknown chord voicing.')
  if (criteria.voicing !== undefined && !hasChord(criteria)) throw new Error('Choose a chord before selecting its voicing.')
  if (hasChord(criteria) && criteria.type !== 'any' && !supportsChord(criteria.type, criteria.subtype)) throw new Error('Chords need a musical family or tuned percussion subtype.')
  if (criteria.rootNote !== undefined) {
    if (!Number.isInteger(criteria.rootNote) || criteria.rootNote < 24 || criteria.rootNote > 96) throw new Error('Root note must be a MIDI note from 24 to 96.')
    if (criteria.register && criteria.register !== 'auto') throw new Error('Use either an exact root note or a register range, not both.')
  }
  if (criteria.pool !== undefined) {
    if (!criteria.pool || typeof criteria.pool !== 'object' || Array.isArray(criteria.pool)) throw new Error('Search pool must be an object.')
    for (const key of Object.keys(criteria.pool)) if (!(key in poolChoices)) throw new Error(`Unknown search pool: ${key}.`)
    for (const key of ['families', 'materials', 'characters'] as const) {
      const values = criteria.pool[key]
      if (values === undefined) continue
      if (!Array.isArray(values) || !values.length || values.length > poolChoices[key].length || !values.every((v) => (poolChoices[key] as readonly string[]).includes(v))) throw new Error(`Invalid ${key} search pool.`)
      if (criteria[selector[key]] !== 'any') throw new Error(`Set ${selector[key]} to Any when using a ${key} pool.`)
    }
  }
  if (criteria.type === 'any') {
    const family = criteria.subtype && criteria.subtype !== 'auto' ? SUBTYPE_DEFINITIONS[criteria.subtype].family : null
    const eligible = (criteria.pool?.families ?? SOUND_FAMILIES).filter((id) => (!family || id === family) && (!hasChord(criteria) || supportsChord(id, criteria.subtype)))
    if (!eligible.some((family) => labGestureOptions(family).some((option) => option.id === (criteria.gesture ?? 'auto') && option.minMs <= criteria.maxMs))) throw new Error('No family in this pool supports the requested subtype, harmony, gesture and duration.')
  }
}

/** Import is tolerant; public generation rejects contradictory or unsupported requests. */
export function sanitizeDiscoverySelections(source: Record<string, unknown>): DiscoverySelections {
  const result: DiscoverySelections = {}
  if (LAB_DIVERSITIES.includes(source.diversity as never)) result.diversity = source.diversity as DiscoverySelections['diversity']
  if (LAB_SCALES.includes(source.scale as never)) result.scale = source.scale as DiscoverySelections['scale']
  if (typeof source.rootNote === 'number' && Number.isFinite(source.rootNote) && (!source.register || source.register === 'auto')) result.rootNote = Math.round(Math.max(24, Math.min(96, source.rootNote)))
  if (source.pool && typeof source.pool === 'object' && !Array.isArray(source.pool)) {
    const input = source.pool as Record<string, unknown>, pool: SearchPool = {}
    for (const key of ['families', 'materials', 'characters'] as const) {
      const raw = input[key]
      if (source[selector[key]] !== 'any' || !Array.isArray(raw)) continue
      const values = [...new Set(raw.filter((v): v is string => typeof v === 'string' && (poolChoices[key] as readonly string[]).includes(v)))]
      if (values.length) Object.assign(pool, { [key]: values })
    }
    if (Object.keys(pool).length) result.pool = pool
  }
  if (source.subtype === 'auto') result.subtype = 'auto'
  else if (subtypeBelongsTo(source.subtype, source.type as LabCriteria['type'])
    && (!result.pool?.families || result.pool.families.includes(SUBTYPE_DEFINITIONS[source.subtype].family))) result.subtype = source.subtype
  if (LAB_CHORDS.includes(source.chord as never)) {
    const family = result.subtype && result.subtype !== 'auto' ? SUBTYPE_DEFINITIONS[result.subtype].family : null
    const candidates = source.type === 'any' ? result.pool?.families ?? SOUND_FAMILIES : [source.type as LabCriteria['type']]
    if (source.chord === 'none' || candidates.some((id) => (!family || family === id) && supportsChord(id, result.subtype))) result.chord = source.chord as DiscoverySelections['chord']
  }
  if (hasChord(result) && LAB_VOICINGS.includes(source.voicing as never)) result.voicing = source.voicing as DiscoverySelections['voicing']
  return result
}

export function discoverySelectionKey(criteria: DiscoverySelections): unknown[] {
  return [criteria.diversity ?? null, criteria.rootNote ?? null, criteria.scale ?? null, criteria.subtype ?? null, criteria.chord ?? 'none', hasChord(criteria) ? criteria.voicing ?? 'auto' : null,
    ...(['families', 'materials', 'characters'] as const).map((key) => criteria.pool?.[key] ? [...new Set(criteria.pool[key])].sort() : null)]
}
