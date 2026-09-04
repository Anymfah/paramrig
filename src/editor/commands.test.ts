import { describe, expect, it } from 'vitest'
import { filterCommands, withRecentCommand, type EditorCommand } from '@/editor/commands'

const command = (id: string, label: string, section = 'Object'): EditorCommand => ({ id, label, section, run: () => undefined })

describe('command palette filtering', () => {
  const commands = [
    command('front', 'Bring to front', 'Arrange'),
    command('back', 'Send to back', 'Arrange'),
    command('flip-h', 'Flip horizontal'),
    command('outline', 'Outline stroke'),
  ]

  it('keeps everything for an empty query', () => {
    expect(filterCommands(commands, '   ')).toHaveLength(4)
  })

  it('puts a name that starts with the query first', () => {
    // "Bring to front" starts with the query, "Send to back" only contains it.
    expect(filterCommands(commands, 'b').map((item) => item.id)).toEqual(['front', 'back'])
  })

  it('matches on the section and on the shortcut too', () => {
    const withKeys = [...commands, { ...command('undo', 'Undo', 'Edit'), shortcut: '⌘Z' }]

    expect(filterCommands(withKeys, 'arrange').map((item) => item.id)).toEqual(['front', 'back'])
    expect(filterCommands(withKeys, '⌘z').map((item) => item.id)).toEqual(['undo'])
  })

  it('finds nothing when nothing matches', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([])
  })

  it('takes the letters spread through a name, and puts those matches last', () => {
    const loose = [command('smooth', 'Shade smooth by angle'), command('flip', 'Flip horizontal')]
    // Neither word starts with "sml"; the letters are there in order, which is enough to find it.
    expect(filterCommands(loose, 'sml').map((item) => item.id)).toEqual(['smooth'])
    // And a name that plainly contains the query still comes first.
    expect(filterCommands([...loose, command('fh', 'Flip')], 'fli').map((item) => item.id)).toEqual(['flip', 'fh'])
  })

  it('opens on what was run last', () => {
    expect(filterCommands(commands, '', ['outline']).map((item) => item.id))
      .toEqual(['outline', 'front', 'back', 'flip-h'])
    // Within a tier, not above it: a better match still wins over a recent one.
    expect(filterCommands(commands, 'b', ['back']).map((item) => item.id)).toEqual(['front', 'back'])
  })

  it('remembers the last dozen, each named once and the newest first', () => {
    expect(withRecentCommand(['a', 'b'], 'b')).toEqual(['b', 'a'])
    expect(withRecentCommand(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
    expect(withRecentCommand(Array.from({ length: 12 }, (_, index) => `c${index}`), 'new')).toHaveLength(12)
  })
})
