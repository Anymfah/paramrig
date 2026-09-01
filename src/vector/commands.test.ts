import { describe, expect, it } from 'vitest'
import { createVectorElement } from '@/vector/document'
import {
  appearanceOf,
  appearancePatch,
  filterCommands,
  matchingIds,
  nextSiblingId,
  opacityFromDigit,
  renamePreview,
  renameWithPattern,
  reorderIndex,
  SHORTCUTS,
  withShortcut,
  type VectorCommand,
} from '@/vector/commands'
import type { VectorElement } from '@/vector/types'

const command = (id: string, label: string, section = 'Object'): VectorCommand => ({ id, label, section, run: () => undefined })

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

  it('labels a control with the shortcut it triggers', () => {
    expect(withShortcut('Bring forward', 'bringForward')).toBe('Bring forward · ⌘]')
    expect(SHORTCUTS.pasteProperties).toBe('⌥⌘V')
  })
})

describe('opacity typed on the digits', () => {
  it('reads a single digit as tenths, with zero meaning full', () => {
    expect(opacityFromDigit(null, '5', 1000).opacity).toBe(0.5)
    expect(opacityFromDigit(null, '0', 1000).opacity).toBe(1)
    expect(opacityFromDigit(null, '1', 1000).opacity).toBeCloseTo(0.1)
  })

  it('takes a quick second digit as an exact value', () => {
    const first = opacityFromDigit(null, '4', 1000)

    expect(opacityFromDigit(first.buffer, '7', 1200).opacity).toBeCloseTo(0.47)
  })

  it('starts over once the pause is long enough', () => {
    const first = opacityFromDigit(null, '4', 1000)

    expect(opacityFromDigit(first.buffer, '7', 3000).opacity).toBeCloseTo(0.7)
  })

  it('starts over after two digits rather than building a third', () => {
    const first = opacityFromDigit(null, '4', 1000)
    const second = opacityFromDigit(first.buffer, '7', 1100)

    expect(opacityFromDigit(second.buffer, '2', 1200).opacity).toBeCloseTo(0.2)
  })

  it('reads a typed 00 as fully opaque', () => {
    const first = opacityFromDigit(null, '0', 1000)

    expect(opacityFromDigit(first.buffer, '0', 1100).opacity).toBe(1)
  })
})

describe('sibling walking', () => {
  const elements: VectorElement[] = [
    { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id: 'a' },
    { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id: 'b' },
    { ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id: 'c', locked: true },
  ]

  it('steps to the next sibling and wraps around', () => {
    expect(nextSiblingId(elements, 'a', null, 1)).toBe('b')
    expect(nextSiblingId(elements, 'b', null, 1)).toBe('a')
    expect(nextSiblingId(elements, 'a', null, -1)).toBe('b')
  })

  it('starts at an end when nothing is selected, and skips what cannot be picked', () => {
    expect(nextSiblingId(elements, null, null, 1)).toBe('a')
    expect(nextSiblingId(elements, null, null, -1)).toBe('b')
    expect(nextSiblingId(elements, 'c', null, 1)).toBe('a')
  })

  it('has nowhere to go in an empty parent', () => {
    expect(nextSiblingId([], null, null, 1)).toBeNull()
  })
})

describe('ordering', () => {
  const elements: VectorElement[] = ['a', 'b', 'c'].map((id) => ({ ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id }))

  it('moves one step or all the way, and says when there is nowhere to go', () => {
    expect(reorderIndex(elements, 'a', 'forward')).toBe(1)
    expect(reorderIndex(elements, 'b', 'backward')).toBe(0)
    expect(reorderIndex(elements, 'a', 'front')).toBe(3)
    expect(reorderIndex(elements, 'c', 'back')).toBe(0)
    expect(reorderIndex(elements, 'c', 'forward')).toBeNull()
    expect(reorderIndex(elements, 'a', 'backward')).toBeNull()
    expect(reorderIndex(elements, 'c', 'front')).toBeNull()
    expect(reorderIndex(elements, 'a', 'back')).toBeNull()
    expect(reorderIndex(elements, 'missing', 'front')).toBeNull()
  })
})

describe('appearance copy and paste', () => {
  const source: VectorElement = {
    ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }),
    fill: '#112233', stroke: '#445566', strokeWidth: 4, strokeCap: 'round', cornerRadius: 8, opacity: 0.5,
  }

  it('takes the look and leaves the geometry behind', () => {
    const appearance = appearanceOf(source)

    expect(appearance).toMatchObject({ fill: '#112233', stroke: '#445566', strokeWidth: 4, strokeCap: 'round', cornerRadius: 8, opacity: 0.5 })
    expect(appearance).not.toHaveProperty('x')
    expect(appearance).not.toHaveProperty('width')
    expect(appearance).not.toHaveProperty('name')
  })

  it('clears on the target whatever the source did not carry', () => {
    const patch = appearancePatch(appearanceOf({ ...source, strokeCap: undefined, cornerRadius: undefined }))

    expect(patch.strokeCap).toBeUndefined()
    expect('strokeCap' in patch).toBe(true)
    expect('cornerRadius' in patch).toBe(true)
  })

  it('copies deeply, so editing the source later does not reach the copy', () => {
    const withFills: VectorElement = { ...source, fills: [{ id: 'p', type: 'solid', color: '#FF0000', opacity: 1, visible: true }] }
    const appearance = appearanceOf(withFills)

    withFills.fills![0]!.color = '#00FF00'

    expect(appearance.fills![0]!.color).toBe('#FF0000')
  })
})

describe('select all with the same paint', () => {
  const base = createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 })
  const elements: VectorElement[] = [
    { ...base, id: 'a', fill: '#111111', stroke: '#222222', strokeWidth: 2 },
    { ...base, id: 'b', fill: '#111111', stroke: '#333333', strokeWidth: 4 },
    { ...base, id: 'c', fill: '#999999', stroke: '#222222', strokeWidth: 2 },
    { ...base, id: 'hidden', fill: '#111111', visible: false },
    { ...base, id: 'locked', fill: '#111111', locked: true },
  ]

  it('matches on fill, stroke or width, ignoring hidden and locked objects', () => {
    expect(matchingIds(elements, elements[0]!, 'fill')).toEqual(['a', 'b'])
    expect(matchingIds(elements, elements[0]!, 'stroke')).toEqual(['a', 'c'])
    expect(matchingIds(elements, elements[0]!, 'strokeWidth')).toEqual(['a', 'c'])
  })

  it('tells a plain fill from a layered one', () => {
    const layered: VectorElement = { ...base, id: 'layered', fill: '#111111', fills: [{ id: 'p', type: 'solid', color: '#111111', opacity: 0.5, visible: true }] }

    expect(matchingIds([...elements, layered], elements[0]!, 'fill')).toEqual(['a', 'b'])
  })
})

describe('batch rename', () => {
  const elements = [{ name: 'Card', kind: 'rectangle' as const }, { name: 'Label', kind: 'text' as const }]

  it('fills the position, the old name and the kind into the pattern', () => {
    expect(renameWithPattern('Slide $n', elements[0]!, 3)).toBe('Slide 3')
    expect(renameWithPattern('$name copy', elements[0]!, 1)).toBe('Card copy')
    expect(renameWithPattern('$kind $n', elements[1]!, 2)).toBe('text 2')
  })

  it('leaves names alone when the pattern is empty', () => {
    expect(renameWithPattern('   ', elements[0]!, 1)).toBe('Card')
  })

  it('previews the whole run in order', () => {
    expect(renamePreview('Item $n', elements)).toEqual(['Item 1', 'Item 2'])
    expect(renamePreview('Item $n', elements, 10)).toEqual(['Item 10', 'Item 11'])
  })
})
