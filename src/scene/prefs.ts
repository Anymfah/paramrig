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
  /** The selection palette: ParamRig's amber, or Blender's own orange. */
  theme: 'paramrig' | 'blender-classic'
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
  theme: 'paramrig',
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
    theme: source.theme === 'blender-classic' ? 'blender-classic' : 'paramrig',
  }
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
