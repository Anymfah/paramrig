import type { AudioPatch } from './types.ts'
import { EASE_IN, EASE_OUT, LINEAR } from './dsp/curve.ts'
import { makeLayer, makePatch } from './patch.ts'
import {
  bindMacro, emptyMacros, renameMacro, setMacroDestination, setMacroValue, writeMacros,
} from './macros.ts'
import { currentAudioValue, parseAudioProperty, type AudioRig } from './rig.ts'
import { mapAmount } from './dsp/curve.ts'
import type { MacroGestureDestination } from './types.ts'

/**
 * Five signature sounds, meant to be recognised after one hearing.
 *
 * They are the demonstration the new instrument needed: named macros that move more than one
 * thing, bodies that are not all the same bar, tables drawn for these events, and in one case a
 * recorded opening that the file carries with it.
 */

function dest(property: string, from: number, to: number, extra: Partial<MacroGestureDestination> = {}): MacroGestureDestination {
  return { property, from, to, invert: extra.invert === true, curve: extra.curve ?? LINEAR }
}

export function namedRig(
  patch: AudioPatch,
  slots: { label: string; value: number; destinations: MacroGestureDestination[] }[],
): AudioRig {
  let table = emptyMacros()
  slots.forEach((slot, index) => {
    for (const destination of slot.destinations) {
      table = bindMacro(table, index, destination.property, patch)
      // Keep the authored sound at the displayed default, including in Tune and the SDK.
      const spec = parseAudioProperty(destination.property)?.spec
      const current = currentAudioValue(patch, destination.property)
      let anchored = destination
      if (spec?.type === 'number' && typeof current === 'number') {
        const logarithmic = spec.scale === 'log' && destination.from > 0 && destination.to > 0 && current > 0
        const project = (value: number) => logarithmic ? Math.log(Math.max(1e-9, value)) : value
        const unproject = (value: number) => logarithmic ? Math.exp(value) : value
        const alpha = mapAmount(slot.value, 0, 1, { invert: destination.invert, curve: destination.curve })
        const centre = project(current)
        const minimum = project(spec.min ?? 0)
        const maximum = project(spec.max ?? 1)
        const sign = destination.to >= destination.from ? 1 : -1
        const before = sign > 0 ? centre - minimum : maximum - centre
        const after = sign > 0 ? maximum - centre : centre - minimum
        const span = Math.min(Math.abs(project(destination.to) - project(destination.from)), alpha > 0 ? before / alpha : Infinity, alpha < 1 ? after / (1 - alpha) : Infinity)
        anchored = { ...destination, from: unproject(centre - sign * alpha * span), to: unproject(centre + sign * (1 - alpha) * span) }
      }
      table = setMacroDestination(table, index, destination.property, anchored)
    }
    table = renameMacro(table, index, slot.label)
    table = setMacroValue(table, index, slot.value)
  })
  return writeMacros(undefined, table, patch)
}

/** Heavy mechanical lock: a precise attack, a brief metal, then the mass sitting down. */
export function titanLatch(): AudioPatch {
  return makePatch(0.62, [
    makeLayer({
      gain: 0.28,
      pan: -0.08,
      source: { kind: 'noise', colour: 'metallic' },
      filterA: { kind: 'highpass', cutoff: 2800, resonance: 0.18, envAmount: -1.6, envCurve: EASE_OUT },
      insertA: { kind: 'drive', place: 'pre', amount: 0.38, drive: 0.14 },
      insertC: { kind: 'body', place: 'post', amount: 0.22, frequency: 2100, spread: 0.38, decay: 0.07, partials: 4, profile: 'aether', character: 0.58 },
      amp: { attack: 0.0008, hold: 0.008, decay: 0.09, sustain: 0, release: 0.05, curve: 2.6 },
    }),
    makeLayer({
      gain: 0.58,
      pan: 0.12,
      spread: 0.35,
      source: { kind: 'table', table: 'titan', position: 0.22, voices: 2, detune: 8 },
      pitch: { start: 92, slide: -7, slideCurve: EASE_OUT, jitter: 6 },
      filterA: { kind: 'lowpass', cutoff: 1400, resonance: 0.22, envAmount: -2.1, envCurve: EASE_OUT },
      insertC: { kind: 'body', place: 'post', amount: 0.4, frequency: 280, spread: 0.22, decay: 0.14, partials: 4, profile: 'bar', character: 0.5 },
      amp: { attack: 0.002, hold: 0.02, decay: 0.28, sustain: 0, release: 0.12, curve: 2.1 },
    }),
    makeLayer({
      gain: 0.34,
      source: { kind: 'tone', wave: 'sine' },
      pitch: { start: 58, slide: -4, slideCurve: EASE_OUT },
      amp: { attack: 0.001, hold: 0.01, decay: 0.22, sustain: 0, release: 0.08, curve: 2 },
    }),
  ], { z: { kind: 'reverb', mode: 'send', mix: 0.08, size: 0.22, damping: 0.7 }, tone: -0.12, width: 0.45 }, { gain: 0.28, limiter: 0.92, fadeOut: 0.02 })
}

export function titanLatchRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    {
      label: 'Mass', value: 0.45,
      destinations: [
        dest('layers[1].source.position', 0.1, 0.55),
        dest('layers[1].insertC.amount', 0.2, 0.7),
        dest('master.gain', 0.9, 0.68, { invert: true, curve: EASE_OUT }),
      ],
    },
    {
      label: 'Bite', value: 0.4,
      destinations: [
        dest('layers[0].insertA.drive', 0.12, 0.55),
        dest('layers[0].filterA.cutoff', 1800, 5200),
      ],
    },
    {
      label: 'Distance', value: 0.25,
      destinations: [
        dest('fx.z.mix', 0.04, 0.28, { curve: EASE_IN }),
        dest('fx.width', 0.3, 0.75),
      ],
    },
  ])
}

/** Premium confirm: a clear hook, a harmonic bloom, a crystalline tail. */
export function prismBloom(): AudioPatch {
  return makePatch(0.92, [
    makeLayer({
      gain: 0.52,
      pan: -0.18,
      spread: 0.42,
      source: { kind: 'table', table: 'prism', position: 0.18, voices: 1 },
      pitch: { start: 784, slide: 7, slideCurve: EASE_OUT, jitter: 4 },
      filterA: { kind: 'lowpass', cutoff: 4200, resonance: 0.18, envAmount: 1.4, envCurve: EASE_IN },
      insertC: { kind: 'body', place: 'post', amount: 0.28, frequency: 3120, spread: 0.3, decay: 0.18, partials: 5, profile: 'glass', character: 0.7 },
      amp: { attack: 0.004, hold: 0.03, decay: 0.28, sustain: 0.08, release: 0.38, curve: 1.6 },
    }),
    makeLayer({
      gain: 0.22,
      pan: 0.28,
      offset: 0.04,
      source: { kind: 'tone', wave: 'sine', voices: 2, detune: 6 },
      pitch: { start: 1568, slide: 5, slideCurve: EASE_OUT },
      amp: { attack: 0.01, hold: 0.02, decay: 0.35, sustain: 0, release: 0.28, curve: 1.8 },
    }),
    makeLayer({
      gain: 0.16,
      source: { kind: 'noise', colour: 'white' },
      filterA: { kind: 'highpass', cutoff: 6800, resonance: 0.12 },
      amp: { attack: 0.0006, hold: 0.004, decay: 0.05, sustain: 0, release: 0.03, curve: 3 },
    }),
  ], { z: { kind: 'reverb', mode: 'send', mix: 0.18, size: 0.42, damping: 0.35 }, tone: 0.12, width: 0.7 }, { gain: 0.38, limiter: 0.72, fadeOut: 0.04 })
}

export function prismBloomRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    {
      label: 'Bloom', value: 0.35,
      destinations: [
        dest('layers[0].source.position', 0.1, 0.85, { curve: EASE_IN }),
        dest('layers[0].filterA.cutoff', 2800, 7800),
        dest('layers[0].source.fmIndex', 0, 1.8),
      ],
    },
    {
      label: 'Sparkle', value: 0.3,
      destinations: [
        dest('layers[2].gain', 0.06, 0.28),
        dest('layers[1].gain', 0.12, 0.34),
      ],
    },
    {
      label: 'Space', value: 0.4,
      destinations: [
        dest('fx.z.mix', 0.08, 0.34),
        dest('fx.width', 0.45, 0.9),
        dest('master.gain', 0.82, 0.62, { invert: true }),
      ],
    },
  ])
}

/** A portal opening: prepare, transform the timbre, open the room, resolve. */
export function aetherGate(): AudioPatch {
  const opening = dest('layers[0].source.position', 0.05, 0.92, { curve: EASE_IN })
  const cutoff = dest('layers[0].filterA.cutoff', 420, 5200, { curve: EASE_IN })
  const room = dest('fx.z.mix', 0.08, 0.42)
  return {
    ...makePatch(1.65, [
      makeLayer({
        gain: 0.6,
        spread: 0.55,
        source: { kind: 'table', table: 'gate', position: 0.08, voices: 3, detune: 12, fmIndex: 0.4, fmRatio: 1.5 },
        pitch: { start: 110, slide: 9, slideCurve: EASE_IN, vibratoRate: 3.2, vibratoDepth: 0.15, jitter: 5 },
        filterA: { kind: 'lowpass', cutoff: 520, resonance: 0.28, envAmount: 2.4, envCurve: EASE_IN },
        insertC: { kind: 'body', place: 'post', amount: 0.22, frequency: 640, spread: 0.4, decay: 0.28, partials: 4, profile: 'cavity', character: 0.4 },
        amp: { attack: 0.08, hold: 0.55, decay: 0.4, sustain: 0.35, release: 0.45, curve: 1.2 },
      }),
      makeLayer({
        gain: 0.28,
        pan: 0.2,
        offset: 0.12,
        source: { kind: 'noise', colour: 'pink' },
        filterA: { kind: 'bandpass', cutoff: 1800, resonance: 0.35, envAmount: 1.8, envCurve: EASE_IN },
        amp: { attack: 0.12, hold: 0.2, decay: 0.5, sustain: 0.15, release: 0.4, curve: 1.4 },
      }),
    ], {
      y: { kind: 'chorus', mode: 'insert', mix: 0.22, rate: 0.35, depth: 0.4 },
      z: { kind: 'reverb', mode: 'send', mix: 0.22, size: 0.72, damping: 0.4 },
      tone: -0.05, width: 0.82,
    }, { gain: 0.36, limiter: 0.75, fadeOut: 0.06 }),
    gestures: [{
      id: 'gate-open',
      macro: 0,
      enabled: true,
      start: 0,
      duration: 1.35,
      points: [
        { t: 0, v: 0.05 }, { t: 0.22, v: 0.12 }, { t: 0.48, v: 0.38 },
        { t: 0.7, v: 0.82 }, { t: 0.88, v: 1 }, { t: 1, v: 0.92 },
      ],
      destinations: [opening, cutoff, room],
    }],
  }
}

export function aetherGateRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    {
      label: 'Open', value: 0.2,
      destinations: [
        dest('layers[0].source.position', 0.05, 0.92, { curve: EASE_IN }),
        dest('layers[0].filterA.cutoff', 420, 5200, { curve: EASE_IN }),
        dest('fx.z.mix', 0.08, 0.42),
      ],
    },
    {
      label: 'Tension', value: 0.35,
      destinations: [
        dest('layers[0].source.fmIndex', 0.2, 2.4),
        dest('layers[0].filterA.resonance', 0.15, 0.55),
      ],
    },
    {
      label: 'Distance', value: 0.45,
      destinations: [
        dest('fx.z.size', 0.4, 0.9),
        dest('fx.width', 0.5, 1),
        dest('master.gain', 0.82, 0.6, { invert: true }),
      ],
    },
  ])
}

/** Hybrid creature: vocal motion over metal, a fragile end. */
export function glassSerpent(): AudioPatch {
  return makePatch(1.15, [
    makeLayer({
      gain: 0.58,
      pan: -0.12,
      spread: 0.48,
      source: { kind: 'table', table: 'serpent', position: 0.3, voices: 2, detune: 14, fmIndex: 1.1, fmRatio: 2.7, fmFall: 0.45 },
      pitch: { start: 196, slide: -3, slideCurve: EASE_OUT, vibratoRate: 6.4, vibratoDepth: 0.35, jitter: 9 },
      routing: 'series',
      filterA: { kind: 'formant', cutoff: 420, resonance: 0.48, envAmount: 1.6, envCurve: EASE_IN },
      filterB: { kind: 'lowpass', cutoff: 3200, resonance: 0.2, envAmount: -1.2, envCurve: EASE_OUT },
      insertC: { kind: 'body', place: 'post', amount: 0.22, frequency: 1480, spread: 0.55, decay: 0.1, partials: 4, profile: 'membrane', character: 0.62 },
      amp: { attack: 0.018, hold: 0.12, decay: 0.45, sustain: 0.18, release: 0.38, curve: 1.7 },
    }),
    makeLayer({
      gain: 0.22,
      pan: 0.22,
      source: { kind: 'tone', wave: 'triangle', pmFrom: 'layer0', fmIndex: 0.8 },
      pitch: { start: 392, slide: 4, slideCurve: EASE_IN, jitter: 11 },
      filterA: { kind: 'bandpass', cutoff: 2400, resonance: 0.4 },
      amp: { attack: 0.03, hold: 0.08, decay: 0.4, sustain: 0.1, release: 0.32, curve: 2 },
    }),
    makeLayer({
      gain: 0.14,
      offset: 0.72,
      source: { kind: 'noise', colour: 'white' },
      filterA: { kind: 'highpass', cutoff: 5200, resonance: 0.1 },
      amp: { attack: 0.002, hold: 0.01, decay: 0.12, sustain: 0, release: 0.18, curve: 2.8 },
    }),
  ], { z: { kind: 'reverb', mode: 'send', mix: 0.14, size: 0.38, damping: 0.5 }, tone: 0.08, width: 0.62 }, { gain: 0.36, limiter: 0.72, fadeOut: 0.05 })
}

export function glassSerpentRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    {
      label: 'Voice', value: 0.4,
      destinations: [
        dest('layers[0].source.position', 0.12, 0.88),
        dest('layers[0].filterA.cutoff', 280, 980),
      ],
    },
    {
      label: 'Metal', value: 0.35,
      destinations: [
        dest('layers[0].insertC.amount', 0.15, 0.7),
        dest('layers[0].source.fmIndex', 0.4, 2.6),
        dest('layers[1].gain', 0.08, 0.38),
      ],
    },
    {
      label: 'Fragility', value: 0.3,
      destinations: [
        dest('layers[2].gain', 0.04, 0.28),
        dest('layers[0].amp.release', 0.18, 0.7, { curve: EASE_OUT }),
        dest('master.gain', 0.85, 0.58, { invert: true }),
      ],
    },
  ])
}

/** Held energy field: evolving timbre, tension you can ride, a worked release. */
export function ionChoir(): AudioPatch {
  return makePatch(2.4, [
    makeLayer({
      gain: 0.32,
      pan: -0.22,
      spread: 0.7,
      source: { kind: 'table', table: 'ion', position: 0.25, voices: 4, detune: 18 },
      pitch: { start: 130, vibratoRate: 0.35, vibratoDepth: 0.12, jitter: 4 },
      filterA: { kind: 'lowpass', cutoff: 1800, resonance: 0.32, envAmount: 0.8, envCurve: LINEAR },
      insertC: { kind: 'body', place: 'post', amount: 0.18, frequency: 520, spread: 0.48, decay: 0.35, partials: 5, profile: 'plate', character: 0.55 },
      amp: { attack: 0.12, hold: 1.1, decay: 0.45, sustain: 0.55, release: 0.65, curve: 1.15 },
    }),
    makeLayer({
      gain: 0.22,
      pan: 0.24,
      spread: 0.65,
      source: { kind: 'table', table: 'ion', position: 0.62, voices: 3, detune: 22, fmIndex: 0.35, fmRatio: 1.01 },
      pitch: { start: 196, vibratoRate: 0.41, vibratoDepth: 0.18, jitter: 5 },
      filterA: { kind: 'lowpass', cutoff: 2400, resonance: 0.22 },
      amp: { attack: 0.18, hold: 1, decay: 0.5, sustain: 0.5, release: 0.7, curve: 1.1 },
    }),
    makeLayer({
      gain: 0.12,
      source: { kind: 'noise', colour: 'pink' },
      filterA: { kind: 'bandpass', cutoff: 900, resonance: 0.25 },
      amp: { attack: 0.3, hold: 1.2, decay: 0.4, sustain: 0.3, release: 0.55, curve: 1.2 },
    }),
  ], {
    y: { kind: 'chorus', mode: 'insert', mix: 0.28, rate: 0.18, depth: 0.45 },
    z: { kind: 'reverb', mode: 'send', mix: 0.2, size: 0.65, damping: 0.42 },
    tone: -0.08, width: 0.88,
  }, { gain: 0.28, limiter: 0.88, fadeOut: 0.08 })
}

export function ionChoirRig(patch: AudioPatch): AudioRig {
  return namedRig(patch, [
    {
      label: 'Tension', value: 0.4,
      destinations: [
        dest('layers[0].source.position', 0.1, 0.7),
        dest('layers[1].source.position', 0.4, 0.95),
        dest('layers[0].filterA.resonance', 0.18, 0.58),
      ],
    },
    {
      label: 'Width', value: 0.55,
      destinations: [
        dest('fx.width', 0.4, 1),
        dest('layers[0].spread', 0.4, 0.9),
        dest('layers[1].spread', 0.35, 0.85),
      ],
    },
    {
      label: 'Drift', value: 0.3,
      destinations: [
        dest('layers[0].pitch.vibratoDepth', 0.05, 0.45),
        dest('fx.y.mix', 0.12, 0.5),
      ],
    },
    {
      label: 'Release', value: 0.4,
      destinations: [
        dest('layers[0].amp.release', 0.35, 1.2),
        dest('layers[1].amp.release', 0.4, 1.3),
        dest('fx.z.mix', 0.12, 0.4),
      ],
    },
  ])
}

export const SIGNATURE_PRESETS: {
  id: string
  label: string
  build: () => AudioPatch
  rig: (patch: AudioPatch) => AudioRig
}[] = [
  { id: 'titan-latch', label: 'Titan Latch', build: titanLatch, rig: titanLatchRig },
  { id: 'prism-bloom', label: 'Prism Bloom', build: prismBloom, rig: prismBloomRig },
  { id: 'aether-gate', label: 'Aether Gate', build: aetherGate, rig: aetherGateRig },
  { id: 'glass-serpent', label: 'Glass Serpent', build: glassSerpent, rig: glassSerpentRig },
  { id: 'ion-choir', label: 'Ion Choir', build: ionChoir, rig: ionChoirRig },
]
