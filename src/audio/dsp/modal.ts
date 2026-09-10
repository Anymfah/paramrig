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

/**
 * One resonator: the two samples it remembers, and the three numbers it rings by.
 *
 * Those three come out of an exponential, a logarithm, a cosine, a sine and two peak gains, and
 * they only change when the body is retuned — which never happens inside the sample loop. They
 * were being recomputed for every partial, on both channels, at every sample, which made this the
 * hottest code in the engine by a distance. `tuning` is what they were computed for; a mismatch
 * is the only thing that pays for them again.
 */
export type ModalState = {
  y1: number
  y2: number
  /** What the three below were computed for. Four numbers, not a key: a key is an allocation. */
  frequency: number
  spread: number
  decay: number
  rate: number
  /** 2r·cos(w), r² and the input scaling that takes the frequency out of the level. */
  feedback: number
  damping: number
  gain: number
  /** Whether this partial lands under Nyquist and therefore sounds at all. */
  live: boolean
}

export function createModal(partials: number): ModalState[] {
  return Array.from({ length: partials }, () => ({ y1: 0, y2: 0, frequency: 0, spread: 0, decay: 0, rate: 0, feedback: 0, damping: 0, gain: 0, live: false }))
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
/**
 * How loud a two-pole resonator is at its own resonance, which is not the same at every frequency.
 * |H| = 1 / |1 - 2r·cos(w)·e^(-jw) + r²·e^(-2jw)|, evaluated on the unit circle at w.
 */
function peakGain(w: number, r: number): number {
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  const re = 1 - 2 * r * cw * cw + r * r * (cw * cw - sw * sw)
  const im = r * (1 - r) * 2 * sw * cw
  return 1 / Math.max(1e-12, Math.sqrt(re * re + im * im))
}

/**
 * Eight kilohertz is the frequency whose level the normalisation leaves alone.
 *
 * In radians per sample, so it has to be worked out at the rate in hand. It used to be a constant
 * with 44 100 baked into it, which made the untouched frequency eight and a half kilohertz on a
 * machine running at 48 000 — the same patch, normalised against a different note, for no reason
 * anybody could have found from the plate.
 */
const REFERENCE_HZ = 8000

/**
 * What a partial rings by, computed once per tuning.
 *
 * Unity in, which is what modal synthesis wants and what the first attempt got wrong. Scaling the
 * input by (1 − r) normalises a resonator being *driven* — held at its own frequency until it
 * settles — but these are struck, not driven, and a long ring means r sits a hair under one, so
 * that scaling took the sound to nothing. A sustained source into a long ring does build up, as a
 * bowed thing does; the master limiter is what catches that.
 *
 * Normalised for frequency, which it was not. A two-pole resonator's peak gain depends on where it
 * sits: measured across the band, one partial was up to twenty-five decibels louder than another
 * purely because of its frequency — +10.7 dB at 2 kHz, flat around 10, and +14.5 dB by 20.8 kHz as
 * the poles close on the real axis. So a body's own pitch silently set its loudness, and a partial
 * that landed near Nyquist swamped the fundamental it was supposed to colour. Dividing the input by
 * |H| at the resonant frequency takes that back out, so `frequency` chooses pitch and `gain`
 * chooses level, which is what both controls claim to do.
 */
function tune(state: ModalState, index: number, frequency: number, spread: number, decay: number, sampleRate: number, nyquist: number): void {
  state.frequency = frequency
  state.spread = spread
  state.decay = decay
  state.rate = sampleRate
  const partial = modalPartial(index, frequency, spread)
  state.live = partial < nyquist
  if (!state.live) return
  const seconds = Math.max(0.005, decay / (DAMPING[index] ?? 1))
  // r is how much of the ring survives one sample; 0.001 is sixty decibels down.
  const r = Math.min(0.99999, Math.exp(Math.log(0.001) / (seconds * sampleRate)))
  const w = (2 * Math.PI * partial) / sampleRate
  state.feedback = 2 * r * Math.cos(w)
  state.damping = r * r
  state.gain = peakGain((2 * Math.PI * REFERENCE_HZ) / sampleRate, r) / peakGain(w, r)
}

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
    if (state.frequency !== frequency || state.spread !== spread || state.decay !== decay || state.rate !== sampleRate) {
      tune(state, i, frequency, spread, decay, sampleRate, nyquist)
    }
    if (!state.live) continue
    rang += 1
    const value = input * state.gain + state.feedback * state.y1 - state.damping * state.y2
    state.y2 = state.y1
    state.y1 = value
    sum += value
  }
  // A body tuned above what the rate can carry has nothing to ring with, and silence would be the
  // wrong answer — the strike still happened. Normalised by the count that actually sounded, so
  // adding partials thickens the sound rather than raising its level.
  return rang > 0 ? sum / Math.sqrt(rang) : input
}
