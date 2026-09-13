import { describe, expect, it } from 'vitest'
import { STEP_COUNT } from '@/audio/fields'
import { makePerformer } from '@/audio/patch'
import { patternAt, performerAt } from '@/audio/dsp/performer'

const ramp = Array.from({ length: STEP_COUNT }, (_, at) => at / (STEP_COUNT - 1))
const square = Array.from({ length: STEP_COUNT }, (_, at) => (at < STEP_COUNT / 2 ? 1 : 0))

describe('a performer\'s row', () => {
  it('holds each step across its share of the cycle when stepped', () => {
    expect(patternAt(square, 'step', 0)).toBe(1)
    expect(patternAt(square, 'step', 0.49)).toBe(1)
    expect(patternAt(square, 'step', 0.5)).toBe(0)
    expect(patternAt(square, 'step', 0.99)).toBe(0)
  })

  it('joins two steps by a line, and eases between them as a curve', () => {
    // Halfway through step eight of the square, a line is halfway down; the curve is too, by symmetry.
    const middle = (STEP_COUNT / 2 - 1 + 0.5) / STEP_COUNT
    expect(patternAt(square, 'line', middle)).toBeCloseTo(0.5, 6)
    expect(patternAt(square, 'curve', middle)).toBeCloseTo(0.5, 6)
    // A quarter of the way, the line is a quarter down and the curve has barely started.
    const quarter = (STEP_COUNT / 2 - 1 + 0.25) / STEP_COUNT
    expect(patternAt(square, 'line', quarter)).toBeCloseTo(0.75, 6)
    expect(patternAt(square, 'curve', quarter)).toBeGreaterThan(0.75)
  })

  it('wraps: the last step runs into the first', () => {
    expect(patternAt(ramp, 'line', 1 - 0.5 / STEP_COUNT)).toBeCloseTo(0.5, 6)
    expect(patternAt(ramp, 'step', 1.25)).toBe(patternAt(ramp, 'step', 0.25))
  })

  it('reads the row rate times over the sound, and rests at half height when bipolar', () => {
    const twice = makePerformer({ rate: 2 })
    expect(performerAt(twice, square, undefined, 0.2, 1)).toBe(1)
    expect(performerAt(twice, square, undefined, 0.3, 1)).toBe(0)
    expect(performerAt(twice, square, undefined, 0.7, 1)).toBe(1)
    const both = makePerformer({ bipolar: true })
    expect(performerAt(both, square, undefined, 0.1, 1)).toBe(1)
    expect(performerAt(both, square, undefined, 0.9, 1)).toBe(-1)
    const rest = Array.from({ length: STEP_COUNT }, () => 0.5)
    expect(performerAt(both, rest, undefined, 0.5, 1)).toBeCloseTo(0, 6)
  })
})

describe('a step that is not joined to the one before it', () => {
  const ramp = Array.from({ length: STEP_COUNT }, (_, at) => at / (STEP_COUNT - 1))
  const all = Array.from({ length: STEP_COUNT }, () => 1)

  it('holds its predecessor to the boundary instead of sloping into it', () => {
    const held = all.map((one, at) => (at === 4 ? 0 : one))
    const before = 3 / (STEP_COUNT - 1)
    // Half way through step three: joined it is on the way to step four, held it is still on three.
    expect(patternAt(ramp, 'line', 3.5 / STEP_COUNT, all)).toBeGreaterThan(before)
    expect(patternAt(ramp, 'line', 3.5 / STEP_COUNT, held)).toBeCloseTo(before, 6)
    // And it arrives all the same: the next step is the next step.
    expect(patternAt(ramp, 'line', 4.01 / STEP_COUNT, held)).toBeCloseTo(4 / (STEP_COUNT - 1), 2)
  })

  it('reads as it always did when every joining is whole, or when there are none at all', () => {
    for (const phase of [0, 0.1, 0.37, 0.5, 0.99]) {
      expect(patternAt(ramp, 'curve', phase, all)).toBe(patternAt(ramp, 'curve', phase))
      expect(patternAt(ramp, 'line', phase, all)).toBe(patternAt(ramp, 'line', phase))
    }
  })

  it('is ignored by a row that is held anyway', () => {
    const none = all.map(() => 0)
    for (const phase of [0.1, 0.37, 0.9]) {
      expect(patternAt(ramp, 'step', phase, none)).toBe(patternAt(ramp, 'step', phase))
    }
  })
})
