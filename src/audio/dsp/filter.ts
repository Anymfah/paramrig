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

/**
 * What a filter remembers.
 *
 * The state-variable models need two numbers; the ladder needs four, one per pole, plus what it
 * fed back; the comb needs a buffer as long as its lowest note. They share one struct rather than
 * a union because the renderer makes these once per layer per channel and never looks inside
 * them, and a union would make every call site ask which shape it holds.
 */
export type FilterState = {
  ic1: number
  ic2: number
  poles: Float64Array
  fed: number
  line: Float32Array | null
  at: number
}

/** A comb's line has to hold one cycle of its lowest note; twenty hertz is where the cutoff starts. */
const LOWEST = 20

export function createFilter(kind: FilterKind = 'off', sampleRate = 44100): FilterState {
  return {
    ic1: 0,
    ic2: 0,
    poles: new Float64Array(4),
    fed: 0,
    line: kind === 'comb' ? new Float32Array(Math.ceil(sampleRate / LOWEST) + 2) : null,
    at: 0,
  }
}

/** One pole of the ladder, resolved in the moment rather than a sample late. */
function pole(state: FilterState, index: number, input: number, g: number): number {
  const s = state.poles[index] ?? 0
  const v = ((input - s) * g) / (1 + g)
  const out = v + s
  state.poles[index] = out + v
  return out
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

  /*
   * A comb is not a filter with a corner, it is the sound of a thing added to itself a moment
   * later: the cutoff tunes the length of that moment, so the peaks land on its harmonics. It is
   * what gives a short sound a pitch without an oscillator, which is exactly what a generator of
   * clicks and impacts reaches for.
   */
  if (kind === 'comb') {
    const line = state.line
    if (!line) return input
    const want = Math.min(line.length - 2, Math.max(1, sampleRate / fc))
    const back = state.at - want
    const from = back < 0 ? back + line.length : back
    const i0 = Math.floor(from)
    const frac = from - i0
    const a = line[i0 % line.length] ?? 0
    const b = line[(i0 + 1) % line.length] ?? 0
    const delayed = a + (b - a) * frac
    const feedback = Math.min(0.97, Math.max(0, resonance)) * 0.98
    const value = input + delayed * feedback
    line[state.at] = value
    state.at = (state.at + 1) % line.length
    return value * (1 - feedback * 0.5)
  }

  const g = Math.tan((Math.PI * fc) / sampleRate)

  /*
   * Four poles and a feedback path, which is the shape every ladder has had since 1965. The
   * feedback is a sample old and soft-clipped: resolving it in the moment as well would be more
   * faithful and would also let a swept cutoff at high resonance run away, and this is a filter in
   * a generator, not a filter someone is playing.
   */
  if (kind === 'ladder') {
    const amount = Math.min(1, Math.max(0, resonance)) * 3.6
    const u = input - amount * Math.tanh(state.fed)
    const y = pole(state, 3, pole(state, 2, pole(state, 1, pole(state, 0, u, g), g), g), g)
    state.fed = y
    // Feedback takes the bottom out as it goes up — nine decibels of it at half resonance, which
    // is the ladder everyone knows and also a filter that goes quiet when you turn a knob that
    // says nothing about level. Put back what the feedback took.
    return y * (1 + amount * 0.6)
  }
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
  // The remaining models are sums of the three the two integrators already give: a notch is the
  // high plus the low, a peak is the high minus it, and an allpass is the high, the low, and the
  // band taken out twice. None of them costs another filter.
  if (kind === 'notch') return input - k * v1
  if (kind === 'peak') return input - k * v1 - 2 * v2
  return input - k * v1 - v2
}
