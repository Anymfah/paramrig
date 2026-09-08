import type { InspectorCategory, ParameterDef, ParamGroup, ParamValue } from '@/rigs/types'
import { LAYER_COUNT, LFO_COUNT, LAYER_SECTIONS, type LayerSection } from '@/audio/fields'
import { AUDIO_FIELDS, applyAudioBinding, currentAudioValue, parameterForAudioProperty, parseAudioProperty } from '@/audio/rig'
import { defaultPatch } from '@/audio/patch'
import type { AudioPatch } from '@/audio/types'

/**
 * The whole synthesiser as ordinary controls.
 *
 * Every field of a patch is already a parameter with a range and a unit, so rather than writing a
 * bespoke panel of sliders the editor declares the board as `ParameterDef`s and hands them to the
 * same controllers the inspector uses everywhere else. A field's id is its property path, which
 * makes writing a value back a matter of parsing the id — no lookup table to keep in step.
 *
 * This is the board, not the rig. The board is every field there is; the rig is the handful a
 * patch chooses to expose, and lives in `rig.ts`.
 */

const SECTION_LABELS: Record<LayerSection, string> = {
  root: 'Layer',
  source: 'Source',
  pitch: 'Pitch',
  filter: 'Filter',
  shaper: 'Shaper',
  amp: 'Envelope',
}

export const BOARD_CATEGORIES: InspectorCategory[] = [
  ...Array.from({ length: LAYER_COUNT }, (_, index) => ({ id: `l${index}`, label: `Layer ${index + 1}` })),
  { id: 'mix', label: 'Mix' },
]

/** The modulators get their own view, so they are their own set of columns. */
export const MODULATION_CATEGORIES: InspectorCategory[] = Array.from(
  { length: LFO_COUNT },
  (_, index) => ({ id: `lfo${index}`, label: `LFO ${index + 1}` }),
)

const SECTION_ORDER: LayerSection[] = ['root', 'source', 'pitch', 'filter', 'shaper', 'amp']

export function boardGroups(): ParamGroup[] {
  const layers = Array.from({ length: LAYER_COUNT }, (_, index) =>
    SECTION_ORDER.map((section) => ({
      id: `l${index}.${section}`,
      label: SECTION_LABELS[section],
      tab: `l${index}`,
      ...(section === 'root' || section === 'source' ? {} : { defaultOpen: false }),
    })),
  ).flat()
  return [
    ...layers,
    ...Array.from({ length: LFO_COUNT }, (_, index) => ({ id: `lfo${index}.all`, label: `LFO ${index + 1}`, tab: `lfo${index}` })),
    { id: 'mix.patch', label: 'Patch', tab: 'mix' },
    { id: 'mix.fx', label: 'Effects', tab: 'mix' },
    { id: 'mix.master', label: 'Master', tab: 'mix' },
  ]
}

/** Every property path the board shows, in the order it shows them. */
export function boardPaths(): { property: string; group: string }[] {
  const layers = Array.from({ length: LAYER_COUNT }, (_, index) =>
    SECTION_ORDER.flatMap((section) =>
      Object.keys(LAYER_SECTIONS[section]).map((field) => ({
        property: section === 'root' ? `layers[${index}].${field}` : `layers[${index}].${section}.${field}`,
        group: `l${index}.${section}`,
      })),
    ),
  ).flat()
  const lfos = Array.from({ length: LFO_COUNT }, (_, index) =>
    Object.keys(AUDIO_FIELDS.lfo).map((field) => ({ property: `lfos[${index}].${field}`, group: `lfo${index}.all` })),
  ).flat()
  return [
    ...layers,
    ...lfos,
    ...Object.keys(AUDIO_FIELDS.patch).map((field) => ({ property: field, group: 'mix.patch' })),
    ...Object.keys(AUDIO_FIELDS.fx).map((field) => ({ property: `fx.${field}`, group: 'mix.fx' })),
    ...Object.keys(AUDIO_FIELDS.master).map((field) => ({ property: `master.${field}`, group: 'mix.master' })),
  ]
}

/**
 * The controls, with their defaults taken from a blank patch rather than from this one — so the
 * reset on a field means "back to how a new patch sounds", which is a place worth returning to,
 * and not "back to where it already is", which is nowhere.
 */
export function boardParameters(): ParameterDef[] {
  const blank = defaultPatch()
  return boardPaths().flatMap(({ property, group }) => {
    const label = parseAudioProperty(property)?.spec.label ?? property
    const parameter = parameterForAudioProperty({ id: property, label, group, property, patch: blank })
    if (!parameter) return []
    return [parameter]
  })
}

export function boardValues(patch: AudioPatch): Record<string, ParamValue> {
  return Object.fromEntries(boardPaths().map(({ property }) => [property, currentAudioValue(patch, property)]))
}

/** One field written, clamped to its range by the same code a binding goes through. */
export function setBoardValue(patch: AudioPatch, property: string, value: ParamValue): AudioPatch {
  return applyAudioBinding(
    patch,
    { id: property, property, parameterId: property },
    value,
    () => {
      throw new Error('The board writes values directly; it has no expressions to resolve.')
    },
  )
}
