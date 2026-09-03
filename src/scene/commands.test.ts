import { beforeEach, describe, expect, it, vi } from 'vitest'
import { filterCommands } from '@/editor/commands'
import { editorCommands, menuEntries, sceneCommands, type MenuEntry, type SceneCommand } from '@/scene/commands'
import { createSceneDocument } from '@/scene/document'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import { registerOperator, resetOperators } from '@/scene/operators/registry'
import type { OperatorContext } from '@/scene/operators/types'
import { EMPTY_SELECTION, type SceneSelection } from '@/scene/types'

/**
 * The registry is emptied and refilled before each test rather than the real families being
 * imported, so that these expectations describe what `sceneCommands` does and do not move every
 * time an operator family lands. The ids are real ones the keymap already binds, because the chord
 * a command shows is exactly what is under test.
 */
function registerFixtures(): void {
  registerOperator({
    id: 'select.all', label: 'All', section: 'Select', params: [], defaults: {},
    available: () => true,
    run: () => ({}),
  })
  registerOperator({
    id: 'select.none', label: 'None', section: 'Select', params: [], defaults: {},
    available: (context) => (context.selection.objectIds.length > 0 ? true : 'Nothing is selected.'),
    run: () => ({}),
  })
  registerOperator({
    id: 'select.invert', label: 'Invert', section: 'Select', params: [], defaults: {},
    available: () => true,
    run: () => ({}),
  })
  registerOperator({
    id: 'object.duplicate', label: 'Duplicate', section: 'Object', params: [], defaults: {},
    available: (context) => (context.selection.objectIds.length > 0 ? true : 'Select an object to duplicate.'),
    run: () => ({}),
  })
  registerOperator({
    id: 'object.join', label: 'Join', section: 'Object', params: [], defaults: {},
    available: () => true,
    run: () => ({}),
  })
  // Nothing in the keymap runs a bevel, which is what makes it the case for a command with no chord.
  registerOperator({
    id: 'mesh.bevel', label: 'Bevel', section: 'Mesh', params: [], defaults: {},
    available: () => true,
    run: () => ({}),
  })
}

beforeEach(() => {
  resetOperators()
  registerFixtures()
})

function context(selection: Partial<SceneSelection> = {}): OperatorContext {
  const document = createSceneDocument()
  return {
    document,
    selection: { ...EMPTY_SELECTION, ...selection },
    mode: document.view.mode,
    view: document.view,
    cursor: document.cursor,
    active: null,
  }
}

function commandsFor(operatorContext: OperatorContext | null, actions?: SceneCommand[]): SceneCommand[] {
  return sceneCommands({ context: operatorContext, runOperator: () => undefined, ...(actions ? { actions } : {}) })
}

function byId(commands: SceneCommand[], id: string): SceneCommand {
  const command = commands.find((candidate) => candidate.id === id)
  if (!command) throw new Error(`No command was built for “${id}”.`)
  return command
}

function ids(entries: MenuEntry[]): string[] {
  return entries.map((entry) => ('separator' in entry ? '-' : entry.id))
}

describe('the commands built from the registry', () => {
  it('offers one command per registered operator, carrying its label and its section', () => {
    const commands = commandsFor(null)

    expect(commands.map((command) => command.id)).toEqual([
      'select.all', 'select.none', 'select.invert', 'object.duplicate', 'object.join', 'mesh.bevel',
    ])
    expect(byId(commands, 'object.duplicate')).toMatchObject({ label: 'Duplicate', section: 'Object', operatorId: 'object.duplicate' })
  })

  it('greys out an operator that refuses, and shows the sentence it refused with', () => {
    const commands = commandsFor(context())

    expect(byId(commands, 'select.none')).toMatchObject({ disabled: true, reason: 'Nothing is selected.' })
    expect(byId(commands, 'object.duplicate')).toMatchObject({ disabled: true, reason: 'Select an object to duplicate.' })
    expect(byId(commands, 'select.all').disabled).toBeUndefined()
    expect(byId(commands, 'select.all').reason).toBeUndefined()
  })

  it('stops refusing once the operator is happy', () => {
    const commands = commandsFor(context({ objectIds: ['object-1'], activeObjectId: 'object-1' }))

    expect(byId(commands, 'select.none').disabled).toBeUndefined()
    expect(byId(commands, 'object.duplicate').disabled).toBeUndefined()
  })

  it('leaves everything enabled before a document is open, so the palette still lists what exists', () => {
    const commands = commandsFor(null)

    expect(commands).toHaveLength(6)
    expect(commands.every((command) => command.disabled === undefined && command.reason === undefined)).toBe(true)
  })

  it('takes the chord from the keymap rather than from the operator', () => {
    const commands = commandsFor(null)

    expect(byId(commands, 'select.all').shortcut).toBe('A')
    expect(byId(commands, 'select.none').shortcut).toBe('⌥A')
    expect(byId(commands, 'select.invert').shortcut).toBe('⌃I')
    expect(byId(commands, 'object.duplicate').shortcut).toBe('⇧D')
    expect(byId(commands, 'object.join').shortcut).toBe('⌃J')
  })

  it('shows no chord for an operator the keymap does not bind', () => {
    expect(bindingFor('mesh.bevel')).toBeNull()
    expect(byId(commandsFor(null), 'mesh.bevel').shortcut).toBeUndefined()
  })

  it('agrees with the keymap about every chord it shows', () => {
    for (const command of commandsFor(null)) {
      const binding = bindingFor(command.id)
      expect(command.shortcut).toBe(binding ? shortcutLabel(binding) : undefined)
    }
  })

  it('runs the operator it was built from, by id', () => {
    const runOperator = vi.fn()
    const commands = sceneCommands({ context: context(), runOperator })

    byId(commands, 'object.join').run()

    expect(runOperator).toHaveBeenCalledWith('object.join')
  })

  it('puts the editor’s own actions after the operators', () => {
    const commands = commandsFor(null, editorCommands({ undo: () => undefined }))

    expect(commands).toHaveLength(7)
    expect(commands.at(-1)).toMatchObject({ id: 'undo', section: 'Edit' })
    expect(commands.at(-1)?.operatorId).toBeUndefined()
  })
})

describe('the editor’s own commands', () => {
  const ALL_ACTIONS = [
    'undo', 'redo', 'repeatLast', 'redoPanel', 'palette', 'keymapSheet',
    'panel.toolbar', 'panel.sidebar', 'file.save', 'file.saveAs', 'file.open', 'mode.toggleEdit',
  ]

  function everyHandler(): Record<string, () => void> {
    return Object.fromEntries(ALL_ACTIONS.map((id) => [id, () => undefined]))
  }

  it('covers the editor, the panels, the files and the modes, each in its section', () => {
    const commands = editorCommands(everyHandler())

    expect(commands.map((command) => command.id)).toEqual(ALL_ACTIONS)
    expect(commands.map((command) => command.section)).toEqual([
      'Edit', 'Edit', 'Edit', 'Edit', 'View', 'View', 'View', 'View', 'File', 'File', 'File', 'Mode',
    ])
  })

  it('spells its chords the way the keymap does', () => {
    const commands = editorCommands(everyHandler())
    const shortcuts = Object.fromEntries(commands.map((command) => [command.id, command.shortcut]))

    expect(shortcuts).toEqual({
      undo: '⌃Z',
      redo: '⇧⌃Z',
      repeatLast: '⇧R',
      redoPanel: 'F9',
      palette: 'F3',
      keymapSheet: 'F1',
      'panel.toolbar': 'T',
      'panel.sidebar': 'N',
      'file.save': '⌃S',
      'file.saveAs': '⇧⌃S',
      'file.open': '⌃O',
      'mode.toggleEdit': 'Tab',
    })
  })

  it('calls a command the same thing the keymap calls it', () => {
    for (const command of editorCommands(everyHandler())) {
      expect(command.label).toBe(bindingFor(command.id)?.label)
    }
  })

  it('offers only the commands a handler was given', () => {
    const commands = editorCommands({ undo: () => undefined, 'file.save': () => undefined })

    expect(commands.map((command) => command.id)).toEqual(['undo', 'file.save'])
  })

  it('runs the handler it was given', () => {
    const save = vi.fn()

    byId(editorCommands({ 'file.save': save }), 'file.save').run()

    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('filtering the list for the palette', () => {
  it('ranks a name that starts with the query above one that only contains it', () => {
    const commands = filterCommands(commandsFor(null), 'n')

    expect(commands.map((command) => command.id)).toEqual(['select.none', 'select.invert', 'object.join'])
  })

  it('ranks a match on the name above a match on the section', () => {
    const commands = filterCommands(commandsFor(null), 'o')

    expect(commands.map((command) => command.id)).toEqual(['select.none', 'object.join', 'object.duplicate'])
  })

  it('finds a whole family by its section', () => {
    const commands = filterCommands(commandsFor(null), 'select')

    expect(commands.map((command) => command.id)).toEqual(['select.all', 'select.none', 'select.invert'])
  })

  it('finds a command by the chord it shows', () => {
    const commands = filterCommands(commandsFor(null), '⌥a')

    expect(commands.map((command) => command.id)).toEqual(['select.none'])
  })

  it('finds the editor’s commands alongside the operators', () => {
    const commands = filterCommands(commandsFor(null, editorCommands({ undo: () => undefined })), 'undo')

    expect(commands.map((command) => command.id)).toEqual(['undo'])
  })
})

describe('the entries of a header menu', () => {
  const run = () => undefined

  it('skips an id nothing is registered under', () => {
    const entries = menuEntries(['select.all', 'object.smoothShade', 'select.none'], null, run)

    expect(ids(entries)).toEqual(['select.all', 'select.none'])
  })

  it('greys an entry and carries its chord, the way the palette does', () => {
    const entries = menuEntries(['select.none'], context(), run)

    expect(entries[0]).toMatchObject({ label: 'None', shortcut: '⌥A', disabled: true, reason: 'Nothing is selected.' })
  })

  it('never draws two rules in a row, nor one at either end', () => {
    const entries = menuEntries(['-', 'select.all', '-', '-', 'select.none', '-'], null, run)

    expect(ids(entries)).toEqual(['select.all', '-', 'select.none'])
  })

  it('drops the rule around a group that is not in this build', () => {
    expect(ids(menuEntries(['select.all', '-', 'mesh.inset'], null, run))).toEqual(['select.all'])
    expect(ids(menuEntries(['mesh.inset', '-', 'select.all'], null, run))).toEqual(['select.all'])
    expect(ids(menuEntries(['select.all', '-', 'mesh.inset', '-', 'select.none'], null, run))).toEqual(['select.all', '-', 'select.none'])
  })

  it('comes back empty when none of the ids are registered', () => {
    expect(menuEntries(['mesh.inset', '-', 'mesh.bridge'], null, run)).toEqual([])
  })

  it('runs the operator the entry was built from', () => {
    const runOperator = vi.fn()
    const entries = menuEntries(['select.all'], null, runOperator)
    const entry = entries[0]

    if (!entry || 'separator' in entry) throw new Error('The first entry should be a command.')
    entry.run()

    expect(runOperator).toHaveBeenCalledWith('select.all')
  })
})
