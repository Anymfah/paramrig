import type { PanelPrefs, StoredDraft } from '@/rigs/types'

const DRAFTS_KEY = 'paramrig.drafts.v1'
const PREFS_KEY = 'paramrig.prefs.v1'
const TABS_KEY = 'paramrig.tabs.v1'
const NAV_FOLDERS_KEY = 'paramrig.nav-folders.v1'

export const NAV_WIDTH_MIN = 176
export const NAV_WIDTH_MAX = 320
export const NAV_WIDTH_DEFAULT = 240
export const NAV_WIDTH_COMPACT = 48
export const NAV_COMPACT_EXPAND_SLACK = 24
const LEGACY_NAV_WIDTH = 208

export const INSPECTOR_WIDTH_MIN = 272
export const INSPECTOR_WIDTH_MAX = 380
export const INSPECTOR_WIDTH_DEFAULT = 320
export const CANVAS_MIN_WIDTH = 360

export const defaultPrefs = (): PanelPrefs => ({
  version: 1,
  navWidth: NAV_WIDTH_DEFAULT,
  inspectorWidth: INSPECTOR_WIDTH_DEFAULT,
  timelineHeight: 232,
  navCollapsed: false,
  navCompact: false,
  inspectorCollapsed: false,
  timelineCollapsed: false,
})

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function loadDraft(rigId: string): StoredDraft | null {
  const all = readJson<Record<string, StoredDraft>>(DRAFTS_KEY)
  const draft = all?.[rigId]
  if (!draft || draft.version !== 1 || draft.rigId !== rigId) return null
  return draft
}

export function saveDraft(draft: StoredDraft): void {
  try {
    const all = readJson<Record<string, StoredDraft>>(DRAFTS_KEY) ?? {}
    all[draft.rigId] = draft
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(all))
  } catch {
    /* Quota or private mode — editing still works in memory. */
  }
}

export function loadPrefs(): PanelPrefs {
  const stored = readJson<PanelPrefs>(PREFS_KEY)
  if (!stored || stored.version !== 1) return defaultPrefs()
  return {
    ...defaultPrefs(),
    ...stored,
    navWidth: clamp(
      stored.navWidth === LEGACY_NAV_WIDTH ? NAV_WIDTH_DEFAULT : stored.navWidth,
      NAV_WIDTH_MIN,
      NAV_WIDTH_MAX,
    ),
    inspectorWidth: clamp(stored.inspectorWidth, INSPECTOR_WIDTH_MIN, INSPECTOR_WIDTH_MAX),
    timelineHeight: clamp(stored.timelineHeight, 180, 4000),
    navCompact: Boolean(stored.navCompact),
  }
}

export function savePrefs(prefs: PanelPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}

export function loadTabs(): string[] {
  const stored = readJson<string[]>(TABS_KEY)
  return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []
}

export function saveTabs(tabs: string[]): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
  } catch {
    /* ignore */
  }
}

export function loadCollapsedFolders(): string[] {
  const stored = readJson<string[]>(NAV_FOLDERS_KEY)
  return Array.isArray(stored) ? stored.filter((path) => typeof path === 'string') : []
}

export function saveCollapsedFolders(paths: string[]): void {
  try {
    localStorage.setItem(NAV_FOLDERS_KEY, JSON.stringify(paths))
  } catch {
    /* ignore */
  }
}

export function clearCorruptStorage(): void {
  localStorage.removeItem(DRAFTS_KEY)
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
