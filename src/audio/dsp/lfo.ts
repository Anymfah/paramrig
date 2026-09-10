import type { LfoShape } from '../types.ts'

/**
 * The other kind of movement.
 *
 * An envelope says what happens once. This says what keeps happening, and a sound with nothing
 * keeping happening reads as a sample rather than as an event — which is most of what separates a
 * synthesised effect that sounds cheap from one that does not.
 *
 * It runs on the patch's own clock rather than on each layer's, so two layers pointed at the same
 * modulator move together even when one of them starts late.
 */

export type LfoState = { held: number; until: number }

export function createLfoState(random: () => number): LfoState {
  return { held: random() * 2 - 1, until: 0 }
}

/** −1 to 1. Noise is sampled and held at the rate, which is what makes it a modulator and not hiss. */
export function lfoAt(lfo: { shape: LfoShape; rate: number; phase: number }, seconds: number, state: LfoState, random: () => number): number {
  const phase = (seconds * lfo.rate + lfo.phase) % 1
  const at = phase < 0 ? phase + 1 : phase
  if (lfo.shape === 'sine') return Math.sin(at * Math.PI * 2)
  if (lfo.shape === 'triangle') return 4 * Math.abs(at - 0.5) - 1
  if (lfo.shape === 'square') return at < 0.5 ? 1 : -1
  if (lfo.shape === 'saw') return 2 * at - 1
  if (seconds >= state.until) {
    state.held = random() * 2 - 1
    state.until = seconds + 1 / Math.max(0.1, lfo.rate)
  }
  return state.held
}

/** How far each destination travels at full depth. Written here so the board and the ear agree. */
export const LFO_RANGE = {
  /** Octaves either side. */
  pitch: 1,
  /** Octaves either side. */
  cutoff: 3,
  /** Absolute, added to the duty cycle. */
  pulseWidth: 0.45,
  /** How much of the layer's own gain it can take away. It only ever ducks, never boosts. */
  gain: 1,
} as const

export type LfoDestination = keyof typeof LFO_RANGE

/** The layer and destination a target names, or null for `off` and anything unrecognised. */
export function readLfoTarget(target: string): { layer: number; destination: LfoDestination } | null {
  const found = /^layers\[(\d+)\]\.(\w+)$/.exec(target)
  if (!found) return null
  const layer = Number(found[1])
  const destination = found[2] as LfoDestination
  if (!Number.isInteger(layer) || !Object.hasOwn(LFO_RANGE, destination)) return null
  return { layer, destination }
}
