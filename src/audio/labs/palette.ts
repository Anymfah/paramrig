import { FAMILY_DEFINITIONS, SOUND_FAMILIES, type LabDomain, type SearchPool } from './catalog'
import { hasChord, supportsChord } from './harmony-catalog'
import type { LabCriteria } from './model'
import { labGestureOptions } from './selections'
import { SUBTYPE_DEFINITIONS } from './subtypes'

export const PALETTE_SECTIONS = ['source', 'timbre', 'behaviour', 'pitch'] as const
export type PaletteSection = typeof PALETTE_SECTIONS[number]
export type PaletteView = PaletteSection | 'presets'
export const PALETTE_DOMAINS: { id: LabDomain; label: string }[] = [
  { id: 'effects', label: 'Effects' }, { id: 'foley', label: 'Foley' }, { id: 'nature', label: 'Nature' },
  { id: 'creatures', label: 'Creatures' }, { id: 'interface', label: 'Interface' }, { id: 'percussion', label: 'Percussion' }, { id: 'music', label: 'Music' },
]
export type PaletteDimension = 'type' | 'material' | 'character'
const poolKeys = { type: 'families', material: 'materials', character: 'characters' } as const
export const paletteLabel = (value: string) => value.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
export const noteLabel = (midi: number) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`
export const discoveryCriteria = (criteria: LabCriteria): LabCriteria => ({ ...criteria, diversity: criteria.diversity ?? 'balanced', subtype: criteria.subtype ?? 'auto' })
export function selectedPaletteValues(criteria: LabCriteria, dimension: PaletteDimension): string[] {
  return criteria[dimension] === 'any' ? [...criteria.pool?.[poolKeys[dimension]] ?? []] : [criteria[dimension]]
}
/** One explicit choice, several alternatives, or unrestricted Any. Other pools remain intact. */
export function paletteSelection(criteria: LabCriteria, dimension: PaletteDimension, values: string[]): Partial<LabCriteria> {
  const unique = [...new Set(values)]
  const pool: SearchPool = { ...criteria.pool }
  delete pool[poolKeys[dimension]]
  if (unique.length > 1) Object.assign(pool, { [poolKeys[dimension]]: unique })
  return { [dimension]: unique.length === 1 ? unique[0] : 'any', pool: Object.keys(pool).length ? pool : undefined,
    ...(dimension === 'type' && unique.length !== 1 ? { subtype: 'auto' as const } : {}) }
}
export function paletteFamilies(criteria: LabCriteria) {
  const subtype = criteria.subtype && criteria.subtype !== 'auto' ? SUBTYPE_DEFINITIONS[criteria.subtype] : undefined
  return (criteria.type === 'any' ? criteria.pool?.families ?? SOUND_FAMILIES : [criteria.type]).filter((family) => !subtype || family === subtype.family)
}
export const paletteSupportsChord = (criteria: LabCriteria) => paletteFamilies(criteria).some((family) => supportsChord(family, criteria.subtype))
export function paletteGestures(criteria: LabCriteria) {
  const families = paletteFamilies(criteria).filter((family) => !hasChord(criteria) || supportsChord(family, criteria.subtype))
  const ids = new Set(families.flatMap((family) => labGestureOptions(family).map((option) => option.id)))
  return labGestureOptions('any').filter((option) => ids.has(option.id))
}
/** UI transitions preserve explicit intent and report dependent choices that had to reset. */
export function updatePaletteCriteria(before: LabCriteria, update: Partial<LabCriteria>): { criteria: LabCriteria; adjustments: string[] } {
  const criteria = discoveryCriteria({ ...before, ...update })
  const adjustments: string[] = []
  if (update.rootNote !== undefined) criteria.register = 'auto'
  if (update.register && update.register !== 'auto') delete criteria.rootNote
  if (criteria.subtype && criteria.subtype !== 'auto') {
    const family = SUBTYPE_DEFINITIONS[criteria.subtype].family
    if (criteria.type !== 'any' && family !== criteria.type || criteria.pool?.families && !criteria.pool.families.includes(family)) {
      criteria.subtype = 'auto'; adjustments.push('Detail returned to Auto for this source.')
    }
  }
  if (hasChord(criteria) && !paletteSupportsChord(criteria)) {
    criteria.chord = 'none'; adjustments.push('Chord cleared: this source does not support harmony.')
  }
  if (!hasChord(criteria)) delete criteria.voicing
  if (!paletteGestures(criteria).some((option) => option.id === (criteria.gesture ?? 'auto'))) {
    criteria.gesture = 'auto'; adjustments.push('Gesture returned to Auto for this source.')
  }
  return { criteria, adjustments }
}
export function paletteSummary(criteria: LabCriteria): Record<PaletteSection, string> {
  const names = (dimension: PaletteDimension) => selectedPaletteValues(criteria, dimension).map((value) => dimension === 'type' ? FAMILY_DEFINITIONS[value as keyof typeof FAMILY_DEFINITIONS].label : paletteLabel(value))
  const joined = (values: string[]) => values.length > 2 ? `${values.slice(0, 2).join(' + ')} +${values.length - 2}` : values.join(' + ')
  const subtype = criteria.subtype && criteria.subtype !== 'auto' ? SUBTYPE_DEFINITIONS[criteria.subtype].label : ''
  return {
    source: [joined(names('type')) || 'Any source', subtype].filter(Boolean).join(' / '),
    timbre: [joined(names('material')) || 'Any material', joined(names('character')) || 'Any character', criteria.texture && criteria.texture !== 'auto' ? paletteLabel(criteria.texture) : ''].filter(Boolean).join(' · '),
    behaviour: [criteria.gesture && criteria.gesture !== 'auto' ? labGestureOptions('any').find((g) => g.id === criteria.gesture)?.label : '', paletteLabel(criteria.motion), criteria.ending && criteria.ending !== 'auto' ? paletteLabel(criteria.ending) : ''].filter(Boolean).join(' · '),
    pitch: [criteria.rootNote !== undefined ? noteLabel(criteria.rootNote) : criteria.register && criteria.register !== 'auto' ? `${paletteLabel(criteria.register)} register` : 'Auto pitch', criteria.scale ? paletteLabel(criteria.scale) : '', hasChord(criteria) ? `${paletteLabel(criteria.chord!)} chord` : '', hasChord(criteria) && criteria.voicing && criteria.voicing !== 'auto' ? `${paletteLabel(criteria.voicing)} voicing` : ''].filter(Boolean).join(' · '),
  }
}
