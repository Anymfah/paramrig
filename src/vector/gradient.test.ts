import { describe, expect, it } from 'vitest'
import {
  addStop,
  dropStop,
  gradientCircle,
  gradientLine,
  linearPatch,
  moveStop,
  pointAt,
  projectOnLine,
  radialPatch,
  sanitizePoint,
  sortStops,
  MAX_STOPS,
} from '@/vector/gradient'

const stops = () => [{ t: 0, color: '#000000' }, { t: 1, color: '#FFFFFF' }]

describe('where a gradient runs', () => {
  it('reads an angle the way the renderer always has', () => {
    expect(gradientLine({ angle: 0 })).toEqual({ from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } })
    expect(gradientLine({ angle: 90 }).to.y).toBeCloseTo(1)
  })

  it('prefers the ends when the paint carries them', () => {
    const line = gradientLine({ angle: 0, from: { x: 0.2, y: 0.2 }, to: { x: 0.8, y: 0.9 } })

    expect(line).toEqual({ from: { x: 0.2, y: 0.2 }, to: { x: 0.8, y: 0.9 } })
  })

  it('falls back to the whole box for a radial with nothing set', () => {
    expect(gradientCircle({})).toEqual({ center: { x: 0.5, y: 0.5 }, radius: 0.5 })
    expect(gradientCircle({ center: { x: 0.2, y: 0.3 }, radius: 0.1 })).toEqual({ center: { x: 0.2, y: 0.3 }, radius: 0.1 })
  })
})

describe('projecting onto the line', () => {
  const from = { x: 0, y: 0 }
  const to = { x: 1, y: 0 }

  it('reads a position along it and the distance off it', () => {
    expect(projectOnLine(from, to, { x: 0.25, y: 0 })).toEqual({ t: 0.25, distance: 0 })
    expect(projectOnLine(from, to, { x: 0.5, y: 0.3 }).distance).toBeCloseTo(0.3)
  })

  it('reports a position past the ends but measures from the end itself', () => {
    const past = projectOnLine(from, to, { x: 1.5, y: 0 })

    expect(past.t).toBeCloseTo(1.5)
    expect(past.distance).toBeCloseTo(0.5)
  })

  it('does not divide by zero on a line with no length', () => {
    expect(projectOnLine(from, from, { x: 0, y: 0.4 })).toEqual({ t: 0, distance: 0.4 })
  })

  it('walks along the line', () => {
    expect(pointAt(from, to, 0.25)).toEqual({ x: 0.25, y: 0 })
  })
})

describe('the stops on the ramp', () => {
  it('keeps them in order when one is dragged past another', () => {
    const three = [{ t: 0, color: '#000000' }, { t: 0.5, color: '#888888' }, { t: 1, color: '#FFFFFF' }]

    const moved = moveStop(three, 1, 1.4)

    expect(moved.stops.map((stop) => stop.t)).toEqual([0, 1, 1])
    expect(moved.stops[moved.index]!.color).toBe('#888888')
  })

  it('adds a stop coloured by what the ramp already shows there', () => {
    const added = addStop(stops(), 0.5)

    expect(added.stops).toHaveLength(3)
    expect(added.stops[added.index]).toMatchObject({ t: 0.5 })
    expect(added.stops[added.index]!.color).not.toBe('#000000')
  })

  it('refuses to pile up more stops than the ramp holds', () => {
    let ramp = stops()
    for (let index = 0; index < 20; index += 1) ramp = addStop(ramp, index / 21).stops

    expect(ramp).toHaveLength(MAX_STOPS)
    expect(addStop(ramp, 0.5).index).toBe(-1)
  })

  it('drops a stop but never leaves fewer than two', () => {
    const three = addStop(stops(), 0.5).stops

    expect(dropStop(three, 1)).toHaveLength(2)
    expect(dropStop(stops(), 0)).toHaveLength(2)
    expect(dropStop(stops(), 9)).toHaveLength(2)
  })

  it('sorts a ramp without touching the original', () => {
    const unsorted = [{ t: 1, color: '#FFFFFF' }, { t: 0, color: '#000000' }]

    expect(sortStops(unsorted).map((stop) => stop.t)).toEqual([0, 1])
    expect(unsorted[0]!.t).toBe(1)
  })
})

describe('patches written back to the paint', () => {
  it('keeps the angle in step with the ends it stores', () => {
    expect(linearPatch({ x: 0, y: 0 }, { x: 1, y: 0 })).toMatchObject({ angle: 0 })
    expect(linearPatch({ x: 0, y: 0 }, { x: 0, y: 1 })).toMatchObject({ angle: 90 })
    expect(linearPatch({ x: 1, y: 0 }, { x: 0, y: 0 })).toMatchObject({ angle: 180 })
  })

  it('keeps a radial radius usable', () => {
    expect(radialPatch({ x: 0.5, y: 0.5 }, 0)).toMatchObject({ radius: 0.01 })
    expect(radialPatch({ x: 0.5, y: 0.5 }, 99)).toMatchObject({ radius: 4 })
  })

  it('takes only real points out of stored data', () => {
    expect(sanitizePoint({ x: 0.2, y: 0.4 })).toEqual({ x: 0.2, y: 0.4 })
    expect(sanitizePoint({ x: 'a', y: 0 })).toBeUndefined()
    expect(sanitizePoint({ x: 1e9, y: 0 })).toBeUndefined()
    expect(sanitizePoint(null)).toBeUndefined()
  })
})
