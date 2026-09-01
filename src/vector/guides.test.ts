import { describe, expect, it } from 'vitest'
import { addGuide, guideAtPoint, moveGuide, removeGuide, sanitizeGuides } from '@/vector/guides'

describe('vector guides', () => {
  it('keeps only well-formed unique guides', () => {
    expect(sanitizeGuides([
      { id: 'a', axis: 'x', position: 10.123 },
      { id: 'a', axis: 'y', position: 20 },
      { id: 'b', axis: 'z', position: 20 },
      { id: 'c', axis: 'y', position: Number.NaN },
      { id: '', axis: 'y', position: 1 },
      { id: 'd', axis: 'y', position: -40 },
      'junk',
    ])).toEqual([{ id: 'a', axis: 'x', position: 10.12 }, { id: 'd', axis: 'y', position: -40 }])
    expect(sanitizeGuides(undefined)).toEqual([])
  })

  it('adds, moves and removes guides immutably', () => {
    const guides = addGuide([], { id: 'a', axis: 'x', position: 10 })
    const moved = moveGuide(guides, 'a', 12.345)
    expect(moved[0]!.position).toBe(12.35)
    expect(guides[0]!.position).toBe(10)
    expect(removeGuide(moved, 'a')).toEqual([])
  })

  it('finds the nearest guide within a threshold', () => {
    const guides = [{ id: 'a', axis: 'x' as const, position: 100 }, { id: 'b', axis: 'y' as const, position: 50 }]
    expect(guideAtPoint(guides, { x: 103, y: 0 }, 4)?.id).toBe('a')
    expect(guideAtPoint(guides, { x: 0, y: 47 }, 4)?.id).toBe('b')
    expect(guideAtPoint(guides, { x: 110, y: 10 }, 4)).toBeNull()
  })
})
