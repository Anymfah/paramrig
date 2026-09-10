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
import { MAX_VOICES, MOD_ROUTES, routeAt } from '../fields.ts'

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

/**
 * Two milliseconds of ramp in, so a layer that opens on a full-amplitude sample does not tick.
 *
 * Applied twice, in two different places, and both are needed. The master applies it to the head
 * of the buffer, which is where the sum starts. A layer with an `offset` starts somewhere else
 * entirely, and used to arrive there on a step: a square wave delayed by a quarter of a second
 * with no attack went from silence to a third of full scale between one sample and the next, and
 * a step is a click. Layers that begin at the head are left to the master's ramp rather than being
 * given a second one, so nothing that was already smooth changes.
 */
const FADE_IN_SECONDS = 0.002

/**
 * Something pointed at a layer's parameter: an LFO with its own noise stream, a free envelope
 * fitted to what is left of the patch after its delay, or a performer with the row the patch's
 * scene chose. Several may point at one destination, and their swings add.
 */
type Slot = AudioPatch['mods'][number]
type Modulator =
  | { kind: 'lfo'; lfo: Slot; destination: LfoDestination; depth: number; state: LfoState; random: () => number }
  | { kind: 'envelope'; envelope: Slot; destination: LfoDestination; depth: number; fitted: FittedEnvelope; life: number }
  | { kind: 'performer'; performer: AudioPatch['performers'][number]; destination: LfoDestination; depth: number; pattern: readonly number[]; curves: readonly number[] | undefined; duration: number }

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
  // The depth belongs to the route, not to the modulator: one oscillator may drive four things at
  // once, and a swing that means an octave of pitch means the whole stereo field on a pan.
  if (entry.kind === 'lfo') return lfoAt(entry.lfo, clock, entry.state, entry.random) * entry.depth
  if (entry.kind === 'envelope') return envelopeAt(entry.envelope, entry.fitted, clock - entry.envelope.delay, entry.life) * entry.depth
  return performerAt(entry.performer, entry.pattern, entry.curves, clock, entry.duration) * entry.depth
}

/**
 * The places one modulator goes, and how far it moves each of them.
 *
 * Read off the flat fields rather than a list, which is how everything in this model is stored: a
 * slot carries `target`/`depth` and three more pairs, and the ones that are off are not routes.
 */
function routesOf(slot: Record<string, unknown>): { target: string; depth: number }[] {
  const out: { target: string; depth: number }[] = []
  for (let at = 0; at < MOD_ROUTES; at += 1) {
    const names = routeAt(at)
    const target = slot[names.target]
    if (typeof target !== 'string' || target === 'off') continue
    const depth = slot[names.depth]
    out.push({ target, depth: typeof depth === 'number' ? depth : 0 })
  }
  return out
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
  // Two filters and one of every insert a side: the voices are panned before any of them, so the
  // two channels are no longer the same signal by the time they get here.
  const filters = [createFilter(layer.filterA.kind, sampleRate), createFilter(layer.filterA.kind, sampleRate)]
  const second = [createFilter(layer.filterB.kind, sampleRate), createFilter(layer.filterB.kind, sampleRate)]
  /** What B is for. `single` is the layer a patch had before there were two of them. */
  const routing = layer.filterB.kind === 'off' ? 'single' : layer.routing
  const across = Math.min(1, Math.max(0, layer.filterMix))
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
  // Only a layer that begins away from the head opens itself; the head is the master's job.
  const opening = start > 0 ? Math.max(1, Math.round(FADE_IN_SECONDS * sampleRate)) : 0

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
  // The two noise sources, mixed as a rotation rather than as a fade: cosine on the common one,
  // sine on the difference, so the pair keeps its power wherever the knob is.
  const spreadA = Math.cos(width * (Math.PI / 4))
  const spreadB = Math.sin(width * (Math.PI / 4))
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
  const panSum = still.left + still.right
  // Read once, because each of them decides whether a curve is solved at all inside the loop.
  const slideBy = layer.pitch.slide
  const aEnvelope = layer.filterA.envAmount
  const bEnvelope = layer.filterB.envAmount
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
    const slide = slideBy === 0 ? 0 : slideBy * curveAt(layer.pitch.slideCurve, x)
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
      // The two are mixed at equal power and symmetrically, which they were not: the left took
      // the first source whole while the right took a straight crossfade of two *independent*
      // ones, and the sum of two independent halves is not one — it falls to 0.707 at the middle
      // of the knob. Turning the spread dragged the image three decibels left and back again.
      rawL = (a * spreadA + b * spreadB) * still.left
      rawR = (a * spreadA - b * spreadB) * still.right
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
          // The rate the *phase* is moving at, which is not the rate the oscillator is stepping
          // at once the shape is skewed: `warp` squeezes half a cycle into as little as a
          // twentieth of it, so the local slope runs up to ten times `step`. Handing the band
          // chooser the plain step picked a band band-limited for a pitch ten times lower than the
          // one being played, and everything it held folded. The steepest slope of `warp` is
          // 1/(2·min(w, 1−w)), so that is the increment the band has to survive.
          ? tableAt(table, warp(read, duty), position, step / (2 * Math.min(duty, 1 - duty)))
          : waveAt(layer.source.wave, read, step, duty)
        const side = sides[voice] ?? still
        rawL += value * side.left
        rawR += value * side.right
      }
      rawL *= balance
      rawR *= balance
    }

    /*
     * One swing, both filters.
     *
     * A modulator pointed at the cutoff moves A and B by the same number of octaves rather than
     * having a destination each: two resonances kept a fixed distance apart and swept together is
     * what a formant pair or a phased comb is, and two destinations that have to be dialled to
     * the same number is a way of getting that wrong.
     */
    const swing = swingOf(cutoffLfo, clock) * LFO_RANGE.cutoff
    const swingUp = Math.pow(2, swing)
    const lift = resoLfo.length === 0 ? 0 : swingOf(resoLfo, clock) * LFO_RANGE.resonance
    // Written out rather than through a helper: a closure and its result object per filter per
    // sample is exactly the garbage the note on `swingOf` says was taken out of this loop. And the
    // curve is only solved when something reads it — an eight-step Newton solve whose answer is
    // multiplied by zero was nine per cent of the render, on the thread the plate draws on.
    const aCut = layer.filterA.cutoff * (aEnvelope === 0
      ? swingUp
      : Math.pow(2, layer.filterA.envAmount * curveAt(layer.filterA.envCurve, x) + swing))
    const aRes = lift === 0 ? layer.filterA.resonance : Math.min(1, Math.max(0, layer.filterA.resonance + lift))
    let left = filterSample(filters[0]!, layer.filterA.kind, rawL, aCut, aRes, sampleRate)
    let right = filterSample(filters[1]!, layer.filterA.kind, rawR, aCut, aRes, sampleRate)
    if (routing !== 'single') {
      const bCut = layer.filterB.cutoff * (bEnvelope === 0
        ? swingUp
        : Math.pow(2, layer.filterB.envAmount * curveAt(layer.filterB.envCurve, x) + swing))
      const bRes = lift === 0 ? layer.filterB.resonance : Math.min(1, Math.max(0, layer.filterB.resonance + lift))
      if (routing === 'series') {
        left = filterSample(second[0]!, layer.filterB.kind, left, bCut, bRes, sampleRate)
        right = filterSample(second[1]!, layer.filterB.kind, right, bCut, bRes, sampleRate)
      } else {
        left = left * (1 - across) + filterSample(second[0]!, layer.filterB.kind, rawL, bCut, bRes, sampleRate) * across
        right = right * (1 - across) + filterSample(second[1]!, layer.filterB.kind, rawR, bCut, bRes, sampleRate) * across
      }
    }
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
    const amplitude = envelopeAt(layer.amp, fitted, t, life) * (opening === 0 ? 1 : Math.min(1, (i - start) / opening))
    /*
     * A gain modulator only ducks. Written as `1 + v * depth` it spent half of every cycle at
     * twice the level, which is not a tremolo — it is a patch that clips on the upstroke. So the
     * modulator's own top is the layer's level and everything below it takes level away.
     *
     * And that is only true when there IS a modulator. Without the guard the sum of an empty list
     * is zero, which the formula reads as "the modulator is sitting at its middle" and ducks by
     * six decibels — so every layer in the instrument played at half the level its own dial said,
     * for as long as nobody pointed anything at it. The library was levelled against that, and is
     * levelled again here.
     */
    const tremolo = gainLfo.length === 0 ? 1
      : Math.max(0, 1 + ((swingOf(gainLfo, clock) - 1) / 2) * LFO_RANGE.gain)
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
    //
    // And kept before the *position*. The pair has already been through the pan law, so halving
    // its sum handed back a unit oscillator as 0.707 when the layer was centred and as 0.5 when
    // it was hard over: switching a carrier from its own sine to another layer quietly lost three
    // decibels of index, and then moving the modulator layer's pan — a layer at gain zero, which
    // nobody can hear — retuned the carrier. Dividing by the two gains it was multiplied by gives
    // back the amplitude the oscillator actually made.
    if (capture) capture[i] = (hitL + hitR) / panSum

    const level = layer.gain * tremolo
    if (panLfo.length === 0) {
      out.left[i] = (out.left[i] ?? 0) + hitL * level
      out.right[i] = (out.right[i] ?? 0) + hitR * level
    } else {
      /*
       * A pan modulator turns the layer's own sum, not each of its voices.
       *
       * The voices are spread across the field before anything else happens, and re-panning every
       * one of them per sample would cost a sine and a cosine each. Rotating what they add up to
       * moves the whole image the same way for all of them and keeps the width between them.
       *
       * A rotation, and not a second pan law over the first. Multiplying the already-panned pair
       * by `pan(swing)` is a product of two laws rather than a change of position: a layer at hard
       * right has nothing in its left channel to begin with, so the modulator could only turn the
       * right one up and down — a tremolo, and a three decibel boost at that, on a control whose
       * whole promise is that a layer crosses the field. The angle here is the difference between
       * where the layer sits and where the modulator has moved it to, so at rest it is zero, at
       * the edges it stops, and the level never changes.
       */
      const moved = Math.min(1, Math.max(-1, layer.pan + swingOf(panLfo, clock) * LFO_RANGE.pan))
      const turn = (moved - layer.pan) * (Math.PI / 4)
      const cos = Math.cos(turn)
      const sin = Math.sin(turn)
      out.left[i] = (out.left[i] ?? 0) + (hitL * cos - hitR * sin) * level
      out.right[i] = (out.right[i] ?? 0) + (hitL * sin + hitR * cos) * level
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
    // One entry per route rather than per modulator: a slot may be pointed at four places at once,
    // and each of them is an independent swing with its own depth. A route that is off, or that
    // names something the engine does not have, simply does not appear.
    ...patch.mods.flatMap((slot, index): (Modulator & { layer: number })[] => {
      if (!slot.enabled) return []
      const life = Math.max(0.001, patch.duration - Math.max(0, slot.delay))
      const fitted = slot.kind === 'envelope' ? fitEnvelope(slot, life) : null
      // One stream a slot, not a route: four routes off one noise modulator are four readings of
      // the same oscillator, which is the whole point of pointing one modulator at four things.
      const random = slot.kind === 'envelope' ? null : streamFor(patch.seed, 100 + index)
      return routesOf(slot).flatMap((route): (Modulator & { layer: number })[] => {
        const where = readLfoTarget(route.target)
        if (!where) return []
        const depth = route.depth
        return fitted
          ? [{ kind: 'envelope', ...where, depth, envelope: slot, fitted, life }]
          : [{ kind: 'lfo', ...where, depth, lfo: slot, state: createLfoState(random!), random: random! }]
      })
    }),
    ...patch.performers.flatMap((performer) => {
      if (!performer.enabled) return []
      const scene = Math.min(performer.patterns.length - 1, Math.max(0, Math.round(patch.scene)))
      return routesOf(performer).flatMap((route): (Modulator & { layer: number })[] => {
        const where = readLfoTarget(route.target)
        if (!where) return []
        return [{ kind: 'performer', ...where, depth: route.depth, performer, pattern: performer.patterns[scene] ?? [], curves: performer.curves?.[scene], duration: patch.duration }]
      })
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
