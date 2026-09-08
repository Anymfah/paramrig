import type { AudioPatch, FxSettings, Layer, MasterSettings } from './types.ts'
import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import { makeLayer, makePatch } from './patch.ts'

export { makeFx, makeLayer, makeMaster, makePatch, silentLayer } from './patch.ts'

/**
 * The starting points. A generator with seventy parameters and no presets is a synthesiser, and a
 * synthesiser is exactly what someone reaching for a button click does not want to learn. These
 * are the sounds people actually come to make; every one of them is a normal patch, so the first
 * gesture after loading one is to change it.
 */

function patch(duration: number, layers: Layer[], fx: Partial<FxSettings> = {}, master: Partial<MasterSettings> = {}): AudioPatch {
  return makePatch(duration, layers, fx, master)
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
  ], { tone: 0.2 }, { gain: 1.47 })
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
  ], { tone: 0.1 }, { gain: 0.87 })
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
  ], { reverbMix: 0.22, reverbSize: 0.7, reverbDamping: 0.5, tone: -0.25 }, { gain: 0.27, limiter: 0.9 })
}

/** Nine hundredths of a second. The jitter is what keeps it bearable the two-hundredth time. */
export function uiClick(): AudioPatch {
  return patch(0.09, [
    makeLayer({
      gain: 0.45,
      source: { kind: 'tone', wave: 'triangle' },
      pitch: { start: 2300, slide: -12, slideCurve: EASE_OUT, jitter: 20 },
      amp: { attack: 0.0005, hold: 0, decay: 0.045, sustain: 0, release: 0.02, curve: 2.5 },
    }),
    makeLayer({
      gain: 0.2,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 3400, jitter: 25 },
      filter: { kind: 'highpass', cutoff: 1900, resonance: 0.15 },
      amp: { attack: 0.0004, hold: 0, decay: 0.028, sustain: 0, release: 0.012, curve: 3 },
    }),
  ], { tone: 0.3 }, { gain: 2.19 })
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
  ], { tone: 0.25, delayMix: 0.12, delayTime: 0.09, delayFeedback: 0.25 }, { gain: 1.25 })
}

/** Band-passed noise swept across the ear, with the flanger doing the movement. */
export function whoosh(): AudioPatch {
  return patch(0.9, [
    makeLayer({
      gain: 0.7,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 400, resonance: 0.55, envAmount: 3.2, envCurve: LINEAR },
      amp: { attack: 0.3, hold: 0.02, decay: 0.35, sustain: 0.2, release: 0.22, curve: 1.6 },
    }),
  ], { flangerMix: 0.35, flangerRate: 0.7, flangerDepth: 0.6, reverbMix: 0.15, tone: -0.1 }, { gain: 3 })
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
  ], { tone: -0.15 }, { gain: 0.61 })
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
  ], { tone: 0.15 }, { gain: 1.61 })
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
      gain: 0.62,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2400, slide: 4, slideCurve: EASE_OUT, vibratoRate: 11, vibratoDepth: 0.6, jitter: 22 },
      filter: { kind: 'bandpass', cutoff: 2600, resonance: 0.35, envAmount: 0.9, envCurve: LINEAR },
      amp: { attack: 0.03, hold: 0.04, decay: 0.3, sustain: 0.25, release: 0.3, curve: 1.7 },
    }),
    makeLayer({
      gain: 0.34,
      spread: 0.7,
      source: { kind: 'tone', wave: 'triangle', voices: 2, detune: 14 },
      pitch: { start: 1180, slide: -2, vibratoRate: 6.5, vibratoDepth: 0.35, jitter: 14 },
      amp: { attack: 0.06, hold: 0.02, decay: 0.25, sustain: 0.3, release: 0.32, curve: 1.6 },
    }),
  ], { flangerMix: 0.42, flangerRate: 0.9, flangerDepth: 0.75, reverbMix: 0.3, reverbSize: 0.75, reverbDamping: 0.35, tone: 0.4 }, { gain: 2.33 })
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
  ], { reverbMix: 0.36, reverbSize: 0.85, reverbDamping: 0.4, delayMix: 0.14, delayTime: 0.16, delayFeedback: 0.35, tone: -0.15 }, { gain: 0.64 })
}

/** The sound a panel makes when it agrees with you. Two notes up, and a tail that is all room. */
export function interfaceConfirm(): AudioPatch {
  return patch(0.5, [
    makeLayer({
      gain: 0.4,
      spread: 0.5,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 7 },
      pitch: { start: 1320, arpeggioRatio: 1.5, arpeggioAt: 0.22, jitter: 16 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.14, sustain: 0, release: 0.1, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.14,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 4200, jitter: 25 },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.2 },
      amp: { attack: 0.001, hold: 0, decay: 0.05, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { delayMix: 0.22, delayTime: 0.085, delayFeedback: 0.4, reverbMix: 0.22, reverbSize: 0.6, tone: 0.45 }, { gain: 2.14 })
}

/** Something filling up. The filter opens with the pitch, which is what makes it read as building. */
export function charge(): AudioPatch {
  return patch(1.1, [
    makeLayer({
      gain: 0.42,
      spread: 0.8,
      source: { kind: 'tone', wave: 'saw', voices: 4, detune: 22 },
      pitch: { start: 130, slide: 26, slideCurve: EASE_IN, vibratoRate: 5, vibratoDepth: 0.25, jitter: 8 },
      filter: { kind: 'lowpass', cutoff: 500, resonance: 0.5, envAmount: 3.4, envCurve: EASE_IN },
      amp: { attack: 0.12, hold: 0.02, decay: 0.3, sustain: 0.55, release: 0.18, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.16,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1400, resonance: 0.3, envAmount: 2.2, envCurve: EASE_IN },
      amp: { attack: 0.25, hold: 0, decay: 0.4, sustain: 0.3, release: 0.2, curve: 1.4 },
    }),
  ], { flangerMix: 0.2, flangerRate: 0.35, flangerDepth: 0.6, reverbMix: 0.18, tone: 0.2 }, { gain: 1.34 })
}

/** A beam passing over you: one narrow band walked across the spectrum and back through a flanger. */
export function scan(): AudioPatch {
  return patch(0.85, [
    makeLayer({
      gain: 0.55,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 320, resonance: 0.72, envAmount: 4.2, envCurve: LINEAR },
      amp: { attack: 0.16, hold: 0.05, decay: 0.3, sustain: 0.35, release: 0.28, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.18,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.2 },
      pitch: { start: 3100, slide: 9, slideCurve: LINEAR, jitter: 20 },
      filter: { kind: 'highpass', cutoff: 2200, resonance: 0.25 },
      amp: { attack: 0.2, hold: 0, decay: 0.35, sustain: 0.2, release: 0.25, curve: 1.6 },
    }),
  ], { flangerMix: 0.45, flangerRate: 1.6, flangerDepth: 0.85, reverbMix: 0.24, reverbSize: 0.7, tone: 0.3 }, { gain: 2.31 })
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
  ], { reverbMix: 0.2, reverbSize: 0.72, reverbDamping: 0.55, tone: -0.2 }, { gain: 0.48, limiter: 0.85 })
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
  ], { reverbMix: 0.14, reverbSize: 0.6, tone: -0.45 }, { gain: 0.35, limiter: 0.9 })
}

/** Machine noise: quantised to four bits and repeated by a delay short enough to be a texture. */
export function dataBurst(): AudioPatch {
  return patch(0.55, [
    makeLayer({
      gain: 0.42,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 3300, slide: -6, slideCurve: LINEAR, arpeggioRatio: 1.6, arpeggioAt: 0.4, jitter: 30 },
      filter: { kind: 'bandpass', cutoff: 2800, resonance: 0.4, envAmount: -1.4, envCurve: EASE_OUT },
      shaper: { drive: 0.2, bitDepth: 4, crush: 0.3 },
      amp: { attack: 0.001, hold: 0.01, decay: 0.09, sustain: 0.15, release: 0.12, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.2,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.12 },
      pitch: { start: 1900, slide: 5, jitter: 35 },
      shaper: { drive: 0, bitDepth: 5, crush: 0.2 },
      amp: { attack: 0.0008, hold: 0, decay: 0.04, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { delayMix: 0.35, delayTime: 0.055, delayFeedback: 0.52, reverbMix: 0.12, tone: 0.25 }, { gain: 1.96 })
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
  ], { reverbMix: 0.26, reverbSize: 0.78, reverbDamping: 0.5, tone: -0.3 }, { gain: 1.17 })
}

/** Three of the same blip, spaced by a delay rather than played, which is why it locks. */
export function lockOn(): AudioPatch {
  return patch(0.95, [
    makeLayer({
      gain: 0.34,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 2550, slide: 3, slideCurve: EASE_OUT, jitter: 10 },
      amp: { attack: 0.0015, hold: 0.008, decay: 0.05, sustain: 0, release: 0.04, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.16,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 6200, jitter: 22 },
      filter: { kind: 'highpass', cutoff: 3600, resonance: 0.18 },
      amp: { attack: 0.0005, hold: 0, decay: 0.025, sustain: 0, release: 0.02, curve: 3 },
    }),
  ], { delayMix: 0.4, delayTime: 0.115, delayFeedback: 0.5, reverbMix: 0.2, reverbSize: 0.55, tone: 0.35 }, { gain: 2.87 })
}

/** Held rather than struck. The flanger does the shimmering; the vibrato keeps it from sitting still. */
export function shield(): AudioPatch {
  return patch(1.4, [
    makeLayer({
      gain: 0.44,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 1750, slide: 3, slideCurve: EASE_OUT, vibratoRate: 7.5, vibratoDepth: 0.45, jitter: 18 },
      filter: { kind: 'bandpass', cutoff: 1500, resonance: 0.52, envAmount: 1.6, envCurve: EASE_OUT },
      amp: { attack: 0.05, hold: 0.08, decay: 0.4, sustain: 0.45, release: 0.55, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.26,
      spread: 0.8,
      source: { kind: 'tone', wave: 'triangle', voices: 3, detune: 12 },
      pitch: { start: 440, slide: 2, vibratoRate: 4.5, vibratoDepth: 0.3, jitter: 12 },
      amp: { attack: 0.08, hold: 0.05, decay: 0.35, sustain: 0.5, release: 0.5, curve: 1.4 },
    }),
  ], { flangerMix: 0.5, flangerRate: 0.55, flangerDepth: 0.8, reverbMix: 0.34, reverbSize: 0.8, reverbDamping: 0.35, tone: 0.25 }, { gain: 2.35 })
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
  ], { delayMix: 0.18, delayTime: 0.14, delayFeedback: 0.3, reverbMix: 0.18, tone: -0.05 }, { gain: 0.69 })
}

/** What a sound is for, which is how anyone looks for one. Twenty in a flat list is a wall. */
export type PresetGroup = 'Arcade' | 'Interface' | 'Impact' | 'Motion'

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
]

export const PRESET_GROUPS: PresetGroup[] = ['Arcade', 'Interface', 'Impact', 'Motion']
