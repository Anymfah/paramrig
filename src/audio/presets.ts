import type { AudioPatch, FxSettings, Layer, Lfo, MasterSettings } from './types.ts'
import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import { makeLayer, makePatch } from './patch.ts'

export { makeFx, makeLayer, makeMaster, makePatch, silentLayer } from './patch.ts'

/**
 * The starting points. A generator with seventy parameters and no presets is a synthesiser, and a
 * synthesiser is exactly what someone reaching for a button click does not want to learn. These
 * are the sounds people actually come to make; every one of them is a normal patch, so the first
 * gesture after loading one is to change it.
 */

function patch(duration: number, layers: Layer[], fx: Partial<FxSettings> = {}, master: Partial<MasterSettings> = {}, lfos: Partial<Lfo>[] = []): AudioPatch {
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
  ], { tone: 0.2 }, { gain: 2.684 })
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
  ], { tone: 0.1 }, { gain: 1.478 })
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
      gain: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1800, resonance: 0.1 },
      amp: { attack: 0.0005, hold: 0, decay: 0.06, sustain: 0, release: 0.02, curve: 3 },
    }),
  ], { reverbMix: 0.22, reverbSize: 0.7, reverbDamping: 0.5, tone: -0.25 }, { gain: 1.09, limiter: 0.9 })
}

/** Nine hundredths of a second. The jitter is what keeps it bearable the two-hundredth time. */
export function uiClick(): AudioPatch {
  return patch(0.09, [
    makeLayer({
      gain: 0.633,
      source: { kind: 'tone', wave: 'triangle' },
      pitch: { start: 2300, slide: -12, slideCurve: EASE_OUT, jitter: 20 },
      amp: { attack: 0.0005, hold: 0, decay: 0.045, sustain: 0, release: 0.02, curve: 2.5 },
    }),
    makeLayer({
      gain: 0.281,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 3400, jitter: 25 },
      filter: { kind: 'highpass', cutoff: 1900, resonance: 0.15 },
      amp: { attack: 0.0004, hold: 0, decay: 0.028, sustain: 0, release: 0.012, curve: 3 },
    }),
  ], { tone: 0.3 }, { gain: 2.654 })
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
  ], { tone: 0.25, delayMix: 0.12, delayTime: 0.09, delayFeedback: 0.25 }, { gain: 2.202 })
}

/** Band-passed noise swept across the ear, with the flanger doing the movement. */
export function whoosh(): AudioPatch {
  return patch(0.9, [
    makeLayer({
      gain: 1.5,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 400, resonance: 0.55, envAmount: 3.2, envCurve: LINEAR },
      amp: { attack: 0.3, hold: 0.02, decay: 0.35, sustain: 0.2, release: 0.22, curve: 1.6 },
    }),
  ], { flangerMix: 0.35, flangerRate: 0.7, flangerDepth: 0.6, reverbMix: 0.15, tone: -0.1 }, { gain: 2.211 })
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
  ], { tone: -0.15 }, { gain: 1.333 })
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
  ], { tone: 0.15 }, { gain: 2.958 })
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
  ], { flangerMix: 0.42, flangerRate: 0.9, flangerDepth: 0.75, reverbMix: 0.3, reverbSize: 0.75, reverbDamping: 0.35, tone: 0.4 }, { gain: 2.588 })
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
  ], { reverbMix: 0.36, reverbSize: 0.85, reverbDamping: 0.4, delayMix: 0.14, delayTime: 0.16, delayFeedback: 0.35, tone: -0.15 }, { gain: 3 })
}

/** The sound a panel makes when it agrees with you. Two notes up, and a tail that is all room. */
export function interfaceConfirm(): AudioPatch {
  return patch(0.5, [
    makeLayer({
      gain: 0.54,
      spread: 0.5,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 7 },
      pitch: { start: 1320, arpeggioRatio: 1.5, arpeggioAt: 0.22, jitter: 16 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.14, sustain: 0, release: 0.1, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.189,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 4200, jitter: 25 },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.2 },
      amp: { attack: 0.001, hold: 0, decay: 0.05, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { delayMix: 0.22, delayTime: 0.085, delayFeedback: 0.4, reverbMix: 0.22, reverbSize: 0.6, tone: 0.45 }, { gain: 2.679 })
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
      gain: 0.211,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1400, resonance: 0.3, envAmount: 2.2, envCurve: EASE_IN },
      amp: { attack: 0.25, hold: 0, decay: 0.4, sustain: 0.3, release: 0.2, curve: 1.4 },
    }),
  ], { flangerMix: 0.2, flangerRate: 0.35, flangerDepth: 0.6, reverbMix: 0.18, tone: 0.2 }, { gain: 2.813 })
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
  ], { flangerMix: 0.45, flangerRate: 1.6, flangerDepth: 0.85, reverbMix: 0.24, reverbSize: 0.7, tone: 0.3 }, { gain: 2.35 })
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
      gain: 0.3,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 5200, jitter: 18 },
      filter: { kind: 'highpass', cutoff: 3200, resonance: 0.12 },
      amp: { attack: 0.0004, hold: 0, decay: 0.03, sustain: 0, release: 0.015, curve: 3.2 },
    }),
  ], { reverbMix: 0.2, reverbSize: 0.72, reverbDamping: 0.55, tone: -0.2 }, { gain: 1.042, limiter: 0.85 })
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
  ], { reverbMix: 0.14, reverbSize: 0.6, tone: -0.45 }, { gain: 1.432, limiter: 0.9 })
}

/** Machine noise: quantised to four bits and repeated by a delay short enough to be a texture. */
export function dataBurst(): AudioPatch {
  return patch(0.55, [
    makeLayer({
      gain: 0.536,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 3300, slide: -6, slideCurve: LINEAR, arpeggioRatio: 1.6, arpeggioAt: 0.4, jitter: 30 },
      filter: { kind: 'bandpass', cutoff: 2800, resonance: 0.4, envAmount: -1.4, envCurve: EASE_OUT },
      shaper: { drive: 0.2, bitDepth: 4, crush: 0.3 },
      amp: { attack: 0.001, hold: 0.01, decay: 0.09, sustain: 0.15, release: 0.12, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.255,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.12 },
      pitch: { start: 1900, slide: 5, jitter: 35 },
      shaper: { drive: 0, bitDepth: 5, crush: 0.2 },
      amp: { attack: 0.0008, hold: 0, decay: 0.04, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { delayMix: 0.35, delayTime: 0.055, delayFeedback: 0.52, reverbMix: 0.12, tone: 0.25 }, { gain: 2.155 })
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
  ], { reverbMix: 0.26, reverbSize: 0.78, reverbDamping: 0.5, tone: -0.3 }, { gain: 3 })
}

/** Three of the same blip, spaced by a delay rather than played, which is why it locks. */
export function lockOn(): AudioPatch {
  return patch(0.95, [
    makeLayer({
      gain: 0.625,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 2550, slide: 3, slideCurve: EASE_OUT, jitter: 10 },
      amp: { attack: 0.0015, hold: 0.008, decay: 0.05, sustain: 0, release: 0.04, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.294,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 6200, jitter: 22 },
      filter: { kind: 'highpass', cutoff: 3600, resonance: 0.18 },
      amp: { attack: 0.0005, hold: 0, decay: 0.025, sustain: 0, release: 0.02, curve: 3 },
    }),
  ], { delayMix: 0.4, delayTime: 0.115, delayFeedback: 0.5, reverbMix: 0.2, reverbSize: 0.55, tone: 0.35 }, { gain: 2.58 })
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
  ], { flangerMix: 0.5, flangerRate: 0.55, flangerDepth: 0.8, reverbMix: 0.34, reverbSize: 0.8, reverbDamping: 0.35, tone: 0.25 }, { gain: 2.547 })
}

/** Two notes down and a little dirt on them. Down is what a refusal sounds like in every language. */
export function alert(): AudioPatch {
  return patch(0.65, [
    makeLayer({
      gain: 0.4,
      spread: 0.55,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.42, voices: 2, detune: 10 },
      pitch: { start: 620, arpeggioRatio: 0.72, arpeggioAt: 0.38, jitter: 8 },
      shaper: { drive: 0.22, bitDepth: 16, crush: 0 },
      amp: { attack: 0.003, hold: 0.05, decay: 0.22, sustain: 0.3, release: 0.16, curve: 2 },
    }),
    makeLayer({
      gain: 0.14,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 3800, jitter: 20 },
      filter: { kind: 'highpass', cutoff: 2600, resonance: 0.15 },
      amp: { attack: 0.0005, hold: 0, decay: 0.03, sustain: 0, release: 0.02, curve: 3 },
    }),
  ], { delayMix: 0.18, delayTime: 0.14, delayFeedback: 0.3, reverbMix: 0.18, tone: -0.05 }, { gain: 3 })
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

/** Something opening. Wide, slow, and the filter breathing under a swell that never quite settles. */
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
  ], { reverbMix: 0.45, reverbSize: 0.95, reverbDamping: 0.28, flangerMix: 0.28, flangerRate: 0.35, flangerDepth: 0.7, width: 0.9, tone: 0.1 },
     { gain: 2.432 }, [{ enabled: true, shape: 'sine', rate: 0.7, depth: 0.5, target: 'layers[0].cutoff' }])
}

/** Something failing. Stepped pitch and a gate that does not line up with it. */
export function glitch(): AudioPatch {
  return patch(0.45, [
    makeLayer({
      gain: 0.45,
      spread: 0.6,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2700, jitter: 40 },
      shaper: { drive: 0.25, bitDepth: 3, crush: 0.45 },
      amp: { attack: 0.001, hold: 0.06, decay: 0.1, sustain: 0.4, release: 0.12, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.24,
      spread: 0.8,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.2, voices: 2, detune: 30 },
      pitch: { start: 880, jitter: 45 },
      shaper: { drive: 0, bitDepth: 4, crush: 0.25 },
      amp: { attack: 0.001, hold: 0.05, decay: 0.08, sustain: 0.35, release: 0.1, curve: 2.6 },
    }),
  ], { delayMix: 0.3, delayTime: 0.042, delayFeedback: 0.5, reverbMix: 0.14, width: 0.85, tone: 0.35 },
     { gain: 1.26 }, [
       { enabled: true, shape: 'square', rate: 23, depth: 0.55, target: 'layers[0].pitch' },
       { enabled: true, shape: 'square', rate: 31, depth: 0.9, target: 'layers[1].gain' },
     ])
}

/** Held metal, sweeping. The two modulators are deliberately unrelated so it never repeats. */
export function ion(): AudioPatch {
  return patch(1.7, [
    makeLayer({
      gain: 0.809,
      spread: 1,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2100, jitter: 20 },
      filter: { kind: 'bandpass', cutoff: 2300, resonance: 0.58 },
      amp: { attack: 0.12, hold: 0.1, decay: 0.4, sustain: 0.55, release: 0.6, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.526,
      spread: 0.9,
      source: { kind: 'tone', wave: 'triangle', voices: 3, detune: 11 },
      pitch: { start: 880, jitter: 14 },
      amp: { attack: 0.2, hold: 0.08, decay: 0.35, sustain: 0.5, release: 0.55, curve: 1.3 },
    }),
  ], { flangerMix: 0.5, flangerRate: 0.45, flangerDepth: 0.85, reverbMix: 0.42, reverbSize: 0.9, reverbDamping: 0.3, width: 1, tone: 0.35 },
     { gain: 2.828 }, [
       { enabled: true, shape: 'triangle', rate: 0.4, depth: 0.7, target: 'layers[0].cutoff' },
       { enabled: true, shape: 'sine', rate: 5.5, depth: 0.06, target: 'layers[1].pitch' },
     ])
}

/** A ship, idling. Five detuned saws is most of it; the rest is the room refusing to be still. */
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
  ], { reverbMix: 0.24, reverbSize: 0.7, reverbDamping: 0.6, width: 0.8, tone: -0.35 },
     { gain: 1.225 }, [
       { enabled: true, shape: 'sine', rate: 0.9, depth: 0.35, target: 'layers[0].cutoff' },
       { enabled: true, shape: 'triangle', rate: 1.7, depth: 0.28, target: 'layers[1].gain' },
     ])
}

/** A laser held down. The fast modulator on the filter is what turns a tone into a weapon. */
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
  ], { delayMix: 0.24, delayTime: 0.068, delayFeedback: 0.44, reverbMix: 0.22, width: 0.9, tone: 0.3 },
     { gain: 2.23 }, [{ enabled: true, shape: 'sine', rate: 15, depth: 0.5, target: 'layers[0].cutoff' }])
}

/** Noise resolving into a note: the scatter fades as the tone arrives underneath it. */
export function materialize(): AudioPatch {
  return patch(1.5, [
    makeLayer({
      gain: 0.838,
      spread: 1,
      source: { kind: 'noise', colour: 'white' },
      pitch: { start: 2400 },
      filter: { kind: 'lowpass', cutoff: 5000, resonance: 0.35, envAmount: -2.6, envCurve: EASE_OUT },
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
  ], { reverbMix: 0.36, reverbSize: 0.82, reverbDamping: 0.4, width: 0.95, tone: 0.15 },
     { gain: 3 }, [{ enabled: true, shape: 'noise', rate: 19, depth: 0.45, target: 'layers[0].pitch' }])
}

/** A terminal thinking. A square modulator on the gain is a gate, and a gate is a rhythm. */
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
  ], { delayMix: 0.22, delayTime: 0.105, delayFeedback: 0.38, reverbMix: 0.24, reverbSize: 0.65, width: 0.85, tone: 0.2 },
     { gain: 0.524 }, [
       { enabled: true, shape: 'square', rate: 9, depth: 1, target: 'layers[0].gain' },
       { enabled: true, shape: 'triangle', rate: 0.8, depth: 0.6, target: 'layers[0].cutoff' },
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
  ], { reverbMix: 0.3, reverbSize: 0.8, reverbDamping: 0.35, width: 0.9, tone: 0.3 }, { gain: 2.873 }, [])
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
  ], { reverbMix: 0.32, reverbSize: 0.85, reverbDamping: 0.42, width: 0.95, tone: 0.15 }, { gain: 2.364 }, [])
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
     { gain: 1.763 }, [{ enabled: true, shape: 'triangle', rate: 1.3, depth: 0.4, target: 'layers[0].cutoff' }])
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
     { gain: 1.928 }, [{ enabled: true, shape: 'square', rate: 13, depth: 0.35, target: 'layers[0].pitch' }])
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
     { gain: 2.674 }, [{ enabled: true, shape: 'sine', rate: 1.1, depth: 0.45, target: 'layers[0].pitch' }])
}


/**
 * Four small mechanisms.
 *
 * This is the family a synthesiser normally cannot reach: the click of a modern interface, which
 * is not a tone at all but a very short excitation striking a small body, with resonances that
 * die at their own rates. What makes them read as a *thing* rather than a beep is that the body
 * outlives the strike — the click is over in three milliseconds and the object is still ringing.
 */

/** The one a menu makes. A snap of noise into a small bright body, and nothing else. */
export function select(): AudioPatch {
  return patch(0.16, [
    makeLayer({
      gain: 0.55,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 700, resonance: 0.15 },
      resonator: { amount: 0.92, frequency: 2450, spread: 0.62, decay: 0.09, partials: 4 },
      amp: { attack: 0.0004, hold: 0.002, decay: 0.09, sustain: 0, release: 0.05, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.16,
      spread: 0.7,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 6400, jitter: 25 },
      filter: { kind: 'highpass', cutoff: 4200, resonance: 0.1 },
      amp: { attack: 0.0003, hold: 0, decay: 0.012, sustain: 0, release: 0.008, curve: 3.2 },
    }),
  ], { reverbMix: 0.16, reverbSize: 0.3, reverbDamping: 0.65, width: 0.85, tone: 0.32 }, { gain: 0.204 }, [])
}

/** The same mechanism, heavier and lower — what a switch that commits to something sounds like. */
export function toggle(): AudioPatch {
  return patch(0.24, [
    makeLayer({
      gain: 0.6,
      spread: 0.35,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 900, resonance: 0.3 },
      shaper: { drive: 0.2, bitDepth: 16, crush: 0 },
      resonator: { amount: 0.88, frequency: 780, spread: 0.78, decay: 0.14, partials: 5 },
      amp: { attack: 0.0005, hold: 0.003, decay: 0.13, sustain: 0, release: 0.07, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.22,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 140, slide: -9, slideCurve: EASE_OUT },
      amp: { attack: 0.001, hold: 0, decay: 0.06, sustain: 0, release: 0.04, curve: 2.6 },
    }),
  ], { reverbMix: 0.15, reverbSize: 0.28, reverbDamping: 0.7, width: 0.8, tone: 0.05 }, { gain: 0.012 }, [])
}

/** Going back: the same body, struck softer and tuned down, so it reads as undoing. */
export function dismiss(): AudioPatch {
  return patch(0.22, [
    makeLayer({
      gain: 0.5,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 3200, resonance: 0.2 },
      resonator: { amount: 0.9, frequency: 1150, spread: 0.5, decay: 0.11, partials: 3 },
      pitch: { start: 1150, slide: -5, slideCurve: EASE_OUT },
      amp: { attack: 0.0006, hold: 0.002, decay: 0.1, sustain: 0, release: 0.06, curve: 2.5 },
    }),
  ], { reverbMix: 0.18, reverbSize: 0.32, reverbDamping: 0.6, width: 0.85, tone: 0.05 }, { gain: 0.08 }, [])
}

/** Glass rather than metal: a long thin body, struck once, allowed to ring out. */
export function crystal(): AudioPatch {
  return patch(1.1, [
    makeLayer({
      gain: 0.5,
      spread: 0.7,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1200, resonance: 0.1 },
      resonator: { amount: 0.95, frequency: 3200, spread: 0.34, decay: 0.85, partials: 5 },
      amp: { attack: 0.0004, hold: 0.002, decay: 0.6, sustain: 0, release: 0.45, curve: 2.2 },
    }),
  ], { reverbMix: 0.3, reverbSize: 0.6, reverbDamping: 0.45, width: 0.95, tone: 0.35 }, { gain: 0.108 }, [])
}

/** What a sound is for, which is how anyone looks for one. Twenty in a flat list is a wall. */
export type PresetGroup = 'Arcade' | 'Interface' | 'Impact' | 'Motion' | 'Sci-fi' | 'Inharmonic'

export const PRESETS: { id: string; label: string; group: PresetGroup; build: () => AudioPatch }[] = [
  { id: 'coin', label: 'Coin', group: 'Arcade', build: coin },
  { id: 'laser', label: 'Laser', group: 'Arcade', build: laser },
  { id: 'powerup', label: 'Powerup', group: 'Arcade', build: powerup },
  { id: 'jump', label: 'Jump', group: 'Arcade', build: jump },
  { id: 'hit', label: 'Hit', group: 'Arcade', build: hit },

  { id: 'ui-click', label: 'UI click', group: 'Interface', build: uiClick },
  { id: 'interface', label: 'Confirm', group: 'Interface', build: interfaceConfirm },
  { id: 'alert', label: 'Alert', group: 'Interface', build: alert },
  { id: 'lock-on', label: 'Lock on', group: 'Interface', build: lockOn },
  { id: 'data-burst', label: 'Data burst', group: 'Interface', build: dataBurst },
  { id: 'select', label: 'Select', group: 'Interface', build: select },
  { id: 'toggle', label: 'Toggle', group: 'Interface', build: toggle },
  { id: 'dismiss', label: 'Dismiss', group: 'Interface', build: dismiss },
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
]

export const PRESET_GROUPS: PresetGroup[] = ['Arcade', 'Interface', 'Impact', 'Motion', 'Sci-fi', 'Inharmonic']
