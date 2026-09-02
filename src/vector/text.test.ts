import { describe, expect, it } from 'vitest'
import { approximateMeasure, autoTextBounds, canOutline, fontStack, layoutText, textProperties, TEXT_FACES, type Measure, type TextProperties } from '@/vector/text'

/** Ten pixels per character, so expectations read directly. */
const measure: Measure = (line) => line.length * 10

const base = (patch: Partial<TextProperties> = {}): TextProperties => textProperties({ text: 'Text', fontSize: 20, lineHeight: 1.5, ...patch })

describe('text properties', () => {
  it('fills in the defaults of a bare text element', () => {
    expect(textProperties({})).toEqual({
      text: 'Text', fontFamily: 'Public Sans', fontSize: 32, fontWeight: 400,
      lineHeight: 1.3, letterSpacing: 0, textAlign: 'left', textSizing: 'auto',
    })
  })

  it('ignores sizes that would collapse the text', () => {
    expect(textProperties({ fontSize: 0, lineHeight: -2 })).toMatchObject({ fontSize: 32, lineHeight: 1.3 })
  })

  it('knows which faces the app can outline', () => {
    expect(canOutline('Public Sans')).toBe(true)
    expect(canOutline('Georgia')).toBe(false)
    expect(canOutline('Unknown face')).toBe(true)
    expect(fontStack('Georgia')).toContain('Georgia')
    expect(TEXT_FACES.filter((face) => face.outlineUrl)).toHaveLength(1)
  })
})

describe('text layout', () => {
  it('keeps hard line breaks and advances each baseline by the line height', () => {
    const layout = layoutText(base({ text: 'ab\ncde' }), 0, measure)

    expect(layout.lines.map((line) => line.text)).toEqual(['ab', 'cde'])
    expect(layout.lineAdvance).toBe(30)
    expect(layout.lines[1]!.y - layout.lines[0]!.y).toBe(30)
    expect(layout.width).toBe(30)
    expect(layout.height).toBe(60)
  })

  it('wraps on words inside a fixed box and leaves an auto box alone', () => {
    const properties = base({ text: 'one two three', textSizing: 'fixed' })

    expect(layoutText(properties, 80, measure).lines.map((line) => line.text)).toEqual(['one two', 'three'])
    expect(layoutText({ ...properties, textSizing: 'auto' }, 80, measure).lines.map((line) => line.text)).toEqual(['one two three'])
  })

  it('splits a word no line can hold rather than letting it hang outside', () => {
    const layout = layoutText(base({ text: 'short verylongword', textSizing: 'fixed' }), 60, measure)

    // Six characters fit in 60 px at ten pixels each.
    expect(layout.lines.map((line) => line.text)).toEqual(['short', 'verylo', 'ngword'])
    expect(layout.lines.every((line) => line.width <= 60)).toBe(true)
  })

  it('keeps a single character on a line even when the box is narrower than it', () => {
    const layout = layoutText(base({ text: 'abc', textSizing: 'fixed' }), 4, measure)

    expect(layout.lines.map((line) => line.text)).toEqual(['a', 'b', 'c'])
  })

  it('leaves an over-long word alone when the box grows with the content', () => {
    const layout = layoutText(base({ text: 'verylongword', textSizing: 'auto' }), 20, measure)

    expect(layout.lines.map((line) => line.text)).toEqual(['verylongword'])
  })

  it('anchors each line by the alignment', () => {
    const left = layoutText(base({ text: 'ab' }), 0, measure)
    const center = layoutText(base({ text: 'ab', textAlign: 'center', textSizing: 'fixed' }), 100, measure)
    const right = layoutText(base({ text: 'ab', textAlign: 'right', textSizing: 'fixed' }), 100, measure)

    expect([left.anchor, center.anchor, right.anchor]).toEqual(['start', 'middle', 'end'])
    expect([left.lines[0]!.x, center.lines[0]!.x, right.lines[0]!.x]).toEqual([0, 50, 100])
  })

  it('keeps an empty line so the caret has somewhere to sit', () => {
    const layout = layoutText(base({ text: 'a\n\nb' }), 0, measure)

    expect(layout.lines.map((line) => line.text)).toEqual(['a', '', 'b'])
    expect(layout.height).toBe(90)
  })

  it('sizes an auto box to its widest line', () => {
    expect(autoTextBounds(base({ text: 'ab\ncdef' }), measure)).toEqual({ width: 40, height: 60 })
  })
})

describe('approximate measure', () => {
  it('grows with the length, the size and the tracking', () => {
    const properties = base({ text: 'abcd', fontSize: 20 })

    expect(approximateMeasure('abcd', properties)).toBeGreaterThan(approximateMeasure('ab', properties))
    expect(approximateMeasure('abcd', { ...properties, fontSize: 40 })).toBeGreaterThan(approximateMeasure('abcd', properties))
    expect(approximateMeasure('abcd', { ...properties, letterSpacing: 5 })).toBeCloseTo(approximateMeasure('abcd', properties) + 20)
  })

  it('gives a monospace face a wider ratio than a serif one', () => {
    expect(approximateMeasure('abcd', base({ fontFamily: 'Courier New' }))).toBeGreaterThan(approximateMeasure('abcd', base({ fontFamily: 'Times New Roman' })))
  })
})
