import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import { SCENE_COUNT } from './fields.ts'
import { makeLayer, makePatch } from './patch.ts'
import { namedRig } from './presets-signature.ts'
import type { AudioRig } from './rig.ts'
import type { AudioPatch, MacroGestureDestination, Performer } from './types.ts'

/**
 * Five sounds refined from the rebuilt Randomize, kept as library entries so the button's
 * range is audible without rolling the dice. Each comment names the family seed it started from.
 */

function motion(pattern: number[], routes: Partial<Performer>): Partial<Performer> {
  return {
    enabled: true, rate: 1, shape: 'curve', bipolar: true,
    patterns: Array.from({ length: SCENE_COUNT }, () => [...pattern]),
    ...routes,
  }
}

const destination = (property: string, from: number, to: number): MacroGestureDestination =>
  ({ property, from, to, invert: false, curve: LINEAR })

const control = (label: string, value: number, ranges: [string, number, number][]) => ({
  label, value, destinations: ranges.map(([property, from, to]) => destination(property, from, to)),
})

/** Mechanical, seed 4108: start, ratchets, a run-up, then the lock seats. */
export function axleLock(): AudioPatch {
  return makePatch(2.15, [
    makeLayer({
      gain: 0.28, spread: 0.26,
      source: { kind: 'table', table: 'titan', position: 0.34, voices: 2, detune: 7, fmIndex: 1.35, fmRatio: 2.01, fmFall: 0.16 },
      pitch: { start: 64, slide: 8, slideCurve: EASE_OUT, jitter: 4 },
      filterA: { kind: 'lowpass', cutoff: 2100, resonance: 0.2, envAmount: -1.3, envCurve: EASE_OUT },
      insertA: { kind: 'fold', amount: 0.1, drive: 0.1 },
      insertC: { kind: 'body', place: 'post', amount: 0.06, frequency: 210, spread: 0.48, decay: 0.12, partials: 4, profile: 'plate' },
      amp: { attack: 0.014, hold: 0.92, decay: 0.48, sustain: 0.02, release: 0.2, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.12, pan: -0.22, spread: 0.52,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 2400, slide: -9, slideCurve: EASE_OUT },
      routing: 'series',
      filterA: { kind: 'highpass', cutoff: 1700, resonance: 0.12 },
      filterB: { kind: 'lowpass', cutoff: 9200, resonance: 0.08 },
      insertB: { kind: 'comb', amount: 0.1, time: 0.0032, feedback: 0.22 },
      amp: { attack: 0.002, hold: 0.86, decay: 0.38, sustain: 0, release: 0.14, curve: 2 },
    }),
    makeLayer({
      gain: 0.12, offset: 0.48, pan: 0.26,
      source: { kind: 'tone', wave: 'sine', fmIndex: 2.8, fmRatio: 7.13, fmFall: 0.38 },
      pitch: { start: 540, slide: -12, slideCurve: EASE_IN },
      filterA: { kind: 'bandpass', cutoff: 3000, resonance: 0.22 },
      amp: { attack: 0.005, hold: 0.62, decay: 0.32, sustain: 0, release: 0.12, curve: 1.8 },
    }),
    makeLayer({
      gain: 0.34, offset: 0.96, spread: 0,
      source: { kind: 'tone', wave: 'sine', fmIndex: 0.38, fmRatio: 1.49, fmFall: 1 },
      pitch: { start: 58, slide: -11, slideCurve: EASE_OUT },
      filterA: { kind: 'lowpass', cutoff: 560, resonance: 0.1 },
      insertC: { kind: 'body', place: 'post', amount: 0.12, frequency: 160, spread: 0.28, decay: 0.14, partials: 4, profile: 'bar' },
      amp: { attack: 0.002, hold: 0.014, decay: 0.36, sustain: 0, release: 0.16, curve: 2.3 },
    }),
  ], {
    z: { kind: 'reverb', mode: 'send', mix: 0.11, size: 0.32, damping: 0.62 }, width: 0.58, tone: 0.05,
  }, { gain: 0.24, limiter: 0.68, fadeOut: 0.07 }, 4108, [
    { enabled: true, shape: 'triangle', rate: 21, depth: 0.04, target: 'layers[2].pitch', targetB: 'layers[1].cutoff', depthB: 0.12 },
  ], [], [
    motion([0.2, 0.78, 0.3, 0.14, 0.7, 0.94, 0.22, 0.6, 0.12, 0.36, 0.2, 0.12, 0.1, 0.08, 0.06, 0.08], {
      target: 'layers[0].pitch', depth: 0.6, targetB: 'layers[0].pm', depthB: 0.22, targetC: 'layers[2].pitch', depthC: 0.72,
    }),
    motion([0, 1, 0.12, 0, 0.8, 0.22, 0, 1, 0.18, 0, 0, 0, 0, 0, 0, 0], {
      target: 'layers[0].gain', depth: 0.45, targetB: 'layers[1].gain', depthB: 0.55, targetC: 'layers[2].gain', depthC: 0.55, shape: 'step',
    }),
  ])
}

function axleLockRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Mass', 0.5, [['layers[0].pitch.start', 92, 48], ['layers[3].pitch.start', 84, 46], ['layers[0].insertC.frequency', 320, 140]]),
    control('Ratchet', 0.5, [['layers[1].gain', 0.08, 0.4], ['performers[1].depth', 0.4, 1]]),
    control('Strain', 0.45, [['layers[0].source.fmIndex', 0.4, 2.2], ['layers[2].source.fmIndex', 1.4, 4.2]]),
    control('Room', 0.4, [['fx.z.mix', 0.04, 0.22], ['fx.width', 0.4, 0.85]]),
  ])
}

/** Organic / digital, seed 7721: a robot throat that opens, then bites. */
export function servoGrowl(): AudioPatch {
  return makePatch(1.85, [
    makeLayer({
      gain: 0.32, spread: 0.24,
      source: { kind: 'table', table: 'growl', position: 0.42, voices: 2, detune: 8, fmIndex: 1.35, fmRatio: 1.5, fmFall: 0.18 },
      pitch: { start: 78, slide: 5, slideCurve: EASE_OUT, vibratoRate: 6.2, vibratoDepth: 0.28, jitter: 5 },
      routing: 'parallel',
      filterA: { kind: 'lowpass', cutoff: 1600, resonance: 0.28, envAmount: -1.6, envCurve: EASE_OUT },
      filterB: { kind: 'formant', cutoff: 420, resonance: 0.48, envAmount: 1.1, envCurve: EASE_IN },
      filterMix: 0.32,
      insertA: { kind: 'drive', amount: 0.16, drive: 0.16 },
      insertC: { kind: 'body', place: 'post', amount: 0.06, frequency: 160, spread: 0.38, decay: 0.16, partials: 3, profile: 'cavity' },
      amp: { attack: 0.04, hold: 0.48, decay: 0.62, sustain: 0.08, release: 0.18, curve: 1.55 },
    }),
    makeLayer({
      gain: 0.2, pan: 0.2, offset: 0.08,
      source: { kind: 'noise', colour: 'pink' },
      filterA: { kind: 'bandpass', cutoff: 880, resonance: 0.22 },
      amp: { attack: 0.05, hold: 0.4, decay: 0.7, sustain: 0, release: 0.14, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.32, spread: 0,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 46, slide: -8, slideCurve: EASE_OUT },
      filterA: { kind: 'lowpass', cutoff: 280, resonance: 0.08 },
      amp: { attack: 0.03, hold: 0.5, decay: 0.7, sustain: 0, release: 0.2, curve: 2 },
    }),
  ], {
    x: { kind: 'chorus', mode: 'insert', mix: 0.1, rate: 0.32, depth: 0.38 },
    z: { kind: 'reverb', mode: 'send', mix: 0.08, size: 0.34, damping: 0.7 },
    width: 0.48, tone: -0.1,
  }, { gain: 0.58, limiter: 0.66, fadeOut: 0.06 }, 7721, [
    { enabled: true, shape: 'sine', rate: 5.4, depth: 0.16, target: 'layers[0].pm', targetB: 'layers[0].cutoff', depthB: 0.14 },
  ], [
    { enabled: true, attack: 0.1, decay: 0.9, sustain: 0.08, release: 0.14, depth: -0.38, target: 'layers[0].cutoff' },
  ])
}

function servoGrowlRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Throat', 0.5, [['layers[0].source.position', 0.18, 0.72], ['layers[0].filterMix', 0.12, 0.55]]),
    control('Grit', 0.45, [['layers[0].source.fmIndex', 0.8, 3.2], ['layers[0].insertA.drive', 0.1, 0.5]]),
    control('Body', 0.5, [['layers[2].pitch.start', 68, 34], ['layers[0].insertC.frequency', 240, 110]]),
    control('Air', 0.35, [['layers[1].gain', 0.06, 0.34], ['fx.z.mix', 0.03, 0.2]]),
  ])
}

/** Metallic, seed 3344: a measured assembly of bright contacts. */
export function rivetJoin(): AudioPatch {
  return makePatch(0.92, [
    makeLayer({
      gain: 0.26,
      source: { kind: 'noise', colour: 'metallic' },
      filterA: { kind: 'highpass', cutoff: 2600, resonance: 0.16, envAmount: -1.7, envCurve: EASE_OUT },
      insertA: { kind: 'drive', place: 'pre', amount: 0.24, drive: 0.1 },
      insertC: { kind: 'body', place: 'post', amount: 0.12, frequency: 2100, spread: 0.4, decay: 0.05, partials: 4, profile: 'aether', character: 0.58 },
      amp: { attack: 0.0007, hold: 0.007, decay: 0.06, sustain: 0, release: 0.04, curve: 2.7 },
    }),
    makeLayer({
      gain: 0.28, spread: 0.3,
      source: { kind: 'tone', wave: 'sine', fmIndex: 1.8, fmRatio: 3.17, fmFall: 0.72 },
      pitch: { start: 312, slide: -6, slideCurve: EASE_OUT, jitter: 5 },
      filterA: { kind: 'lowpass', cutoff: 4200, resonance: 0.22, envAmount: -1.5, envCurve: EASE_OUT },
      insertC: { kind: 'body', place: 'post', amount: 0.16, frequency: 312, spread: 0.28, decay: 0.16, partials: 4, profile: 'plate', character: 0.6 },
      amp: { attack: 0.0014, hold: 0.012, decay: 0.4, sustain: 0, release: 0.14, curve: 2.1 },
    }),
    makeLayer({
      gain: 0.2, pan: 0.28, offset: 0.05,
      source: { kind: 'table', table: 'bell', position: 0.38, voices: 2, detune: 8 },
      pitch: { start: 624, slide: -4, slideCurve: EASE_OUT },
      filterA: { kind: 'notch', cutoff: 940, resonance: 0.16 },
      amp: { attack: 0.004, hold: 0.02, decay: 0.32, sustain: 0, release: 0.12, curve: 1.8 },
    }),
  ], {
    z: { kind: 'reverb', mode: 'send', mix: 0.14, size: 0.4, damping: 0.46 }, width: 0.68, tone: 0.08,
  }, { gain: 0.32, limiter: 0.7, fadeOut: 0.04 }, 3344, [], [
    { enabled: true, attack: 0.01, decay: 0.36, sustain: 0, release: 0.08, depth: 0.32, target: 'layers[1].pm' },
  ])
}

function rivetJoinRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Strike', 0.4, [['layers[0].gain', 0.1, 0.42], ['layers[0].insertC.amount', 0.12, 0.55]]),
    control('Ring', 0.5, [['layers[1].insertC.decay', 0.08, 0.45], ['layers[1].source.fmIndex', 1.6, 4.6]]),
    control('Tune', 0.5, [['layers[1].pitch.start', 420, 220], ['layers[1].insertC.frequency', 420, 220]]),
    control('Hall', 0.4, [['fx.z.mix', 0.04, 0.28], ['fx.z.size', 0.22, 0.62]]),
  ])
}

/** Digital, seed 9012: a packed data dump with stepped gain and a folded carrier. */
export function rasterBurst(): AudioPatch {
  return makePatch(1.28, [
    makeLayer({
      gain: 0.56, spread: 0.52,
      source: { kind: 'table', table: 'ion', position: 0.58, voices: 3, detune: 14 },
      pitch: { start: 186, slide: 7, slideCurve: EASE_IN, arpeggioRatio: 1.5, arpeggioAt: 0.38, jitter: 11 },
      filterA: { kind: 'ladder', cutoff: 3800, resonance: 0.3, envAmount: -1.6, envCurve: EASE_OUT },
      insertA: { kind: 'crusher', amount: 0.28, bitDepth: 6, crush: 0.22 },
      insertB: { kind: 'fold', amount: 0.16, drive: 0.2 },
      amp: { attack: 0.004, hold: 0.16, decay: 0.52, sustain: 0.1, release: 0.1, curve: 1.8 },
    }),
    makeLayer({
      gain: 0.22, pan: -0.42, spread: 0.68,
      source: { kind: 'tone', wave: 'saw', pulseWidth: 0.32, pmFrom: 'layer0', fmIndex: 1.35, fmRatio: 2.02 },
      pitch: { start: 372, slide: 5, slideCurve: LINEAR },
      filterA: { kind: 'formant', cutoff: 740, resonance: 0.38, envAmount: 1.6, envCurve: EASE_IN },
      amp: { attack: 0.02, hold: 0.28, decay: 0.4, sustain: 0, release: 0.1, curve: 1.6 },
    }),
    makeLayer({
      gain: 0.16, pan: 0.35,
      source: { kind: 'noise', colour: 'white' },
      filterA: { kind: 'highpass', cutoff: 3200, resonance: 0.18, envAmount: -1.2, envCurve: EASE_OUT },
      amp: { attack: 0.0008, hold: 0, decay: 0.05, sustain: 0, release: 0.02, curve: 2.8 },
    }),
  ], {
    x: { kind: 'phaser', mode: 'insert', mix: 0.16, rate: 1.1, depth: 0.5, feedback: 0.32 },
    y: { kind: 'delay', mode: 'send', mix: 0.11, time: 0.09, feedback: 0.26 },
    width: 0.8, tone: 0.14,
  }, { gain: 2.1, limiter: 0.7, fadeOut: 0.03 }, 9012, [
    { enabled: true, shape: 'saw', rate: 11, depth: 0.2, target: 'layers[0].cutoff', targetB: 'layers[0].pulseWidth', depthB: 0.28 },
  ], [], [
    motion([1, 0.15, 0.9, 0.1, 1, 0.2, 0.85, 0.12, 0.7, 0.08, 0.4, 0.05, 0.2, 0.04, 0.08, 0.02], {
      target: 'layers[0].gain', depth: 0.72, targetB: 'layers[1].pm', depthB: 0.42, shape: 'step', rate: 2,
    }),
  ])
}

function rasterBurstRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Clock', 0.5, [['layers[0].pitch.start', 260, 120], ['layers[0].pitch.arpeggioRatio', 1, 2.2]]),
    control('Aliasing', 0.5, [['layers[0].insertA.crush', 0.05, 0.5], ['layers[0].insertA.bitDepth', 10, 4]]),
    control('Fold', 0.4, [['layers[0].insertB.amount', 0.04, 0.4], ['layers[1].source.fmIndex', 0.4, 2.6]]),
    control('Scatter', 0.45, [['fx.x.mix', 0.04, 0.32], ['fx.y.mix', 0.04, 0.24], ['fx.width', 0.5, 0.95]]),
  ])
}

/** Atmospheric, seed 5560: a long fall that loses its top and keeps the mass. */
export function hullBreach(): AudioPatch {
  return makePatch(3.15, [
    makeLayer({
      gain: 0.32, spread: 0.18,
      source: { kind: 'tone', wave: 'sine', fmIndex: 1.1, fmRatio: 2.11, fmFall: 0.14 },
      pitch: { start: 54, slide: -14, slideCurve: EASE_IN, jitter: 3 },
      filterA: { kind: 'lowpass', cutoff: 820, resonance: 0.22, envAmount: -3.1, envCurve: EASE_IN },
      insertC: { kind: 'body', place: 'post', amount: 0.08, frequency: 82, spread: 0.52, decay: 0.32, partials: 3, profile: 'cavity' },
      amp: { attack: 0.1, hold: 0.48, decay: 1.55, sustain: 0.04, release: 0.4, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.16, spread: 0.74, offset: 0.35,
      source: { kind: 'noise', colour: 'pink' },
      filterA: { kind: 'lowpass', cutoff: 1600, resonance: 0.1, envAmount: -2.4, envCurve: EASE_IN },
      insertA: { kind: 'drive', amount: 0.18, drive: 0.16 },
      amp: { attack: 0.16, hold: 0.3, decay: 1.4, sustain: 0, release: 0.32, curve: 1.3 },
    }),
    makeLayer({
      gain: 0.22, pan: 0.28, offset: 0.92,
      source: { kind: 'table', table: 'titan', position: 0.62, fmIndex: 1.2, fmRatio: 3.5, fmFall: 0.48 },
      pitch: { start: 210, slide: -18, slideCurve: EASE_IN },
      filterA: { kind: 'bandpass', cutoff: 1300, resonance: 0.28 },
      amp: { attack: 0.05, hold: 0.08, decay: 0.9, sustain: 0, release: 0.24, curve: 1.7 },
    }),
  ], {
    y: { kind: 'delay', mode: 'send', mix: 0.1, time: 0.24, feedback: 0.34 },
    z: { kind: 'reverb', mode: 'send', mix: 0.22, size: 0.84, damping: 0.4 },
    width: 0.7, tone: -0.16,
  }, { gain: 0.35, limiter: 0.72, fadeOut: 0.14 }, 5560, [], [
    { enabled: true, delay: 0.62, attack: 0.06, decay: 1.4, sustain: 0, release: 0.22, depth: 0.5, target: 'layers[0].pm' },
  ], [
    motion([0.7, 0.72, 0.6, 0.55, 0.4, 0.32, 0.22, 0.18, 0.4, 0.7, 0.45, 0.2, 0.12, 0.08, 0.05, 0.04], {
      target: 'layers[0].gain', depth: 0.28, targetB: 'layers[2].gain', depthB: 0.4, shape: 'line',
    }),
  ])
}

function hullBreachRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Fall', 0.5, [['layers[0].pitch.start', 78, 36], ['layers[0].pitch.slide', -6, -22]]),
    control('Pressure', 0.5, [['layers[0].source.fmIndex', 0.6, 2.8], ['layers[0].filterA.envAmount', -1.6, -4.4]]),
    control('Debris', 0.4, [['layers[2].gain', 0.06, 0.4], ['layers[1].gain', 0.12, 0.48]]),
    control('Void', 0.55, [['fx.z.mix', 0.14, 0.5], ['fx.z.size', 0.5, 0.95], ['fx.width', 0.45, 0.9]]),
  ])
}

export const DRAWN_PRESETS = [
  { id: 'axle-lock', label: 'Axle Lock', build: axleLock, rig: axleLockRig },
  { id: 'servo-growl', label: 'Servo Growl', build: servoGrowl, rig: servoGrowlRig },
  { id: 'rivet-join', label: 'Rivet Join', build: rivetJoin, rig: rivetJoinRig },
  { id: 'raster-burst', label: 'Raster Burst', build: rasterBurst, rig: rasterBurstRig },
  { id: 'hull-breach', label: 'Hull Breach', build: hullBreach, rig: hullBreachRig },
]
