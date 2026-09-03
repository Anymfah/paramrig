/**
 * What an inspector remembers between visits: which tab each document was left on, which sections
 * are folded away, and how a document that carries controls was last opened. The tab belongs to
 * the document — a rig with controls is opened differently from a drawing — while a folded section
 * is a habit, and follows the person.
 *
 * One shape, two editors: `inspectorPrefsStore` binds it to a storage key and a list of tabs, so
 * the vector and the scene editors keep their own memory without keeping their own code.
 */
export type EditorMode = 'edit' | 'tune'

export type InspectorPrefs<Tab extends string, Extra = Record<string, never>> = {
  tabs: Record<string, Tab>
  collapsed: string[]
  /** Which way a document that carries controls was left open: editing it, or turning its knobs. */
  modes: Record<string, EditorMode>
} & Extra

export type InspectorPrefsStore<Tab extends string, Extra> = {
  empty: InspectorPrefs<Tab, Extra>
  parse: (raw: unknown) => InspectorPrefs<Tab, Extra>
  read: () => InspectorPrefs<Tab, Extra>
  write: (prefs: InspectorPrefs<Tab, Extra>) => void
}

export function inspectorPrefsStore<Tab extends string, Extra extends object = Record<string, never>>(options: {
  key: string
  tabs: readonly Tab[]
  defaultTab: Tab
  /** Anything the editor keeps beyond the shared three, with its own reader. */
  extra?: { empty: Extra; parse: (value: Partial<Extra> & Record<string, unknown>) => Extra }
}): InspectorPrefsStore<Tab, Extra> {
  const emptyExtra = (options.extra?.empty ?? ({} as Extra))
  const empty = { tabs: {}, collapsed: [], modes: {}, ...emptyExtra } as InspectorPrefs<Tab, Extra>

  const parse = (raw: unknown): InspectorPrefs<Tab, Extra> => {
    if (!raw || typeof raw !== 'object') return empty
    const value = raw as Record<string, unknown>
    const rawTabs = value.tabs
    const tabs = rawTabs && typeof rawTabs === 'object' && !Array.isArray(rawTabs)
      ? Object.fromEntries(Object.entries(rawTabs).flatMap(([id, tab]) => options.tabs.includes(tab as Tab) ? [[id, tab as Tab]] : []))
      : {}
    const collapsed = Array.isArray(value.collapsed) ? value.collapsed.filter((id): id is string => typeof id === 'string') : []
    const rawModes = value.modes
    const modes = rawModes && typeof rawModes === 'object' && !Array.isArray(rawModes)
      ? Object.fromEntries(Object.entries(rawModes).flatMap(([id, mode]) => (mode === 'edit' || mode === 'tune' ? [[id, mode]] : [])))
      : {}
    const extra = options.extra ? options.extra.parse(value as Partial<Extra> & Record<string, unknown>) : emptyExtra
    return { tabs, collapsed, modes, ...extra } as InspectorPrefs<Tab, Extra>
  }

  return {
    empty,
    parse,
    read: () => {
      if (typeof localStorage === 'undefined') return empty
      try {
        return parse(JSON.parse(localStorage.getItem(options.key) ?? 'null'))
      } catch {
        return empty
      }
    },
    write: (prefs) => {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(options.key, JSON.stringify(prefs))
      } catch {
        /* The inspector keeps working from memory when storage is full or blocked. */
      }
    },
  }
}

export function withTab<Tab extends string, Extra>(prefs: InspectorPrefs<Tab, Extra>, documentId: string, tab: Tab): InspectorPrefs<Tab, Extra> {
  return { ...prefs, tabs: { ...prefs.tabs, [documentId]: tab } }
}

export function withMode<Tab extends string, Extra>(prefs: InspectorPrefs<Tab, Extra>, documentId: string, mode: EditorMode): InspectorPrefs<Tab, Extra> {
  return { ...prefs, modes: { ...prefs.modes, [documentId]: mode } }
}

export function withSection<Tab extends string, Extra>(prefs: InspectorPrefs<Tab, Extra>, sectionId: string, open: boolean): InspectorPrefs<Tab, Extra> {
  const collapsed = prefs.collapsed.filter((id) => id !== sectionId)
  return { ...prefs, collapsed: open ? collapsed : [...collapsed, sectionId] }
}

/** A document opens the way it was left; a document with no controls has nothing to tune. */
export function modeOf<Tab extends string, Extra>(prefs: InspectorPrefs<Tab, Extra>, documentId: string): EditorMode {
  return prefs.modes[documentId] ?? 'edit'
}

export function tabOf<Tab extends string, Extra>(prefs: InspectorPrefs<Tab, Extra>, documentId: string, fallback: Tab): Tab {
  return prefs.tabs[documentId] ?? fallback
}

export function isOpen<Tab extends string, Extra>(prefs: InspectorPrefs<Tab, Extra>, sectionId: string, defaultOpen = true): boolean {
  return prefs.collapsed.includes(sectionId) ? false : defaultOpen
}
