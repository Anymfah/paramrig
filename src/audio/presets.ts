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
  ], { tone: 0.2 })
}

/** A saw falling three octaves with the filter chasing it down, plus a breath of noise on the front. */
export function laser(): AudioPatch {
  return patch(0.35, [
    makeLayer({
      gain: 0.7,
      source: { kind: 'tone', wave: 'saw' },
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
  ], { tone: 0.1 })
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
  ], { reverbMix: 0.22, reverbSize: 0.7, reverbDamping: 0.5, tone: -0.25 }, { gain: 0.8, limiter: 0.9 })
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
  ], { tone: 0.3 })
}

/** Rising, and a step up near the end so it reads as an arrival rather than a ramp. */
export function powerup(): AudioPatch {
  return patch(0.6, [
    makeLayer({
      gain: 0.5,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.35 },
      pitch: { start: 523, slide: 19, slideCurve: EASE_IN, arpeggioRatio: 1.26, arpeggioAt: 0.62, jitter: 8 },
      amp: { attack: 0.006, hold: 0.02, decay: 0.4, sustain: 0.35, release: 0.14, curve: 1.8 },
    }),
  ], { tone: 0.25, delayMix: 0.12, delayTime: 0.09, delayFeedback: 0.25 })
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
  ], { flangerMix: 0.35, flangerRate: 0.7, flangerDepth: 0.6, reverbMix: 0.15, tone: -0.1 })
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
  ], { tone: -0.15 })
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
  ], { tone: 0.15 })
}

export const PRESETS: { id: string; label: string; build: () => AudioPatch }[] = [
  { id: 'coin', label: 'Coin', build: coin },
  { id: 'laser', label: 'Laser', build: laser },
  { id: 'explosion', label: 'Explosion', build: explosion },
  { id: 'ui-click', label: 'UI click', build: uiClick },
  { id: 'powerup', label: 'Powerup', build: powerup },
  { id: 'whoosh', label: 'Whoosh', build: whoosh },
  { id: 'hit', label: 'Hit', build: hit },
  { id: 'jump', label: 'Jump', build: jump },
]
