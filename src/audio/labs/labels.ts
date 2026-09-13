import type { AudioSnapshot } from '@/audio/document'
import { makeLabSound } from './design'
import { describeLabRecipe } from './discovery'
import { FAMILY_DEFINITIONS } from './catalog'
import { SUBTYPE_DEFINITIONS } from './subtypes'
import { DEFAULT_CRITERIA, titleCase, type LabSound } from './model'

export const TILE_LABELS: Record<string, string> = { transformation: 'Transform', any: 'Any' }
export const AVOID_LABELS = { piercing: 'Piercing highs', sub: 'Sub bass', reverb: 'Reverb', click: 'Sharp attack' } as const
export const tileLabel = (value: string) => TILE_LABELS[value] ?? titleCase(value)

/** A saved sound as Labs sees it: with its research history when it has one, as an import otherwise. */
export function soundOfSnapshot(snapshot: AudioSnapshot): LabSound {
  if (snapshot.lab) return { ...structuredClone(snapshot.lab), id: `lab-saved-${snapshot.id}`, name: snapshot.name }
  const ms = Math.round(snapshot.patch.duration * 1000)
  const sound = makeLabSound(snapshot.patch, { ...DEFAULT_CRITERIA, minMs: ms, maxMs: ms }, { kind: 'instrument', recipe: 'imported', version: 1, seed: 0, parentIds: [] }, snapshot.name, snapshot.rig)
  sound.id = `lab-saved-${snapshot.id}`
  return sound
}

/** Name the result of an Any/pool draw, while keeping the original request available for replay. */
export function soundClassification(sound: LabSound): string {
  if (sound.origin.kind === 'instrument') return 'Instrument patch'
  const recipe = describeLabRecipe(sound.origin.recipe)
  const family = recipe?.family ?? sound.criteria.type
  const source = family === 'any' ? 'Mixed source' : FAMILY_DEFINITIONS[family].label
  const detail = recipe?.subtype ? SUBTYPE_DEFINITIONS[recipe.subtype].label : ''
  const material = recipe?.material ?? sound.criteria.material
  return [`${source}${detail ? ` / ${detail}` : ''}`, material === 'any' ? '' : tileLabel(material)].filter(Boolean).join(' · ')
}
