import type { FxSettings, Stereo } from '../types.ts'
import { allpass, line, readAt, write } from './delayline.ts'

/**
 * The shared tail, in two channels.
 *
 * The reverb here used to be four comb filters and two allpasses — the cheapest arrangement there
 * is, and it sounds like it: a short metallic ring with an obvious period, which is most of what
 * makes a synthesised effect read as amateur. What replaces it is a feedback delay network. Four
 * lines are mixed into each other every time round by a Householder matrix, so energy that enters
 * any one of them is spread across all four within a couple of passes and the echo pattern stops
 * being countable. Each line is damped on its way round, because a real room loses its top end
 * before it loses its bottom.
 *
 * The line lengths are modulated by a few samples at rates under a hertz. That small movement is
 * what removes the last of the metal: a fixed network still rings at the frequencies its lengths
 * happen to share, and nudging them smears those into nothing.
 */

const REFERENCE_RATE = 44100

/** Mutually prime-ish, so the network's echoes do not line up into a pattern. */
const LINES = [0.0297, 0.0371, 0.0411, 0.0437]
/** Slow, and all different, so no two lines wobble together. */
const WOBBLE = [0.11, 0.17, 0.23, 0.29]
/** Short allpasses that smear the input before it reaches the network. */
const DIFFUSION = [0.0043, 0.0077, 0.0113, 0.0151]

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export function applyFx(input: Stereo, fx: FxSettings, sampleRate: number): Stereo {
  const length = input.left.length
  const outL = new Float32Array(length)
  const outR = new Float32Array(length)
  const width = clamp01(fx.width)

  // --- flanger: the same delay on both sides, a quarter cycle apart, which is what widens it ---
  const flangerMix = clamp01(fx.flangerMix)
  const flangerDepth = clamp01(fx.flangerDepth)
  const flangerLines = [line(0.02 * sampleRate + 4), line(0.02 * sampleRate + 4)]
  const flangerBase = 0.0005 * sampleRate
  const flangerSpan = 0.006 * sampleRate * flangerDepth

  // --- delay: each side feeds the other, so a repeat crosses the room ---
  const delaySamples = Math.max(1, Math.round(Math.max(0.001, fx.delayTime) * sampleRate))
  const delayLines = [line(delaySamples + 2), line(delaySamples + 2)]
  const delayFeedback = Math.min(0.95, Math.max(0, fx.delayFeedback))
  const delayMix = clamp01(fx.delayMix)

  // --- the network ---
  const reverbMix = clamp01(fx.reverbMix)
  const size = clamp01(fx.reverbSize)
  const damping = Math.min(0.95, Math.max(0, fx.reverbDamping))
  const scale = (sampleRate / REFERENCE_RATE) * (0.55 + size * 1.1)
  const net = LINES.map((seconds) => line(seconds * REFERENCE_RATE * scale + 8))
  const held = [0, 0, 0, 0]
  const diffusers = DIFFUSION.map((seconds) => line(seconds * sampleRate))
  // Long enough to be a tail, short enough that a half-second effect is not still ringing.
  const feedback = 0.72 + size * 0.26
  const wobbleDepth = 2.5 * (sampleRate / REFERENCE_RATE)
  /*
   * Two normalisations, and without them the mix control lies.
   *
   * The input is divided across the four lines rather than handed to each of them whole, because
   * feeding one signal into four places multiplies its energy by four before the network has done
   * anything. And the output is scaled by the loop's own steady-state gain: a network with this
   * much feedback is a room that takes two seconds to decay, and a sustained sound in such a room
   * builds up about ninefold, which is physically right and means a "mix" of a quarter was in fact
   * burying the dry signal under nine times its own level.
   */
  const inject = 1 / Math.sqrt(4)
  const makeup = Math.sqrt(1 - feedback * feedback)

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

    if (flangerMix > 0 && flangerDepth > 0) {
      const turn = (2 * Math.PI * fx.flangerRate * i) / sampleRate
      const offset = width * 0.25 * Math.PI * 2
      const wetL = readAt(flangerLines[0]!, flangerBase + flangerSpan * (Math.sin(turn) + 1) * 0.5)
      const wetR = readAt(flangerLines[1]!, flangerBase + flangerSpan * (Math.sin(turn + offset) + 1) * 0.5)
      write(flangerLines[0]!, left + wetL * 0.4)
      write(flangerLines[1]!, right + wetR * 0.4)
      left = left * (1 - flangerMix) + wetL * flangerMix
      right = right * (1 - flangerMix) + wetR * flangerMix
    }

    if (delayMix > 0) {
      const wetL = readAt(delayLines[0]!, delaySamples)
      const wetR = readAt(delayLines[1]!, delaySamples)
      // Crossed by the width: at zero it is two independent delays, at one a full ping-pong.
      write(delayLines[0]!, left + (wetR * width + wetL * (1 - width)) * delayFeedback)
      write(delayLines[1]!, right + (wetL * width + wetR * (1 - width)) * delayFeedback)
      left += wetL * delayMix
      right += wetR * delayMix
    }

    if (reverbMix > 0) {
      let seed = (left + right) * 0.5
      for (const diffuser of diffusers) seed = allpass(diffuser, seed, 0.62)

      const taps = [0, 1, 2, 3].map((n) => {
        const l = net[n]!
        const wobble = Math.sin((2 * Math.PI * WOBBLE[n]! * i) / sampleRate) * wobbleDepth
        return readAt(l, l.buffer.length - 8 + wobble)
      })
      // Householder: every line receives the sum of all four, less twice itself. Energy put into
      // one of them is spread across all of them within two passes.
      const sum = (taps[0]! + taps[1]! + taps[2]! + taps[3]!) * 0.5
      for (let n = 0; n < 4; n += 1) {
        const mixed = sum - taps[n]!
        held[n] = mixed * (1 - damping) + held[n]! * damping
        write(net[n]!, seed * inject + held[n]! * feedback)
      }
      // Opposite pairs to each side, so the two channels hear different rooms.
      const roomL = (taps[0]! + taps[2]!) * 0.5 * makeup
      const roomR = (taps[1]! + taps[3]!) * 0.5 * makeup
      const mid = (roomL + roomR) * 0.5
      left = left * (1 - reverbMix) + (mid + (roomL - mid) * width) * reverbMix
      right = right * (1 - reverbMix) + (mid + (roomR - mid) * width) * reverbMix
    }

    lowL = left * (1 - toneG) + lowL * toneG
    lowR = right * (1 - toneG) + lowR * toneG
    outL[i] = lowL * lowGain + (left - lowL) * highGain
    outR[i] = lowR * lowGain + (right - lowR) * highGain
  }

  return { left: outL, right: outR }
}
