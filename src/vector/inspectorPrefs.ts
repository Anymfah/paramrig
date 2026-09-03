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
import { DEFAULT_BAR_OFFSET, parseBarOffset, type BarOffset } from '@/vector/selectionBar'

export type InspectorTab = 'design' | 'controls' | 'history'

export const INSPECTOR_TABS: InspectorTab[] = ['design', 'controls', 'history']

/** Edit draws the document; Tune shows it as a rig, with the controls and nothing to drag. */
export type VectorMode = EditorMode

/** On top of the shared three, the vector inspector remembers where the selection bar was left. */
type VectorExtra = { bar: BarOffset }

export type InspectorPrefs = {
  tabs: Record<string, InspectorTab>
  collapsed: string[]
  modes: Record<string, VectorMode>
  /** Where the selection bar was last dragged to, as a nudge from the bottom middle. */
  bar: BarOffset
}

const store = inspectorPrefsStore<InspectorTab, VectorExtra>({
  key: 'paramrig.vector-inspector.v1',
  tabs: INSPECTOR_TABS,
  defaultTab: 'design',
  extra: {
    empty: { bar: DEFAULT_BAR_OFFSET },
    parse: (value) => ({ bar: parseBarOffset(value.bar) ?? DEFAULT_BAR_OFFSET }),
  },
})

export const EMPTY_PREFS: InspectorPrefs = store.empty

export function parseInspectorPrefs(raw: unknown): InspectorPrefs {
  return store.parse(raw)
}

export function withBarOffset(prefs: InspectorPrefs, bar: BarOffset): InspectorPrefs {
  return { ...prefs, bar }
}

export function withMode(prefs: InspectorPrefs, documentId: string, mode: VectorMode): InspectorPrefs {
  return withModePrefs(prefs, documentId, mode)
}

/** A document opens the way it was left; a document with no controls has nothing to tune. */
export function modeOf(prefs: InspectorPrefs, documentId: string): VectorMode {
  return modeOfPrefs(prefs, documentId)
}

export function withTab(prefs: InspectorPrefs, documentId: string, tab: InspectorTab): InspectorPrefs {
  return withTabPrefs(prefs, documentId, tab)
}

export function withSection(prefs: InspectorPrefs, sectionId: string, open: boolean): InspectorPrefs {
  return withSectionPrefs(prefs, sectionId, open)
}

export function tabOf(prefs: InspectorPrefs, documentId: string): InspectorTab {
  return tabOfPrefs(prefs, documentId, 'design')
}

export function isOpen(prefs: InspectorPrefs, sectionId: string, defaultOpen = true): boolean {
  return isSectionOpen(prefs, sectionId, defaultOpen)
}

export function readInspectorPrefs(): InspectorPrefs {
  return store.read()
}

export function writeInspectorPrefs(prefs: InspectorPrefs): void {
  store.write(prefs)
}
