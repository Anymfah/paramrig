import type { AudioPatch, Layer, MasterSettings, ModSlot, Performer } from './types.ts'
import type { FxInput } from './patch.ts'
import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import { makeLayer, makePatch } from './patch.ts'

/**
 * Seven sounds meant to be played one after another.
 *
 * Morph took one subsystem per preset, so that each thing the engine gained could be heard on its
 * own. These take four or five at a time, because a synthesiser is not the sum of its parts and the
 * questions that only arise when several are running have no answer in a one-idea patch — what a
 * phase modulator does when its own amplifier closes before the carrier's, which side of the
 * amplifier a comb belongs on, whether a drawn row still articulates once the sends are up.
 *
 * They are longer than the working presets on purpose. These are not sounds to fire at a button
 * press; they are here to be listened to, and each one is a single event you can name in a
 * sentence — a voice saying a phrase, a heavy thing thrown that lands, a hull hit once, a ricochet
 * crossing the room, a tool touching down on steel, a strike that clears into a bell, a machine
 * paying out.
 *
 * Between them they reach the parts of the instrument the other hundred and six leave alone: the
 * phase-modulation matrix used as a chain and as a hidden bender, both filter arrangements, the
 * comb and the formant models, all six insert kinds standing on both sides of the amplifier, the
 * whole performer rack on three destinations at three rates, and pan, resonance, PM depth and
 * insert amount as things that move rather than things that are set — none of which anything in
 * the library pointed a modulator at.
 *
 * Every one of them was rendered, then ablated field by field: anything that did not change the
 * samples was taken out, and each doc comment says the mechanism the measurement found rather than
 * the one it was written for.
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


/** Sixteen vowels drawn on a row: the mouth in front, the throat behind it, both moved by one swing. */
export function vowelPhrase(): AudioPatch {
  const said = [0.12, 0.12, 0.58, 0.58, 0.34, 0.86, 0.86, 0.26, 0.5, 0.5, 0.74, 0.18, 0.18, 0.62, 0.92, 0.4]
  // Every fourth step is arrived at held rather than glided, which is where a consonant goes.
  const snap = Array.from({ length: 16 }, (_, at) => (at % 4 === 0 ? 0.1 : 1))
  return {
    ...patch(1.35, [
      makeLayer({
        gain: 0.7,
        pan: -0.15,
        spread: 0.55,
        source: { kind: 'tone', wave: 'saw', voices: 3, detune: 15 },
        pitch: { start: 116, slide: -2, slideCurve: EASE_OUT, vibratoRate: 5.2, vibratoDepth: 0.25, jitter: 7 },
        // The formant walks the vowel table with its cutoff and the ladder stands above it. One
        // swing moves both, so an open vowel arrives bright and a closed one arrives dark.
        routing: 'series',
        filterA: { kind: 'formant', cutoff: 300, resonance: 0.5, envAmount: 1, envCurve: EASE_IN },
        filterB: { kind: 'ladder', cutoff: 1500, resonance: 0.45, envAmount: -1.6, envCurve: EASE_OUT },
        amp: { attack: 0.04, hold: 0.75, decay: 0.3, sustain: 0.75, release: 0.22, curve: 1.1 },
      }),
      makeLayer({
        // The consonants: a band chopped at seven and a half hertz, with a comb beside it that
        // gives the chopping a pitch of its own. Held up rather than left to decay, because a
        // gate has nothing to chop once the thing it is gating is twenty decibels down.
        gain: 0.42,
        pan: 0.35,
        spread: 0.4,
        source: { kind: 'noise', colour: 'pink' },
        routing: 'parallel',
        filterMix: 0.35,
        filterA: { kind: 'bandpass', cutoff: 3400, resonance: 0.5, envAmount: -2.6, envCurve: EASE_OUT },
        filterB: { kind: 'comb', cutoff: 620, resonance: 0.75 },
        amp: { attack: 0.002, hold: 0.06, decay: 0.28, sustain: 0.34, release: 0.3, curve: 2.4 },
      }),
    ], { z: { kind: 'reverb', mode: 'send', mix: 0.16, size: 0.45, damping: 0.45 }, tone: 0.05, width: 0.8 },
       { gain: 0.739627 },
       [
         { enabled: true, shape: 'triangle', rate: 2.6, depth: 0.5, target: 'layers[0].resonance' },
         { enabled: true, shape: 'square', rate: 7.5, depth: 0.9, target: 'layers[1].gain' },
         { enabled: true, shape: 'triangle', rate: 0.55, depth: 0.35, target: 'layers[0].pan' },
       ],
       [],
       [{
         enabled: true, rate: 1, shape: 'curve', bipolar: true, depth: 0.85, target: 'layers[0].cutoff',
         // Twelve rotations of the one phrase: the same voice saying something else at each trigger.
         patterns: Array.from({ length: 12 }, (_, scene) => said.map((_, at) => said[(at + scene) % 16] ?? 0)),
         curves: Array.from({ length: 12 }, () => [...snap]),
       }]),
    scene: 3,
  }
}


/** Four poles falling four octaves past a comb that stays where it is tuned, and landing on something. */
export function resonantDrop(): AudioPatch {
  return patch(0.95, [
    makeLayer({
      gain: 0.58,
      pan: -0.45,
      // Held narrow on purpose: three voices thrown wide are a bed, and a bed does not move when
      // the pan modulator rotates it. The width here comes from crossing the field, not from spread.
      spread: 0.22,
      source: { kind: 'table', table: 'stack', position: 0.55, voices: 3, detune: 14 },
      pitch: { start: 660, slide: -34, slideCurve: LINEAR, jitter: 8 },
      filterA: { kind: 'ladder', cutoff: 5400, resonance: 0.32, envAmount: -4, envCurve: LINEAR },
      // The comb's tuning is the one thing in this layer that holds still: nothing points at the
      // cutoff and its envAmount is zero, so the ladder descends past a fixed set of notches. Its
      // feedback does move — one swing serves both filters' resonance — which is what sings.
      filterB: { kind: 'comb', cutoff: 330, resonance: 0.62 },
      routing: 'series',
      insertA: { kind: 'drive', place: 'pre', amount: 0.55, drive: 0.58 },
      amp: { attack: 0.012, hold: 0.19, decay: 0.34, sustain: 0.06, release: 0.35, curve: 1.6 },
    }),
    makeLayer({
      // The crack: white noise held up by a resonance that is nearly at the top of the dial.
      gain: 1.35,
      pan: 0.12,
      offset: 0.5,
      spread: 0.55,
      source: { kind: 'noise', colour: 'white' },
      pitch: { start: 200 },
      filterA: { kind: 'ladder', cutoff: 2400, resonance: 0.92, envAmount: -3.6, envCurve: EASE_OUT },
      amp: { attack: 0.0006, hold: 0.005, decay: 0.16, sustain: 0, release: 0.1, curve: 3.4 },
    }),
    makeLayer({
      // And the weight under it, twelve milliseconds later, so the two do not peak on the same
      // sample. It is a tone rather than noise so that the peak of the patch is rate-independent.
      gain: 1.28,
      offset: 0.512,
      spread: 0.2,
      source: { kind: 'tone', wave: 'triangle', voices: 2, detune: 6 },
      pitch: { start: 128, slide: -13, slideCurve: EASE_OUT, jitter: 4 },
      filterA: { kind: 'ladder', cutoff: 320, resonance: 0.55, envAmount: -1.4, envCurve: EASE_OUT },
      amp: { attack: 0.0015, hold: 0.012, decay: 0.22, sustain: 0, release: 0.12, curve: 3 },
    }),
  ], { z: { kind: 'reverb', mode: 'send', mix: 0.2, size: 0.6, damping: 0.45 }, tone: -0.15, width: 0.8 },
     { gain: 0.737379 },
     [
       { enabled: true, shape: 'saw', rate: 1.05, depth: -0.55, target: 'layers[0].insertA' },
       { enabled: true, shape: 'triangle', rate: 7, depth: 0.45, target: 'layers[0].resonance' },
       // Nearly two crossings, spent inside the fall: at the old rate the swing peaked after the
       // landing, where a mono impact and a reverb are all anyone can hear.
       { enabled: true, shape: 'sine', rate: 1.7, depth: 0.9, phase: 0.12, target: 'layers[0].pan' },
     ],
     [
       { enabled: true, target: 'layers[0].resonance', depth: 0.85, attack: 0.02, hold: 0.5, decay: 0.18, sustain: 0.9, release: 0.15, curve: 1 },
     ])
}


/** Three oscillators in a row, each bending the next: a clang no filter arrives at, and two plates that pass each other while it dies. */
export function hullStrike(): AudioPatch {
  return patch(1.4, [
    // Heard by nobody. Its own sine bends it, it bends the next one, and it is over in a tenth of
    // a second — which is why the clang is only at the start.
    makeLayer({
      gain: 0,
      source: { kind: 'tone', wave: 'sine', fmRatio: 3.7, fmIndex: 2, fmFall: 0.6 },
      pitch: { start: 87 },
      amp: { attack: 0.001, hold: 0.008, decay: 0.14, sustain: 0, release: 0.2, curve: 3 },
    }),
    // The middle of the chain: bent by the first, and what it hands on is already inharmonic.
    makeLayer({
      gain: 0,
      source: { kind: 'tone', wave: 'sine', pmFrom: 'layer0', fmIndex: 5, fmFall: 0.45 },
      pitch: { start: 470 },
      amp: { attack: 0.001, hold: 0.015, decay: 0.35, sustain: 0.12, release: 0.4, curve: 2.4 },
    }),
    // The hull. Nine tenths of the depth is gone by the end, so what rings on is nearly a sine.
    makeLayer({
      gain: 0.8, spread: 0.7, pan: -0.35,
      source: { kind: 'tone', wave: 'sine', pmFrom: 'layer1', fmIndex: 7, fmFall: 0.9, voices: 2, detune: 9 },
      pitch: { start: 143, jitter: 8 },
      filterA: { kind: 'highpass', cutoff: 110, resonance: 0.15 },
      amp: { attack: 0.001, hold: 0.012, decay: 0.35, sustain: 0.28, release: 0.7, curve: 2.2 },
    }),
    // The same bend on a thinner plate, thrown the other way while it dies.
    makeLayer({
      gain: 0.9, spread: 0.5, pan: 0.55,
      source: { kind: 'tone', wave: 'sine', pmFrom: 'layer1', fmIndex: 4, fmFall: 0.7, voices: 2, detune: 15 },
      pitch: { start: 319, jitter: 12 },
      filterA: { kind: 'lowpass', cutoff: 6200, resonance: 0.2, envAmount: -2.2, envCurve: EASE_OUT },
      amp: { attack: 0.0015, hold: 0.008, decay: 0.3, sustain: 0.14, release: 0.6, curve: 2.6 },
    }),
  ], { z: { kind: 'reverb', mode: 'send', mix: 0.2, size: 0.6, damping: 0.4 }, tone: -0.05, width: 0.85 },
     { gain: 0.654283 },
     [
       { enabled: true, shape: 'sine', rate: 2.7, depth: 0.35, target: 'layers[2].pm' },
       { enabled: true, shape: 'triangle', rate: 0.36, depth: 1, target: 'layers[3].pan' },
       // The hull goes the other way. One layer crossing the field is a layer that has moved; two
       // crossing it in opposite directions is the field itself turning over, and it puts the
       // movement in the first three hundred milliseconds, where the sound actually is.
       { enabled: true, shape: 'triangle', rate: 0.36, phase: 0.5, depth: 0.6, target: 'layers[2].pan' },
     ],
     [{ enabled: true, target: 'layers[3].pm', depth: 0.6, attack: 0.001, hold: 0.012, decay: 0.4, sustain: 0, release: 0.2, curve: 1.8 }])
}


/** A strike, a flight and the wall it comes back off: a sound that is somewhere, then somewhere else. */
export function ricochetPass(): AudioPatch {
  // The outward journey is the first half of one triangle, and it is 0.68 s long — which is where
  // the far wall is struck. The flight arrives exactly when the impact happens and rebounds off it.
  const arrive = 0.5 / 0.68
  return patch(1.15, [
    makeLayer({
      // The strike, placed rather than moved — and placed at half the field, not against the wall.
      // A transient panned hard is a transient at half level in the sum, and this is the loudest
      // thing here: twelve decibels of bias is already a side, and the last six cost the peak.
      gain: 0.62, pan: -0.55, spread: 0.15,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 3000, jitter: 12 },
      filter: { kind: 'highpass', cutoff: 1800, resonance: 0.2 },
      insertC: { kind: 'body', place: 'post', amount: 0.26, frequency: 3200, spread: 0.5, decay: 0.14, partials: 4 },
      amp: { attack: 0.0005, hold: 0.003, decay: 0.05, sustain: 0, release: 0.03, curve: 3.2 },
    }),
    makeLayer({
      // The flight. Narrow on purpose: a thing that travels has to be a point, and a wide layer
      // panned across the field arrives everywhere at once.
      gain: 0.62, pan: 0, spread: 0.1, offset: 0.012,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.3, voices: 2, detune: 6 },
      pitch: { start: 2400, slide: -26, slideCurve: EASE_OUT, vibratoRate: 7, vibratoDepth: 0.35, jitter: 8 },
      filter: { kind: 'bandpass', cutoff: 2600, resonance: 0.42, envAmount: -1.6, envCurve: EASE_OUT },
      amp: { attack: 0.004, hold: 0.05, decay: 0.5, sustain: 0.32, release: 0.45, curve: 1.6 },
    }),
    makeLayer({
      // The air it drags behind it: wide, and travelling nine tenths as far, so it smears rather
      // than doubles the point in front of it.
      gain: 0.34, pan: 0, spread: 0.85, offset: 0.03,
      source: { kind: 'noise', colour: 'pink' },
      pitch: { start: 900 },
      filter: { kind: 'bandpass', cutoff: 1400, resonance: 0.4, envAmount: -1.4, envCurve: EASE_OUT },
      amp: { attack: 0.02, hold: 0.1, decay: 0.5, sustain: 0.18, release: 0.3, curve: 1.4 },
    }),
    makeLayer({
      // The far wall, struck at 0.68 s, where the flight has just arrived.
      gain: 0.5, pan: 0.6, spread: 0.1, offset: 0.68,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2100, jitter: 20 },
      filter: { kind: 'highpass', cutoff: 2400, resonance: 0.2 },
      insertC: { kind: 'body', place: 'post', amount: 0.24, frequency: 2600, spread: 0.55, decay: 0.22, partials: 3 },
      amp: { attack: 0.0004, hold: 0.002, decay: 0.04, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { y: { kind: 'delay', mode: 'send', mix: 0.2, time: 0.085, feedback: 0.42 }, tone: 0.05, width: 1 },
     { gain: 0.785057 },
     [
       { enabled: true, shape: 'triangle', rate: arrive, depth: 1, phase: 0.5, target: 'layers[1].pan' },
       { enabled: true, shape: 'triangle', rate: arrive, depth: 0.9, phase: 0.46, target: 'layers[2].pan' },
     ],
     [{ enabled: true, target: 'layers[1].resonance', depth: 0.45, delay: 0.06, attack: 0.5, hold: 0.2, decay: 0.3, sustain: 0.8, release: 0.2, curve: 1.2 }])
}


/** A comb either side of the amplifier: the one in front stops with the tool, the one behind rings on. */
export function metalCutter(): AudioPatch {
  const stutter = [1, 1, 0.2, 1, 0.15, 1, 1, 0.3, 1, 0.1, 1, 1, 0.25, 1, 0.4, 1]
  return {
    ...patch(1.2, [
      makeLayer({
        gain: 0.78,
        pan: -0.3,
        spread: 0.3,
        source: { kind: 'table', table: 'growl', position: 0.55, voices: 2, detune: 16 },
        pitch: { start: 96, slide: 4, slideCurve: EASE_IN, vibratoRate: 7, vibratoDepth: 0.3, jitter: 7 },
        filterA: { kind: 'ladder', cutoff: 820, resonance: 0.42, envAmount: 1.6, envCurve: EASE_OUT },
        insertA: { kind: 'drive', place: 'pre', amount: 0.9, drive: 0.6 },
        insertB: { kind: 'comb', place: 'pre', amount: 0.15, time: 0.0021, feedback: 0.78 },
        insertC: { kind: 'comb', place: 'post', amount: 0.1, time: 0.011, feedback: 0.95 },
        amp: { attack: 0.012, hold: 0.49, decay: 0.35, sustain: 0, release: 0.12, curve: 1.3 },
      }),
      makeLayer({
        gain: 0.4,
        source: { kind: 'tone', wave: 'triangle' },
        pitch: { start: 62, slide: 3, slideCurve: EASE_IN },
        amp: { attack: 0.1, hold: 0.42, decay: 0.3, sustain: 0, release: 0.1, curve: 1.1 },
      }),
      makeLayer({
        gain: 0.6,
        pan: 0.55,
        spread: 0.12,
        source: { kind: 'noise', colour: 'metallic' },
        pitch: { start: 2400, slide: -6, slideCurve: LINEAR, jitter: 20 },
        filterA: { kind: 'highpass', cutoff: 2000, resonance: 0.3 },
        insertA: { kind: 'crusher', place: 'pre', amount: 0.6, bitDepth: 6, crush: 0.25 },
        amp: { attack: 0.02, hold: 0.4, decay: 0.3, sustain: 0, release: 0.1, curve: 1.5 },
      }),
      makeLayer({
        gain: 1.2,
        pan: -0.15,
        spread: 0.45,
        source: { kind: 'noise', colour: 'white' },
        pitch: { start: 6000 },
        filterA: { kind: 'bandpass', cutoff: 4600, resonance: 0.45, envAmount: -2.4, envCurve: EASE_OUT },
        insertA: { kind: 'fold', place: 'pre', amount: 0.5, drive: 0.2 },
        amp: { attack: 0.0004, hold: 0.004, decay: 0.05, sustain: 0, release: 0.03, curve: 3.4 },
      }),
    ], { z: { kind: 'reverb', mode: 'send', mix: 0.16, size: 0.5, damping: 0.45 }, tone: -0.05, width: 0.5 },
       { gain: 0.807263 },
       [
         { enabled: true, shape: 'square', rate: 7.5, depth: 0.35, target: 'layers[0].gain' },
         { enabled: true, shape: 'sine', rate: 2.7, phase: 0.5, depth: 1, target: 'layers[2].pan' },
         { enabled: true, shape: 'noise', rate: 22, depth: 0.6, target: 'layers[2].gain' },
         { enabled: true, shape: 'sine', rate: 0.9, phase: 0.25, depth: 1, target: 'layers[0].pan' },
       ],
       [
         { enabled: true, target: 'layers[0].insertC', depth: 0.85, delay: 0.35, attack: 0.35, hold: 0.2, decay: 0.25, sustain: 0.95, release: 0.2, curve: 1 },
         { enabled: true, target: 'layers[0].insertA', depth: -0.55, delay: 0.15, attack: 0.4, hold: 0.25, decay: 0.2, sustain: 0.95, release: 0.15, curve: 1 },
       ],
       [{
         enabled: true, rate: 3, shape: 'step', bipolar: false, depth: 0.7, target: 'layers[0].insertB', grid: 4,
         patterns: Array.from({ length: 12 }, (_, scene) => (scene === 3 ? stutter : Array.from({ length: 16 }, () => 0))),
         curves: Array.from({ length: 12 }, () => Array.from({ length: 16 }, () => 1)),
       }]),
    scene: 3,
  }
}


/** A strike that arrives as gravel and leaves as a bell, because the phase bending it runs out. */
export function gravelBell(): AudioPatch {
  return {
    ...patch(1.7, [
      // The voice: a table whose phase the noise below it bends, clearing as the bend falls away.
      makeLayer({
        gain: 1.25, spread: 0.3,
        source: { kind: 'table', table: 'bell', position: 0.35, pmFrom: 'layer2', fmIndex: 7.5, fmFall: 0.97, voices: 2, detune: 11 },
        pitch: { start: 165, slide: 5, slideCurve: EASE_OUT, jitter: 10 },
        routing: 'series',
        filterA: { kind: 'comb', cutoff: 165, resonance: 0.38 },
        filterB: { kind: 'lowpass', cutoff: 5200, resonance: 0.25, envAmount: -1.2, envCurve: EASE_OUT },
        amp: { attack: 0.012, hold: 0.05, decay: 0.3, sustain: 0.5, release: 0.35, curve: 2.2 },
      }),
      // The weight underneath, turned back at the rails so it is felt rather than heard.
      makeLayer({
        gain: 0.53, pan: -0.15, spread: 0.2,
        source: { kind: 'tone', wave: 'sine' },
        pitch: { start: 62, slide: -5, slideCurve: EASE_OUT },
        insertA: { kind: 'fold', place: 'pre', amount: 0.5, drive: 0.2 },
        amp: { attack: 0.004, hold: 0.05, decay: 0.5, sustain: 0.12, release: 0.5, curve: 2.8 },
      }),
      // The gravel, turned almost all the way down: the reading is taken before the level, so a
      // layer nobody can hear still bends the phase of the one above it for as long as it runs.
      makeLayer({
        gain: 0.1, pan: 0.2, spread: 0.5,
        source: { kind: 'noise', colour: 'metallic' },
        pitch: { start: 140 },
        filterA: { kind: 'bandpass', cutoff: 900, resonance: 0.5 },
        insertB: { kind: 'ring', place: 'pre', amount: 0.35, ratio: 1.7 },
        amp: { attack: 0.004, hold: 0.4, decay: 0.5, sustain: 0.75, release: 0.5, curve: 1.1 },
      }),
      // The debris: gated by one drawn row, swept by another, rattling a small body.
      makeLayer({
        gain: 0.26, spread: 0.8,
        source: { kind: 'noise', colour: 'white' },
        pitch: { start: 2000 },
        routing: 'series',
        filterA: { kind: 'highpass', cutoff: 700, resonance: 0.45 },
        filterB: { kind: 'lowpass', cutoff: 7000, resonance: 0.3, envAmount: -1.4, envCurve: EASE_OUT },
        insertA: { kind: 'crusher', place: 'pre', amount: 0.45, bitDepth: 5, crush: 0.3 },
        insertC: { kind: 'body', place: 'post', amount: 0.12, frequency: 900, spread: 0.75, decay: 0.3, partials: 4 },
        amp: { attack: 0.004, hold: 0.18, decay: 0.3, sustain: 0.02, release: 0.25, curve: 1.6 },
      }),
    ], {
      x: { kind: 'chorus', mode: 'insert', mix: 0.25, rate: 1.8, depth: 0.55 },
      y: { kind: 'widener', mode: 'insert', mix: 0.5, rate: 0.6, width: 0.55 },
      z: { kind: 'reverb', mode: 'send', mix: 0.16, size: 0.45, damping: 0.6 },
      tone: -0.22, width: 0.75,
    }, { gain: 1.026542, limiter: 1 }, [
      { enabled: true, shape: 'sine', rate: 7, depth: 0.5, target: 'layers[0].pm' },
      { enabled: true, shape: 'noise', rate: 20, depth: 0.4, target: 'layers[2].pitch' },
      { enabled: true, shape: 'triangle', rate: 3, depth: 0.55, target: 'layers[1].insertA' },
      { enabled: true, shape: 'saw', rate: 5, depth: 0.45, target: 'layers[3].pan' },
    ], [
      { enabled: true, target: 'layers[0].pulseWidth', depth: 0.8, attack: 0.01, hold: 0.05, decay: 1.2, sustain: 0, release: 0.3, curve: 1.6 },
      { enabled: true, target: 'layers[3].resonance', depth: 0.6, attack: 0.3, hold: 0.2, decay: 0.6, sustain: 0.3, release: 0.3, curve: 1.2 },
    ], [
      {
        // Two drawn rows alternating through the twelve, so the scene below picks the second of them.
        enabled: true, rate: 4, shape: 'step', bipolar: true, depth: 1, target: 'layers[3].gain',
        patterns: Array.from({ length: 12 }, (_, row) => (row % 2 === 0
          ? [1, 0, 0.55, 0, 1, 0.3, 0, 0.85, 0, 1, 0, 0.5, 0.9, 0, 0.45, 0]
          : [1, 0.5, 0, 1, 0, 0, 0.7, 0, 1, 0, 0.45, 0, 0, 0.9, 0, 0.35])),
      },
      {
        enabled: true, rate: 2, shape: 'line', depth: 0.7, target: 'layers[3].cutoff',
        patterns: Array.from({ length: 12 }, () => [0.2, 0.45, 0.3, 0.7, 0.5, 0.9, 0.6, 1, 0.75, 0.4, 0.55, 0.25, 0.6, 0.35, 0.15, 0.1]),
      },
      {
        enabled: true, rate: 1, shape: 'curve', bipolar: true, depth: 0.8, target: 'layers[0].pan',
        patterns: Array.from({ length: 12 }, () => [0.5, 0.32, 0.14, 0.05, 0.2, 0.45, 0.7, 0.9, 1, 0.86, 0.62, 0.42, 0.3, 0.44, 0.6, 0.55]),
      },
    ]),
    scene: 3,
  }
}


/** Sixteen rungs, a gate at twice the speed and a folder at four times, all read from row three. */
export function prizeLadder(): AudioPatch {
  // Twelfths of an octave, so the rungs are a scale and not sixteen numbers nobody chose.
  const ladder = [0, 0.4167, 0.25, 0.5833, 0.4167, 0.8333, 0.5833, 1, 0.8333, 0.5833, 1, 0.8333, 0.4167, 0.5833, 0.25, 0]
  const strike = [1, 0, 0.75, 0.5, 0, 1, 0.75, 0, 0.5, 1, 0, 0.75, 1, 0, 0.5, 0.75]
  const grit = [0, 0, 0.5, 1, 0.25, 0, 0, 0.5, 1, 0.5, 0, 0, 0.5, 0.75, 0.25, 0]
  // Three rungs slid into and the rest held, which is the glide a step sequencer gives a note.
  const glide = [0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]
  // Every row turned three steps for the next scene, so all twelve are the same figure starting
  // somewhere else, and the patch below plays the fourth of them rather than the one drawn.
  const rows = (row: number[]) => Array.from({ length: 12 }, (_, scene) => row.map((_, at) => row[(at + scene * 3) % 16] ?? 0))
  return {
    ...patch(1.6, [
      makeLayer({
        gain: 1.25,
        pan: 0.45,
        spread: 0.55,
        source: { kind: 'table', table: 'bell', position: 0.45, voices: 2, detune: 7 },
        pitch: { start: 300, jitter: 8 },
        filterA: { kind: 'lowpass', cutoff: 9000, resonance: 0.2, envAmount: -2.4, envCurve: EASE_OUT },
        filterB: { kind: 'highpass', cutoff: 220, resonance: 0.15 },
        routing: 'series',
        amp: { attack: 0.003, hold: 1.4, decay: 0.12, sustain: 1, release: 0.06, curve: 1 },
      }),
      makeLayer({
        gain: 0.45,
        pan: -0.5,
        spread: 0.45,
        source: { kind: 'noise', colour: 'metallic' },
        pitch: { start: 620 },
        filterA: { kind: 'bandpass', cutoff: 2600, resonance: 0.4, envAmount: -1, envCurve: EASE_OUT },
        // Off at rest and turned up by the row: a mechanism that grinds on the beat and not between.
        insertA: { kind: 'fold', place: 'pre', amount: 0, drive: 0.35 },
        amp: { attack: 0.006, hold: 0.35, decay: 0.6, sustain: 0.15, release: 0.2, curve: 1.3 },
      }),
      makeLayer({
        gain: 0.3,
        pan: -0.1,
        offset: 1.05,
        source: { kind: 'tone', wave: 'triangle' },
        pitch: { start: 96, slide: -5, slideCurve: EASE_OUT },
        filterA: { kind: 'lowpass', cutoff: 620, resonance: 0.3 },
        insertC: { kind: 'body', place: 'post', amount: 0.02, frequency: 130, spread: 0.4, decay: 0.22, partials: 3 },
        amp: { attack: 0.002, hold: 0.01, decay: 0.22, sustain: 0, release: 0.12, curve: 2.4 },
      }),
    ], {
      y: { kind: 'delay', mode: 'send', mix: 0.14, time: 0.1, feedback: 0.26 },
      z: { kind: 'reverb', mode: 'send', mix: 0.16, size: 0.45, damping: 0.4 },
      tone: 0.15, width: 0.8,
      // Levelled from the loudest of the twelve rows rather than from the one shipped: at 0.95 the
      // second and the fourth reached the master's clamp, and a scene is meant to be a variation
      // of the sound and not a louder one.
    }, { gain: 0.762851 },
       [
         { enabled: true, shape: 'sine', rate: 0.6, depth: 0.8, target: 'layers[0].pan' },
         { enabled: true, shape: 'sine', rate: 0.6, depth: 0.8, target: 'layers[1].pan' },
       ],
       [{ enabled: true, target: 'layers[0].resonance', depth: 0.5, attack: 0.7, hold: 0.3, decay: 0.4, sustain: 0.6, release: 0.2, curve: 1 }],
       [
         { enabled: true, rate: 1, shape: 'line', bipolar: false, depth: 1, target: 'layers[0].pitch', grid: 0, patterns: rows(ladder), curves: rows(glide) },
         { enabled: true, rate: 2, shape: 'step', bipolar: true, depth: 1, target: 'layers[0].gain', grid: 4, patterns: rows(strike) },
         { enabled: true, rate: 4, shape: 'curve', bipolar: false, depth: 1, target: 'layers[1].insertA', grid: 4, patterns: rows(grit) },
       ]),
    scene: 3,
  }
}

/**
 * A machine agreeing with you, from a machine considerably better than the one asking.
 *
 * Everything the eighties thought the future sounded like is a synthesiser being played: a bright
 * saw through a resonant filter, a pitch sliding down, a note. None of that is here. There is no
 * slide anywhere in this patch, no ring modulator, no arpeggio, and nothing moving fast enough to
 * tap a foot to — the only oscillator in it runs at a fifth of a hertz, half a cycle across the
 * whole sound, which is not a wobble but a room turning.
 *
 * What is here instead is a struck object and the space that answers it. A millisecond and a half
 * of triangle rings a small hard body at nine kilohertz — the ceramic tick, and the whole
 * difference between something expensive and something moulded. Five milliseconds later a second
 * body takes over, tuned at seventeen hundred and spread so far off the harmonic series that
 * nothing in it beats against anything else: no fundamental, so no note, so nothing to hum back.
 * Twenty-two decibels of air in the strike and none of it in the ring, which is the house rule
 * about where brightness belongs, taken as far as it goes.
 *
 * Then the wrong things happen in the wrong order, which is what makes it read as designed rather
 * than as recorded. The weight arrives fifty-five milliseconds *after* the strike, not with it, and
 * it is bent for its first tenth of a second by the ring above it — the phase reading is taken
 * before the level, so what is bending it is the object's own decay. The room answers later still,
 * a pair of formants walked once through a vowel and never back. And all three of those — the room
 * opening, the body blooming, the bend letting go — are one envelope pointed at three places, so
 * it is one gesture with three consequences rather than three things that happen to coincide.
 */
export function coldAssent(): AudioPatch {
  return patch(2.4, [
    // The voice, and it is not a note: three milliseconds of noise into a body spread far off the
    // harmonic series, so what rings has no fundamental for anything to beat against. Five
    // milliseconds behind the tick, which is close enough that two attacks are heard as one.
    makeLayer({
      gain: 0.72, pan: -0.32, spread: 0.5, offset: 0.005,
      source: { kind: 'noise', colour: 'white' },
      pitch: { start: 2000 },
      filterA: { kind: 'highpass', cutoff: 600, resonance: 0.2 },
      insertC: { kind: 'body', place: 'post', amount: 0.42, frequency: 1720, spread: 0.86, decay: 1.9, partials: 6 },
      amp: { attack: 0.0004, hold: 0.003, decay: 0.012, sustain: 0, release: 0.008, curve: 3.2 },
    }),
    // The tick. A triangle rather than a burst of noise, because a resonator this narrow rung by
    // noise has a peak that is a draw rather than a number — the same patch came out a third
    // louder on one machine than another until this stopped being random.
    makeLayer({
      gain: 0.62, pan: 0.15, spread: 0.7,
      source: { kind: 'tone', wave: 'triangle' },
      pitch: { start: 3100 },
      filterA: { kind: 'highpass', cutoff: 3000, resonance: 0.2 },
      insertC: { kind: 'body', place: 'post', amount: 0.92, frequency: 9200, spread: 0.24, decay: 0.09, partials: 3 },
      amp: { attack: 0.0003, hold: 0.0015, decay: 0.008, sustain: 0, release: 0.006, curve: 3.4 },
    }),
    // The room answering, seventy-five milliseconds late. A formant pair walked once, never twice.
    makeLayer({
      gain: 0.4, pan: 0.28, spread: 0.7, offset: 0.075,
      source: { kind: 'noise', colour: 'pink' },
      pitch: { start: 700 },
      routing: 'series',
      filterA: { kind: 'formant', cutoff: 380, resonance: 0.4 },
      filterB: { kind: 'lowpass', cutoff: 6200, resonance: 0.12, envAmount: -1.1, envCurve: EASE_OUT },
      amp: { attack: 0.11, hold: 0.12, decay: 0.55, sustain: 0.2, release: 0.75, curve: 1.3 },
    }),
    // The weight, arriving after the strike rather than with it, folded a little so it has edges
    // without being a note, and bent for its first tenth of a second by the body above it.
    makeLayer({
      gain: 0.34, pan: 0.12, spread: 0.12, offset: 0.055,
      source: { kind: 'tone', wave: 'sine', pmFrom: 'layer0', fmIndex: 2.4, fmFall: 0.9 },
      pitch: { start: 44 },
      filterA: { kind: 'lowpass', cutoff: 260, resonance: 0.1 },
      insertA: { kind: 'fold', place: 'pre', amount: 0.4, drive: 0.08 },
      amp: { attack: 0.03, hold: 0.1, decay: 0.5, sustain: 0.12, release: 0.7, curve: 1.8 },
    }),
  ], {
    // Small and dark: a room, not a hall. A long bright tail is the other thing 1983 did.
    z: { kind: 'reverb', mode: 'send', mix: 0.14, size: 0.3, damping: 0.8 },
    tone: -0.05, width: 0.95,
  }, { gain: 0.310856 },
     [
       // Half a cycle over the whole sound, and the two long things turn opposite ways: the field
       // itself rotates once rather than anything wobbling inside it.
       { enabled: true, shape: 'triangle', rate: 0.21, phase: 0.75, depth: 0.6, target: 'layers[0].pan' },
       { enabled: true, shape: 'triangle', rate: 0.21, phase: 0.25, depth: 0.6, target: 'layers[2].pan' },
     ],
     [
       // One envelope, three places: the room opens, the body blooms, and the bend on the weight
       // lets go. One gesture with three consequences rather than three that coincide.
       {
         enabled: true, delay: 0.03, attack: 0.45, hold: 0.1, decay: 0.8, sustain: 0.12, release: 0.4, curve: 1.4,
         target: 'layers[2].cutoff', depth: 0.5,
         targetB: 'layers[0].insertC', depthB: 0.3,
         targetC: 'layers[3].pm', depthC: -0.35,
       },
     ])
}
