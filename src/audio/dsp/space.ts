import type { FxSettings } from '../types.ts'

/**
 * The shared tail: flanger, delay, a small room, and one tilt control for the whole thing.
 *
 * These are the effects a short sound actually wants. There is no EQ curve here on purpose — a
 * generator of interface clicks that asks you to sculpt bands has already lost the argument about
 * being easy. One knob leans dark or bright and that is the whole tone section.
 */

/** Freeverb's comb and allpass lengths, given at its own rate and rescaled to ours. */
const COMBS = [1116, 1188, 1277, 1356]
const ALLPASSES = [556, 441]
const REFERENCE_RATE = 44100

type Line = { buffer: Float32Array; index: number }

function line(length: number): Line {
  return { buffer: new Float32Array(Math.max(1, Math.round(length))), index: 0 }
}

/** Reads `delay` samples back, interpolating, so a modulated delay glides instead of stepping. */
function readAt(l: Line, delay: number): number {
  const size = l.buffer.length
  const want = Math.min(size - 1, Math.max(0, delay))
  const back = l.index - want
  const at = back < 0 ? back + size : back
  const i0 = Math.floor(at)
  const frac = at - i0
  const a = l.buffer[i0 % size] ?? 0
  const b = l.buffer[(i0 + 1) % size] ?? 0
  return a + (b - a) * frac
}

function write(l: Line, value: number): void {
  l.buffer[l.index] = value
  l.index = (l.index + 1) % l.buffer.length
}

/**
 * Applied to the whole mix at once rather than per layer, which is both cheaper and truer to how
 * these sounds are built: the layers are one voice, and one voice sits in one room.
 */
export function applyFx(input: Float32Array, fx: FxSettings, sampleRate: number): Float32Array {
  const out = new Float32Array(input.length)
  const scale = sampleRate / REFERENCE_RATE

  const flangerLine = line(Math.ceil(0.02 * sampleRate) + 4)
  const flangerDepth = Math.min(1, Math.max(0, fx.flangerDepth))
  const flangerMix = Math.min(1, Math.max(0, fx.flangerMix))
  const flangerBase = 0.0005 * sampleRate
  const flangerSpan = 0.006 * sampleRate * flangerDepth

  const delaySamples = Math.max(1, Math.round(Math.max(0.001, fx.delayTime) * sampleRate))
  const delayLine = line(delaySamples + 2)
  const delayFeedback = Math.min(0.95, Math.max(0, fx.delayFeedback))
  const delayMix = Math.min(1, Math.max(0, fx.delayMix))

  const combs = COMBS.map((n) => line(n * scale))
  const combStores = COMBS.map(() => 0)
  const allpasses = ALLPASSES.map((n) => line(n * scale))
  const reverbMix = Math.min(1, Math.max(0, fx.reverbMix))
  const damping = Math.min(0.95, Math.max(0, fx.reverbDamping))
  const feedback = 0.7 + Math.min(1, Math.max(0, fx.reverbSize)) * 0.28

  const tone = Math.min(1, Math.max(-1, fx.tone))
  const toneG = Math.exp((-2 * Math.PI * 700) / sampleRate)
  const lowGain = tone <= 0 ? 1 : 1 - tone * 0.7
  const highGain = tone >= 0 ? 1 : 1 + tone * 0.7
  let toneLow = 0

  for (let i = 0; i < input.length; i += 1) {
    let value = input[i] ?? 0

    if (flangerMix > 0 && flangerDepth > 0) {
      const lfo = (Math.sin((2 * Math.PI * fx.flangerRate * i) / sampleRate) + 1) * 0.5
      const wet = readAt(flangerLine, flangerBase + flangerSpan * lfo)
      write(flangerLine, value + wet * 0.4)
      value = value * (1 - flangerMix) + wet * flangerMix
    }

    if (delayMix > 0) {
      const wet = readAt(delayLine, delaySamples)
      write(delayLine, value + wet * delayFeedback)
      value = value + wet * delayMix
    }

    if (reverbMix > 0) {
      let room = 0
      for (let c = 0; c < combs.length; c += 1) {
        const l = combs[c]
        if (!l) continue
        const read = readAt(l, l.buffer.length - 1)
        const store = read * (1 - damping) + (combStores[c] ?? 0) * damping
        combStores[c] = store
        write(l, value + store * feedback)
        room += read
      }
      room /= combs.length
      for (const l of allpasses) {
        const read = readAt(l, l.buffer.length - 1)
        const next = -room + read
        write(l, room + read * 0.5)
        room = next
      }
      value = value * (1 - reverbMix) + room * reverbMix
    }

    toneLow = value * (1 - toneG) + toneLow * toneG
    const high = value - toneLow
    out[i] = toneLow * lowGain + high * highGain
  }

  return out
}
