import { describe, expect, it } from 'vitest'
import { filterCommands, type EditorCommand } from '@/editor/commands'

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
})
