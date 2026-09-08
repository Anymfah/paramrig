import type { BezierCurve } from '../rigs/types.ts'

/**
 * The patch is a fixed chain, not a graph: three identical layers into shared effects. Nothing is
 * wired, only set. That constraint is the product — a generator whose routing can be rearranged is
 * a small DAW, and a small DAW is not something anyone reaches for to make a button click.
 */

export type WaveShape = 'sine' | 'triangle' | 'saw' | 'square'
export type NoiseColour = 'white' | 'pink' | 'metallic'
export type FilterKind = 'off' | 'lowpass' | 'highpass' | 'bandpass'
export type SourceKind = 'tone' | 'noise'

export type SourceSettings = {
  kind: SourceKind
  wave: WaveShape
  /** Duty cycle of the square, 0..1. Ignored by the other shapes. */
  pulseWidth: number
  colour: NoiseColour
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

export type Layer = {
  enabled: boolean
  gain: number
  /** Seconds of silence before this layer starts. A transient is a layer that starts on time and
   * ends quickly while the others are still arriving. */
  offset: number
  source: SourceSettings
  pitch: PitchSettings
  filter: FilterSettings
  shaper: ShaperSettings
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
}

export type MasterSettings = {
  gain: number
  /** 0..1 of soft clipping. */
  limiter: number
  /** Seconds of ramp at the tail. Never zero: a sound cut mid-cycle is a click. */
  fadeOut: number
}

export type AudioPatch = {
  version: 1
  /** Seconds. */
  duration: number
  seed: number
  layers: Layer[]
  fx: FxSettings
  master: MasterSettings
}
