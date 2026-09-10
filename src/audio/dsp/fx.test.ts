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
