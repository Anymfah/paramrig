import type { AudioPatch, Layer, Lfo, MasterSettings } from './types.ts'
import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import type { FxInput } from './patch.ts'
import { makeLayer, makePatch } from './patch.ts'

/*
 * The series built against measured reference material.
 *
 * Everything before this was designed to a rule I had inferred from one patch: brilliance in the
 * transient, and a dark body under it. Five files by the creator Soheil was actually aiming at
 * were then decoded and measured, and they do the opposite — their bodies get brighter across the
 * event, they peak an octave higher than anything here did, and a sound the size of a menu click
 * carries five separate onsets rather than one.
 *
 * So these are built to the shape of Soheil's own spark burst instead, which measured closer to
 * that material than anything I had written: three short strikes at staggered offsets, bodies
 * placed so their partials cover the spectrum between them, and a short delay at high mix turning
 * three layers into six events. Each one was scored against the reference octave profile rather
 * than against my judgement of it.
 */

function patch(duration: number, layers: Layer[], fx: FxInput = {}, master: Partial<MasterSettings> = {}, lfos: Partial<Lfo>[] = []): AudioPatch {
  return makePatch(duration, layers, fx, master, 1, lfos)
}

/* ------------------------------------------------------------------ Interface FX */

/**
 * Choosing an item, and the shortest thing in the family. One 3.6 kHz body struck three times in
 * the first fifty milliseconds, each strike excited through a higher filter than the last, so the
 * event brightens while the object stays the same. That body's four partials land one to a band —
 * 3.6, 7.3, 12.8 and 20 kHz — which is where the whole spectrum comes from. There is no reverb in
 * it: at a sixth of a second, a room would outlast the sound it was meant to place.
 */
export function selectTap(): AudioPatch {
  return patch(0.16, [
    makeLayer({
      gain: 0.8,
      spread: 0.4,
      offset: 0.004,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3400, resonance: 0.14 },
      resonator: { amount: 1, frequency: 3600, spread: 0.58, decay: 0.026, partials: 5 },
      amp: { attack: 0.0003, hold: 0.0026, decay: 0.005, sustain: 0, release: 0.002, curve: 2.7 },
    }),
    makeLayer({
      gain: 0.85,
      spread: 0.5,
      offset: 0.024,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 4200, resonance: 0.13 },
      resonator: { amount: 1, frequency: 3600, spread: 0.58, decay: 0.013, partials: 5 },
      amp: { attack: 0.0002, hold: 0.0013, decay: 0.0035, sustain: 0, release: 0.0015, curve: 3 },
    }),
    makeLayer({
      gain: 0.95,
      spread: 0.6,
      offset: 0.047,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 5600, resonance: 0.12 },
      resonator: { amount: 0.8, frequency: 3600, spread: 0.58, decay: 0.01, partials: 5 },
      amp: { attack: 0.0002, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 3.2 },
    }),
  ], {
    delayTime: 0.033, delayFeedback: 0.45, delayMix: 0.55,
    reverbMix: 0, reverbSize: 0.1, reverbDamping: 0.9,
    tone: 0.3, width: 0.5,
  }, { gain: 0.3614, fadeOut: 0.012 })
}

/**
 * The item accepted, and the only one of the three with a pitch in it. Two strikes thirty
 * milliseconds apart, then at eighty-eight a phase-modulated sine at two thousand four hundred
 * hertz, climbing a whole tone while its modulation collapses — it arrives as a clang and leaves
 * as a note. The second strike opens its own filter nearly an octave and a half as it fires, so
 * the pair still brightens before the note lands under them.
 */
export function selectConfirm(): AudioPatch {
  return patch(0.26, [
    makeLayer({
      gain: 0.95,
      spread: 0.45,
      offset: 0.006,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3200, resonance: 0.14 },
      resonator: { amount: 1, frequency: 3300, spread: 0.34, decay: 0.026, partials: 5 },
      amp: { attack: 0.0003, hold: 0.003, decay: 0.006, sustain: 0, release: 0.0022, curve: 2.7 },
    }),
    makeLayer({
      gain: 0.35,
      spread: 0.6,
      offset: 0.036,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 6400, resonance: 0.12, envAmount: 1.4, envCurve: EASE_OUT },
      resonator: { amount: 0.5, frequency: 12800, spread: 0.08, decay: 0.01, partials: 3 },
      amp: { attack: 0.0002, hold: 0.0012, decay: 0.0035, sustain: 0, release: 0.0015, curve: 3 },
    }),
    makeLayer({
      gain: 0.55,
      spread: 0.5,
      offset: 0.088,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 8, fmRatio: 3.1, fmIndex: 3.0, fmFall: 0.75 },
      pitch: { start: 2400, slide: 2, slideCurve: EASE_OUT, jitter: 12 },
      amp: { attack: 0.0006, hold: 0.002, decay: 0.09, sustain: 0, release: 0.05, curve: 2.7 },
    }),
  ], {
    delayTime: 0.042, delayFeedback: 0.3, delayMix: 0.58,
    reverbMix: 0.07, reverbSize: 0.18, reverbDamping: 0.86,
    tone: 0.4, width: 0.7,
  }, { gain: 0.3535, fadeOut: 0.016 })
}

/**
 * Committing to it, and the only one still sounding when it ends. The strike itself lasts eleven
 * milliseconds; under it a 3.15 kHz body, rung by a seven-millisecond burst, decays for a quarter
 * of a second, with air above eleven kilohertz holding on. Two sine modulators at seven and nine
 * hertz — one on the ring's level, one on the air's filter — never come round together, so the
 * tail does not repeat itself. The delay is eighty milliseconds, long enough that a repeat answers
 * the strike instead of fluttering after it.
 */
export function selectCommit(): AudioPatch {
  return patch(0.46, [
    makeLayer({
      gain: 0.85,
      spread: 0.4,
      offset: 0.005,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3400, resonance: 0.14 },
      resonator: { amount: 1, frequency: 3000, spread: 0.4, decay: 0.03, partials: 5 },
      amp: { attack: 0.0003, hold: 0.0035, decay: 0.007, sustain: 0, release: 0.0025, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.5,
      spread: 0.5,
      offset: 0.05,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3200, resonance: 0.16 },
      resonator: { amount: 1, frequency: 3150, spread: 0.44, decay: 0.24, partials: 5 },
      amp: { attack: 0.0004, hold: 0.002, decay: 0.005, sustain: 0, release: 0.002, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.7,
      spread: 0.6,
      offset: 0.104,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 11000, resonance: 0.12 },
      resonator: { amount: 0.35, frequency: 3600, spread: 0.58, decay: 0.01, partials: 5 },
      amp: { attack: 0.0002, hold: 0.0012, decay: 0.012, sustain: 0.3, release: 0.2, curve: 3.2 },
    }),
  ], {
    delayTime: 0.08, delayFeedback: 0.3, delayMix: 0.5,
    reverbMix: 0.14, reverbSize: 0.34, reverbDamping: 0.72,
    tone: 0.25, width: 0.6,
  }, { gain: 0.4188, fadeOut: 0.018 }, [
    { enabled: true, shape: 'sine', rate: 7, depth: 0.55, phase: 0.25, target: 'layers[1].gain' },
    { enabled: true, shape: 'sine', rate: 9, depth: 0.3, target: 'layers[2].cutoff' },
  ])
}

/**
 * One item to the next, and the shortest thing in the set. The three strikes land inside six
 * milliseconds, so the ear reads them as one event; the four onsets after it are a delay at
 * twenty-six milliseconds reprinting that event, not more layers. The reverb is down at three per
 * cent because this fires in runs, and a tail on it would smear the next one.
 */
export function stepAdvance(): AudioPatch {
  return makePatch(0.17, [
    makeLayer({
      gain: 0.26,
      spread: 0.55,
      offset: 0.004,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1700, resonance: 0.1 },
      resonator: { amount: 1, frequency: 2400, spread: 0.22, decay: 0.018, partials: 4 },
      amp: { attack: 0.0003, hold: 0.003, decay: 0.006, sustain: 0, release: 0.002, curve: 2.7 },
    }),
    makeLayer({
      gain: 0.51,
      spread: 0.62,
      offset: 0.007,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2900, jitter: 45 },
      filter: { kind: 'highpass', cutoff: 4000, resonance: 0.14 },
      resonator: { amount: 0.85, frequency: 6200, spread: 0.26, decay: 0.014, partials: 3 },
      amp: { attack: 0.0002, hold: 0.0014, decay: 0.004, sustain: 0, release: 0.0016, curve: 3 },
    }),
    makeLayer({
      gain: 0.85,
      spread: 0.7,
      offset: 0.01,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 12000, resonance: 0.1 },
      resonator: { amount: 0.6, frequency: 12000, spread: 0.2, decay: 0.01, partials: 2 },
      amp: { attack: 0.0002, hold: 0.001, decay: 0.003, sustain: 0, release: 0.0012, curve: 3.2 },
    }),
  ], {
    delayTime: 0.026,
    delayFeedback: 0.68,
    delayMix: 0.62,
    reverbMix: 0.03,
    reverbSize: 0.1,
    reverbDamping: 0.9,
    tone: 0.35,
    width: 0.55,
  }, { gain: 0.893, fadeOut: 0.016 }, 1, [])
}

/**
 * A lever driven home. Three contacts inside eighty milliseconds — the snap at zero, the stop it
 * reaches at thirty-six, the dust off the pivot at seventy-four — and a fifty-two millisecond
 * delay prints each of them once, so three contacts leave six instants.
 */
export function leverEngage(): AudioPatch {
  return patch(0.26, [
    makeLayer({
      gain: 0.95,
      spread: 0.6,
      offset: 0,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1400, resonance: 0.12 },
      resonator: { amount: 0.9, frequency: 3000, spread: 0.3, decay: 0.01, partials: 5 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.004, sustain: 0, release: 0.0015, curve: 2.7 },
    }),
    makeLayer({
      gain: 0.8,
      spread: 0.55,
      offset: 0.036,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 4400, resonance: 0.12 },
      resonator: { amount: 0.8, frequency: 6100, spread: 0.3, decay: 0.01, partials: 3 },
      amp: { attack: 0.0002, hold: 0.001, decay: 0.0032, sustain: 0, release: 0.0012, curve: 3 },
    }),
    makeLayer({
      gain: 1.5,
      spread: 0.7,
      offset: 0.074,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 13500, resonance: 0.1 },
      resonator: { amount: 0.14, frequency: 16000, spread: 0.05, decay: 0.012, partials: 2 },
      amp: { attack: 0.0002, hold: 0.0015, decay: 0.007, sustain: 0, release: 0.003, curve: 3.1 },
    }),
  ], {
    delayTime: 0.052, delayFeedback: 0.16, delayMix: 0.56,
    reverbMix: 0.05, reverbSize: 0.14, reverbDamping: 0.86,
    tone: 0.2, width: 0.6,
  }, { gain: 0.6631, fadeOut: 0.014 })
}

/**
 * The same lever let go. Its snap is Engage's with no number changed, and so is its dust, apart
 * from when the dust starts: here it comes at thirty-six milliseconds and the landing at
 * seventy-four, where Engage has them the other way round. The same three instants therefore end
 * high in one and low in the other, which is the whole of the difference between throwing a lever
 * and releasing it.
 */
export function leverRelease(): AudioPatch {
  return patch(0.3, [
    makeLayer({
      gain: 0.95,
      spread: 0.6,
      offset: 0,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1400, resonance: 0.12 },
      resonator: { amount: 0.9, frequency: 3000, spread: 0.3, decay: 0.01, partials: 5 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.004, sustain: 0, release: 0.0015, curve: 2.7 },
    }),
    makeLayer({
      gain: 0.8,
      spread: 0.55,
      offset: 0.074,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 3200, resonance: 0.12 },
      resonator: { amount: 0.8, frequency: 4550, spread: 0.3, decay: 0.018, partials: 4 },
      amp: { attack: 0.0002, hold: 0.001, decay: 0.0042, sustain: 0, release: 0.0016, curve: 3 },
    }),
    makeLayer({
      gain: 1.5,
      spread: 0.7,
      offset: 0.036,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 13500, resonance: 0.1 },
      resonator: { amount: 0.14, frequency: 16000, spread: 0.05, decay: 0.012, partials: 2 },
      amp: { attack: 0.0002, hold: 0.0015, decay: 0.007, sustain: 0, release: 0.003, curve: 3.1 },
    }),
  ], {
    delayTime: 0.056, delayFeedback: 0.28, delayMix: 0.56,
    reverbMix: 0.05, reverbSize: 0.14, reverbDamping: 0.86,
    tone: 0.08, width: 0.6,
  }, { gain: 0.4998, fadeOut: 0.016 })
}

/**
 * A checkbox: the contact at zero, a tick eighteen milliseconds behind it on a body at 9.2 kHz,
 * and bare noise above 13.5 kHz at forty. A checkbox has no travel, so nothing moves between the
 * three and they are over inside fifty milliseconds.
 */
export function checkMark(): AudioPatch {
  return patch(0.19, [
    makeLayer({
      gain: 0.85,
      spread: 0.5,
      offset: 0,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1800, resonance: 0.12 },
      resonator: { amount: 0.9, frequency: 3200, spread: 0.34, decay: 0.01, partials: 4 },
      amp: { attack: 0.0002, hold: 0.0008, decay: 0.0026, sustain: 0, release: 0.001, curve: 3 },
    }),
    makeLayer({
      gain: 0.7,
      spread: 0.6,
      offset: 0.018,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 6800, resonance: 0.1 },
      resonator: { amount: 0.55, frequency: 9200, spread: 0.22, decay: 0.01, partials: 3 },
      amp: { attack: 0.0002, hold: 0.0006, decay: 0.0022, sustain: 0, release: 0.001, curve: 3.2 },
    }),
    makeLayer({
      gain: 0.75,
      spread: 0.72,
      offset: 0.04,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 13500, resonance: 0.1 },
      resonator: { amount: 0.12, frequency: 16000, spread: 0.05, decay: 0.01, partials: 2 },
      amp: { attack: 0.0002, hold: 0.0008, decay: 0.005, sustain: 0, release: 0.002, curve: 3.3 },
    }),
  ], {
    delayTime: 0.042, delayFeedback: 0.46, delayMix: 0.45,
    reverbMix: 0.04, reverbSize: 0.1, reverbDamping: 0.9,
    tone: 0.3, width: 0.55,
  }, { gain: 0.7333, fadeOut: 0.01 })
}

/* ------------------------------------------------------------------ Alerts */

/**
 * The smallest refusal, and it is high rather than low. A strike on a body at 4.6 kHz whose
 * partials climb to 16.6, a band of noise at 11.8 chopped at thirty-four hertz, and a layer of raw
 * air above 11.5 chopped at twenty-two against it. Those two rates are what the ear counts, so the
 * delay is held at half feedback: at 0.86 its own twenty-six millisecond flutter was louder than
 * either gate and filled the gaps the gates had just opened. Nothing here descends — the refusal
 * is in the stutter, not in a falling note.
 */
export function denyDeflect(): AudioPatch {
  return makePatch(0.34, [
    makeLayer({
      gain: 1.15, spread: 0.2, offset: 0.006,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 4200, resonance: 0.12 },
      resonator: { amount: 0.45, frequency: 4600, spread: 0.33, decay: 0.026, partials: 4 },
      amp: { attack: 0.0003, hold: 0.0035, decay: 0.005, sustain: 0, release: 0.002, curve: 2.7 },
    }),
    makeLayer({
      gain: 0.55, spread: 0.22, offset: 0.028,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 11500, resonance: 0.22 },
      resonator: { amount: 0.4, frequency: 11800, spread: 0.08, decay: 0.01, partials: 2 },
      amp: { attack: 0.0006, hold: 0.012, decay: 0.04, sustain: 0.45, release: 0.09, curve: 2.6 },
    }),
    makeLayer({
      gain: 1.2, spread: 0.2, offset: 0.012,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 11500, resonance: 0.1 },
      resonator: { amount: 0.05, frequency: 15000, spread: 0.06, decay: 0.01, partials: 2 },
      amp: { attack: 0.0004, hold: 0.008, decay: 0.07, sustain: 0.18, release: 0.09, curve: 2.5 },
    }),
  ], { delayTime: 0.026, delayFeedback: 0.5, delayMix: 0.44, tone: 0.35, width: 0.22 },
     { gain: 0.5328, fadeOut: 0.018 }, 1, [
       { enabled: true, shape: 'square', rate: 34, depth: 1, phase: 0, target: 'layers[1].gain' },
       { enabled: true, shape: 'square', rate: 22, depth: 1, phase: 0.25, target: 'layers[2].gain' },
     ])
}

/**
 * The same word said once and held. Every rate in it is nineteen hertz or half of it — the gate on
 * the band, the gate on the air an octave slower and half a cycle out, and the delay set to 53 ms
 * so its reprints land on the gate rather than between them. The band starts at 13.5 kHz and
 * closes four fifths of an octave while it stutters, which is the sound of something being shut
 * rather than something being struck. The strike is driven; nothing else is.
 */
export function denyLockout(): AudioPatch {
  return makePatch(0.46, [
    makeLayer({
      gain: 0.7, spread: 0.14, offset: 0.004,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 4800, resonance: 0.14 },
      shaper: { drive: 0.4, bitDepth: 16, crush: 0 },
      resonator: { amount: 0.42, frequency: 5200, spread: 0.31, decay: 0.017, partials: 4 },
      amp: { attack: 0.0004, hold: 0.004, decay: 0.007, sustain: 0, release: 0.002, curve: 2.5 },
    }),
    makeLayer({
      gain: 0.6, spread: 0.16, offset: 0.026,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 13500, resonance: 0.26, envAmount: -0.8, envCurve: EASE_IN },
      resonator: { amount: 0.42, frequency: 9600, spread: 0.11, decay: 0.013, partials: 2 },
      amp: { attack: 0.0008, hold: 0.03, decay: 0.06, sustain: 0.55, release: 0.12, curve: 2.1 },
    }),
    makeLayer({
      gain: 1.15, spread: 0.14, offset: 0.01,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 11800, resonance: 0.1 },
      resonator: { amount: 0.05, frequency: 15200, spread: 0.06, decay: 0.01, partials: 2 },
      amp: { attack: 0.0005, hold: 0.014, decay: 0.1, sustain: 0.24, release: 0.13, curve: 2.3 },
    }),
  ], { delayTime: 0.053, delayFeedback: 0.72, delayMix: 0.5, tone: 0.28, width: 0.16 },
     { gain: 0.4086, fadeOut: 0.02 }, 1, [
       { enabled: true, shape: 'square', rate: 19, depth: 1, phase: 0, target: 'layers[1].gain' },
       { enabled: true, shape: 'square', rate: 9.5, depth: 1, phase: 0.5, target: 'layers[2].gain' },
     ])
}

/**
 * A notification that expects an answer. Two strikes climbing — bodies at 6.8 and 11 kilohertz,
 * forty-five milliseconds apart — and then a third that is not a body at all but a hiss whose
 * highpass climbs an octave and a third as it decays, because nothing modal reaches above sixteen
 * kilohertz. The delay reprints all of it every thirty milliseconds at nearly full mix, so three
 * events arrive as eighteen; the offsets sit one and a half delay times apart, which is what keeps
 * a reprint from landing on the strike behind it.
 */
export function warnNotice(): AudioPatch {
  return patch(0.42, [
    makeLayer({
      gain: 0.9,
      spread: 0.3,
      offset: 0.005,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 7000, resonance: 0.12 },
      resonator: { amount: 0.92, frequency: 6800, spread: 0.16, decay: 0.05, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.003, sustain: 0, release: 0.0015, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.9,
      spread: 0.3,
      offset: 0.05,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 8000, resonance: 0.12 },
      resonator: { amount: 0.92, frequency: 11000, spread: 0.08, decay: 0.045, partials: 3 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.0028, sustain: 0, release: 0.0014, curve: 2.7 },
    }),
    makeLayer({
      gain: 2.3,
      spread: 0.3,
      offset: 0.095,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 11000, resonance: 0.12, envAmount: 1.3, envCurve: EASE_IN },
      resonator: { amount: 0.1, frequency: 12000, spread: 0.08, decay: 0.02, partials: 2 },
      amp: { attack: 0.0003, hold: 0.001, decay: 0.02, sustain: 0.3, release: 0.16, curve: 2.8 },
    }),
  ], {
    delayTime: 0.03, delayFeedback: 0.72, delayMix: 0.95,
    reverbMix: 0.05, reverbSize: 0.14, reverbDamping: 0.9,
    tone: 0.3, width: 0.45,
  }, { gain: 0.3615, fadeOut: 0.014 })
}

/**
 * The same register insisting rather than refusing. A strike opens it and a band of noise takes
 * over, chopped at sixteen hertz, its own passband opening two thirds of an octave across the half
 * second: the pulse train gets brighter as it runs, which is what makes it read as escalating
 * rather than as a repeat. The air above fifteen kilohertz is chopped at the same rate an eighth
 * of a cycle later, so each pulse ends in a hiss rather than stopping.
 */
export function warnCaution(): AudioPatch {
  return patch(0.5, [
    makeLayer({
      gain: 0.8,
      spread: 0.3,
      offset: 0.004,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 7500, resonance: 0.12 },
      resonator: { amount: 0.92, frequency: 9800, spread: 0.09, decay: 0.028, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0012, decay: 0.003, sustain: 0, release: 0.0015, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.7,
      spread: 0.35,
      offset: 0.024,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 6500, resonance: 0.3, envAmount: 0.7, envCurve: LINEAR },
      resonator: { amount: 0.6, frequency: 9200, spread: 0.2, decay: 0.02, partials: 3 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.12, sustain: 0.55, release: 0.2, curve: 2 },
    }),
    makeLayer({
      gain: 1.2,
      spread: 0.35,
      offset: 0.03,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 15000, resonance: 0.1 },
      resonator: { amount: 0.15, frequency: 14000, spread: 0.06, decay: 0.012, partials: 2 },
      amp: { attack: 0.004, hold: 0.01, decay: 0.14, sustain: 0.35, release: 0.16, curve: 2.2 },
    }),
  ], {
    delayTime: 0.031, delayFeedback: 0.3, delayMix: 0.3,
    reverbMix: 0.06, reverbSize: 0.16, reverbDamping: 0.88,
    tone: 0.3, width: 0.5,
  }, { gain: 0.4947, fadeOut: 0.014 }, [
    { enabled: true, shape: 'square', rate: 16, depth: 1, target: 'layers[1].gain' },
    { enabled: true, shape: 'square', rate: 16, depth: 1, phase: 0.88, target: 'layers[2].gain' },
  ])
}

/**
 * Two bodies alternating, 8.8 kilohertz and 13.4, chopped by two square modulators at nine hertz
 * half a cycle apart. That much is what an alarm is. What keeps it an effect rather than a loop
 * is that both layers fall to a third of their level across the event, so it dies away instead of
 * being cut off, and that the bed of noise highpassed at 13.5 kHz under them is not gated at all:
 * the alternation sits on something rather than in silence.
 */
export function warnCritical(): AudioPatch {
  return patch(0.46, [
    makeLayer({
      gain: 0.5,
      spread: 0.3,
      offset: 0.02,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 7200, resonance: 0.28 },
      resonator: { amount: 0.6, frequency: 8800, spread: 0.15, decay: 0.02, partials: 3 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.16, sustain: 0.35, release: 0.2, curve: 2 },
    }),
    makeLayer({
      gain: 0.55,
      spread: 0.3,
      offset: 0.02,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 12000, resonance: 0.28 },
      resonator: { amount: 0.45, frequency: 13400, spread: 0.07, decay: 0.018, partials: 3 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.16, sustain: 0.35, release: 0.2, curve: 2 },
    }),
    makeLayer({
      gain: 1.45,
      spread: 0.3,
      offset: 0.002,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 13500, resonance: 0.12 },
      resonator: { amount: 0.2, frequency: 11800, spread: 0.08, decay: 0.024, partials: 3 },
      amp: { attack: 0.0004, hold: 0.002, decay: 0.06, sustain: 0.55, release: 0.25, curve: 2.6 },
    }),
  ], {
    delayTime: 0.028, delayFeedback: 0.3, delayMix: 0.1,
    reverbMix: 0.05, reverbSize: 0.15, reverbDamping: 0.88,
    tone: 0.3, width: 0.5,
  }, { gain: 0.5291, fadeOut: 0.014 }, [
    { enabled: true, shape: 'square', rate: 9, depth: 1, phase: 0, target: 'layers[0].gain' },
    { enabled: true, shape: 'square', rate: 9, depth: 1, phase: 0.5, target: 'layers[1].gain' },
  ])
}

/* ------------------------------------------------------------------ Elements */

/**
 * Small pieces, thrown. Two square gates chop the 3.2 kHz body thirty-six times a second and the
 * air above it twenty-eight, which is what turns a continuous excitation into separate pieces.
 * They are periodic rather than random on purpose: a sampled-noise gate sets each grain to a
 * random level, and half of those levels are close enough to their neighbour that no edge is
 * heard, so the number of pieces moved with the seed. Under the chopping, one 1050 Hz body struck
 * once and left to ring for 140 ms is the only thing in the sound below two kilohertz. The three
 * layers land at nought, fifty and a hundred and five milliseconds, and a 24 ms delay reprints
 * all of it.
 */
export function fragmentSpray(): AudioPatch {
  return makePatch(0.75, [
    makeLayer({
      gain: 0.68,
      spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2400, resonance: 0.14 },
      resonator: { amount: 0.9, frequency: 3200, spread: 0.32, decay: 0.018, partials: 4 },
      amp: { attack: 0.0008, hold: 0.003, decay: 0.42, sustain: 0.04, release: 0.14, curve: 3.2 },
    }),
    makeLayer({
      gain: 0.75,
      spread: 0.7,
      offset: 0.05,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 2600, resonance: 0.18 },
      resonator: { amount: 0.95, frequency: 1050, spread: 0.5, decay: 0.14, partials: 3 },
      amp: { attack: 0.0006, hold: 0.002, decay: 0.006, sustain: 0, release: 0.003, curve: 2.8 },
    }),
    makeLayer({
      gain: 1.2,
      spread: 0.85,
      offset: 0.105,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 10500, resonance: 0.1 },
      shaper: { drive: 0.04, bitDepth: 11, crush: 0 },
      resonator: { amount: 0.12, frequency: 15500, spread: 0.06, decay: 0.01, partials: 2 },
      amp: { attack: 0.0008, hold: 0.003, decay: 0.55, sustain: 0.08, release: 0.18, curve: 3 },
    }),
  ], {
    delayTime: 0.024, delayFeedback: 0.44, delayMix: 0.44,
    reverbMix: 0.08, reverbSize: 0.18, reverbDamping: 0.82,
    tone: 0.2, width: 0.7,
  }, { gain: 0.2456, fadeOut: 0.02 }, 1, [
    { enabled: true, shape: 'square', rate: 36, depth: 1, target: 'layers[0].gain' },
    { enabled: true, shape: 'square', rate: 28, depth: 1, phase: 0.4, target: 'layers[2].gain' },
  ])
}

/**
 * The same debris, larger, and the size is written into the time constants first: the gates run at
 * nine and six hertz where Spray's run at thirty-six and twenty-eight, the body rings for ninety
 * milliseconds instead of eighteen, and the delay is 145 ms — long enough that each repeat arrives
 * as another piece landing rather than as texture. The body is lower and far more inharmonic than
 * Spray's as well: one resonator at 1040 Hz opened to a spread of 0.8 places its four partials at
 * 1.0, 2.5, 4.7 and 7.6 kHz, so this one layer carries the object from its weight to its ring.
 */
export function fragmentTumble(): AudioPatch {
  return makePatch(1.9, [
    makeLayer({
      gain: 0.18,
      spread: 0.45,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 660, resonance: 0.14 },
      resonator: { amount: 0.9, frequency: 1040, spread: 0.8, decay: 0.09, partials: 4 },
      amp: { attack: 0.003, hold: 0.02, decay: 0.75, sustain: 0.06, release: 0.8, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.359,
      spread: 0.6,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 5600, resonance: 0.12 },
      resonator: { amount: 1, frequency: 8800, spread: 0.2, decay: 0.045, partials: 3 },
      amp: { attack: 0.003, hold: 0.02, decay: 0.7, sustain: 0.05, release: 0.7, curve: 2.8 },
    }),
    makeLayer({
      gain: 1.2,
      spread: 0.8,
      offset: 0.018,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 10500, resonance: 0.1 },
      resonator: { amount: 0.12, frequency: 15000, spread: 0.07, decay: 0.012, partials: 2 },
      amp: { attack: 0.0008, hold: 0.004, decay: 0.5, sustain: 0.03, release: 0.6, curve: 3 },
    }),
  ], {
    delayTime: 0.145, delayFeedback: 0.62, delayMix: 0.52,
    reverbMix: 0.14, reverbSize: 0.42, reverbDamping: 0.72,
    tone: 0.15, width: 0.8,
  }, { gain: 0.8605, fadeOut: 0.03 }, 1, [
    { enabled: true, shape: 'noise', rate: 9, depth: 1, target: 'layers[0].gain' },
    { enabled: true, shape: 'noise', rate: 6, depth: 1, target: 'layers[1].gain' },
  ])
}

/**
 * Scatter coming to rest, which needs something to come to rest on. The middle layer is an 820 Hz
 * body struck once and left to ring for a fifth of a second — the surface the rest of it lands on
 * — and a 72 ms delay at high feedback strikes it five or six more times, each one quieter. Over
 * it two sampled-noise modulators re-level the mid band twenty-six times a second and the air
 * thirty-four, each grain taking a random level rather than falling on a heard beat. The mid is
 * given the shorter envelope of the two: the heavy pieces stop before the dust does.
 */
export function fragmentSettle(): AudioPatch {
  return makePatch(1.5, [
    makeLayer({
      gain: 0.509,
      spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 2000, resonance: 0.14 },
      resonator: { amount: 0.9, frequency: 2600, spread: 0.4, decay: 0.05, partials: 4 },
      amp: { attack: 0.0015, hold: 0.008, decay: 0.42, sustain: 0.02, release: 0.4, curve: 3.6 },
    }),
    makeLayer({
      gain: 0.427,
      spread: 0.55,
      offset: 0.008,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 2200, resonance: 0.18 },
      resonator: { amount: 0.95, frequency: 820, spread: 0.38, decay: 0.22, partials: 3 },
      amp: { attack: 0.0006, hold: 0.002, decay: 0.006, sustain: 0, release: 0.003, curve: 2.8 },
    }),
    makeLayer({
      gain: 1.2,
      spread: 0.75,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 10000, resonance: 0.1 },
      resonator: { amount: 0.12, frequency: 14200, spread: 0.06, decay: 0.01, partials: 2 },
      amp: { attack: 0.001, hold: 0.004, decay: 0.95, sustain: 0.06, release: 0.5, curve: 2.6 },
    }),
  ], {
    delayTime: 0.072, delayFeedback: 0.74, delayMix: 0.5,
    reverbMix: 0.12, reverbSize: 0.32, reverbDamping: 0.76,
    tone: 0.25, width: 0.6,
  }, { gain: 0.4367, fadeOut: 0.03 }, 1, [
    { enabled: true, shape: 'noise', rate: 26, depth: 1, target: 'layers[0].gain' },
    { enabled: true, shape: 'noise', rate: 34, depth: 1, target: 'layers[2].gain' },
  ])
}

/**
 * A burst of data, and it runs at two rates. Eighteen hertz cuts the layer carrying the body into
 * packets; thirty-seven chops the broadband layer over it into the bits inside them. Both are
 * white noise, so nothing in this has a pitch at all. The body at 3.2 kHz is opened to 0.34, which
 * lands its four partials at 3.2, 5.1, 8.0 and 11.8 kHz — one layer covering three octaves.
 * Under both of them, and the only thing here that is never gated, a band of pink noise at seven
 * hundred hertz: the packets are what moves, and the line they move down does not stop between
 * them. The event peaks inside its first thirty milliseconds and is nine decibels down a hundred
 * and fifty later, because a burst that fades evenly is a stream.
 */
export function packetStream(): AudioPatch {
  return makePatch(0.8, [
    makeLayer({
      gain: 1,
      spread: 0.55,
      offset: 0.008,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 4800, resonance: 0.2, envAmount: 1.2, envCurve: EASE_OUT },
      shaper: { drive: 0, bitDepth: 5, crush: 0.02 },
      resonator: { amount: 0.06, frequency: 3200, spread: 0.34, decay: 0.03, partials: 4 },
      amp: { attack: 0.0006, hold: 0.008, decay: 0.22, sustain: 0.22, release: 0.2, curve: 2.8 },
    }),
    makeLayer({
      gain: 1.3,
      spread: 0.85,
      offset: 0.02,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 620, resonance: 0.1 },
      shaper: { drive: 0, bitDepth: 6, crush: 0 },
      amp: { attack: 0.0006, hold: 0.006, decay: 0.2, sustain: 0.2, release: 0.2, curve: 3 },
    }),
    makeLayer({
      gain: 1.5,
      spread: 0.3,
      source: { kind: 'noise', colour: 'pink' },
      filter: { kind: 'bandpass', cutoff: 700, resonance: 0.45 },
      amp: { attack: 0.001, hold: 0.012, decay: 0.18, sustain: 0.15, release: 0.25, curve: 2.6 },
    }),
  ], {
    delayTime: 0.031, delayFeedback: 0.34, delayMix: 0.5,
    reverbMix: 0.08, reverbSize: 0.2, reverbDamping: 0.8,
    tone: 0.1, width: 0.7,
  }, { gain: 0.4806, fadeOut: 0.02 }, 1, [
    { enabled: true, shape: 'square', rate: 18, depth: 1, target: 'layers[0].gain' },
    { enabled: true, shape: 'square', rate: 37, depth: 0.9, phase: 0.35, target: 'layers[1].gain' },
  ])
}

/**
 * A beam walked across the spectrum: one band of white noise leaving seven hundred hertz and
 * arriving near seventeen kilohertz, gated at nineteen hertz the whole way, so what crosses is a
 * raster and not a sweep. Four bits of quantisation is what makes the band machine-made. The layer
 * above eight kilohertz is chopped at twenty-two, started half a cycle behind, so the pair drifts
 * rather than settling into one wider gate. The centroid climbs from 2.6 to 12.6 kHz on the way.
 */
export function rasterScan(): AudioPatch {
  return makePatch(1.3, [
    makeLayer({
      gain: 1,
      spread: 0.6,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 700, resonance: 0.4, envAmount: 4.6, envCurve: LINEAR },
      shaper: { drive: 0, bitDepth: 4, crush: 0 },
      amp: { attack: 0.004, hold: 0.03, decay: 0.75, sustain: 0.5, release: 0.45, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.45,
      spread: 0.9,
      offset: 0.05,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 8000, resonance: 0.1 },
      amp: { attack: 0.06, hold: 0.05, decay: 0.6, sustain: 0.45, release: 0.5, curve: 1.8 },
    }),
    makeLayer({
      gain: 1.2,
      spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 560, resonance: 0.3 },
      amp: { attack: 0.03, hold: 0.08, decay: 0.5, sustain: 0.3, release: 0.5, curve: 1.8 },
    }),
  ], {
    delayTime: 0.047, delayFeedback: 0.3, delayMix: 0.4,
    reverbMix: 0.14, reverbSize: 0.35, reverbDamping: 0.7,
    tone: 0.2, width: 0.75,
  }, { gain: 1.108, fadeOut: 0.03 }, 1, [
    { enabled: true, shape: 'square', rate: 19, depth: 1, target: 'layers[0].gain' },
    { enabled: true, shape: 'square', rate: 22, depth: 0.9, phase: 0.5, target: 'layers[1].gain' },
  ])
}

/**
 * A transmission arriving: every layer fades up rather than striking, the chatter over a hundred
 * and sixty milliseconds and the carrier over three hundred and fifty. The carrier is the only
 * pitch in this group — a three-bit square thrown between 1.7 and 2.8 kHz at eleven hertz, which
 * is two tones alternating and not a note, sinking a minor third as it settles. It is also the
 * narrow one, correlated at 0.78 where the other two are under 0.35, because a signal arrives down
 * a channel rather than across the room.
 */
export function handshake(): AudioPatch {
  return makePatch(1.2, [
    makeLayer({
      gain: 0.22,
      spread: 0.25,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.5 },
      pitch: { start: 2200, slide: -3, slideCurve: EASE_OUT, jitter: 25 },
      filter: { kind: 'highpass', cutoff: 900, resonance: 0.25 },
      shaper: { drive: 0, bitDepth: 3, crush: 0.02 },
      amp: { attack: 0.35, hold: 0.12, decay: 0.3, sustain: 0.55, release: 0.35, curve: 1.3 },
    }),
    makeLayer({
      gain: 1.1,
      spread: 0.5,
      offset: 0.015,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 640, resonance: 0.1 },
      amp: { attack: 0.16, hold: 0.06, decay: 0.35, sustain: 0.3, release: 0.4, curve: 1.5 },
    }),
    makeLayer({
      gain: 1.5,
      spread: 0.25,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 7000, resonance: 0.2 },
      amp: { attack: 0.12, hold: 0.05, decay: 0.35, sustain: 0.25, release: 0.45, curve: 1.5 },
    }),
  ], {
    delayTime: 0.068, delayFeedback: 0.42, delayMix: 0.45,
    reverbMix: 0.16, reverbSize: 0.4, reverbDamping: 0.72,
    tone: 0.15, width: 0.5,
  }, { gain: 0.4693, fadeOut: 0.025 }, 1, [
    { enabled: true, shape: 'square', rate: 11, depth: 0.35, target: 'layers[0].pitch' },
    { enabled: true, shape: 'square', rate: 29, depth: 0.95, phase: 0.2, target: 'layers[1].gain' },
  ])
}

/**
 * A held room where the air outlasts the floor. The two lower layers take about a fifth of a
 * second to arrive, which is what a sustained sound is allowed to do; the air above them does not
 * — its first five milliseconds sit three times above the level it settles to, and that edge is
 * the whole of what tells the ear where the sound began.
 */
export function ambientDrift(): AudioPatch {
  return patch(1.2, [
    makeLayer({
      gain: 0.618,
      spread: 0.8,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 1900, resonance: 0.25 },
      amp: { attack: 0.35, hold: 0.2, decay: 0.5, sustain: 0.38, release: 0.8, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.326,
      spread: 0.7,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 6000, resonance: 0.1 },
      resonator: { amount: 0.4, frequency: 3200, spread: 0.34, decay: 0.02, partials: 4 },
      amp: { attack: 0.25, hold: 0.15, decay: 0.5, sustain: 0.38, release: 0.5, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.996,
      spread: 0.9,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 17000, resonance: 0.05 },
      resonator: { amount: 0.12, frequency: 15000, spread: 0.06, decay: 0.03, partials: 2 },
      amp: { attack: 0.0006, hold: 0.005, decay: 0.07, sustain: 0.3, release: 0.25, curve: 1.6 },
    }),
  ], { delayTime: 0.23, delayFeedback: 0.4, delayMix: 0.22, reverbMix: 0.4, reverbSize: 0.95, reverbDamping: 0.3, tone: 0.05, width: 0.75 },
     { gain: 2.07, fadeOut: 0.03 }, [
       { enabled: true, shape: 'noise', rate: 13, depth: 0.9, target: 'layers[1].gain' },
       { enabled: true, shape: 'square', rate: 11, depth: 0.55, target: 'layers[2].gain' },
     ])
}

/**
 * Something energised and holding. The bottom is a seventy-four hertz saw with its fundamental
 * filtered away, so what is left of it is the repetition rate rather than a note; over that a
 * resonant band at 4.4 kHz breathes at six and a half hertz and the air is chopped at twenty-four.
 *
 * It sits nearer the middle than the other two elements, which are thrown wide. Width is not what
 * makes this kind of sound read as made rather than found, and a field you are standing inside
 * has no sides.
 */
export function containmentField(): AudioPatch {
  return patch(1.4, [
    makeLayer({
      gain: 0.771,
      spread: 0.3,
      source: { kind: 'tone', wave: 'saw', voices: 3, detune: 14 },
      pitch: { start: 74, jitter: 6 },
      filter: { kind: 'bandpass', cutoff: 1500, resonance: 0.3 },
      amp: { attack: 0.012, hold: 0.35, decay: 0.4, sustain: 0.72, release: 0.3, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.544,
      spread: 0.25,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2200, jitter: 12 },
      filter: { kind: 'bandpass', cutoff: 4400, resonance: 0.6 },
      amp: { attack: 0.001, hold: 0.012, decay: 0.16, sustain: 0.4, release: 0.3, curve: 2.2 },
    }),
    makeLayer({
      gain: 0.659,
      spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 14000, resonance: 0.05 },
      resonator: { amount: 0.07, frequency: 15500, spread: 0.08, decay: 0.02, partials: 2 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.2, sustain: 0.55, release: 0.3, curve: 2 },
    }),
  ], { delayTime: 0.045, delayFeedback: 0.35, delayMix: 0.3, reverbMix: 0.18, reverbSize: 0.5, reverbDamping: 0.6, tone: 0.15, width: 0.35 },
     { gain: 1.244, limiter: 0.4, fadeOut: 0.025 }, [
       { enabled: true, shape: 'triangle', rate: 6.5, depth: 0.65, target: 'layers[1].gain' },
       { enabled: true, shape: 'square', rate: 24, depth: 0.85, target: 'layers[2].gain' },
     ])
}

/**
 * Something on its way, and then here. Nothing in it arrives at once: the bed lands in four
 * milliseconds and then holds, a metallic band comes up over that across half a second, and the
 * air does not start at all until six hundred. The loudest moment of the whole event is that last
 * entry, which is what makes it a landing rather than a fade-up to a level.
 */
export function pressureSwell(): AudioPatch {
  return patch(1.6, [
    makeLayer({
      gain: 0.72,
      spread: 0.7,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 1500, resonance: 0.3 },
      amp: { attack: 0.004, hold: 0.02, decay: 0.3, sustain: 0.5, release: 0.6, curve: 1.6 },
    }),
    makeLayer({
      gain: 0.508,
      spread: 0.8,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2500, jitter: 15 },
      filter: { kind: 'bandpass', cutoff: 3600, resonance: 0.1 },
      amp: { attack: 0.5, hold: 0.15, decay: 0.4, sustain: 0.5, release: 0.4, curve: 1.4 },
    }),
    makeLayer({
      gain: 1.5,
      spread: 0.9,
      offset: 0.6,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 14000, resonance: 0.05 },
      resonator: { amount: 0.08, frequency: 15500, spread: 0.06, decay: 0.02, partials: 2 },
      amp: { attack: 0.0008, hold: 0.004, decay: 0.12, sustain: 0.35, release: 0.4, curve: 2 },
    }),
  ], { delayTime: 0.16, delayFeedback: 0.42, delayMix: 0.3, reverbMix: 0.35, reverbSize: 0.9, reverbDamping: 0.35, tone: 0.1, width: 0.85 },
     { gain: 2.954, limiter: 0.35, fadeOut: 0.03 }, [
       { enabled: true, shape: 'triangle', rate: 4.5, depth: 0.35, target: 'layers[1].gain' },
       { enabled: true, shape: 'sine', rate: 3, depth: 0.4, target: 'layers[2].gain' },
     ])
}

/* ------------------------------------------------------------------ Weapons */

/**
 * The circuit being made. A bar at a hundred and fifteen hertz is struck at zero and opened out
 * all the way, so its six partials run from there to 2.1 kHz — the only bottom end in the family,
 * and the reason this reads as a contact rather than as a short version of the full charge. The
 * grains over it are gated at thirty-four hertz, the fastest of the three; the tick lands at three
 * hundred and fifty milliseconds of four hundred and sixty, and the hundred and ten after it are
 * the bed letting go.
 */
export function chargePrime(): AudioPatch {
  return makePatch(0.46, [
    makeLayer({
      gain: 0.32,
      spread: 0.6,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1900, resonance: 0.14, envAmount: 1.4, envCurve: EASE_IN },
      resonator: { amount: 0.5, frequency: 2200, spread: 0.48, decay: 0.014, partials: 5 },
      amp: { attack: 0.24, hold: 0.03, decay: 0.04, sustain: 1, release: 0.07, curve: 0.6 },
    }),
    makeLayer({
      gain: 0.8,
      spread: 0.3,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 4000, resonance: 0.2 },
      resonator: { amount: 0.95, frequency: 115, spread: 1, decay: 0.11, partials: 6 },
      amp: { attack: 0.0004, hold: 0.002, decay: 0.02, sustain: 0, release: 0.012, curve: 2.4 },
    }),
    makeLayer({
      gain: 1.05,
      spread: 0.7,
      offset: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 6000, resonance: 0.12 },
      resonator: { amount: 0.32, frequency: 13000, spread: 0.2, decay: 0.012, partials: 2 },
      amp: { attack: 0.0003, hold: 0.004, decay: 0.02, sustain: 0, release: 0.02, curve: 2.8 },
    }),
  ], {
    delayTime: 0.021, delayFeedback: 0.24, delayMix: 0.4,
    reverbMix: 0.07, reverbSize: 0.2, reverbDamping: 0.8,
    tone: 0.4, width: 0.55,
  }, { gain: 0.2639, fadeOut: 0.02 }, 1, [
    { enabled: true, shape: 'square', rate: 34, depth: 1, target: 'layers[0].gain' },
  ])
}

/**
 * The full charge. Grains rise for eight hundred and sixty milliseconds, then a strike on an
 * 11 kHz body lands on top of them. The highpass the grains are struck through climbs from eleven
 * hundred hertz to nearly seven kilohertz as they go, so the sound brightens as it fills rather
 * than darkening into a tail. Under all of it is a pair of detuned squares from 560 Hz sliding up
 * two octaves: the octave below the grain bed's own highpass, and the only thing in the patch that
 * occupies it.
 */
export function chargeCycle(): AudioPatch {
  return makePatch(1.15, [
    makeLayer({
      gain: 0.35,
      spread: 0.6,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1100, resonance: 0.14, envAmount: 2.6, envCurve: EASE_IN },
      resonator: { amount: 0.55, frequency: 1600, spread: 0.62, decay: 0.018, partials: 5 },
      amp: { attack: 0.8, hold: 0.06, decay: 0.05, sustain: 1, release: 0.12, curve: 0.55 },
    }),
    makeLayer({
      gain: 0.4,
      spread: 0.5,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.22, voices: 2, detune: 14 },
      pitch: { start: 560, slide: 24, slideCurve: EASE_IN, jitter: 8 },
      filter: { kind: 'bandpass', cutoff: 1250, resonance: 0.35, envAmount: 1.8, envCurve: EASE_IN },
      amp: { attack: 0.85, hold: 0.06, decay: 0.06, sustain: 1, release: 0.15, curve: 0.6 },
    }),
    makeLayer({
      gain: 0.9,
      spread: 0.75,
      offset: 0.86,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 5000, resonance: 0.12 },
      resonator: { amount: 0.3, frequency: 11000, spread: 0.3, decay: 0.02, partials: 3 },
      amp: { attack: 0.0004, hold: 0.006, decay: 0.05, sustain: 0.15, release: 0.12, curve: 2.6 },
    }),
  ], {
    delayTime: 0.028, delayFeedback: 0.3, delayMix: 0.45,
    reverbMix: 0.1, reverbSize: 0.35, reverbDamping: 0.7,
    tone: 0.35, width: 0.65,
  }, { gain: 0.4735, fadeOut: 0.02 }, 1, [
    { enabled: true, shape: 'square', rate: 23, depth: 1, target: 'layers[0].gain' },
    { enabled: true, shape: 'triangle', rate: 23, depth: 0.2, phase: 0.25, target: 'layers[1].cutoff' },
  ])
}

/**
 * The same charge held past the point it should have stopped. The gate is a saw rather than a
 * square, so every grain swells instead of switching; the excitation is quantised to five bits;
 * and the note under it starts at two hundred and ten hertz, is phase-modulated at 3.71, and is
 * shaken by a sampled-noise modulator, which is what keeps it from settling on a pitch. The
 * arrival comes at one second of one and eight, and two thirds of the energy falls after it.
 */
export function chargeOverload(): AudioPatch {
  return makePatch(1.8, [
    makeLayer({
      gain: 0.3,
      spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 620, resonance: 0.16, envAmount: 2.1, envCurve: EASE_IN },
      shaper: { drive: 0.15, bitDepth: 5, crush: 0 },
      resonator: { amount: 0.55, frequency: 1150, spread: 0.78, decay: 0.022, partials: 5 },
      amp: { attack: 0.95, hold: 0.05, decay: 0.35, sustain: 0.45, release: 0.4, curve: 0.5 },
    }),
    makeLayer({
      gain: 0.9,
      spread: 0.55,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 20, fmRatio: 3.71, fmIndex: 6.5, fmFall: 0.15 },
      pitch: { start: 210, slide: 33, slideCurve: EASE_IN, jitter: 10 },
      filter: { kind: 'lowpass', cutoff: 2400, resonance: 0.3, envAmount: 1.8, envCurve: EASE_IN },
      amp: { attack: 1, hold: 0.04, decay: 0.3, sustain: 0.4, release: 0.42, curve: 0.55 },
    }),
    makeLayer({
      gain: 0.5,
      spread: 0.8,
      offset: 1,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 5200, resonance: 0.14 },
      shaper: { drive: 0.25, bitDepth: 8, crush: 0 },
      resonator: { amount: 0.35, frequency: 9800, spread: 0.4, decay: 0.025, partials: 3 },
      amp: { attack: 0.001, hold: 0.02, decay: 0.25, sustain: 0.3, release: 0.45, curve: 2.2 },
    }),
  ], {
    delayTime: 0.034, delayFeedback: 0.36, delayMix: 0.5,
    reverbMix: 0.14, reverbSize: 0.45, reverbDamping: 0.6,
    tone: 0.3, width: 0.75,
  }, { gain: 0.287, fadeOut: 0.02 }, 1, [
    { enabled: true, shape: 'saw', rate: 19, depth: 1, target: 'layers[0].gain' },
    { enabled: true, shape: 'noise', rate: 14, depth: 0.12, target: 'layers[1].pitch' },
  ])
}

/**
 * The small one. A strike on a body at 1.6 kHz, then broadband noise under a lowpass that opens
 * four tenths of an octave as it runs.
 *
 * The level flutters at thirty-four hertz, and the modulator is a triangle rather than a square:
 * a square gate chops, and a discharge this size sputters. The band above twelve kilohertz carries
 * no resonator, because a modal body damps its own high partials and cannot supply air.
 */
export function plasmaBolt(): AudioPatch {
  return patch(0.6, [
    makeLayer({
      gain: 0.7,
      spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 15000, resonance: 0.15, envAmount: 0.4, envCurve: LINEAR },
      amp: { attack: 0.003, hold: 0.012, decay: 0.2, sustain: 0.12, release: 0.16, curve: 2 },
    }),
    makeLayer({
      gain: 1.05,
      spread: 0.55,
      offset: 0.002,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 12000, resonance: 0.12 },
      amp: { attack: 0.001, hold: 0.006, decay: 0.12, sustain: 0.08, release: 0.12, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.5,
      spread: 0.3,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 1600, resonance: 0.35 },
      resonator: { amount: 0.5, frequency: 1600, spread: 0.12, decay: 0.08, partials: 3 },
      amp: { attack: 0.0005, hold: 0.004, decay: 0.008, sustain: 0, release: 0.004, curve: 2.6 },
    }),
  ], {
    delayTime: 0.038, delayFeedback: 0.32, delayMix: 0.42,
    reverbMix: 0.2, reverbSize: 0.5, reverbDamping: 0.2,
    tone: 0.1, width: 0.6,
  }, { gain: 1.167, fadeOut: 0.03 }, [
    { enabled: true, shape: 'triangle', rate: 34, depth: 0.8, target: 'layers[0].gain' },
    { enabled: true, shape: 'noise', rate: 40, depth: 0.7, target: 'layers[1].gain' },
  ])
}

/**
 * The middle one, and the only shot here whose top arrives after the shot has. The band above
 * twelve kilohertz starts thirty milliseconds late and fades up over seventy rather than striking,
 * so the sound opens once it has already landed. That lateness is what makes it envelop.
 *
 * Its room is barely damped, which is deliberate: a damped tail turns the discharge back into a
 * thud, and the point of these is that what is left over stays as bright as the front.
 */
export function plasmaLance(): AudioPatch {
  return patch(0.9, [
    makeLayer({
      gain: 0.75,
      spread: 0.42,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 13500, resonance: 0.16, envAmount: 0.5, envCurve: LINEAR },
      amp: { attack: 0.004, hold: 0.02, decay: 0.38, sustain: 0.14, release: 0.3, curve: 2 },
    }),
    makeLayer({
      gain: 0.45,
      spread: 0.58,
      offset: 0.03,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 12000, resonance: 0.12 },
      amp: { attack: 0.07, hold: 0.01, decay: 0.3, sustain: 0.05, release: 0.3, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.36,
      spread: 0.3,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 1200, resonance: 0.38 },
      resonator: { amount: 0.55, frequency: 1200, spread: 0.12, decay: 0.12, partials: 3 },
      amp: { attack: 0.0006, hold: 0.005, decay: 0.01, sustain: 0, release: 0.005, curve: 2.6 },
    }),
  ], {
    delayTime: 0.052, delayFeedback: 0.42, delayMix: 0.5,
    reverbMix: 0.3, reverbSize: 0.7, reverbDamping: 0.12,
    tone: 0.08, width: 0.65,
  }, { gain: 1.194, fadeOut: 0.04 }, [
    { enabled: true, shape: 'sine', rate: 22, depth: 0.8, target: 'layers[0].gain' },
    { enabled: true, shape: 'noise', rate: 34, depth: 0.7, target: 'layers[1].gain' },
  ])
}

/**
 * The large one. Its body sits at 850 hertz against the small shot's 1600, and what follows the
 * strike is a second and a half of wash chopped at nine hertz.
 *
 * Nine is slow enough to count, which is the difference between a big weapon and a loud one: the
 * small shot flutters too fast to resolve, this one pulses. The chopper is a square rather than the
 * sampled noise it started as — a sample and hold holds one random level for a whole cycle, and at
 * this rate that put the front of the shot wherever the seed happened to leave it.
 */
export function plasmaCannon(): AudioPatch {
  return patch(1.6, [
    makeLayer({
      gain: 0.8,
      spread: 0.45,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 12500, resonance: 0.18, envAmount: 0.6, envCurve: LINEAR },
      amp: { attack: 0.012, hold: 0.03, decay: 0.7, sustain: 0.16, release: 0.55, curve: 2 },
    }),
    makeLayer({
      gain: 1.15,
      spread: 0.6,
      offset: 0.004,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 11500, resonance: 0.12 },
      amp: { attack: 0.0015, hold: 0.01, decay: 0.4, sustain: 0.1, release: 0.45, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.5,
      spread: 0.3,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 850, resonance: 0.4 },
      resonator: { amount: 0.6, frequency: 850, spread: 0.12, decay: 0.07, partials: 3 },
      amp: { attack: 0.0008, hold: 0.006, decay: 0.012, sustain: 0, release: 0.006, curve: 2.6 },
    }),
  ], {
    delayTime: 0.07, delayFeedback: 0.5, delayMix: 0.55,
    reverbMix: 0.28, reverbSize: 0.68, reverbDamping: 0.34,
    tone: 0.05, width: 0.7,
  }, { gain: 0.8376, fadeOut: 0.06 }, [
    { enabled: true, shape: 'square', rate: 9, depth: 0.8, target: 'layers[0].gain' },
    { enabled: true, shape: 'noise', rate: 26, depth: 0.7, target: 'layers[1].gain' },
  ])
}

/**
 * A shot, which is one event with weight under it.
 *
 * The first version of this family was scored against the only weapon reference to hand, and that
 * file is a mechanism — a thing that rattles, fifty-six onsets and nothing below a kilohertz. Every
 * shot here inherited its shape and came out a bright crécelle: nine onsets, no low end at all.
 * A shot is a crack, a body that drops away under it, and a tail. Three onsets, not nine.
 */
export function pulseRifle(): AudioPatch {
  return makePatch(0.34, [
    makeLayer({ gain: 0.9, spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1400, resonance: 0.12 },
      resonator: { amount: 0.75, frequency: 1700, spread: 0.52, decay: 0.02, partials: 5 },
      amp: { attack: 0.0002, hold: 0.0015, decay: 0.005, sustain: 0, release: 0.003, curve: 3 } }),
    makeLayer({ gain: 0.62, spread: 0.3, offset: 0.001,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 9, fmRatio: 1.51, fmIndex: 4.2, fmFall: 0.85 },
      pitch: { start: 440, slide: -26, slideCurve: EASE_OUT, jitter: 14 },
      filter: { kind: 'lowpass', cutoff: 4200, resonance: 0.3, envAmount: -1.6, envCurve: EASE_OUT },
      amp: { attack: 0.0004, hold: 0.006, decay: 0.075, sustain: 0, release: 0.05, curve: 2.4 } }),
    makeLayer({ gain: 0.8, spread: 0.7, offset: 0.002,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 7600, jitter: 22 },
      filter: { kind: 'highpass', cutoff: 4200, resonance: 0.12 },
      resonator: { amount: 0.5, frequency: 6200, spread: 0.4, decay: 0.02, partials: 3 },
      amp: { attack: 0.0002, hold: 0.0015, decay: 0.02, sustain: 0, release: 0.014, curve: 3 } }),
  ], { reverbMix: 0.1, reverbSize: 0.3, reverbDamping: 0.45, tone: 0.18, width: 0.55 }, { gain: 0.3991, fadeOut: 0.02 }, 1, [])
}

/** The same shot with the weight of something larger: the body an octave down and four times as
 * long, driven hard enough to thicken, and a room big enough to answer it. */
export function pulseCannon(): AudioPatch {
  return makePatch(0.75, [
    makeLayer({ gain: 0.95, spread: 0.4,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 900, resonance: 0.14 },
      resonator: { amount: 0.7, frequency: 1100, spread: 0.55, decay: 0.05, partials: 5 },
      shaper: { drive: 0.18, bitDepth: 16, crush: 0 },
      amp: { attack: 0.0003, hold: 0.004, decay: 0.02, sustain: 0, release: 0.012, curve: 2.8 } }),
    makeLayer({ gain: 0.8, spread: 0.25, offset: 0.002,
      source: { kind: 'tone', wave: 'sine', voices: 3, detune: 14, fmRatio: 1.24, fmIndex: 5.5, fmFall: 0.8 },
      pitch: { start: 210, slide: -20, slideCurve: EASE_OUT, jitter: 10 },
      filter: { kind: 'lowpass', cutoff: 2600, resonance: 0.32, envAmount: -1.8, envCurve: EASE_OUT },
      shaper: { drive: 0.22, bitDepth: 16, crush: 0 },
      amp: { attack: 0.0006, hold: 0.02, decay: 0.22, sustain: 0, release: 0.16, curve: 2.2 } }),
    makeLayer({ gain: 0.85, spread: 0.8, offset: 0.003,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 6400, jitter: 24 },
      filter: { kind: 'highpass', cutoff: 3400, resonance: 0.12 },
      resonator: { amount: 0.45, frequency: 5200, spread: 0.45, decay: 0.035, partials: 3 },
      amp: { attack: 0.0002, hold: 0.003, decay: 0.05, sustain: 0, release: 0.035, curve: 2.9 } }),
  ], { reverbMix: 0.2, reverbSize: 0.55, reverbDamping: 0.5, tone: 0.08, width: 0.6 },
     { gain: 0.1261, fadeOut: 0.02, limiter: 0.75 }, 1, [])
}

/** Three of the shot, spaced by a delay rather than played, so the rate is a property of the
 * weapon and not of the patch. The feedback is what decides how many arrive. */
export function pulseRepeater(): AudioPatch {
  return makePatch(0.62, [
    makeLayer({ gain: 0.85, spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1500, resonance: 0.12 },
      resonator: { amount: 1, frequency: 1900, spread: 0.5, decay: 0.016, partials: 4 },
      amp: { attack: 0.0002, hold: 0.001, decay: 0.004, sustain: 0, release: 0.0025, curve: 3.1 } }),
    makeLayer({ gain: 0.55, spread: 0.3, offset: 0.001,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 8, fmRatio: 1.49, fmIndex: 3.6, fmFall: 0.88 },
      pitch: { start: 500, slide: -22, slideCurve: EASE_OUT, jitter: 16 },
      filter: { kind: 'lowpass', cutoff: 4600, resonance: 0.28, envAmount: -1.4, envCurve: EASE_OUT },
      amp: { attack: 0.0004, hold: 0.004, decay: 0.045, sustain: 0, release: 0.03, curve: 2.5 } }),
    makeLayer({ gain: 0.24, spread: 0.7, offset: 0.002,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 8200, jitter: 25 },
      filter: { kind: 'highpass', cutoff: 5400, resonance: 0.12 },
      amp: { attack: 0.0002, hold: 0.0008, decay: 0.009, sustain: 0, release: 0.006, curve: 3.2 } }),
  ], { delayTime: 0.105, delayFeedback: 0.5, delayMix: 0.62, reverbMix: 0.1, reverbSize: 0.32,
       reverbDamping: 0.6, tone: 0.05, width: 0.55 }, { gain: 0.9848, fadeOut: 0.02 }, 1, [])
}

/**
 * A reload is not one sound. It is a release, a travel, and a seat — three mechanical events in
 * sequence, each one metal with a fundamental you could name, and the last of them landing with
 * weight. The middle one is a slide rather than a hit, which is why it registers as no onset at
 * all and still has to be there.
 */
export function reloadClip(): AudioPatch {
  return makePatch(0.52, [
    makeLayer({ gain: 1.0, spread: 0.4, offset: 0.006,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1200, resonance: 0.14 },
      resonator: { amount: 1, frequency: 1450, spread: 0.46, decay: 0.035, partials: 4 },
      amp: { attack: 0.0003, hold: 0.002, decay: 0.006, sustain: 0, release: 0.004, curve: 2.8 } }),
    makeLayer({ gain: 0.85, spread: 0.55, offset: 0.115,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2600, jitter: 26 },
      filter: { kind: 'bandpass', cutoff: 2400, resonance: 0.32, envAmount: 0.6, envCurve: EASE_IN },
      resonator: { amount: 0.55, frequency: 2900, spread: 0.5, decay: 0.03, partials: 4 },
      amp: { attack: 0.0004, hold: 0.006, decay: 0.03, sustain: 0, release: 0.02, curve: 2.6 } }),
    makeLayer({ gain: 0.7, spread: 0.35, offset: 0.255,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 700, resonance: 0.16 },
      resonator: { amount: 1, frequency: 820, spread: 0.6, decay: 0.06, partials: 5 },
      shaper: { drive: 0.14, bitDepth: 16, crush: 0 },
      amp: { attack: 0.0003, hold: 0.004, decay: 0.014, sustain: 0, release: 0.01, curve: 2.7 } }),
  ], { reverbMix: 0.16, reverbSize: 0.36, reverbDamping: 0.55, tone: 0.05, width: 0.6 }, { gain: 0.1612, fadeOut: 0.02 }, 1, [])
}

/** The same three events on a longer mechanism: the travel is a sustained band sweeping down
 * between the release and the seat, and the seat is lower and later. */
export function reloadCycle(): AudioPatch {
  return makePatch(0.72, [
    makeLayer({ gain: 1.0, spread: 0.45, offset: 0.008,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 3100, jitter: 24 },
      filter: { kind: 'bandpass', cutoff: 2800, resonance: 0.3 },
      resonator: { amount: 0.7, frequency: 1900, spread: 0.5, decay: 0.03, partials: 4 },
      amp: { attack: 0.0003, hold: 0.002, decay: 0.008, sustain: 0, release: 0.005, curve: 2.8 } }),
    makeLayer({ gain: 0.7, spread: 0.7, offset: 0.09,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 3600, resonance: 0.4, envAmount: -1.2, envCurve: EASE_OUT },
      resonator: { amount: 0.4, frequency: 4200, spread: 0.55, decay: 0.025, partials: 3 },
      amp: { attack: 0.002, hold: 0.05, decay: 0.13, sustain: 0.3, release: 0.08, curve: 2 } }),
    makeLayer({ gain: 0.7, spread: 0.3, offset: 0.42,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 600, resonance: 0.16 },
      resonator: { amount: 1, frequency: 700, spread: 0.62, decay: 0.075, partials: 5 },
      shaper: { drive: 0.18, bitDepth: 16, crush: 0 },
      amp: { attack: 0.0003, hold: 0.005, decay: 0.018, sustain: 0, release: 0.012, curve: 2.6 } }),
  ], { reverbMix: 0.2, reverbSize: 0.45, reverbDamping: 0.5, tone: 0, width: 0.65 }, { gain: 0.1598, fadeOut: 0.02 }, 1, [])
}

/** The heaviest of the three. The seat lands at four hundred and eighty hertz six tenths of a
 * second in, which is most of what makes it read as a large thing closing. */
export function reloadBreech(): AudioPatch {
  return makePatch(0.95, [
    makeLayer({ gain: 1.0, spread: 0.35, offset: 0.01,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 900, resonance: 0.15 },
      resonator: { amount: 1, frequency: 1050, spread: 0.55, decay: 0.05, partials: 5 },
      shaper: { drive: 0.12, bitDepth: 16, crush: 0 },
      amp: { attack: 0.0003, hold: 0.004, decay: 0.012, sustain: 0, release: 0.008, curve: 2.7 } }),
    makeLayer({ gain: 0.62, spread: 0.75, offset: 0.14,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 1800, slide: 3, slideCurve: EASE_IN, jitter: 20 },
      filter: { kind: 'bandpass', cutoff: 2200, resonance: 0.35, envAmount: 0.8, envCurve: EASE_IN },
      amp: { attack: 0.004, hold: 0.09, decay: 0.18, sustain: 0.35, release: 0.1, curve: 1.9 } }),
    makeLayer({ gain: 0.72, spread: 0.3, offset: 0.6,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 420, resonance: 0.18 },
      resonator: { amount: 1, frequency: 480, spread: 0.66, decay: 0.11, partials: 5 },
      shaper: { drive: 0.24, bitDepth: 16, crush: 0 },
      amp: { attack: 0.0004, hold: 0.006, decay: 0.024, sustain: 0, release: 0.016, curve: 2.5 } }),
  ], { reverbMix: 0.24, reverbSize: 0.55, reverbDamping: 0.45, tone: -0.05, width: 0.6 },
     { gain: 0.118, fadeOut: 0.02, limiter: 0.7 }, 1, [])
}

/**
 * A part travelling, then seating. Two square gates hand the sound back and forth between the body
 * at 1.45 kHz and the edge above it at 9.5 — but at nineteen and twenty-seven hertz rather than at
 * one rate half a turn apart, because a pair locked in antiphase adds up to a constant: one opens
 * exactly as the other shuts, the level never dips, and what should be steps arrives as a warble.
 * Let them drift and some steps are both bands at once and some are a gap, which is what a
 * mechanism sounds like. The excitation is thrown up most of an octave in the first thirty
 * milliseconds and creeps the remaining octave and a bit over the rest of the travel. The seat
 * lands at four hundred and twenty milliseconds on a body at seven hundred hertz — the lowest
 * thing here, the last, and the only source of anything below a kilohertz.
 */
export function morphRobotic(): AudioPatch {
  return makePatch(0.68, [
    makeLayer({
      gain: 0.0548, spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 1400, resonance: 0.2, envAmount: 2.2, envCurve: EASE_OUT },
      resonator: { amount: 1, frequency: 1450, spread: 0.55, decay: 0.06, partials: 5 },
      amp: { attack: 0.003, hold: 0.18, decay: 0.28, sustain: 0.35, release: 0.14, curve: 2 },
    }),
    makeLayer({
      gain: 0.0731, spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 7000, resonance: 0.12 },
      resonator: { amount: 0.6, frequency: 9500, spread: 0.18, decay: 0.03, partials: 3 },
      amp: { attack: 0.004, hold: 0.06, decay: 0.24, sustain: 0.55, release: 0.14, curve: 2 },
    }),
    makeLayer({
      gain: 0.346, spread: 0.4, offset: 0.42,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 500, resonance: 0.14 },
      resonator: { amount: 1, frequency: 700, spread: 0.7, decay: 0.13, partials: 6 },
      amp: { attack: 0.0004, hold: 0.002, decay: 0.004, sustain: 0, release: 0.002, curve: 2.8 },
    }),
  ], { delayTime: 0.043, delayFeedback: 0.3, delayMix: 0.45, reverbMix: 0.1, reverbSize: 0.22, reverbDamping: 0.8, tone: 0.2, width: 0.6 },
     { gain: 0.9077, fadeOut: 0.02 }, 1, [
       { enabled: true, shape: 'square', rate: 19, depth: 1, phase: 0, target: 'layers[0].gain' },
       { enabled: true, shape: 'square', rate: 27, depth: 1, phase: 0.5, target: 'layers[1].gain' },
     ])
}

/**
 * The same mechanism made of something that rings. One bar at twelve hundred hertz, its partials
 * opened out to six that reach fourteen kilohertz, struck by a band of noise centred at 5.8 kHz
 * rather than at its own pitch: measured against striking it at twelve hundred, that lifts every
 * partial above four kilohertz by seven to fourteen decibels. The fundamental is still the loudest
 * thing in the bar by nine — moving the strike changes a body's balance, it does not re-seat it.
 * The ring is held to a hundred and sixty milliseconds so the delay's repeats land in the clear
 * rather than inside the one before, and the air above six kilohertz is struck rather than held,
 * for the same reason; it keeps a fifth of its level afterwards, which is what stops the second
 * half going dark once the bar is spent. A sampled-noise modulator chops the ring at twenty-six
 * hertz, irregularly, because metal settling is not a machine stepping. The second seat lands at
 * two hundred and sixty milliseconds.
 */
export function morphMetal(): AudioPatch {
  return makePatch(0.6, [
    makeLayer({
      gain: 0.7688, spread: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'bandpass', cutoff: 5800, resonance: 0.2 },
      resonator: { amount: 1, frequency: 1200, spread: 0.62, decay: 0.16, partials: 6 },
      amp: { attack: 0.0005, hold: 0.002, decay: 0.005, sustain: 0, release: 0.002, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.0554, spread: 0.5,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 6500, resonance: 0.12 },
      resonator: { amount: 0.55, frequency: 9000, spread: 0.18, decay: 0.04, partials: 3 },
      amp: { attack: 0.004, hold: 0.01, decay: 0.34, sustain: 0.18, release: 0.16, curve: 2 },
    }),
    makeLayer({
      gain: 0.0855, spread: 0.45, offset: 0.26,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 600, resonance: 0.14 },
      resonator: { amount: 1, frequency: 900, spread: 0.75, decay: 0.22, partials: 5 },
      amp: { attack: 0.0005, hold: 0.002, decay: 0.005, sustain: 0, release: 0.002, curve: 2.8 },
    }),
  ], { delayTime: 0.062, delayFeedback: 0.45, delayMix: 0.5, reverbMix: 0.14, reverbSize: 0.3, reverbDamping: 0.72, tone: 0.22, width: 0.65 },
     { gain: 0.9994, fadeOut: 0.02 }, 1, [
       { enabled: true, shape: 'noise', rate: 26, depth: 0.85, target: 'layers[0].gain' },
       { enabled: true, shape: 'square', rate: 17, depth: 0.9, phase: 0.2, target: 'layers[2].gain' },
     ])
}

/**
 * The small one: an eight-millisecond strike, a body at 1.7 kHz, a 12 kHz ring above it, and
 * almost nothing under 250 Hz. What follows is the delay reprinting the strike every twenty-two
 * milliseconds, not a second hit. The layer gains look lopsided and are not — a modal body ringing
 * for a tenth of a second is worth twenty decibels on its own, so 0.135 sits level with 1.5.
 */
export function impactSnap(): AudioPatch {
  return makePatch(0.45, [
    makeLayer({
      gain: 1.5, spread: 0.4, offset: 0,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1800, resonance: 0.12 },
      resonator: { amount: 0.1, frequency: 12000, spread: 0.09, decay: 0.02, partials: 2 },
      amp: { attack: 0.0003, hold: 0.002, decay: 0.004, sustain: 0, release: 0.002, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.135, spread: 0.35, offset: 0.003,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1100, resonance: 0.1 },
      resonator: { amount: 1, frequency: 1700, spread: 0.42, decay: 0.09, partials: 4 },
      amp: { attack: 0.0004, hold: 0.002, decay: 0.005, sustain: 0, release: 0.002, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.022, spread: 0.25, offset: 0.001,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 1400, resonance: 0.15 },
      resonator: { amount: 1, frequency: 105, spread: 0.6, decay: 0.18, partials: 5 },
      amp: { attack: 0.0008, hold: 0.002, decay: 0.008, sustain: 0, release: 0.004, curve: 2.6 },
    }),
  ], {
    delayTime: 0.022, delayFeedback: 0.85, delayMix: 0.65,
    reverbMix: 0.24, reverbSize: 0.35, reverbDamping: 0.4,
    tone: 0.2, width: 0.55,
  }, { fadeOut: 0.02, gain: 1.002 }, 1, [])
}

/**
 * The middle one, and the mass answers eighteen milliseconds after the crack. That gap is the
 * difference between something being hit and something clicking: below it the two arrive as one
 * sound. The body sits a fourth under the small one's, because size in a struck thing is pitch
 * before it is level.
 */
export function impactStrike(): AudioPatch {
  return makePatch(0.95, [
    makeLayer({
      gain: 1.5, spread: 0.4, offset: 0,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1600, resonance: 0.12 },
      resonator: { amount: 0.1, frequency: 9200, spread: 0.1, decay: 0.026, partials: 2 },
      amp: { attack: 0.0003, hold: 0.0025, decay: 0.005, sustain: 0, release: 0.002, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.135, spread: 0.35, offset: 0.018,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 900, resonance: 0.1 },
      resonator: { amount: 1, frequency: 1250, spread: 0.6, decay: 0.16, partials: 4 },
      amp: { attack: 0.0005, hold: 0.003, decay: 0.006, sustain: 0, release: 0.003, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.016, spread: 0.25, offset: 0.002,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 1200, resonance: 0.15 },
      resonator: { amount: 1, frequency: 98, spread: 0.6, decay: 0.3, partials: 5 },
      amp: { attack: 0.001, hold: 0.003, decay: 0.012, sustain: 0, release: 0.006, curve: 2.5 },
    }),
  ], {
    delayTime: 0.043, delayFeedback: 0.86, delayMix: 0.68,
    reverbMix: 0.28, reverbSize: 0.5, reverbDamping: 0.4,
    tone: 0.12, width: 0.6,
  }, { fadeOut: 0.06, gain: 1.043 }, 1, [])
}

/**
 * The large one: the crack lands, the mass follows fifty-five milliseconds later, and the room is
 * half of what you hear. What makes it read as big is not the low end — there is barely more of it
 * than in the other two — it is that the crack's own ring dropped from nine kilohertz to seven and
 * a half, which moved an eighth of the sound's energy down an octave.
 */
export function impactSlam(): AudioPatch {
  return makePatch(1.9, [
    makeLayer({
      gain: 1.5, spread: 0.45, offset: 0,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 1200, resonance: 0.12 },
      resonator: { amount: 0.1, frequency: 7500, spread: 0.12, decay: 0.035, partials: 2 },
      amp: { attack: 0.0004, hold: 0.003, decay: 0.02, sustain: 0, release: 0.012, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.05, spread: 0.35, offset: 0.055,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'highpass', cutoff: 700, resonance: 0.12 },
      resonator: { amount: 1, frequency: 850, spread: 0.42, decay: 0.35, partials: 4 },
      amp: { attack: 0.0006, hold: 0.004, decay: 0.008, sustain: 0, release: 0.004, curve: 2.8 },
    }),
    makeLayer({
      gain: 0.018, spread: 0.25, offset: 0.003,
      source: { kind: 'noise', colour: 'white' },
      filter: { kind: 'lowpass', cutoff: 1000, resonance: 0.15 },
      resonator: { amount: 1, frequency: 78, spread: 0.6, decay: 0.5, partials: 5 },
      amp: { attack: 0.0012, hold: 0.004, decay: 0.016, sustain: 0, release: 0.008, curve: 2.5 },
    }),
  ], {
    delayTime: 0.078, delayFeedback: 0.88, delayMix: 0.8,
    reverbMix: 0.5, reverbSize: 0.62, reverbDamping: 0.32,
    tone: 0.05, width: 0.65,
  }, { fadeOut: 0.12, gain: 1.33 }, 1, [])
}
