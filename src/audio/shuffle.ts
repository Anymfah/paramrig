import { AUDIO_FIELDS, FX_SLOTS, LAYER_SECTIONS, type FieldSpec, type LayerSection } from './fields.ts'
import { makeLayer, makePatch, silentLayer } from './patch.ts'
import { mulberry32 } from './dsp/rng.ts'
import { EASE_OUT, LINEAR } from './dsp/curve.ts'
import type { AudioPatch, Layer, NoiseColour, WaveShape } from './types.ts'
import { monoSum, renderPatch } from './dsp/render.ts'

/**
 * Two ways to arrive at a sound without setting a hundred fields.
 *
 * A uniform draw across every field is not one of them. Every parameter has a range in which it
 * does something musical and a much larger range in which it does not, and rolling all of them at
 * once lands outside all the small ranges at the same time — which is why a naive randomiser
 * produces noise nine times out of ten and gets used once. What follows draws from the ranges that
 * make sounds, and lets the layers decide what kind of sound it is.
 */

const pick = <T,>(random: () => number, choices: readonly T[]): T =>
  choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))] as T

const between = (random: () => number, low: number, high: number) => low + random() * (high - low)

/** Frequencies and times are heard logarithmically, so they are drawn that way. */
const logBetween = (random: () => number, low: number, high: number) =>
  Math.exp(between(random, Math.log(low), Math.log(high)))

const chance = (random: () => number, odds: number) => random() < odds

const WAVES: WaveShape[] = ['sine', 'triangle', 'saw', 'square']
const COLOURS: NoiseColour[] = ['white', 'pink', 'metallic']

/** The loudest thing in a patch, as it will actually be heard. */
function peakOf(patch: AudioPatch, sampleRate: number): number {
  const heard = monoSum(renderPatch(patch, sampleRate))
  let peak = 0
  for (let i = 0; i < heard.length; i += 1) {
    const size = Math.abs(heard[i] ?? 0)
    if (size > peak) peak = size
  }
  return peak
}

/**
 * What a drawn patch actually comes out at, and the make-up that lands it where it belongs.
 *
 * The dice cannot know how loud what they drew will be: a lone noise layer behind a four-pole
 * filter is twenty-five decibels quieter than the same draw with a tone in front of it, and a
 * button that hands back silence one press in a hundred is a button people stop trusting. So the
 * patch is rendered once and the master gain is moved to put the result where a sound should sit.
 * It is the one place in this file that listens to what it made.
 *
 * Two things it gets right that are easy to get wrong.
 *
 * It listens at the rate the sound will be played at. Half the rate was a quarter of the work and
 * looked safe — but a resonant filter or a ring modulator sitting above eleven kilohertz is not
 * there at all in a 22 050 render, and that is exactly what a nudge to a resonance produces.
 *
 * And it listens with the master out of the way — limiter off, and the gain turned right down.
 * What leaves the master is limited and then clamped, so at any ordinary gain it reads 1.0 whether
 * the sound is a hair over or ten times over: a make-up worked out from that number can only ever
 * take a quarter off, and a draw that arrived four times too loud came back three times too loud.
 * Rendered a good six octaves below the clamp, nothing touches the signal on its way out, and the
 * peak divided back up is the true one. Everything after the gain is linear, so it is exact.
 */
const PROBE_GAIN = 1 / 64

function fit(patch: AudioPatch, sampleRate = 44100, target = 0.75): AudioPatch {
  const raw = peakOf({ ...patch, master: { ...patch.master, gain: PROBE_GAIN, limiter: 0 } }, sampleRate) / PROBE_GAIN
  if (raw <= 1e-6) return patch
  const gain = Math.min(3, Math.max(0.05, target / raw))
  return { ...patch, master: { ...patch.master, gain } }
}

/**
 * Where to put a corner, given the note it is cutting.
 *
 * Drawn on its own, a cutoff and a pitch make a silent sound about one time in thirty: a tone at
 * two kilohertz behind a low-pass at four hundred, or a tone at ninety behind a high-pass at eight
 * thousand, is a patch with nothing left in it. A corner belongs somewhere relative to the note it
 * is working on — above it to darken, below it to thin, around it to colour — and noise, which has
 * no fundamental, keeps the wide range because there is always something either side.
 */
function cutoffFor(random: () => number, kind: string, note: number): number {
  const hold = (value: number) => Math.min(19000, Math.max(30, value))
  // A ladder is four poles where the state-variable models are two, so it takes away twice as
  // much per octave and has to start higher to leave anything — most of all on noise, which is
  // broadband and has nothing to spare.
  if (note <= 0) return kind === 'ladder' ? logBetween(random, 1600, 16000) : logBetween(random, 400, 14000)
  if (kind === 'highpass') return hold(logBetween(random, note * 0.1, note * 1.2))
  if (kind === 'ladder') return hold(logBetween(random, note * 2.5, note * 18))
  if (kind === 'lowpass') return hold(logBetween(random, note * 1.6, note * 14))
  return hold(logBetween(random, note * 0.6, note * 6))
}

/** The voice that carries the sound: a tone that moves, or a body of noise. */
function leadLayer(random: () => number): Layer {
  const tone = chance(random, 0.65)
  const start = logBetween(random, 90, 2600)
  const kind = pick(random, ['lowpass', 'lowpass', 'lowpass', 'off', 'highpass', 'bandpass', 'ladder', 'comb', 'notch'] as const)
  return makeLayer({
    gain: between(random, 0.45, 0.8),
    source: {
      kind: tone ? 'tone' : 'noise',
      wave: pick(random, WAVES),
      pulseWidth: between(random, 0.15, 0.85),
      colour: pick(random, COLOURS),
    },
    pitch: {
      start,
      slide: between(random, -26, 16),
      slideCurve: chance(random, 0.6) ? EASE_OUT : LINEAR,
      vibratoRate: chance(random, 0.25) ? between(random, 3, 24) : 0,
      vibratoDepth: chance(random, 0.25) ? between(random, 0.2, 2.5) : 0,
      arpeggioRatio: chance(random, 0.3) ? between(random, 0.5, 2.2) : 1,
      arpeggioAt: between(random, 0.2, 0.7),
      jitter: between(random, 0, 25),
    },
    filter: {
      // Weighted, not uniform: a low-pass is what most sounds want, and a ladder or a comb is a
      // character the dice should offer now and then rather than half the time.
      kind,
      cutoff: cutoffFor(random, kind, tone ? start : 0),
      resonance: between(random, 0, 0.55),
      envAmount: between(random, -3.2, 1.8),
      envCurve: EASE_OUT,
    },
    shaper: {
      drive: chance(random, 0.35) ? between(random, 0.1, 0.6) : 0,
      bitDepth: chance(random, 0.15) ? Math.round(between(random, 3, 10)) : 16,
      crush: chance(random, 0.15) ? between(random, 0.1, 0.5) : 0,
    },
    amp: {
      attack: between(random, 0, 0.03),
      hold: between(random, 0, 0.05),
      decay: between(random, 0.04, 0.45),
      sustain: chance(random, 0.3) ? between(random, 0.05, 0.35) : 0,
      release: between(random, 0.02, 0.3),
      curve: between(random, 1.4, 3.4),
    },
  })
}

/** The click at the front. Short, bright, and the reason an effect reads as contact. */
function transientLayer(random: () => number): Layer {
  return makeLayer({
    gain: between(random, 0.12, 0.4),
    source: { kind: 'noise', colour: pick(random, COLOURS) },
    pitch: { start: logBetween(random, 1200, 6000) },
    filter: { kind: 'highpass', cutoff: logBetween(random, 900, 4000), resonance: between(random, 0, 0.3) },
    amp: { attack: 0.0005, hold: 0, decay: between(random, 0.01, 0.06), sustain: 0, release: 0.015, curve: 3 },
  })
}

/** The weight underneath. A low sine costs nothing and is most of what "big" means. */
function bodyLayer(random: () => number): Layer {
  return makeLayer({
    gain: between(random, 0.25, 0.55),
    source: { kind: 'tone', wave: 'sine' },
    pitch: { start: logBetween(random, 55, 220), slide: between(random, -18, -2), slideCurve: EASE_OUT },
    amp: { attack: 0.002, hold: 0.01, decay: between(random, 0.1, 0.5), sustain: 0, release: between(random, 0.05, 0.25), curve: 2.2 },
  })
}

export function randomPatch(seed: number, sampleRate = 44100): AudioPatch {
  const random = mulberry32(seed)
  const duration = logBetween(random, 0.09, 1.1)
  return fit(makePatch(
    duration,
    [
      leadLayer(random),
      chance(random, 0.45) ? transientLayer(random) : silentLayer(),
      chance(random, 0.3) ? bodyLayer(random) : silentLayer(),
    ],
    {
      delayMix: chance(random, 0.2) ? between(random, 0.05, 0.25) : 0,
      delayTime: between(random, 0.03, 0.2),
      delayFeedback: between(random, 0.1, 0.5),
      reverbMix: chance(random, 0.3) ? between(random, 0.05, 0.3) : 0,
      reverbSize: between(random, 0.2, 0.9),
      reverbDamping: between(random, 0.2, 0.8),
      flangerMix: chance(random, 0.12) ? between(random, 0.1, 0.35) : 0,
      flangerRate: between(random, 0.2, 3),
      flangerDepth: between(random, 0.3, 0.9),
      tone: between(random, -0.45, 0.45),
    },
    // Enough headroom that a sparse draw is still audible now the reverb no longer inflates
    // everything it touches; the limiter keeps a dense one from going over.
    { gain: 1.6, limiter: 0.8, fadeOut: 0.01 },
    Math.floor(random() * 9999),
  ), sampleRate)
}

type Branch = { table: Record<string, FieldSpec>; source: Record<string, unknown> }

/**
 * Every field a variation may touch, paired with the object holding it, so a walk can write in
 * place.
 *
 * The patch's own three are not here on purpose. `duration` is the length of the sound rather than
 * a quality of it, and it is the one field a repeated nudge destroys: a random walk inside 0.02
 * to 4 seconds is a walk towards the floor, so five presses of Vary turned a half-second sound
 * into a click. `seed` re-rolls every jitter at once, which is a different sound and is what
 * Randomize is for, and `scene` chooses which pattern is playing, not how it sounds.
 */
function branches(patch: AudioPatch): Branch[] {
  const layers = patch.layers.flatMap((layer) =>
    (Object.keys(LAYER_SECTIONS) as LayerSection[]).map((section) => ({
      table: LAYER_SECTIONS[section],
      source: (section === 'root' ? layer : layer[section]) as unknown as Record<string, unknown>,
    })),
  )
  return [
    ...layers,
    // What moves the sound moves with it: the depths and rates of the modulators, and the mix and
    // time of every master effect. Without these a variation only ever nudged the static half of
    // a patch, and a sound whose character is its movement came back unchanged.
    ...patch.mods.map((mod) => ({ table: AUDIO_FIELDS.mod, source: mod as unknown as Record<string, unknown> })),
    ...FX_SLOTS.map((slot) => ({
      table: AUDIO_FIELDS.fxSlot,
      source: patch.fx[slot] as unknown as Record<string, unknown>,
    })),
    { table: AUDIO_FIELDS.fx, source: patch.fx as unknown as Record<string, unknown> },
    { table: AUDIO_FIELDS.master, source: patch.master as unknown as Record<string, unknown> },
  ]
}

/**
 * The same sound, moved. Every number is nudged by a fraction of its own range, so a cutoff
 * travels in hertz and an attack in milliseconds without either being told what it is. Switches
 * and options are left alone: flipping a layer off or a filter to another kind is not a variation
 * of a sound, it is a different sound, and that is what Randomize is for.
 */
export function mutatePatch(patch: AudioPatch, seed: number, amount = 0.12, sampleRate = 44100): AudioPatch {
  const random = mulberry32(seed)
  const next = structuredClone(patch)
  for (const { table, source } of branches(next)) {
    for (const [field, spec] of Object.entries(table)) {
      if (spec.type !== 'number') continue
      const current = source[field]
      if (typeof current !== 'number') continue
      const min = spec.min ?? 0
      const max = spec.max ?? 1
      const drift = (random() * 2 - 1) * amount * (max - min)
      const moved = Math.min(max, Math.max(min, current + drift))
      source[field] = spec.step && spec.step >= 1 ? Math.round(moved) : moved
    }
  }
  // Levelled like a drawn patch, and for the same reason: the dice do not know what they made. A
  // nudge to a resonance or a drive changes the peak by more than the make-up gain allows for, and
  // a Vary that hands back a clipped sound one press in ten is a button people stop pressing.
  //
  // Levelled to where the sound it came from sat, not to a house level: a variation of something
  // deliberately quiet is a quiet sound, and arriving at three quarters of full scale would make
  // the A/B comparison this button exists for a comparison of loudness.
  return fit(next, sampleRate, Math.min(0.9, Math.max(0.1, peakOf(patch, sampleRate))))
}
