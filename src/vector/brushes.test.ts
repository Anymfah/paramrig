import { describe, expect, it } from 'vitest'
import { brushesOf, brushFromElement, brushOutline, BUILTIN_BRUSHES, DEFAULT_BRUSH_SETTINGS, findBrush, resolveBrush, sanitizeBrushes, sanitizeBrushSettings, stampPath } from '@/vector/brushes'
import { createVectorElement } from '@/vector/document'
import type { Run } from '@/vector/network'

const line: Run = { points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false }
const stroked = { ...createVectorElement('path', { x: 0, y: 0, width: 100, height: 1 }), id: 'p', strokeWidth: 10 }

/** Every coordinate in a path, so a stamp's placement can be read back. */
function points(d: string): Array<[number, number]> {
  return [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])])
}

describe('the brushes on offer', () => {
  it('ships a round, a calligraphic and a dashed one', () => {
    expect(BUILTIN_BRUSHES.map((brush) => brush.name)).toEqual(['Round', 'Calligraphic', 'Dashed'])
    expect(brushesOf({}).length).toBe(3)
    expect(brushesOf({ brushes: [{ id: 'mine', name: 'Mine', network: BUILTIN_BRUSHES[0]!.network }] }).length).toBe(4)
    expect(findBrush({}, 'brush-round')?.name).toBe('Round')
    expect(findBrush({}, 'nothing')).toBeNull()
  })

  it('makes one out of a selected shape', () => {
    const source = { ...createVectorElement('path', { x: 0, y: 0, width: 10, height: 10 }), network: BUILTIN_BRUSHES[1]!.network }

    expect(brushFromElement(source, 'Nib', 'b1')?.network.segments.length).toBe(4)
    expect(brushFromElement({ ...source, network: undefined }, 'Nib', 'b1')).toBeNull()
  })

  it('draws with the shape the element carries, or the one that ships', () => {
    expect(resolveBrush({ ...DEFAULT_BRUSH_SETTINGS })?.name).toBe('Round')
    expect(resolveBrush(undefined)).toBeNull()
    expect(resolveBrush({ ...DEFAULT_BRUSH_SETTINGS, id: 'gone' })).toBeNull()
  })
})

describe('sanitising brushes', () => {
  it('keeps a well-formed one and drops the rest', () => {
    const kept = sanitizeBrushes([{ id: 'b', name: 'Mine', network: BUILTIN_BRUSHES[0]!.network }, { id: 'b', name: 'Twice', network: BUILTIN_BRUSHES[0]!.network }, { name: 'No id' }])

    expect(kept?.map((brush) => brush.name)).toEqual(['Mine'])
    expect(sanitizeBrushes('brush')).toBeUndefined()
  })

  it('clamps the settings into ranges a stroke can be drawn with', () => {
    expect(sanitizeBrushSettings({ id: 'brush-round', spacing: 40, jitter: -3, taper: 9 })).toMatchObject({ spacing: 4, jitter: 0, taper: 0.5 })
    expect(sanitizeBrushSettings({ spacing: 1 })).toBeUndefined()
  })
})

describe('stamping a stroke', () => {
  it('places a stamp at every step along the line', () => {
    const d = brushOutline([line], stroked, BUILTIN_BRUSHES[0]!, { ...DEFAULT_BRUSH_SETTINGS, spacing: 1 })
    const starts = d.match(/M /g) ?? []

    // A hundred units at one stroke width apart: eleven stamps, ends included.
    expect(starts.length).toBe(11)
  })

  it('scatters the same way every time, so a repaint never shuffles it', () => {
    const settings = { ...DEFAULT_BRUSH_SETTINGS, jitter: 1, spacing: 0.5 }

    expect(brushOutline([line], stroked, BUILTIN_BRUSHES[0]!, settings)).toBe(brushOutline([line], stroked, BUILTIN_BRUSHES[0]!, settings))
  })

  it('follows the width profile', () => {
    const wide = brushOutline([line], { ...stroked, strokeProfile: [{ t: 0, width: 0.2 }, { t: 1, width: 2 }] }, BUILTIN_BRUSHES[0]!, { ...DEFAULT_BRUSH_SETTINGS, spacing: 1 })
    const all = points(wide)
    const near = all.filter(([x]) => x < 10)
    const far = all.filter(([x]) => x > 90)
    const spread = (list: Array<[number, number]>) => Math.max(...list.map(([, y]) => y)) - Math.min(...list.map(([, y]) => y))

    expect(spread(far)).toBeGreaterThan(spread(near) * 3)
  })

  it('tapers into both ends when it is asked to', () => {
    const tapered = points(brushOutline([line], stroked, BUILTIN_BRUSHES[0]!, { ...DEFAULT_BRUSH_SETTINGS, spacing: 0.5, taper: 0.5 }))
    const middle = tapered.filter(([x]) => x > 45 && x < 55)
    const start = tapered.filter(([x]) => x < 6)
    const spread = (list: Array<[number, number]>) => (list.length ? Math.max(...list.map(([, y]) => y)) - Math.min(...list.map(([, y]) => y)) : 0)

    expect(spread(middle)).toBeGreaterThan(spread(start))
  })

  it('draws nothing without a width', () => {
    expect(brushOutline([line], { ...stroked, strokeWidth: 0 }, BUILTIN_BRUSHES[0]!, DEFAULT_BRUSH_SETTINGS)).toBe('')
  })
})

describe('one stamp', () => {
  it('sits on the point it is given, at the size it is given', () => {
    const all = points(stampPath(BUILTIN_BRUSHES[0]!.network, { x: 50, y: 20 }, 10, 0))
    const xs = all.map(([x]) => x)
    const ys = all.map(([, y]) => y)

    expect(Math.min(...xs)).toBeCloseTo(45, 1)
    expect(Math.max(...xs)).toBeCloseTo(55, 1)
    expect(Math.min(...ys)).toBeCloseTo(15, 1)
    expect(Math.max(...ys)).toBeCloseTo(25, 1)
  })
})
