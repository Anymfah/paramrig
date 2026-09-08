import type { FilterKind } from '../types.ts'

/**
 * A topology-preserving state variable filter, the Simper form.
 *
 * The reason it is this and not a biquad: every one of these filters has its cutoff swept per
 * sample, sometimes across several octaves in a tenth of a second. A biquad recomputed that fast
 * goes unstable and spits — its coefficients assume a cutoff that is holding still. This one is
 * built to be re-tuned every sample, and it hands back low, band and high from the same two
 * state variables.
 */

export type FilterState = { ic1: number; ic2: number }

export function createFilter(): FilterState {
  return { ic1: 0, ic2: 0 }
}

/**
 * `cutoff` is clamped below Nyquist because the tuning runs through tan(), which goes to infinity
 * there. Resonance stops short of self-oscillation: a filter that rings on its own is a feature of
 * an instrument, not of a generator meant to be predictable.
 */
export function filterSample(
  state: FilterState,
  kind: FilterKind,
  input: number,
  cutoff: number,
  resonance: number,
  sampleRate: number,
): number {
  if (kind === 'off') return input
  const nyquist = sampleRate * 0.5
  const fc = Math.min(nyquist * 0.98, Math.max(10, cutoff))
  const g = Math.tan((Math.PI * fc) / sampleRate)
  const k = 2 - 2 * Math.min(0.97, Math.max(0, resonance))
  const a1 = 1 / (1 + g * (g + k))
  const a2 = g * a1
  const a3 = g * a2
  const v3 = input - state.ic2
  const v1 = a1 * state.ic1 + a2 * v3
  const v2 = state.ic2 + a2 * state.ic1 + a3 * v3
  state.ic1 = 2 * v1 - state.ic1
  state.ic2 = 2 * v2 - state.ic2
  if (kind === 'lowpass') return v2
  if (kind === 'bandpass') return v1
  return input - k * v1 - v2
}
