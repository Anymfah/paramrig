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

import { TABLE_NAMES, TABLES } from './dsp/wavetable.ts'

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

/** How many rows a performer keeps; the patch's scene picks one for all of them. */
export const SCENE_COUNT = 12

/** How many layers an instrument has. Every table here is built from it. */
export const LAYER_COUNT = 4

/**
 * What may modulate an oscillator's phase: its own second oscillator, or any layer.
 *
 * Built from `LAYER_COUNT`, so it cannot name a layer that is not there. A layer naming itself is
 * refused by the engine rather than by this list, because which entry is the offending one depends
 * on which layer is asking.
 */
export const PM_SOURCES = ['internal', ...Array.from({ length: LAYER_COUNT }, (_, layer) => `layer${layer}`)] as const

const PATCH_FIELDS: Record<string, FieldSpec> = {
  duration: num('Duration', 0.02, 4, 0.001, SECONDS),
  seed: num('Seed', 0, 9999, 1),
  scene: num('Pattern', 0, SCENE_COUNT - 1, 1),
}

const LAYER_FIELDS: Record<string, FieldSpec> = {
  enabled: { type: 'boolean', label: 'Enabled' },
  gain: num('Gain', 0, 1.5),
  pan: num('Pan', -1, 1),
  spread: num('Stereo spread', 0, 1),
  offset: num('Start offset', 0, 1, 0.001, SECONDS),
}

const SOURCE_FIELDS: Record<string, FieldSpec> = {
  kind: { type: 'option', label: 'Source', options: ['tone', 'noise', 'table'] },
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
  table: {
    type: 'option', label: 'Wavetable', options: TABLE_NAMES,
    optionLabels: Object.fromEntries(TABLE_NAMES.map((name) => [name, TABLES[name]?.label ?? name])),
  },
  position: num('Table position', 0, 1),
  pmFrom: {
    type: 'option', label: 'PM source', options: PM_SOURCES,
    optionLabels: {
      internal: 'Its own modulator',
      layer0: 'Oscillator 1', layer1: 'Oscillator 2', layer2: 'Noise 1', layer3: 'Noise 2',
    },
  },
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
    type: 'option', label: 'Filter', options: ['off', 'lowpass', 'highpass', 'bandpass', 'notch', 'peak', 'ladder', 'comb'],
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

/** What an insert slot can be, in the order the picker offers them. */
export const INSERT_KINDS = ['off', 'drive', 'crusher', 'ring', 'fold', 'body', 'comb'] as const

/**
 * One insert slot: a kind, a side of the amplifier, and the fields of all seven kinds.
 *
 * Every kind's fields are bounded here whether or not its slot is set to that kind, because a slot
 * remembers what it was — a crusher turned into a drive and back is the crusher it was, and the
 * numbers it kept in the meantime have to be numbers.
 */
const INSERT_FIELDS: Record<string, FieldSpec> = {
  kind: { type: 'option', label: 'Insert', options: INSERT_KINDS },
  place: { type: 'option', label: 'Position', options: ['pre', 'post'], optionLabels: { pre: 'Before the amp', post: 'After the amp' } },
  amount: num('Amount', 0, 1),
  drive: num('Drive', 0, 1),
  bitDepth: num('Bit depth', 1, 16, 1, { unit: 'bit' }),
  crush: num('Sample crush', 0, 1),
  ratio: num('Ring ratio', 0.01, 16, 0.01),
  // Up to sixteen kilohertz, because the bright end is where this family of sound lives: a
  // modern interface click is mostly air, and a body capped at eight could not reach it.
  frequency: num('Body', 40, 16000, 1, { unit: 'Hz', scale: 'log' }),
  spread: num('Inharmonicity', 0, 1),
  decay: num('Ring', 0.01, 3, 0.001, SECONDS),
  partials: num('Partials', 1, 6, 1),
  time: num('Comb time', 0.2, 50, 0.1, { unit: 'ms' }),
  feedback: num('Comb feedback', 0, 0.95),
}

const AMP_FIELDS: Record<string, FieldSpec> = {
  attack: num('Attack', 0, 2, 0.001, SECONDS),
  hold: num('Hold', 0, 2, 0.001, SECONDS),
  decay: num('Decay', 0, 2, 0.001, SECONDS),
  sustain: num('Sustain', 0, 1),
  release: num('Release', 0, 2, 0.001, SECONDS),
  curve: num('Envelope curve', 0.25, 6, 0.05),
}

/** What a master effect slot can be, in the order the picker offers them. */
export const FX_KINDS = ['off', 'flanger', 'chorus', 'phaser', 'delay', 'reverb', 'widener'] as const

/** The three of them, in the order the sound meets them. */
export const FX_SLOTS = ['x', 'y', 'z'] as const

/**
 * One master effect slot: a kind, whether it stands in the sound or beside it, and the fields of
 * all six kinds. The same shape an insert slot has, for the same reason.
 */
const FX_SLOT_FIELDS: Record<string, FieldSpec> = {
  kind: { type: 'option', label: 'Effect', options: FX_KINDS },
  mode: { type: 'option', label: 'Placing', options: ['insert', 'send'], optionLabels: { insert: 'In the sound', send: 'Beside it' } },
  mix: num('Mix', 0, 1),
  rate: num('Rate', 0.05, 8, 0.05, { unit: 'Hz' }),
  depth: num('Depth', 0, 1),
  feedback: num('Feedback', 0, 0.95),
  time: num('Time', 0.001, 1, 0.001, SECONDS),
  size: num('Size', 0, 1),
  damping: num('Damping', 0, 1),
  width: num('Spread', 0, 1),
}

/** What is left at the master once the three effects are their own slots. */
const FX_FIELDS: Record<string, FieldSpec> = {
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
/**
 * The free modulation slots, beside the amplifier's own envelope.
 *
 * The reference has nine and numbers them once, E1 to E3 then L4 to L9, so the letter says what
 * each holds rather than where it sits. The first is a layer's amp envelope and is not free, which
 * leaves eight.
 */
export const MOD_COUNT = 8
/** The performers, the reference's first three modulator slots, and how many steps a row has. */
export const PERFORMER_COUNT = 3
export const STEP_COUNT = 16


/** Everywhere an LFO may point. Built from the layers, so it cannot name one that is not there. */
export const LFO_DESTINATIONS = ['pitch', 'cutoff', 'resonance', 'pulseWidth', 'gain', 'pan', 'pm', 'insertA', 'insertB', 'insertC'] as const
export const LFO_TARGETS: string[] = [
  'off',
  ...Array.from({ length: LAYER_COUNT }, (_, layer) => LFO_DESTINATIONS.map((where) => `layers[${layer}].${where}`)).flat(),
]

const LFO_TARGET_LABELS: Record<string, string> = Object.fromEntries(
  LFO_TARGETS.map((target) => {
    if (target === 'off') return [target, 'Off']
    const [, layer, where] = /^layers\[(\d)\]\.(\w+)$/.exec(target) ?? []
    const named: Record<string, string> = {
      pitch: 'pitch', cutoff: 'cutoff', resonance: 'resonance', pulseWidth: 'width', gain: 'gain',
      pan: 'pan', pm: 'PM depth', insertA: 'insert A', insertB: 'insert B', insertC: 'insert C',
    }
    return [target, `Layer ${Number(layer) + 1} ${named[where ?? ''] ?? where}`]
  }),
)

/**
 * One table for a slot, holding the fields of both kinds it can be.
 *
 * Depth runs both ways for both, where an oscillator's used to run one way only: a shape that can
 * be turned upside down is worth more than a rule that says it cannot.
 */
export const MOD_FIELDS: Record<string, FieldSpec> = {
  kind: { type: 'option', label: 'Modulator', options: ['envelope', 'lfo'], optionLabels: { envelope: 'Envelope', lfo: 'Switcher LFO' } },
  enabled: { type: 'boolean', label: 'Enabled' },
  target: { type: 'option', label: 'Target', options: LFO_TARGETS, optionLabels: LFO_TARGET_LABELS },
  depth: num('Depth', -1, 1),
  delay: num('Delay', 0, 1, 0.001, SECONDS),
  attack: num('Attack', 0, 2, 0.001, SECONDS),
  hold: num('Hold', 0, 2, 0.001, SECONDS),
  decay: num('Decay', 0, 2, 0.001, SECONDS),
  sustain: num('Sustain', 0, 1),
  release: num('Release', 0, 2, 0.001, SECONDS),
  curve: num('Envelope curve', 0.25, 6, 0.05),
  shape: { type: 'option', label: 'Shape', options: ['sine', 'triangle', 'square', 'saw', 'noise'] },
  rate: num('Rate', 0.1, 40, 0.1, { unit: 'Hz', scale: 'log' }),
  phase: num('Phase', 0, 1),
}

/**
 * Every field table in one place. The parser reads it, the docs page is generated from it, a
 * freshly exposed control takes its bounds from it, and the patch reader clamps against it — so a
 * field's range is written once and four things cannot disagree about it.
 */
export const PERFORMER_FIELDS: Record<string, FieldSpec> = {
  enabled: { type: 'boolean', label: 'Enabled' },
  rate: num('Rate', 0.25, 8, 0.25, { unit: 'cycles' }),
  shape: { type: 'option', label: 'Shape', options: ['step', 'line', 'curve'] },
  bipolar: { type: 'boolean', label: 'Bipolar' },
  depth: num('Depth', 0, 1),
  target: { type: 'option', label: 'Target', options: LFO_TARGETS, optionLabels: LFO_TARGET_LABELS },
}

export const AUDIO_FIELDS = {
  patch: PATCH_FIELDS,
  mod: MOD_FIELDS,
  performer: PERFORMER_FIELDS,
  fx: FX_FIELDS,
  fxSlot: FX_SLOT_FIELDS,
  master: MASTER_FIELDS,
} as const

export type LayerSection = 'root' | 'source' | 'pitch' | 'filter' | 'insertA' | 'insertB' | 'insertC' | 'amp'

export const LAYER_SECTIONS: Record<LayerSection, Record<string, FieldSpec>> = {
  root: LAYER_FIELDS,
  source: SOURCE_FIELDS,
  pitch: PITCH_FIELDS,
  filter: FILTER_FIELDS,
  insertA: INSERT_FIELDS,
  insertB: INSERT_FIELDS,
  insertC: INSERT_FIELDS,
  amp: AMP_FIELDS,
}

/** The three slots, in the order the sound meets them. */
export const INSERT_SLOTS = ['insertA', 'insertB', 'insertC'] as const

/** How many layers a patch has. Fixed, and the parser refuses an index past it. */
