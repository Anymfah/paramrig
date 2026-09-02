export type InspectorTab = 'design' | 'controls' | 'history'

export const INSPECTOR_TABS: InspectorTab[] = ['design', 'controls', 'history']

/**
 * What the inspector remembers between visits: which tab each document was left on, and which
 * sections are folded away. The tab belongs to the document — a rig with controls is opened
 * differently from a drawing — while a folded section is a habit, and follows the person.
 */
export type InspectorPrefs = {
  tabs: Record<string, InspectorTab>
  collapsed: string[]
  /** Which way a document that carries controls was left open: drawing it, or turning its knobs. */
  modes: Record<string, VectorMode>
}

/** Edit draws the document; Tune shows it as a rig, with the controls and nothing to drag. */
export type VectorMode = 'edit' | 'tune'

const KEY = 'paramrig.vector-inspector.v1'

export const EMPTY_PREFS: InspectorPrefs = { tabs: {}, collapsed: [], modes: {} }

export function parseInspectorPrefs(raw: unknown): InspectorPrefs {
  if (!raw || typeof raw !== 'object') return EMPTY_PREFS
  const value = raw as Partial<InspectorPrefs>
  const tabs = value.tabs && typeof value.tabs === 'object' && !Array.isArray(value.tabs)
    ? Object.fromEntries(Object.entries(value.tabs).flatMap(([id, tab]) => INSPECTOR_TABS.includes(tab as InspectorTab) ? [[id, tab as InspectorTab]] : []))
    : {}
  const collapsed = Array.isArray(value.collapsed) ? value.collapsed.filter((id): id is string => typeof id === 'string') : []
  const modes = value.modes && typeof value.modes === 'object' && !Array.isArray(value.modes)
    ? Object.fromEntries(Object.entries(value.modes).flatMap(([id, mode]) => (mode === 'edit' || mode === 'tune' ? [[id, mode]] : [])))
    : {}
  return { tabs, collapsed, modes }
}

export function withMode(prefs: InspectorPrefs, documentId: string, mode: VectorMode): InspectorPrefs {
  return { ...prefs, modes: { ...prefs.modes, [documentId]: mode } }
}

/** A document opens the way it was left; a document with no controls has nothing to tune. */
export function modeOf(prefs: InspectorPrefs, documentId: string): VectorMode {
  return prefs.modes[documentId] ?? 'edit'
}

export function withTab(prefs: InspectorPrefs, documentId: string, tab: InspectorTab): InspectorPrefs {
  return { ...prefs, tabs: { ...prefs.tabs, [documentId]: tab } }
}

export function withSection(prefs: InspectorPrefs, sectionId: string, open: boolean): InspectorPrefs {
  const collapsed = prefs.collapsed.filter((id) => id !== sectionId)
  return { ...prefs, collapsed: open ? collapsed : [...collapsed, sectionId] }
}

export function tabOf(prefs: InspectorPrefs, documentId: string): InspectorTab {
  return prefs.tabs[documentId] ?? 'design'
}

export function isOpen(prefs: InspectorPrefs, sectionId: string, defaultOpen = true): boolean {
  return prefs.collapsed.includes(sectionId) ? false : defaultOpen
}

export function readInspectorPrefs(): InspectorPrefs {
  if (typeof localStorage === 'undefined') return EMPTY_PREFS
  try {
    return parseInspectorPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return EMPTY_PREFS
  }
}

export function writeInspectorPrefs(prefs: InspectorPrefs): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* The inspector keeps working from memory when storage is full or blocked. */
  }
}
