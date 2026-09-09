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
    expect(performerAt(twice, square, 0.2, 1)).toBe(1)
    expect(performerAt(twice, square, 0.3, 1)).toBe(0)
    expect(performerAt(twice, square, 0.7, 1)).toBe(1)
    const both = makePerformer({ bipolar: true })
    expect(performerAt(both, square, 0.1, 1)).toBe(1)
    expect(performerAt(both, square, 0.9, 1)).toBe(-1)
    const rest = Array.from({ length: STEP_COUNT }, () => 0.5)
    expect(performerAt(both, rest, 0.5, 1)).toBeCloseTo(0, 6)
  })
})
