import { describe, expect, it } from 'vitest'
import {
  KEYMAP,
  bindingFor,
  describeKeymap,
  resolveKey,
  shortcutLabel,
  type KeyBinding,
  type KeyContext,
  type KeyboardEventLike,
} from '@/scene/keymap'
import { DEFAULT_PREFERENCES, type ScenePreferences } from '@/scene/prefs'

type Chord = Partial<Pick<KeyboardEventLike, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>>

function press(code: string, chord: Chord = {}): KeyboardEventLike {
  return { code, key: '', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...chord }
}

function context(overrides: Partial<KeyContext> = {}): KeyContext {
  return { mode: 'object', selectMode: ['vertex'], preferences: DEFAULT_PREFERENCES, typing: false, ...overrides }
}

function preferences(overrides: Partial<ScenePreferences>): ScenePreferences {
  return { ...DEFAULT_PREFERENCES, ...overrides }
}

function actionId(binding: KeyBinding | null): string | null {
  return binding ? binding.action.id : null
}

describe('resolving a keystroke', () => {
  it('reads the physical key, so a French top row still reaches the axis views', () => {
    // On AZERTY the digit row prints & é " ' and still reports Digit1…Digit4.
    expect(actionId(resolveKey(press('Digit1', { key: '&', altKey: true }), context()))).toBe('view.front')
    expect(actionId(resolveKey(press('Digit3', { key: '"', altKey: true }), context()))).toBe('view.right')
    expect(actionId(resolveKey(press('Digit7', { key: 'è', altKey: true }), context()))).toBe('view.top')
  })

  it('ignores the letter the layout prints on a key', () => {
    // The key at QWERTY's A prints "q" on AZERTY; it still selects all.
    expect(actionId(resolveKey(press('KeyA', { key: 'q' }), context()))).toBe('select.all')
    expect(actionId(resolveKey(press('KeyZ', { key: 'w' }), context()))).toBe('pie.shading')
  })

  it('wants every modifier to match, so ⇧⌃Z never reads as undo', () => {
    expect(actionId(resolveKey(press('KeyZ', { ctrlKey: true }), context()))).toBe('undo')
    expect(actionId(resolveKey(press('KeyZ', { shiftKey: true, ctrlKey: true }), context()))).toBe('redo')
    expect(actionId(resolveKey(press('KeyZ', { metaKey: true }), context()))).toBe('undo')
    expect(actionId(resolveKey(press('KeyZ', { shiftKey: true, metaKey: true }), context()))).toBe('redo')
    expect(resolveKey(press('KeyZ', { ctrlKey: true, altKey: true }), context())).toBeNull()
    expect(resolveKey(press('KeyZ', { ctrlKey: true, metaKey: true }), context())).toBeNull()
  })

  it('answers nothing for a chord the table does not carry', () => {
    expect(resolveKey(press('KeyQ'), context())).toBeNull()
    expect(resolveKey(press('F12'), context())).toBeNull()
  })

  it('separates the two dots: one frames the selection, the other opens the pivot pie', () => {
    expect(actionId(resolveKey(press('NumpadDecimal'), context()))).toBe('view.frameSelected')
    expect(actionId(resolveKey(press('Period'), context()))).toBe('pie.pivot')
  })
})

describe('the mode a binding belongs to', () => {
  // Bindings written to exercise the priorities on shapes the first table does not yet carry.
  const table: KeyBinding[] = [
    { code: 'KeyH', action: { kind: 'action', id: 'anywhere' }, label: 'Anywhere' },
    { code: 'KeyH', mode: 'edit', action: { kind: 'action', id: 'in-edit' }, label: 'In edit mode' },
    { code: 'KeyJ', action: { kind: 'action', id: 'always' }, label: 'Always' },
    { code: 'KeyJ', selectMode: 'edge', action: { kind: 'action', id: 'on-edges' }, label: 'On edges' },
    { code: 'KeyK', action: { kind: 'action', id: 'first' }, label: 'First' },
    { code: 'KeyK', action: { kind: 'action', id: 'second' }, label: 'Second' },
  ]

  it('prefers the binding written for the current mode over the one written for all of them', () => {
    expect(actionId(resolveKey(press('KeyH'), context({ mode: 'edit' }), table))).toBe('in-edit')
    expect(actionId(resolveKey(press('KeyH'), context({ mode: 'object' }), table))).toBe('anywhere')
  })

  it('prefers a binding narrowed to a select mode over one that is not', () => {
    expect(actionId(resolveKey(press('KeyJ'), context({ selectMode: ['edge'] }), table))).toBe('on-edges')
    expect(actionId(resolveKey(press('KeyJ'), context({ selectMode: ['vertex'] }), table))).toBe('always')
    // Several kinds can be selected at once, and the narrow binding still wins.
    expect(actionId(resolveKey(press('KeyJ'), context({ selectMode: ['vertex', 'edge'] }), table))).toBe('on-edges')
  })

  it('keeps the earlier entry when two bindings are equally specific', () => {
    expect(actionId(resolveKey(press('KeyK'), context(), table))).toBe('first')
  })

  it('gives one chord two meanings, one per mode', () => {
    // ⇧D duplicates an object in object mode and the selected geometry in edit mode: the same
    // habit, the right verb, which is exactly what scoping a binding to a mode is for.
    expect(actionId(resolveKey(press('KeyD', { shiftKey: true }), context({ mode: 'object' })))).toBe('object.duplicate')
    expect(actionId(resolveKey(press('KeyD', { shiftKey: true }), context({ mode: 'edit' })))).toBe('mesh.duplicate')
    expect(actionId(resolveKey(press('KeyX'), context({ mode: 'object' })))).toBe('object.deleteConfirm')
    expect(actionId(resolveKey(press('KeyX'), context({ mode: 'edit' })))).toBe('menu.delete')
    expect(resolveKey(press('KeyX'), context({ mode: 'sculpt' }))).toBeNull()
  })

  it('answers in every mode for a binding that names none', () => {
    for (const mode of ['object', 'edit', 'sculpt'] as const) {
      expect(actionId(resolveKey(press('KeyG'), context({ mode })))).toBe('transform.move')
      expect(actionId(resolveKey(press('Tab'), context({ mode })))).toBe('mode.toggleEdit')
    }
  })
})

describe('a field with the keyboard', () => {
  it('gives it every key, so a name can contain a g and an undo is the field’s own', () => {
    expect(resolveKey(press('KeyG'), context({ typing: true }))).toBeNull()
    expect(resolveKey(press('KeyZ', { ctrlKey: true }), context({ typing: true }))).toBeNull()
    expect(resolveKey(press('Tab'), context({ typing: true }))).toBeNull()
    expect(resolveKey(press('Delete'), context({ typing: true }))).toBeNull()
  })

  it('keeps Escape, which is what puts the value back', () => {
    expect(actionId(resolveKey(press('Escape'), context({ typing: true })))).toBe('escape')
  })
})

describe('the numeric keypad and its emulation', () => {
  it('reads a real keypad whether or not the emulation is on', () => {
    for (const numpadEmulation of [true, false]) {
      const here = context({ preferences: preferences({ numpadEmulation }) })
      expect(actionId(resolveKey(press('Numpad1'), here))).toBe('view.front')
      expect(actionId(resolveKey(press('Numpad1', { ctrlKey: true }), here))).toBe('view.back')
      expect(actionId(resolveKey(press('NumpadDivide'), here))).toBe('view.local')
    }
  })

  it('puts the axis views on the top row when the emulation is on', () => {
    const here = context({ preferences: preferences({ numpadEmulation: true }) })
    expect(actionId(resolveKey(press('Digit1', { altKey: true }), here))).toBe('view.front')
    expect(actionId(resolveKey(press('Digit1', { ctrlKey: true, altKey: true }), here))).toBe('view.back')
    expect(actionId(resolveKey(press('Digit5', { altKey: true }), here))).toBe('view.togglePerspective')
    expect(actionId(resolveKey(press('Digit0', { altKey: true }), here))).toBe('view.camera')
    expect(actionId(resolveKey(press('Period', { altKey: true }), here))).toBe('view.frameSelected')
  })

  it('leaves the top row alone when the emulation is off', () => {
    const here = context({ preferences: preferences({ numpadEmulation: false }) })
    expect(resolveKey(press('Digit1', { altKey: true }), here)).toBeNull()
    expect(resolveKey(press('Digit7', { ctrlKey: true, altKey: true }), here)).toBeNull()
    expect(resolveKey(press('Period', { altKey: true }), here)).toBeNull()
    // The pivot pie is on the same key and is not part of the emulation.
    expect(actionId(resolveKey(press('Period'), here))).toBe('pie.pivot')
  })
})

describe('the chords the browser owns', () => {
  it('never binds one that would close, open or replace the tab', () => {
    const forbidden: Array<Pick<KeyBinding, 'code' | 'ctrl' | 'meta'>> = [
      { code: 'KeyW', meta: true },
      { code: 'KeyT', meta: true },
      { code: 'KeyN', meta: true },
      { code: 'KeyQ', meta: true },
      { code: 'KeyW', ctrl: true },
    ]
    const bound = KEYMAP.filter((binding) =>
      forbidden.some(
        (chord) => binding.code === chord.code && Boolean(binding.ctrl) === Boolean(chord.ctrl) && Boolean(binding.meta) === Boolean(chord.meta),
      ),
    )
    expect(bound.map(shortcutLabel)).toEqual([])
  })

  it('gives every chord one meaning', () => {
    const seen = new Map<string, string>()
    for (const binding of KEYMAP) {
      const scope = `${shortcutLabel(binding)} ${binding.mode ?? 'any mode'} ${binding.selectMode ?? 'any element'}`
      expect(seen.get(scope)).toBeUndefined()
      seen.set(scope, binding.action.id)
    }
  })
})

describe('writing a chord down', () => {
  it('reads the way Blender writes it, with ⌘ last', () => {
    expect(shortcutLabel({ code: 'KeyD', shift: true, action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('⇧D')
    expect(shortcutLabel({ code: 'KeyR', ctrl: true, action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('⌃R')
    expect(shortcutLabel({ code: 'KeyZ', shift: true, ctrl: true, action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('⇧⌃Z')
    expect(shortcutLabel({ code: 'KeyZ', alt: true, meta: true, action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('⌥⌘Z')
  })

  it('names the keypad and the keys that have no letter', () => {
    expect(shortcutLabel({ code: 'NumpadDecimal', action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('Numpad .')
    expect(shortcutLabel({ code: 'NumpadDivide', action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('Numpad /')
    expect(shortcutLabel({ code: 'Numpad1', ctrl: true, action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('⌃Numpad 1')
    expect(shortcutLabel({ code: 'Digit1', alt: true, action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('⌥1')
    expect(shortcutLabel({ code: 'Escape', action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('Esc')
    expect(shortcutLabel({ code: 'Comma', action: { kind: 'action', id: 'x' }, label: 'x' })).toBe(',')
    expect(shortcutLabel({ code: 'F9', action: { kind: 'action', id: 'x' }, label: 'x' })).toBe('F9')
  })
})

describe('the keymap sheet', () => {
  it('groups the whole table under titles a reader can scan', () => {
    const sections = describeKeymap()

    expect(sections.map((section) => section.title)).toEqual([
      'View',
      'Modes',
      'Select',
      'Add and object',
      'Transform',
      '3D cursor',
      'Pie menus',
      'Editor',
      'File',
    ])
    expect(sections.every((section) => section.entries.length > 0)).toBe(true)
    const rows = sections.flatMap((section) => section.entries)
    expect(rows).toHaveLength(KEYMAP.length)
    expect(rows.every((row) => row.shortcut.length > 0 && row.label.length > 0)).toBe(true)
  })

  it('puts each binding where a reader would look for it', () => {
    const sections = new Map(describeKeymap().map((section) => [section.id, section.entries]))

    expect(sections.get('view')?.[0]).toMatchObject({ shortcut: 'Numpad .', label: 'Frame selected', actionId: 'view.frameSelected' })
    expect(sections.get('select')?.map((entry) => entry.actionId)).toContain('tool.cycleSelect')
    expect(sections.get('object')?.map((entry) => entry.actionId)).toContain('add.menu')
    expect(sections.get('editor')?.map((entry) => entry.actionId)).toEqual(
      expect.arrayContaining(['palette', 'redoPanel', 'keymapSheet', 'panel.toolbar', 'panel.sidebar', 'repeatLast', 'undo', 'redo', 'escape']),
    )
    expect(sections.get('file')?.map((entry) => entry.actionId)).toEqual([
      'file.save',
      'file.save',
      'file.saveAs',
      'file.saveAs',
      'file.open',
      'file.open',
    ])
  })

  it('says which mode a binding belongs to, and nothing when it belongs to all', () => {
    const rows = describeKeymap().flatMap((section) => section.entries)

    expect(rows.find((row) => row.actionId === 'object.duplicate')?.mode).toBe('object')
    expect(rows.find((row) => row.actionId === 'transform.move')?.mode).toBeUndefined()
  })

  it('carries the reason for every departure from Blender', () => {
    const rows = describeKeymap().flatMap((section) => section.entries)
    const noteFor = (shortcut: string) => rows.find((row) => row.shortcut === shortcut)?.note

    expect(noteFor('⌘Z')).toContain('macOS')
    expect(noteFor('⇧⌘Z')).toContain('macOS')
    expect(noteFor('F1')).toContain('manual')
    expect(noteFor('F3')).toContain('find')
    expect(noteFor('⌥1')).toContain('Emulate Numpad')
    expect(noteFor('⌃⌥1')).toContain('AltGr')
    expect(noteFor('⌃S')).toContain('browser')
    expect(noteFor('⌃P')).toContain('prints')
    expect(noteFor('⌃Tab')).toContain('browsers')
    // The plain chords Blender itself uses need no explaining.
    expect(noteFor('G')).toBeUndefined()
    expect(noteFor('⇧D')).toBeUndefined()
  })

  it('drops the emulation rows when the preference is off', () => {
    const on = describeKeymap({ numpadEmulation: true }).flatMap((section) => section.entries)
    const off = describeKeymap({ numpadEmulation: false }).flatMap((section) => section.entries)

    expect(on.map((entry) => entry.shortcut)).toContain('⌥1')
    expect(off.map((entry) => entry.shortcut)).not.toContain('⌥1')
    expect(off.map((entry) => entry.shortcut)).toContain('Numpad 1')
    expect(off).toHaveLength(on.length - 10)
  })
})

describe('finding the chord an action answers to', () => {
  it('gives a menu the chord to print beside its entry', () => {
    expect(shortcutLabel(bindingFor('object.duplicate')!)).toBe('⇧D')
    expect(shortcutLabel(bindingFor('select.none')!)).toBe('⌥A')
    expect(shortcutLabel(bindingFor('file.save')!)).toBe('⌃S')
  })

  it('prints the numeric keypad rather than its emulation', () => {
    expect(shortcutLabel(bindingFor('view.front')!)).toBe('Numpad 1')
    expect(shortcutLabel(bindingFor('view.frameSelected')!)).toBe('Numpad .')
  })

  it('answers for the context when one is given', () => {
    expect(bindingFor('object.duplicate', context({ mode: 'object' }))).not.toBeNull()
    expect(bindingFor('object.duplicate', context({ mode: 'edit' }))).toBeNull()
    expect(bindingFor('view.front', context({ preferences: preferences({ numpadEmulation: false }) }))?.code).toBe('Numpad1')
  })

  it('answers nothing for an action no key runs', () => {
    expect(bindingFor('object.shadeSmooth')).toBeNull()
  })
})
