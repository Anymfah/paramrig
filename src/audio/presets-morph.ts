import type { AudioPatch, Layer, MasterSettings, ModSlot, Performer } from './types.ts'
import type { FxInput } from './patch.ts'
import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import { makeLayer, makePatch } from './patch.ts'

/**
 * The sounds the engine could not make before.
 *
 * The rest of the library was written against a synthesiser with one filter, no wavetables, three
 * effects in a fixed order and layers that could not hear each other. Those sounds still work and
 * still sound like themselves, which is the point of carrying a patch forward rather than
 * rewriting it. This is the other half of the job: a family where each sound leans on one thing
 * the instrument gained, so that what it can now do is audible rather than merely documented.
 */

function patch(
  duration: number,
  layers: Layer[],
  fx: FxInput = {},
  master: Partial<MasterSettings> = {},
  lfos: Partial<ModSlot>[] = [],
  envelopes: Partial<ModSlot>[] = [],
  performers: Partial<Performer>[] = [],
): AudioPatch {
  return makePatch(duration, layers, fx, master, 1, lfos, envelopes, performers)
}

/** A wavetable walked from one end to the other by an envelope: the thing a filter cannot do. */
export function tableSweep(): AudioPatch {
  return patch(0.9, [
    makeLayer({
      gain: 0.65,
      spread: 0.5,
      source: { kind: 'table', table: 'sweep', position: 0, voices: 3, detune: 9 },
      pitch: { start: 180, slide: 5, slideCurve: EASE_OUT, jitter: 6 },
      filter: { kind: 'lowpass', cutoff: 9000, resonance: 0.15 },
      amp: { attack: 0.02, hold: 0.25, decay: 0.4, sustain: 0.35, release: 0.2, curve: 1.4 },
    }),
  ], { z: { kind: 'reverb', mode: 'send', mix: 0.16, size: 0.5, damping: 0.45 }, tone: 0.1, width: 0.7 },
     { gain: 1.516182 }, [],
     [{ enabled: true, target: 'layers[0].pulseWidth', depth: 1, attack: 0.02, hold: 0.05, decay: 0.7, sustain: 0.9, release: 0.1, curve: 1.1 }])
}

/** Struck glass: the inharmonic table into a body that rings on after the strike has gone. */
export function glassBell(): AudioPatch {
  return patch(0.9, [
    makeLayer({
      gain: 0.5,
      spread: 0.6,
      // Low on the table and low in pitch: 'glass' keeps nothing under its sixteenth harmonic at
      // the near end of its dial, and a sound made of harmonics nobody can reach is silence.
      source: { kind: 'table', table: 'glass', position: 0.88 },
      pitch: { start: 330, jitter: 14 },
      filter: { kind: 'highpass', cutoff: 220, resonance: 0.1 },
      insertC: { kind: 'body', place: 'post', amount: 0.96, frequency: 1980, spread: 0.62, decay: 2.4, partials: 5 },
      amp: { attack: 0.001, hold: 0.004, decay: 0.05, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { z: { kind: 'reverb', mode: 'send', mix: 0.22, size: 0.6, damping: 0.35 }, tone: 0.25, width: 0.8 },
     { gain: 0.121656 })
}

/** Four poles and a comb after the amplifier: an engine that keeps turning over. */
export function growlEngine(): AudioPatch {
  return patch(1.2, [
    makeLayer({
      gain: 0.97,
      spread: 0.35,
      source: { kind: 'table', table: 'growl', position: 0.6, voices: 2, detune: 22 },
      pitch: { start: 78, vibratoRate: 5.5, vibratoDepth: 0.4, jitter: 8 },
      filter: { kind: 'ladder', cutoff: 620, resonance: 0.55, envAmount: 1.2, envCurve: EASE_OUT },
      insertB: { kind: 'comb', place: 'post', amount: 0.3, time: 0.011, feedback: 0.66 },
      amp: { attack: 0.06, hold: 0.5, decay: 0.3, sustain: 0.6, release: 0.25, curve: 1.2 },
    }),
  ], { tone: -0.25, width: 0.5 }, { gain: 1.516196 })
}

/** A tone multiplied by another: the one shape a filter can never arrive at. */
export function ringAlarm(): AudioPatch {
  return patch(0.8, [
    makeLayer({
      gain: 0.6,
      spread: 0.5,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 7 },
      pitch: { start: 520, jitter: 5 },
      insertA: { kind: 'ring', place: 'pre', amount: 0.85, ratio: 1.49 },
      insertC: { kind: 'body', place: 'post', amount: 0.2, frequency: 1560, spread: 0.3, decay: 0.12, partials: 3 },
      amp: { attack: 0.008, hold: 0.14, decay: 0.12, sustain: 0.5, release: 0.12, curve: 1.6 },
    }),
  ], { y: { kind: 'delay', mode: 'send', mix: 0.2, time: 0.13, feedback: 0.42 }, tone: 0.15, width: 0.65 },
     { gain: 0.6 },
     [{ enabled: true, shape: 'square', rate: 5, depth: 0.6, target: 'layers[0].gain' }])
}

/** Turned back at the rails until it is nothing like the sine that went in. */
export function foldBuzz(): AudioPatch {
  return patch(0.6, [
    makeLayer({
      gain: 0.55,
      spread: 0.4,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 12 },
      pitch: { start: 150, slide: -7, slideCurve: EASE_IN, jitter: 10 },
      insertA: { kind: 'fold', place: 'pre', amount: 1, drive: 0.34 },
      filter: { kind: 'lowpass', cutoff: 3200, resonance: 0.3, envAmount: -1.5, envCurve: EASE_OUT },
      amp: { attack: 0.004, hold: 0.08, decay: 0.3, sustain: 0.2, release: 0.12, curve: 1.8 },
    }),
  ], { tone: -0.1, width: 0.5 }, { gain: 0.9811 })
}

/** A notch walked across the band by an oscillator: a phaser made out of a filter. */
export function notchSweep(): AudioPatch {
  return patch(1.4, [
    makeLayer({
      gain: 0.6,
      spread: 0.7,
      source: { kind: 'noise', colour: 'pink' },
      pitch: { start: 400 },
      filter: { kind: 'notch', cutoff: 700, resonance: 0.6 },
      amp: { attack: 0.1, hold: 0.6, decay: 0.4, sustain: 0.7, release: 0.3, curve: 1 },
    }),
  ], { tone: 0.2, width: 0.9 }, { gain: 0.921699 },
     [{ enabled: true, shape: 'triangle', rate: 0.9, depth: 0.55, target: 'layers[0].cutoff' }])
}

/** One layer bending another's phase: the sound of two oscillators that are not independent. */
export function crossBell(): AudioPatch {
  return patch(1.0, [
    makeLayer({
      gain: 0.6,
      spread: 0.45,
      source: { kind: 'tone', wave: 'sine', pmFrom: 'layer1', fmIndex: 2.6, fmFall: 0.75 },
      pitch: { start: 440, jitter: 12 },
      filter: { kind: 'peak', cutoff: 1300, resonance: 0.4 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.5, sustain: 0.1, release: 0.3, curve: 2.4 },
    }),
    makeLayer({
      // Heard as well as felt: turned down, but not off, so the strike has a body under it.
      gain: 0.12,
      source: { kind: 'tone', wave: 'triangle' },
      pitch: { start: 311, slide: -4, slideCurve: EASE_OUT },
      amp: { attack: 0.001, hold: 0.03, decay: 0.28, sustain: 0, release: 0.1, curve: 2.6 },
    }),
  ], { z: { kind: 'reverb', mode: 'send', mix: 0.18, size: 0.45, damping: 0.4 }, tone: 0.2, width: 0.75 },
     { gain: 0.845886 })
}

/** Copies that never quite agree, which is the whole of a chorus. */
export function chorusPad(): AudioPatch {
  return patch(1.6, [
    makeLayer({
      gain: 1.22,
      spread: 0.8,
      source: { kind: 'table', table: 'stack', position: 0.45, voices: 3, detune: 14 },
      pitch: { start: 220, jitter: 6 },
      filter: { kind: 'lowpass', cutoff: 2600, resonance: 0.2, envAmount: 1.4, envCurve: LINEAR },
      amp: { attack: 0.25, hold: 0.5, decay: 0.5, sustain: 0.6, release: 0.5, curve: 1 },
    }),
  ], {
    x: { kind: 'chorus', mode: 'insert', mix: 0.55, rate: 0.7, depth: 0.6 },
    z: { kind: 'reverb', mode: 'send', mix: 0.24, size: 0.7, damping: 0.5 },
    tone: 0.05, width: 0.9,
  }, { gain: 1.527833 })
}

/** Notches that move, which is softer than a comb that moves and the reason both exist. */
export function phaserSweep(): AudioPatch {
  return patch(1.5, [
    makeLayer({
      gain: 0.55,
      spread: 0.6,
      source: { kind: 'tone', wave: 'saw', voices: 2, detune: 10 },
      pitch: { start: 130, jitter: 8 },
      filter: { kind: 'lowpass', cutoff: 3800, resonance: 0.25 },
      amp: { attack: 0.08, hold: 0.6, decay: 0.4, sustain: 0.65, release: 0.35, curve: 1.1 },
    }),
  ], {
    x: { kind: 'phaser', mode: 'insert', mix: 0.6, rate: 0.45, depth: 0.85, feedback: 0.55 },
    tone: -0.05, width: 0.8,
  }, { gain: 0.824802 })
}

/** Pushed apart rather than made louder: the one effect that changes nothing you can hear in mono. */
export function wideRiser(): AudioPatch {
  return patch(1.8, [
    makeLayer({
      gain: 0.74,
      spread: 0.9,
      source: { kind: 'noise', colour: 'white' },
      pitch: { start: 900 },
      filter: { kind: 'bandpass', cutoff: 500, resonance: 0.5, envAmount: 3.4, envCurve: EASE_IN },
      amp: { attack: 0.6, hold: 0.4, decay: 0.4, sustain: 0.9, release: 0.35, curve: 1 },
    }),
    makeLayer({
      gain: 0.41,
      spread: 0.5,
      source: { kind: 'table', table: 'formant', position: 0.5, voices: 2, detune: 18 },
      pitch: { start: 110, slide: 12, slideCurve: EASE_IN },
      filter: { kind: 'lowpass', cutoff: 1800, resonance: 0.2, envAmount: 2, envCurve: EASE_IN },
      amp: { attack: 0.5, hold: 0.5, decay: 0.4, sustain: 0.8, release: 0.4, curve: 1 },
    }),
  ], {
    x: { kind: 'widener', mode: 'insert', mix: 0.7, width: 0.8, rate: 0.2 },
    z: { kind: 'reverb', mode: 'send', mix: 0.2, size: 0.75, damping: 0.4 },
    tone: 0.1, width: 0.95,
  }, { gain: 1.522602 })
}

/** A drawn row on a grid, with two of its steps held: a sequence rather than a shape. */
export function stepSequence(): AudioPatch {
  const row = [1, 0.5, 0.75, 0.25, 1, 0.5, 0.75, 0.25, 0.5, 0.75, 1, 0.5, 0.25, 0.75, 0.5, 1]
  const held = row.map((_, at) => (at % 4 === 0 ? 0 : 1))
  return patch(1.6, [
    makeLayer({
      gain: 0.55,
      spread: 0.4,
      source: { kind: 'table', table: 'pulse', position: 0.4, voices: 2, detune: 8 },
      pitch: { start: 220, jitter: 4 },
      filter: { kind: 'lowpass', cutoff: 2400, resonance: 0.45 },
      insertA: { kind: 'drive', place: 'pre', amount: 1, drive: 0.18 },
      amp: { attack: 0.004, hold: 1.2, decay: 0.2, sustain: 0.9, release: 0.15, curve: 1 },
    }),
  ], { y: { kind: 'delay', mode: 'send', mix: 0.18, time: 0.1, feedback: 0.35 }, tone: 0.15, width: 0.7 },
     { gain: 0.852481 }, [], [],
     [{
       enabled: true, rate: 2, shape: 'line', bipolar: false, depth: 0.7, target: 'layers[0].pitch', grid: 4,
       patterns: Array.from({ length: 12 }, (_, scene) => (scene === 0 ? row : Array.from({ length: 16 }, () => 0))),
       curves: Array.from({ length: 12 }, (_, scene) => (scene === 0 ? held : Array.from({ length: 16 }, () => 1))),
     }])
}

/** Two resonances at once, balanced: a mouth rather than a filter. */
export function vowelSweep(): AudioPatch {
  return patch(1.4, [
    makeLayer({
      gain: 1.05,
      spread: 0.5,
      source: { kind: 'table', table: 'stack', position: 0.3, voices: 2, detune: 11 },
      pitch: { start: 120, jitter: 6 },
      filterA: { kind: 'formant', cutoff: 400, resonance: 0.62 },
      filterB: { kind: 'bandpass', cutoff: 2600, resonance: 0.5 },
      routing: 'parallel',
      filterMix: 0.35,
      amp: { attack: 0.05, hold: 0.7, decay: 0.3, sustain: 0.8, release: 0.25, curve: 1 },
    }),
  ], { z: { kind: 'reverb', mode: 'send', mix: 0.14, size: 0.4, damping: 0.5 }, tone: 0.1, width: 0.7 },
     { gain: 1.528229 },
     [{ enabled: true, shape: 'triangle', rate: 0.7, depth: 0.8, target: 'layers[0].cutoff' }])
}

/** One filter fed what the other left: a band inside a band, which is one shape and not two. */
export function seriesPluck(): AudioPatch {
  return patch(0.7, [
    makeLayer({
      gain: 0.95,
      spread: 0.45,
      source: { kind: 'table', table: 'bell', position: 0.5, voices: 2, detune: 8 },
      pitch: { start: 260, slide: -3, slideCurve: EASE_OUT, jitter: 9 },
      filterA: { kind: 'ladder', cutoff: 1500, resonance: 0.5, envAmount: -2.2, envCurve: EASE_OUT },
      filterB: { kind: 'highpass', cutoff: 260, resonance: 0.2 },
      routing: 'series',
      amp: { attack: 0.002, hold: 0.02, decay: 0.4, sustain: 0.1, release: 0.15, curve: 2.2 },
    }),
  ], { y: { kind: 'delay', mode: 'send', mix: 0.16, time: 0.11, feedback: 0.3 }, tone: 0.15, width: 0.6 },
     { gain: 1.529318 })
}

/** Bits thrown away on purpose, and a table underneath to throw away. */
export function crushedTable(): AudioPatch {
  return patch(0.7, [
    makeLayer({
      gain: 0.82,
      spread: 0.45,
      source: { kind: 'table', table: 'fold', position: 0.7, voices: 2, detune: 9 },
      pitch: { start: 330, slide: -12, slideCurve: EASE_OUT, jitter: 8 },
      insertA: { kind: 'crusher', place: 'pre', amount: 0.8, bitDepth: 5, crush: 0.35 },
      filter: { kind: 'lowpass', cutoff: 4200, resonance: 0.3 },
      amp: { attack: 0.003, hold: 0.06, decay: 0.35, sustain: 0.15, release: 0.12, curve: 2 },
    }),
  ], { tone: 0.1, width: 0.55 }, { gain: 1.162059 })
}
