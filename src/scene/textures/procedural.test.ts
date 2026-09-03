import { describe, expect, it } from 'vitest'
import { sample, sampleColour, TEXTURE_DEFAULTS, type TextureKind } from '@/scene/textures/procedural'
import type { Vec3 } from '@/scene/types'

/*
 * What is being checked is that these are fields and not rolls of a die: the same point answers the
 * same number for ever, the range is closed whatever the options say, and every option that claims
 * to change the field does change it.
 */

const KINDS: TextureKind[] = ['noise', 'clouds', 'voronoi', 'wood']

/** A spread of points that is not a lattice: nothing here should be measured only on cell corners. */
function grid(count = 6, step = 0.37): Vec3[] {
  const points: Vec3[] = []
  for (let x = 0; x < count; x += 1) {
    for (let y = 0; y < count; y += 1) {
      for (let z = 0; z < count; z += 1) {
        points.push([(x - count / 2) * step, (y - count / 2) * step + 0.11, (z - count / 2) * step - 0.23])
      }
    }
  }
  return points
}

function differences(first: number[], second: number[]): number {
  return first.reduce((count, value, index) => (Math.abs(value - (second[index] ?? 0)) > 1e-9 ? count + 1 : count), 0)
}

/** How much the field changes over a short step: what more detail is supposed to add. */
function roughness(kind: TextureKind, detail: number): number {
  const step = 0.01
  let total = 0
  const points = grid()
  for (const point of points) {
    const here = sample(kind, point, { detail })
    const there = sample(kind, [point[0] + step, point[1], point[2]], { detail })
    total += Math.abs(here - there)
  }
  return total / points.length
}

describe('the procedural textures', () => {
  it('gives the same number for the same point and seed, every time', () => {
    for (const kind of KINDS) {
      for (const point of grid(3)) {
        const first = sample(kind, point, { seed: 7 })
        expect(sample(kind, point, { seed: 7 })).toBe(first)
        expect(sample(kind, [...point] as Vec3, { seed: 7, scale: TEXTURE_DEFAULTS.scale })).toBe(first)
      }
    }
  })

  it('gives a different field under a different seed', () => {
    const points = grid()
    expect(points.length).toBeGreaterThan(100)
    for (const kind of KINDS) {
      const first = points.map((point) => sample(kind, point, { seed: 1 }))
      const second = points.map((point) => sample(kind, point, { seed: 2 }))
      // Not merely “not identical”: two seeds are two fields, so nearly every point should differ.
      expect(differences(first, second)).toBeGreaterThan(points.length * 0.9)
    }
  })

  it('stays inside nought and one over a grid, for every kind and every option', () => {
    const settings = [
      {},
      { scale: 0 },
      { scale: 40, detail: 8, roughness: 1, distortion: 4 },
      { detail: 1, roughness: 0 },
      { detail: 3.5, roughness: 0.9, distortion: 1, seed: 512 },
      { scale: -7, distortion: 10 },
    ]
    for (const kind of KINDS) {
      for (const options of settings) {
        for (const point of grid()) {
          const value = sample(kind, point, options)
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('answers the midlevel rather than a NaN for a point that is not a point', () => {
    for (const kind of KINDS) {
      expect(sample(kind, [Number.NaN, 0, 0])).toBe(0.5)
      expect(sample(kind, [0, Infinity, 0])).toBe(0.5)
      // A seed that arrived from a hand-edited file as a string is read, not multiplied into a NaN.
      expect(Number.isFinite(sample(kind, [0.3, 0.4, 0.5], { seed: '4' as unknown as number }))).toBe(true)
    }
  })

  it('changes the field when the scale changes', () => {
    const points = grid()
    for (const kind of KINDS) {
      const near = points.map((point) => sample(kind, point, { scale: 5 }))
      const far = points.map((point) => sample(kind, point, { scale: 11 }))
      expect(differences(near, far)).toBeGreaterThan(points.length * 0.9)
    }
  })

  it('adds variation with the detail, and still does not leave the range', () => {
    for (const kind of ['noise', 'clouds', 'voronoi'] as TextureKind[]) {
      // Each octave is half the amplitude and twice the frequency, so it contributes as much slope
      // as the one before it: more octaves is more change over the same short step.
      expect(roughness(kind, 4)).toBeGreaterThan(roughness(kind, 1))
      for (const point of grid(4)) {
        const value = sample(kind, point, { detail: 8, roughness: 1 })
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })

  it('moves the pattern off its lattice when it is distorted', () => {
    const points = grid()
    for (const kind of KINDS) {
      const plain = points.map((point) => sample(kind, point, { distortion: 0 }))
      const bent = points.map((point) => sample(kind, point, { distortion: 1 }))
      expect(differences(plain, bent)).toBeGreaterThan(points.length * 0.9)
    }
  })

  it('uses the whole range rather than a corner of it', () => {
    for (const kind of KINDS) {
      const values = grid(8, 0.29).map((point) => sample(kind, point))
      const low = Math.min(...values)
      const high = Math.max(...values)
      expect(high - low).toBeGreaterThan(0.4)
    }
  })

  it('never asks the voronoi clamp to do anything, which is what its divisor is measured for', () => {
    // The divisor is a measurement, so it is measured again here: a value that reached 1 would be
    // the clamp firing, and the clamp firing is a flat spot in a displacement.
    let highest = 0
    for (let index = 0; index < 200000; index += 1) {
      const point: Vec3 = [index * 0.0137, index * 0.0219 - 3, index * 0.0331 + 7]
      highest = Math.max(highest, sample('voronoi', point, { detail: 1 }))
    }
    expect(highest).toBeLessThan(1)
    // And not so far below it that the field is using a corner of the range it was given.
    expect(highest).toBeGreaterThan(0.8)
  })

  it('keeps the wood in rings around the vertical axis', () => {
    // Two points at the same distance from Z, with no wander, are on the same ring. The wander is
    // what breaks that, so it is measured with the noise turned as far down as it goes.
    const flat = { detail: 1, roughness: 0, distortion: 0, scale: 4 }
    const values = [0, Math.PI / 3, Math.PI, 4.7].map((angle) => (
      sample('wood', [Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0.4], flat)
    ))
    // The wander is a function of the point, so a ring is not exactly constant, but a ring at a
    // quarter of the scale apart from the next one is nowhere near as far apart as two rings.
    const spread = Math.max(...values) - Math.min(...values)
    expect(spread).toBeLessThan(0.7)
    // Moving straight up the axis does not cross a ring; moving outwards does.
    expect(sample('wood', [0.8, 0, 0.4], flat)).not.toBeCloseTo(sample('wood', [1.05, 0, 0.4], flat), 2)
  })
})

describe('the colours of the procedural textures', () => {
  it('gives three channels in nought to one, the same ones every time', () => {
    for (const kind of KINDS) {
      for (const point of grid(3)) {
        const colour = sampleColour(kind, point, { seed: 3 })
        expect(colour).toHaveLength(3)
        for (const channel of colour) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(1)
        }
        expect(sampleColour(kind, point, { seed: 3 })).toEqual(colour)
      }
    }
  })

  it('gives noise three unrelated channels rather than three copies of one', () => {
    const points = grid(4)
    const spread = points.map((point) => {
      const [red, green, blue] = sampleColour('noise', point)
      return Math.max(Math.abs(red - green), Math.abs(green - blue))
    })
    expect(spread.filter((value) => value > 0.05).length).toBeGreaterThan(points.length * 0.5)
  })

  it('gives every point of a voronoi cell the cell’s own colour', () => {
    // Two points a hundredth apart in the middle of a cell belong to the same cell, so they are the
    // same colour; a sweep across the field finds several different ones.
    const here = sampleColour('voronoi', [0.2, 0.3, 0.4], { scale: 1 })
    expect(sampleColour('voronoi', [0.205, 0.3, 0.4], { scale: 1 })).toEqual(here)
    const seen = new Set(grid(6, 0.9).map((point) => sampleColour('voronoi', point, { scale: 1 }).join(',')))
    expect(seen.size).toBeGreaterThan(8)
  })

  it('gives wood a grey, because a ring pattern is one number', () => {
    const point: Vec3 = [0.4, -0.7, 0.2]
    const [red, green, blue] = sampleColour('wood', point)
    expect(green).toBe(red)
    expect(blue).toBe(red)
    expect(red).toBeCloseTo(sample('wood', point), 12)
  })
})
