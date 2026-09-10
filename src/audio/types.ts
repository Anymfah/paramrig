import type { BezierCurve } from '../rigs/types.ts'

/**
 * The patch is a chain that can be arranged, not a graph that can be wired.
 *
 * It began as a fixed chain — layers into shared effects, nothing routable — on the argument that
 * a generator whose routing can be rearranged is a small DAW, and nobody reaches for a small DAW
 * to make a button click. Half of that still holds and half of it did not survive contact: an
 * insert that cannot be reordered is three knobs pretending to be an effect. So the order is
 * declared in fields — which slot holds what, and which side of the envelope it stands on — and
 * never drawn with a mouse. There are no cables here, and there will not be.
 */

export type WaveShape = 'sine' | 'triangle' | 'saw' | 'square'
export type NoiseColour = 'white' | 'pink' | 'metallic'
export type FilterKind = 'off' | 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peak' | 'ladder' | 'comb'
export type SourceKind = 'tone' | 'noise' | 'table'

export type SourceSettings = {
  kind: SourceKind
  wave: WaveShape
  /** Duty cycle of the square, 0..1. Ignored by the other shapes. */
  pulseWidth: number
  /**
   * Which wavetable, and where along it. A table is a spectrum that changes shape as `position`
   * turns — the one control on a synthesiser that changes the timbre itself rather than filtering
   * what is already there. Only read when `kind` is `table`; see `dsp/wavetable.ts`.
   */
  table: string
  position: number
  colour: NoiseColour
  /**
   * Copies of the oscillator, detuned against each other. One oscillator is one oscillator: it is
   * thin because there is nothing for it to beat against, and no envelope fixes that. Three at a
   * few cents apart is the oldest trick there is for making a synthesiser sound expensive.
   */
  voices: number
  /** Cents between the outermost voices. Does nothing at one voice. */
  detune: number
  /**
   * A second oscillator, modulating this one's phase rather than being added to it.
   *
   * Subtractive synthesis takes a harmonic wave and removes from it, so everything it makes is
   * some filtered version of a buzz. Phase modulation makes partials that are not multiples of
   * anything — bells, struck metal, glass, the growl in an engine — and those are exactly the
   * timbres a synthesised effect is usually missing when it sounds cheap. It is at its best on a
   * sine carrier, as it is in every synthesiser that has it.
   */
  fmRatio: number
  /** Depth, in radians of phase. Zero is a true bypass. */
  fmIndex: number
  /** How much of the depth is gone by the end of the layer, 0 to 1. A bell loses its clang. */
  fmFall: number
}

export type PitchSettings = {
  /** Hertz. Read on a logarithmic control, because pitch is heard that way. */
  start: number
  /** Semitones travelled across the layer's life. Negative falls. */
  slide: number
  /** How the slide is spent over that life. */
  slideCurve: BezierCurve
  vibratoRate: number
  vibratoDepth: number
  /** Frequency multiplier applied part-way through. 1 is off. This is what makes a coin a coin. */
  arpeggioRatio: number
  /** Where the multiplier lands, 0..1 of the layer's life. */
  arpeggioAt: number
  /**
   * Cents of random detune, drawn once per render from the patch seed. Pointless in an exported
   * WAV and the whole reason to export a patch instead: a click replayed two hundred times with
   * the same samples wears on the ear, and the same click ±15 cents does not.
   */
  jitter: number
}

export type FilterSettings = {
  kind: FilterKind
  cutoff: number
  /** 0..1. Approaches self-oscillation at the top, never reaches it. */
  resonance: number
  /** Octaves the cutoff travels across the layer's life. Signed. */
  envAmount: number
  envCurve: BezierCurve
}

/**
 * Drive, bits and crush, as a preset still writes them.
 *
 * Not a stage of the chain any more — `makeLayer` reads this shorthand into two insert slots. It
 * survives because `shaper: { drive: 0.35 }` says what a preset means, where the slot it becomes
 * says how the patch files it.
 */
export type ShaperSettings = {
  /** 0 is a true bypass, not a gentle one. */
  drive: number
  /** Bits kept. 16 is off. */
  bitDepth: number
  /** 0..1 sample-and-hold, the other half of a lo-fi voice. */
  crush: number
}

export type AmpSettings = {
  attack: number
  hold: number
  decay: number
  /** Level held between decay and release, 0..1. */
  sustain: number
  release: number
  /** 1 is linear. Above it, falls behave the way a struck thing behaves. */
  curve: number
}

/** Two channels of samples. Everything downstream of the engine takes this shape. */
export type Stereo = { left: Float32Array; right: Float32Array }

/**
 * A bank of resonances the layer is played through: what turns a click into a struck thing rather
 * than a click. At no amount it is a true bypass.
 *
 * The same shorthand as `ShaperSettings`: what a preset writes, read into the third insert slot,
 * standing after the amplifier where a body has always stood.
 */
export type ResonatorSettings = {
  amount: number
  frequency: number
  /** 0 collapses every partial onto the fundamental; 1 opens them to the ratios of a free bar. */
  spread: number
  /** Seconds for the fundamental to fall sixty decibels. */
  decay: number
  partials: number
}

export type InsertKind = 'off' | 'drive' | 'crusher' | 'ring' | 'fold' | 'body' | 'comb'

/** Which side of the amplifier a slot stands on. */
export type InsertPlace = 'pre' | 'post'

/**
 * One of three effects a layer runs through on its way out.
 *
 * The drive and the resonator used to be built into every layer, one of each, in an order nobody
 * could change. They are two of the seven kinds a slot can be now, and the reason it matters is
 * `place`: the same body ringing before the amplifier is a filter, and after it is a struck
 * object with a tail. `render.ts` says why in more detail, and it is the difference between a
 * thing being hit and a thing being sanded.
 *
 * A slot carries the fields of every kind it could be, of which the engine reads only its own —
 * the shape `SourceSettings` and `ModSlot` already have, so that a slot changed to another kind
 * and back is the slot it was.
 */
export type InsertSlot = {
  kind: InsertKind
  place: InsertPlace
  /** How much of the treated sound is heard against the untreated, 0..1. At 0 every kind is a
   * true bypass, which is what makes a slot safe to leave switched on and turned down. */
  amount: number
  /** How hard it is pushed: saturation for `drive`, gain into the reflection for `fold`. */
  drive: number
  /** Bits kept, 16 is clean. Read by `crusher`. */
  bitDepth: number
  /** 0..1 sample-and-hold, the other half of a lo-fi voice. Read by `crusher`. */
  crush: number
  /** The ring modulator's tone, as a multiple of the layer's own pitch. Read by `ring`. */
  ratio: number
  /** The resonances, read by `body`. Hertz, then the fields `ResonatorSettings` describes. */
  frequency: number
  spread: number
  decay: number
  partials: number
  /** Milliseconds down the line, and how much of it comes back. Read by `comb`. */
  time: number
  feedback: number
}

export type Layer = {
  enabled: boolean
  gain: number
  /** −1 hard left, 0 centre, 1 hard right. */
  pan: number
  /**
   * How far the unison voices are thrown across the stereo field, 0 to 1. This is where width
   * actually comes from: detuned copies in the same place are a thicker mono sound, and the same
   * copies pushed apart are a wide one.
   */
  spread: number
  /** Seconds of silence before this layer starts. A transient is a layer that starts on time and
   * ends quickly while the others are still arriving. */
  offset: number
  source: SourceSettings
  pitch: PitchSettings
  filter: FilterSettings
  /** Three effects in a row, each saying what it is and where it stands. */
  insertA: InsertSlot
  insertB: InsertSlot
  insertC: InsertSlot
  amp: AmpSettings
}

export type FxSettings = {
  delayTime: number
  delayFeedback: number
  delayMix: number
  reverbSize: number
  reverbDamping: number
  reverbMix: number
  flangerRate: number
  flangerDepth: number
  flangerMix: number
  /** −1 dark, 0 flat, +1 bright. One control instead of a band curve, because this is a generator
   * of short sounds and nobody wants to sculpt an EQ to make a laser. */
  tone: number
  /** How far apart the two channels of the reverb and the delay are held, 0 to 1. */
  width: number
}

export type LfoShape = 'sine' | 'triangle' | 'square' | 'saw' | 'noise'

/**
 * Movement that is not the envelope. An envelope says what happens once; an LFO says what keeps
 * happening, and a sound with nothing keeping happening reads as a sample rather than as an event.
 */
export type Lfo = {
  enabled: boolean
  shape: LfoShape
  /** Hertz. */
  rate: number
  /** 0..1, scaled by whatever it is pointed at. */
  depth: number
  /** 0..1 of a cycle. */
  phase: number
  /** Where it goes: `off`, or a layer and a destination, as `layers[0].pitch`. */
  target: string
}

/**
 * An envelope that is not the amplifier's: a shape that happens once, on the patch's own clock,
 * pointed at something the way an LFO is. Depth runs both ways, because a sweep that closes a
 * filter is as common as one that opens it.
 */
export type ModEnvelope = {
  enabled: boolean
  /** Seconds before it starts. */
  delay: number
  attack: number
  hold: number
  decay: number
  sustain: number
  release: number
  curve: number
  /** −1..1, scaled by whatever it is pointed at. */
  depth: number
  /** Where it goes: `off`, or a layer and a destination, as `layers[0].cutoff`. */
  target: string
}

/**
 * What stands in a modulation slot.
 *
 * The reference numbers its nine slots once and lets the letter say what each one holds — E1 to E3
 * and then L4 to L9 is one run of nine, not two runs of three and six. A slot is that: a kind and
 * the fields of every kind it could be, of which the engine reads the ones its kind needs. The
 * same shape `SourceSettings` has had all along, where a tone carries a colour it never reads.
 */
export type ModKind = 'envelope' | 'lfo'

export type ModSlot = {
  kind: ModKind
  enabled: boolean
  /** Where it goes: `off`, or a layer and a destination, as `layers[0].cutoff`. */
  target: string
  /** −1..1, scaled by whatever it is pointed at. Both ways round, on either kind. */
  depth: number
  /** An envelope's shape, read when the kind is `envelope`. */
  delay: number
  attack: number
  hold: number
  decay: number
  sustain: number
  release: number
  curve: number
  /** An oscillator's, read when the kind is `lfo`. */
  shape: LfoShape
  rate: number
  phase: number
}

export type PerformerShape = 'step' | 'line' | 'curve'

/**
 * A drawn movement: sixteen levels read over the sound's length, the reference's Performer.
 * Twelve rows are kept, and the patch says which one every performer plays — its scene — so a
 * game can pull a different row at each trigger, and a click heard two hundred times is not the
 * same click two hundred times.
 */
export type Performer = {
  enabled: boolean
  /** Cycles of the row over the sound's length. */
  rate: number
  /** How the row is read between two steps: held, joined, or eased in and out. */
  shape: PerformerShape
  /** Bipolar: half height is rest and the swing runs both ways; otherwise the floor is rest. */
  bipolar: boolean
  /** 0..1, scaled by whatever it is pointed at. */
  depth: number
  /** Where it goes: `off`, or a layer and a destination, as `layers[0].cutoff`. */
  target: string
  /** Twelve rows of sixteen levels, 0..1. */
  patterns: number[][]
}

export type MasterSettings = {
  gain: number
  /** 0..1 of soft clipping. */
  limiter: number
  /** Seconds of ramp at the tail. Never zero: a sound cut mid-cycle is a click. */
  fadeOut: number
}

export type AudioPatch = {
  /** The shape this patch was written in. `PATCH_VERSION` in patch.ts is what this build writes. */
  version: number
  /** Seconds. */
  duration: number
  seed: number
  layers: Layer[]
  /** The nine slots the reference numbers once, less the first: that one is a layer's own amp. */
  mods: ModSlot[]
  performers: Performer[]
  /** Which row every performer plays, 0..11. */
  scene: number
  fx: FxSettings
  master: MasterSettings
}
