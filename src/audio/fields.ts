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
  offset: num('Start offset', 0, 1, 0.001, SECONDS),
}

const SOURCE_FIELDS: Record<string, FieldSpec> = {
  kind: { type: 'option', label: 'Source', options: ['tone', 'noise'] },
  wave: { type: 'option', label: 'Wave', options: ['sine', 'triangle', 'saw', 'square'] },
  pulseWidth: num('Pulse width', 0.05, 0.95),
  colour: { type: 'option', label: 'Noise colour', options: ['white', 'pink', 'metallic'] },
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
  kind: { type: 'option', label: 'Filter', options: ['off', 'lowpass', 'highpass', 'bandpass'] },
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
}

const MASTER_FIELDS: Record<string, FieldSpec> = {
  gain: num('Master gain', 0, 2),
  limiter: num('Limiter', 0, 1),
  fadeOut: num('Fade out', 0.001, 0.5, 0.001, SECONDS),
}

/**
 * Every field table in one place. The parser reads it, the docs page is generated from it, a
 * freshly exposed control takes its bounds from it, and the patch reader clamps against it — so a
 * field's range is written once and four things cannot disagree about it.
 */
export const AUDIO_FIELDS = {
  patch: PATCH_FIELDS,
  fx: FX_FIELDS,
  master: MASTER_FIELDS,
} as const

export type LayerSection = 'root' | 'source' | 'pitch' | 'filter' | 'shaper' | 'amp'

export const LAYER_SECTIONS: Record<LayerSection, Record<string, FieldSpec>> = {
  root: LAYER_FIELDS,
  source: SOURCE_FIELDS,
  pitch: PITCH_FIELDS,
  filter: FILTER_FIELDS,
  shaper: SHAPER_FIELDS,
  amp: AMP_FIELDS,
}

/** How many layers a patch has. Fixed, and the parser refuses an index past it. */
export const LAYER_COUNT = 3
