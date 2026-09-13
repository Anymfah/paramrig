import { describe, expect, it } from 'vitest'
import { RESPONSE_CEILING, RESPONSE_FLOOR, filterCurve, filterResponse, insertResponse, insertShape } from '@/audio/dsp/response'

const CUTOFF = 1200
const at = (curve: Float64Array, frequency: number) =>
  curve[Math.round((Math.log(frequency / 60) / Math.log(16000 / 60)) * (curve.length - 1))] ?? 0

describe('what a filter model does, measured', () => {
  it('leaves the sound alone when there is no filter', () => {
    const flat = filterCurve('off')
    for (const level of flat) expect(Math.abs(level)).toBeLessThan(0.5)
  })

  it('draws each model as the thing its name claims', () => {
    const low = filterCurve('lowpass')
    expect(at(low, 200)).toBeGreaterThan(-1)
    expect(at(low, 8000)).toBeLessThan(-24)

    const high = filterCurve('highpass')
    expect(at(high, 200)).toBeLessThan(-20)
    expect(at(high, 8000)).toBeGreaterThan(-1)

    const band = filterCurve('bandpass')
    expect(at(band, CUTOFF)).toBeGreaterThan(at(band, 200))
    expect(at(band, CUTOFF)).toBeGreaterThan(at(band, 8000))

    const notch = filterCurve('notch')
    expect(at(notch, CUTOFF)).toBeLessThan(-12)
    expect(at(notch, 200)).toBeGreaterThan(-1)
    expect(at(notch, 8000)).toBeGreaterThan(-1)

    const peak = filterCurve('peak')
    expect(at(peak, CUTOFF)).toBeGreaterThan(3)
    expect(Math.abs(at(peak, 200))).toBeLessThan(2)
  })

  it('gives the ladder twice the slope without taking the level with it', () => {
    const ladder = filterCurve('ladder')
    const low = filterCurve('lowpass')
    // Twice the poles: an octave above the corner it is further down than the two-pole is.
    expect(at(ladder, 2400)).toBeLessThan(at(low, 2400))
    // And its passband is where a passband belongs, which four poles of feedback do not give free.
    expect(at(ladder, CUTOFF)).toBeGreaterThan(-4)
  })

  it('keeps every reading inside the window it is drawn in', () => {
    for (const kind of ['off', 'lowpass', 'highpass', 'bandpass', 'notch', 'peak', 'ladder', 'comb'] as const) {
      for (const level of filterCurve(kind)) {
        expect(level, kind).toBeGreaterThanOrEqual(RESPONSE_FLOOR)
        expect(level, kind).toBeLessThanOrEqual(RESPONSE_CEILING)
        expect(Number.isFinite(level), kind).toBe(true)
      }
    }
  })

  it('measures a model once and hands back the same reading after', () => {
    expect(filterResponse('bandpass')).toBe(filterResponse('bandpass'))
  })
})

describe('what an insert does, drawn by running one through it', () => {
  it('leaves the burst alone when the slot is empty', () => {
    const flat = insertShape('off')
    // Three cycles in and silence after: the second half of an empty slot is a flat line.
    expect(Math.max(...Array.from(flat.slice(0, flat.length / 2), Math.abs))).toBeGreaterThan(0.9)
    expect(Math.max(...Array.from(flat.slice(flat.length / 2 + 4), Math.abs))).toBeLessThan(0.05)
  })

  it('gives the body and the comb the tail that is the whole point of them', () => {
    for (const kind of ['body', 'comb'] as const) {
      const shape = insertShape(kind)
      const tail = Math.max(...Array.from(shape.slice(Math.round(shape.length * 0.7)), Math.abs))
      expect(tail, kind).toBeGreaterThan(0.05)
    }
  })

  it('fills its box whatever the level the effect actually comes back at', () => {
    for (const kind of ['off', 'drive', 'crusher', 'ring', 'fold', 'body', 'comb'] as const) {
      const shape = insertShape(kind)
      const peak = Math.max(...Array.from(shape, Math.abs))
      expect(peak, kind).toBeGreaterThan(0.9)
      expect(peak, kind).toBeLessThanOrEqual(1.0001)
      for (const value of shape) expect(Number.isFinite(value), kind).toBe(true)
    }
  })

  it('draws a kind once and hands back the same drawing after', () => {
    expect(insertResponse('fold')).toBe(insertResponse('fold'))
  })
})
