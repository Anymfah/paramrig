import { describe, expect, it } from 'vitest'
import { envelopePath, nearestOnRuns, profileWidth, removeProfilePoint, sanitizeStrokeProfile, setProfilePoint, walkRun } from '@/vector/strokeProfile'
import type { Run } from '@/vector/network'

const line: Run = { points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false }
const square: Run = {
  points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }, { anchor: { x: 100, y: 100 } }, { anchor: { x: 0, y: 100 } }],
  closed: true,
}

/** The path data as numbers, so a shape can be compared without minding the formatting. */
function corners(d: string): Array<[number, number]> {
  return [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])])
}

describe('reading a width profile', () => {
  it('runs straight between the points it carries', () => {
    const profile = [{ t: 0, width: 0 }, { t: 1, width: 2 }]

    expect(profileWidth(profile, 0)).toBe(0)
    expect(profileWidth(profile, 0.5)).toBe(1)
    expect(profileWidth(profile, 1)).toBe(2)
  })

  it('holds its ends past the ends', () => {
    const profile = [{ t: 0.25, width: 3 }, { t: 0.75, width: 1 }]

    expect(profileWidth(profile, 0)).toBe(3)
    expect(profileWidth(profile, 1)).toBe(1)
  })

  it('is an even width when there is no profile', () => {
    expect(profileWidth(undefined, 0.4)).toBe(1)
    expect(profileWidth([], 0.4)).toBe(1)
  })
})

describe('editing a profile', () => {
  it('starts from an even width and adds the point asked for', () => {
    expect(setProfilePoint(undefined, 0.5, 2)).toEqual([{ t: 0, width: 1 }, { t: 0.5, width: 2 }, { t: 1, width: 1 }])
  })

  it('moves the point already sitting there instead of stacking one on it', () => {
    const first = setProfilePoint(undefined, 0.5, 2)

    expect(setProfilePoint(first, 0.505, 3)).toEqual([{ t: 0, width: 1 }, { t: 0.51, width: 3 }, { t: 1, width: 1 }])
  })

  it('takes a point away, but never the last two', () => {
    const profile = setProfilePoint(undefined, 0.5, 2)

    expect(removeProfilePoint(profile, 0.5)).toEqual([{ t: 0, width: 1 }, { t: 1, width: 1 }])
    expect(removeProfilePoint([{ t: 0, width: 1 }, { t: 1, width: 2 }], 0)).toBeUndefined()
  })
})

describe('sanitising a profile', () => {
  it('sorts, clamps and rounds what it keeps', () => {
    expect(sanitizeStrokeProfile([{ t: 2, width: 40 }, { t: -1, width: -3 }])).toEqual([{ t: 0, width: 0 }, { t: 1, width: 20 }])
  })

  it('drops anything that is not a pair of numbers, and needs two points', () => {
    expect(sanitizeStrokeProfile([{ t: 'a', width: 1 }, { t: 0.5, width: 2 }])).toBeUndefined()
    expect(sanitizeStrokeProfile('wide')).toBeUndefined()
  })

  it('forgets a profile that says nothing: an even width is the absence of one', () => {
    expect(sanitizeStrokeProfile([{ t: 0, width: 1 }, { t: 1, width: 1 }])).toBeUndefined()
  })
})

describe('walking a chain', () => {
  it('reports the position along the whole run and the normal to it', () => {
    const walk = walkRun(line)

    expect(walk[0]!.t).toBe(0)
    expect(walk[walk.length - 1]!.t).toBe(1)
    expect(walk[0]!.normal.x).toBeCloseTo(0, 6)
    expect(Math.abs(walk[0]!.normal.y)).toBeCloseTo(1, 6)
    expect(walk.every((entry, index, all) => index === 0 || entry.t >= all[index - 1]!.t)).toBe(true)
  })
})

describe('the envelope of a profiled stroke', () => {
  it('is a trapezium when the width runs from nothing to full along a straight line', () => {
    const d = envelopePath(line, 10, [{ t: 0, width: 0 }, { t: 1, width: 1 }])
    const points = corners(d)
    const extremes = { left: points[0]!, right: points.find(([x]) => x === 100)! }

    // At the start both sides meet on the line; at the end they stand five apart on each side.
    expect(extremes.left).toEqual([0, 0])
    expect(points.some(([x, y]) => x === 100 && Math.abs(y - 5) < 0.01)).toBe(true)
    expect(points.some(([x, y]) => x === 100 && Math.abs(y + 5) < 0.01)).toBe(true)
    expect(extremes.right[0]).toBe(100)
    expect(d.endsWith('Z')).toBe(true)
  })

  it('is an even band when there is no profile', () => {
    const points = corners(envelopePath(line, 8, undefined))

    expect(points.filter(([, y]) => Math.abs(Math.abs(y) - 4) < 0.01).length).toBeGreaterThan(2)
  })

  it('closes a loop as two rings, outer and inner', () => {
    const d = envelopePath(square, 10, undefined)
    const loops = d.split('M ').filter(Boolean)

    expect(loops).toHaveLength(2)
    expect(loops.every((loop) => loop.trim().endsWith('Z'))).toBe(true)
  })

  it('adds nothing for a stroke of no width', () => {
    expect(envelopePath(line, 0, [{ t: 0, width: 1 }, { t: 1, width: 1 }])).toBe('')
    expect(envelopePath({ points: [{ anchor: { x: 0, y: 0 } }], closed: false }, 4, undefined)).toBe('')
  })

  it('squares off or rounds the ends when the cap asks for it', () => {
    expect(envelopePath(line, 10, undefined, 'round')).toContain('A 5 5')
    const squared = corners(envelopePath(line, 10, undefined, 'square'))
    expect(squared.some(([x]) => x === 105)).toBe(true)
    expect(squared.some(([x]) => x === -5)).toBe(true)
  })
})

describe('finding the nearest place on a chain', () => {
  it('reports where along the chain it falls and how far off the point sits', () => {
    const nearest = nearestOnRuns([line], { x: 50, y: 12 })!

    expect(nearest.t).toBeCloseTo(0.5, 1)
    expect(nearest.distance).toBeCloseTo(12, 0)
    expect(nearest.runIndex).toBe(0)
  })

  it('picks the closer of two chains', () => {
    const far = { points: [{ anchor: { x: 0, y: 500 } }, { anchor: { x: 100, y: 500 } }], closed: false }

    expect(nearestOnRuns([far, line], { x: 50, y: 5 })!.runIndex).toBe(1)
  })

  it('gives up on nothing to walk', () => {
    expect(nearestOnRuns([], { x: 0, y: 0 })).toBeNull()
  })
})
