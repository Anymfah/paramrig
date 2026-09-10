import { describe, expect, it } from 'vitest'
import { columnCount, nextSoundIndex } from '@/audio/sound-keys'

describe('nextSoundIndex', () => {
  it('walks a list and wraps at the ends', () => {
    expect(nextSoundIndex('ArrowDown', 0, 4)).toBe(1)
    expect(nextSoundIndex('ArrowUp', 0, 4)).toBe(3)
    expect(nextSoundIndex('ArrowRight', 3, 4)).toBe(0)
    expect(nextSoundIndex('Home', 2, 4)).toBe(0)
    expect(nextSoundIndex('End', 0, 4)).toBe(3)
  })

  it('steps a row on a grid', () => {
    expect(nextSoundIndex('ArrowDown', 1, 8, 4)).toBe(5)
    expect(nextSoundIndex('ArrowUp', 5, 8, 4)).toBe(1)
    expect(nextSoundIndex('ArrowLeft', 0, 8, 4)).toBe(7)
  })

  it('starts at the first or last when nothing is selected', () => {
    expect(nextSoundIndex('ArrowDown', -1, 3)).toBe(0)
    expect(nextSoundIndex('ArrowUp', -1, 3)).toBe(2)
  })
})

describe('columnCount', () => {
  it('counts items that share the first row', () => {
    const row = [{ offsetTop: 10 }, { offsetTop: 10 }, { offsetTop: 10 }, { offsetTop: 40 }]
    expect(columnCount(row)).toBe(3)
  })

  it('falls back to a list when everything sits on one line', () => {
    const row = [{ offsetTop: 0 }, { offsetTop: 0 }, { offsetTop: 0 }]
    expect(columnCount(row)).toBe(1)
  })
})
