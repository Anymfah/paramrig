import { describe, expect, it } from 'vitest'
import type { FxKind, FxSlot, Stereo } from '@/audio/types'
import { applyFx, createFxUnit, fxSample } from '@/audio/dsp/fx'
import { makeFxSlot } from '@/audio/patch'

const RATE = 22050
const KINDS: FxKind[] = ['off', 'flanger', 'chorus', 'phaser', 'delay', 'reverb', 'widener']

/** A short burst, then silence: the half of an effect that matters is what it does afterwards. */
function burst(seconds = 0.4): Stereo {
  const total = Math.round(seconds * RATE)
  const left = new Float32Array(total)
  const right = new Float32Array(total)
  for (let i = 0; i < total; i += 1) {
    const gate = i < total * 0.15 ? 1 : 0
    left[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * gate
    right[i] = Math.sin((2 * Math.PI * 227 * i) / RATE) * gate
  }
  return { left, right }
}

const master = (over: Partial<{ x: Partial<FxSlot>; y: Partial<FxSlot>; z: Partial<FxSlot>; tone: number; width: number }> = {}) => ({
  x: makeFxSlot(over.x), y: makeFxSlot(over.y), z: makeFxSlot(over.z),
  tone: over.tone ?? 0, width: over.width ?? 0.6,
})

const energy = (out: Stereo) => {
  let sum = 0
  for (let at = 0; at < out.left.length; at += 1) sum += (out.left[at] ?? 0) ** 2 + (out.right[at] ?? 0) ** 2
  return sum
}

/** How much of the sound is left in the last third, which is where a tail lives. */
const tail = (out: Stereo) => {
  let sum = 0
  for (let at = Math.floor(out.left.length * 0.66); at < out.left.length; at += 1) sum += Math.abs(out.left[at] ?? 0)
  return sum
}

describe('the master effects', () => {
  it('hands the sound straight through when all three slots are empty', () => {
    const input = burst()
    const out = applyFx(input, master(), RATE)
    for (let at = 0; at < input.left.length; at += 1) {
      expect(out.left[at]).toBeCloseTo(input.left[at] ?? 0, 5)
      expect(out.right[at]).toBeCloseTo(input.right[at] ?? 0, 5)
    }
  })

  it('is a true bypass at no mix, whatever a slot is set to', () => {
    const input = burst()
    for (const kind of KINDS) {
      const out = applyFx(input, master({ x: { kind, mix: 0 } }), RATE)
      for (let at = 0; at < input.left.length; at += 1) expect(out.left[at], kind).toBeCloseTo(input.left[at] ?? 0, 5)
    }
  })

  it('gives the delay and the reverb a tail, which is the whole point of them', () => {
    const dry = tail(applyFx(burst(), master(), RATE))
    expect(tail(applyFx(burst(), master({ y: { kind: 'delay', mode: 'send', mix: 0.6, time: 0.05, feedback: 0.6 } }), RATE))).toBeGreaterThan(dry * 4)
    expect(tail(applyFx(burst(), master({ z: { kind: 'reverb', mode: 'send', mix: 0.6, size: 0.7 } }), RATE))).toBeGreaterThan(dry * 4)
  })

  it('leaves the dry sound alone on a send and takes it away on an insert', () => {
    const input = burst()
    const sent = applyFx(input, master({ x: { kind: 'reverb', mode: 'send', mix: 1 } }), RATE)
    const inserted = applyFx(input, master({ x: { kind: 'reverb', mode: 'insert', mix: 1 } }), RATE)
    // Fully wet as an insert, the burst itself is gone; as a send it is still there with a room on it.
    let early = 0
    let earlySent = 0
    for (let at = 0; at < input.left.length * 0.1; at += 1) {
      early += Math.abs(inserted.left[at] ?? 0)
      earlySent += Math.abs(sent.left[at] ?? 0)
    }
    expect(earlySent).toBeGreaterThan(early * 1.5)
  })

  it('runs the three in order, so two of them are not the same as one', () => {
    const one = energy(applyFx(burst(), master({ x: { kind: 'flanger', mix: 0.7, depth: 0.8 } }), RATE))
    const two = energy(applyFx(burst(), master({
      x: { kind: 'flanger', mix: 0.7, depth: 0.8 },
      y: { kind: 'phaser', mix: 0.7, depth: 0.8 },
    }), RATE))
    expect(Math.abs(two - one)).toBeGreaterThan(one * 0.01)
  })

  it('pushes the channels apart when it is asked to widen them, and never in mono', () => {
    const apart = (out: Stereo) => {
      let sum = 0
      for (let at = 0; at < out.left.length; at += 1) sum += Math.abs((out.left[at] ?? 0) - (out.right[at] ?? 0))
      return sum
    }
    const dry = burst()
    expect(apart(applyFx(dry, master({ x: { kind: 'widener', mix: 1, width: 1, rate: 0 } }), RATE))).toBeGreaterThan(apart(dry) * 1.5)
    // A widener on a mono signal has nothing to push apart, and inventing something would be a lie.
    const mono: Stereo = { left: dry.left, right: dry.left }
    const out = applyFx(mono, master({ x: { kind: 'widener', mix: 1, width: 1, rate: 0 } }), RATE)
    for (let at = 0; at < mono.left.length; at += 1) expect(out.left[at]).toBeCloseTo(out.right[at] ?? 0, 6)
  })

  it('stays finite and stays put through every kind at everything at once', () => {
    for (const kind of KINDS) {
      const out = applyFx(burst(), master({
        x: { kind, mix: 1, rate: 8, depth: 1, feedback: 0.95, time: 0.001, size: 1, damping: 0, width: 1 },
        tone: 1,
      }), RATE)
      for (const value of out.left) {
        expect(Number.isFinite(value), kind).toBe(true)
        expect(Math.abs(value), kind).toBeLessThan(20)
      }
    }
  })

  it('answers the same sample twice for the same state, since nothing here reads a clock', () => {
    const slot = makeFxSlot({ kind: 'phaser', mix: 1, rate: 3, depth: 0.7, feedback: 0.5 })
    const a = createFxUnit(slot, RATE)
    const b = createFxUnit(slot, RATE)
    for (let at = 0; at < 200; at += 1) {
      fxSample(a, slot, Math.sin(at * 0.1), Math.cos(at * 0.1), at, RATE, 0.6)
      fxSample(b, slot, Math.sin(at * 0.1), Math.cos(at * 0.1), at, RATE, 0.6)
      expect(a.wetL).toBe(b.wetL)
      expect(a.wetR).toBe(b.wetR)
    }
  })
})

/**
 * Three things the slot rack promises and nothing was checking: that the order of the slots is the
 * order of the chain, that the master width reaches the kinds that read it, and that a patch is
 * the same effect on a machine running at another rate.
 */
describe('the rack', () => {
  it('chains x, then y, then z — the same pair swapped is a different sound', () => {
    const drive = { kind: 'reverb' as const, mode: 'insert' as const, mix: 0.8, size: 0.4, damping: 0.3 }
    const sweep = { kind: 'flanger' as const, mode: 'insert' as const, mix: 0.8, depth: 0.9, rate: 1.5, feedback: 0.6 }
    const first = applyFx(burst(), master({ x: drive, y: sweep }), RATE)
    const second = applyFx(burst(), master({ x: sweep, y: drive }), RATE)
    let biggest = 0
    for (let at = 0; at < first.left.length; at += 1) biggest = Math.max(biggest, Math.abs((first.left[at] ?? 0) - (second.left[at] ?? 0)))
    expect(biggest).toBeGreaterThan(0.01)
  })

  it('hands the master width to the kinds that read it', () => {
    const apart = (out: Stereo) => {
      let sum = 0
      for (let at = 0; at < out.left.length; at += 1) sum += Math.abs((out.left[at] ?? 0) - (out.right[at] ?? 0))
      return sum
    }
    for (const kind of ['delay', 'reverb'] as const) {
      const narrow = applyFx(burst(), { ...master({ x: { kind, mode: 'insert', mix: 1, time: 0.05, feedback: 0.5 } }), width: 0 }, RATE)
      const wide = applyFx(burst(), { ...master({ x: { kind, mode: 'insert', mix: 1, time: 0.05, feedback: 0.5 } }), width: 1 }, RATE)
      expect(apart(wide), kind).not.toBeCloseTo(apart(narrow), 3)
    }
  })

  /**
   * The phaser used to be the one kind written in fractions of the sample rate rather than in
   * hertz, so the same patch phased two octaves lower on a thumbnail than in the room. Measured
   * by where the response dips: a notch is a frequency, and a frequency does not move with a rate.
   */
  it('puts a phaser’s notches at the same frequencies whatever the rate', () => {
    const response = (rate: number) => {
      const slot = makeFxSlot({ kind: 'phaser', mode: 'insert', mix: 0.5, rate: 0, depth: 0, feedback: 0 })
      const levels: number[] = []
      // Up to 2.2 kHz, which at 22 050 is still a tenth of the way from the top: a first-order
      // allpass's own phase runs out near Nyquist, and comparing there measures the model rather
      // than the tuning. Below it the two curves agree to about a hundredth; when the sweep was a
      // fraction of the rate they were an octave apart and nothing here was close.
      for (let hz = 200; hz <= 2200; hz += 100) {
        const unit = createFxUnit(slot, rate)
        const total = Math.round(rate * 0.2)
        let peak = 0
        for (let at = 0; at < total; at += 1) {
          const value = Math.sin((2 * Math.PI * hz * at) / rate)
          fxSample(unit, slot, value, value, at, rate, 0.6)
          if (at > total * 0.5) peak = Math.max(peak, Math.abs(value * 0.5 + unit.wetL * 0.5))
        }
        levels.push(peak)
      }
      return levels
    }
    const low = response(22050)
    const high = response(44100)
    // The whole curve, not the deepest point: a phaser has several notches and which one is
    // deepest is a coin toss between two that are within a percent of each other.
    low.forEach((level, at) => expect(Math.abs(level - (high[at] ?? 0)), `${200 + at * 100} Hz`).toBeLessThan(0.03))
  })
})
