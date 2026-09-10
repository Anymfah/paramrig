import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import { TABLE_NAMES } from './dsp/wavetable.ts'
import { SCENE_COUNT, STEP_COUNT } from './fields.ts'
import { makeLayer, makePatch, silentLayer } from './patch.ts'
import { between, chance, clamp, logBetween, pick } from './shuffle-draw.ts'
import type { AmpSettings, AudioPatch, FilterKind, Layer, ModSlot, NoiseColour, Performer, WaveShape } from './types.ts'

export const SOUND_FAMILIES = ['mechanical', 'metallic', 'digital', 'organic', 'atmospheric', 'impact'] as const
export type SoundFamily = typeof SOUND_FAMILIES[number]
export type RandomFamily = 'any' | SoundFamily

type Rng = () => number

const WAVES: WaveShape[] = ['sine', 'triangle', 'saw', 'square']
const COLOURS: NoiseColour[] = ['white', 'pink', 'metallic']
const TABLES = TABLE_NAMES.filter((name) => !name.startsWith('user:'))
const BODIES = ['bar', 'plate', 'cavity', 'membrane', 'glass', 'aether'] as const

const amp = (attack: number, hold: number, decay: number, sustain: number, release: number, curve = 2): AmpSettings => ({
  attack, hold, decay, sustain, release, curve,
})

/** Keep an envelope inside the time the layer actually has. */
function fitAmp(available: number, shape: AmpSettings): AmpSettings {
  const room = Math.max(0.04, available)
  const total = shape.attack + shape.hold + shape.decay + shape.release
  if (total <= room) return shape
  const scale = room / total
  return {
    ...shape,
    attack: shape.attack * scale,
    hold: shape.hold * scale,
    decay: shape.decay * scale,
    release: shape.release * scale,
  }
}

function tableOf(random: Rng, prefer: readonly string[] = TABLES): string {
  const names = prefer.filter((name) => TABLES.includes(name))
  return pick(random, names.length ? names : TABLES)
}

function cutoffFor(random: Rng, kind: FilterKind, note: number): number {
  const hold = (value: number) => clamp(value, 30, 19000)
  if (note <= 0) return kind === 'ladder' ? logBetween(random, 1600, 16000) : logBetween(random, 400, 14000)
  if (kind === 'highpass') return hold(logBetween(random, note * 0.12, note * 1.25))
  if (kind === 'ladder') return hold(logBetween(random, note * 2.4, note * 16))
  if (kind === 'lowpass') return hold(logBetween(random, note * 1.5, note * 12))
  if (kind === 'formant') return hold(logBetween(random, note * 0.8, note * 6))
  return hold(logBetween(random, note * 0.55, note * 6))
}

function noiseBurst(random: Rng, available: number, colour: NoiseColour, cutoff: number, gain: number): Layer {
  return makeLayer({
    gain,
    source: { kind: 'noise', colour },
    pitch: { start: logBetween(random, 800, 5000) },
    filterA: { kind: 'highpass', cutoff, resonance: between(random, 0, 0.28), envAmount: between(random, -2.2, -0.4), envCurve: EASE_OUT },
    amp: fitAmp(available, amp(0.0006, 0, between(random, 0.012, 0.07), 0, 0.018, 2.8)),
  })
}

function sineBody(random: Rng, available: number, start: number, gain: number): Layer {
  return makeLayer({
    gain,
    spread: 0,
    source: { kind: 'tone', wave: 'sine' },
    pitch: { start, slide: between(random, -14, -3), slideCurve: EASE_OUT },
    filterA: { kind: 'lowpass', cutoff: cutoffFor(random, 'lowpass', start), resonance: between(random, 0, 0.18) },
    amp: fitAmp(available, amp(0.002, 0.012, between(random, 0.12, Math.min(0.55, available * 0.5)), 0, between(random, 0.05, 0.22), 2.2)),
  })
}

function rows(pattern: number[]): number[][] {
  return Array.from({ length: SCENE_COUNT }, () => [...pattern])
}

function steps(random: Rng, accents: number[]): number[] {
  return Array.from({ length: STEP_COUNT }, (_, index) => {
    const accent = accents.includes(index) ? between(random, 0.72, 1) : between(random, 0.04, 0.28)
    return clamp(accent, 0, 1)
  })
}

function performer(pattern: number[], extra: Partial<Performer> = {}): Partial<Performer> {
  return {
    enabled: true,
    rate: 1,
    shape: 'curve',
    bipolar: true,
    patterns: rows(pattern),
    ...extra,
  }
}

function later(seconds: number): number {
  return clamp(seconds, 0, 1)
}

function stageOffsets(duration: number, count: number, random: Rng): number[] {
  if (count <= 1) return [0]
  const marks = [0]
  const cap = Math.min(1, duration * 0.9)
  for (let i = 1; i < count; i += 1) {
    const centre = (i / count) * Math.min(duration, 1) * 0.82
    marks.push(clamp(centre + between(random, -0.04, 0.05), 0, cap))
  }
  return marks.sort((a, b) => a - b)
}

type Built = {
  duration: number
  layers: Layer[]
  fx?: Parameters<typeof makePatch>[2]
  master?: Parameters<typeof makePatch>[3]
  seed: number
  lfos?: Partial<ModSlot>[]
  envelopes?: Partial<ModSlot>[]
  performers?: Partial<Performer>[]
}

function patchOf(built: Built): AudioPatch {
  const layers = Array.from({ length: 4 }, (_, index) => built.layers[index] ?? silentLayer())
  return makePatch(built.duration, layers, built.fx ?? {}, built.master ?? { gain: 1.1, limiter: 0.72, fadeOut: 0.02 }, built.seed, built.lfos ?? [], built.envelopes ?? [], built.performers ?? [])
}

/** Mechanical: start, moving parts, acceleration, lock, residual ring. */
function mechanicalRatchet(random: Rng, seed: number): Built {
  const duration = logBetween(random, 1.15, 2.8)
  const marks = stageOffsets(duration, 4, random)
  const motor = logBetween(random, 48, 92)
  const click = logBetween(random, 1400, 4200)
  const pattern = steps(random, [1, 4, 7, 10, 13])
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: between(random, 0.5, 0.72), spread: 0.28,
        source: { kind: 'table', table: tableOf(random, ['growl', 'titan', 'stack']), position: between(random, 0.2, 0.55), voices: 2, detune: between(random, 5, 12), fmIndex: between(random, 0.6, 1.8), fmRatio: pick(random, [1.41, 2.01, 2.47]), fmFall: 0.18 },
        pitch: { start: motor, slide: between(random, 4, 11), slideCurve: EASE_OUT, jitter: 4 },
        filterA: { kind: 'lowpass', cutoff: cutoffFor(random, 'lowpass', motor), resonance: 0.2, envAmount: -1.4, envCurve: EASE_OUT },
        insertA: { kind: 'fold', amount: between(random, 0.12, 0.28), drive: 0.16 },
        insertC: { kind: 'body', place: 'post', amount: 0.08, frequency: motor * 3.2, spread: 0.55, decay: 0.12, partials: 4, profile: 'plate' },
        amp: fitAmp(duration, amp(0.012, duration * 0.42, duration * 0.22, 0.02, 0.18, 1.5)),
      }),
      makeLayer({
        gain: between(random, 0.18, 0.32), pan: -0.22, spread: 0.5,
        source: { kind: 'noise', colour: 'metallic' },
        pitch: { start: click, slide: -8, slideCurve: EASE_OUT },
        routing: 'series',
        filterA: { kind: 'highpass', cutoff: 1600, resonance: 0.12 },
        filterB: { kind: 'lowpass', cutoff: 9800, resonance: 0.08 },
        insertB: { kind: 'comb', amount: 0.18, time: 0.0034, feedback: 0.42 },
        amp: fitAmp(duration, amp(0.002, duration * 0.4, duration * 0.18, 0, 0.12, 2)),
      }),
      makeLayer({
        gain: between(random, 0.16, 0.28), offset: later(marks[1] ?? 0), pan: 0.24,
        source: { kind: 'tone', wave: 'sine', fmIndex: between(random, 1.8, 3.4), fmRatio: 7.13, fmFall: 0.4 },
        pitch: { start: logBetween(random, 380, 720), slide: -12, slideCurve: EASE_IN },
        filterA: { kind: 'bandpass', cutoff: 2800, resonance: 0.22 },
        amp: fitAmp(duration - marks[1]!, amp(0.004, duration * 0.28, duration * 0.16, 0, 0.1, 1.8)),
      }),
      makeLayer({
        gain: between(random, 0.55, 0.78), offset: later(marks[3] ?? 0), spread: 0,
        source: { kind: 'tone', wave: 'sine', fmIndex: 0.4, fmRatio: 1.5, fmFall: 1 },
        pitch: { start: motor * 0.85, slide: -11, slideCurve: EASE_OUT },
        filterA: { kind: 'lowpass', cutoff: 620, resonance: 0.1 },
        insertC: { kind: 'body', place: 'post', amount: 0.22, frequency: motor * 2.4, spread: 0.3, decay: 0.16, partials: 4, profile: 'bar' },
        amp: fitAmp(duration - marks[3]!, amp(0.002, 0.012, 0.32, 0, 0.14, 2.3)),
      }),
    ],
    fx: { z: { kind: 'reverb', mode: 'send', mix: 0.1, size: 0.3, damping: 0.62 }, width: 0.58, tone: 0.04 },
    master: { gain: 0.7, limiter: 0.68, fadeOut: 0.06 },
    lfos: [{ enabled: true, shape: 'triangle', rate: between(random, 14, 28), depth: 0.04, target: 'layers[2].pitch', targetB: 'layers[1].cutoff', depthB: 0.12 }],
    performers: [
      performer(pattern, { target: 'layers[0].pitch', depth: 0.58, targetB: 'layers[0].pm', depthB: 0.22, targetC: 'layers[2].pitch', depthC: 0.7 }),
      performer(steps(random, [0, 1, 4, 7, 12]), { target: 'layers[0].gain', depth: 0.85, targetB: 'layers[1].gain', depthB: 1, targetC: 'layers[2].gain', depthC: 1, shape: 'step' }),
    ],
  }
}

function mechanicalServo(random: Rng, seed: number): Built {
  const duration = logBetween(random, 1.6, 3.1)
  const marks = stageOffsets(duration, 3, random)
  const mass = logBetween(random, 52, 88)
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: 0.62, offset: later(marks[0] ?? 0), spread: 0.36,
        source: { kind: 'table', table: tableOf(random, ['titan', 'growl']), position: 0.38, voices: 2, detune: 6, fmIndex: 1.1, fmRatio: 1.41, fmFall: 0.12 },
        pitch: { start: mass, slide: between(random, 5, 10), slideCurve: EASE_OUT, jitter: 3 },
        filterA: { kind: 'lowpass', cutoff: 2200, resonance: 0.2 },
        insertB: { kind: 'ring', amount: 0.18, ratio: 0.37 },
        insertC: { kind: 'body', place: 'post', amount: 0.04, frequency: 240, spread: 0.62, decay: 0.16, partials: 4, profile: 'cavity' },
        amp: fitAmp(duration, amp(0.14, duration * 0.38, duration * 0.22, 0.03, 0.32, 1.5)),
      }),
      makeLayer({
        gain: 0.24, pan: 0.22,
        source: { kind: 'tone', wave: 'sine', fmIndex: 3.1, fmRatio: 4.73, fmFall: 0.65 },
        pitch: { start: logBetween(random, 520, 880), slide: -16, slideCurve: EASE_OUT },
        filterA: { kind: 'bandpass', cutoff: 2600, resonance: 0.16 },
        amp: fitAmp(duration, amp(0.004, 0.08, 0.4, 0, 0.14, 1.8)),
      }),
      makeLayer({
        gain: 0.2, offset: later(marks[1] ?? 0), pan: -0.22, spread: 0.68,
        source: { kind: 'noise', colour: 'pink' },
        routing: 'series',
        filterA: { kind: 'highpass', cutoff: 1800, resonance: 0.1 },
        filterB: { kind: 'lowpass', cutoff: 8200, resonance: 0.08 },
        insertB: { kind: 'comb', amount: 0.18, time: 0.0036, feedback: 0.3 },
        amp: fitAmp(duration - marks[1]!, amp(0.1, duration * 0.28, duration * 0.2, 0, 0.22, 1.4)),
      }),
      makeLayer({
        gain: 0.38, offset: later(marks[2] ?? duration * 0.72),
        source: { kind: 'tone', wave: 'sine', fmIndex: 4.2, fmRatio: 3.17, fmFall: 0.88 },
        pitch: { start: mass * 2.1, slide: -7, slideCurve: EASE_OUT },
        insertC: { kind: 'body', place: 'post', amount: 0.05, frequency: 1180, spread: 0.74, decay: 0.16, partials: 5, profile: 'plate', character: 0.55 },
        amp: fitAmp(duration * 0.3, amp(0.002, 0.01, 0.28, 0, 0.18, 2.1)),
      }),
    ],
    fx: { z: { kind: 'reverb', mode: 'send', mix: 0.12, size: 0.4, damping: 0.6 }, width: 0.64, tone: -0.04 },
    master: { gain: 0.72, limiter: 0.66, fadeOut: 0.08 },
    lfos: [{ enabled: true, shape: 'triangle', rate: 14, target: 'layers[0].pm', depth: 0.14, targetB: 'layers[2].cutoff', depthB: 0.12 }],
    performers: [
      performer(steps(random, [2, 5, 8, 11]), { target: 'layers[0].pulseWidth', depth: 0.6, targetB: 'layers[0].pitch', depthB: 0.5, targetC: 'layers[0].cutoff', depthC: 0.32 }),
      performer(steps(random, [1, 4, 7, 9]), { target: 'layers[0].gain', depth: 0.8, targetB: 'layers[2].gain', depthB: 1, shape: 'step' }),
    ],
  }
}

function metallicPlate(random: Rng, seed: number): Built {
  const duration = logBetween(random, 0.45, 1.8)
  const note = logBetween(random, 180, 640)
  const material = pick(random, BODIES)
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: between(random, 0.22, 0.38),
        source: { kind: 'noise', colour: 'metallic' },
        filterA: { kind: 'highpass', cutoff: logBetween(random, 1800, 4200), resonance: 0.16, envAmount: -1.8, envCurve: EASE_OUT },
        insertA: { kind: 'drive', place: 'pre', amount: 0.28, drive: 0.12 },
        insertC: { kind: 'body', place: 'post', amount: 0.35, frequency: note * 4, spread: 0.42, decay: 0.08, partials: 5, profile: material, character: 0.55 },
        amp: fitAmp(duration, amp(0.0007, 0.006, 0.07, 0, 0.04, 2.7)),
      }),
      makeLayer({
        gain: between(random, 0.48, 0.7), spread: 0.32,
        source: { kind: 'tone', wave: 'sine', fmIndex: between(random, 1.6, 4.2), fmRatio: pick(random, [2.73, 3.17, 4.11, 5.04]), fmFall: between(random, 0.45, 0.85), pmFrom: 'internal' },
        pitch: { start: note, slide: between(random, -9, -2), slideCurve: EASE_OUT, jitter: 6 },
        filterA: { kind: 'lowpass', cutoff: cutoffFor(random, 'lowpass', note), resonance: 0.22, envAmount: -1.6, envCurve: EASE_OUT },
        insertC: { kind: 'body', place: 'post', amount: 0.48, frequency: note, spread: between(random, 0.18, 0.55), decay: between(random, 0.12, 0.45), partials: 5, profile: material, character: 0.6 },
        amp: fitAmp(duration, amp(0.0015, 0.012, duration * 0.45, 0, duration * 0.18, 2.1)),
      }),
      chance(random, 0.7) ? makeLayer({
        gain: 0.22, pan: 0.28, offset: later(duration * 0.04),
        source: { kind: 'table', table: tableOf(random, ['bell', 'ion']), position: 0.4, voices: 2, detune: 9 },
        pitch: { start: note * 2.02, slide: -4, slideCurve: EASE_OUT },
        filterA: { kind: 'notch', cutoff: note * 3, resonance: 0.18 },
        amp: fitAmp(duration, amp(0.004, 0.02, duration * 0.35, 0, 0.12, 1.8)),
      }) : silentLayer(),
    ],
    fx: { z: { kind: 'reverb', mode: 'send', mix: between(random, 0.08, 0.22), size: 0.42, damping: 0.48 }, width: 0.7, tone: 0.08 },
    master: { gain: 0.78, limiter: 0.7, fadeOut: 0.04 },
    envelopes: [{ enabled: true, attack: 0.01, decay: duration * 0.4, sustain: 0, release: 0.08, depth: 0.35, target: 'layers[1].pm' }],
  }
}

function metallicBlade(random: Rng, seed: number): Built {
  const duration = logBetween(random, 0.28, 1.1)
  const note = logBetween(random, 420, 1600)
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: 0.34, pan: -0.12,
        source: { kind: 'noise', colour: 'white' },
        filterA: { kind: 'highpass', cutoff: 2400, resonance: 0.2, envAmount: 1.4, envCurve: EASE_OUT },
        insertA: { kind: 'crusher', amount: 0.18, bitDepth: 8, crush: 0.08 },
        amp: fitAmp(duration, amp(0.0004, 0.002, 0.04, 0, 0.02, 3)),
      }),
      makeLayer({
        gain: 0.62, spread: 0.4,
        source: { kind: 'table', table: tableOf(random, ['bell', 'sweep']), position: between(random, 0.15, 0.6), fmIndex: 2.2, fmRatio: 3.01, fmFall: 0.7 },
        pitch: { start: note, slide: between(random, -18, -6), slideCurve: EASE_OUT, jitter: 8 },
        routing: 'series',
        filterA: { kind: 'highpass', cutoff: note * 0.4, resonance: 0.1 },
        filterB: { kind: 'lowpass', cutoff: cutoffFor(random, 'lowpass', note), resonance: 0.28, envAmount: -2.4, envCurve: EASE_OUT },
        insertC: { kind: 'body', place: 'post', amount: 0.28, frequency: note * 1.5, spread: 0.48, decay: 0.18, partials: 4, profile: 'glass', character: 0.7 },
        amp: fitAmp(duration, amp(0.001, 0.008, duration * 0.5, 0, 0.1, 2.3)),
      }),
      makeLayer({
        gain: 0.2, offset: later(duration * 0.08), pan: 0.3,
        source: { kind: 'tone', wave: 'triangle', pmFrom: 'layer1', fmIndex: 0.8, fmRatio: 2 },
        pitch: { start: note * 1.5, slide: -10, slideCurve: EASE_OUT },
        filterA: { kind: 'bandpass', cutoff: note * 3, resonance: 0.3 },
        amp: fitAmp(duration, amp(0.006, 0.02, duration * 0.3, 0, 0.12, 1.9)),
      }),
    ],
    fx: { x: { kind: 'flanger', mode: 'insert', mix: 0.12, rate: 0.4, depth: 0.45, feedback: 0.28 }, width: 0.62, tone: 0.12 },
    master: { gain: 0.8, limiter: 0.72, fadeOut: 0.03 },
  }
}

function digitalScan(random: Rng, seed: number): Built {
  const duration = logBetween(random, 0.35, 2.2)
  const note = logBetween(random, 110, 480)
  const pattern = steps(random, [0, 3, 4, 8, 11, 12])
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: 0.58, spread: 0.55,
        source: { kind: 'table', table: tableOf(random, ['pulse', 'ion', 'stack']), position: between(random, 0.1, 0.8), voices: 3, detune: between(random, 8, 18) },
        pitch: { start: note, slide: between(random, -6, 8), slideCurve: EASE_IN, arpeggioRatio: chance(random, 0.5) ? pick(random, [1.5, 2, 0.75]) : 1, arpeggioAt: 0.35, jitter: 10 },
        filterA: { kind: 'ladder', cutoff: cutoffFor(random, 'ladder', note), resonance: 0.32, envAmount: between(random, -2.8, 1.2), envCurve: EASE_OUT },
        insertA: { kind: 'crusher', amount: between(random, 0.12, 0.4), bitDepth: pick(random, [5, 6, 8, 10]), crush: between(random, 0.08, 0.35) },
        insertB: { kind: 'fold', amount: 0.16, drive: 0.22 },
        amp: fitAmp(duration, amp(0.004, duration * 0.12, duration * 0.4, chance(random, 0.4) ? 0.12 : 0, 0.08, 1.8)),
      }),
      makeLayer({
        gain: 0.22, pan: -0.4, spread: 0.7,
        source: { kind: 'tone', wave: pick(random, ['saw', 'square']), pulseWidth: between(random, 0.18, 0.7), pmFrom: 'layer0', fmIndex: 1.4, fmRatio: 2.02 },
        pitch: { start: note * 2, slide: 6, slideCurve: LINEAR },
        filterA: { kind: 'formant', cutoff: note * 4, resonance: 0.4, envAmount: 1.8, envCurve: EASE_IN },
        amp: fitAmp(duration, amp(0.02, duration * 0.2, duration * 0.3, 0, 0.1, 1.6)),
      }),
      chance(random, 0.65) ? noiseBurst(random, duration * 0.2, 'white', 2800, 0.18) : silentLayer(),
    ],
    fx: {
      x: { kind: 'phaser', mode: 'insert', mix: 0.18, rate: between(random, 0.2, 2.4), depth: 0.55, feedback: 0.35 },
      y: { kind: 'delay', mode: 'send', mix: 0.12, time: between(random, 0.06, 0.18), feedback: 0.28 },
      width: 0.78, tone: 0.16,
    },
    master: { gain: 0.74, limiter: 0.7, fadeOut: 0.03 },
    lfos: [{ enabled: true, shape: pick(random, ['saw', 'square', 'noise']), rate: logBetween(random, 4, 22), depth: 0.22, target: 'layers[0].cutoff', targetB: 'layers[0].pulseWidth', depthB: 0.3 }],
    performers: [performer(pattern, { target: 'layers[0].gain', depth: 0.7, targetB: 'layers[1].pm', depthB: 0.4, shape: 'step', rate: pick(random, [1, 2, 4]) })],
  }
}

function digitalGlitch(random: Rng, seed: number): Built {
  const duration = logBetween(random, 0.18, 1.4)
  const note = logBetween(random, 140, 900)
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: 0.55, spread: 0.45,
        source: { kind: 'tone', wave: 'square', pulseWidth: between(random, 0.12, 0.4), voices: 2, detune: 14, fmIndex: between(random, 0.8, 3.5), fmRatio: pick(random, [0.5, 1.5, 3.5, 8]), fmFall: 0.3 },
        pitch: { start: note, slide: between(random, -22, 14), slideCurve: pick(random, [EASE_IN, EASE_OUT]), jitter: 22 },
        filterA: { kind: 'notch', cutoff: cutoffFor(random, 'notch', note), resonance: 0.35, envAmount: 2.2, envCurve: EASE_IN },
        insertA: { kind: 'crusher', amount: 0.45, bitDepth: pick(random, [3, 4, 5, 6]), crush: 0.4 },
        insertB: { kind: 'ring', amount: 0.22, ratio: logBetween(random, 0.3, 6) },
        amp: fitAmp(duration, amp(0.0008, 0.01, duration * 0.45, 0.05, 0.05, 2.6)),
      }),
      makeLayer({
        gain: 0.28, pan: 0.45, offset: later(duration * 0.06),
        source: { kind: 'noise', colour: pick(random, COLOURS) },
        filterA: { kind: 'bandpass', cutoff: logBetween(random, 1200, 6000), resonance: 0.4 },
        insertA: { kind: 'fold', amount: 0.3, drive: 0.4 },
        amp: fitAmp(duration, amp(0.001, 0.004, duration * 0.2, 0, 0.04, 3)),
      }),
      makeLayer({
        gain: 0.2, pan: -0.5,
        source: { kind: 'table', table: tableOf(random, ['pulse', 'ion']), position: 0.7 },
        pitch: { start: note * 0.5, arpeggioRatio: 2.5, arpeggioAt: 0.4 },
        filterA: { kind: 'highpass', cutoff: 400, resonance: 0.1 },
        amp: fitAmp(duration, amp(0.008, duration * 0.15, duration * 0.25, 0, 0.06, 1.7)),
      }),
    ],
    fx: { y: { kind: 'delay', mode: 'send', mix: 0.16, time: 0.07, feedback: 0.45 }, width: 0.85, tone: 0.2 },
    master: { gain: 0.7, limiter: 0.78, fadeOut: 0.02 },
    performers: [performer(steps(random, [0, 1, 5, 6, 12, 13]), { target: 'layers[0].gain', depth: 1, targetB: 'layers[1].gain', depthB: 0.8, shape: 'step', rate: 4 })],
  }
}

function organicGrowl(random: Rng, seed: number): Built {
  const duration = logBetween(random, 0.7, 2.6)
  const note = logBetween(random, 55, 140)
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: 0.7, spread: 0.22,
        source: { kind: 'table', table: tableOf(random, ['growl', 'formant']), position: between(random, 0.2, 0.7), voices: 2, detune: 7, fmIndex: between(random, 1.2, 2.8), fmRatio: 1.5, fmFall: 0.2 },
        pitch: { start: note, slide: between(random, -8, 5), slideCurve: EASE_OUT, vibratoRate: between(random, 4, 9), vibratoDepth: 0.25, jitter: 5 },
        routing: 'parallel',
        filterA: { kind: 'lowpass', cutoff: cutoffFor(random, 'lowpass', note), resonance: 0.28, envAmount: -1.8, envCurve: EASE_OUT },
        filterB: { kind: 'formant', cutoff: note * 5, resonance: 0.45, envAmount: 1.2, envCurve: EASE_IN },
        filterMix: 0.35,
        insertA: { kind: 'drive', amount: 0.32, drive: 0.28 },
        insertC: { kind: 'body', place: 'post', amount: 0.12, frequency: note * 2, spread: 0.4, decay: 0.2, partials: 3, profile: 'cavity' },
        amp: fitAmp(duration, amp(0.03, duration * 0.25, duration * 0.35, 0.08, 0.16, 1.6)),
      }),
      makeLayer({
        gain: 0.22, pan: 0.18, offset: later(duration * 0.05),
        source: { kind: 'noise', colour: 'pink' },
        filterA: { kind: 'bandpass', cutoff: 900, resonance: 0.22 },
        amp: fitAmp(duration, amp(0.04, duration * 0.2, duration * 0.4, 0, 0.12, 1.5)),
      }),
      sineBody(random, duration, note * 0.5, 0.35),
    ],
    fx: { z: { kind: 'reverb', mode: 'send', mix: 0.08, size: 0.35, damping: 0.7 }, x: { kind: 'chorus', mode: 'insert', mix: 0.12, rate: 0.35, depth: 0.4 }, width: 0.5, tone: -0.12 },
    master: { gain: 0.76, limiter: 0.68, fadeOut: 0.05 },
    lfos: [{ enabled: true, shape: 'sine', rate: 5.5, depth: 0.18, target: 'layers[0].pm', targetB: 'layers[0].cutoff', depthB: 0.15 }],
    envelopes: [{ enabled: true, attack: 0.08, decay: duration * 0.5, sustain: 0.1, release: 0.12, depth: -0.4, target: 'layers[0].cutoff' }],
  }
}

function organicWood(random: Rng, seed: number): Built {
  const duration = logBetween(random, 0.22, 1.4)
  const note = logBetween(random, 90, 280)
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: 0.3,
        source: { kind: 'noise', colour: 'pink' },
        filterA: { kind: 'highpass', cutoff: 600, resonance: 0.15 },
        insertC: { kind: 'body', place: 'post', amount: 0.55, frequency: note * 3, spread: 0.22, decay: 0.06, partials: 4, profile: 'bar' },
        amp: fitAmp(duration, amp(0.0005, 0.004, 0.05, 0, 0.03, 2.8)),
      }),
      makeLayer({
        gain: 0.58, spread: 0.18,
        source: { kind: 'tone', wave: 'triangle', fmIndex: 0.9, fmRatio: 2.03, fmFall: 0.8 },
        pitch: { start: note, slide: -6, slideCurve: EASE_OUT, jitter: 4 },
        filterA: { kind: 'lowpass', cutoff: cutoffFor(random, 'lowpass', note), resonance: 0.18, envAmount: -2, envCurve: EASE_OUT },
        insertC: { kind: 'body', place: 'post', amount: 0.4, frequency: note, spread: 0.15, decay: 0.22, partials: 4, profile: 'membrane' },
        amp: fitAmp(duration, amp(0.002, 0.01, duration * 0.4, 0, 0.1, 2.2)),
      }),
    ],
    fx: { z: { kind: 'reverb', mode: 'send', mix: 0.14, size: 0.28, damping: 0.55 }, width: 0.42, tone: -0.08 },
    master: { gain: 0.82, limiter: 0.65, fadeOut: 0.03 },
  }
}

function atmosphericPad(random: Rng, seed: number): Built {
  const duration = logBetween(random, 1.6, 3.9)
  const note = logBetween(random, 70, 220)
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: 0.48, spread: 0.82,
        source: { kind: 'table', table: tableOf(random, ['sweep', 'formant', 'ion']), position: 0.35, voices: 4, detune: 18 },
        pitch: { start: note, slide: between(random, -4, 6), slideCurve: LINEAR, vibratoRate: 0.35, vibratoDepth: 0.15 },
        routing: 'parallel',
        filterA: { kind: 'lowpass', cutoff: cutoffFor(random, 'lowpass', note), resonance: 0.12, envAmount: 1.4, envCurve: EASE_IN },
        filterB: { kind: 'formant', cutoff: note * 6, resonance: 0.35 },
        filterMix: 0.28,
        insertB: { kind: 'comb', amount: 0.14, time: 0.012, feedback: 0.42 },
        amp: fitAmp(duration, amp(0.18, duration * 0.25, duration * 0.35, 0.15, 0.35, 1.3)),
      }),
      makeLayer({
        gain: 0.22, pan: -0.35, spread: 0.7, offset: later(duration * 0.08),
        source: { kind: 'noise', colour: 'pink' },
        filterA: { kind: 'bandpass', cutoff: 1800, resonance: 0.18, envAmount: -1.2, envCurve: EASE_OUT },
        amp: fitAmp(duration, amp(0.22, duration * 0.2, duration * 0.4, 0.08, 0.3, 1.2)),
      }),
      makeLayer({
        gain: 0.28, pan: 0.4, spread: 0.6,
        source: { kind: 'tone', wave: 'sine', voices: 2, detune: 8, fmIndex: 0.6, fmRatio: 1.01, fmFall: 0.2 },
        pitch: { start: note * 2, slide: 3, slideCurve: LINEAR },
        filterA: { kind: 'lowpass', cutoff: 2400, resonance: 0.08 },
        amp: fitAmp(duration, amp(0.28, duration * 0.2, duration * 0.3, 0.12, 0.4, 1.2)),
      }),
      chance(random, 0.5) ? makeLayer({
        gain: 0.12, offset: later(duration * 0.45), pan: 0.15,
        source: { kind: 'table', table: tableOf(random, ['bell']), position: 0.5 },
        pitch: { start: note * 4, slide: -8, slideCurve: EASE_OUT },
        insertC: { kind: 'body', place: 'post', amount: 0.3, frequency: note * 4, spread: 0.5, decay: 0.4, partials: 4, profile: 'aether', character: 0.7 },
        amp: fitAmp(duration * 0.5, amp(0.04, 0.05, duration * 0.3, 0, 0.2, 1.6)),
      }) : silentLayer(),
    ],
    fx: {
      x: { kind: 'chorus', mode: 'insert', mix: 0.28, rate: 0.18, depth: 0.55 },
      z: { kind: 'reverb', mode: 'send', mix: 0.32, size: 0.78, damping: 0.35 },
      width: 0.92, tone: -0.06,
    },
    master: { gain: 0.68, limiter: 0.6, fadeOut: 0.12 },
    lfos: [
      { enabled: true, shape: 'sine', rate: 0.25, depth: 0.22, target: 'layers[0].cutoff', targetB: 'layers[0].pan', depthB: 0.18 },
      { enabled: true, shape: 'triangle', rate: 0.12, depth: 0.15, target: 'layers[2].pitch' },
    ],
  }
}

function atmosphericCollapse(random: Rng, seed: number): Built {
  const duration = logBetween(random, 1.8, 3.8)
  const note = logBetween(random, 42, 90)
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: 0.7, spread: 0.2,
        source: { kind: 'tone', wave: 'sine', fmIndex: 1.6, fmRatio: 2.11, fmFall: 0.15 },
        pitch: { start: note, slide: between(random, -18, -8), slideCurve: EASE_IN, jitter: 3 },
        filterA: { kind: 'lowpass', cutoff: 900, resonance: 0.22, envAmount: -3.2, envCurve: EASE_IN },
        insertC: { kind: 'body', place: 'post', amount: 0.18, frequency: note * 1.5, spread: 0.55, decay: 0.5, partials: 4, profile: 'cavity' },
        amp: fitAmp(duration, amp(0.08, duration * 0.15, duration * 0.55, 0.05, 0.35, 1.4)),
      }),
      makeLayer({
        gain: 0.32, spread: 0.75, offset: later(duration * 0.12),
        source: { kind: 'noise', colour: 'pink' },
        filterA: { kind: 'lowpass', cutoff: 1800, resonance: 0.1, envAmount: -2.5, envCurve: EASE_IN },
        insertA: { kind: 'drive', amount: 0.2, drive: 0.18 },
        amp: fitAmp(duration, amp(0.15, duration * 0.1, duration * 0.5, 0, 0.3, 1.3)),
      }),
      makeLayer({
        gain: 0.24, pan: 0.3, offset: later(duration * 0.35),
        source: { kind: 'table', table: tableOf(random, ['titan', 'stack']), position: 0.6, fmIndex: 2.4, fmRatio: 3.5, fmFall: 0.5 },
        pitch: { start: note * 4, slide: -20, slideCurve: EASE_IN },
        filterA: { kind: 'bandpass', cutoff: 1400, resonance: 0.3 },
        amp: fitAmp(duration * 0.6, amp(0.04, 0.06, duration * 0.3, 0, 0.22, 1.7)),
      }),
    ],
    fx: { z: { kind: 'reverb', mode: 'send', mix: 0.38, size: 0.85, damping: 0.42 }, y: { kind: 'delay', mode: 'send', mix: 0.1, time: 0.22, feedback: 0.35 }, width: 0.7, tone: -0.18 },
    master: { gain: 0.7, limiter: 0.72, fadeOut: 0.14 },
    envelopes: [{ enabled: true, delay: later(duration * 0.2), attack: 0.05, decay: Math.min(2, duration * 0.5), sustain: 0, release: 0.2, depth: 0.55, target: 'layers[0].pm' }],
    performers: [performer(steps(random, [4, 8, 12, 15]), { target: 'layers[0].gain', depth: 0.45, targetB: 'layers[2].gain', depthB: 0.7, shape: 'line' })],
  }
}

function impactHit(random: Rng, seed: number): Built {
  const duration = logBetween(random, 0.22, 1.6)
  const note = logBetween(random, 48, 110)
  return {
    duration, seed,
    layers: [
      noiseBurst(random, Math.min(0.12, duration), pick(random, COLOURS), logBetween(random, 1200, 4000), between(random, 0.22, 0.42)),
      makeLayer({
        gain: between(random, 0.55, 0.82),
        source: { kind: 'noise', colour: 'pink' },
        filterA: { kind: 'lowpass', cutoff: logBetween(random, 900, 2800), resonance: 0.12, envAmount: -3.2, envCurve: EASE_OUT },
        insertA: { kind: 'drive', amount: 0.28, drive: 0.3 },
        amp: fitAmp(duration, amp(0.002, 0.02, duration * 0.55, 0.08, duration * 0.2, 2)),
      }),
      sineBody(random, duration, note, between(random, 0.4, 0.65)),
      chance(random, 0.55) ? makeLayer({
        gain: 0.2, offset: later(duration * 0.08), pan: pick(random, [-0.4, 0.4]),
        source: { kind: 'tone', wave: 'sine', fmIndex: 3.5, fmRatio: 5.1, fmFall: 0.8 },
        pitch: { start: logBetween(random, 400, 1400), slide: -16, slideCurve: EASE_OUT },
        insertC: { kind: 'body', place: 'post', amount: 0.2, frequency: 900, spread: 0.6, decay: 0.12, partials: 4, profile: 'plate' },
        amp: fitAmp(duration, amp(0.001, 0.006, 0.14, 0, 0.08, 2.4)),
      }) : silentLayer(),
    ],
    fx: { z: { kind: 'reverb', mode: 'send', mix: between(random, 0.06, 0.2), size: 0.45, damping: 0.55 }, width: 0.55, tone: -0.05 },
    master: { gain: 0.85, limiter: 0.8, fadeOut: 0.03 },
  }
}

function impactDebris(random: Rng, seed: number): Built {
  const duration = logBetween(random, 0.55, 2.1)
  const note = logBetween(random, 70, 160)
  return {
    duration, seed,
    layers: [
      makeLayer({
        gain: 0.4, spread: 0.6,
        source: { kind: 'noise', colour: 'metallic' },
        routing: 'series',
        filterA: { kind: 'highpass', cutoff: 1400, resonance: 0.12 },
        filterB: { kind: 'lowpass', cutoff: 9000, resonance: 0.08, envAmount: -2, envCurve: EASE_OUT },
        insertB: { kind: 'comb', amount: 0.2, time: 0.0045, feedback: 0.38 },
        amp: fitAmp(duration, amp(0.001, 0.01, duration * 0.35, 0, 0.12, 2.4)),
      }),
      makeLayer({
        gain: 0.55,
        source: { kind: 'table', table: tableOf(random, ['titan', 'stack']), position: 0.3, fmIndex: 1.8, fmRatio: 2.4, fmFall: 0.5 },
        pitch: { start: note, slide: -14, slideCurve: EASE_OUT },
        filterA: { kind: 'lowpass', cutoff: 1600, resonance: 0.2, envAmount: -2.2, envCurve: EASE_OUT },
        insertA: { kind: 'drive', amount: 0.22, drive: 0.2 },
        amp: fitAmp(duration, amp(0.003, 0.02, duration * 0.45, 0, 0.16, 2)),
      }),
      sineBody(random, duration, note * 0.7, 0.42),
      makeLayer({
        gain: 0.18, offset: later(duration * 0.22), pan: 0.35, spread: 0.7,
        source: { kind: 'tone', wave: 'sine', fmIndex: 4, fmRatio: 7.1, fmFall: 0.7 },
        pitch: { start: logBetween(random, 700, 2200), slide: -22, slideCurve: EASE_OUT, jitter: 18 },
        filterA: { kind: 'peak', cutoff: 2400, resonance: 0.3 },
        amp: fitAmp(duration * 0.7, amp(0.002, 0.008, duration * 0.25, 0, 0.1, 2.5)),
      }),
    ],
    fx: { z: { kind: 'reverb', mode: 'send', mix: 0.16, size: 0.52, damping: 0.5 }, width: 0.72, tone: 0.02 },
    master: { gain: 0.78, limiter: 0.75, fadeOut: 0.04 },
    performers: [performer(steps(random, [0, 2, 6, 9]), { target: 'layers[0].gain', depth: 0.7, targetB: 'layers[3].gain', depthB: 0.85, shape: 'step', rate: 2 })],
  }
}

const ARCHITECTURES: Record<SoundFamily, ((random: Rng, seed: number) => Built)[]> = {
  mechanical: [mechanicalRatchet, mechanicalServo],
  metallic: [metallicPlate, metallicBlade],
  digital: [digitalScan, digitalGlitch],
  organic: [organicGrowl, organicWood],
  atmospheric: [atmosphericPad, atmosphericCollapse],
  impact: [impactHit, impactDebris],
}

export function chooseFamily(random: Rng, requested: RandomFamily): SoundFamily {
  return requested === 'any' ? pick(random, SOUND_FAMILIES) : requested
}

export function buildArchitecture(random: Rng, family: SoundFamily, seed: number): AudioPatch {
  const builders = ARCHITECTURES[family]
  const extra = random()
  const built = pick(random, builders)(random, seed)
  // A third architecture flavour per family: extra layer of texture or a quieter/longer take.
  if (extra > 0.55 && built.layers.filter((layer) => layer.enabled).length < 4) {
    const spare = built.layers.findIndex((layer) => !layer.enabled)
    if (spare >= 0) {
      const available = Math.max(0.08, built.duration * 0.35)
      built.layers[spare] = makeLayer({
        gain: between(random, 0.1, 0.22),
        pan: between(random, -0.45, 0.45),
        offset: later(built.duration * between(random, 0.08, 0.4)),
        source: chance(random, 0.5)
          ? { kind: 'table', table: tableOf(random), position: random(), voices: 1 }
          : { kind: 'tone', wave: pick(random, WAVES), fmIndex: between(random, 0.4, 2.2), fmRatio: between(random, 1.2, 5) },
        pitch: { start: logBetween(random, 200, 2400), slide: between(random, -12, 6), slideCurve: EASE_OUT },
        filterA: { kind: pick(random, ['bandpass', 'highpass', 'notch'] as const), cutoff: logBetween(random, 600, 5000), resonance: 0.18 },
        amp: fitAmp(available, amp(0.006, 0.02, available * 0.5, 0, 0.08, 2)),
      })
    }
  }
  const patch = patchOf(built)
  return {
    ...patch,
    seed: Math.floor(random() * 9999),
  }
}
