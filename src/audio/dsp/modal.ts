/**
 * A struck object.
 *
 * Oscillators make notes; things that are hit make something else. Strike a small metal part and
 * what you hear is a handful of resonances, each at its own frequency and each dying at its own
 * rate, excited by a click that is over almost before it starts. No amount of filtering a sawtooth
 * arrives at that, which is why a synthesised interface click tends to sound like a beep and a
 * recorded one sounds like a mechanism.
 *
 * Each partial is a two-pole resonator — the cheapest thing that rings — and the bank is fed
 * whatever the layer already produced. A short noise burst in gives a click with a body; a longer
 * source in gives the same body being scraped.
 */

export type ModalState = { y1: number; y2: number }

export function createModal(partials: number): ModalState[] {
  return Array.from({ length: partials }, () => ({ y1: 0, y2: 0 }))
}

/**
 * The partials of a free bar, which is the shape most small struck things are near enough to.
 * `spread` collapses them onto the fundamental at zero and opens them out to the real ratios at
 * one, so one control walks from a pitched ring to a clank.
 */
const BAR = [1, 2.756, 5.404, 8.933, 13.34, 18.64]

/** Higher partials of a real object die first, and an object where they do not sounds synthetic. */
const DAMPING = [1, 1.7, 2.5, 3.4, 4.4, 5.5]

export function modalPartial(index: number, frequency: number, spread: number): number {
  const ratio = 1 + ((BAR[index] ?? 1) - 1) * spread
  return frequency * ratio
}

/**
 * One sample through the bank. `decay` is the time the fundamental takes to fall by sixty
 * decibels; the rest follow it down faster.
 */
export function modalSample(
  states: ModalState[],
  input: number,
  frequency: number,
  spread: number,
  decay: number,
  sampleRate: number,
): number {
  const nyquist = sampleRate * 0.48
  let sum = 0
  let rang = 0
  for (let i = 0; i < states.length; i += 1) {
    const state = states[i]
    if (!state) continue
    const partial = modalPartial(i, frequency, spread)
    if (partial >= nyquist) continue
    rang += 1
    const seconds = Math.max(0.005, decay / (DAMPING[i] ?? 1))
    // r is how much of the ring survives one sample; 0.001 is sixty decibels down.
    const r = Math.min(0.99999, Math.exp(Math.log(0.001) / (seconds * sampleRate)))
    const w = (2 * Math.PI * partial) / sampleRate
    /*
     * Unity in, which is what modal synthesis wants and what the first attempt got wrong.
     * Scaling the input by (1 − r) normalises a resonator being *driven* — held at its own
     * frequency until it settles — but these are struck, not driven, and a long ring means r sits
     * a hair under one, so that scaling took the sound to nothing. A sustained source into a long
     * ring does build up, as a bowed thing does; the master limiter is what catches that.
     */
    const value = input + 2 * r * Math.cos(w) * state.y1 - r * r * state.y2
    state.y2 = state.y1
    state.y1 = value
    sum += value
  }
  // A body tuned above what the rate can carry has nothing to ring with, and silence would be the
  // wrong answer — the strike still happened. Normalised by the count that actually sounded, so
  // adding partials thickens the sound rather than raising its level.
  return rang > 0 ? sum / Math.sqrt(rang) : input
}
