import { describe, expect, it } from 'vitest'
import type { InsertKind, InsertSlot } from '@/audio/types'
import { createInsert, insertSample } from '@/audio/dsp/insert'

const RATE = 44100
const TONE = 220

const slot = (over: Partial<InsertSlot> = {}): InsertSlot => ({
  kind: 'off', place: 'pre', amount: 1,
  drive: 0, bitDepth: 16, crush: 0, ratio: 2,
  frequency: 900, spread: 0.7, decay: 0.25, partials: 4,
  time: 0.008, feedback: 0.5,
  ...over,
})

/** A steady tone through one slot, and the root-mean-square of what comes back. */
function through(over: Partial<InsertSlot>, samples = 4096): { level: number; out: number[] } {
  const held = slot(over)
  const state = createInsert(held, RATE)
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < samples; i += 1) {
    const input = Math.sin((2 * Math.PI * TONE * i) / RATE)
    const value = insertSample(state, held, input, TONE, RATE)
    out.push(value)
    sum += value * value
  }
  return { level: Math.sqrt(sum / samples), out }
}

const KINDS: InsertKind[] = ['off', 'drive', 'crusher', 'ring', 'fold', 'body', 'comb']

describe('an insert slot', () => {
  it('passes the sound through untouched when it is off', () => {
    const held = slot()
    const state = createInsert(held, RATE)
    for (const value of [0.42, -0.9, 0, 1]) expect(insertSample(state, held, value, TONE, RATE)).toBe(value)
  })

  it('is a true bypass at no amount, whatever kind it is set to', () => {
    for (const kind of KINDS) {
      const held = slot({ kind, amount: 0 })
      const state = createInsert(held, RATE)
      for (const value of [0.42, -0.9, 0.13]) expect(insertSample(state, held, value, TONE, RATE), kind).toBe(value)
    }
  })

  it('crossfades rather than changing the level, so a slot can be left on and turned down', () => {
    const clean = through({ kind: 'off' }).level
    const half = through({ kind: 'drive', drive: 1, amount: 0.5 })
    const full = through({ kind: 'drive', drive: 1, amount: 1 })
    expect(half.level).toBeGreaterThan(clean)
    expect(half.level).toBeLessThan(full.level)
  })

  it('rounds the peaks off under drive and keeps the sound inside the rails', () => {
    const driven = through({ kind: 'drive', drive: 0.8 })
    expect(driven.level).toBeGreaterThan(through({ kind: 'off' }).level)
    for (const value of driven.out) expect(Math.abs(value)).toBeLessThanOrEqual(1.0001)
  })

  it('takes the sound down to a few levels under the crusher', () => {
    // Two bits is a grid of two steps, which a signal running from −1 to 1 lands on in five places.
    const { out } = through({ kind: 'crusher', bitDepth: 2, crush: 0 }, 512)
    expect(new Set(out.map((value) => value.toFixed(6))).size).toBeLessThanOrEqual(5)
  })

  it('holds a sample for a while under crush, which is the other half of a lo-fi voice', () => {
    const { out } = through({ kind: 'crusher', bitDepth: 16, crush: 0.5 }, 256)
    expect(out[0]).toBe(out[1])
    expect(out[0]).toBe(out[8])
  })

  it('moves the tone somewhere else entirely under the ring', () => {
    // A ring against a tone at its own pitch is that tone doubled and a direct component, which is
    // a different sound and not a quieter version of the same one.
    const rung = through({ kind: 'ring', ratio: 1 })
    expect(rung.level).toBeGreaterThan(0.2)
    expect(rung.level).toBeLessThan(through({ kind: 'off' }).level)
  })

  it('turns the sound back at the rails when it folds, rather than flattening it', () => {
    const { out } = through({ kind: 'fold', drive: 0.6 }, 512)
    for (const value of out) expect(Math.abs(value)).toBeLessThanOrEqual(1.0001)
    // A folder crosses zero more often than what went in: that is where its harmonics come from.
    const crossings = out.filter((value, at) => at > 0 && Math.sign(value) !== Math.sign(out[at - 1] ?? 0)).length
    const clean = through({ kind: 'off' }, 512).out
    expect(crossings).toBeGreaterThan(clean.filter((value, at) => at > 0 && Math.sign(value) !== Math.sign(clean[at - 1] ?? 0)).length)
  })

  it('rings on after the sound that caused it has gone, which a body is for', () => {
    const held = slot({ kind: 'body', frequency: 600, decay: 0.4, amount: 1 })
    const state = createInsert(held, RATE)
    let tail = 0
    for (let i = 0; i < 4410; i += 1) {
      const input = i < 64 ? Math.sin((2 * Math.PI * 600 * i) / RATE) : 0
      const value = insertSample(state, held, input, TONE, RATE)
      if (i > 2000) tail = Math.max(tail, Math.abs(value))
    }
    expect(tail).toBeGreaterThan(0.001)
  })

  it('repeats what it was given a moment later, which a comb is for', () => {
    const held = slot({ kind: 'comb', time: 0.005, feedback: 0.8, amount: 1 })
    const state = createInsert(held, RATE)
    const delay = Math.round(0.005 * RATE)
    const out: number[] = []
    for (let i = 0; i < delay * 3; i += 1) out.push(insertSample(state, held, i === 0 ? 1 : 0, TONE, RATE))
    // The line is read between two samples, so a single sample in comes back spread over two.
    const around = (at: number) => Math.max(...[-1, 0, 1].map((step) => Math.abs(out[at + step] ?? 0)))
    expect(around(delay)).toBeGreaterThan(0.4)
    expect(around(delay * 2)).toBeGreaterThan(0.2)
  })

  it('stays finite and inside its head through everything at once', () => {
    for (const kind of KINDS) {
      const held = slot({ kind, amount: 1, drive: 1, bitDepth: 1, crush: 1, ratio: 16, feedback: 9, time: 900, decay: 3, partials: 6 })
      const state = createInsert(held, RATE)
      for (let i = 0; i < 8000; i += 1) {
        const value = insertSample(state, held, Math.sin(i * 0.05), TONE, RATE)
        expect(Number.isFinite(value), kind).toBe(true)
        expect(Math.abs(value), kind).toBeLessThan(12)
      }
    }
  })
})

/** The three units that were quietly doing something other than what their names say. */
describe('the units, at their limits', () => {
  it('keeps folding above the rails instead of turning into a clipper', () => {
    const held = slot({ kind: 'fold', amount: 1, drive: 1 })
    const state = createInsert(held, RATE)
    const at = (value: number) => insertSample(state, held, value, TONE, RATE)
    // Sixteen times the input reaches the folder, so anything over about a sixteenth is folded
    // several times over — the loop that used to be here gave up after eight and clamped, and
    // every one of these came back at exactly one.
    const hot = [1.1, 1.2, 1.5, 2, 5].map(at)
    expect(hot.every((value) => Math.abs(value) < 0.9999), hot.join(' ')).toBe(true)
    expect(new Set(hot.map((value) => value.toFixed(4))).size).toBeGreaterThan(1)
    // And it is still the same fold where the loop did terminate: a triangle, exact at its corners.
    expect(at(0)).toBeCloseTo(0, 6)
    expect(at(1 / 16)).toBeCloseTo(1, 6)
    expect(at(2 / 16)).toBeCloseTo(0, 6)
    expect(at(3 / 16)).toBeCloseTo(-1, 6)
  })

  it('stops a ring modulator’s carrier under Nyquist rather than folding it back', () => {
    const heard = (ratio: number) => {
      const held = slot({ kind: 'ring', amount: 1, ratio })
      const state = createInsert(held, RATE)
      // The input held at one, so what comes back is the bare carrier: count its zero crossings.
      let crossings = 0
      let previous = 0
      for (let i = 0; i < RATE; i += 1) {
        const value = insertSample(state, held, 1, 2000, RATE)
        if (previous <= 0 && value > 0) crossings += 1
        previous = value
      }
      return crossings
    }
    // 2000 Hz times eight is 16 kHz and fits; times sixteen is 32 kHz and does not. The knob used
    // to run backwards past the fold — sixteen came back lower than eight.
    expect(heard(8)).toBeGreaterThan(15000)
    expect(heard(16)).toBeGreaterThanOrEqual(heard(8))
    expect(heard(16)).toBeLessThan(RATE * 0.5)
  })

  it('crushes at the same rate whatever the machine plays at', () => {
    const holds = (rate: number) => {
      const held = slot({ kind: 'crusher', amount: 1, bitDepth: 16, crush: 0.5 })
      const state = createInsert(held, rate)
      let changes = 0
      let previous = NaN
      for (let i = 0; i < rate; i += 1) {
        const value = insertSample(state, held, Math.sin((2 * Math.PI * 300 * i) / rate), TONE, rate)
        if (value !== previous) changes += 1
        previous = value
      }
      return changes
    }
    // Per second, at two rates. It used to be a count of samples, so the same knob crushed a tone
    // and a half apart on a machine at 48 000 and one at 44 100.
    expect(holds(48000) / holds(44100)).toBeCloseTo(1, 1)
  })
})
