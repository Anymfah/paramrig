import {
  inspectorPrefsStore,
  isOpen as isSectionOpen,
  modeOf as modeOfPrefs,
  tabOf as tabOfPrefs,
  withMode as withModePrefs,
  withSection as withSectionPrefs,
  withTab as withTabPrefs,
  type EditorMode,
} from '@/editor/inspectorPrefs'

/** Edit is the whole board; Tune is the controls the patch chooses to expose. */
export type AudioMode = EditorMode

export type AudioTab = 'sound' | 'controls'

export const AUDIO_TABS: AudioTab[] = ['sound', 'controls']

/** Kept so older inspector prefs still parse; hearing now always plays a change. */
type AudioExtra = { autoPlay: boolean }

const store = inspectorPrefsStore<AudioTab, AudioExtra>({
  key: 'paramrig.audio-inspector.v1',
  tabs: AUDIO_TABS,
  defaultTab: 'sound',
  extra: {
    empty: { autoPlay: true },
    parse: (value) => ({ autoPlay: value.autoPlay !== false }),
  },
})

export type AudioPrefs = ReturnType<typeof store.read>

export const EMPTY_AUDIO_PREFS = store.empty

export const readAudioPrefs = () => store.read()
export const writeAudioPrefs = (prefs: AudioPrefs) => store.write(prefs)
export const parseAudioPrefs = (raw: unknown) => store.parse(raw)

export function withMode(prefs: AudioPrefs, documentId: string, mode: AudioMode): AudioPrefs {
  return withModePrefs(prefs, documentId, mode)
}

export function modeOf(prefs: AudioPrefs, documentId: string): AudioMode {
  return modeOfPrefs(prefs, documentId)
}

export function withTab(prefs: AudioPrefs, documentId: string, tab: AudioTab): AudioPrefs {
  return withTabPrefs(prefs, documentId, tab)
}

export function tabOf(prefs: AudioPrefs, documentId: string): AudioTab {
  return tabOfPrefs(prefs, documentId, 'sound')
}

export function withSection(prefs: AudioPrefs, sectionId: string, open: boolean): AudioPrefs {
  return withSectionPrefs(prefs, sectionId, open)
}

export function isOpen(prefs: AudioPrefs, sectionId: string, defaultOpen = true): boolean {
  return isSectionOpen(prefs, sectionId, defaultOpen)
}

export function withAutoPlay(prefs: AudioPrefs, autoPlay: boolean): AudioPrefs {
  return { ...prefs, autoPlay }
}

export const RANDOM_FAMILIES = ['any', 'mechanical', 'metallic', 'digital', 'organic', 'atmospheric', 'impact'] as const
export type RandomFamilyPref = typeof RANDOM_FAMILIES[number]

export const MUTATE_AMOUNT_PREFS = ['subtle', 'medium', 'strong'] as const
export type MutateAmountPref = typeof MUTATE_AMOUNT_PREFS[number]

export const MUTATE_TARGET_PREFS = ['balanced', 'timbre', 'motion', 'space'] as const
export type MutateTargetPref = typeof MUTATE_TARGET_PREFS[number]

export type ShufflePrefs = {
  family: RandomFamilyPref
  amount: MutateAmountPref
  target: MutateTargetPref
  keepReference: boolean
}

const SHUFFLE_KEY = 'paramrig.audio-shuffle.v1'

export const EMPTY_SHUFFLE_PREFS: ShufflePrefs = {
  family: 'any',
  amount: 'subtle',
  target: 'balanced',
  keepReference: false,
}

export function parseShufflePrefs(raw: unknown): ShufflePrefs {
  if (!raw || typeof raw !== 'object') return EMPTY_SHUFFLE_PREFS
  const value = raw as Record<string, unknown>
  return {
    family: RANDOM_FAMILIES.includes(value.family as RandomFamilyPref) ? value.family as RandomFamilyPref : 'any',
    amount: MUTATE_AMOUNT_PREFS.includes(value.amount as MutateAmountPref) ? value.amount as MutateAmountPref : 'subtle',
    target: MUTATE_TARGET_PREFS.includes(value.target as MutateTargetPref) ? value.target as MutateTargetPref : 'balanced',
    keepReference: value.keepReference === true,
  }
}

export function readShufflePrefs(): ShufflePrefs {
  if (typeof localStorage === 'undefined') return EMPTY_SHUFFLE_PREFS
  try {
    return parseShufflePrefs(JSON.parse(localStorage.getItem(SHUFFLE_KEY) ?? 'null'))
  } catch {
    return EMPTY_SHUFFLE_PREFS
  }
}

export function writeShufflePrefs(prefs: ShufflePrefs): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SHUFFLE_KEY, JSON.stringify(prefs))
  } catch {
    /* Generation prefs stay in memory when storage is blocked. */
  }
}
