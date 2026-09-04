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

/** The properties editor's vertical tabs, in the order Blender puts them. */
export type PropertiesTab = 'scene' | 'world' | 'object' | 'modifiers' | 'material' | 'data' | 'controls' | 'history'

export const PROPERTIES_TABS: PropertiesTab[] = ['scene', 'world', 'object', 'modifiers', 'material', 'data', 'controls', 'history']

/** Edit builds the scene; Tune shows it as a rig, with the controls and nothing to drag. */
export type SceneMode = EditorMode

/**
 * What the scene editor remembers about a document beyond the document itself: which properties
 * tab it was left on, which sections were folded, and the input preferences — which are a habit,
 * not a property of the file, so they follow the person across every scene.
 */
export type ScenePreferences = {
  /** Orbit with ⌥ and the left button, for a trackpad with no middle button. */
  emulateThreeButton: boolean
  /** Read `Numpad1` and friends from a real numeric keypad. */
  numpadEmulation: boolean
  /** Right button selects and left button places the cursor, the way Blender's old keymap did. */
  rightClickSelect: boolean
  /** Orbit turns around the selection rather than around the view's own centre. */
  orbitAroundSelection: boolean
  /** An axis-aligned view switches to orthographic, and orbiting returns to perspective. */
  autoPerspective: boolean
  /** The wheel zooms towards the pointer rather than towards the middle of the view. */
  zoomToMouse: boolean
  orbitStyle: 'turntable' | 'trackball'
  /** Clicking nothing clears the selection. */
  deselectOnEmptyClick: boolean
  /** How long a view change takes to settle. Zero switches instantly. */
  smoothViewMs: number
  /** The wheel and the pinch run the other way. */
  invertZoomWheel: boolean
  /** A trackpad's two-finger scroll pans rather than zooms, as macOS means it to. */
  trackpadNatural: boolean
  /** How many steps of history a document keeps. */
  undoSteps: number
  /** Escaping an extrusion removes the geometry it made, rather than leaving it where it started. */
  cancelRemovesExtrusion: boolean
  /** New vertices within this distance are merged as they are made. Zero never merges. */
  autoMergeDistance: number
  /** What the viewport renders at, against the display's own pixels. */
  resolutionScale: number
  /** How long the pointer rests before a tooltip appears, in milliseconds. */
  tooltipDelayMs: number
  /** A pie fades and grows on the way in. Off, it simply appears. */
  pieAnimation: boolean
  /** The selection palette: ParamRig's amber, Blender's own orange, or the high-contrast pair. */
  theme: 'paramrig' | 'blender-classic' | 'high-contrast'
  /** The matcap a new scene wears in solid shading. */
  matcap: string
  /** What the space bar does: play the animation, open the toolbar, or open the palette. */
  spacebarAction: 'play' | 'tools' | 'search'
}

export const DEFAULT_PREFERENCES: ScenePreferences = {
  emulateThreeButton: true,
  numpadEmulation: true,
  rightClickSelect: false,
  orbitAroundSelection: true,
  autoPerspective: true,
  zoomToMouse: true,
  orbitStyle: 'turntable',
  deselectOnEmptyClick: true,
  smoothViewMs: 200,
  invertZoomWheel: false,
  // Off by default: two fingers orbit, as Blender means them. On, they scroll as macOS means them.
  trackpadNatural: false,
  undoSteps: 100,
  cancelRemovesExtrusion: true,
  autoMergeDistance: 0,
  resolutionScale: 1,
  tooltipDelayMs: 400,
  pieAnimation: true,
  theme: 'paramrig',
  matcap: 'clay',
  spacebarAction: 'play',
}

type SceneExtra = { preferences: ScenePreferences }

export type ScenePrefs = {
  tabs: Record<string, PropertiesTab>
  collapsed: string[]
  modes: Record<string, SceneMode>
  preferences: ScenePreferences
}

const store = inspectorPrefsStore<PropertiesTab, SceneExtra>({
  key: 'paramrig.scene-inspector.v1',
  tabs: PROPERTIES_TABS,
  defaultTab: 'object',
  extra: {
    empty: { preferences: { ...DEFAULT_PREFERENCES } },
    parse: (value) => ({ preferences: parsePreferences(value.preferences) }),
  },
})

export function parsePreferences(value: unknown): ScenePreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PREFERENCES }
  const source = value as Partial<ScenePreferences>
  const flag = (given: unknown, fallback: boolean) => (typeof given === 'boolean' ? given : fallback)
  return {
    emulateThreeButton: flag(source.emulateThreeButton, DEFAULT_PREFERENCES.emulateThreeButton),
    numpadEmulation: flag(source.numpadEmulation, DEFAULT_PREFERENCES.numpadEmulation),
    rightClickSelect: flag(source.rightClickSelect, DEFAULT_PREFERENCES.rightClickSelect),
    orbitAroundSelection: flag(source.orbitAroundSelection, DEFAULT_PREFERENCES.orbitAroundSelection),
    autoPerspective: flag(source.autoPerspective, DEFAULT_PREFERENCES.autoPerspective),
    zoomToMouse: flag(source.zoomToMouse, DEFAULT_PREFERENCES.zoomToMouse),
    orbitStyle: source.orbitStyle === 'trackball' ? 'trackball' : 'turntable',
    deselectOnEmptyClick: flag(source.deselectOnEmptyClick, DEFAULT_PREFERENCES.deselectOnEmptyClick),
    smoothViewMs: number(source.smoothViewMs, DEFAULT_PREFERENCES.smoothViewMs, 0, 1000),
    invertZoomWheel: flag(source.invertZoomWheel, DEFAULT_PREFERENCES.invertZoomWheel),
    trackpadNatural: flag(source.trackpadNatural, DEFAULT_PREFERENCES.trackpadNatural),
    undoSteps: Math.round(number(source.undoSteps, DEFAULT_PREFERENCES.undoSteps, 8, 256)),
    cancelRemovesExtrusion: flag(source.cancelRemovesExtrusion, DEFAULT_PREFERENCES.cancelRemovesExtrusion),
    autoMergeDistance: number(source.autoMergeDistance, DEFAULT_PREFERENCES.autoMergeDistance, 0, 1),
    resolutionScale: number(source.resolutionScale, DEFAULT_PREFERENCES.resolutionScale, 0.5, 2),
    tooltipDelayMs: Math.round(number(source.tooltipDelayMs, DEFAULT_PREFERENCES.tooltipDelayMs, 0, 2000)),
    pieAnimation: flag(source.pieAnimation, DEFAULT_PREFERENCES.pieAnimation),
    theme: source.theme === 'blender-classic' || source.theme === 'high-contrast' ? source.theme : 'paramrig',
    matcap: typeof source.matcap === 'string' && source.matcap.length <= 40 ? source.matcap : DEFAULT_PREFERENCES.matcap,
    spacebarAction: source.spacebarAction === 'tools' || source.spacebarAction === 'search' ? source.spacebarAction : 'play',
  }
}

/** A number a file may have written as anything, held inside the range the editor can honour. */
function number(given: unknown, fallback: number, min: number, max: number): number {
  if (typeof given !== 'number' || !Number.isFinite(given)) return fallback
  return Math.min(max, Math.max(min, given))
}

export const EMPTY_SCENE_PREFS: ScenePrefs = store.empty

export function readScenePrefs(): ScenePrefs {
  return store.read()
}

export function writeScenePrefs(prefs: ScenePrefs): void {
  store.write(prefs)
}

export function parseScenePrefs(raw: unknown): ScenePrefs {
  return store.parse(raw)
}

export function tabOf(prefs: ScenePrefs, documentId: string): PropertiesTab {
  return tabOfPrefs(prefs, documentId, 'object')
}

export function withTab(prefs: ScenePrefs, documentId: string, tab: PropertiesTab): ScenePrefs {
  return withTabPrefs(prefs, documentId, tab)
}

export function modeOf(prefs: ScenePrefs, documentId: string): SceneMode {
  return modeOfPrefs(prefs, documentId)
}

export function withMode(prefs: ScenePrefs, documentId: string, mode: SceneMode): ScenePrefs {
  return withModePrefs(prefs, documentId, mode)
}

export function withSection(prefs: ScenePrefs, sectionId: string, open: boolean): ScenePrefs {
  return withSectionPrefs(prefs, sectionId, open)
}

export function isOpen(prefs: ScenePrefs, sectionId: string, defaultOpen = true): boolean {
  return isSectionOpen(prefs, sectionId, defaultOpen)
}

export function withPreferences(prefs: ScenePrefs, preferences: Partial<ScenePreferences>): ScenePrefs {
  return { ...prefs, preferences: { ...prefs.preferences, ...preferences } }
}

/** The same, on the settings a person carries between documents. */
export function withSettings(settings: SceneSettings, preferences: Partial<ScenePreferences>): SceneSettings {
  return { ...settings, preferences: { ...settings.preferences, ...preferences } }
}

/* ------------------------------------------------------- the settings of a person */

/**
 * What follows the person rather than the document: the preferences, the quick favourites, and
 * what the palette was last used for.
 *
 * These live under a key of their own rather than beside the per-document state, because they are
 * a habit. Clearing a document's folded sections should not clear how somebody orbits, and reading
 * the preferences should not mean parsing every scene's tab.
 */
export type SceneSettings = {
  preferences: ScenePreferences
  /** Operator and action ids on the Q menu, in the order they were added. */
  favorites: string[]
  /** What was run from the palette, most recent first, so it opens on the last choice. */
  recentCommands: string[]
}

export const SETTINGS_KEY = 'paramrig.scene-prefs.v1'

export const DEFAULT_SETTINGS: SceneSettings = {
  preferences: { ...DEFAULT_PREFERENCES },
  favorites: [],
  recentCommands: [],
}

/** At most this many favourites: the Q menu is a hand's worth of things, not a second palette. */
export const MAX_FAVORITES = 12

function ids(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const kept: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 80) continue
    if (!kept.includes(entry)) kept.push(entry)
    if (kept.length >= limit) break
  }
  return kept
}

export function parseSceneSettings(raw: unknown): SceneSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SETTINGS }
  const source = raw as Partial<SceneSettings>
  return {
    preferences: parsePreferences(source.preferences),
    favorites: ids(source.favorites, MAX_FAVORITES),
    recentCommands: ids(source.recentCommands, 12),
  }
}

export function readSceneSettings(): SceneSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS }
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (raw === null) {
    /*
     * The preferences used to sit inside the per-document store. Somebody who has set them should
     * not find them reset by an update, so the first read after one takes them across; the old copy
     * is left alone, and simply stops being read.
     */
    return { ...DEFAULT_SETTINGS, preferences: readScenePrefs().preferences ?? { ...DEFAULT_PREFERENCES } }
  }
  try {
    return parseSceneSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSceneSettings(settings: SceneSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* Editing carries on in memory when storage is full or blocked. */
  }
}

/** On the Q menu, or off it: the same gesture both ways, as Blender's own context menu is. */
export function toggleFavorite(settings: SceneSettings, id: string): SceneSettings {
  const favorites = settings.favorites.includes(id)
    ? settings.favorites.filter((entry) => entry !== id)
    : [...settings.favorites, id].slice(-MAX_FAVORITES)
  return { ...settings, favorites }
}

export function isFavorite(settings: SceneSettings, id: string): boolean {
  return settings.favorites.includes(id)
}
