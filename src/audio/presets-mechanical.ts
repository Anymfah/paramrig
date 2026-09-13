import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import { SCENE_COUNT } from './fields.ts'
import { makeLayer, makePatch } from './patch.ts'
import { namedRig } from './presets-signature.ts'
import type { AudioRig } from './rig.ts'
import type { AudioPatch, MacroGestureDestination, Performer } from './types.ts'

// Original synthesis only. No recorded material or external assets are needed by this bank.
// A mechanical event has separate moving parts: a motor, a ratchet, friction and a landing.
// Curved performer rows articulate those parts without discontinuous amplitude steps.
function motion(pattern: number[], routes: Partial<Performer>): Partial<Performer> {
  return {
    enabled: true, rate: 1, shape: 'curve', bipolar: true,
    patterns: Array.from({ length: SCENE_COUNT }, () => [...pattern]),
    ...routes,
  }
}

const destination = (property: string, from: number, to: number): MacroGestureDestination =>
  ({ property, from, to, invert: false, curve: LINEAR })

const control = (label: string, ranges: [string, number, number][]) => ({
  label, value: 0.5, destinations: ranges.map(([property, from, to]) => destination(property, from, to)),
})

/** Three uneven movements followed by a low locking impact. */
export function chassisShift(): AudioPatch {
  return makePatch(1.85, [
    makeLayer({
      gain: 0.62, spread: 0.24,
      source: { kind: 'table', table: 'growl', position: 0.44, voices: 2, detune: 7, fmIndex: 1.4, fmRatio: 2.41, fmFall: 0.15 },
      pitch: { start: 86, slide: -5, slideCurve: EASE_OUT, jitter: 4 },
      filterA: { kind: 'lowpass', cutoff: 2300, resonance: 0.22 },
      insertA: { kind: 'fold', amount: 0.22, drive: 0.16 },
      insertB: { kind: 'comb', amount: 0.2, time: 0.0021, feedback: 0.69 },
      insertC: { kind: 'body', place: 'post', amount: 0.02, frequency: 330, spread: 0.65, decay: 0.09, partials: 4, profile: 'plate' },
      amp: { attack: 0.009, hold: 0.77, decay: 0.32, sustain: 0, release: 0.24, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.27, pan: -0.24, spread: 0.55,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 1200, slide: -9, slideCurve: EASE_OUT },
      routing: 'series',
      filterA: { kind: 'highpass', cutoff: 1800, resonance: 0.13 },
      filterB: { kind: 'lowpass', cutoff: 9800, resonance: 0.08 },
      insertA: { kind: 'crusher', amount: 0.3, bitDepth: 6, crush: 0.12 },
      insertB: { kind: 'comb', amount: 0.2, time: 0.0042, feedback: 0.38 },
      insertC: { kind: 'body', place: 'post', amount: 0.035, frequency: 1900, spread: 0.72, decay: 0.07, partials: 4, profile: 'plate' },
      amp: { attack: 0.002, hold: 0.74, decay: 0.26, sustain: 0, release: 0.18, curve: 2 },
    }),
    makeLayer({
      gain: 0.24, offset: 0.045, pan: 0.23, spread: 0.22,
      source: { kind: 'tone', wave: 'sine', fmIndex: 2.6, fmRatio: 7.13, fmFall: 0.35 },
      pitch: { start: 480, slide: -11, slideCurve: EASE_IN, vibratoRate: 27, vibratoDepth: 0.35 },
      filterA: { kind: 'bandpass', cutoff: 3300, resonance: 0.2 },
      amp: { attack: 0.005, hold: 0.72, decay: 0.3, sustain: 0, release: 0.15, curve: 1.7 },
    }),
    makeLayer({
      gain: 0.72, offset: 0.96, spread: 0,
      source: { kind: 'tone', wave: 'sine', fmIndex: 0.35, fmRatio: 1.49, fmFall: 1 },
      pitch: { start: 74, slide: -12, slideCurve: EASE_OUT },
      filterA: { kind: 'lowpass', cutoff: 600, resonance: 0.08 },
      amp: { attack: 0.003, hold: 0.015, decay: 0.48, sustain: 0, release: 0.18, curve: 2.3 },
    }),
  ], {
    z: { kind: 'reverb', mode: 'send', mix: 0.1, size: 0.28, damping: 0.64 }, width: 0.62, tone: 0.04,
  }, { gain: 0.68, limiter: 0.65, fadeOut: 0.07 }, 4101, [
    { enabled: true, shape: 'triangle', rate: 23, depth: 0.035, target: 'layers[2].pitch', targetB: 'layers[1].cutoff', depthB: 0.14 },
  ], [], [
    motion([0.22, 0.8, 0.28, 0.12, 0.72, 0.95, 0.18, 0.62, 0.1, 0.35, 0.22, 0.12, 0.1, 0.08, 0.06, 0.08], {
      target: 'layers[0].pitch', depth: 0.66, targetB: 'layers[0].pulseWidth', depthB: 0.65,
      targetC: 'layers[2].pitch', depthC: 0.82, targetD: 'layers[0].pm', depthD: 0.18,
    }),
    motion([0, 1, 0.1, 0, 0.82, 0.24, 0, 1, 0.2, 0, 0, 0, 0, 0, 0, 0], {
      target: 'layers[0].gain', depth: 1, targetB: 'layers[1].gain', depthB: 1, targetC: 'layers[2].gain', depthC: 1,
    }),
  ])
}

function chassisShiftRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Mass', [['layers[0].pitch.start', 135, 48], ['layers[3].pitch.start', 96, 44], ['layers[0].insertC.frequency', 520, 180]]),
    control('Mutation', [['performers[0].depth', 0.3, 1], ['performers[0].depthB', 0.3, 0.95], ['performers[0].depthC', 0.5, 1]]),
    control('Friction', [['layers[1].gain', 0.1, 0.43], ['layers[0].insertA.drive', 0.04, 0.28], ['layers[2].source.fmIndex', 1.3, 3.9]]),
    control('Space', [['fx.z.mix', 0.02, 0.18], ['fx.width', 0.35, 0.89]]),
  ])
}

/** Small, quick actuators with a bright ratchet and a final disengagement. */
export function servoSwarm(): AudioPatch {
  return makePatch(1.22, [
    makeLayer({
      gain: 0.47, pan: -0.13, spread: 0.35,
      source: { kind: 'tone', wave: 'sine', fmIndex: 3.2, fmRatio: 5.37, fmFall: 0.12, voices: 2, detune: 11 },
      pitch: { start: 790, slide: -7, slideCurve: EASE_IN, jitter: 7 },
      filterA: { kind: 'highpass', cutoff: 1000, resonance: 0.1 },
      insertB: { kind: 'ring', amount: 0.32, ratio: 1.73 },
      amp: { attack: 0.004, hold: 0.54, decay: 0.26, sustain: 0, release: 0.15, curve: 1.6 },
    }),
    makeLayer({
      gain: 0.36, pan: 0.23, spread: 0.42, offset: 0.025,
      source: { kind: 'table', table: 'serpent', position: 0.6, fmIndex: 0.8, fmRatio: 3.71 },
      pitch: { start: 230, slide: 16, slideCurve: EASE_OUT },
      filterA: { kind: 'bandpass', cutoff: 1700, resonance: 0.24 },
      insertB: { kind: 'comb', amount: 0.22, time: 0.0016, feedback: 0.34 },
      amp: { attack: 0.006, hold: 0.47, decay: 0.27, sustain: 0, release: 0.14, curve: 1.7 },
    }),
    makeLayer({
      gain: 0.21, spread: 0.6,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 5600, jitter: 12 },
      filterA: { kind: 'highpass', cutoff: 7400, resonance: 0.08 },
      insertB: { kind: 'crusher', amount: 0.24, bitDepth: 4, crush: 0.025 },
      amp: { attack: 0.002, hold: 0.42, decay: 0.23, sustain: 0, release: 0.15, curve: 2.4 },
    }),
    makeLayer({
      gain: 0.31, offset: 0.76, pan: 0.08,
      source: { kind: 'tone', wave: 'sine', fmIndex: 4.2, fmRatio: 2.83, fmFall: 1 },
      pitch: { start: 390, slide: -19, slideCurve: EASE_OUT },
      insertC: { kind: 'body', place: 'post', amount: 0.16, frequency: 4300, spread: 0.7, decay: 0.055, partials: 3, profile: 'aether', character: 0.68 },
      amp: { attack: 0.001, hold: 0.006, decay: 0.16, sustain: 0, release: 0.09, curve: 2.8 },
    }),
  ], {
    y: { kind: 'delay', mode: 'send', mix: 0.07, time: 0.027, feedback: 0.15, width: 0.72 },
    z: { kind: 'reverb', mode: 'send', mix: 0.06, size: 0.19, damping: 0.5 }, width: 0.72, tone: 0.08,
  }, { gain: 0.66, limiter: 0.6, fadeOut: 0.045 }, 4102, [
    { enabled: true, shape: 'triangle', rate: 31, target: 'layers[0].gain', depth: 0.92, targetB: 'layers[2].gain', depthB: 0.85 },
    { enabled: true, shape: 'triangle', rate: 19, target: 'layers[1].pm', depth: 0.24 },
  ], [], [
    motion([0.15, 0.85, 0.3, 0.95, 0.1, 0.6, 0.28, 0.8, 0.2, 0.98, 0.35, 0.12, 0.5, 0.18, 0.12, 0.15], {
      target: 'layers[0].pitch', depth: 0.55, targetB: 'layers[1].pitch', depthB: 0.8,
      targetC: 'layers[1].pulseWidth', depthC: 0.7, targetD: 'layers[0].pan', depthD: 0.18,
    }),
  ])
}

function servoSwarmRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Size', [['layers[0].pitch.start', 1250, 500], ['layers[1].pitch.start', 345, 153], ['layers[3].pitch.start', 650, 234]]),
    control('Chatter', [['mods[2].rate', 22, 40], ['mods[3].rate', 10, 28]]),
    control('Teeth', [['layers[0].source.fmIndex', 1.4, 5], ['layers[0].insertB.amount', 0.1, 0.54], ['layers[2].gain', 0.07, 0.35]]),
    control('Space', [['fx.z.mix', 0.01, 0.11], ['fx.y.mix', 0.02, 0.12], ['fx.width', 0.5, 0.94]]),
  ])
}

/** Three vocal shapes above a stable sub, with fast metallic beating inside each syllable. */
export function cyberGrowl(): AudioPatch {
  return makePatch(2.35, [
    makeLayer({
      gain: 0.78, spread: 0.28,
      source: { kind: 'tone', wave: 'sine', voices: 3, detune: 13, fmIndex: 5.8, fmRatio: 2.02, fmFall: 0.18 },
      pitch: { start: 82, slide: -4, slideCurve: EASE_OUT, jitter: 3 },
      routing: 'series',
      filterA: { kind: 'formant', cutoff: 560, resonance: 0.48 },
      filterB: { kind: 'lowpass', cutoff: 5900, resonance: 0.14 },
      insertA: { kind: 'drive', amount: 0.28, drive: 0.18 },
      amp: { attack: 0.014, hold: 1.12, decay: 0.5, sustain: 0.06, release: 0.4, curve: 1.65 },
    }),
    makeLayer({
      gain: 0.21, pan: 0.24, spread: 0.25,
      source: { kind: 'tone', wave: 'sine', pmFrom: 'layer0', fmIndex: 3.2, fmFall: 0.2 },
      pitch: { start: 460, slide: -10, slideCurve: EASE_IN },
      filterA: { kind: 'bandpass', cutoff: 2600, resonance: 0.23 },
      insertC: { kind: 'body', place: 'post', amount: 0.12, frequency: 1160, spread: 0.72, decay: 0.095, partials: 4, profile: 'cavity', character: 0.66 },
      amp: { attack: 0.018, hold: 1.05, decay: 0.45, sustain: 0, release: 0.32, curve: 1.8 },
    }),
    makeLayer({
      gain: 0.16, pan: -0.22, spread: 0.48,
      source: { kind: 'noise', colour: 'pink' },
      routing: 'series',
      filterA: { kind: 'highpass', cutoff: 3200, resonance: 0.08 },
      filterB: { kind: 'lowpass', cutoff: 9300, resonance: 0.06 },
      amp: { attack: 0.024, hold: 0.94, decay: 0.5, sustain: 0, release: 0.35, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.34, spread: 0,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 46, slide: -2, slideCurve: EASE_OUT },
      amp: { attack: 0.04, hold: 0.93, decay: 0.65, sustain: 0, release: 0.38, curve: 1.6 },
    }),
  ], {
    z: { kind: 'reverb', mode: 'send', mix: 0.11, size: 0.4, damping: 0.58 }, tone: 0.03, width: 0.62,
  }, { gain: 0.46, limiter: 0.65, fadeOut: 0.08 }, 4103, [
    { enabled: true, shape: 'triangle', rate: 34, target: 'layers[0].pm', depth: 0.16, targetB: 'layers[1].pitch', depthB: 0.018 },
  ], [], [
    motion([0.1, 0.25, 0.75, 0.92, 0.2, 0.38, 0.83, 0.1, 0.55, 0.95, 0.3, 0.12, 0.18, 0.15, 0.12, 0.1], {
      target: 'layers[0].cutoff', depth: 0.38, targetB: 'layers[0].pm', depthB: 0.42,
      targetC: 'layers[0].pitch', depthC: 0.25, targetD: 'layers[1].pm', depthD: 0.24,
    }),
    motion([0, 0.7, 1, 0.85, 0.08, 0.78, 1, 0.14, 0.76, 1, 0.55, 0.08, 0, 0, 0, 0], {
      target: 'layers[0].gain', depth: 1, targetB: 'layers[1].gain', depthB: 1,
      targetC: 'layers[2].gain', depthC: 1, targetD: 'layers[3].gain', depthD: 0.8,
    }),
  ])
}

function cyberGrowlRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Throat', [['layers[0].pitch.start', 115, 58], ['layers[0].filterA.cutoff', 380, 825], ['layers[3].pitch.start', 58, 36]]),
    control('Mutation', [['performers[0].depth', 0.15, 0.61], ['performers[0].depthB', 0.14, 0.7], ['performers[0].depthC', 0.08, 0.42]]),
    control('Metal', [['layers[1].gain', 0.06, 0.36], ['layers[0].source.fmIndex', 3.4, 8.2], ['mods[2].depth', 0.02, 0.3]]),
    control('Space', [['fx.z.mix', 0.02, 0.2], ['fx.width', 0.38, 0.86]]),
  ])
}

/** A short unstable charge; two delayed layers deliver the collapse together. */
export function reactorCollapse(): AudioPatch {
  return makePatch(2.2, [
    makeLayer({
      gain: 0.48, spread: 0.38,
      source: { kind: 'table', table: 'gate', position: 0.38, fmIndex: 1.35, fmRatio: 2.93, fmFall: 0, voices: 2, detune: 9 },
      pitch: { start: 170, slide: 24, slideCurve: EASE_IN },
      filterA: { kind: 'lowpass', cutoff: 2000, resonance: 0.32 },
      insertB: { kind: 'comb', amount: 0.22, time: 0.0054, feedback: 0.44 },
      amp: { attack: 0.06, hold: 0.66, decay: 0.16, sustain: 0, release: 0.12, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.16, spread: 0.7,
      source: { kind: 'noise', colour: 'white' },
      filterA: { kind: 'bandpass', cutoff: 3400, resonance: 0.23, envAmount: 2.2, envCurve: EASE_IN },
      amp: { attack: 0.5, hold: 0.17, decay: 0.21, sustain: 0, release: 0.13, curve: 1.3 },
    }),
    makeLayer({
      gain: 0.43, offset: 0.94, spread: 0.65,
      source: { kind: 'noise', colour: 'metallic' },
      pitch: { start: 540, slide: -20, slideCurve: EASE_OUT },
      routing: 'parallel', filterMix: 0.38,
      filterA: { kind: 'lowpass', cutoff: 2000, resonance: 0.13, envAmount: -2.3, envCurve: EASE_OUT },
      filterB: { kind: 'highpass', cutoff: 6100, resonance: 0.08 },
      insertC: { kind: 'body', place: 'post', amount: 0.035, frequency: 220, spread: 0.8, decay: 0.3, partials: 5, profile: 'plate', character: 0.62 },
      amp: { attack: 0.0015, hold: 0.009, decay: 0.55, sustain: 0, release: 0.22, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.8, offset: 0.94, spread: 0,
      source: { kind: 'tone', wave: 'sine', fmIndex: 1.3, fmRatio: 1.37, fmFall: 1 },
      pitch: { start: 92, slide: -20, slideCurve: EASE_OUT },
      filterA: { kind: 'lowpass', cutoff: 700, resonance: 0.08 },
      amp: { attack: 0.003, hold: 0.022, decay: 0.72, sustain: 0, release: 0.25, curve: 2 },
    }),
  ], {
    x: { kind: 'flanger', mix: 0.1, rate: 0.65, depth: 0.3, feedback: 0.18 },
    z: { kind: 'reverb', mode: 'send', mix: 0.13, size: 0.48, damping: 0.64 }, width: 0.7, tone: -0.04,
  }, { gain: 0.6, limiter: 0.72, fadeOut: 0.09 }, 4104, [
    { enabled: true, shape: 'triangle', rate: 17, target: 'layers[0].pm', depth: 0.2, targetB: 'layers[0].gain', depthB: 0.35 },
  ], [], [
    motion([0.1, 0.2, 0.38, 0.3, 0.62, 0.83, 1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1], {
      target: 'layers[0].pitch', depth: 0.92, targetB: 'layers[0].cutoff', depthB: 0.55,
      targetC: 'layers[0].pulseWidth', depthC: 0.8,
    }),
  ])
}

function reactorCollapseRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Charge', [['layers[0].source.fmIndex', 0.45, 2.25], ['performers[0].depthB', 0.2, 0.9], ['mods[2].rate', 10, 28.9]]),
    control('Mass', [['layers[3].pitch.start', 126, 67], ['layers[2].insertC.frequency', 340, 142], ['layers[3].gain', 0.5, 1.1]]),
    control('Shrapnel', [['layers[2].filterMix', 0.16, 0.6], ['layers[2].gain', 0.25, 0.61]]),
    control('Space', [['fx.z.mix', 0.03, 0.23], ['fx.z.size', 0.3, 0.66], ['fx.width', 0.45, 0.95]]),
  ])
}

/** A servo wakes first, the motor catches twice, then a metal latch seats over its release. */
export function steelAwakening(): AudioPatch {
  return makePatch(2.8, [
    makeLayer({
      gain: 0.64, offset: 0.12, spread: 0.38,
      source: { kind: 'table', table: 'titan', position: 0.4, voices: 2, detune: 6, fmIndex: 1.1, fmRatio: 1.41, fmFall: 0.12 },
      pitch: { start: 58, slide: 8, slideCurve: EASE_OUT, jitter: 3 },
      filterA: { kind: 'lowpass', cutoff: 2300, resonance: 0.2 },
      insertB: { kind: 'ring', amount: 0.21, ratio: 0.37 },
      insertC: { kind: 'body', place: 'post', amount: 0.015, frequency: 250, spread: 0.65, decay: 0.17, partials: 4, profile: 'cavity' },
      amp: { attack: 0.18, hold: 1.05, decay: 0.6, sustain: 0.025, release: 0.48, curve: 1.5 },
    }),
    makeLayer({
      gain: 0.27, pan: 0.24,
      source: { kind: 'tone', wave: 'sine', fmIndex: 3.2, fmRatio: 4.73, fmFall: 0.7 },
      pitch: { start: 670, slide: -19, slideCurve: EASE_OUT },
      filterA: { kind: 'bandpass', cutoff: 2800, resonance: 0.16 },
      amp: { attack: 0.004, hold: 0.09, decay: 0.44, sustain: 0, release: 0.15, curve: 1.8 },
    }),
    makeLayer({
      gain: 0.19, offset: 0.24, pan: -0.24, spread: 0.7,
      source: { kind: 'noise', colour: 'pink' },
      routing: 'series',
      filterA: { kind: 'highpass', cutoff: 1900, resonance: 0.1 },
      filterB: { kind: 'lowpass', cutoff: 8200, resonance: 0.08 },
      insertB: { kind: 'comb', amount: 0.2, time: 0.0037, feedback: 0.31 },
      amp: { attack: 0.12, hold: 0.9, decay: 0.6, sustain: 0, release: 0.35, curve: 1.4 },
    }),
    makeLayer({
      gain: 0.35, offset: 0.91, pan: 0.06,
      source: { kind: 'tone', wave: 'sine', fmIndex: 4.5, fmRatio: 3.17, fmFall: 0.9 },
      pitch: { start: 155, slide: -6, slideCurve: EASE_OUT },
      insertC: { kind: 'body', place: 'post', amount: 0.035, frequency: 1250, spread: 0.76, decay: 0.18, partials: 5, profile: 'plate', character: 0.55 },
      amp: { attack: 0.002, hold: 0.012, decay: 0.34, sustain: 0, release: 0.24, curve: 2.1 },
    }),
  ], {
    z: { kind: 'reverb', mode: 'send', mix: 0.13, size: 0.42, damping: 0.62 }, width: 0.66, tone: -0.04,
  }, { gain: 0.7, limiter: 0.65, fadeOut: 0.1 }, 4105, [
    { enabled: true, shape: 'triangle', rate: 14, target: 'layers[0].pm', depth: 0.14, targetB: 'layers[2].cutoff', depthB: 0.13 },
  ], [], [
    motion([0.18, 0.34, 0.85, 0.14, 0.44, 0.93, 0.6, 0.82, 0.52, 0.25, 0.4, 0.32, 0.24, 0.2, 0.18, 0.18], {
      target: 'layers[0].pulseWidth', depth: 0.64, targetB: 'layers[0].pitch', depthB: 0.55,
      targetC: 'layers[0].cutoff', depthC: 0.38, targetD: 'layers[2].cutoff', depthD: 0.18,
    }),
    motion([0.12, 0.62, 1, 0.14, 0.72, 1, 0.85, 0.6, 0.82, 0.56, 0.22, 0.08, 0, 0, 0, 0.12], {
      target: 'layers[0].gain', depth: 0.9, targetB: 'layers[2].gain', depthB: 1,
    }),
  ])
}

function steelAwakeningRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    control('Mass', [['layers[0].pitch.start', 82, 41], ['layers[3].pitch.start', 230, 104], ['layers[0].insertC.frequency', 390, 160]]),
    control('Strain', [['layers[0].source.fmIndex', 0.3, 1.9], ['layers[0].insertB.amount', 0.05, 0.37], ['performers[0].depthB', 0.2, 0.9]]),
    control('Friction', [['layers[2].gain', 0.04, 0.34], ['mods[2].rate', 8, 24.5], ['layers[1].source.fmIndex', 1.6, 4.8]]),
    control('Space', [['fx.z.mix', 0.03, 0.23], ['fx.width', 0.4, 0.92]]),
  ])
}

export const MECHANICAL_PRESETS = [
  { id: 'chassis-shift', label: 'Chassis Shift', build: chassisShift, rig: chassisShiftRig },
  { id: 'servo-swarm', label: 'Servo Swarm', build: servoSwarm, rig: servoSwarmRig },
  { id: 'cyber-growl', label: 'Cyber Growl', build: cyberGrowl, rig: cyberGrowlRig },
  { id: 'reactor-collapse', label: 'Reactor Collapse', build: reactorCollapse, rig: reactorCollapseRig },
  { id: 'steel-awakening', label: 'Steel Awakening', build: steelAwakening, rig: steelAwakeningRig },
]
