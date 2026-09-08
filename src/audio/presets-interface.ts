import type { AudioPatch, FxSettings, Layer, Lfo, MasterSettings } from './types.ts'
import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import { makeLayer, makePatch } from './patch.ts'

/*
 * The interface set.
 *
 * These live apart from the other presets for one reason: there are thirty-five of them, and one
 * file holding every sound in the library would be two thousand lines of the same shape. The
 * registry in `presets.ts` remains the only place that knows what exists — this file exports
 * functions and nothing else.
 *
 * They were built to one rule, learned from a patch Soheil made by hand: brilliance belongs to the
 * transient, and the body it lands on is allowed to be dark. A sound bright everywhere reads as
 * thin. What makes one read as designed is that its second element is not a second strike — it
 * arrives late, sustains, and is chopped by a modulator on its own gain.
 */

function patch(duration: number, layers: Layer[], fx: Partial<FxSettings> = {}, master: Partial<MasterSettings> = {}, lfos: Partial<Lfo>[] = []): AudioPatch {
  return makePatch(duration, layers, fx, master, 1, lfos)
}

/* ------------------------------------------------------------------ Touch */

/**
 * The pointer crossing something. Ninety milliseconds, and what lasts is the top of it: the strike
 * is over in three, and the body it excites at 11.6 kHz carries the fifteen after that. The body is
 * two partials rather than three — 11.6 and 15.3 kHz — because the third stood at 20.8 kHz, which
 * is level spent where nobody hears it. Air is nearly all this one is made of, which is a decision
 * about how often it plays rather than about how it sounds once.
 */
export function focusHover(): AudioPatch {
  return patch(0.09, [
    makeLayer({
      gain: 0.5,
      spread: 0.55,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 5000, resonance: 0.1 },
      resonator: { amount: 1, frequency: 11600, spread: 0.18, decay: 0.042, partials: 2 },
      amp: { attack: 0.0002, hold: 0.0008, decay: 0.0022, sustain: 0, release: 0.001, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.62,
      spread: 0.95,
      offset: 0.004,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 2800, resonance: 0.4 },
      resonator: { amount: 0.85, frequency: 5000, spread: 0.5, decay: 0.028, partials: 3 },
      amp: { attack: 0.0006, hold: 0.005, decay: 0.018, sustain: 0.26, release: 0.045, curve: 2.9 },
    }),
    makeLayer({
      gain: 0.11,
      spread: 0.5,
      offset: 0.007,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 1500, resonance: 0.3 },
      resonator: { amount: 0.9, frequency: 2600, spread: 0.62, decay: 0.04, partials: 3 },
      amp: { attack: 0.0004, hold: 0.002, decay: 0.012, sustain: 0, release: 0.024, curve: 2.9 },
    }),
  ], { reverbMix: 0.05, reverbSize: 0.18, reverbDamping: 0.8, width: 0.85, tone: 0.4 },
     { gain: 0.6836 }, [
       { enabled: true, shape: 'noise', rate: 38, depth: 0.55, target: 'layers[1].cutoff' },
       { enabled: true, shape: 'noise', rate: 26, depth: 0.5, target: 'layers[1].gain' },
     ])
}

/**
 * A control taking hold. The strike is a bar at four kilohertz with its partials opened out to
 * eight and fifteen, so the fundamental is low and the brilliance is inside the object rather than
 * laid over it. It stops at fifteen on purpose: opened all the way the third partial goes to
 * nineteen and a half, where it becomes the loudest thing in the sound and is audible to nobody.
 * This is the dark one of the three — four per cent of its energy above eight kilohertz across the
 * whole event against half of it across the attack — and it is dark on purpose: arming is a thing
 * you feel more than hear.
 */
export function focusArm(): AudioPatch {
  return patch(0.09, [
    makeLayer({
      gain: 0.5,
      spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1200, resonance: 0.12 },
      resonator: { amount: 1, frequency: 4000, spread: 0.6, decay: 0.035, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.11,
      spread: 0.7,
      offset: 0.006,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 2600, resonance: 0.34 },
      shaper: { drive: 0.12 },
      resonator: { amount: 0.9, frequency: 5400, spread: 0.5, decay: 0.04, partials: 3 },
      amp: { attack: 0.0005, hold: 0.008, decay: 0.03, sustain: 0.3, release: 0.05, curve: 2.9 },
    }),
  ], { reverbMix: 0.1, reverbSize: 0.2, reverbDamping: 0.78, width: 0.75, tone: 0.15 },
     { gain: 0.6241 }, [{ enabled: true, shape: 'square', rate: 26, depth: 1, phase: 0.55, target: 'layers[1].gain' }])
}

/**
 * The focus ring landing on a control. The only one of the three with a pitch, and it is deliberately
 * not a note: a sine at 1150 Hz phase-modulated at 2.76, which is the second mode of a free bar and
 * the same number the resonators here open onto. Its sidebands land at 2.0, 4.3, 5.2 and 7.5 kHz,
 * and none of them is a simple multiple of another. At two and a half they all would have been —
 * every partial a whole multiple of 581 Hz, with the second and third of that series both present,
 * which the ear resolves as a note with a fifth on top. Confirm already puts one of those in this
 * register.
 */
export function focusRing(): AudioPatch {
  return patch(0.115, [
    makeLayer({
      gain: 0.52,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.12 },
      resonator: { amount: 1, frequency: 10500, spread: 0.24, decay: 0.03, partials: 2 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.0025, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.6,
      offset: 0.002,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 6, fmRatio: 2.76, fmIndex: 3.6, fmFall: 0.9 },
      pitch: { start: 1150, jitter: 12 },
      amp: { attack: 0.001, hold: 0.004, decay: 0.07, sustain: 0, release: 0.035, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.36,
      spread: 1,
      offset: 0.012,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 3000, resonance: 0.5 },
      amp: { attack: 0.004, hold: 0.008, decay: 0.03, sustain: 0.22, release: 0.07, curve: 2.2 },
    }),
  ], { reverbMix: 0.08, reverbSize: 0.2, reverbDamping: 0.78, width: 0.8, tone: 0.3 },
     { gain: 1.031 }, [{ enabled: true, shape: 'triangle', rate: 4.2, depth: 0.45, target: 'layers[2].cutoff' }])
}

/**
 * A key going down, which is two contacts and not one: the switch, and then the cap reaching the
 * plate six milliseconds later. The body is deliberately low — four kilohertz, plastic rather than
 * glass — because the rest of this family lives in the air band and a keystroke that joins it up
 * there is a hi-hat. There is no modulator, because nothing about a keystroke continues.
 */
export function inputKey(): AudioPatch {
  return patch(0.085, [
    makeLayer({
      gain: 0.5,
      spread: 0.28,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1700, resonance: 0.1 },
      resonator: { amount: 0.85, frequency: 4200, spread: 0.34, decay: 0.02, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0008, decay: 0.0025, sustain: 0, release: 0.001, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.38,
      spread: 0.2,
      offset: 0.006,
      source: { kind: 'tone', wave: 'sine', fmRatio: 2.94, fmIndex: 3.2, fmFall: 1 },
      pitch: { start: 320, jitter: 55 },
      amp: { attack: 0.0006, hold: 0.001, decay: 0.006, sustain: 0, release: 0.005, curve: 3 },
    }),
    makeLayer({
      gain: 0.9,
      spread: 0.75,
      offset: 0.002,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 10800, jitter: 45 },
      filter: { kind: 'highpass', cutoff: 8200, resonance: 0.1 },
      resonator: { amount: 0.55, frequency: 10400, spread: 0.1, decay: 0.02, partials: 2 },
      amp: { attack: 0.0002, hold: 0, decay: 0.005, sustain: 0, release: 0.003, curve: 3.2 },
    }),
  ], { reverbMix: 0, width: 0.3, tone: 0.05 }, { gain: 1.502 })
}

/**
 * A field taking the value it was handed. Built the way Select is — a strike, then something that
 * keeps moving under it — except that what keeps moving is a swell and not a chop: the modulator
 * is a sine on the tone's own gain, so the field breathes once across the event instead of being
 * gated through it. A square there would say the value is being processed; this says it is held.
 */
export function inputAccept(): AudioPatch {
  return patch(0.17, [
    makeLayer({
      gain: 0.85,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2600, resonance: 0.12 },
      resonator: { amount: 1, frequency: 8800, spread: 0.26, decay: 0.022, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.34,
      spread: 0.55,
      offset: 0.004,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 6, fmRatio: 3.01, fmIndex: 3, fmFall: 1 },
      pitch: { start: 1046, slide: 2, slideCurve: EASE_OUT, jitter: 12 },
      amp: { attack: 0.001, hold: 0.006, decay: 0.05, sustain: 0.26, release: 0.06, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.65,
      spread: 0.3,
      offset: 0.009,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'lowpass', cutoff: 820, resonance: 0.24, envAmount: -0.9, envCurve: EASE_OUT },
      amp: { attack: 0.005, hold: 0.004, decay: 0.075, sustain: 0, release: 0.05, curve: 2.2 },
    }),
  ], { reverbMix: 0.09, reverbSize: 0.18, reverbDamping: 0.8, width: 0.7, tone: 0.3 },
     { gain: 0.4153 }, [{ enabled: true, shape: 'sine', rate: 9, depth: 0.55, phase: 0.25, target: 'layers[1].gain' }])
}

/**
 * A form checking itself, and the only one of the three with a middle. The strike lands, six
 * packets of banded noise run under it at twenty-two hertz, and at a hundred and six milliseconds
 * a narrow body at eleven kilohertz is struck once, which is the answer coming back. The other
 * mechanisms in this group put their third layer on the strike, so their events have a beginning
 * and an end and nothing between; here the middle is the work and the answer arrives inside it.
 */
export function inputValidate(): AudioPatch {
  return patch(0.3, [
    makeLayer({
      gain: 0.6,
      spread: 0.42,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3200, resonance: 0.12 },
      resonator: { amount: 1, frequency: 9800, spread: 0.3, decay: 0.038, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.45,
      spread: 0.65,
      offset: 0.018,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 2100, resonance: 0.34, envAmount: 1.6, envCurve: EASE_IN },
      shaper: { drive: 0, bitDepth: 12, crush: 0 },
      resonator: { amount: 0.9, frequency: 5200, spread: 0.58, decay: 0.05, partials: 3 },
      amp: { attack: 0.0004, hold: 0.01, decay: 0.05, sustain: 0.42, release: 0.1, curve: 2.9 },
    }),
    makeLayer({
      gain: 0.24,
      spread: 0.85,
      offset: 0.106,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 4000, resonance: 0.1 },
      resonator: { amount: 1, frequency: 11200, spread: 0.12, decay: 0.06, partials: 2 },
      amp: { attack: 0.0003, hold: 0.0008, decay: 0.0025, sustain: 0, release: 0.001, curve: 2.8 },
    }),
  ], { reverbMix: 0.11, reverbSize: 0.2, reverbDamping: 0.78, width: 0.85, tone: 0.35 },
     { gain: 0.7052 }, [
       { enabled: true, shape: 'square', rate: 22, depth: 1, phase: 0.2, target: 'layers[1].gain' },
       { enabled: true, shape: 'noise', rate: 22, depth: 0.6, phase: 0.6, target: 'layers[1].cutoff' },
     ])
}


/* ------------------------------------------------------------------ Surfaces */

/**
 * A row unfolding under a chevron. The smallest thing here and the only one with nothing modulating
 * it: a quarter of a second holds two cycles of a gate, which is not a flutter, so the movement has
 * to come from the band and from the note instead.
 */
export function discloseRow(): AudioPatch {
  return patch(0.26, [
    makeLayer({
      gain: 0.62,
      spread: 0.38,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3600, resonance: 0.12 },
      resonator: { amount: 1, frequency: 10600, spread: 0.2, decay: 0.026, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.6,
      offset: 0.016,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 2200, resonance: 0.36, envAmount: 2.1, envCurve: EASE_OUT },
      shaper: { drive: 0, bitDepth: 12, crush: 0 },
      resonator: { amount: 0.88, frequency: 6400, spread: 0.45, decay: 0.045, partials: 3 },
      amp: { attack: 0.0006, hold: 0.008, decay: 0.05, sustain: 0.26, release: 0.1, curve: 2.85 },
    }),
    makeLayer({
      gain: 0.17,
      spread: 0.5,
      offset: 0.005,
      source: { kind: 'tone', wave: 'triangle', voices: 2, detune: 8 },
      pitch: { start: 1180, slide: 12, slideCurve: EASE_OUT, jitter: 12 },
      amp: { attack: 0.001, hold: 0.003, decay: 0.05, sustain: 0, release: 0.04, curve: 2.4 },
    }),
  ], { reverbMix: 0.1, reverbSize: 0.16, reverbDamping: 0.75, width: 0.7, tone: 0.45 },
     { gain: 0.7873 }, [])
}

/**
 * A drawer, which is three moments and not one: the catch letting go, the travel, and the panel
 * meeting its stop three hundred milliseconds later.
 */
export function panelSlide(): AudioPatch {
  return patch(0.52, [
    makeLayer({
      gain: 0.62,
      spread: 0.45,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2600, resonance: 0.12 },
      resonator: { amount: 1, frequency: 8600, spread: 0.3, decay: 0.05, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.0035, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.23,
      spread: 0.75,
      offset: 0.024,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 800, resonance: 0.4, envAmount: 2.6, envCurve: EASE_OUT },
      shaper: { drive: 0, bitDepth: 11, crush: 0 },
      resonator: { amount: 0.92, frequency: 5000, spread: 0.62, decay: 0.1, partials: 4 },
      amp: { attack: 0.0006, hold: 0.02, decay: 0.09, sustain: 0.42, release: 0.18, curve: 2.9 },
    }),
    makeLayer({
      gain: 0.55,
      spread: 0.5,
      offset: 0.3,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 7 },
      pitch: { start: 118, slide: -2, slideCurve: EASE_OUT },
      amp: { attack: 0.0015, hold: 0.006, decay: 0.08, sustain: 0, release: 0.06, curve: 2.4 },
    }),
  ], { reverbMix: 0.13, reverbSize: 0.28, reverbDamping: 0.7, width: 0.82, tone: 0.3 },
     { gain: 0.7058 }, [{ enabled: true, shape: 'saw', rate: 15, depth: 0.9, phase: 0.1, target: 'layers[1].gain' }])
}

/**
 * A surface with enough of it to have a room inside. The strike is over in four milliseconds and
 * the swell behind it takes a tenth of a second to arrive; that gap is what reads as size, because
 * a small thing answers at once and a large one has to travel.
 */
export function overlayOpen(): AudioPatch {
  return patch(0.85, [
    makeLayer({
      gain: 0.55,
      spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.12 },
      resonator: { amount: 1, frequency: 9600, spread: 0.28, decay: 0.07, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.0035, sustain: 0, release: 0.0015, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.6,
      spread: 0.85,
      offset: 0.02,
      source: { kind: 'tone', wave: 'sine', voices: 3, detune: 16, fmRatio: 1.68, fmIndex: 3.2, fmFall: 0.45 },
      pitch: { start: 165, slide: 9, slideCurve: EASE_OUT, jitter: 8 },
      filter: { kind: 'lowpass', cutoff: 620, resonance: 0.32, envAmount: 3, envCurve: EASE_OUT },
      amp: { attack: 0.11, hold: 0.05, decay: 0.34, sustain: 0.16, release: 0.28, curve: 0.9 },
    }),
    makeLayer({
      gain: 0.15,
      spread: 0.95,
      offset: 0.03,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 4000, resonance: 0.1 },
      resonator: { amount: 1, frequency: 5400, spread: 0.16, decay: 0.6, partials: 4 },
      amp: { attack: 0.0004, hold: 0.0012, decay: 0.004, sustain: 0, release: 0.0015, curve: 2.8 },
    }),
  ], { reverbMix: 0.34, reverbSize: 0.7, reverbDamping: 0.42, width: 0.92, tone: 0.3 },
     { gain: 0.8304 }, [
       { enabled: true, shape: 'sine', rate: 0.8, depth: 0.35, target: 'layers[1].cutoff' },
       { enabled: true, shape: 'triangle', rate: 1.9, depth: 0.55, phase: 0.6, target: 'layers[2].gain' },
     ])
}

/**
 * A panel meeting its frame, and the order is the whole of it: the air goes first.
 *
 * What leads is the gap being pinched off — a band of pink noise falling two octaves across the
 * event and still running when the contact arrives. The contact lands eighteen milliseconds in and
 * is the only bright thing here. The frame takes the weight thirty milliseconds after that, as a
 * phase-modulated sine at 190 Hz whose depth is gone by the end, which is a thock and not a note.
 * Three events inside fifty milliseconds are heard as one mechanism.
 */
export function panelShut(): AudioPatch {
  return patch(0.28, [
    makeLayer({
      gain: 1.5,
      spread: 0.9,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 3600, resonance: 0.55, envAmount: -2.2, envCurve: LINEAR },
      amp: { attack: 0.009, hold: 0.001, decay: 0.02, sustain: 0.22, release: 0.12, curve: 1.8 },
    }),
    makeLayer({
      gain: 0.45,
      spread: 0.4,
      offset: 0.018,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2800, resonance: 0.12 },
      resonator: { amount: 1, frequency: 7200, spread: 0.4, decay: 0.05, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.0032, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 1.2,
      spread: 0.3,
      offset: 0.048,
      source: { kind: 'tone', wave: 'sine', fmRatio: 1.41, fmIndex: 3.2, fmFall: 0.95 },
      pitch: { start: 190, slide: -5, slideCurve: EASE_OUT, jitter: 8 },
      amp: { attack: 0.001, hold: 0.004, decay: 0.11, sustain: 0, release: 0.06, curve: 2.6 },
    }),
  ], { delayMix: 0.14, delayTime: 0.042, delayFeedback: 0.16, reverbMix: 0.1, reverbSize: 0.2, reverbDamping: 0.78, width: 0.62, tone: 0.05 },
     { gain: 0.4959 }, [])
}

/**
 * A drawer going back in. The catch lets go, the runners rattle, and the front meets the carcass
 * a tenth of a second later.
 */
export function drawerRetract(): AudioPatch {
  return patch(0.36, [
    makeLayer({
      gain: 0.72,
      spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3400, resonance: 0.14 },
      resonator: { amount: 1, frequency: 7600, spread: 0.34, decay: 0.042, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.34,
      spread: 0.8,
      offset: 0.018,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 1250, slide: -4, slideCurve: LINEAR, jitter: 15 },
      filter: { kind: 'bandpass', cutoff: 2800, resonance: 0.62, envAmount: -1.6, envCurve: EASE_IN },
      shaper: { drive: 0, bitDepth: 11, crush: 0 },
      resonator: { amount: 0.35, frequency: 2200, spread: 0.9, decay: 0.03, partials: 4 },
      amp: { attack: 0.004, hold: 0.02, decay: 0.05, sustain: 0.46, release: 0.12, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.03,
      spread: 0.4,
      offset: 0.115,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'highpass', cutoff: 500, resonance: 0.2 },
      resonator: { amount: 0.55, frequency: 300, spread: 0.5, decay: 0.03, partials: 3 },
      amp: { attack: 0.0006, hold: 0.004, decay: 0.012, sustain: 0, release: 0.03, curve: 2.5 },
    }),
  ], { delayMix: 0.1, delayTime: 0.035, delayFeedback: 0.25, reverbMix: 0.12, reverbSize: 0.3, reverbDamping: 0.7, width: 0.7, tone: 0.18 },
     { gain: 0.332 }, [
       { enabled: true, shape: 'noise', rate: 34, depth: 1, target: 'layers[1].gain' },
       { enabled: true, shape: 'noise', rate: 21, depth: 0.55, target: 'layers[1].cutoff' },
     ])
}

/** A sheet dropping away — a larger surface than a panel, so a lower sound and a longer one. */
export function sheetCollapse(): AudioPatch {
  return patch(0.5, [
    makeLayer({
      gain: 0.575,
      spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3200, resonance: 0.12 },
      resonator: { amount: 1, frequency: 8600, spread: 0.3, decay: 0.04, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 1.25,
      spread: 0.6,
      offset: 0.036,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 10, fmRatio: 2.61, fmIndex: 6.2, fmFall: 0.88 },
      pitch: { start: 380, slide: -13, slideCurve: EASE_OUT, jitter: 8 },
      filter: { kind: 'lowpass', cutoff: 4200, resonance: 0.2 },
      amp: { attack: 0.006, hold: 0.012, decay: 0.22, sustain: 0.06, release: 0.22, curve: 2.3 },
    }),
    makeLayer({
      gain: 0.75,
      spread: 1,
      offset: 0.018,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 5200, resonance: 0.16, envAmount: -2.6, envCurve: EASE_OUT },
      amp: { attack: 0.002, hold: 0.01, decay: 0.17, sustain: 0, release: 0.04, curve: 2 },
    }),
  ], { reverbMix: 0.22, reverbSize: 0.45, reverbDamping: 0.55, width: 0.9, tone: 0.15 },
     { gain: 0.9094 }, [])
}

/* ------------------------------------------------------------------ Signals */

/** Work beginning: the click of engagement, then something taking up load behind it. */
export function progressStart(): AudioPatch {
  return patch(0.45, [
    makeLayer({
      gain: 0.58,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2800, resonance: 0.12 },
      resonator: { amount: 1, frequency: 9200, spread: 0.28, decay: 0.04, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.7,
      spread: 0.55,
      offset: 0.01,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 9, fmRatio: 2.01, fmIndex: 5.4, fmFall: 0.3 },
      pitch: { start: 210, slide: 5, slideCurve: LINEAR, jitter: 8 },
      filter: { kind: 'lowpass', cutoff: 900, resonance: 0.35, envAmount: 2.5, envCurve: EASE_IN },
      amp: { attack: 0.05, hold: 0.06, decay: 0.14, sustain: 0.5, release: 0.15, curve: 1.5 },
    }),
    makeLayer({
      gain: 1.2,
      spread: 0.85,
      offset: 0.022,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 7600, jitter: 22 },
      filter: { kind: 'bandpass', cutoff: 7400, resonance: 0.45 },
      amp: { attack: 0.02, hold: 0.05, decay: 0.1, sustain: 0.3, release: 0.12, curve: 2.2 },
    }),
  ], { reverbMix: 0.15, reverbSize: 0.3, reverbDamping: 0.65, width: 0.8, tone: 0.3 },
     { gain: 0.4291 }, [
       { enabled: true, shape: 'square', rate: 15, depth: 0.9, phase: 0.2, target: 'layers[2].gain' },
       { enabled: true, shape: 'triangle', rate: 15, depth: 0.18, phase: 0.2, target: 'layers[1].cutoff' },
     ])
}

/** One increment. A metal tooth pinged over a small hollow body, gone in a tenth of a second. */
export function progressTick(): AudioPatch {
  return patch(0.15, [
    makeLayer({
      gain: 0.5,
      spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3400, resonance: 0.12 },
      resonator: { amount: 1, frequency: 10200, spread: 0.24, decay: 0.018, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.0025, sustain: 0, release: 0.001, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.75,
      spread: 0.5,
      offset: 0.002,
      source: { kind: 'tone', wave: 'sine', fmRatio: 1.73, fmIndex: 2.6, fmFall: 0.88 },
      pitch: { start: 1500, jitter: 18 },
      amp: { attack: 0.0008, hold: 0.004, decay: 0.05, sustain: 0, release: 0.028, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.5,
      spread: 0.3,
      offset: 0.001,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.15 },
      resonator: { amount: 0.9, frequency: 560, spread: 0.4, decay: 0.05, partials: 3 },
      amp: { attack: 0.0004, hold: 0.001, decay: 0.003, sustain: 0, release: 0.001, curve: 2.8 },
    }),
  ], { reverbMix: 0.08, reverbSize: 0.18, reverbDamping: 0.8, width: 0.6, tone: 0.25 }, { gain: 0.7507 }, [])
}

/** Work finishing: a last tick, and two struck bells an octave apart left to ring out. */
export function progressComplete(): AudioPatch {
  return patch(1.25, [
    makeLayer({
      gain: 0.55,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2600, resonance: 0.12 },
      resonator: { amount: 1, frequency: 8800, spread: 0.3, decay: 0.05, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.4,
      spread: 0.6,
      offset: 0.008,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 6, fmRatio: 3.01, fmIndex: 5, fmFall: 0.9 },
      pitch: { start: 440, jitter: 10 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.45, sustain: 0.1, release: 0.45, curve: 2.3 },
    }),
    makeLayer({
      gain: 0.34,
      spread: 0.85,
      offset: 0.09,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 8, fmRatio: 3.01, fmIndex: 4.2, fmFall: 0.92 },
      pitch: { start: 880, jitter: 12 },
      amp: { attack: 0.002, hold: 0.015, decay: 0.35, sustain: 0.08, release: 0.4, curve: 2.4 },
    }),
  ], { reverbMix: 0.3, reverbSize: 0.7, reverbDamping: 0.4, width: 0.9, tone: 0.3 },
     { gain: 1.104 }, [{ enabled: true, shape: 'sine', rate: 4.5, depth: 0.008, target: 'layers[1].pitch' }])
}

/**
 * A small amount landing, and it is two events rather than one: the strike, then a second and
 * smaller clink at eighty-five milliseconds on a 5.2 kHz body against the first one's 8.8 kHz. A
 * credit is plural, and a single click is a button.
 */
export function rewardCredit(): AudioPatch {
  return patch(0.55, [
    makeLayer({
      gain: 0.62,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2800, resonance: 0.12 },
      resonator: { amount: 1, frequency: 8800, spread: 0.24, decay: 0.045, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.8,
      spread: 0.6,
      offset: 0.022,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 9, fmRatio: 3.46, fmIndex: 3.4, fmFall: 0.86 },
      pitch: { start: 880, arpeggioRatio: 1.335, arpeggioAt: 0.32, jitter: 12 },
      filter: { kind: 'lowpass', cutoff: 6000, resonance: 0.15, envAmount: -1.6, envCurve: EASE_OUT },
      amp: { attack: 0.001, hold: 0.012, decay: 0.1, sustain: 0.34, release: 0.2, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.26,
      spread: 0.85,
      offset: 0.085,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3400, resonance: 0.12 },
      resonator: { amount: 1, frequency: 5200, spread: 0.4, decay: 0.09, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.0028, sustain: 0, release: 0.0012, curve: 2.8 },
    }),
  ], { delayMix: 0.1, delayTime: 0.049, delayFeedback: 0.3, reverbMix: 0.1, reverbSize: 0.3, reverbDamping: 0.72, width: 0.75, tone: 0.15 },
     { gain: 0.5271 }, [{ enabled: true, shape: 'square', rate: 17, depth: 1, phase: 0.15, target: 'layers[1].gain' }])
}

/**
 * Something giving way, and then opening. The three layers are three moments rather than three
 * timbres: the latch at zero, a band beneath it that starts at seven hundred hertz and climbs
 * nearly three octaves while ringing on a body inharmonic enough to be a casting rather than a
 * note, and at a hundred and sixty milliseconds the thing behind it — metal, sliding up a fifth,
 * its band walked further up by a modulator slow enough to make one pass across the whole sound.
 */
export function rewardUnlock(): AudioPatch {
  return patch(0.95, [
    makeLayer({
      gain: 0.62,
      spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2200, resonance: 0.14 },
      resonator: { amount: 1, frequency: 6400, spread: 0.6, decay: 0.08, partials: 4 },
      amp: { attack: 0.0004, hold: 0.0012, decay: 0.0035, sustain: 0, release: 0.0015, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.17,
      spread: 0.7,
      offset: 0.05,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 700, resonance: 0.42, envAmount: 2.8, envCurve: EASE_IN },
      shaper: { drive: 0, bitDepth: 10, crush: 0 },
      resonator: { amount: 0.7, frequency: 1900, spread: 0.8, decay: 0.1, partials: 4 },
      amp: { attack: 0.004, hold: 0.02, decay: 0.1, sustain: 0.3, release: 0.35, curve: 2.6 },
    }),
    makeLayer({
      gain: 1.2,
      spread: 1,
      offset: 0.16,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 4200, slide: 7, slideCurve: EASE_OUT, jitter: 18 },
      filter: { kind: 'bandpass', cutoff: 5200, resonance: 0.42, envAmount: 1.15, envCurve: LINEAR },
      amp: { attack: 0.09, hold: 0.05, decay: 0.28, sustain: 0.3, release: 0.32, curve: 1.6 },
    }),
  ], { reverbMix: 0.26, reverbSize: 0.6, reverbDamping: 0.45, delayMix: 0.12, delayTime: 0.13, delayFeedback: 0.3, width: 0.85, tone: 0.2 },
     { gain: 0.7492 }, [{ enabled: true, shape: 'triangle', rate: 0.9, depth: 0.45, phase: 0.5, target: 'layers[2].cutoff' }])
}

/**
 * The largest thing here, and the one event in an interface where two seconds is the point rather
 * than an indulgence: an achievement happens once an evening, so it is allowed to take the room.
 */
export function rewardAchievement(): AudioPatch {
  return patch(2.1, [
    makeLayer({
      gain: 0.55,
      spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.12 },
      resonator: { amount: 1, frequency: 11200, spread: 0.3, decay: 0.07, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.5,
      spread: 0.75,
      offset: 0.006,
      source: { kind: 'tone', wave: 'sine', voices: 3, detune: 12, fmRatio: 2.76, fmIndex: 7, fmFall: 0.9 },
      pitch: { start: 392, slide: 2, slideCurve: EASE_OUT, jitter: 8 },
      filter: { kind: 'lowpass', cutoff: 7000, resonance: 0.2 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.75, sustain: 0.1, release: 0.8, curve: 2.1 },
    }),
    makeLayer({
      gain: 1.1,
      spread: 1,
      offset: 0.16,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 3200, slide: 5, slideCurve: EASE_IN, jitter: 26 },
      filter: { kind: 'bandpass', cutoff: 3800, resonance: 0.45, envAmount: 0.8, envCurve: LINEAR },
      amp: { attack: 0.4, hold: 0.12, decay: 0.5, sustain: 0.4, release: 0.6, curve: 1.35 },
    }),
  ], { reverbMix: 0.4, reverbSize: 0.88, reverbDamping: 0.32, delayMix: 0.16, delayTime: 0.165, delayFeedback: 0.36, width: 0.95, tone: 0.25 },
     { gain: 1.503 }, [
       { enabled: true, shape: 'sine', rate: 0.55, depth: 0.22, target: 'layers[2].gain' },
       { enabled: true, shape: 'triangle', rate: 0.75, depth: 0.28, phase: 0.35, target: 'layers[2].cutoff' },
     ])
}

/**
 * One row leaving. The excitation is over in five milliseconds, nothing follows it for another
 * seventeen, and then a band falls three and a half octaves while a sampled-noise modulator cuts
 * its level forty times a second.
 */
export function deleteItem(): AudioPatch {
  return patch(0.34, [
    makeLayer({
      gain: 0.8,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2400, resonance: 0.14 },
      resonator: { amount: 1, frequency: 8800, spread: 0.52, decay: 0.042, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.34,
      spread: 0.75,
      offset: 0.032,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 5600, resonance: 0.5, envAmount: -3.4, envCurve: LINEAR },
      shaper: { drive: 0, bitDepth: 8, crush: 0 },
      resonator: { amount: 0.4, frequency: 3000, spread: 0.88, decay: 0.05, partials: 4 },
      amp: { attack: 0.0006, hold: 0.008, decay: 0.06, sustain: 0.35, release: 0.14, curve: 2.9 },
    }),
    makeLayer({
      gain: 0.28,
      offset: 0.022,
      source: { kind: 'tone', wave: 'sine', fmRatio: 2.4, fmIndex: 3.4, fmFall: 0.9 },
      pitch: { start: 145, slide: -6, slideCurve: EASE_OUT },
      amp: { attack: 0.001, hold: 0.006, decay: 0.09, sustain: 0, release: 0.06, curve: 2.4 },
    }),
  ], { reverbMix: 0.12, reverbSize: 0.22, reverbDamping: 0.78, width: 0.7, tone: 0.3 },
     { gain: 0.5058 }, [{ enabled: true, shape: 'noise', rate: 40, depth: 1, target: 'layers[1].gain' }])
}

/**
 * Paper, and three beats where a Select or a Dismiss has two. The snap is a body at six kilohertz
 * with its partials thrown almost the whole way apart, which is what unpitched sounds like; the
 * crumple behind it is a band a noise modulator moves thirty times a second, fluttering on its own
 * level at nine, so it never settles anywhere long enough to become a note.
 *
 * The third beat is the reason the preset exists. A hundred and seventy milliseconds after the
 * snap, when the crumple has nearly gone, a small hollow body at two hundred and forty hertz is
 * struck once. A draft is not discarded when you let go of it; it is discarded when it lands.
 */
export function discardDraft(): AudioPatch {
  return patch(0.55, [
    makeLayer({
      gain: 0.8,
      spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3400, resonance: 0.12 },
      resonator: { amount: 1, frequency: 6200, spread: 0.92, decay: 0.022, partials: 4 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.0028, sustain: 0, release: 0.001, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.85,
      offset: 0.022,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 5200, resonance: 0.42, envAmount: -1.6, envCurve: EASE_OUT },
      shaper: { drive: 0, bitDepth: 10, crush: 0 },
      resonator: { amount: 0.6, frequency: 3400, spread: 0.9, decay: 0.028, partials: 4 },
      amp: { attack: 0.0006, hold: 0.02, decay: 0.09, sustain: 0.18, release: 0.3, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.032,
      spread: 0.3,
      offset: 0.17,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 1100, resonance: 0.2 },
      resonator: { amount: 0.5, frequency: 240, spread: 0.5, decay: 0.03, partials: 3 },
      amp: { attack: 0.0006, hold: 0.002, decay: 0.006, sustain: 0, release: 0.012, curve: 3 },
    }),
  ], { reverbMix: 0.16, reverbSize: 0.3, reverbDamping: 0.68, width: 0.8, tone: 0.25 },
     { gain: 0.7379 }, [
       { enabled: true, shape: 'noise', rate: 30, depth: 0.5, target: 'layers[1].cutoff' },
       { enabled: true, shape: 'triangle', rate: 9, depth: 0.7, phase: 0.25, target: 'layers[1].gain' },
     ])
}

/**
 * Everything at once, and the weight is at the front. The strike is the same five milliseconds the
 * small ones get, and in the same instant a body at a hundred and eighteen hertz is struck under
 * it — the lowest thing in this family, and quiet enough that it arrives as weight rather than as
 * a note. A confirmation that reports the damage a third of a second later is one you have already
 * stopped listening to.
 */
export function wipeAll(): AudioPatch {
  return patch(0.8, [
    makeLayer({
      gain: 0.7,
      spread: 0.45,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3000, resonance: 0.14 },
      resonator: { amount: 1, frequency: 9600, spread: 0.4, decay: 0.04, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.003, sustain: 0, release: 0.0012, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.3,
      spread: 0.9,
      offset: 0.028,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 5200, resonance: 0.5, envAmount: -2.4, envCurve: EASE_OUT },
      shaper: { drive: 0, bitDepth: 9, crush: 0 },
      resonator: { amount: 0.55, frequency: 2600, spread: 0.8, decay: 0.05, partials: 3 },
      amp: { attack: 0.0005, hold: 0.02, decay: 0.12, sustain: 0.4, release: 0.34, curve: 2.9 },
    }),
    makeLayer({
      gain: 0.0028,
      spread: 0.3,
      offset: 0.004,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 900, resonance: 0.18 },
      resonator: { amount: 0.95, frequency: 118, spread: 0.55, decay: 0.24, partials: 3 },
      amp: { attack: 0.0006, hold: 0.002, decay: 0.004, sustain: 0, release: 0.002, curve: 2.8 },
    }),
  ], { reverbMix: 0.22, reverbSize: 0.55, reverbDamping: 0.6, width: 0.85, tone: 0.05 },
     { gain: 0.6329 }, [{ enabled: true, shape: 'saw', rate: 5.5, depth: 0.9, phase: 0.45, target: 'layers[1].gain' }])
}
