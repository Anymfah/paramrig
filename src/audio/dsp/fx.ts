import type { FxSlot, Stereo } from '../types.ts'
import { allpass, line, readAt, write, type Line } from './delayline.ts'

/**
 * The master effects, one slot at a time.
 *
 * They used to be a single loop with the flanger, the delay and the reverb written into it in that
 * order, their state living in closure variables. There was no interface, so nothing could be
 * swapped, reordered, or had twice — a patch that wanted a chorus could not have one, and a patch
 * that wanted no flanger still paid for the branch. Each kind is a unit here: a state built once,
 * a function that answers one sample, and no allocation in between.
 *
 * Every unit writes into `wetL` and `wetR` on its own state rather than returning a pair, because
 * returning `{ left, right }` per sample is a fresh object per sample per slot, and this loop runs
 * on every sample of every render.
 */

const REFERENCE_RATE = 44100

/** Mutually prime-ish, so the network's echoes do not line up into a pattern. */
const LINES = [0.0297, 0.0371, 0.0411, 0.0437]
/** Slow, and all different, so no two lines wobble together. */
const WOBBLE = [0.11, 0.17, 0.23, 0.29]
/** Short allpasses that smear the input before it reaches the network. */
const DIFFUSION = [0.0043, 0.0077, 0.0113, 0.0151]
/** How many stages a phaser sweeps. Four is the classic; six is the one that sounds expensive. */
const PHASER_STAGES = 6
/** Where the notches travel between, in hertz — the range a phaser is recognisable over. */
const PHASER_LOW = 200
const PHASER_HIGH = 8000

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export type FxUnit = {
  wetL: number
  wetR: number
  /** Two delay lines, one a side, for whichever kind needs them. */
  pair: Line[]
  /** The reverb's four, and what each of them held last time round. */
  net: Line[]
  held: number[]
  /** Where the four lines are read this sample. Kept on the unit because a fresh array and a
      fresh closure per sample is a third of what the reverb costs, and this file's own opening
      line says there is no allocation between samples. */
  taps: Float64Array
  diffusers: Line[]
  /** The phaser's poles, one array a side, and what came back round. */
  poles: Float64Array
  backL: number
  backR: number
  /** Whatever the reverb worked out once and would otherwise work out per sample. */
  feedback: number
  makeup: number
  wobble: number
  delaySamples: number
}

export function createFxUnit(slot: FxSlot, sampleRate: number): FxUnit {
  const unit: FxUnit = {
    wetL: 0, wetR: 0,
    pair: [], net: [], held: [0, 0, 0, 0], diffusers: [], taps: new Float64Array(4),
    poles: new Float64Array(PHASER_STAGES * 2),
    backL: 0, backR: 0,
    feedback: 0, makeup: 1, wobble: 0, delaySamples: 1,
  }
  if (slot.kind === 'flanger' || slot.kind === 'chorus') {
    unit.pair = [line(0.05 * sampleRate + 4), line(0.05 * sampleRate + 4)]
  }
  if (slot.kind === 'delay') {
    unit.delaySamples = Math.max(1, Math.round(Math.max(0.001, slot.time) * sampleRate))
    unit.pair = [line(unit.delaySamples + 2), line(unit.delaySamples + 2)]
  }
  if (slot.kind === 'reverb') {
    const scale = (sampleRate / REFERENCE_RATE) * (0.55 + clamp01(slot.size) * 1.1)
    unit.net = LINES.map((seconds) => line(seconds * REFERENCE_RATE * scale + 8))
    unit.diffusers = DIFFUSION.map((seconds) => line(seconds * sampleRate))
    // Long enough to be a tail, short enough that it fits in a sound. The top of this knob used to
    // put the loop at 0.98 while the lines were also at their longest, and the two multiply: the
    // tail ran seventeen seconds, where the longest patch this instrument can render is four. The
    // top forty per cent of the knob did not make a longer reverb, it made the same one cut off
    // harder by the fade — a chop, not a decay. It now tops out at about four seconds.
    unit.feedback = 0.72 + clamp01(slot.size) * 0.2
    unit.makeup = Math.sqrt(1 - unit.feedback * unit.feedback)
    unit.wobble = 2.5 * (sampleRate / REFERENCE_RATE)
  }
  return unit
}

/**
 * One slot on one sample, in two channels, into `unit.wetL` and `unit.wetR`.
 *
 * `at` is the sample index, which the sweeping kinds read their own clock from — the same clock
 * for both channels, so a stereo sweep stays a sweep and does not turn into two of them. `width`
 * is the master's, which is how far apart the two channels are held.
 */
export function fxSample(unit: FxUnit, slot: FxSlot, left: number, right: number, at: number, sampleRate: number, width: number): void {
  if (slot.kind === 'flanger' || slot.kind === 'chorus') {
    // The same delay on both sides, a quarter cycle apart, which is what widens it. A chorus is a
    // flanger that has been moved far enough down the line to stop sounding like a comb: at half a
    // millisecond it is metal, at fifteen it is two players who cannot quite agree.
    const chorus = slot.kind === 'chorus'
    const base = (chorus ? 0.012 : 0.0005) * sampleRate
    // Two milliseconds on a flanger, six on a chorus. Both arms of this used to read 0.006, which is
    // half an unfinished edit: the base delays were separated and the spans were not, so a flanger
    // whose base is half a millisecond swept out to six and a half — thirteen times its own base,
    // its first notch walking from a kilohertz down to seventy-seven hertz — and stopped being a
    // flanger at the top of the Depth knob. A comb stays a comb across the whole range now.
    const span = (chorus ? 0.006 : 0.002) * sampleRate * clamp01(slot.depth)
    const turn = (2 * Math.PI * slot.rate * at) / sampleRate
    const offset = width * 0.25 * Math.PI * 2
    const back = chorus ? 0 : Math.min(0.95, Math.max(0, slot.feedback))
    const wetL = readAt(unit.pair[0]!, base + span * (Math.sin(turn) + 1) * 0.5)
    const wetR = readAt(unit.pair[1]!, base + span * (Math.sin(turn + offset) + 1) * 0.5)
    write(unit.pair[0]!, left + wetL * back)
    write(unit.pair[1]!, right + wetR * back)
    unit.wetL = wetL
    unit.wetR = wetR
    return
  }

  if (slot.kind === 'phaser') {
    /*
     * Six one-pole allpasses a side, all swept together, plus what came back round.
     *
     * A phaser is not a flanger with a different delay: it moves a handful of notches that are not
     * evenly spaced, where a flanger moves a comb that is. That is why one sounds like an aeroplane
     * and the other like a jet, and why this is written out rather than borrowed from the pair above.
     */
    const turn = (2 * Math.PI * slot.rate * at) / sampleRate
    /*
     * The sweep is a frequency, and it is pre-warped before it becomes a coefficient.
     *
     * It used to be a bare number between 0.02 and 0.98 dropped straight into the bilinear form,
     * where it stands in for tan(pi·fc/fs) — which means the notches sat at a fixed fraction of
     * the sample rate and moved with it. The same patch phased at 1.9 kHz on a 44.1 machine and
     * 2.0 on a 48, was drawn on the thumbnail at 16 kHz nearly two octaves below what anyone
     * heard, and was levelled by the randomiser against a third figure again. Everything else in
     * this file is written in seconds; this is written in hertz for the same reason.
     */
    const hz = PHASER_LOW * Math.pow(PHASER_HIGH / PHASER_LOW, 0.5 + 0.48 * clamp01(slot.depth) * Math.sin(turn))
    const warped = Math.tan((Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate)
    const coefficient = (1 - warped) / (1 + warped)
    /*
     * Taken back round with a minus.
     *
     * Six allpasses have a phase of zero at DC — each stage passes it untouched — so a plus makes
     * the loop purely regenerative down there, at a gain of 1/(1 − feed) that has nothing to do
     * with where the notches are. The Feed knob was a thirteen-decibel bass boost that did not
     * move with the sweep, and then the master limiter squashed what it made. Inverted, the
     * resonances land on the notches and travel with them, which is what the knob is for.
     */
    const back = Math.min(0.9, Math.max(0, slot.feedback))
    let l = left - unit.backL * back
    let r = right - unit.backR * back
    for (let stage = 0; stage < PHASER_STAGES; stage += 1) {
      const kept = unit.poles[stage] ?? 0
      const outL = -coefficient * l + kept
      unit.poles[stage] = l + coefficient * outL
      l = outL
      const keptR = unit.poles[PHASER_STAGES + stage] ?? 0
      const outR = -coefficient * r + keptR
      unit.poles[PHASER_STAGES + stage] = r + coefficient * outR
      r = outR
    }
    unit.backL = l
    unit.backR = r
    unit.wetL = l
    unit.wetR = r
    return
  }

  if (slot.kind === 'delay') {
    const wetL = readAt(unit.pair[0]!, unit.delaySamples)
    const wetR = readAt(unit.pair[1]!, unit.delaySamples)
    const back = Math.min(0.95, Math.max(0, slot.feedback))
    // Crossed by the width: at zero it is two independent delays, at one a full ping-pong.
    write(unit.pair[0]!, left + (wetR * width + wetL * (1 - width)) * back)
    write(unit.pair[1]!, right + (wetL * width + wetR * (1 - width)) * back)
    unit.wetL = wetL
    unit.wetR = wetR
    return
  }

  if (slot.kind === 'reverb') {
    let seed = (left + right) * 0.5
    for (const diffuser of unit.diffusers) seed = allpass(diffuser, seed, 0.62)
    const damping = Math.min(0.95, Math.max(0, slot.damping))
    const taps = unit.taps
    for (let n = 0; n < 4; n += 1) {
      const l = unit.net[n]!
      const moved = Math.sin((2 * Math.PI * WOBBLE[n]! * at) / sampleRate) * unit.wobble
      taps[n] = readAt(l, l.buffer.length - 8 + moved)
    }
    // Householder: every line receives the sum of all four, less twice itself. Energy put into one
    // of them is spread across all of them within two passes.
    const sum = (taps[0]! + taps[1]! + taps[2]! + taps[3]!) * 0.5
    for (let n = 0; n < 4; n += 1) {
      const mixed = sum - taps[n]!
      unit.held[n] = mixed * (1 - damping) + unit.held[n]! * damping
      write(unit.net[n]!, seed * INJECT + unit.held[n]! * unit.feedback)
    }
    // Opposite pairs to each side, so the two channels hear different rooms.
    const roomL = (taps[0]! + taps[2]!) * 0.5 * unit.makeup
    const roomR = (taps[1]! + taps[3]!) * 0.5 * unit.makeup
    const mid = (roomL + roomR) * 0.5
    unit.wetL = mid + (roomL - mid) * width
    unit.wetR = mid + (roomR - mid) * width
    return
  }

  if (slot.kind === 'widener') {
    // Mid and side, with the side lifted: the one honest way to widen a stereo image, and the one
    // that still sums to something when a phone plays it in mono, because the mid is untouched.
    const moved = slot.rate > 0 ? 1 + 0.5 * Math.sin((2 * Math.PI * slot.rate * at) / sampleRate) : 1
    const spread = 1 + clamp01(slot.width) * 2 * moved
    const mid = (left + right) * 0.5
    const side = (left - right) * 0.5 * spread
    unit.wetL = mid + side
    unit.wetR = mid - side
    return
  }

  unit.wetL = left
  unit.wetR = right
}

/*
 * Two normalisations, and without them the mix control lies.
 *
 * The input is divided across the four lines rather than handed to each of them whole, because
 * feeding one signal into four places multiplies its energy by four before the network has done
 * anything. And the output is scaled by the loop's own steady-state gain: a network with this much
 * feedback is a room that takes two seconds to decay, and a sustained sound in such a room builds
 * up about ninefold, which is physically right and means a "mix" of a quarter was in fact burying
 * the dry signal under nine times its own level.
 */
const INJECT = 1 / Math.sqrt(4)

/**
 * The three slots and the tone control, over the whole buffer.
 *
 * An insert replaces the sound in proportion to its mix; a send is added on top and leaves the dry
 * where it was. That is the difference between an effect and an effect you can hear the sound
 * through, and it is why the delay and the reverb are sends: what a room does is not instead of
 * the sound, it is as well as it.
 */
export function applyFx(input: Stereo, fx: { x: FxSlot; y: FxSlot; z: FxSlot; tone: number; width: number }, sampleRate: number): Stereo {
  const length = input.left.length
  const outL = new Float32Array(length)
  const outR = new Float32Array(length)
  const width = clamp01(fx.width)

  const slots = [fx.x, fx.y, fx.z].filter((slot) => slot.kind !== 'off' && clamp01(slot.mix) > 0)
  const units = slots.map((slot) => createFxUnit(slot, sampleRate))

  // --- tone: one pole a side, tilting the balance rather than cutting a band ---
  const toneG = Math.exp((-2 * Math.PI * 700) / sampleRate)
  const tone = Math.min(1, Math.max(-1, fx.tone))
  const lowGain = tone <= 0 ? 1 : 1 - tone * 0.7
  const highGain = tone >= 0 ? 1 : 1 + tone * 0.7
  let lowL = 0
  let lowR = 0

  for (let i = 0; i < length; i += 1) {
    let left = input.left[i] ?? 0
    let right = input.right[i] ?? 0

    for (let at = 0; at < slots.length; at += 1) {
      const slot = slots[at]!
      const unit = units[at]!
      const mix = clamp01(slot.mix)
      fxSample(unit, slot, left, right, i, sampleRate, width)
      if (slot.mode === 'send') {
        left += unit.wetL * mix
        right += unit.wetR * mix
      } else {
        left = left * (1 - mix) + unit.wetL * mix
        right = right * (1 - mix) + unit.wetR * mix
      }
    }

    lowL = left * (1 - toneG) + lowL * toneG
    lowR = right * (1 - toneG) + lowR * toneG
    outL[i] = lowL * lowGain + (left - lowL) * highGain
    outR[i] = lowR * lowGain + (right - lowR) * highGain
  }

  return { left: outL, right: outR }
}
