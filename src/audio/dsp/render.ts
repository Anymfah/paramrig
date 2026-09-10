import type { AudioPatch, Layer, Stereo } from '../types.ts'
import { createFilter, filterSample } from './filter.ts'
import { createNoise, warp, waveAt } from './osc.ts'
import { tableAt, tableOf, wavetable } from './wavetable.ts'
import { createInsert, insertSample, type InsertState } from './insert.ts'
import { curveAt } from './curve.ts'
import { envelopeAt, fitEnvelope, type FittedEnvelope } from './envelope.ts'
import { performerAt } from './performer.ts'
import { applyFx } from './fx.ts'
import { streamFor } from './rng.ts'
import { createLfoState, LFO_RANGE, lfoAt, readLfoTarget, type LfoDestination, type LfoState } from './lfo.ts'
import { MAX_VOICES } from '../fields.ts'

/**
 * The whole synthesiser, as one pure function.
 *
 * This is the audio twin of `resolveRigValues`: a patch and a sample rate in, two channels out, no
 * clock, no context, no device. Everything downstream is a consumer of that buffer — playback
 * hands it to Web Audio, the waveform view draws it, the exporter encodes it. One code path means
 * what you hear while tuning and what lands in the file cannot drift apart.
 *
 * It is also why the tests need no browser: this file runs in Node.
 */

/** Two milliseconds of ramp in, so a layer that opens on a full-amplitude sample does not tick. */
const FADE_IN_SECONDS = 0.002

/**
 * Something pointed at a layer's parameter: an LFO with its own noise stream, a free envelope
 * fitted to what is left of the patch after its delay, or a performer with the row the patch's
 * scene chose. Several may point at one destination, and their swings add.
 */
type Slot = AudioPatch['mods'][number]
type Modulator =
  | { kind: 'lfo'; lfo: Slot; destination: LfoDestination; state: LfoState; random: () => number }
  | { kind: 'envelope'; envelope: Slot; destination: LfoDestination; fitted: FittedEnvelope; life: number }
  | { kind: 'performer'; performer: AudioPatch['performers'][number]; destination: LfoDestination; pattern: readonly number[]; curves: readonly number[] | undefined; duration: number }

/**
 * A modulator's swing at a moment of the patch's clock, at its depth, and the sum of a list of
 * them. The sum used to be a closure built inside the sample loop, which allocated one of itself
 * and one reduce callback per sample per layer — the only real garbage this renderer made.
 */
function swingOf(entries: Modulator[], clock: number): number {
  let sum = 0
  for (let at = 0; at < entries.length; at += 1) {
    const entry = entries[at]
    if (entry) sum += swingAt(entry, clock)
  }
  return sum
}

function swingAt(entry: Modulator, clock: number): number {
  if (entry.kind === 'lfo') return lfoAt(entry.lfo, clock, entry.state, entry.random) * entry.lfo.depth
  if (entry.kind === 'envelope') return envelopeAt(entry.envelope, entry.fitted, clock - entry.envelope.delay, entry.life) * entry.envelope.depth
  return performerAt(entry.performer, entry.pattern, entry.curves, clock, entry.duration) * entry.performer.depth
}

/** Equal power, so a sound swept across the field does not dip in the middle. */
function pan(position: number): { left: number; right: number } {
  const at = (Math.min(1, Math.max(-1, position)) + 1) * (Math.PI / 4)
  return { left: Math.cos(at), right: Math.sin(at) }
}

/** How much of an insert is heard at this instant: what its slot says, plus whatever points at it. */
function amountOf(unit: { slot: Layer['insertA']; swing: Modulator[] }, clock: number): number {
  if (unit.swing.length === 0) return unit.slot.amount
  return Math.min(1, Math.max(0, unit.slot.amount + swingOf(unit.swing, clock) * LFO_RANGE.insertA))
}

function renderLayer(
  layer: Layer, patch: AudioPatch, index: number, out: Stereo, sampleRate: number, modulators: Modulator[],
  /** Where this layer's own signal is kept for whatever modulates its phase with it, if anything does. */
  capture: Float64Array | null = null,
  /** The layer that modulates this one's phase, already rendered, or null for its own oscillator. */
  from: Float64Array | null = null,
): void {
  if (!layer.enabled) return
  const offset = Math.max(0, layer.offset)
  const life = patch.duration - offset
  if (life <= 0) return

  const random = streamFor(patch.seed, index)
  const cents = (random() * 2 - 1) * layer.pitch.jitter
  const detune = Math.pow(2, cents / 1200)
  const noiseA = createNoise(layer.source.colour, random)
  const noiseB = createNoise(layer.source.colour, streamFor(patch.seed, index + 50))
  // One filter and one of every insert a side: the voices are panned before any of them, so the
  // two channels are no longer the same signal by the time they get here.
  const filters = [createFilter(layer.filter.kind, sampleRate), createFilter(layer.filter.kind, sampleRate)]
  /**
   * The three slots, split by which side of the amplifier they stand on and stripped of the ones
   * switched off, so the sample loop walks two short lists rather than asking three slots what
   * kind they are on every sample of every channel.
   */
  const chain: { slot: Layer['insertA']; left: InsertState; right: InsertState; swing: Modulator[] }[] =
    [layer.insertA, layer.insertB, layer.insertC].map((slot) => ({
      slot, left: createInsert(slot, sampleRate), right: createInsert(slot, sampleRate), swing: [],
    }))
  const before = chain.filter((unit) => unit.slot.kind !== 'off' && unit.slot.place !== 'post')
  const after = chain.filter((unit) => unit.slot.kind !== 'off' && unit.slot.place === 'post')
  const fitted = fitEnvelope(layer.amp, life)
  const nyquist = sampleRate * 0.5

  const start = Math.round(offset * sampleRate)
  const end = Math.min(out.left.length, Math.round(patch.duration * sampleRate))

  /**
   * One oscillator is one oscillator: thin, because there is nothing for it to beat against, and
   * no envelope repairs that. The copies are spread evenly across the detune and summed at
   * 1/sqrt(n), which holds the loudness while they drift in and out of phase with each other —
   * and thrown across the stereo field, which is where width actually comes from. Detuned copies
   * in the same place are a thicker mono sound; the same copies pushed apart are a wide one.
   */
  const voices = Math.min(MAX_VOICES, Math.max(1, Math.round(layer.source.voices)))
  const spreadCents = layer.source.detune / 1200
  const width = Math.min(1, Math.max(0, layer.spread))
  const ratios: number[] = []
  const sides: { left: number; right: number }[] = []
  for (let voice = 0; voice < voices; voice += 1) {
    const place = voices === 1 ? 0 : voice / (voices - 1) - 0.5
    ratios.push(Math.pow(2, place * spreadCents))
    sides.push(pan(Math.min(1, Math.max(-1, layer.pan + place * 2 * width))))
  }
  const phases = ratios.map(() => 0)
  const fmPhases = ratios.map(() => 0)
  const balance = 1 / Math.sqrt(voices)
  // Radians of phase deviation, expressed in cycles for the oscillator that reads it.
  const fmDepth = layer.source.fmIndex / (Math.PI * 2)
  const still = pan(layer.pan)
  // Built once for the layer, and only when it is the kind that plays one: the first sound that
  // reaches for a table pays about forty milliseconds for the whole library, and no sound after it does.
  const table = layer.source.kind === 'table' ? wavetable(tableOf(layer.source.table)) : null

  const on = (destination: LfoDestination) => modulators.filter((entry) => entry.destination === destination)
  const pitchLfo = on('pitch')
  const cutoffLfo = on('cutoff')
  const resoLfo = on('resonance')
  const widthLfo = on('pulseWidth')
  const gainLfo = on('gain')
  const panLfo = on('pan')
  const pmLfo = on('pm')
  // One list a slot, in the slots' own order, so an insert reads the modulator pointed at its
  // letter rather than at the kind it happens to be holding this minute.
  const amountLfo = [on('insertA'), on('insertB'), on('insertC')]
  chain.forEach((unit, at) => { unit.swing = amountLfo[at] ?? [] })

  for (let i = start; i < end; i += 1) {
    const t = (i - start) / sampleRate
    const x = life > 0 ? Math.min(1, t / life) : 1

    // Modulators run on the patch's clock, so two layers pointed at one of them move together
    // even when one of them starts late.
    const clock = i / sampleRate

    const vibrato = layer.pitch.vibratoDepth * Math.sin(2 * Math.PI * layer.pitch.vibratoRate * t)
    const slide = layer.pitch.slide * curveAt(layer.pitch.slideCurve, x)
    const arpeggio = x >= layer.pitch.arpeggioAt ? layer.pitch.arpeggioRatio : 1
    const wobble = swingOf(pitchLfo, clock) * LFO_RANGE.pitch
    const wanted = layer.pitch.start * Math.pow(2, (slide + vibrato) / 12 + wobble) * arpeggio * detune
    const frequency = Math.min(nyquist * 0.98, Math.max(1, wanted))
    const dt = frequency / sampleRate

    let rawL = 0
    let rawR = 0
    if (layer.source.kind === 'noise') {
      const a = noiseA.next(dt)
      const b = noiseB.next(dt)
      // Fully correlated at no spread, two independent sources at full: the widest a noise gets.
      rawL = a * still.left
      rawR = (a * (1 - width) + b * width) * still.right
    } else {
      // Width and position are the same knob at heart — how far along the shape sits — so one
      // modulator swing moves whichever of the two this source reads.
      const shift = swingOf(widthLfo, clock)
      const duty = Math.min(0.95, Math.max(0.05, layer.source.pulseWidth + shift * LFO_RANGE.pulseWidth))
      const position = Math.min(1, Math.max(0, layer.source.position + shift * LFO_RANGE.pulseWidth))
      // The depth falls across the layer's life, which is what a struck thing does: the clang is
      // at the start and what is left afterwards is the note.
      const index = pmLfo.length === 0 ? fmDepth
        : Math.max(0, layer.source.fmIndex + swingOf(pmLfo, clock) * LFO_RANGE.pm) / (Math.PI * 2)
      const depth = index * (1 - layer.source.fmFall * x)
      for (let voice = 0; voice < voices; voice += 1) {
        const step = dt * (ratios[voice] ?? 1)
        const at = ((phases[voice] ?? 0) + step) % 1
        phases[voice] = at
        let read = at
        if (depth > 0) {
          // Another layer's output where one is named, and this oscillator's own sine otherwise.
          // The ratio tunes that sine and means nothing to a layer, which arrives at whatever
          // pitch it was already playing.
          let bend = from ? (from[i] ?? 0) : 0
          if (!from) {
            const modStep = step * layer.source.fmRatio
            const modAt = ((fmPhases[voice] ?? 0) + modStep) % 1
            fmPhases[voice] = modAt
            bend = Math.sin(modAt * Math.PI * 2)
          }
          const shifted = (at + depth * bend) % 1
          read = shifted < 0 ? shifted + 1 : shifted
        }
        const value = table
          ? tableAt(table, warp(read, duty), position, step)
          : waveAt(layer.source.wave, read, step, duty)
        const side = sides[voice] ?? still
        rawL += value * side.left
        rawR += value * side.right
      }
      rawL *= balance
      rawR *= balance
    }

    const sweep = Math.pow(2, layer.filter.envAmount * curveAt(layer.filter.envCurve, x) + swingOf(cutoffLfo, clock) * LFO_RANGE.cutoff)
    const cutoff = layer.filter.cutoff * sweep
    const resonance = resoLfo.length === 0 ? layer.filter.resonance
      : Math.min(1, Math.max(0, layer.filter.resonance + swingOf(resoLfo, clock) * LFO_RANGE.resonance))
    let left = filterSample(filters[0]!, layer.filter.kind, rawL, cutoff, resonance, sampleRate)
    let right = filterSample(filters[1]!, layer.filter.kind, rawR, cutoff, resonance, sampleRate)
    for (let at = 0; at < before.length; at += 1) {
      const unit = before[at]!
      const amount = amountOf(unit, clock)
      left = insertSample(unit.left, unit.slot, left, frequency, sampleRate, amount)
      right = insertSample(unit.right, unit.slot, right, frequency, sampleRate, amount)
    }

    /*
     * The amplifier stands in the middle of the slots, and that is the point of `place`.
     *
     * A body before it is a filter: the envelope arrives afterwards and cuts the ring off, so the
     * only way to get a tail is to keep the noise running for the length of it, which is not an
     * object being hit — it is an object being sanded. The same body after it is a struck thing:
     * the excitation is over in three milliseconds and what you hear next is the body deciding to
     * stop. Drive belongs on the other side, before the envelope, where it bites the loud part of
     * the sound rather than the fade. Anything else is a matter of taste, and taste is what the
     * switch is for.
     */
    const amplitude = envelopeAt(layer.amp, fitted, t, life)
    // A gain modulator only ducks. Written as `1 + v * depth` it spent half of every cycle at
    // twice the level, which is not a tremolo — it is a patch that clips on the upstroke.
    const tremolo = Math.max(0, 1 + ((swingOf(gainLfo, clock) - 1) / 2) * LFO_RANGE.gain)
    let hitL = left * amplitude
    let hitR = right * amplitude
    for (let at = 0; at < after.length; at += 1) {
      const unit = after[at]!
      const amount = amountOf(unit, clock)
      hitL = insertSample(unit.left, unit.slot, hitL, frequency, sampleRate, amount)
      hitR = insertSample(unit.right, unit.slot, hitR, frequency, sampleRate, amount)
    }

    // Kept before the level: a layer used only as a modulator is turned down to nothing and still
    // modulates, which is how a modulator oscillator is meant to work.
    if (capture) capture[i] = (hitL + hitR) * 0.5

    const level = layer.gain * tremolo
    if (panLfo.length === 0) {
      out.left[i] = (out.left[i] ?? 0) + hitL * level
      out.right[i] = (out.right[i] ?? 0) + hitR * level
    } else {
      /*
       * A pan modulator turns the layer's own sum, not each of its voices.
       *
       * The voices are spread across the field before anything else happens, and re-panning every
       * one of them per sample would cost a sine and a cosine each. Turning what they add up to
       * moves the whole image the same way for two, and at rest the two gains are cos and sin of
       * forty-five degrees — which times root two is one, so a layer nobody points at is untouched.
       */
      const turn = pan(Math.min(1, Math.max(-1, swingOf(panLfo, clock) * LFO_RANGE.pan)))
      out.left[i] = (out.left[i] ?? 0) + hitL * level * turn.left * Math.SQRT2
      out.right[i] = (out.right[i] ?? 0) + hitR * level * turn.right * Math.SQRT2
    }
  }
}

/**
 * Which layer feeds which, and an order that respects it.
 *
 * `from[i]` is the layer that modulates layer i's phase, or null. A layer that names itself, names
 * a layer that is not there, or sits in a ring of layers naming each other is given null instead —
 * a patch that cannot be rendered is not a patch anyone can fix from the plate, so the engine
 * decides rather than refuses. Four layers, so the sort is a handful of passes and no recursion.
 */
export function pmOrder(layers: Layer[]): { order: number[]; from: (number | null)[] } {
  const from = layers.map((layer, index) => {
    const found = /^layer(\d+)$/.exec(layer.source.pmFrom ?? 'internal')
    if (!found) return null
    const at = Number(found[1])
    return Number.isInteger(at) && at >= 0 && at < layers.length && at !== index ? at : null
  })
  const order: number[] = []
  const placed = new Set<number>()
  let moved = true
  while (moved && order.length < layers.length) {
    moved = false
    for (let index = 0; index < layers.length; index += 1) {
      if (placed.has(index)) continue
      const feeds = from[index]
      if (feeds !== null && feeds !== undefined && !placed.has(feeds)) continue
      order.push(index)
      placed.add(index)
      moved = true
    }
  }
  // What is left is a ring. Each of them goes back to its own oscillator, in the order they sit in.
  for (let index = 0; index < layers.length; index += 1) {
    if (placed.has(index)) continue
    from[index] = null
    order.push(index)
  }
  return { order, from }
}

export function renderPatch(patch: AudioPatch, sampleRate: number): Stereo {
  const length = Math.max(1, Math.round(Math.max(0.001, patch.duration) * sampleRate))
  const dry: Stereo = { left: new Float32Array(length), right: new Float32Array(length) }

  const wired: (Modulator & { layer: number })[] = [
    // One list of slots, each saying which kind it is; the two the kind does not read are left
    // alone, so a slot switched to the other kind and back is the one it was.
    ...patch.mods.flatMap((slot, index): (Modulator & { layer: number })[] => {
      const target = slot.enabled ? readLfoTarget(slot.target) : null
      if (!target) return []
      if (slot.kind === 'envelope') {
        const life = Math.max(0.001, patch.duration - Math.max(0, slot.delay))
        return [{ kind: 'envelope' as const, ...target, envelope: slot, fitted: fitEnvelope(slot, life), life }]
      }
      // Its own stream, so a noise modulator is reproducible and independent of the layers'.
      const random = streamFor(patch.seed, 100 + index)
      return [{ kind: 'lfo' as const, ...target, lfo: slot, state: createLfoState(random), random }]
    }),
    ...patch.performers.flatMap((performer) => {
      const target = performer.enabled ? readLfoTarget(performer.target) : null
      if (!target) return []
      const scene = Math.min(performer.patterns.length - 1, Math.max(0, Math.round(patch.scene)))
      return [{ kind: 'performer' as const, ...target, performer, pattern: performer.patterns[scene] ?? [], curves: performer.curves?.[scene], duration: patch.duration }]
    }),
  ]
  /*
   * The one place the layers stop being independent.
   *
   * A layer whose phase is modulated by another has to wait for that other one, so the render
   * order is a topological sort rather than nought to three, and the layer it waits on is kept in
   * a buffer while it plays. `pmOrder` also decides what a cycle means: two layers modulating each
   * other cannot both go first, so both fall back to their own oscillators rather than deadlock.
   */
  const { order, from } = pmOrder(patch.layers)
  const kept = patch.layers.map((_, index) => (from.includes(index) ? new Float64Array(length) : null))
  for (const index of order) {
    const layer = patch.layers[index]
    if (!layer) continue
    const feeds = from[index]
    renderLayer(
      layer, patch, index, dry, sampleRate,
      wired.filter((entry) => entry.layer === index),
      kept[index] ?? null,
      feeds === null || feeds === undefined ? null : kept[feeds] ?? null,
    )
  }

  const wet = applyFx(dry, patch.fx, sampleRate)

  const limiter = Math.min(1, Math.max(0, patch.master.limiter))
  const fadeIn = Math.max(1, Math.round(FADE_IN_SECONDS * sampleRate))
  const fadeOut = Math.max(1, Math.round(Math.max(0, patch.master.fadeOut) * sampleRate))

  /*
   * Twelve hertz, one pole, and it is not a tone control.
   *
   * An asymmetric pulse carries a constant offset — a 28% duty square sits at -0.44 before
   * anything else happens to it — and that offset is inaudible, survives the limiter, and occupies
   * headroom the audible part of the sound is then denied. Measured across the preset library,
   * Pulse was spending 47% of its peak on it and four others between 13% and 17%. Gating such a
   * layer is worse: the gate modulates the offset, so a rhythm meant to be heard up at the pitch
   * of the voice also arrives as a thump at the gate rate.
   *
   * It sits before the gain and the limiter so that both of them act on the signal rather than on
   * a battery underneath it.
   */
  const dcPole = 1 - (2 * Math.PI * 12) / sampleRate

  for (const channel of [wet.left, wet.right]) {
    let priorIn = 0
    let priorOut = 0
    for (let i = 0; i < length; i += 1) {
      const raw = channel[i] ?? 0
      priorOut = raw - priorIn + dcPole * priorOut
      priorIn = raw
      let value = priorOut * patch.master.gain
      // tanh is the limiter here because its slope at zero is exactly one: quiet material passes
      // through untouched and only the peaks bend. A cubic clipper would lift the whole sound.
      if (limiter > 0) value = value * (1 - limiter) + Math.tanh(value) * limiter
      if (i < fadeIn) value *= i / fadeIn
      const fromEnd = length - 1 - i
      if (fromEnd < fadeOut) value *= fromEnd / fadeOut
      // A non-finite sample is a full-scale click and would be the loudest thing in the file.
      // Whatever produced it, silence is the honest answer for that one sample.
      channel[i] = Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0
    }
  }

  return wet
}

/** One channel, for anything that measures or draws rather than plays. */
export function monoSum(stereo: Stereo): Float32Array {
  const out = new Float32Array(stereo.left.length)
  for (let i = 0; i < out.length; i += 1) out[i] = ((stereo.left[i] ?? 0) + (stereo.right[i] ?? 0)) * 0.5
  return out
}
