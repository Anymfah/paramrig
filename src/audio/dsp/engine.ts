import type { AudioPatch, Layer, Stereo } from '../types.ts'
import { createFilter, filterSample } from './filter.ts'
import { createNoise, warp, waveAt } from './osc.ts'
import { tableAt, wavetableOf, type Wavetable } from './wavetable.ts'
import { createInsert, insertSample, type InsertState } from './insert.ts'
import { curveAt } from './curve.ts'
import { envelopeAt, envelopeHeld, fitEnvelope, type FittedEnvelope } from './envelope.ts'
import { performerAt } from './performer.ts'
import { createFxChain, fxChainSample, refreshFxChain, type FxChain } from './fx.ts'
import { streamFor } from './rng.ts'
import { createLfoState, LFO_RANGE, lfoAt, readLfoTarget, type LfoDestination, type LfoState } from './lfo.ts'
import { MAX_VOICES, MOD_ROUTES, routeAt } from '../fields.ts'
import { gestureAt } from '../gestures.ts'
import { mapAmount } from './curve.ts'
import { parseAudioProperty } from '../rig.ts'
import type { MacroGestureDestination, MacroGesture } from '../types.ts'

/**
 * The synthesiser as a voice that can be asked for the next block, rather than for a whole file.
 *
 * Offline render and the AudioWorklet both call `processVoice`. One code path is what keeps a
 * drag during playback honest to the file that will be written, and what lets a test prove that
 * 64-sample blocks and a whole buffer are the same samples.
 */

const FADE_IN_SECONDS = 0.002

export type VoiceGate = 'oneshot' | 'repeat' | 'hold' | 'release' | 'stop'

type Slot = AudioPatch['mods'][number]
type Modulator = { source: string; readDepth: () => number } & (
  | { kind: 'lfo'; lfo: Slot; destination: LfoDestination; depth: number; state: LfoState; random: () => number }
  | { kind: 'envelope'; envelope: Slot; destination: LfoDestination; depth: number; fitted: FittedEnvelope; life: number }
  | { kind: 'performer'; performer: AudioPatch['performers'][number]; destination: LfoDestination; depth: number; pattern: readonly number[]; curves: readonly number[] | undefined; duration: number; patch: AudioPatch }
)

type InsertUnit = { which: 'insertA' | 'insertB' | 'insertC'; slot: Layer['insertA']; left: InsertState; right: InsertState; swing: Modulator[] }

type LayerVoice = {
  index: number
  key: string
  random: () => number
  cents: number
  detune: number
  noiseA: ReturnType<typeof createNoise>
  noiseB: ReturnType<typeof createNoise>
  filters: ReturnType<typeof createFilter>[]
  second: ReturnType<typeof createFilter>[]
  chain: InsertUnit[]
  before: InsertUnit[]
  after: InsertUnit[]
  fitted: FittedEnvelope
  voices: number
  ratios: number[]
  sides: { left: number; right: number }[]
  phases: number[]
  fmPhases: number[]
  balance: number
  table: Wavetable | null
  modulators: Modulator[]
  pitchLfo: Modulator[]
  cutoffLfo: Modulator[]
  resoLfo: Modulator[]
  widthLfo: Modulator[]
  gainLfo: Modulator[]
  panLfo: Modulator[]
  pmLfo: Modulator[]
}

export type WavetableResolver = (id: string) => Wavetable | null
export type VoiceOptions = { length?: number; live?: boolean; gate?: VoiceGate; resolveWavetable?: WavetableResolver }

export type Voice = {
  resolveWavetable: WavetableResolver
  patch: AudioPatch
  sounding: AudioPatch
  automation: Automation[]
  ramps: Ramp[]
  sampleRate: number
  /** Samples of the current note, reset on retrigger. */
  note: number
  /** Samples since the voice was created, never reset — delay and reverb keep this clock. */
  clock: number
  length: number
  gate: VoiceGate
  releasedAt: number | null
  live: boolean
  layers: LayerVoice[]
  order: number[]
  from: (number | null)[]
  captures: number[]
  fx: FxChain
  dcInL: number
  dcOutL: number
  dcInR: number
  dcOutR: number
  dcPole: number
  stopGain: number
}

function structuralKey(layer: Layer): string {
  return [
    layer.source.kind, layer.source.table, layer.source.colour, layer.source.voices,
    layer.filterA.kind, layer.filterB.kind, layer.routing,
    layer.insertA.kind, layer.insertB.kind, layer.insertC.kind,
    layer.insertA.place, layer.insertB.place, layer.insertC.place,
  ].join(':')
}

function swingOf(entries: Modulator[], clock: number): number {
  let sum = 0
  for (let at = 0; at < entries.length; at += 1) {
    const entry = entries[at]
    if (entry) sum += swingAt(entry, clock)
  }
  return sum
}

function swingAt(entry: Modulator, clock: number): number {
  if (entry.kind === 'lfo') return lfoAt(entry.lfo, clock, entry.state, entry.random) * entry.readDepth()
  if (entry.kind === 'envelope') return envelopeAt(entry.envelope, fitEnvelope(entry.envelope, entry.life), clock - entry.envelope.delay, entry.life) * entry.readDepth()
  return performerAt(entry.performer, entry.performer.patterns[Math.round(entry.patch.scene)] ?? entry.pattern, entry.performer.curves?.[Math.round(entry.patch.scene)] ?? entry.curves, clock, entry.patch.duration) * entry.readDepth()
}

function routesOf(slot: Record<string, unknown>): { target: string; depth: number; readDepth: () => number }[] {
  const out: { target: string; depth: number; readDepth: () => number }[] = []
  for (let at = 0; at < MOD_ROUTES; at += 1) {
    const names = routeAt(at)
    const target = slot[names.target]
    if (typeof target !== 'string' || target === 'off') continue
    const depth = slot[names.depth]
    out.push({ target, depth: typeof depth === 'number' ? depth : 0, readDepth: () => Number(slot[names.depth]) || 0 })
  }
  return out
}

function pan(position: number): { left: number; right: number } {
  const at = (Math.min(1, Math.max(-1, position)) + 1) * (Math.PI / 4)
  return { left: Math.cos(at), right: Math.sin(at) }
}

function amountOf(unit: { slot: Layer['insertA']; swing: Modulator[] }, clock: number): number {
  if (unit.swing.length === 0) return unit.slot.amount
  return Math.min(1, Math.max(0, unit.slot.amount + swingOf(unit.swing, clock) * LFO_RANGE.insertA))
}

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
  for (let index = 0; index < layers.length; index += 1) {
    if (placed.has(index)) continue
    from[index] = null
    order.push(index)
  }
  return { order, from }
}

function wireModulators(patch: AudioPatch): (Modulator & { layer: number })[] {
  return [
    ...patch.mods.flatMap((slot, index): (Modulator & { layer: number })[] => {
      if (!slot.enabled) return []
      const life = Math.max(0.001, patch.duration - Math.max(0, slot.delay))
      const fitted = slot.kind === 'envelope' ? fitEnvelope(slot, life) : null
      const random = slot.kind === 'envelope' ? null : streamFor(patch.seed, 100 + index)
      const state = random ? createLfoState(random) : null
      return routesOf(slot).flatMap((route): (Modulator & { layer: number })[] => {
        const where = readLfoTarget(route.target)
        if (!where) return []
        return fitted
          ? [{ kind: 'envelope', ...where, depth: route.depth, readDepth: route.readDepth, source: `mod-${index}`, envelope: slot, fitted, life }]
          : [{ kind: 'lfo', ...where, depth: route.depth, readDepth: route.readDepth, source: `mod-${index}`, lfo: slot, state: state!, random: random! }]
      })
    }),
    ...patch.performers.flatMap((performer, index) => {
      if (!performer.enabled) return []
      const scene = Math.min(performer.patterns.length - 1, Math.max(0, Math.round(patch.scene)))
      return routesOf(performer).flatMap((route): (Modulator & { layer: number })[] => {
        const where = readLfoTarget(route.target)
        if (!where) return []
        return [{ kind: 'performer', ...where, depth: route.depth, readDepth: route.readDepth, source: `performer-${index}`, performer, patch, pattern: performer.patterns[scene] ?? [], curves: performer.curves?.[scene], duration: patch.duration }]
      })
    }),
  ]
}

function createLayerVoice(layer: Layer, patch: AudioPatch, index: number, sampleRate: number, modulators: Modulator[], previous?: LayerVoice, resolveWavetable: WavetableResolver = wavetableOf): LayerVoice {
  const reuse = previous?.key === structuralKey(layer) ? previous : undefined
  const random = streamFor(patch.seed, index)
  const cents = (random() * 2 - 1) * layer.pitch.jitter
  const detune = Math.pow(2, cents / 1200)
  const noiseA = createNoise(layer.source.colour, random)
  const noiseB = createNoise(layer.source.colour, streamFor(patch.seed, index + 50))
  const named = ['insertA', 'insertB', 'insertC'] as const
  const chain: InsertUnit[] = named.map((which) => ({
    which, slot: layer[which], left: reuse?.chain.find((unit) => unit.which === which)?.left ?? createInsert(layer[which], sampleRate), right: reuse?.chain.find((unit) => unit.which === which)?.right ?? createInsert(layer[which], sampleRate), swing: [] as Modulator[],
  }))
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
  const on = (destination: LfoDestination) => modulators.filter((entry) => entry.destination === destination)
  const amountLfo = [on('insertA'), on('insertB'), on('insertC')]
  chain.forEach((unit, at) => { unit.swing = amountLfo[at] ?? [] })
  const offset = Math.max(0, layer.offset)
  const life = patch.duration - offset
  return {
    index, key: structuralKey(layer), random, cents, detune, noiseA, noiseB,
    filters: reuse?.filters ?? [createFilter(layer.filterA.kind, sampleRate), createFilter(layer.filterA.kind, sampleRate)],
    second: reuse?.second ?? [createFilter(layer.filterB.kind, sampleRate), createFilter(layer.filterB.kind, sampleRate)],
    chain,
    before: chain.filter((unit) => unit.slot.kind !== 'off' && unit.slot.place !== 'post'),
    after: chain.filter((unit) => unit.slot.kind !== 'off' && unit.slot.place === 'post'),
    fitted: fitEnvelope(layer.amp, Math.max(0.001, life)),
    voices, ratios, sides, phases: Array<number>(MAX_VOICES).fill(0), fmPhases: Array<number>(MAX_VOICES).fill(0),
    balance: 1 / Math.sqrt(voices),
    table: layer.source.kind === 'table' ? resolveWavetable(layer.source.table) : null,
    modulators, pitchLfo: on('pitch'), cutoffLfo: on('cutoff'), resoLfo: on('resonance'),
    widthLfo: on('pulseWidth'), gainLfo: on('gain'), panLfo: on('pan'), pmLfo: on('pm'),
  }
}

type Automation = { gesture: MacroGesture; destinations: { dest: MacroGestureDestination; target: Record<string, unknown>; field: string; base: number; min: number; max: number; scale?: 'linear' | 'log' }[] }

/** Resolve paths and clone once per edit, never once per sample. */
function compileAutomation(patch: AudioPatch, live = false): { sounding: AudioPatch; automation: Automation[] } {
  if (!patch.gestures?.length && !live) return { sounding: patch, automation: [] }
  const sounding: AudioPatch = JSON.parse(JSON.stringify(patch))
  const automation = (patch.gestures ?? []).map((gesture) => ({ gesture, destinations: gesture.destinations.flatMap((dest) => {
    const path = parseAudioProperty(dest.property)
    if (!path || path.spec.type !== 'number' || path.spec.editorOnly) return []
    let target: object | undefined
    if (path.kind === 'patch') target = sounding
    if (path.kind === 'master') target = sounding.master
    if (path.kind === 'fx') target = path.slot ? sounding.fx[path.slot] : sounding.fx
    if (path.kind === 'mod') target = sounding.mods[path.index]
    if (path.kind === 'performer') target = sounding.performers[path.index]
    if (path.kind === 'layer') {
      const layer = sounding.layers[path.index]
      target = path.section === 'root' ? layer : layer?.[path.section]
    }
    if (!target) return []
    const record = target as Record<string, unknown>
    return [{ dest, target: record, field: path.field, base: Number(record[path.field]), min: path.spec.min ?? -Infinity, max: path.spec.max ?? Infinity, scale: path.spec.scale }]
  }) }))
  return { sounding, automation }
}

type Ramp = { target: Record<string, unknown>; field: string; from: number; to: number; remaining: number; total: number; log: boolean }

function liveRamps(previous: AudioPatch, next: AudioPatch, sampleRate: number): Ramp[] {
  const ramps: Ramp[] = []
  const add = (before: object, after: object, fields: string[]) => {
    const old = before as Record<string, unknown>
    const target = after as Record<string, unknown>
    for (const field of fields) {
      const from = old[field], to = target[field]
      if (typeof from !== 'number' || typeof to !== 'number' || from === to) continue
      const total = Math.max(1, Math.round(sampleRate * 0.005))
      ramps.push({ target, field, from, to, total, remaining: total, log: from > 0 && to > 0 && (field === 'start' || field === 'cutoff') })
    }
  }
  next.layers.forEach((layer, index) => {
    const before = previous.layers[index]
    if (!before) return
    add(before, layer, ['gain', 'pan', 'spread'])
    add(before.pitch, layer.pitch, ['start'])
    add(before.source, layer.source, ['position', 'pulseWidth', 'fmIndex', 'detune'])
    for (const key of ['filterA', 'filterB'] as const) add(before[key], layer[key], ['cutoff', 'resonance'])
    for (const key of ['insertA', 'insertB', 'insertC'] as const) add(before[key], layer[key], ['amount'])
  })
  add(previous.master, next.master, ['gain', 'limiter', 'width'])
  add(previous.fx, next.fx, ['width', 'tone'])
  for (const key of ['x', 'y', 'z'] as const) add(previous.fx[key], next.fx[key], ['mix', 'time'])
  return ramps
}

function soundingPatch(voice: Voice, clock: number): AudioPatch {
  // Reset all targets first so an inactive later take cannot erase an active earlier one.
  for (const lane of voice.automation) for (const point of lane.destinations) point.target[point.field] = point.base
  for (const ramp of voice.ramps) {
    const mix = 1 - Math.max(0, --ramp.remaining) / ramp.total
    ramp.target[ramp.field] = ramp.log ? Math.exp(Math.log(ramp.from) + mix * (Math.log(ramp.to) - Math.log(ramp.from))) : ramp.from + mix * (ramp.to - ramp.from)
  }
  for (const lane of voice.automation) {
    const amount = gestureAt(lane.gesture, clock)
    if (amount === null) continue
    for (const point of lane.destinations) {
      const dest = point.dest
      const value = mapAmount(amount, dest.from, dest.to, { invert: dest.invert, curve: dest.curve, scale: point.scale })
      if (Number.isFinite(value)) point.target[point.field] = Math.min(point.max, Math.max(point.min, value))
    }
  }
  return voice.sounding
}

export function createVoice(patch: AudioPatch, sampleRate: number, options: VoiceOptions = {}): Voice {
  const length = options.length ?? Math.max(1, Math.round(Math.max(0.001, patch.duration) * sampleRate))
  const compiled = compileAutomation(patch, options.live)
  const wired = wireModulators(compiled.sounding)
  const { order, from } = pmOrder(patch.layers)
  const layers = compiled.sounding.layers.map((layer, index) =>
    createLayerVoice(layer, compiled.sounding, index, sampleRate, wired.filter((entry) => entry.layer === index), undefined, options.resolveWavetable))
  return {
    patch, ...compiled, ramps: [], sampleRate, note: 0, clock: 0, length,
    resolveWavetable: options.resolveWavetable ?? wavetableOf,
    gate: options.gate ?? 'oneshot',
    releasedAt: null,
    live: options.live === true,
    layers, order, from, captures: patch.layers.map(() => 0),
    fx: createFxChain(compiled.sounding.fx, sampleRate),
    dcInL: 0, dcOutL: 0, dcInR: 0, dcOutR: 0,
    dcPole: 1 - (2 * Math.PI * 12) / sampleRate,
    stopGain: 1,
  }
}

export function updateVoice(voice: Voice, patch: AudioPatch): void {
  const compiled = compileAutomation(patch, voice.live)
  voice.ramps = voice.live ? liveRamps(voice.sounding, compiled.sounding, voice.sampleRate) : []
  const wired = wireModulators(compiled.sounding)
  const lfos = new Map(voice.layers.flatMap((layer) => layer.modulators).filter((entry) => entry.kind === 'lfo').map((entry) => [entry.source, entry]))
  for (const entry of wired) {
    const old = lfos.get(entry.source)
    if (entry.kind === 'lfo' && old?.kind === 'lfo' && voice.patch.seed === patch.seed) { entry.state = old.state; entry.random = old.random }
  }
  voice.patch = patch
  voice.sounding = compiled.sounding
  voice.automation = compiled.automation
  voice.length = Math.max(1, Math.round(patch.duration * voice.sampleRate))
  voice.fx = refreshFxChain(voice.fx, compiled.sounding.fx, voice.sampleRate)
  const { order, from } = pmOrder(patch.layers)
  voice.order = order
  voice.from = from
  voice.layers = compiled.sounding.layers.map((layer, index) => {
    const previous = voice.layers[index]
    const next = createLayerVoice(layer, compiled.sounding, index, voice.sampleRate, wired.filter((entry) => entry.layer === index), previous, voice.resolveWavetable)
    if (previous && previous.key === next.key) {
      next.phases = previous.phases
      next.fmPhases = previous.fmPhases
      next.filters = previous.filters
      next.second = previous.second
      next.noiseA = previous.noiseA
      next.noiseB = previous.noiseB
    }
    return next
  })
}

export function setVoiceGate(voice: Voice, gate: VoiceGate): void {
  if (gate === 'release' && voice.gate === 'hold') voice.releasedAt = voice.note / voice.sampleRate
  if (gate === 'hold' || gate === 'oneshot' || gate === 'repeat') voice.releasedAt = null
  if (gate === 'oneshot' || gate === 'repeat' || gate === 'hold') {
    if (voice.gate === 'stop' || voice.stopGain < 1) {
      retrigger(voice)
    }
  }
  voice.gate = gate
  if (gate === 'stop') voice.stopGain = Math.min(voice.stopGain, 1)
}

/** Start the note again without discarding the delay and reverb that are already ringing. */
export function triggerVoice(voice: Voice, gate?: VoiceGate): void {
  if (gate) voice.gate = gate
  retrigger(voice)
}

function retrigger(voice: Voice): void {
  voice.note = 0
  voice.releasedAt = null
  voice.stopGain = 1
  const wired = wireModulators(voice.sounding)
  voice.layers = voice.sounding.layers.map((layer, index) =>
    createLayerVoice(layer, voice.sounding, index, voice.sampleRate, wired.filter((entry) => entry.layer === index), undefined, voice.resolveWavetable))
}

function layerSample(
  voice: LayerVoice, layer: Layer, patch: AudioPatch, sampleRate: number,
  clock: number, note: number, from: number | null, gate: VoiceGate, releasedAt: number | null,
): { left: number; right: number; capture: number } {
  const offset = Math.max(0, layer.offset)
  const life = patch.duration - offset
  const t = note / sampleRate - offset
  if (!layer.enabled || t < 0 || (gate === 'oneshot' && t > life)) {
    return { left: 0, right: 0, capture: 0 }
  }
  const x = life > 0 ? Math.min(1, Math.max(0, t / life)) : 1
  const nyquist = sampleRate * 0.5
  const width = Math.min(1, Math.max(0, layer.spread))
  const spreadA = Math.cos(width * (Math.PI / 4))
  const spreadB = Math.sin(width * (Math.PI / 4))
  const still = pan(layer.pan)
  const panSum = still.left + still.right
  const fmDepth = layer.source.fmIndex / (Math.PI * 2)
  const opening = offset > 0 ? Math.max(1, Math.round(FADE_IN_SECONDS * sampleRate)) : 0
  const start = Math.round(offset * sampleRate)
  const i = Math.round(note)

  const vibrato = layer.pitch.vibratoDepth * Math.sin(2 * Math.PI * layer.pitch.vibratoRate * t)
  const slide = layer.pitch.slide === 0 ? 0 : layer.pitch.slide * curveAt(layer.pitch.slideCurve, x)
  const arpeggio = x >= layer.pitch.arpeggioAt ? layer.pitch.arpeggioRatio : 1
  const wobble = swingOf(voice.pitchLfo, clock) * LFO_RANGE.pitch
  const wanted = layer.pitch.start * Math.pow(2, (slide + vibrato) / 12 + wobble) * arpeggio * voice.detune
  const frequency = Math.min(nyquist * 0.98, Math.max(1, wanted))
  const dt = frequency / sampleRate

  let rawL = 0
  let rawR = 0
  if (layer.source.kind === 'noise') {
    const a = voice.noiseA.next(dt)
    const b = voice.noiseB.next(dt)
    rawL = (a * spreadA + b * spreadB) * still.left
    rawR = (a * spreadA - b * spreadB) * still.right
  } else {
    const shift = swingOf(voice.widthLfo, clock)
    const duty = Math.min(0.95, Math.max(0.05, layer.source.pulseWidth + shift * LFO_RANGE.pulseWidth))
    const position = Math.min(1, Math.max(0, layer.source.position + shift * LFO_RANGE.pulseWidth))
    const index = voice.pmLfo.length === 0 ? fmDepth
      : Math.max(0, layer.source.fmIndex + swingOf(voice.pmLfo, clock) * LFO_RANGE.pm) / (Math.PI * 2)
    const depth = index * (1 - layer.source.fmFall * x)
    const spreadCents = layer.source.detune / 1200
    const voices = Math.min(MAX_VOICES, Math.max(1, Math.round(layer.source.voices)))
    for (let n = 0; n < voices; n += 1) {
      const place = voices === 1 ? 0 : n / (voices - 1) - 0.5
      const step = dt * Math.pow(2, place * spreadCents)
      const at = ((voice.phases[n] ?? 0) + step) % 1
      voice.phases[n] = at
      let read = at
      if (depth > 0) {
        let bend = from
        if (from === null) {
          const modStep = step * layer.source.fmRatio
          const modAt = ((voice.fmPhases[n] ?? 0) + modStep) % 1
          voice.fmPhases[n] = modAt
          bend = Math.sin(modAt * Math.PI * 2)
        }
        const shifted = (at + depth * (bend ?? 0)) % 1
        read = shifted < 0 ? shifted + 1 : shifted
      }
      const value = voice.table
        ? tableAt(voice.table, warp(read, duty), position, step / (2 * Math.min(duty, 1 - duty)))
        : layer.source.kind === 'table'
          ? 0
          : waveAt(layer.source.wave, read, step, duty)
      const side = pan(Math.min(1, Math.max(-1, layer.pan + place * 2 * width)))
      rawL += value * side.left
      rawR += value * side.right
    }
    rawL /= Math.sqrt(voices)
    rawR /= Math.sqrt(voices)
  }

  const routing = layer.filterB.kind === 'off' ? 'single' : layer.routing
  const across = Math.min(1, Math.max(0, layer.filterMix))
  const swing = swingOf(voice.cutoffLfo, clock) * LFO_RANGE.cutoff
  const swingUp = Math.pow(2, swing)
  const lift = voice.resoLfo.length === 0 ? 0 : swingOf(voice.resoLfo, clock) * LFO_RANGE.resonance
  const aCut = layer.filterA.cutoff * (layer.filterA.envAmount === 0
    ? swingUp
    : Math.pow(2, layer.filterA.envAmount * curveAt(layer.filterA.envCurve, x) + swing))
  const aRes = lift === 0 ? layer.filterA.resonance : Math.min(1, Math.max(0, layer.filterA.resonance + lift))
  let left = filterSample(voice.filters[0]!, layer.filterA.kind, rawL, aCut, aRes, sampleRate)
  let right = filterSample(voice.filters[1]!, layer.filterA.kind, rawR, aCut, aRes, sampleRate)
  if (routing !== 'single') {
    const bCut = layer.filterB.cutoff * (layer.filterB.envAmount === 0
      ? swingUp
      : Math.pow(2, layer.filterB.envAmount * curveAt(layer.filterB.envCurve, x) + swing))
    const bRes = lift === 0 ? layer.filterB.resonance : Math.min(1, Math.max(0, layer.filterB.resonance + lift))
    if (routing === 'series') {
      left = filterSample(voice.second[0]!, layer.filterB.kind, left, bCut, bRes, sampleRate)
      right = filterSample(voice.second[1]!, layer.filterB.kind, right, bCut, bRes, sampleRate)
    } else {
      left = left * (1 - across) + filterSample(voice.second[0]!, layer.filterB.kind, rawL, bCut, bRes, sampleRate) * across
      right = right * (1 - across) + filterSample(voice.second[1]!, layer.filterB.kind, rawR, bCut, bRes, sampleRate) * across
    }
  }
  for (let at = 0; at < voice.before.length; at += 1) {
    const unit = voice.before[at]!
    unit.slot = layer[unit.which]
    const amount = amountOf(unit, clock)
    left = insertSample(unit.left, unit.slot, left, frequency, sampleRate, amount)
    right = insertSample(unit.right, unit.slot, right, frequency, sampleRate, amount)
  }

  const open = opening === 0 ? 1 : Math.min(1, (i - start) / opening)
  const amplitude = (gate === 'hold' || gate === 'release'
    ? envelopeHeld(layer.amp, t, releasedAt === null ? null : releasedAt - offset)
    : envelopeAt(layer.amp, fitEnvelope(layer.amp, Math.max(0.001, life)), t, life)) * open
  const tremolo = voice.gainLfo.length === 0 ? 1
    : Math.max(0, 1 + ((swingOf(voice.gainLfo, clock) - 1) / 2) * LFO_RANGE.gain)
  let hitL = left * amplitude
  let hitR = right * amplitude
  for (let at = 0; at < voice.after.length; at += 1) {
    const unit = voice.after[at]!
    unit.slot = layer[unit.which]
    const amount = amountOf(unit, clock)
    hitL = insertSample(unit.left, unit.slot, hitL, frequency, sampleRate, amount)
    hitR = insertSample(unit.right, unit.slot, hitR, frequency, sampleRate, amount)
  }
  const capture = panSum !== 0 ? (hitL + hitR) / panSum : 0
  const level = layer.gain * tremolo
  if (voice.panLfo.length === 0) return { left: hitL * level, right: hitR * level, capture }
  const moved = Math.min(1, Math.max(-1, layer.pan + swingOf(voice.panLfo, clock) * LFO_RANGE.pan))
  const turn = (moved - layer.pan) * (Math.PI / 4)
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  return { left: (hitL * cos - hitR * sin) * level, right: (hitL * sin + hitR * cos) * level, capture }
}

export function processVoice(voice: Voice, left: Float32Array, right: Float32Array): void {
  const frames = left.length
  const fadeIn = Math.max(1, Math.round(FADE_IN_SECONDS * voice.sampleRate))
  const stopSamples = Math.max(1, Math.round(0.005 * voice.sampleRate))

  for (let f = 0; f < frames; f += 1) {
    if (voice.gate === 'repeat' && voice.note >= voice.length) retrigger(voice)
    const clock = voice.note / voice.sampleRate
    const patch = soundingPatch(voice, clock)
    const fadeOut = Math.max(1, Math.round(Math.max(0, patch.master.fadeOut) * voice.sampleRate))
    const limiter = Math.min(1, Math.max(0, patch.master.limiter))
    let mixL = 0
    let mixR = 0
    for (const index of voice.order) {
      const layer = patch.layers[index]
      const state = voice.layers[index]
      if (!layer || !state) continue
      const feeds = voice.from[index]
      const from = feeds === null || feeds === undefined ? null : (voice.captures[feeds] ?? 0)
      const sample = layerSample(state, layer, patch, voice.sampleRate, clock, voice.note, from, voice.gate, voice.releasedAt)
      voice.captures[index] = sample.capture
      mixL += sample.left
      mixR += sample.right
    }
    const wet = fxChainSample(voice.fx, mixL, mixR, voice.clock, voice.sampleRate, patch.fx)
    voice.dcOutL = wet.left - voice.dcInL + voice.dcPole * voice.dcOutL
    voice.dcInL = wet.left
    voice.dcOutR = wet.right - voice.dcInR + voice.dcPole * voice.dcOutR
    voice.dcInR = wet.right
    let valueL = voice.dcOutL * patch.master.gain
    let valueR = voice.dcOutR * patch.master.gain
    // The sound's stereo width, as mid and side: the only width that belongs to the whole sound.
    const width = patch.master.width ?? 1
    if (width !== 1) {
      const mid = (valueL + valueR) * 0.5
      const side = (valueL - valueR) * 0.5 * Math.max(0, width)
      valueL = mid + side
      valueR = mid - side
    }
    if (limiter > 0) {
      valueL = valueL * (1 - limiter) + Math.tanh(valueL) * limiter
      valueR = valueR * (1 - limiter) + Math.tanh(valueR) * limiter
    }
    if (voice.note < fadeIn) {
      const k = voice.note / fadeIn
      valueL *= k
      valueR *= k
    }
    if (voice.gate === 'oneshot') {
      const fromEnd = voice.length - 1 - voice.note
      if (fromEnd < fadeOut) {
        const k = Math.max(0, fromEnd / fadeOut)
        valueL *= k
        valueR *= k
      }
    }
    if (voice.gate === 'stop') {
      voice.stopGain = Math.max(0, voice.stopGain - 1 / stopSamples)
      valueL *= voice.stopGain
      valueR *= voice.stopGain
    }
    left[f] = Number.isFinite(valueL) ? Math.min(1, Math.max(-1, valueL)) : 0
    right[f] = Number.isFinite(valueR) ? Math.min(1, Math.max(-1, valueR)) : 0
    voice.clock += 1
    voice.note += 1
  }
  if (voice.ramps.length && voice.ramps.every((ramp) => ramp.remaining <= 0)) voice.ramps = []
}

export function renderVoice(patch: AudioPatch, sampleRate: number, blockSize = 0): Stereo {
  const length = Math.max(1, Math.round(Math.max(0.001, patch.duration) * sampleRate))
  const voice = createVoice(patch, sampleRate, { length })
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  const step = blockSize > 0 ? blockSize : length
  for (let at = 0; at < length; at += step) {
    const n = Math.min(step, length - at)
    processVoice(voice, left.subarray(at, at + n), right.subarray(at, at + n))
  }
  return { left, right }
}
