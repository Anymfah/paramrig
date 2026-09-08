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

const store = inspectorPrefsStore<AudioTab>({
  key: 'paramrig.audio-inspector.v1',
  tabs: AUDIO_TABS,
  defaultTab: 'sound',
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
