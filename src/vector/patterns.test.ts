import { describe, expect, it } from 'vitest'
import { patternCell, patternFromElement, patternTransform, stampOffset } from '@/vector/patterns'
import { createVectorElement } from '@/vector/document'
import { sanitizePaints } from '@/vector/paints'

describe('the repeating cell', () => {
  const tile = { width: 40, height: 20 }

  it('is one stamp for a grid, spacing included', () => {
    expect(patternCell('grid', tile, 10)).toEqual({ width: 50, height: 30, stamps: [{ x: 0, y: 0 }] })
  })

  it('is two rows for a brick, the second shifted by half a tile', () => {
    const cell = patternCell('brick', tile, 0)

    expect(cell).toEqual({ width: 40, height: 40, stamps: [{ x: 0, y: 0 }, { x: 20, y: 20 }] })
  })

  it('packs the rows closer for a hex, by the height of an equilateral triangle', () => {
    const cell = patternCell('hex', tile, 0)

    expect(cell.height).toBeCloseTo(20 * Math.sqrt(3), 5)
    expect(cell.stamps[1]!.y).toBeCloseTo(20 * (Math.sqrt(3) / 2), 5)
  })

  it('never asks for a cell of nothing', () => {
    expect(patternCell('grid', { width: 10, height: 10 }, -100)).toMatchObject({ width: 1, height: 1 })
  })
})

describe('the pattern transform', () => {
  it('offsets, then turns, then scales', () => {
    expect(patternTransform({ offset: { x: 5, y: -2 }, angle: 30, scale: 2 })).toBe('translate(5 -2) rotate(30) scale(2)')
  })

  it('says nothing when there is nothing to say', () => {
    expect(patternTransform({})).toBe('')
    expect(patternTransform({ offset: { x: 0, y: 0 }, angle: 0, scale: 1 })).toBe('')
  })
})

describe('making a pattern out of an object', () => {
  const source = { ...createVectorElement('rectangle', { x: 30, y: 40, width: 60, height: 25 }), id: 'tile' }

  it('takes the object box as the tile', () => {
    const paint = patternFromElement(source, 'p1')

    expect(paint).toMatchObject({ type: 'pattern', sourceId: 'tile', tile: { width: 60, height: 25 }, patternMode: 'grid', scale: 1 })
  })

  it('knows where the object has to move to sit in the cell', () => {
    expect(stampOffset(source)).toEqual({ x: -30, y: -40 })
  })
})

describe('sanitising a pattern fill', () => {
  const base = { id: 'p', type: 'pattern', opacity: 1, visible: true, sourceId: 'tile', tile: { width: 40, height: 40 } }

  it('keeps it, with the defaults filled in', () => {
    expect(sanitizePaints([base])).toEqual([{ ...base, spacing: 0, scale: 1, angle: 0, offset: { x: 0, y: 0 }, patternMode: 'grid' }])
  })

  it('drops one that points at nothing, or has no tile', () => {
    expect(sanitizePaints([{ ...base, sourceId: undefined }])).toEqual([])
    expect(sanitizePaints([{ ...base, tile: undefined }])).toEqual([])
  })

  it('clamps what would break the tiling', () => {
    const [paint] = sanitizePaints([{ ...base, scale: 900, spacing: -99999, angle: 730, patternMode: 'spiral' }])!

    expect(paint).toMatchObject({ scale: 20, spacing: -1000, angle: 10, patternMode: 'grid' })
  })
})
