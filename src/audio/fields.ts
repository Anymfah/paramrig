/**
 * What every field of a patch is: its type, its range, the unit it reads in.
 *
 * This table is the single source four things agree on — the property parser, the generated
 * documentation, the control built when a field is exposed, and the reader that clamps a patch
 * coming back off disk. Written once, so they cannot drift.
 *
 * It imports nothing but a type, which keeps it loadable by Node directly. That is what lets the
 * preview script render a patch to a .wav with no build step.
 */

export type AudioPropertyType = 'number' | 'boolean' | 'option' | 'curve'

/**
 * What a field is, and what a control built for it should look like. The bounds live here rather
 * than being guessed when a field is exposed, which is what makes the ◇ gesture produce a cutoff
 * control that reads 20 Hz to 20 kHz on a logarithmic scale instead of a bare 0-to-100 slider.
 */
export type FieldSpec = {
  type: AudioPropertyType
  label: string
  /** A CSS background per option, so a wave is chosen by its shape rather than by its name. */
  previews?: Record<string, string>
  /** A readable name per option, where the stored value is a path rather than a word. */
  optionLabels?: Record<string, string>
  min?: number
  max?: number
  step?: number
  unit?: string
  scale?: 'linear' | 'log'
  options?: readonly string[]
}

/** Seconds are stored; milliseconds are what anyone actually reads on an envelope. */
const SECONDS: Pick<FieldSpec, 'unit' | 'step'> = { unit: 'ms', step: 0.001 }

export const TIME_UNITS = [
  { value: 'ms', label: 'Milliseconds', factor: 0.001, step: 1 },
  { value: 's', label: 'Seconds', factor: 1, step: 0.01 },
]

const num = (label: string, min: number, max: number, step = 0.01, extra: Partial<FieldSpec> = {}): FieldSpec =>
  ({ type: 'number', label, min, max, step, ...extra })

const PATCH_FIELDS: Record<string, FieldSpec> = {
  duration: num('Duration', 0.02, 4, 0.001, SECONDS),
  seed: num('Seed', 0, 9999, 1),
}

const LAYER_FIELDS: Record<string, FieldSpec> = {
  enabled: { type: 'boolean', label: 'Enabled' },
  gain: num('Gain', 0, 1.5),
  pan: num('Pan', -1, 1),
  spread: num('Stereo spread', 0, 1),
  offset: num('Start offset', 0, 1, 0.001, SECONDS),
}

const SOURCE_FIELDS: Record<string, FieldSpec> = {
  kind: { type: 'option', label: 'Source', options: ['tone', 'noise'] },
  wave: {
    type: 'option', label: 'Wave', options: ['sine', 'triangle', 'saw', 'square'],
    previews: {
    sine: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M1%206%20q2.75%20-4.5%205.5%200%20t5.5%200%20t5.5%200%20t5.5%200' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    triangle: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M1%209%20L5%203%20L9%209%20L13%203%20L17%209%20L21%203%20L23%206' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    saw: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M1%209%20L7%203%20L7%209%20L13%203%20L13%209%20L19%203%20L19%209' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    square: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M1%209%20L1%203%20L7%203%20L7%209%20L13%209%20L13%203%20L19%203%20L19%209%20L23%209' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    },
  },
  pulseWidth: num('Pulse width', 0.05, 0.95),
  voices: num('Voices', 1, 5, 1),
  detune: num('Detune', 0, 60, 1, { unit: 'cents' }),
  fmRatio: num('FM ratio', 0.25, 12, 0.01),
  fmIndex: num('FM depth', 0, 10, 0.01),
  fmFall: num('FM fall', 0, 1),
  colour: {
    type: 'option', label: 'Noise colour', options: ['white', 'pink', 'metallic'],
    previews: {
    white: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M2%206%20L2%202%20M5%206%20L5%209%20M8%206%20L8%201%20M11%206%20L11%2010%20M14%206%20L14%203%20M17%206%20L17%208%20M20%206%20L20%202%20M23%206%20L23%209' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    pink: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M2%206%20L2%201%20M6%206%20L6%2010%20M10%206%20L10%203%20M14%206%20L14%209%20M18%206%20L18%205%20M22%206%20L22%207' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    metallic: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M3%2011%20L3%201%20M9%2011%20L9%204%20M15%2011%20L15%202%20M21%2011%20L21%206' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    },
  },
}

const PITCH_FIELDS: Record<string, FieldSpec> = {
  start: num('Frequency', 20, 12000, 1, { unit: 'Hz', scale: 'log' }),
  slide: num('Slide', -48, 48, 0.5, { unit: 'st' }),
  slideCurve: { type: 'curve', label: 'Slide curve' },
  vibratoRate: num('Vibrato rate', 0, 40, 0.1, { unit: 'Hz' }),
  vibratoDepth: num('Vibrato depth', 0, 12, 0.05, { unit: 'st' }),
  arpeggioRatio: num('Arpeggio ratio', 0.25, 4),
  arpeggioAt: num('Arpeggio at', 0, 1),
  jitter: num('Pitch jitter', 0, 100, 1, { unit: 'cents' }),
}

const FILTER_FIELDS: Record<string, FieldSpec> = {
  kind: {
    type: 'option', label: 'Filter', options: ['off', 'lowpass', 'highpass', 'bandpass'],
    // Four words that all start differently and end the same, ellipsised to 'Lowp…' and
    // 'Highp…' in a column this wide. The response curve is both shorter and clearer.
    previews: {
    off: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M1%206%20L23%206' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    lowpass: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M1%204%20L11%204%20Q16%204%2022%2011' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    highpass: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M2%2011%20Q8%204%2013%204%20L23%204' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    bandpass: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'%3E%3Cpath d='M1%2011%20Q6%2011%208%205%20Q12%201%2016%205%20Q18%2011%2023%2011' fill='none' stroke='%23d4e7e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat`,
    },
  },
  cutoff: num('Cutoff', 20, 20000, 1, { unit: 'Hz', scale: 'log' }),
  resonance: num('Resonance', 0, 1),
  envAmount: num('Filter sweep', -6, 6, 0.1, { unit: 'oct' }),
  envCurve: { type: 'curve', label: 'Sweep curve' },
}

const SHAPER_FIELDS: Record<string, FieldSpec> = {
  drive: num('Drive', 0, 1),
  bitDepth: num('Bit depth', 1, 16, 1, { unit: 'bit' }),
  crush: num('Sample crush', 0, 1),
}

const RESONATOR_FIELDS: Record<string, FieldSpec> = {
  amount: num('Resonance', 0, 1),
  // Up to sixteen kilohertz, because the bright end is where this family of sound lives: a
  // modern interface click is mostly air, and a body capped at eight could not reach it.
  frequency: num('Body', 40, 16000, 1, { unit: 'Hz', scale: 'log' }),
  spread: num('Inharmonicity', 0, 1),
  decay: num('Ring', 0.01, 3, 0.001, SECONDS),
  partials: num('Partials', 1, 6, 1),
}

const AMP_FIELDS: Record<string, FieldSpec> = {
  attack: num('Attack', 0, 2, 0.001, SECONDS),
  hold: num('Hold', 0, 2, 0.001, SECONDS),
  decay: num('Decay', 0, 2, 0.001, SECONDS),
  sustain: num('Sustain', 0, 1),
  release: num('Release', 0, 2, 0.001, SECONDS),
  curve: num('Envelope curve', 0.25, 6, 0.05),
}

const FX_FIELDS: Record<string, FieldSpec> = {
  delayTime: num('Delay time', 0.001, 1, 0.001, SECONDS),
  delayFeedback: num('Delay feedback', 0, 0.95),
  delayMix: num('Delay mix', 0, 1),
  reverbSize: num('Reverb size', 0, 1),
  reverbDamping: num('Reverb damping', 0, 1),
  reverbMix: num('Reverb mix', 0, 1),
  flangerRate: num('Flanger rate', 0.05, 8, 0.05, { unit: 'Hz' }),
  flangerDepth: num('Flanger depth', 0, 1),
  flangerMix: num('Flanger mix', 0, 1),
  tone: num('Tone', -1, 1),
  width: num('Width', 0, 1),
}

const MASTER_FIELDS: Record<string, FieldSpec> = {
  // Make-up gain, and it needs the room: the network puts far more energy into a tail than
  // the four-comb box it replaced, so the quiet patches need more than doubling to catch up.
  gain: num('Master gain', 0, 3),
  limiter: num('Limiter', 0, 1),
  fadeOut: num('Fade out', 0.001, 0.5, 0.001, SECONDS),
}

/** How many oscillator copies a layer may run, and how many modulators a patch carries. */
export const MAX_VOICES = 5
export const LFO_COUNT = 6
/** The free envelopes, beside the amplifier's: the reference's second and third modulator slots. */
export const MOD_ENVELOPE_COUNT = 2

/** How many layers an instrument has. Every table below is built from it. */
export const LAYER_COUNT = 4

/** Everywhere an LFO may point. Built from the layers, so it cannot name one that is not there. */
export const LFO_DESTINATIONS = ['pitch', 'cutoff', 'pulseWidth', 'gain'] as const
export const LFO_TARGETS: string[] = [
  'off',
  ...Array.from({ length: LAYER_COUNT }, (_, layer) => LFO_DESTINATIONS.map((where) => `layers[${layer}].${where}`)).flat(),
]

const LFO_TARGET_LABELS: Record<string, string> = Object.fromEntries(
  LFO_TARGETS.map((target) => {
    if (target === 'off') return [target, 'Off']
    const [, layer, where] = /^layers\[(\d)\]\.(\w+)$/.exec(target) ?? []
    const named: Record<string, string> = { pitch: 'pitch', cutoff: 'cutoff', pulseWidth: 'pulse width', gain: 'gain' }
    return [target, `Layer ${Number(layer) + 1} ${named[where ?? ''] ?? where}`]
  }),
)

export const LFO_FIELDS: Record<string, FieldSpec> = {
  enabled: { type: 'boolean', label: 'Enabled' },
  shape: { type: 'option', label: 'Shape', options: ['sine', 'triangle', 'square', 'saw', 'noise'] },
  rate: num('Rate', 0.1, 40, 0.1, { unit: 'Hz', scale: 'log' }),
  depth: num('Depth', 0, 1),
  phase: num('Phase', 0, 1),
  target: { type: 'option', label: 'Target', options: LFO_TARGETS, optionLabels: LFO_TARGET_LABELS },
}

/**
 * Every field table in one place. The parser reads it, the docs page is generated from it, a
 * freshly exposed control takes its bounds from it, and the patch reader clamps against it — so a
 * field's range is written once and four things cannot disagree about it.
 */
export const ENVELOPE_FIELDS: Record<string, FieldSpec> = {
  enabled: { type: 'boolean', label: 'Enabled' },
  delay: num('Delay', 0, 1, 0.001, SECONDS),
  attack: num('Attack', 0, 2, 0.001, SECONDS),
  hold: num('Hold', 0, 2, 0.001, SECONDS),
  decay: num('Decay', 0, 2, 0.001, SECONDS),
  sustain: num('Sustain', 0, 1),
  release: num('Release', 0, 2, 0.001, SECONDS),
  curve: num('Envelope curve', 0.25, 6, 0.05),
  depth: num('Depth', -1, 1),
  target: { type: 'option', label: 'Target', options: LFO_TARGETS, optionLabels: LFO_TARGET_LABELS },
}

export const AUDIO_FIELDS = {
  patch: PATCH_FIELDS,
  lfo: LFO_FIELDS,
  envelope: ENVELOPE_FIELDS,
  fx: FX_FIELDS,
  master: MASTER_FIELDS,
} as const

export type LayerSection = 'root' | 'source' | 'pitch' | 'filter' | 'shaper' | 'resonator' | 'amp'

export const LAYER_SECTIONS: Record<LayerSection, Record<string, FieldSpec>> = {
  root: LAYER_FIELDS,
  source: SOURCE_FIELDS,
  pitch: PITCH_FIELDS,
  filter: FILTER_FIELDS,
  shaper: SHAPER_FIELDS,
  resonator: RESONATOR_FIELDS,
  amp: AMP_FIELDS,
}

/** How many layers a patch has. Fixed, and the parser refuses an index past it. */
