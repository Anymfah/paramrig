import type { AudioPatch, Layer, Lfo, MasterSettings } from './types.ts'
import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import type { FxInput } from './patch.ts'
import { makeLayer, makePatch } from './patch.ts'
import * as ui from './presets-interface.ts'
import * as fx from './presets-series.ts'
import * as morph from './presets-morph.ts'
import * as show from './presets-showcase.ts'

export { makeFx, makeLayer, makeMaster, makePatch, silentLayer } from './patch.ts'

/**
 * The starting points. A generator with seventy parameters and no presets is a synthesiser, and a
 * synthesiser is exactly what someone reaching for a button click does not want to learn. These
 * are the sounds people actually come to make; every one of them is a normal patch, so the first
 * gesture after loading one is to change it.
 */

function patch(duration: number, layers: Layer[], fx: FxInput = {}, master: Partial<MasterSettings> = {}, lfos: Partial<Lfo>[] = []): AudioPatch {
  return makePatch(duration, layers, fx, master, 1, lfos)
}

/** Square, and a jump to a fifth part-way through. The arpeggio is the whole trick. */
export function coin(): AudioPatch {
  return patch(0.45, [
    makeLayer({
      gain: 0.55,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.5 },
      pitch: { start: 988, arpeggioRatio: 1.5, arpeggioAt: 0.26, jitter: 10 },
      amp: { attack: 0.004, hold: 0.03, decay: 0.26, sustain: 0, release: 0.09, curve: 2.2 },
    }),
  ], { tone: 0.2 }, { gain: 1.339213 })
}

/** A saw falling three octaves with the filter chasing it down, plus a breath of noise on the front. */
export function laser(): AudioPatch {
  return patch(0.35, [
    makeLayer({
      gain: 0.7,
      spread: 0.75,
      source: { kind: 'tone', wave: 'saw', voices: 3, detune: 16 },
      pitch: { start: 1400, slide: -36, slideCurve: EASE_OUT, jitter: 15 },
      filter: { kind: 'lowpass', cutoff: 5000, resonance: 0.35, envAmount: -2.2, envCurve: EASE_OUT },
      amp: { attack: 0.001, hold: 0, decay: 0.22, sustain: 0, release: 0.07, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.16,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2200, resonance: 0.2 },
      amp: { attack: 0.001, hold: 0, decay: 0.045, sustain: 0, release: 0.01, curve: 2.5 },
    }),
  ], { tone: 0.1 }, { gain: 0.746133 })
}

/** Three layers doing three jobs: the crack, the body, the roar. */
export function explosion(): AudioPatch {
  return patch(1.5, [
    makeLayer({
      gain: 0.85,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'lowpass', cutoff: 2600, resonance: 0.12, envAmount: -3.4, envCurve: EASE_OUT },
      shaper: { drive: 0.35, bitDepth: 16, crush: 0 },
      amp: { attack: 0.003, hold: 0.03, decay: 0.85, sustain: 0.12, release: 0.45, curve: 2 },
    }),
    makeLayer({
      gain: 0.5,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 95, slide: -20, slideCurve: EASE_OUT },
      amp: { attack: 0.002, hold: 0.01, decay: 0.5, sustain: 0, release: 0.2, curve: 2.2 },
    }),
    makeLayer({
      gain: 0.58,
      spread: 0.55,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 5500, resonance: 0.12 },
      amp: { attack: 0.0004, hold: 0.003, decay: 0.045, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { reverbMix: 0.22, reverbSize: 0.7, reverbDamping: 0.5, tone: -0.25 }, { gain: 0.504057, limiter: 0.9 })
}

/**
 * The one that fires two hundred times a session, so it is the shortest thing here and the most
 * carefully made. A body at seven kilohertz decaying in thirty-five milliseconds gives it a pitch
 * without giving it a note, the tick above it is the part the ear reads as "crisp", and the jitter
 * is still what keeps it bearable the two-hundredth time.
 */
export function uiClick(): AudioPatch {
  return patch(0.11, [
    makeLayer({
      gain: 0.55,
      spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2800, resonance: 0.12 },
      resonator: { amount: 1, frequency: 7200, spread: 0.28, decay: 0.035, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.0035, sustain: 0, release: 0.0015, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.22,
      spread: 0.8,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 11000, jitter: 25 },
      filter: { kind: 'highpass', cutoff: 8500, resonance: 0.1 },
      amp: { attack: 0.0002, hold: 0, decay: 0.006, sustain: 0, release: 0.003, curve: 3.2 },
    }),
    makeLayer({
      gain: 0.18,
      source: { kind: 'tone', wave: 'triangle' },
      pitch: { start: 2300, slide: -12, slideCurve: EASE_OUT, jitter: 20 },
      amp: { attack: 0.0005, hold: 0, decay: 0.03, sustain: 0, release: 0.015, curve: 2.6 },
    }),
  ], { tone: 0.3, width: 0.6 }, { gain: 0.495683 })
}

/**
 * Four digital sparks, not a click. The file this is taken from sold itself as a small menu
 * select; what it actually is is one object struck four times — the same band of air, the same
 * 16 kHz needle — in a hundred and twenty milliseconds. Three different bodies was the wrong
 * picture: it made three different clicks.
 *
 * Each layer is white noise in a 5–6 kHz band, with a light 16 kHz ring on top. A 36 ms delay
 * reprints each strike once: the first reprint is the debris the original also has, the third
 * reprint is the fourth tick. Feedback stays low so a fifth never arrives.
 */
export function sparkBurst(): AudioPatch {
  return patch(0.3, [
    makeLayer({
      gain: 1.05,
      spread: 0.7,
      offset: 0.019,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 5600, resonance: 0.13 },
      resonator: { amount: 0.26, frequency: 16000, spread: 0.08, decay: 0.016, partials: 2 },
      amp: { attack: 0.0003, hold: 0.0045, decay: 0.006, sustain: 0, release: 0.002, curve: 2.7 },
    }),
    makeLayer({
      gain: 1.5,
      spread: 0.78,
      offset: 0.066,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 6000, resonance: 0.12, envAmount: 0.5, envCurve: EASE_OUT },
      resonator: { amount: 0.3, frequency: 16000, spread: 0.08, decay: 0.012, partials: 2 },
      amp: { attack: 0.0002, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 3.1 },
    }),
    makeLayer({
      gain: 1.2,
      spread: 0.84,
      offset: 0.104,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 5800, resonance: 0.12 },
      resonator: { amount: 0.3, frequency: 16000, spread: 0.1, decay: 0.012, partials: 2 },
      shaper: { drive: 0.03, bitDepth: 12, crush: 0 },
      amp: { attack: 0.0002, hold: 0.0008, decay: 0.0028, sustain: 0, release: 0.001, curve: 3.2 },
    }),
  ], {
    delayTime: 0.036,
    delayFeedback: 0.1,
    delayMix: 0.62,
    reverbMix: 0.06,
    reverbSize: 0.12,
    reverbDamping: 0.88,
    tone: 0.2,
    width: 0.7,
  }, { gain: 1.155505, fadeOut: 0.014 })
}

/** Rising, and a step up near the end so it reads as an arrival rather than a ramp. */
export function powerup(): AudioPatch {
  return patch(0.6, [
    makeLayer({
      gain: 0.5,
      spread: 0.5,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.35, voices: 2, detune: 9 },
      pitch: { start: 523, slide: 19, slideCurve: EASE_IN, arpeggioRatio: 1.26, arpeggioAt: 0.62, jitter: 8 },
      amp: { attack: 0.006, hold: 0.02, decay: 0.4, sustain: 0.35, release: 0.14, curve: 1.8 },
    }),
  ], { tone: 0.25, delayMix: 0.12, delayTime: 0.09, delayFeedback: 0.25 }, { gain: 0.939436 })
}

/**
 * Band-passed noise swept across the ear, with the flanger doing the movement. The band travels
 * four and a half octaves now rather than three, which carries it to nine kilohertz by the end,
 * and a second wash of white noise opens behind it: the thing being described is moving air, and
 * it ought to contain some.
 */
export function whoosh(): AudioPatch {
  return patch(0.9, [
    makeLayer({
      gain: 1.5,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 400, resonance: 0.55, envAmount: 4.5, envCurve: LINEAR },
      amp: { attack: 0.3, hold: 0.02, decay: 0.35, sustain: 0.2, release: 0.22, curve: 1.6 },
    }),
    makeLayer({
      gain: 0.34,
      spread: 1,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.2, envAmount: 1.6, envCurve: LINEAR },
      amp: { attack: 0.38, hold: 0.02, decay: 0.3, sustain: 0.18, release: 0.24, curve: 1.6 },
    }),
  ], { flangerMix: 0.35, flangerRate: 0.7, flangerDepth: 0.6, reverbMix: 0.15, width: 0.9, tone: 0.05 }, { gain: 1.109853 })
}

/** Short, blunt, and low enough to feel like contact. */
export function hit(): AudioPatch {
  return patch(0.3, [
    makeLayer({
      gain: 0.75,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 1800, resonance: 0.2, envAmount: -2, envCurve: EASE_OUT },
      shaper: { drive: 0.25, bitDepth: 16, crush: 0 },
      amp: { attack: 0.001, hold: 0.01, decay: 0.16, sustain: 0, release: 0.08, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.45,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 160, slide: -14, slideCurve: EASE_OUT },
      amp: { attack: 0.001, hold: 0, decay: 0.14, sustain: 0, release: 0.06, curve: 2.4 },
    }),
  ], { tone: -0.15 }, { gain: 0.667431 })
}

/** A square that climbs. The oldest sound in the medium. */
export function jump(): AudioPatch {
  return patch(0.3, [
    makeLayer({
      gain: 0.5,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.45 },
      pitch: { start: 320, slide: 15, slideCurve: EASE_OUT, jitter: 12 },
      amp: { attack: 0.004, hold: 0.02, decay: 0.18, sustain: 0, release: 0.06, curve: 2 },
    }),
  ], { tone: 0.15 }, { gain: 1.37021 })
}

/**
 * Five that lean the other way from the arcade set: cleaner, colder, longer in the tail. What
 * reads as "future" in a sound effect is mostly three things — inharmonic metal instead of a
 * plain tone, movement in the pitch that a mechanism would not have, and a space around it that
 * the room you are in does not.
 */

/** Metal that will not settle: a struck bar under a tone that keeps sliding under it. */
export function hologram(): AudioPatch {
  return patch(0.7, [
    makeLayer({
      gain: 1.109,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2400, slide: 4, slideCurve: EASE_OUT, vibratoRate: 11, vibratoDepth: 0.6, jitter: 22 },
      filter: { kind: 'bandpass', cutoff: 2600, resonance: 0.35, envAmount: 0.9, envCurve: LINEAR },
      amp: { attack: 0.03, hold: 0.04, decay: 0.3, sustain: 0.25, release: 0.3, curve: 1.7 },
    }),
    makeLayer({
      gain: 0.608,
      spread: 0.7,
      source: { kind: 'tone', wave: 'triangle', voices: 2, detune: 14 },
      pitch: { start: 1180, slide: -2, vibratoRate: 6.5, vibratoDepth: 0.35, jitter: 14 },
      amp: { attack: 0.06, hold: 0.02, decay: 0.25, sustain: 0.3, release: 0.32, curve: 1.6 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 1,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 9200, jitter: 30, vibratoRate: 9, vibratoDepth: 0.25 },
      filter: { kind: 'bandpass', cutoff: 9500, resonance: 0.45 },
      amp: { attack: 0.05, hold: 0.03, decay: 0.28, sustain: 0.28, release: 0.3, curve: 1.6 },
    }),
  ], { flangerMix: 0.42, flangerRate: 0.9, flangerDepth: 0.75, reverbMix: 0.3, reverbSize: 0.75, reverbDamping: 0.35, tone: 0.4 }, { gain: 1.303518 })
}

/** Everything falls at once and the room keeps it. The drop is the whole gesture. */
export function warp(): AudioPatch {
  return patch(1.3, [
    makeLayer({
      gain: 0.6,
      spread: 0.7,
      source: { kind: 'tone', wave: 'saw', voices: 3, detune: 18 },
      pitch: { start: 1900, slide: -34, slideCurve: EASE_OUT, jitter: 12 },
      filter: { kind: 'lowpass', cutoff: 6000, resonance: 0.45, envAmount: -3, envCurve: EASE_OUT },
      amp: { attack: 0.01, hold: 0.03, decay: 0.55, sustain: 0.1, release: 0.5, curve: 1.9 },
    }),
    makeLayer({
      gain: 0.3,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 900, resonance: 0.5, envAmount: -2.2, envCurve: EASE_OUT },
      amp: { attack: 0.02, hold: 0, decay: 0.4, sustain: 0.08, release: 0.45, curve: 2 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.95,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 10500, slide: -30, slideCurve: EASE_OUT, jitter: 20 },
      filter: { kind: 'highpass', cutoff: 5000, resonance: 0.2, envAmount: -1.8, envCurve: EASE_OUT },
      amp: { attack: 0.004, hold: 0.02, decay: 0.35, sustain: 0.06, release: 0.3, curve: 2.2 },
    }),
  ], { reverbMix: 0.36, reverbSize: 0.85, reverbDamping: 0.4, delayMix: 0.14, delayTime: 0.16, delayFeedback: 0.35, tone: -0.15 }, { gain: 1.499538 })
}

/**
 * The sound a panel makes when it agrees with you. The two notes up are the message and they are
 * unchanged; what was missing was the moment before them — three milliseconds of bright body, so
 * the arpeggio arrives at something rather than fading in out of nothing.
 */
export function interfaceConfirm(): AudioPatch {
  return patch(0.5, [
    makeLayer({
      gain: 0.42,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3200, resonance: 0.12 },
      resonator: { amount: 1, frequency: 9000, spread: 0.3, decay: 0.045, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.54,
      spread: 0.5,
      offset: 0.006,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 7 },
      pitch: { start: 1320, arpeggioRatio: 1.5, arpeggioAt: 0.22, jitter: 16 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.14, sustain: 0, release: 0.1, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.17,
      spread: 0.85,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 10500, jitter: 25 },
      filter: { kind: 'highpass', cutoff: 8000, resonance: 0.12 },
      amp: { attack: 0.0002, hold: 0, decay: 0.008, sustain: 0, release: 0.004, curve: 3.2 },
    }),
  ], { delayMix: 0.22, delayTime: 0.085, delayFeedback: 0.4, reverbMix: 0.22, reverbSize: 0.6, width: 0.7, tone: 0.45 }, { gain: 0.318823 })
}
/** Something filling up. The filter opens with the pitch, which is what makes it read as building. */
export function charge(): AudioPatch {
  return patch(1.1, [
    makeLayer({
      gain: 0.555,
      spread: 0.8,
      source: { kind: 'tone', wave: 'saw', voices: 4, detune: 22 },
      pitch: { start: 130, slide: 26, slideCurve: EASE_IN, vibratoRate: 5, vibratoDepth: 0.25, jitter: 8 },
      filter: { kind: 'lowpass', cutoff: 500, resonance: 0.5, envAmount: 3.4, envCurve: EASE_IN },
      amp: { attack: 0.12, hold: 0.02, decay: 0.3, sustain: 0.55, release: 0.18, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.26,
      spread: 0.7,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1400, resonance: 0.3, envAmount: 3.2, envCurve: EASE_IN },
      amp: { attack: 0.25, hold: 0, decay: 0.4, sustain: 0.3, release: 0.2, curve: 1.4 },
    }),
  ], { flangerMix: 0.2, flangerRate: 0.35, flangerDepth: 0.6, reverbMix: 0.18, tone: 0.2 }, { gain: 1.299673 })
}

/** A beam passing over you: one narrow band walked across the spectrum and back through a flanger. */
export function scan(): AudioPatch {
  return patch(0.85, [
    makeLayer({
      gain: 0.912,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 320, resonance: 0.72, envAmount: 4.2, envCurve: LINEAR },
      amp: { attack: 0.16, hold: 0.05, decay: 0.3, sustain: 0.35, release: 0.28, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.299,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.2 },
      pitch: { start: 3100, slide: 9, slideCurve: LINEAR, jitter: 20 },
      filter: { kind: 'highpass', cutoff: 2200, resonance: 0.25 },
      amp: { attack: 0.2, hold: 0, decay: 0.35, sustain: 0.2, release: 0.25, curve: 1.6 },
    }),
  ], { flangerMix: 0.45, flangerRate: 1.6, flangerDepth: 0.85, reverbMix: 0.24, reverbSize: 0.7, tone: 0.3 }, { gain: 1.180119 })
}

/**
 * Seven built the way a shipped effect is built rather than the way a synthesiser patch is:
 * layers on different time scales — a crack you hear, a body you feel, a tail that places it —
 * and one of them always short enough to define the moment the sound starts. A single voice with
 * a good envelope is a bleep; three voices half a frame apart is an event.
 */

/** The full stack: snap, body, weight. Nothing here is loud on its own. */
export function impact(): AudioPatch {
  return patch(1.6, [
    makeLayer({
      gain: 0.75,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 88, slide: -22, slideCurve: EASE_OUT },
      shaper: { drive: 0.22, bitDepth: 16, crush: 0 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.5, sustain: 0, release: 0.35, curve: 2.1 },
    }),
    makeLayer({
      gain: 0.5,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'lowpass', cutoff: 3200, resonance: 0.18, envAmount: -3.6, envCurve: EASE_OUT },
      shaper: { drive: 0.3, bitDepth: 16, crush: 0 },
      amp: { attack: 0.001, hold: 0.02, decay: 0.28, sustain: 0.06, release: 0.3, curve: 2.3 },
    }),
    makeLayer({
      gain: 0.52,
      spread: 0.5,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 9500, jitter: 18 },
      filter: { kind: 'highpass', cutoff: 7000, resonance: 0.12 },
      resonator: { amount: 0.7, frequency: 11500, spread: 0.4, decay: 0.03, partials: 3 },
      amp: { attack: 0.0003, hold: 0.002, decay: 0.014, sustain: 0, release: 0.01, curve: 3.2 },
    }),
  ], { reverbMix: 0.2, reverbSize: 0.72, reverbDamping: 0.55, tone: -0.2 }, { gain: 0.512868, limiter: 0.85 })
}

/** Falls further the longer it goes, which is the difference between a drop and a slide. */
export function subDrop(): AudioPatch {
  return patch(1.5, [
    makeLayer({
      gain: 0.8,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 135, slide: -30, slideCurve: EASE_IN },
      shaper: { drive: 0.32, bitDepth: 16, crush: 0 },
      amp: { attack: 0.006, hold: 0.05, decay: 0.7, sustain: 0.12, release: 0.5, curve: 1.8 },
    }),
    makeLayer({
      gain: 0.22,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2400, resonance: 0.2 },
      amp: { attack: 0.001, hold: 0, decay: 0.05, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { reverbMix: 0.14, reverbSize: 0.6, tone: -0.45 }, { gain: 0.72085, limiter: 0.9 })
}

/**
 * Machine noise: quantised to four bits and repeated by a delay short enough to be a texture. The
 * band it runs in moved up an octave and a half — data moving is a high sound, not a mid one —
 * and a gate on the second layer breaks the stream into packets rather than a tone.
 *
 * The crush came down from 0.3 to almost nothing, and that is not a taste decision. Crush is a
 * sample-and-hold: at 0.3 it repeats every sample twenty times, so the layer is running at an
 * effective 2.2 kHz and its own Nyquist sits at 1.1 kHz. Everything above that folds down. It is
 * the most aggressively dark control in the instrument, and it was cancelling the sources it sat
 * on top of — raising them made this preset quieter up high, not brighter.
 */
export function dataBurst(): AudioPatch {
  return patch(0.55, [
    makeLayer({
      gain: 0.5,
      spread: 0.5,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 8200, slide: -6, slideCurve: LINEAR, arpeggioRatio: 1.6, arpeggioAt: 0.4, jitter: 30 },
      filter: { kind: 'bandpass', cutoff: 7000, resonance: 0.4, envAmount: -1.4, envCurve: EASE_OUT },
      shaper: { drive: 0.2, bitDepth: 4, crush: 0.02 },
      amp: { attack: 0.001, hold: 0.01, decay: 0.09, sustain: 0.15, release: 0.12, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.26,
      spread: 0.8,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.12 },
      pitch: { start: 4600, slide: 5, jitter: 35 },
      shaper: { drive: 0, bitDepth: 5, crush: 0.01 },
      amp: { attack: 0.0008, hold: 0.02, decay: 0.06, sustain: 0.3, release: 0.08, curve: 3 },
    }),
    makeLayer({
      gain: 0.2,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3600, resonance: 0.14 },
      resonator: { amount: 1, frequency: 10200, spread: 0.3, decay: 0.03, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.0025, sustain: 0, release: 0.001, curve: 2.6 },
    }),
  ], { delayMix: 0.35, delayTime: 0.055, delayFeedback: 0.52, reverbMix: 0.12, width: 0.8, tone: 0.25 },
     { gain: 0.796597 }, [{ enabled: true, shape: 'square', rate: 27, depth: 0.85, phase: 0.3, target: 'layers[1].gain' }])
}
/** Everything closing at once — pitch, filter and level — which is what "off" sounds like. */
export function powerDown(): AudioPatch {
  return patch(1.7, [
    makeLayer({
      gain: 0.5,
      spread: 0.6,
      source: { kind: 'tone', wave: 'saw', voices: 3, detune: 14 },
      pitch: { start: 720, slide: -32, slideCurve: EASE_IN, vibratoRate: 3.5, vibratoDepth: 0.4 },
      filter: { kind: 'lowpass', cutoff: 4200, resonance: 0.42, envAmount: -4, envCurve: EASE_IN },
      amp: { attack: 0.01, hold: 0.06, decay: 0.8, sustain: 0.2, release: 0.6, curve: 1.7 },
    }),
    makeLayer({
      gain: 0.24,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 1600, resonance: 0.5, envAmount: -3.4, envCurve: EASE_IN },
      amp: { attack: 0.02, hold: 0.04, decay: 0.7, sustain: 0.12, release: 0.55, curve: 1.8 },
    }),
  ], { reverbMix: 0.26, reverbSize: 0.78, reverbDamping: 0.5, tone: -0.3 }, { gain: 1.519306 })
}

/**
 * Three of the same blip, spaced by a delay rather than played, which is why it locks. The blip
 * itself is now a struck body rather than a sine, so each repeat is metal rather than a tone —
 * a targeting reticle is a machine, and machines are made of something.
 */
export function lockOn(): AudioPatch {
  return patch(0.95, [
    makeLayer({
      gain: 0.42,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.14 },
      resonator: { amount: 1, frequency: 7600, spread: 0.22, decay: 0.05, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.55,
      offset: 0.002,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 2550, slide: 3, slideCurve: EASE_OUT, jitter: 10 },
      amp: { attack: 0.0015, hold: 0.008, decay: 0.05, sustain: 0, release: 0.04, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.22,
      spread: 0.85,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 11500, jitter: 22 },
      filter: { kind: 'highpass', cutoff: 8500, resonance: 0.12 },
      amp: { attack: 0.0004, hold: 0, decay: 0.018, sustain: 0, release: 0.012, curve: 3 },
    }),
  ], { delayMix: 0.4, delayTime: 0.115, delayFeedback: 0.5, reverbMix: 0.2, reverbSize: 0.55, width: 0.75, tone: 0.35 }, { gain: 0.439084 })
}
/** Held rather than struck. The flanger does the shimmering; the vibrato keeps it from sitting still. */
export function shield(): AudioPatch {
  return patch(1.4, [
    makeLayer({
      gain: 1.097,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 1750, slide: 3, slideCurve: EASE_OUT, vibratoRate: 7.5, vibratoDepth: 0.45, jitter: 18 },
      filter: { kind: 'bandpass', cutoff: 1500, resonance: 0.52, envAmount: 1.6, envCurve: EASE_OUT },
      amp: { attack: 0.05, hold: 0.08, decay: 0.4, sustain: 0.45, release: 0.55, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.648,
      spread: 0.8,
      source: { kind: 'tone', wave: 'triangle', voices: 3, detune: 12 },
      pitch: { start: 440, slide: 2, vibratoRate: 4.5, vibratoDepth: 0.3, jitter: 12 },
      amp: { attack: 0.08, hold: 0.05, decay: 0.35, sustain: 0.5, release: 0.5, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.26,
      spread: 1,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 8800, jitter: 24, vibratoRate: 7.5, vibratoDepth: 0.2 },
      filter: { kind: 'bandpass', cutoff: 9200, resonance: 0.48, envAmount: 0.6, envCurve: EASE_OUT },
      amp: { attack: 0.06, hold: 0.06, decay: 0.35, sustain: 0.4, release: 0.5, curve: 1.4 },
    }),
  ], { flangerMix: 0.5, flangerRate: 0.55, flangerDepth: 0.8, reverbMix: 0.34, reverbSize: 0.8, reverbDamping: 0.35, tone: 0.25 }, { gain: 1.214455 })
}

/**
 * Seven that the engine could not have made a week ago.
 *
 * Every one of them leans on something the older twenty do not touch: a modulator running under
 * the envelope, unison thrown wide across the field, or a tail long enough to need a room that is
 * not four combs in a box. That is the point of them — a preset library is also a demonstration of
 * what the instrument can do, and twenty sounds that all ignore the modulators teach that the
 * modulators are decoration.
 */

/**
 * Something opening. Wide, slow, and the filter breathing under a swell that never quite settles.
 * The third layer is the air above it — a band near ten kilohertz that fades in later than the
 * other two and drifts, because the thing on the far side of a portal should be audible before it
 * is identifiable.
 */
export function portal(): AudioPatch {
  return patch(2, [
    makeLayer({
      gain: 1.035,
      spread: 0.9,
      source: { kind: 'tone', wave: 'saw', voices: 4, detune: 26 },
      pitch: { start: 62, slide: 12, slideCurve: EASE_IN, jitter: 10 },
      filter: { kind: 'lowpass', cutoff: 320, resonance: 0.48, envAmount: 3.8, envCurve: EASE_IN },
      amp: { attack: 0.55, hold: 0.1, decay: 0.5, sustain: 0.6, release: 0.7, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.58,
      spread: 1,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 500, resonance: 0.55, envAmount: 3.2, envCurve: LINEAR },
      amp: { attack: 0.7, hold: 0.05, decay: 0.4, sustain: 0.5, release: 0.6, curve: 1.3 },
    }),
    makeLayer({
      gain: 0.42,
      spread: 1,
      offset: 0.25,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 9800, jitter: 30 },
      filter: { kind: 'bandpass', cutoff: 9000, resonance: 0.42, envAmount: 0.8, envCurve: LINEAR },
      amp: { attack: 0.5, hold: 0.1, decay: 0.4, sustain: 0.45, release: 0.6, curve: 1.3 },
    }),
  ], { reverbMix: 0.45, reverbSize: 0.95, reverbDamping: 0.28, flangerMix: 0.28, flangerRate: 0.35, flangerDepth: 0.7, width: 0.9, tone: 0.25 },
     { gain: 1.257605 }, [
       { enabled: true, shape: 'sine', rate: 0.7, depth: 0.5, target: 'layers[0].cutoff' },
       { enabled: true, shape: 'triangle', rate: 0.45, depth: 0.5, phase: 0.3, target: 'layers[2].gain' },
     ])
}
/**
 * Something failing. Stepped pitch and a gate that does not line up with it.
 *
 * The crush came down from 0.45, where it was holding each sample twenty-nine times and putting
 * this preset's own Nyquist at 760 Hz — every source above it folded down into mud, which is not
 * what a digital fault sounds like. Modern breakage is bright and shattery: it is data arriving
 * wrong, not a speaker giving up. Three bits of quantisation still supply the grit.
 */
export function glitch(): AudioPatch {
  return patch(0.45, [
    makeLayer({
      gain: 0.45,
      spread: 0.6,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 5600, jitter: 40 },
      filter: { kind: 'highpass', cutoff: 2600, resonance: 0.18 },
      shaper: { drive: 0.25, bitDepth: 3, crush: 0.04 },
      amp: { attack: 0.001, hold: 0.06, decay: 0.1, sustain: 0.4, release: 0.12, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.24,
      spread: 0.8,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.2, voices: 2, detune: 30 },
      pitch: { start: 2100, jitter: 45 },
      shaper: { drive: 0, bitDepth: 4, crush: 0.02 },
      amp: { attack: 0.001, hold: 0.05, decay: 0.08, sustain: 0.35, release: 0.1, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.9,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 6000, resonance: 0.12 },
      resonator: { amount: 1, frequency: 11800, spread: 0.55, decay: 0.02, partials: 3 },
      amp: { attack: 0.0002, hold: 0.001, decay: 0.0025, sustain: 0, release: 0.001, curve: 3 },
    }),
  ], { delayMix: 0.3, delayTime: 0.042, delayFeedback: 0.5, reverbMix: 0.14, width: 0.85, tone: 0.4 },
     { gain: 0.622969 }, [
       { enabled: true, shape: 'square', rate: 23, depth: 0.55, target: 'layers[0].pitch' },
       { enabled: true, shape: 'square', rate: 31, depth: 0.9, target: 'layers[1].gain' },
     ])
}
/**
 * Held metal, sweeping. The two modulators are deliberately unrelated so it never repeats, and the
 * band they sweep now sits an octave and a half higher — ionised air is a hiss, not a hum. The
 * triangle underneath is the only thing anchoring it to a pitch.
 */
export function ion(): AudioPatch {
  return patch(1.7, [
    makeLayer({
      gain: 0.809,
      spread: 1,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 7400, jitter: 20 },
      filter: { kind: 'bandpass', cutoff: 7200, resonance: 0.58 },
      amp: { attack: 0.12, hold: 0.1, decay: 0.4, sustain: 0.55, release: 0.6, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.4,
      spread: 0.9,
      source: { kind: 'tone', wave: 'triangle', voices: 3, detune: 11 },
      pitch: { start: 880, jitter: 14 },
      amp: { attack: 0.2, hold: 0.08, decay: 0.35, sustain: 0.5, release: 0.55, curve: 1.3 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 4000, resonance: 0.14 },
      resonator: { amount: 1, frequency: 10600, spread: 0.4, decay: 0.06, partials: 3 },
      amp: { attack: 0.0004, hold: 0.0015, decay: 0.004, sustain: 0, release: 0.002, curve: 2.6 },
    }),
  ], { flangerMix: 0.5, flangerRate: 0.45, flangerDepth: 0.85, reverbMix: 0.42, reverbSize: 0.9, reverbDamping: 0.3, width: 1, tone: 0.4 },
     { gain: 1.503234 }, [
       { enabled: true, shape: 'triangle', rate: 0.4, depth: 0.7, target: 'layers[0].cutoff' },
       { enabled: true, shape: 'sine', rate: 5.5, depth: 0.06, target: 'layers[1].pitch' },
     ])
}
/**
 * A ship, idling. Five detuned saws is most of it; the rest is the room refusing to be still.
 *
 * The saws stay where they were, because an engine is a low sound and making it bright would make
 * it a different object. What it was missing is the turbine over the top — every large machine
 * that is not a diesel has a whine an octave or three above anything you would call its pitch, and
 * without it this was a rumble rather than a drive.
 */
export function engine(): AudioPatch {
  return patch(2.1, [
    makeLayer({
      gain: 0.5,
      spread: 0.85,
      source: { kind: 'tone', wave: 'saw', voices: 5, detune: 32 },
      pitch: { start: 56, jitter: 8 },
      filter: { kind: 'lowpass', cutoff: 420, resonance: 0.42 },
      shaper: { drive: 0.25, bitDepth: 16, crush: 0 },
      amp: { attack: 0.25, hold: 0.4, decay: 0.5, sustain: 0.7, release: 0.6, curve: 1.3 },
    }),
    makeLayer({
      gain: 0.24,
      spread: 1,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'lowpass', cutoff: 900, resonance: 0.3 },
      amp: { attack: 0.35, hold: 0.35, decay: 0.5, sustain: 0.6, release: 0.55, curve: 1.3 },
    }),
    makeLayer({
      gain: 0.16,
      spread: 0.7,
      source: { kind: 'tone', wave: 'saw', voices: 3, detune: 7 },
      pitch: { start: 8400, jitter: 6, vibratoRate: 0.6, vibratoDepth: 0.12 },
      filter: { kind: 'bandpass', cutoff: 9200, resonance: 0.5 },
      amp: { attack: 0.4, hold: 0.35, decay: 0.5, sustain: 0.55, release: 0.6, curve: 1.3 },
    }),
  ], { reverbMix: 0.24, reverbSize: 0.7, reverbDamping: 0.6, width: 0.8, tone: -0.15 },
     { gain: 0.635485 }, [
       { enabled: true, shape: 'sine', rate: 0.9, depth: 0.35, target: 'layers[0].cutoff' },
       { enabled: true, shape: 'triangle', rate: 1.7, depth: 0.28, target: 'layers[1].gain' },
     ])
}
/**
 * A laser held down. The fast modulator on the filter is what turns a tone into a weapon, and the
 * layer above it is the part that reads as energy rather than as a note — a narrow band up at nine
 * kilohertz, modulated by the same fifteen hertz, so the two move together.
 */
export function beam(): AudioPatch {
  return patch(0.95, [
    makeLayer({
      gain: 0.48,
      spread: 0.7,
      source: { kind: 'tone', wave: 'saw', voices: 3, detune: 15 },
      pitch: { start: 1250, slide: -7, slideCurve: EASE_OUT, jitter: 12 },
      filter: { kind: 'bandpass', cutoff: 1900, resonance: 0.66, envAmount: -1.2, envCurve: EASE_OUT },
      amp: { attack: 0.008, hold: 0.35, decay: 0.15, sustain: 0.55, release: 0.2, curve: 1.8 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.95,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 9200, jitter: 18 },
      filter: { kind: 'bandpass', cutoff: 9000, resonance: 0.6 },
      amp: { attack: 0.006, hold: 0.35, decay: 0.15, sustain: 0.5, release: 0.2, curve: 1.8 },
    }),
    makeLayer({
      gain: 0.26,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3600, resonance: 0.14 },
      resonator: { amount: 1, frequency: 10800, spread: 0.3, decay: 0.04, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
  ], { delayMix: 0.24, delayTime: 0.068, delayFeedback: 0.44, reverbMix: 0.22, width: 0.9, tone: 0.4 },
     { gain: 0.849542 }, [
       { enabled: true, shape: 'sine', rate: 15, depth: 0.5, target: 'layers[0].cutoff' },
       { enabled: true, shape: 'sine', rate: 15, depth: 0.45, phase: 0.5, target: 'layers[1].cutoff' },
     ])
}
/**
 * Noise resolving into a note: the scatter fades as the tone arrives underneath it. The scatter
 * starts far higher than it used to — something assembling out of nothing is a sparkle first and a
 * pitch second — and the sampled-noise modulator on its pitch is what keeps it from being a hiss.
 */
export function materialize(): AudioPatch {
  return patch(1.5, [
    makeLayer({
      gain: 0.838,
      spread: 1,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 9600, jitter: 25 },
      filter: { kind: 'bandpass', cutoff: 9000, resonance: 0.4, envAmount: -2.6, envCurve: EASE_OUT },
      amp: { attack: 0.02, hold: 0.1, decay: 0.55, sustain: 0.1, release: 0.35, curve: 1.7 },
    }),
    makeLayer({
      gain: 0.678,
      spread: 0.8,
      offset: 0.3,
      source: { kind: 'tone', wave: 'triangle', voices: 3, detune: 13 },
      pitch: { start: 520, slide: -3, slideCurve: EASE_OUT, jitter: 12 },
      amp: { attack: 0.35, hold: 0.1, decay: 0.3, sustain: 0.5, release: 0.35, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.9,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 5000, resonance: 0.12 },
      amp: { attack: 0.01, hold: 0.05, decay: 0.4, sustain: 0.08, release: 0.3, curve: 2 },
    }),
  ], { reverbMix: 0.36, reverbSize: 0.82, reverbDamping: 0.4, width: 0.95, tone: 0.35 },
     { gain: 1.530564 }, [
       { enabled: true, shape: 'noise', rate: 19, depth: 0.45, target: 'layers[0].pitch' },
       { enabled: true, shape: 'noise', rate: 26, depth: 0.7, target: 'layers[2].gain' },
     ])
}
/**
 * A terminal thinking. A square modulator on the gain is a gate, and a gate is a rhythm.
 *
 * This preset is the reason the master chain now blocks DC. A 28% duty pulse is asymmetric, so it
 * carries a constant offset, and gating it modulates that offset — measured here, 47% of the
 * peak was a battery rather than a sound, which cost the preset both loudness and its own bottom
 * end. The chatter above it is the part that makes it read as a machine working rather than a bass
 * note being interrupted: a high band, gated faster, and out of phase with the low one.
 */
export function pulse(): AudioPatch {
  return patch(1.2, [
    makeLayer({
      gain: 0.46,
      spread: 0.65,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.28, voices: 2, detune: 12 },
      pitch: { start: 460, jitter: 10 },
      filter: { kind: 'lowpass', cutoff: 1700, resonance: 0.52 },
      amp: { attack: 0.01, hold: 0.5, decay: 0.2, sustain: 0.7, release: 0.25, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.9,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 8800, jitter: 28 },
      filter: { kind: 'bandpass', cutoff: 8600, resonance: 0.45 },
      shaper: { drive: 0, bitDepth: 8, crush: 0 },
      amp: { attack: 0.004, hold: 0.5, decay: 0.2, sustain: 0.6, release: 0.25, curve: 1.6 },
    }),
    makeLayer({
      gain: 0.22,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 4200, resonance: 0.14 },
      resonator: { amount: 1, frequency: 9800, spread: 0.34, decay: 0.03, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.0025, sustain: 0, release: 0.001, curve: 2.8 },
    }),
  ], { delayMix: 0.22, delayTime: 0.105, delayFeedback: 0.38, reverbMix: 0.24, reverbSize: 0.65, width: 0.85, tone: 0.3 },
     { gain: 0.8955 }, [
       { enabled: true, shape: 'square', rate: 9, depth: 1, target: 'layers[0].gain' },
       { enabled: true, shape: 'square', rate: 13.5, depth: 0.9, phase: 0.4, target: 'layers[1].gain' },
     ])
}

/**
 * Five that are not subtractive at all.
 *
 * Everything before these takes a harmonic wave and removes from it, so all of it is some filtered
 * version of a buzz — and that family resemblance is most of what "cheap" means when a synthesised
 * effect sounds it. Phase modulation makes partials that are multiples of nothing: a struck bell
 * has no fundamental you can point at, and neither does a sheet of metal or a hull under load.
 * These are here because the instrument could not make that sound at all a moment ago.
 */

/** A bell, which is a ratio that divides into nothing and a depth that falls away. */
export function chime(): AudioPatch {
  return patch(1.3, [
    makeLayer({
      gain: 0.631,
      spread: 0.6,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 6, fmRatio: 3.51, fmIndex: 5.2, fmFall: 0.92 },
      pitch: { start: 780, jitter: 10 },
      amp: { attack: 0.002, hold: 0.01, decay: 0.55, sustain: 0.05, release: 0.5, curve: 2.4 },
    }),
  ], { reverbMix: 0.3, reverbSize: 0.8, reverbDamping: 0.35, width: 0.9, tone: 0.3 }, { gain: 1.451405 }, [])
}

/** Struck metal. A high ratio and a depth that collapses is the whole of the clang. */
export function clang(): AudioPatch {
  return patch(1.5, [
    makeLayer({
      gain: 0.55,
      spread: 0.75,
      source: { kind: 'tone', wave: 'sine', voices: 3, detune: 14, fmRatio: 7.13, fmIndex: 8.4, fmFall: 0.85 },
      pitch: { start: 320, slide: -1.5, slideCurve: EASE_OUT, jitter: 14 },
      filter: { kind: 'highpass', cutoff: 180, resonance: 0.1 },
      amp: { attack: 0.001, hold: 0.015, decay: 0.5, sustain: 0.08, release: 0.55, curve: 2.2 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 1,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 4200, jitter: 20 },
      filter: { kind: 'highpass', cutoff: 2600, resonance: 0.15 },
      amp: { attack: 0.0005, hold: 0, decay: 0.045, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { reverbMix: 0.32, reverbSize: 0.85, reverbDamping: 0.42, width: 0.95, tone: 0.15 }, { gain: 1.19774 }, [])
}

/** Something large, under load. Low carrier, near-integer ratio, and the depth kept up. */
export function growl(): AudioPatch {
  return patch(1.8, [
    makeLayer({
      gain: 0.5,
      spread: 0.7,
      source: { kind: 'tone', wave: 'sine', voices: 3, detune: 20, fmRatio: 2.02, fmIndex: 6.5, fmFall: 0.25 },
      pitch: { start: 68, slide: -3, slideCurve: EASE_OUT, jitter: 10 },
      filter: { kind: 'lowpass', cutoff: 1400, resonance: 0.35 },
      shaper: { drive: 0.3, bitDepth: 16, crush: 0 },
      amp: { attack: 0.12, hold: 0.3, decay: 0.5, sustain: 0.6, release: 0.6, curve: 1.4 },
    }),
  ], { reverbMix: 0.24, reverbSize: 0.7, reverbDamping: 0.55, width: 0.8, tone: -0.3 },
     { gain: 0.834673 }, [{ enabled: true, shape: 'triangle', rate: 1.3, depth: 0.4, target: 'layers[0].cutoff' }])
}

/** A signal arriving through something. Inharmonic, quantised, and stuttered by a short delay. */
export function transmission(): AudioPatch {
  return patch(0.8, [
    makeLayer({
      gain: 0.45,
      spread: 0.8,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 25, fmRatio: 4.73, fmIndex: 7, fmFall: 0.4 },
      pitch: { start: 1150, jitter: 30 },
      shaper: { drive: 0.15, bitDepth: 6, crush: 0.2 },
      amp: { attack: 0.004, hold: 0.14, decay: 0.18, sustain: 0.35, release: 0.22, curve: 1.9 },
    }),
  ], { delayMix: 0.3, delayTime: 0.062, delayFeedback: 0.46, reverbMix: 0.2, width: 0.9, tone: 0.3 },
     { gain: 0.936183 }, [{ enabled: true, shape: 'square', rate: 13, depth: 0.35, target: 'layers[0].pitch' }])
}

/** A warning that is not a beep: the ratio makes it sour, and the modulator makes it circle. */
export function siren(): AudioPatch {
  return patch(1.6, [
    makeLayer({
      gain: 0.654,
      spread: 0.85,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 12, fmRatio: 1.49, fmIndex: 4.4, fmFall: 0.15 },
      pitch: { start: 540, jitter: 8 },
      filter: { kind: 'bandpass', cutoff: 1200, resonance: 0.45 },
      amp: { attack: 0.05, hold: 0.4, decay: 0.3, sustain: 0.65, release: 0.4, curve: 1.4 },
    }),
  ], { reverbMix: 0.3, reverbSize: 0.75, delayMix: 0.16, delayTime: 0.19, delayFeedback: 0.3, width: 0.95, tone: 0.1 },
     { gain: 1.347307 }, [{ enabled: true, shape: 'sine', rate: 1.1, depth: 0.45, target: 'layers[0].pitch' }])
}

/**
 * Four small mechanisms.
 *
 * The family a synthesiser normally cannot reach: the click of a modern interface, which is not a
 * tone but a very short excitation striking a body. Three things make them read as a mechanism
 * rather than a beep, and the first two were wrong in the version before this one.
 *
 * The strike is three to five milliseconds long — not ninety. What lasts is the body ringing on
 * after it, which is why the envelope now shapes the excitation and not the ring.
 *
 * And the bodies are high. This kind of sound lives in the air band: eight to twelve kilohertz for
 * the top, with something in the low mids underneath it for weight. A click built around a body at
 * one kilohertz sounds like a telephone; the same click at nine sounds like a interface.
 */

/** Glass. A body near the top of hearing, its partials almost in tune, allowed to ring right out. */
export function crystal(): AudioPatch {
  return patch(1.3, [
    makeLayer({
      gain: 0.55,
      spread: 0.7,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.1 },
      resonator: { amount: 1, frequency: 8400, spread: 0.14, decay: 0.85, partials: 4 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.001, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.75,
      spread: 0.9,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 5000, resonance: 0.2 },
      resonator: { amount: 1, frequency: 4100, spread: 0.2, decay: 0.65, partials: 3 },
      amp: { attack: 0.0004, hold: 0.0012, decay: 0.004, sustain: 0, release: 0.0015, curve: 2.6 },
    }),
  ], { reverbMix: 0.3, reverbSize: 0.55, reverbDamping: 0.4, width: 0.95, tone: 0.45 }, { gain: 0.175043 }, [])
}

/** What a sound is for, which is how anyone looks for one. Twenty in a flat list is a wall. */
export type PresetGroup =
  | 'Arcade' | 'Interface' | 'Impact' | 'Motion' | 'Sci-fi' | 'Inharmonic'
  | 'Touch' | 'Surfaces' | 'Signals'
  | 'Element' | 'Weapon' | 'Morph' | 'Showpiece'

export const PRESETS: { id: string; label: string; group: PresetGroup; build: () => AudioPatch }[] = [
  { id: 'coin', label: 'Coin', group: 'Arcade', build: coin },
  { id: 'laser', label: 'Laser', group: 'Arcade', build: laser },
  { id: 'powerup', label: 'Powerup', group: 'Arcade', build: powerup },
  { id: 'jump', label: 'Jump', group: 'Arcade', build: jump },
  { id: 'hit', label: 'Hit', group: 'Arcade', build: hit },

  { id: 'ui-click', label: 'UI click', group: 'Interface', build: uiClick },
  { id: 'spark-burst', label: 'Spark burst', group: 'Interface', build: sparkBurst },
  { id: 'interface', label: 'Confirm', group: 'Interface', build: interfaceConfirm },
  { id: 'lock-on', label: 'Lock on', group: 'Interface', build: lockOn },
  { id: 'data-burst', label: 'Data burst', group: 'Interface', build: dataBurst },
  { id: 'crystal', label: 'Crystal', group: 'Interface', build: crystal },

  { id: 'impact', label: 'Impact', group: 'Impact', build: impact },
  { id: 'explosion', label: 'Explosion', group: 'Impact', build: explosion },
  { id: 'sub-drop', label: 'Sub drop', group: 'Impact', build: subDrop },
  { id: 'power-down', label: 'Power down', group: 'Impact', build: powerDown },

  { id: 'whoosh', label: 'Whoosh', group: 'Motion', build: whoosh },
  { id: 'scan', label: 'Scan', group: 'Motion', build: scan },
  { id: 'charge', label: 'Charge', group: 'Motion', build: charge },
  { id: 'warp', label: 'Warp', group: 'Motion', build: warp },
  { id: 'hologram', label: 'Hologram', group: 'Motion', build: hologram },
  { id: 'shield', label: 'Shield', group: 'Motion', build: shield },

  { id: 'portal', label: 'Portal', group: 'Sci-fi', build: portal },
  { id: 'engine', label: 'Engine', group: 'Sci-fi', build: engine },
  { id: 'ion', label: 'Ion', group: 'Sci-fi', build: ion },
  { id: 'beam', label: 'Beam', group: 'Sci-fi', build: beam },
  { id: 'materialize', label: 'Materialize', group: 'Sci-fi', build: materialize },
  { id: 'pulse', label: 'Pulse', group: 'Sci-fi', build: pulse },
  { id: 'glitch', label: 'Glitch', group: 'Sci-fi', build: glitch },

  { id: 'chime', label: 'Chime', group: 'Inharmonic', build: chime },
  { id: 'clang', label: 'Clang', group: 'Inharmonic', build: clang },
  { id: 'growl', label: 'Growl', group: 'Inharmonic', build: growl },
  { id: 'transmission', label: 'Transmission', group: 'Inharmonic', build: transmission },
  { id: 'siren', label: 'Siren', group: 'Inharmonic', build: siren },

  { id: 'focus-hover', label: 'Hover', group: 'Touch', build: ui.focusHover },
  { id: 'focus-arm', label: 'Arm', group: 'Touch', build: ui.focusArm },
  { id: 'focus-ring', label: 'Focus ring', group: 'Touch', build: ui.focusRing },
  { id: 'input-key', label: 'Keystroke', group: 'Touch', build: ui.inputKey },
  { id: 'input-accept', label: 'Field accept', group: 'Touch', build: ui.inputAccept },
  { id: 'input-validate', label: 'Validate', group: 'Touch', build: ui.inputValidate },


  { id: 'disclose-row', label: 'Disclose', group: 'Surfaces', build: ui.discloseRow },
  { id: 'panel-slide', label: 'Panel out', group: 'Surfaces', build: ui.panelSlide },
  { id: 'overlay-open', label: 'Overlay', group: 'Surfaces', build: ui.overlayOpen },
  { id: 'panel-shut', label: 'Panel in', group: 'Surfaces', build: ui.panelShut },
  { id: 'drawer-retract', label: 'Retract', group: 'Surfaces', build: ui.drawerRetract },
  { id: 'sheet-collapse', label: 'Collapse', group: 'Surfaces', build: ui.sheetCollapse },

  { id: 'progress-start', label: 'Start', group: 'Signals', build: ui.progressStart },
  { id: 'progress-tick', label: 'Tick over', group: 'Signals', build: ui.progressTick },
  { id: 'progress-complete', label: 'Complete', group: 'Signals', build: ui.progressComplete },
  { id: 'reward-credit', label: 'Credit', group: 'Signals', build: ui.rewardCredit },
  { id: 'reward-unlock', label: 'Unlock', group: 'Signals', build: ui.rewardUnlock },
  { id: 'reward-achievement', label: 'Achievement', group: 'Signals', build: ui.rewardAchievement },
  { id: 'delete-item', label: 'Delete', group: 'Signals', build: ui.deleteItem },
  { id: 'discard-draft', label: 'Discard', group: 'Signals', build: ui.discardDraft },
  { id: 'wipe-all', label: 'Wipe', group: 'Signals', build: ui.wipeAll },

  { id: 'select-tap', label: 'Select Tap', group: 'Interface', build: fx.selectTap },
  { id: 'select-confirm', label: 'Select Confirm', group: 'Interface', build: fx.selectConfirm },
  { id: 'select-commit', label: 'Select Commit', group: 'Interface', build: fx.selectCommit },
  { id: 'step-advance', label: 'Step Advance', group: 'Interface', build: fx.stepAdvance },
  { id: 'lever-engage', label: 'Lever Engage', group: 'Interface', build: fx.leverEngage },
  { id: 'lever-release', label: 'Lever Release', group: 'Interface', build: fx.leverRelease },
  { id: 'check-mark', label: 'Check Mark', group: 'Interface', build: fx.checkMark },
  { id: 'deny-deflect', label: 'Deny Deflect', group: 'Interface', build: fx.denyDeflect },
  { id: 'deny-lockout', label: 'Deny Lockout', group: 'Interface', build: fx.denyLockout },
  { id: 'warn-notice', label: 'Warn Notice', group: 'Interface', build: fx.warnNotice },
  { id: 'warn-caution', label: 'Warn Caution', group: 'Interface', build: fx.warnCaution },
  { id: 'warn-critical', label: 'Warn Critical', group: 'Interface', build: fx.warnCritical },

  { id: 'fragment-spray', label: 'Fragment Spray', group: 'Element', build: fx.fragmentSpray },
  { id: 'fragment-tumble', label: 'Fragment Tumble', group: 'Element', build: fx.fragmentTumble },
  { id: 'fragment-settle', label: 'Fragment Settle', group: 'Element', build: fx.fragmentSettle },
  { id: 'packet-stream', label: 'Packet Stream', group: 'Element', build: fx.packetStream },
  { id: 'raster-scan', label: 'Raster Scan', group: 'Element', build: fx.rasterScan },
  { id: 'handshake', label: 'Handshake', group: 'Element', build: fx.handshake },
  { id: 'ambient-drift', label: 'Ambient Drift', group: 'Element', build: fx.ambientDrift },
  { id: 'containment-field', label: 'Containment Field', group: 'Element', build: fx.containmentField },
  { id: 'pressure-swell', label: 'Pressure Swell', group: 'Element', build: fx.pressureSwell },

  { id: 'charge-prime', label: 'Charge Prime', group: 'Weapon', build: fx.chargePrime },
  { id: 'charge-cycle', label: 'Charge Cycle', group: 'Weapon', build: fx.chargeCycle },
  { id: 'charge-overload', label: 'Charge Overload', group: 'Weapon', build: fx.chargeOverload },
  { id: 'plasma-bolt', label: 'Plasma Bolt', group: 'Weapon', build: fx.plasmaBolt },
  { id: 'plasma-lance', label: 'Plasma Lance', group: 'Weapon', build: fx.plasmaLance },
  { id: 'plasma-cannon', label: 'Plasma Cannon', group: 'Weapon', build: fx.plasmaCannon },
  { id: 'pulse-rifle', label: 'Pulse Rifle', group: 'Weapon', build: fx.pulseRifle },
  { id: 'pulse-cannon', label: 'Pulse Cannon', group: 'Weapon', build: fx.pulseCannon },
  { id: 'pulse-repeater', label: 'Pulse Repeater', group: 'Weapon', build: fx.pulseRepeater },
  { id: 'reload-clip', label: 'Reload Clip', group: 'Weapon', build: fx.reloadClip },
  { id: 'reload-cycle', label: 'Reload Cycle', group: 'Weapon', build: fx.reloadCycle },
  { id: 'reload-breech', label: 'Reload Breech', group: 'Weapon', build: fx.reloadBreech },
  { id: 'morph-robotic', label: 'Morph Robotic', group: 'Weapon', build: fx.morphRobotic },
  { id: 'morph-metal', label: 'Morph Metal', group: 'Weapon', build: fx.morphMetal },
  { id: 'impact-snap', label: 'Impact Snap', group: 'Weapon', build: fx.impactSnap },
  { id: 'impact-strike', label: 'Impact Strike', group: 'Weapon', build: fx.impactStrike },
  { id: 'impact-slam', label: 'Impact Slam', group: 'Weapon', build: fx.impactSlam },

  // The family that could not be written before: one sound a subsystem the engine gained.
  { id: 'table-sweep', label: 'Table Sweep', group: 'Morph', build: morph.tableSweep },
  { id: 'glass-bell', label: 'Glass Bell', group: 'Morph', build: morph.glassBell },
  { id: 'growl-engine', label: 'Growl Engine', group: 'Morph', build: morph.growlEngine },
  { id: 'ring-alarm', label: 'Ring Alarm', group: 'Morph', build: morph.ringAlarm },
  { id: 'fold-buzz', label: 'Fold Buzz', group: 'Morph', build: morph.foldBuzz },
  { id: 'notch-sweep', label: 'Notch Sweep', group: 'Morph', build: morph.notchSweep },
  { id: 'cross-bell', label: 'Cross Bell', group: 'Morph', build: morph.crossBell },
  { id: 'chorus-pad', label: 'Chorus Pad', group: 'Morph', build: morph.chorusPad },
  { id: 'phaser-sweep', label: 'Phaser Sweep', group: 'Morph', build: morph.phaserSweep },
  { id: 'wide-riser', label: 'Wide Riser', group: 'Morph', build: morph.wideRiser },
  { id: 'step-sequence', label: 'Step Sequence', group: 'Morph', build: morph.stepSequence },
  { id: 'crushed-table', label: 'Crushed Table', group: 'Morph', build: morph.crushedTable },
  { id: 'vowel-sweep', label: 'Vowel Sweep', group: 'Morph', build: morph.vowelSweep },
  { id: 'series-pluck', label: 'Series Pluck', group: 'Morph', build: morph.seriesPluck },

  // Seven that use several of those subsystems at once, and are meant to be listened to rather
  // than fired: the demonstration the instrument did not have.
  { id: 'vowel-phrase', label: 'Vowel Phrase', group: 'Showpiece', build: show.vowelPhrase },
  { id: 'resonant-drop', label: 'Resonant Drop', group: 'Showpiece', build: show.resonantDrop },
  { id: 'hull-strike', label: 'Hull Strike', group: 'Showpiece', build: show.hullStrike },
  { id: 'ricochet-pass', label: 'Ricochet Pass', group: 'Showpiece', build: show.ricochetPass },
  { id: 'metal-cutter', label: 'Metal Cutter', group: 'Showpiece', build: show.metalCutter },
  { id: 'gravel-bell', label: 'Gravel Bell', group: 'Showpiece', build: show.gravelBell },
  { id: 'prize-ladder', label: 'Prize Ladder', group: 'Showpiece', build: show.prizeLadder },
]

export const PRESET_GROUPS: PresetGroup[] = [
  'Interface', 'Element', 'Weapon',
  'Touch', 'Surfaces', 'Signals',
  'Arcade', 'Impact', 'Motion', 'Sci-fi', 'Inharmonic',
  'Morph', 'Showpiece',
]

/**
 * The library in the order everything on screen shows it: by family, and by declaration inside one.
 *
 * `PRESETS` is the order the file was written in, which is not the order anything renders — the
 * grid, the menu and the rail all walk the families. The stepping arrows walked the array, and
 * their tooltip promised "the whole list, in one order": the two disagreed at six places, so Next
 * from Crystal gave you Impact where the card beside it was Select Tap. One expression, exported,
 * so the four of them cannot drift apart again.
 */
export const PRESET_ORDER = PRESET_GROUPS.flatMap((group) => PRESETS.filter((preset) => preset.group === group))
