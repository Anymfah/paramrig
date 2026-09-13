import type { BodyProfile } from '../types.ts'

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
  profile: BodyProfile | ''
  character: number
  /** 2r·cos(w), r² and the input scaling that takes the frequency out of the level. */
  feedback: number
  damping: number
  gain: number
  /** Whether this partial lands under Nyquist and therefore sounds at all. */
  live: boolean
}

export function createModal(partials: number): ModalState[] {
  return Array.from({ length: partials }, () => ({ y1: 0, y2: 0, frequency: 0, spread: 0, decay: 0, rate: 0, profile: '', character: -1, feedback: 0, damping: 0, gain: 0, live: false }))
}

/**
 * The partials of a free bar, which is the shape most small struck things are near enough to.
 * `spread` collapses them onto the fundamental at zero and opens them out to the real ratios at
 * one, so one control walks from a pitched ring to a clank.
 */
const BAR = [1, 2.756, 5.404, 8.933, 13.34, 18.64]
const BAR_DAMP = [1, 1.7, 2.5, 3.4, 4.4, 5.5]
const BAR_GAIN = [1, 1, 1, 1, 1, 1]

/**
 * Nearby modes packed close, like a plate rather than a rod. Higher partials live longer than a
 * bar's, which is why a plate keeps shimmering after a bar would have gone.
 */
const PLATE = [1, 1.59, 2.14, 2.30, 2.65, 2.92]
const PLATE_DAMP = [1, 1.06, 1.12, 1.2, 1.3, 1.42]
const PLATE_GAIN = [1, 0.92, 0.82, 0.72, 0.62, 0.52]

/** A hollow air, the first mode loud and the rest standing as overtones of a cavity. */
const CAVITY = [1, 1.89, 2.36, 2.63, 3.21, 3.89]
const CAVITY_DAMP = [1, 1.4, 1.8, 2.2, 2.8, 3.4]
const CAVITY_GAIN = [1, 0.55, 0.4, 0.28, 0.18, 0.12]

/** A circular membrane: Bessel-ish ratios, the top dying fast. */
const MEMBRANE = [1, 1.59, 2.14, 2.30, 2.65, 3.50]
const MEMBRANE_DAMP = [1, 2.1, 3.2, 4.1, 5.2, 6.4]
const MEMBRANE_GAIN = [1, 0.7, 0.45, 0.35, 0.22, 0.12]

/** Bright, slow to lose its top — the opposite of a membrane. */
const GLASS = [1, 2.76, 5.2, 8.9, 14.1, 21]
const GLASS_DAMP = [1, 1.05, 1.15, 1.3, 1.5, 1.8]
const GLASS_GAIN = [0.7, 1, 0.85, 0.7, 0.55, 0.4]

/** Invented: golden-ratio spacings that no object actually rings at. */
const AETHER = [1, 1.414, 2.618, 3.142, 4.669, 7.389]
const AETHER_DAMP = [1, 0.85, 1.2, 1.6, 2.1, 2.8]
const AETHER_GAIN = [0.85, 1, 0.6, 0.9, 0.45, 0.7]

const PROFILES: Record<BodyProfile, { ratios: number[]; damping: number[]; gains: number[] }> = {
  bar: { ratios: BAR, damping: BAR_DAMP, gains: BAR_GAIN },
  plate: { ratios: PLATE, damping: PLATE_DAMP, gains: PLATE_GAIN },
  cavity: { ratios: CAVITY, damping: CAVITY_DAMP, gains: CAVITY_GAIN },
  membrane: { ratios: MEMBRANE, damping: MEMBRANE_DAMP, gains: MEMBRANE_GAIN },
  glass: { ratios: GLASS, damping: GLASS_DAMP, gains: GLASS_GAIN },
  aether: { ratios: AETHER, damping: AETHER_DAMP, gains: AETHER_GAIN },
}

export const BODY_PROFILES = Object.keys(PROFILES) as BodyProfile[]

export function bodyProfileOf(value: unknown): BodyProfile {
  return typeof value === 'string' && Object.hasOwn(PROFILES, value) ? value as BodyProfile : 'bar'
}

export function modalPartial(index: number, frequency: number, spread: number, profile: BodyProfile = 'bar', character = 0.5): number {
  const bank = PROFILES[profile] ?? PROFILES.bar!
  const ratio = bank.ratios[index] ?? 1
  const colour = Math.min(1, Math.max(0, character))
  const skewed = 1 + (ratio - 1) * (0.7 + colour * 0.6)
  return frequency * (1 + (skewed - 1) * spread)
}

/**
 * One sample through the bank. `decay` is the time the fundamental takes to fall by sixty
 * decibels; the rest follow it down faster.
 */
/**
 * What the normalisation is anchored to: a plain number, and it has to stay one.
 *
 * The correction below divides out `sin(w)`, which leaves the level of every partial the same and
 * arbitrary; this puts it back at a familiar place — the level a partial at eight kilohertz used to
 * come out at, at the rate a file is written at. It is a *scale constant*, not a frequency, which
 * is the whole point. Written as `sin(2π · 8000 / sampleRate)` it would move with the machine and
 * put the rate straight back into the answer: a body would ring twice as loud at 96 kHz as at 44.1,
 * which is exactly the fault this replaced.
 */
const REFERENCE_LEVEL = Math.sin((2 * Math.PI * 8000) / 44100)
/** And the rate everything here is anchored at, which is the rate a file is written at. */
const REFERENCE_RATE = 44100

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
 * that landed near Nyquist swamped the fundamental it was supposed to colour. Taking that back out
 * is what makes `frequency` choose pitch and `gain` choose level, which is what both claim to do.
 *
 * And it is `sin(w)` that takes it out, not the resonator's own peak magnitude. Struck with one
 * sample, this filter rings at `sin((n+1)w)·rᶰ / sin(w)`: the frequency term is the sine, exactly,
 * and nothing else. Dividing by the peak magnitude instead was very nearly the same number — the
 * two agree to three figures across the whole band at 44 100 — but only at 44 100, because that
 * magnitude also depends on how close the pole sits to the circle, and the pole moves with the
 * rate. Measured, a body was 1.8 times louder at 96 kHz than at 22 050 for the same patch: the
 * shipped `ui-click` came out 71 per cent hotter on a machine running at 48 000 than on the one it
 * was levelled at, and `glass-bell` clipped at 96. This form is flat to one per cent across four
 * rates and across four octaves, and it costs one sine where the other cost eight trigonometric
 * calls a tuning.
 */
function tune(state: ModalState, index: number, frequency: number, spread: number, decay: number, sampleRate: number, nyquist: number, profile: BodyProfile, character: number): void {
  state.frequency = frequency
  state.spread = spread
  state.decay = decay
  state.rate = sampleRate
  state.profile = profile
  state.character = character
  const bank = PROFILES[profile] ?? PROFILES.bar!
  const partial = modalPartial(index, frequency, spread, profile, character)
  state.live = partial < nyquist
  if (!state.live) return
  const damp = (bank.damping[index] ?? 1) * (0.7 + Math.min(1, Math.max(0, character)) * 0.6)
  const seconds = Math.max(0.005, decay / damp)
  // r is how much of the ring survives one sample; 0.001 is sixty decibels down.
  const r = Math.min(0.99999, Math.exp(Math.log(0.001) / (seconds * sampleRate)))
  const w = (2 * Math.PI * partial) / sampleRate
  state.feedback = 2 * r * Math.cos(w)
  state.damping = r * r
  /*
   * And divided by how much a sustained source builds up in it, which is a function of the rate.
   *
   * The note above is about a resonator being *struck*, and for a struck one `sin(w)` is the whole
   * story. Nothing in this engine strikes it: a body is fed the layer's own output, continuously,
   * and a resonator driven at its resonance climbs to about `1/(1 − r)` times what goes in. That
   * factor is `decay · sampleRate / 6.9` — proportional to the machine's rate — so the same patch
   * came out sixty-five per cent louder at 48 000 than at 44 100 (`ui-click`, measured) and clipped
   * at 96 000. Dividing it out against what it would have been at the reference rate leaves the
   * build-up as a function of the decay time alone, which is what the dial claims it is, and leaves
   * the number at 44 100 exactly where it was, which is where the library is levelled.
   */
  const reference = Math.min(0.99999, Math.exp(Math.log(0.001) / (seconds * REFERENCE_RATE)))
  state.gain = (Math.sin(w) / REFERENCE_LEVEL) * ((1 - r) / (1 - reference)) * (bank.gains[index] ?? 1)
}

export function modalSample(
  states: ModalState[],
  input: number,
  frequency: number,
  spread: number,
  decay: number,
  sampleRate: number,
  profile: BodyProfile = 'bar',
  character = 0.5,
  partials = states.length,
): number {
  const nyquist = sampleRate * 0.48
  let sum = 0
  let rang = 0
  for (let i = 0; i < Math.min(states.length, Math.max(1, Math.round(partials))); i += 1) {
    const state = states[i]
    if (!state) continue
    if (state.frequency !== frequency || state.spread !== spread || state.decay !== decay || state.rate !== sampleRate || state.profile !== profile || state.character !== character) {
      tune(state, i, frequency, spread, decay, sampleRate, nyquist, profile, character)
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
