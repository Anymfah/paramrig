import { alignShift, lineHeightOf, textLines, type TextLayout } from '@/scene/curve/text'
import { MAX_TEXT_LENGTH } from '@/scene/curve/data'
import type { TextData } from '@/scene/types'

/**
 * Typing into a text object.
 *
 * Blender lets you edit the words in the viewport rather than in a field: Tab into a text object and
 * the keyboard writes into it, with a caret you can walk and a selection you can replace. All of
 * that is arithmetic on a string and an index, so it lives here, apart from the page that listens
 * for the keys and apart from the geometry that draws the letters.
 *
 * Indices count *characters*, not UTF-16 units: an emoji is one caret step, not two. Everything
 * therefore goes through `[...body]` rather than through `body.length`.
 */

/** Where the caret is, and where the selection it drags behind it started. */
export type TextCursor = { caret: number; anchor: number }

export const EMPTY_CURSOR: TextCursor = { caret: 0, anchor: 0 }

export function characters(body: string): string[] {
  return [...body]
}

export function clampIndex(body: string, index: number): number {
  return Math.max(0, Math.min(characters(body).length, Math.round(index)))
}

/** The selection as a pair, smallest first; the two are equal when nothing is selected. */
export function selectionRange(cursor: TextCursor): [number, number] {
  return cursor.caret <= cursor.anchor ? [cursor.caret, cursor.anchor] : [cursor.anchor, cursor.caret]
}

export function hasSelection(cursor: TextCursor): boolean {
  return cursor.caret !== cursor.anchor
}

/** The text with `insert` put in, replacing whatever was selected. */
export function insertText(body: string, cursor: TextCursor, insert: string): { body: string; cursor: TextCursor } {
  const glyphs = characters(body)
  const [from, to] = selectionRange(cursor)
  const added = characters(insert.replace(/\r\n?/g, '\n'))
  const room = MAX_TEXT_LENGTH - (glyphs.length - (to - from))
  const kept = added.slice(0, Math.max(0, room))
  const next = [...glyphs.slice(0, from), ...kept, ...glyphs.slice(to)].join('')
  const at = from + kept.length
  return { body: next, cursor: { caret: at, anchor: at } }
}

/** Backspace: the selection if there is one, otherwise the character before the caret. */
export function deleteBackwards(body: string, cursor: TextCursor): { body: string; cursor: TextCursor } {
  if (hasSelection(cursor)) return insertText(body, cursor, '')
  if (cursor.caret === 0) return { body, cursor }
  return insertText(body, { caret: cursor.caret - 1, anchor: cursor.caret }, '')
}

/** Delete: the selection if there is one, otherwise the character after the caret. */
export function deleteForwards(body: string, cursor: TextCursor): { body: string; cursor: TextCursor } {
  if (hasSelection(cursor)) return insertText(body, cursor, '')
  if (cursor.caret >= characters(body).length) return { body, cursor }
  return insertText(body, { caret: cursor.caret, anchor: cursor.caret + 1 }, '')
}

export type CaretMove = 'left' | 'right' | 'up' | 'down' | 'lineStart' | 'lineEnd' | 'start' | 'end'

/**
 * The caret moved. `extend` is the shift key: the anchor stays where it was, so the selection grows
 * rather than collapsing — which is the one rule that makes ⇧← feel like a text field anywhere else.
 */
export function moveCaret(body: string, cursor: TextCursor, move: CaretMove, extend = false): TextCursor {
  const place = caretPlace(body, cursor.caret)
  const lines = textLines(body)
  let caret = cursor.caret
  if (move === 'left') caret = cursor.caret - 1
  else if (move === 'right') caret = cursor.caret + 1
  else if (move === 'start') caret = 0
  else if (move === 'end') caret = characters(body).length
  else if (move === 'lineStart') caret = cursor.caret - place.column
  else if (move === 'lineEnd') caret = cursor.caret + (characters(lines[place.line] ?? '').length - place.column)
  else {
    const wanted = place.line + (move === 'down' ? 1 : -1)
    if (wanted < 0 || wanted >= lines.length) caret = move === 'down' ? characters(body).length : 0
    else caret = indexAt(body, wanted, Math.min(place.column, characters(lines[wanted] ?? '').length))
  }
  const at = clampIndex(body, caret)
  return { caret: at, anchor: extend ? cursor.anchor : at }
}

/** Which line the caret is on, and how far along it. */
export function caretPlace(body: string, index: number): { line: number; column: number } {
  const glyphs = characters(body)
  const at = clampIndex(body, index)
  let line = 0
  let column = 0
  for (let step = 0; step < at; step += 1) {
    if (glyphs[step] === '\n') {
      line += 1
      column = 0
    } else column += 1
  }
  return { line, column }
}

/** The index of a place, which is what a caret walked up or down lands on. */
export function indexAt(body: string, line: number, column: number): number {
  const lines = textLines(body)
  let index = 0
  for (let step = 0; step < line && step < lines.length; step += 1) index += characters(lines[step] ?? '').length + 1
  return index + Math.min(column, characters(lines[line] ?? '').length)
}

/**
 * Where the caret stands, in the object's own space: the left edge of the character it is before,
 * from the baseline of its line down by a quarter of the size and up by three quarters.
 */
export function caretSegment(data: TextData, layout: TextLayout, index: number): { x: number; bottom: number; top: number } {
  const place = caretPlace(data.body, index)
  const starts = layout.advances[place.line] ?? [0]
  const shift = alignShift(layout.lineWidths[place.line] ?? 0, data.align)
  const x = (starts[Math.min(place.column, starts.length - 1)] ?? 0) + shift
  const baseline = -place.line * lineHeightOf(data)
  return { x, bottom: baseline - data.size * 0.25, top: baseline + data.size * 0.75 }
}

/**
 * The selection as one box per line it covers. A selection that runs over a line break is drawn as
 * two boxes rather than one, which is what every text editor does and what makes a wrapped run read
 * as a run rather than as a rectangle over the whole paragraph.
 */
export function selectionBoxes(
  data: TextData,
  layout: TextLayout,
  cursor: TextCursor,
): Array<{ x0: number; x1: number; bottom: number; top: number }> {
  if (!hasSelection(cursor)) return []
  const [from, to] = selectionRange(cursor)
  const start = caretPlace(data.body, from)
  const end = caretPlace(data.body, to)
  const boxes: Array<{ x0: number; x1: number; bottom: number; top: number }> = []
  for (let line = start.line; line <= end.line; line += 1) {
    const first = line === start.line ? from : indexAt(data.body, line, 0)
    const last = line === end.line ? to : indexAt(data.body, line, Number.MAX_SAFE_INTEGER)
    const a = caretSegment(data, layout, first)
    const b = caretSegment(data, layout, last)
    if (Math.abs(b.x - a.x) < 1e-6) continue
    boxes.push({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), bottom: a.bottom, top: a.top })
  }
  return boxes
}
