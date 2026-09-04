import type { EditorCommand } from '@/editor/commands'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import { getOperator, listOperators } from '@/scene/operators/registry'
import type { Operator, OperatorContext, OperatorParams } from '@/scene/operators/types'

/**
 * What the command palette lists and what the menus draw, derived rather than typed out again.
 *
 * Two tables answer for everything a person can reach: the operator registry says what the editor
 * can do, and the keymap says which chord runs it. An operator that is registered is therefore in
 * the palette the moment it exists, and no tooltip can promise a key the keymap does not answer
 * to, because neither the list nor the chord is written by hand a second time.
 *
 * The operator families register themselves as a side effect of importing `@/scene/operators`,
 * which the editor page does once. This module reads whatever the registry holds by then, so it
 * stays a pure function of the registry, the keymap and the context it is handed.
 */

export type SceneCommand = EditorCommand & {
  /** The operator this runs, when it is one; editor actions have none. */
  operatorId?: string
}

/** A rule between two groups of menu entries. It carries nothing: it is a rule. */
export type MenuSeparator = { separator: true }

export type MenuEntry = SceneCommand | MenuSeparator

/**
 * The chord a command shows, from the keymap and from nowhere else.
 *
 * An operator also declares a `shortcut` of its own for the generated documentation, and the two
 * are deliberately not merged here: the moment a command may take a chord the keymap has not bound,
 * a menu starts advertising a key that does nothing. A command with no binding simply shows none.
 */
function shortcutFor(actionId: string): string | undefined {
  const binding = bindingFor(actionId)
  return binding ? shortcutLabel(binding) : undefined
}

function operatorCommand(operator: Operator<OperatorParams>, context: OperatorContext | null, run: (id: string) => void): SceneCommand {
  // No context is the state before a document is open. Everything stays enabled, because a palette
  // that looks empty reads as an editor that cannot do anything, rather than one with nothing open.
  const availability = context ? operator.available(context) : true
  const shortcut = shortcutFor(operator.id)
  return {
    id: operator.id,
    label: operator.label,
    section: operator.section,
    operatorId: operator.id,
    ...(shortcut ? { shortcut } : {}),
    // The sentence the operator refused with is the tooltip of the greyed-out entry, so a person
    // reads why rather than guessing at it.
    ...(availability === true ? {} : { disabled: true, reason: availability }),
    run: () => run(operator.id),
  }
}

/**
 * Every registered operator as a command, followed by the editor's own actions.
 *
 * The registry's order is registration order, which keeps a family together; the editor's actions
 * come after so that a query matching both offers the document's operator first.
 */
export function sceneCommands(options: {
  context: OperatorContext | null
  /** Runs an operator by id; the page's own `runOperator`. */
  runOperator: (id: string) => void
  /** The editor actions that are not operators, already bound. */
  actions?: SceneCommand[]
}): SceneCommand[] {
  const { context, runOperator, actions = [] } = options
  return [...listOperators().map((operator) => operatorCommand(operator, context, runOperator)), ...actions]
}

/**
 * The editor's own commands: the id the keymap binds, what the command is called, and the section
 * it sits under. Grouped the way the palette shows them rather than the way the keymap lists them,
 * because the palette is read down a section at a time.
 */
const EDITOR_ACTIONS: Array<{ id: string; label: string; section: string }> = [
  { id: 'undo', label: 'Undo', section: 'Edit' },
  { id: 'redo', label: 'Redo', section: 'Edit' },
  { id: 'repeatLast', label: 'Repeat last', section: 'Edit' },
  { id: 'redoPanel', label: 'Adjust last operation', section: 'Edit' },
  { id: 'palette', label: 'Command palette', section: 'View' },
  { id: 'favorites', label: 'Quick favourites', section: 'View' },
  { id: 'preferences', label: 'Preferences', section: 'Edit' },
  { id: 'keymapSheet', label: 'Keymap sheet', section: 'View' },
  { id: 'panel.toolbar', label: 'Toolbar', section: 'View' },
  { id: 'panel.sidebar', label: 'Sidebar', section: 'View' },
  { id: 'panel.uv', label: 'UV editor', section: 'View' },
  { id: 'panel.shader', label: 'Shader editor', section: 'View' },
  { id: 'anim.keyframe', label: 'Insert keyframe', section: 'Animation' },
  { id: 'anim.play', label: 'Play or pause', section: 'Animation' },
  { id: 'file.save', label: 'Save', section: 'File' },
  { id: 'file.saveAs', label: 'Save as', section: 'File' },
  { id: 'file.open', label: 'Open', section: 'File' },
  { id: 'mode.toggleEdit', label: 'Toggle edit mode', section: 'Mode' },
]

/** The commands that are the editor rather than the document: undo, the panels, the palette. */
export function editorCommands(handlers: Record<string, () => void>): SceneCommand[] {
  return EDITOR_ACTIONS.flatMap((entry) => {
    const handler = handlers[entry.id]
    // A page that cannot open a file does not offer Open. An entry with nothing behind it is worse
    // than a missing one: it looks available and then does nothing when it is chosen.
    if (!handler) return []
    const shortcut = shortcutFor(entry.id)
    return [{ id: entry.id, label: entry.label, section: entry.section, ...(shortcut ? { shortcut } : {}), run: handler }]
  })
}

function isSeparator(entry: MenuEntry | undefined): boolean {
  return entry !== undefined && 'separator' in entry
}

/** Menu entries for a header menu, from a list of operator ids. Missing ids are skipped. */
export function menuEntries(ids: Array<string | '-'>, context: OperatorContext | null,
  run: (id: string) => void): MenuEntry[] {
  const entries: MenuEntry[] = []
  for (const id of ids) {
    if (id === '-') {
      // A rule earns its place only between two entries, so it waits until one follows it. This is
      // what keeps a menu tidy when a whole group is missing from the build.
      if (entries.length > 0 && !isSeparator(entries.at(-1))) entries.push({ separator: true })
      continue
    }
    const operator = getOperator(id)
    // A menu is written by hand and the registry is not, so the two can disagree. An id no family
    // registered is left out rather than drawn as an entry that would refuse.
    if (!operator) continue
    entries.push(operatorCommand(operator, context, run))
  }
  // The last group may have been skipped entirely, leaving a rule at the end with nothing under it.
  while (isSeparator(entries.at(-1))) entries.pop()
  return entries
}
