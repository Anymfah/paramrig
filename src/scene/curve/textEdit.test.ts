import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_TEXT } from '@/scene/curve/data'
import { registerOutlineFont, resetOutlineFonts, type OutlineFont } from '@/scene/curve/font'
import { layoutText } from '@/scene/curve/text'
import {
  EMPTY_CURSOR, caretPlace, caretSegment, deleteBackwards, deleteForwards, indexAt,
  insertText, moveCaret, selectionBoxes, selectionRange,
} from '@/scene/curve/textEdit'
import type { TextData } from '@/scene/types'

let publicSans: OutlineFont

beforeAll(async () => {
  const opentype = await import('opentype.js')
  const bytes = readFileSync('public/fonts/PublicSans.ttf')
  publicSans = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as unknown as OutlineFont
  resetOutlineFonts()
  registerOutlineFont('Public Sans', publicSans)
})

function text(body: string, patch: Partial<TextData> = {}): TextData {
  return { ...DEFAULT_TEXT, body, ...patch }
}

describe('typing', () => {
  it('puts a character in at the caret', () => {
    expect(insertText('ac', { caret: 1, anchor: 1 }, 'b')).toEqual({ body: 'abc', cursor: { caret: 2, anchor: 2 } })
  })

  it('replaces the selection, whichever way round it was made', () => {
    expect(insertText('abcd', { caret: 3, anchor: 1 }, 'X').body).toBe('aXd')
    expect(insertText('abcd', { caret: 1, anchor: 3 }, 'X').body).toBe('aXd')
  })

  it('counts a character rather than a code unit, so an emoji is one step', () => {
    const typed = insertText('', EMPTY_CURSOR, '🙂')
    expect(typed.cursor.caret).toBe(1)
    expect(deleteBackwards(typed.body, typed.cursor).body).toBe('')
  })

  it('takes a pasted line break and normalises the ones a clipboard brings', () => {
    expect(insertText('', EMPTY_CURSOR, 'a\r\nb').body).toBe('a\nb')
  })

  it('stops at the ceiling rather than growing for ever', () => {
    const long = 'x'.repeat(2000)
    expect(insertText(long, { caret: 2000, anchor: 2000 }, 'more').body).toHaveLength(2000)
  })
})

describe('deleting', () => {
  it('takes the character before the caret, and nothing at the start', () => {
    expect(deleteBackwards('abc', { caret: 2, anchor: 2 }).body).toBe('ac')
    expect(deleteBackwards('abc', EMPTY_CURSOR).body).toBe('abc')
  })

  it('takes the character after the caret, and nothing at the end', () => {
    expect(deleteForwards('abc', { caret: 1, anchor: 1 }).body).toBe('ac')
    expect(deleteForwards('abc', { caret: 3, anchor: 3 }).body).toBe('abc')
  })
})

describe('the caret', () => {
  it('walks a line and stops at both ends', () => {
    expect(moveCaret('abc', { caret: 1, anchor: 1 }, 'right').caret).toBe(2)
    expect(moveCaret('abc', { caret: 0, anchor: 0 }, 'left').caret).toBe(0)
    expect(moveCaret('abc', { caret: 3, anchor: 3 }, 'right').caret).toBe(3)
  })

  it('keeps the anchor when the shift key is down, and drops it when it is not', () => {
    expect(moveCaret('abc', { caret: 1, anchor: 1 }, 'right', true)).toEqual({ caret: 2, anchor: 1 })
    expect(moveCaret('abc', { caret: 1, anchor: 0 }, 'right')).toEqual({ caret: 2, anchor: 2 })
  })

  it('walks between lines, keeping the column it can', () => {
    const body = 'abcd\nxy'
    expect(caretPlace(body, 2)).toEqual({ line: 0, column: 2 })
    expect(moveCaret(body, { caret: 2, anchor: 2 }, 'down').caret).toBe(7)
    expect(caretPlace(body, moveCaret(body, { caret: 2, anchor: 2 }, 'down').caret)).toEqual({ line: 1, column: 2 })
    // Down from a long line onto a short one lands at the end of the short one.
    expect(moveCaret(body, { caret: 4, anchor: 4 }, 'down').caret).toBe(indexAt(body, 1, 2))
  })

  it('goes to the ends of a line and of the whole body', () => {
    const body = 'abcd\nxy'
    expect(moveCaret(body, { caret: 2, anchor: 2 }, 'lineStart').caret).toBe(0)
    expect(moveCaret(body, { caret: 2, anchor: 2 }, 'lineEnd').caret).toBe(4)
    expect(moveCaret(body, { caret: 2, anchor: 2 }, 'end').caret).toBe(7)
  })

  it('reads its selection the same way round however it was dragged', () => {
    expect(selectionRange({ caret: 5, anchor: 2 })).toEqual([2, 5])
    expect(selectionRange({ caret: 2, anchor: 5 })).toEqual([2, 5])
  })
})

describe('where the caret is drawn', () => {
  it('stands at the left of the first letter, from below the baseline to above it', () => {
    const data = text('AV')
    const layout = layoutText(data, publicSans)
    const at = caretSegment(data, layout, 0)
    expect(at.x).toBe(0)
    expect(at.bottom).toBeCloseTo(-0.25, 6)
    expect(at.top).toBeCloseTo(0.75, 6)
  })

  it('moves along the line as the caret does, and drops with a line break', () => {
    const data = text('AV\nB')
    const layout = layoutText(data, publicSans)
    expect(caretSegment(data, layout, 1).x).toBeGreaterThan(0)
    expect(caretSegment(data, layout, 3).top).toBeCloseTo(0.75 - 1, 6)
  })

  it('follows the alignment, so a centred line has its caret left of the origin', () => {
    const data = text('AV', { align: 'center' })
    const layout = layoutText(data, publicSans)
    expect(caretSegment(data, layout, 0).x).toBeLessThan(0)
  })
})

describe('the selection’s boxes', () => {
  it('draws nothing when nothing is selected', () => {
    const data = text('AV')
    expect(selectionBoxes(data, layoutText(data, publicSans), { caret: 1, anchor: 1 })).toEqual([])
  })

  it('draws one box over a run inside a line', () => {
    const data = text('AVA')
    const boxes = selectionBoxes(data, layoutText(data, publicSans), { caret: 0, anchor: 2 })
    expect(boxes).toHaveLength(1)
    expect(boxes[0]!.x1).toBeGreaterThan(boxes[0]!.x0)
  })

  it('draws one box a line when the run crosses a break', () => {
    const data = text('AV\nBB')
    const boxes = selectionBoxes(data, layoutText(data, publicSans), { caret: 1, anchor: 4 })
    expect(boxes).toHaveLength(2)
    expect(boxes[1]!.top).toBeLessThan(boxes[0]!.top)
  })
})
