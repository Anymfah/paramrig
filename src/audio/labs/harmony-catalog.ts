import type { SdkFamily } from './catalog'

export const CHORD_DEFINITIONS = {
  major: { label: 'Major', intervals: [0, 4, 7] },
  minor: { label: 'Minor', intervals: [0, 3, 7] },
  sus2: { label: 'Suspended second', intervals: [0, 2, 7] },
  sus4: { label: 'Suspended fourth', intervals: [0, 5, 7] },
  dissonant: { label: 'Dissonant', intervals: [0, 1, 6] },
} as const
export const LAB_CHORDS = ['none', 'auto', 'major', 'minor', 'sus2', 'sus4', 'dissonant'] as const
export const LAB_VOICINGS = ['auto', 'close', 'open'] as const
export type LabChord = keyof typeof CHORD_DEFINITIONS
export type LabVoicing = Exclude<typeof LAB_VOICINGS[number], 'auto'>
export type HarmonySelections = { chord?: typeof LAB_CHORDS[number]; voicing?: typeof LAB_VOICINGS[number] }
export const hasChord = (criteria: HarmonySelections) => criteria.chord !== undefined && criteria.chord !== 'none'
export const PITCHED_PERCUSSION = ['marimba', 'vibraphone', 'handpan'] as const
export function supportsChord(family: SdkFamily, subtype?: string): boolean {
  return ['bass', 'lead', 'pad', 'pluck', 'bell', 'keys', 'bowed', 'wind-instrument', 'choir'].includes(family)
    || family === 'percussion' && (!subtype || subtype === 'auto' || (PITCHED_PERCUSSION as readonly string[]).includes(subtype))
}
/** Root stays in place; opening moves the middle note up an octave above the fifth. */
export function chordIntervals(chord: LabChord, voicing: LabVoicing): number[] {
  const [root, third, fifth] = CHORD_DEFINITIONS[chord].intervals
  return voicing === 'open' ? [root, fifth, third + 12] : [root, third, fifth]
}
export const labChordCatalog = () => Object.entries(CHORD_DEFINITIONS).map(([id, value]) => ({ id: id as LabChord, label: value.label, intervals: [...value.intervals] }))
