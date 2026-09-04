import { DEFAULT_PREFERENCES, type ScenePreferences } from '@/scene/prefs'
import type { EditorMode, SelectMode } from '@/scene/types'

/**
 * Every key the scene editor answers to, in one table.
 *
 * It is Blender's keymap, with the departures a browser forces written down here rather than left
 * for a person to discover by pressing something and watching the page do the wrong thing. The
 * table is the single source: resolution, the F1 sheet, the tooltips and `docs/scene-editor-keymap.md`
 * all read it, so a chord cannot mean one thing in the code and another in the documentation.
 *
 * Two rules shape the table. Resolution reads `event.code`, the physical position, never
 * `event.key`: on an AZERTY keyboard the top row types `& é " '` while still reporting
 * `Digit1…Digit4`, so the axis views stay under the digits where Blender put them. Only numeric
 * entry during a modal transform reads `event.key`, and that lives in `transform/numeric.ts`.
 * And a key that resolves is not a key that runs: an operator refuses through its own `available`,
 * with a reason the status bar shows. The table therefore scopes a binding to a mode only when the
 * same chord would otherwise mean two different things — ⇧D duplicates an object in object mode
 * and vertices in edit mode, so that one is scoped; G means move everywhere, so it is not.
 *
 * ⌘W, ⌘T, ⌘N, ⌘Q and ⌃W are absent on purpose and must stay absent: the browser takes them before
 * the page is asked, and a shortcut that closes the tab is worse than no shortcut at all.
 */

/** What a key does: run an operator from the registry, or drive the editor itself. */
export type KeyAction =
  | { kind: 'operator'; id: string; params?: Record<string, unknown> }
  | { kind: 'action'; id: string }

export type KeyBinding = {
  /** `event.code`: 'KeyG', 'Digit1', 'Numpad1', 'Escape', 'F9'. Codes, not keys, so AZERTY works. */
  code: string
  /** Required modifiers. Anything not listed must be absent. `meta` matches ⌘ on macOS. */
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
  /** Only in this mode; a binding with no mode applies to all. */
  mode?: EditorMode
  /** Only when the edit mode is selecting these element kinds. */
  selectMode?: SelectMode
  action: KeyAction
  label: string
  /** Which of the preferences has to be on for this binding to exist. */
  requires?: 'numpadEmulation' | 'emulateThreeButton' | 'rightClickSelect'
  /** Why this differs from Blender, when it does. Shown in the generated keymap page. */
  note?: string
}

/**
 * The parts of a `KeyboardEvent` the keymap reads. Taking a plain object rather than the DOM event
 * is what lets the resolution be tested without a browser, and lets the e2e harness replay a chord.
 * `key` is carried because the modal transform's numeric entry needs it from the same object; the
 * keymap itself never looks at it.
 */
export type KeyboardEventLike = {
  code: string
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

export type KeyContext = {
  mode: EditorMode
  selectMode: SelectMode[]
  preferences: ScenePreferences
  /** true when a text field has focus */
  typing: boolean
}

/** One row of the F1 sheet and of the generated keymap page. */
export type KeymapEntry = {
  /** The chord as a person reads it: `⇧D`, `Numpad .`. */
  shortcut: string
  label: string
  /** The operator or action the chord runs, so a page can link to what it does. */
  actionId: string
  /** Absent when the binding applies in every mode. */
  mode?: EditorMode
  note?: string
}

export type KeymapSection = {
  id: string
  title: string
  entries: KeymapEntry[]
}

/* --------------------------------------------------------------- the notes */

// Written once and shared, because a departure explained two ways in two rows reads as two
// different decisions.
const NOTE_NUMPAD_EMULATION =
  'A keyboard without a numeric keypad reaches the axis views on the top row, the way Blender’s “Emulate Numpad” preference does.'
const NOTE_NO_KEYPAD =
  'Blender grows and shrinks a selection with the keypad’s + and −. The top row’s own + and − are bound as well, for a keyboard that has no keypad.'
const NOTE_ALT_GR =
  '⌃⌥ is AltGr on Windows, where some layouts type a character with it. Keys are ignored while a field has focus, so typing is left alone.'
const NOTE_UNDO_ON_MACOS =
  'macOS spells undo ⌘Z and Blender spells it ⌃Z. Both are bound, so neither habit has to be unlearned.'
const NOTE_SUBDIVISION =
  'Level nought takes the subdivision modifier off again, so the chords are a round trip rather than a one-way street.'
const NOTE_BROWSER_FILE =
  'The browser would save or open a page of its own. The editor takes the chord for the document and stops it there.'

/* ---------------------------------------------------------------- the table */

const operator = (id: string): KeyAction => ({ kind: 'operator', id })
const action = (id: string): KeyAction => ({ kind: 'action', id })

/**
 * The order matters twice: it breaks ties between bindings of equal specificity, and it is the
 * order the F1 sheet lists a section in. Within the views, the real numeric keypad comes before
 * the emulation so that `bindingFor('view.front')` labels a menu entry `Numpad 1`.
 */
export const KEYMAP: KeyBinding[] = [
  /* view */
  { code: 'NumpadDecimal', action: operator('view.frameSelected'), label: 'Frame selected' },
  { code: 'Home', action: operator('view.frameAll'), label: 'Frame all' },
  { code: 'Numpad1', action: operator('view.front'), label: 'Front view' },
  { code: 'Numpad1', ctrl: true, action: operator('view.back'), label: 'Back view' },
  { code: 'Numpad3', action: operator('view.right'), label: 'Right view' },
  { code: 'Numpad3', ctrl: true, action: operator('view.left'), label: 'Left view' },
  { code: 'Numpad7', action: operator('view.top'), label: 'Top view' },
  { code: 'Numpad7', ctrl: true, action: operator('view.bottom'), label: 'Bottom view' },
  { code: 'Numpad9', action: operator('view.opposite'), label: 'Opposite view' },
  { code: 'Numpad5', action: operator('view.togglePerspective'), label: 'Toggle perspective' },
  { code: 'Numpad8', action: operator('view.orbitUp'), label: 'Orbit up' },
  { code: 'Numpad2', action: operator('view.orbitDown'), label: 'Orbit down' },
  { code: 'Numpad4', action: operator('view.orbitLeft'), label: 'Orbit left' },
  { code: 'Numpad6', action: operator('view.orbitRight'), label: 'Orbit right' },
  { code: 'Numpad0', action: operator('view.camera'), label: 'Camera view' },
  { code: 'Numpad0', ctrl: true, alt: true, action: operator('view.cameraToView'), label: 'Camera to view' },
  { code: 'NumpadDivide', action: operator('view.local'), label: 'Toggle local view' },

  /* view, on the top row, for a keyboard with no numeric keypad */
  { code: 'Digit1', alt: true, action: operator('view.front'), label: 'Front view', requires: 'numpadEmulation', note: NOTE_NUMPAD_EMULATION },
  { code: 'Digit1', ctrl: true, alt: true, action: operator('view.back'), label: 'Back view', requires: 'numpadEmulation', note: NOTE_ALT_GR },
  { code: 'Digit3', alt: true, action: operator('view.right'), label: 'Right view', requires: 'numpadEmulation', note: NOTE_NUMPAD_EMULATION },
  { code: 'Digit3', ctrl: true, alt: true, action: operator('view.left'), label: 'Left view', requires: 'numpadEmulation', note: NOTE_ALT_GR },
  { code: 'Digit7', alt: true, action: operator('view.top'), label: 'Top view', requires: 'numpadEmulation', note: NOTE_NUMPAD_EMULATION },
  { code: 'Digit7', ctrl: true, alt: true, action: operator('view.bottom'), label: 'Bottom view', requires: 'numpadEmulation', note: NOTE_ALT_GR },
  { code: 'Digit5', alt: true, action: operator('view.togglePerspective'), label: 'Toggle perspective', requires: 'numpadEmulation', note: NOTE_NUMPAD_EMULATION },
  { code: 'Digit0', alt: true, action: operator('view.camera'), label: 'Camera view', requires: 'numpadEmulation', note: NOTE_NUMPAD_EMULATION },
  { code: 'Digit0', ctrl: true, alt: true, action: operator('view.cameraToView'), label: 'Camera to view', requires: 'numpadEmulation', note: NOTE_ALT_GR },
  { code: 'Period', alt: true, action: operator('view.frameSelected'), label: 'Frame selected', requires: 'numpadEmulation', note: NOTE_NUMPAD_EMULATION },

  /* modes */
  {
    code: 'Tab',
    action: action('mode.toggleEdit'),
    label: 'Toggle edit mode',
    note: 'Tab changes mode instead of moving focus, so the viewport takes the event before the page does. A focused field keeps it.',
  },
  {
    code: 'Tab',
    ctrl: true,
    action: action('mode.pie'),
    label: 'Mode pie',
    note: 'Some browsers keep ⌃Tab for their own tabs. The mode selector in the header does the same job where they do.',
  },

  /* select, in object mode */
  { code: 'KeyA', mode: 'object', action: operator('select.all'), label: 'Select all' },
  { code: 'KeyA', alt: true, mode: 'object', action: operator('select.none'), label: 'Select none' },
  { code: 'KeyI', ctrl: true, mode: 'object', action: operator('select.invert'), label: 'Invert selection' },
  { code: 'KeyB', action: operator('select.box'), label: 'Box select' },
  { code: 'KeyC', action: operator('select.circle'), label: 'Circle select' },
  { code: 'KeyW', action: action('tool.cycleSelect'), label: 'Cycle the select tool' },
  { code: 'KeyG', shift: true, mode: 'object', action: operator('select.similar'), label: 'Select similar' },

  /* select, in edit mode */
  { code: 'KeyA', mode: 'edit', action: operator('mesh.selectAll'), label: 'Select all' },
  { code: 'KeyA', alt: true, mode: 'edit', action: operator('mesh.selectNone'), label: 'Select none' },
  { code: 'KeyI', ctrl: true, mode: 'edit', action: operator('mesh.selectInvert'), label: 'Invert selection' },
  { code: 'KeyL', ctrl: true, mode: 'edit', action: operator('mesh.selectLinked'), label: 'Select linked' },
  { code: 'KeyL', mode: 'edit', action: action('select.linkedPick'), label: 'Select linked under the pointer' },
  { code: 'KeyG', shift: true, mode: 'edit', action: operator('mesh.selectSimilar'), label: 'Select similar' },
  {
    code: 'NumpadAdd',
    ctrl: true,
    mode: 'edit',
    action: operator('mesh.selectMore'),
    label: 'Select more',
  },
  {
    code: 'NumpadSubtract',
    ctrl: true,
    mode: 'edit',
    action: operator('mesh.selectLess'),
    label: 'Select less',
  },
  {
    code: 'Equal',
    ctrl: true,
    mode: 'edit',
    action: operator('mesh.selectMore'),
    label: 'Select more',
    note: NOTE_NO_KEYPAD,
  },
  {
    code: 'Minus',
    ctrl: true,
    mode: 'edit',
    action: operator('mesh.selectLess'),
    label: 'Select less',
    note: NOTE_NO_KEYPAD,
  },

  /* the three element kinds */
  { code: 'Digit1', mode: 'edit', action: operator('mode.selectVertex'), label: 'Vertex select' },
  { code: 'Digit2', mode: 'edit', action: operator('mode.selectEdge'), label: 'Edge select' },
  { code: 'Digit3', mode: 'edit', action: operator('mode.selectFace'), label: 'Face select' },
  {
    code: 'Digit1',
    shift: true,
    mode: 'edit',
    action: { kind: 'operator', id: 'mode.selectVertex', params: { extend: true } },
    label: 'Add vertex select',
  },
  {
    code: 'Digit2',
    shift: true,
    mode: 'edit',
    action: { kind: 'operator', id: 'mode.selectEdge', params: { extend: true } },
    label: 'Add edge select',
  },
  {
    code: 'Digit3',
    shift: true,
    mode: 'edit',
    action: { kind: 'operator', id: 'mode.selectFace', params: { extend: true } },
    label: 'Add face select',
  },

  /* add, and the object mode */
  { code: 'KeyA', shift: true, action: action('add.menu'), label: 'Add' },
  { code: 'KeyD', shift: true, mode: 'object', action: operator('object.duplicate'), label: 'Duplicate' },
  { code: 'KeyD', alt: true, mode: 'object', action: operator('object.duplicateLinked'), label: 'Duplicate linked' },
  { code: 'KeyX', mode: 'object', action: action('object.deleteConfirm'), label: 'Delete, with confirmation' },
  { code: 'Delete', mode: 'object', action: operator('object.delete'), label: 'Delete' },
  {
    code: 'KeyJ',
    ctrl: true,
    mode: 'object',
    action: operator('object.join'),
    label: 'Join',
    note: '⌃J opens the downloads list in some browsers. The editor takes it, and the Object menu carries Join for where it cannot.',
  },
  {
    code: 'KeyA',
    ctrl: true,
    mode: 'object',
    action: action('object.applyMenu'),
    label: 'Apply',
    note: '⌃A selects the whole page in a browser. The editor takes it in the viewport; a focused field keeps it.',
  },
  {
    code: 'KeyP',
    ctrl: true,
    mode: 'object',
    action: operator('object.parent'),
    label: 'Parent',
    note: '⌃P prints in every browser. The editor takes it, and Object → Parent is the way round it.',
  },
  { code: 'KeyP', alt: true, mode: 'object', action: operator('object.clearParent'), label: 'Clear parent' },
  { code: 'KeyM', mode: 'object', action: operator('object.moveToCollection'), label: 'Move to collection' },
  { code: 'KeyM', shift: true, mode: 'object', action: operator('object.linkToCollection'), label: 'Link to collection' },
  { code: 'KeyH', mode: 'object', action: operator('object.hide'), label: 'Hide selected' },
  { code: 'KeyH', alt: true, mode: 'object', action: operator('object.revealHidden'), label: 'Reveal hidden' },
  { code: 'KeyH', shift: true, mode: 'object', action: operator('object.hideUnselected'), label: 'Hide unselected' },
  { code: 'F2', action: operator('object.rename'), label: 'Rename' },
  {
    code: 'KeyC',
    ctrl: true,
    mode: 'object',
    action: operator('object.copy'),
    label: 'Copy objects',
    note: 'The browser’s own clipboard chord. The editor takes it for objects when no field has focus, and only on ⌃, never ⌘, so the system clipboard stays reachable on macOS.',
  },
  {
    code: 'KeyV',
    ctrl: true,
    mode: 'object',
    action: operator('object.paste'),
    label: 'Paste objects',
    note: 'The browser’s own clipboard chord. The editor takes it for objects when no field has focus, and only on ⌃, never ⌘, so the system clipboard stays reachable on macOS.',
  },
  { code: 'KeyG', alt: true, mode: 'object', action: operator('object.clearLocation'), label: 'Clear location' },
  { code: 'KeyR', alt: true, mode: 'object', action: operator('object.clearRotation'), label: 'Clear rotation' },
  { code: 'KeyS', alt: true, mode: 'object', action: operator('object.clearScale'), label: 'Clear scale' },

  /* subdivision, as Blender binds it: the level a person changes most, on one chord */
  { code: 'Digit0', ctrl: true, mode: 'object', action: { kind: 'operator', id: 'modifier.subdivisionSet', params: { level: 0 } }, label: 'Subdivision level 0', note: NOTE_SUBDIVISION },
  { code: 'Digit1', ctrl: true, mode: 'object', action: { kind: 'operator', id: 'modifier.subdivisionSet', params: { level: 1 } }, label: 'Subdivision level 1' },
  { code: 'Digit2', ctrl: true, mode: 'object', action: { kind: 'operator', id: 'modifier.subdivisionSet', params: { level: 2 } }, label: 'Subdivision level 2' },
  { code: 'Digit3', ctrl: true, mode: 'object', action: { kind: 'operator', id: 'modifier.subdivisionSet', params: { level: 3 } }, label: 'Subdivision level 3' },
  { code: 'Digit4', ctrl: true, mode: 'object', action: { kind: 'operator', id: 'modifier.subdivisionSet', params: { level: 4 } }, label: 'Subdivision level 4' },
  { code: 'Digit5', ctrl: true, mode: 'object', action: { kind: 'operator', id: 'modifier.subdivisionSet', params: { level: 5 } }, label: 'Subdivision level 5' },

  /* modelling, in edit mode */
  { code: 'KeyE', mode: 'edit', action: operator('mesh.extrudeRegion'), label: 'Extrude region' },
  { code: 'KeyE', alt: true, mode: 'edit', action: action('menu.extrude'), label: 'Extrude menu' },
  { code: 'KeyI', mode: 'edit', action: operator('mesh.inset'), label: 'Inset faces' },
  { code: 'KeyB', ctrl: true, mode: 'edit', action: operator('mesh.bevelEdges'), label: 'Bevel edges' },
  { code: 'KeyB', ctrl: true, shift: true, mode: 'edit', action: operator('mesh.bevelVertices'), label: 'Bevel vertices' },
  { code: 'KeyR', ctrl: true, mode: 'edit', action: operator('mesh.loopCut'), label: 'Loop cut' },
  { code: 'KeyR', ctrl: true, shift: true, mode: 'edit', action: operator('mesh.offsetEdgeLoop'), label: 'Offset edge loop' },
  { code: 'KeyK', mode: 'edit', action: action('tool.knife'), label: 'Knife' },
  { code: 'KeyK', shift: true, mode: 'edit', action: operator('mesh.knifeProject'), label: 'Knife project' },
  { code: 'KeyM', mode: 'edit', action: action('menu.merge'), label: 'Merge menu' },
  { code: 'KeyM', alt: true, mode: 'edit', action: action('menu.split'), label: 'Split menu' },
  { code: 'KeyM', ctrl: true, mode: 'edit', action: operator('mesh.mirror'), label: 'Mirror' },
  { code: 'KeyX', mode: 'edit', action: action('menu.delete'), label: 'Delete menu' },
  { code: 'Delete', mode: 'edit', action: action('menu.delete'), label: 'Delete menu' },
  { code: 'KeyF', mode: 'edit', action: operator('mesh.fill'), label: 'Make edge or face' },
  { code: 'KeyF', alt: true, mode: 'edit', action: operator('mesh.beautyFill'), label: 'Beauty fill' },
  { code: 'KeyP', mode: 'edit', action: action('menu.separate'), label: 'Separate' },
  { code: 'KeyV', mode: 'edit', action: operator('mesh.rip'), label: 'Rip' },
  { code: 'KeyV', alt: true, mode: 'edit', action: operator('mesh.ripFill'), label: 'Rip fill' },
  { code: 'KeyV', shift: true, mode: 'edit', action: operator('mesh.vertexSlide'), label: 'Vertex slide' },
  { code: 'KeyN', shift: true, mode: 'edit', action: operator('mesh.normalsRecalculate'), label: 'Recalculate normals outside' },
  {
    code: 'KeyN',
    shift: true,
    ctrl: true,
    mode: 'edit',
    action: { kind: 'operator', id: 'mesh.normalsRecalculate', params: { inside: true } },
    label: 'Recalculate normals inside',
  },
  { code: 'KeyE', shift: true, mode: 'edit', action: operator('mesh.setCrease'), label: 'Edge crease' },
  { code: 'KeyE', shift: true, ctrl: true, mode: 'edit', action: operator('mesh.setBevelWeight'), label: 'Edge bevel weight' },
  { code: 'KeyT', ctrl: true, mode: 'edit', action: operator('mesh.triangulate'), label: 'Triangulate faces' },
  { code: 'KeyJ', alt: true, mode: 'edit', action: operator('mesh.trisToQuads'), label: 'Tris to quads' },
  { code: 'KeyS', alt: true, mode: 'edit', action: operator('mesh.shrinkFatten'), label: 'Shrink or fatten' },
  { code: 'KeyS', alt: true, shift: true, mode: 'edit', action: operator('mesh.toSphere'), label: 'To sphere' },
  {
    code: 'KeyS',
    alt: true,
    shift: true,
    ctrl: true,
    mode: 'edit',
    action: operator('mesh.shear'),
    label: 'Shear',
  },
  { code: 'KeyV', ctrl: true, mode: 'edit', action: action('menu.vertex'), label: 'Vertex menu' },
  { code: 'KeyE', ctrl: true, mode: 'edit', action: action('menu.edge'), label: 'Edge menu' },
  { code: 'KeyU', mode: 'edit', action: action('menu.uv'), label: 'UV mapping menu' },
  { code: 'KeyF', ctrl: true, mode: 'edit', action: action('menu.face'), label: 'Face menu' },
  { code: 'KeyD', shift: true, mode: 'edit', action: operator('mesh.duplicate'), label: 'Duplicate' },

  /* what a transform does, in both modes */
  { code: 'KeyO', mode: 'edit', action: action('proportional.toggle'), label: 'Proportional editing' },
  { code: 'KeyO', shift: true, mode: 'edit', action: action('proportional.falloff'), label: 'Proportional falloff pie' },
  { code: 'KeyO', alt: true, mode: 'edit', action: action('proportional.connected'), label: 'Proportional, connected only' },
  { code: 'Tab', shift: true, action: action('snap.toggle'), label: 'Snapping' },
  { code: 'KeyZ', alt: true, action: action('view.xray'), label: 'X-ray' },

  /* transform */
  { code: 'KeyG', action: operator('transform.move'), label: 'Move' },
  { code: 'KeyR', action: operator('transform.rotate'), label: 'Rotate' },
  { code: 'KeyS', action: operator('transform.scale'), label: 'Scale' },

  /* the 3D cursor */
  { code: 'KeyC', shift: true, action: operator('cursor.reset'), label: 'Cursor to world origin and frame all' },
  { code: 'KeyS', shift: true, action: action('cursor.snapPie'), label: 'Snap pie' },

  /* pie menus */
  { code: 'Period', action: action('pie.pivot'), label: 'Pivot point pie' },
  { code: 'Comma', action: action('pie.orientation'), label: 'Transform orientation pie' },
  { code: 'KeyZ', action: action('pie.shading'), label: 'Shading pie' },
  { code: 'Backquote', action: action('pie.views'), label: 'View pie' },

  /* the editor itself */
  {
    code: 'F3',
    action: action('palette'),
    label: 'Command palette',
    note: 'F3 is the browser’s own find on Windows and Linux, so ⌃/ and ⌘/ open the palette as well.',
  },
  { code: 'Slash', ctrl: true, action: action('palette'), label: 'Command palette' },
  { code: 'Slash', meta: true, action: action('palette'), label: 'Command palette' },
  { code: 'F9', action: action('redoPanel'), label: 'Adjust last operation' },
  {
    code: 'F1',
    action: action('keymapSheet'),
    label: 'Keymap sheet',
    note: 'Blender’s F1 opens the manual in a browser. The editor is already in one, so F1 shows the keymap itself.',
  },
  { code: 'KeyQ', action: action('favorites'), label: 'Quick favourites' },
  {
    code: 'Comma',
    meta: true,
    action: action('preferences'),
    label: 'Preferences',
    note: 'Blender puts preferences under Edit; ⌘, is where macOS keeps them.',
  },
  { code: 'Comma', ctrl: true, action: action('preferences'), label: 'Preferences' },
  {
    code: 'Space',
    action: action('spacebar'),
    label: 'Play, tools or search',
    note: 'What it does is a preference: play the animation, open the toolbar, or open the palette.',
  },
  { code: 'KeyT', action: action('panel.toolbar'), label: 'Toolbar' },
  { code: 'KeyN', action: action('panel.sidebar'), label: 'Sidebar' },
  { code: 'KeyR', shift: true, action: action('repeatLast'), label: 'Repeat last' },
  { code: 'KeyZ', ctrl: true, action: action('undo'), label: 'Undo' },
  { code: 'KeyZ', meta: true, action: action('undo'), label: 'Undo', note: NOTE_UNDO_ON_MACOS },
  { code: 'KeyZ', shift: true, ctrl: true, action: action('redo'), label: 'Redo' },
  { code: 'KeyZ', shift: true, meta: true, action: action('redo'), label: 'Redo', note: NOTE_UNDO_ON_MACOS },
  { code: 'Escape', action: action('escape'), label: 'Cancel' },

  /* files */
  { code: 'KeyS', ctrl: true, action: action('file.save'), label: 'Save', note: NOTE_BROWSER_FILE },
  { code: 'KeyS', meta: true, action: action('file.save'), label: 'Save', note: NOTE_BROWSER_FILE },
  { code: 'KeyS', shift: true, ctrl: true, action: action('file.saveAs'), label: 'Save as', note: NOTE_BROWSER_FILE },
  { code: 'KeyS', shift: true, meta: true, action: action('file.saveAs'), label: 'Save as', note: NOTE_BROWSER_FILE },
  { code: 'KeyO', ctrl: true, action: action('file.open'), label: 'Open', note: NOTE_BROWSER_FILE },
  { code: 'KeyO', meta: true, action: action('file.open'), label: 'Open', note: NOTE_BROWSER_FILE },
  { code: 'F12', action: action('file.render'), label: 'Render image', note: 'The browser keeps F12 for its own tools on Windows and Linux; the File menu renders as well.' },
]

/* ----------------------------------------------------------- resolution */

function modifiersMatch(binding: KeyBinding, event: KeyboardEventLike): boolean {
  // Exactly, in both directions: ⇧⌃Z is redo and must never also read as undo.
  return (
    Boolean(binding.shift) === event.shiftKey &&
    Boolean(binding.ctrl) === event.ctrlKey &&
    Boolean(binding.alt) === event.altKey &&
    Boolean(binding.meta) === event.metaKey
  )
}

function appliesHere(binding: KeyBinding, context: KeyContext): boolean {
  if (binding.mode && binding.mode !== context.mode) return false
  if (binding.selectMode && !context.selectMode.includes(binding.selectMode)) return false
  if (binding.requires && !context.preferences[binding.requires]) return false
  return true
}

/**
 * How narrow a binding is. Mode weighs more than select mode because a mode is the coarser and the
 * more decisive context: ⇧D in edit mode is a different operation, not a variant of the same one.
 */
function specificity(binding: KeyBinding): number {
  return (binding.mode ? 2 : 0) + (binding.selectMode ? 1 : 0)
}

/**
 * The binding a keystroke runs, or null when the editor should let the key through.
 *
 * `bindings` defaults to the whole table. It is a parameter so that resolution can be exercised
 * against shapes this first table does not yet carry — the select-mode bindings arrive with mesh
 * editing — and so a caller can resolve against a subset without reimplementing the priorities.
 */
export function resolveKey(event: KeyboardEventLike, context: KeyContext, bindings: KeyBinding[] = KEYMAP): KeyBinding | null {
  // A field has the keyboard: only Escape is the editor's, and it gives the field its value back.
  if (context.typing && event.code !== 'Escape') return null
  const matches = bindings
    .map((binding, index) => ({ binding, index }))
    .filter(({ binding }) => binding.code === event.code && modifiersMatch(binding, event) && appliesHere(binding, context))
    .sort((a, b) => specificity(b.binding) - specificity(a.binding) || a.index - b.index)
  return matches[0]?.binding ?? null
}

/**
 * The chord that runs an action, for a menu entry or a tooltip. With a context it answers for that
 * context; without one it answers with the first chord in the table, which is the one to print.
 */
/**
 * The bindings of one action, best first, built once.
 *
 * Every menu entry and every tooltip asks for its chord as it renders, and each of those was a
 * scan of the whole table with a sort on the end — five per cent of a profile of a vertex move,
 * spent re-deriving an answer that cannot change. The table is a module constant, so the index is
 * built on the first question and answers every one after it.
 */
let byAction: Map<string, KeyBinding[]> | null = null

function bindingsOf(actionId: string): KeyBinding[] {
  if (!byAction) {
    byAction = new Map()
    const ordered = KEYMAP
      .map((binding, index) => ({ binding, index }))
      .sort((a, b) => specificity(b.binding) - specificity(a.binding) || a.index - b.index)
    for (const { binding } of ordered) {
      const found = byAction.get(binding.action.id)
      if (found) found.push(binding)
      else byAction.set(binding.action.id, [binding])
    }
  }
  return byAction.get(actionId) ?? []
}

export function bindingFor(actionId: string, context?: KeyContext): KeyBinding | null {
  for (const binding of bindingsOf(actionId)) {
    if (!context || appliesHere(binding, context)) return binding
  }
  return null
}

/* --------------------------------------------------------------- labelling */

const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Escape: 'Esc',
  Minus: '-',
  Period: '.',
  Quote: '\'',
  Semicolon: ';',
  Slash: '/',
}

const NUMPAD_LABELS: Record<string, string> = {
  Add: '+',
  Decimal: '.',
  Divide: '/',
  Multiply: '*',
  Subtract: '-',
}

function keyLabel(code: string): string {
  if (code.startsWith('Numpad')) {
    const rest = code.slice('Numpad'.length)
    return `Numpad ${NUMPAD_LABELS[rest] ?? rest}`
  }
  if (code.startsWith('Key')) return code.slice('Key'.length)
  if (code.startsWith('Digit')) return code.slice('Digit'.length)
  return KEY_LABELS[code] ?? code
}

/**
 * The chord written the way it is shown everywhere: `⇧D`, `⌃R`, `Numpad .`, `⌥⌘Z`.
 *
 * The modifiers keep Blender's order, Shift then Ctrl then Alt, with ⌘ last where Apple puts it,
 * so a Blender user reads the sheet in the order they already know.
 */
export function shortcutLabel(binding: KeyBinding): string {
  let chord = ''
  if (binding.shift) chord += '⇧'
  if (binding.ctrl) chord += '⌃'
  if (binding.alt) chord += '⌥'
  if (binding.meta) chord += '⌘'
  return chord + keyLabel(binding.code)
}

/* ------------------------------------------------------------- the sheet */

/**
 * The sections, in the order the F1 sheet and the generated page show them. A binding lands in the
 * first section one of whose prefixes its action id starts with; anything left over is the
 * editor's own, which is why that section carries no prefixes and sits second to last.
 */
const SECTIONS: Array<{ id: string; title: string; prefixes: string[] }> = [
  { id: 'view', title: 'View', prefixes: ['view.'] },
  { id: 'modes', title: 'Modes', prefixes: ['mode.'] },
  { id: 'select', title: 'Select', prefixes: ['select.', 'tool.'] },
  { id: 'object', title: 'Add and object', prefixes: ['add.', 'object.'] },
  { id: 'transform', title: 'Transform', prefixes: ['transform.'] },
  { id: 'cursor', title: '3D cursor', prefixes: ['cursor.'] },
  { id: 'pies', title: 'Pie menus', prefixes: ['pie.'] },
  { id: 'editor', title: 'Editor', prefixes: [] },
  { id: 'file', title: 'File', prefixes: ['file.'] },
]

const FALLBACK_SECTION = 'editor'

function sectionOf(actionId: string): string {
  const section = SECTIONS.find((candidate) => candidate.prefixes.some((prefix) => actionId.startsWith(prefix)))
  return section?.id ?? FALLBACK_SECTION
}

/**
 * The whole table, grouped and written out for a reader: the F1 sheet and
 * `docs/scene-editor-keymap.md` are both this function's output. Bindings a preference has turned
 * off are left out, because a sheet that lists a chord the editor will not answer to is worse than
 * a short sheet.
 */
export function describeKeymap(preferences?: Partial<ScenePreferences>): KeymapSection[] {
  const settings: ScenePreferences = { ...DEFAULT_PREFERENCES, ...preferences }
  const entries = new Map<string, KeymapEntry[]>()
  for (const binding of KEYMAP) {
    if (binding.requires && !settings[binding.requires]) continue
    const entry: KeymapEntry = {
      shortcut: shortcutLabel(binding),
      label: binding.label,
      actionId: binding.action.id,
      ...(binding.mode ? { mode: binding.mode } : {}),
      ...(binding.note ? { note: binding.note } : {}),
    }
    const section = sectionOf(binding.action.id)
    const rows = entries.get(section)
    if (rows) rows.push(entry)
    else entries.set(section, [entry])
  }
  return SECTIONS.flatMap((section) => {
    const rows = entries.get(section.id)
    return rows ? [{ id: section.id, title: section.title, entries: rows }] : []
  })
}
