import { AUDIO_FIELDS, LAYER_COUNT, LFO_COUNT, LAYER_SECTIONS, type FieldSpec, type LayerSection } from './fields.ts'
import { LINEAR } from './dsp/curve.ts'
import type { AmpSettings, AudioPatch, FilterSettings, FxSettings, Layer, Lfo, MasterSettings, PitchSettings, ShaperSettings, SourceSettings } from './types.ts'

/**
 * How a patch is built and how it is read back.
 *
 * The reader clamps against the same field tables the parser and the inspector use, so a file that
 * says the cutoff is minus four million comes back at twenty hertz rather than making a filter
 * that cannot be tuned. Nothing here repairs a patch into something it was not: a missing field
 * takes the default, a present one is held to its range.
 */

export type LayerInput = {
  enabled?: boolean
  gain?: number
  offset?: number
  source?: Partial<SourceSettings>
  pitch?: Partial<PitchSettings>
  filter?: Partial<FilterSettings>
  shaper?: Partial<ShaperSettings>
  amp?: Partial<AmpSettings>
}

export function makeLayer(input: LayerInput = {}): Layer {
  return {
    enabled: input.enabled ?? true,
    gain: input.gain ?? 0.8,
    offset: input.offset ?? 0,
    source: { kind: 'tone', wave: 'square', pulseWidth: 0.5, colour: 'white', voices: 1, detune: 12, ...input.source },
    pitch: {
      start: 440, slide: 0, slideCurve: LINEAR, vibratoRate: 0, vibratoDepth: 0,
      arpeggioRatio: 1, arpeggioAt: 1, jitter: 0, ...input.pitch,
    },
    filter: { kind: 'off', cutoff: 8000, resonance: 0, envAmount: 0, envCurve: LINEAR, ...input.filter },
    shaper: { drive: 0, bitDepth: 16, crush: 0, ...input.shaper },
    amp: { attack: 0.004, hold: 0, decay: 0.12, sustain: 0, release: 0.05, curve: 2, ...input.amp },
  }
}

export function silentLayer(): Layer {
  return makeLayer({ enabled: false })
}

export function makeFx(input: Partial<FxSettings> = {}): FxSettings {
  return {
    delayTime: 0.12, delayFeedback: 0.3, delayMix: 0,
    reverbSize: 0.5, reverbDamping: 0.4, reverbMix: 0,
    flangerRate: 0.5, flangerDepth: 0.5, flangerMix: 0,
    tone: 0, ...input,
  }
}

export function makeMaster(input: Partial<MasterSettings> = {}): MasterSettings {
  return { gain: 0.9, limiter: 0.6, fadeOut: 0.01, ...input }
}

export function makeLfo(input: Partial<Lfo> = {}): Lfo {
  return { enabled: false, shape: 'sine', rate: 5, depth: 0.3, phase: 0, target: 'off', ...input }
}

/** Three layers, whatever was handed over, padded with silent ones. A patch always has three. */
export function makePatch(duration: number, layers: Layer[], fx: Partial<FxSettings> = {}, master: Partial<MasterSettings> = {}, seed = 1, lfos: Partial<Lfo>[] = []): AudioPatch {
  const three = Array.from({ length: LAYER_COUNT }, (_, index) => layers[index] ?? silentLayer())
  const modulators = Array.from({ length: LFO_COUNT }, (_, index) => makeLfo(lfos[index]))
  return { version: 1, duration, seed, layers: three, lfos: modulators, fx: makeFx(fx), master: makeMaster(master) }
}

/** What a new patch sounds like before anything is touched: one short blip, audible immediately. */
export function defaultPatch(): AudioPatch {
  return makePatch(0.25, [
    makeLayer({
      gain: 0.5,
      source: { kind: 'tone', wave: 'square', pulseWidth: 0.5 },
      pitch: { start: 660, slide: -7 },
      amp: { attack: 0.004, hold: 0.01, decay: 0.14, sustain: 0, release: 0.05, curve: 2 },
    }),
  ], { tone: 0.15 })
}

function clampField(spec: FieldSpec, value: unknown, fallback: unknown): unknown {
  if (spec.type === 'boolean') return typeof value === 'boolean' ? value : fallback
  if (spec.type === 'option') return typeof value === 'string' && spec.options?.includes(value) ? value : fallback
  if (spec.type === 'curve') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
    const source = value as Record<string, unknown>
    if (source.type !== 'cubic-bezier') return fallback
    const ok = (point: unknown) => Array.isArray(point) && point.length >= 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n))
    return ok(source.p0) && ok(source.p1) && ok(source.p2) && ok(source.p3) ? value : fallback
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, value))
}

function readSection(table: Record<string, FieldSpec>, value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return Object.fromEntries(
    Object.entries(table).map(([field, spec]) => [field, clampField(spec, source[field], fallback[field])]),
  )
}

/**
 * One layer, with anything missing taken from the layer a new patch would have in that slot —
 * not from a generic blank one. Otherwise a file that cannot be read comes back as a hybrid of
 * two defaults rather than as the patch a new document starts from.
 */
function readLayer(value: unknown, base: Layer): Layer {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const sections = (Object.keys(LAYER_SECTIONS) as LayerSection[]).filter((section) => section !== 'root')
  const root = readSection(LAYER_SECTIONS.root, source, base as unknown as Record<string, unknown>)
  const nested = Object.fromEntries(
    sections.map((section) => [section, readSection(LAYER_SECTIONS[section], source[section], base[section] as unknown as Record<string, unknown>)]),
  )
  return { ...root, ...nested } as unknown as Layer
}

/** A patch read back from storage or from a file that could say anything. */
export function sanitizeAudioPatch(value: unknown): AudioPatch {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const base = defaultPatch()
  const top = readSection(AUDIO_FIELDS.patch, source, base as unknown as Record<string, unknown>)
  const rawLayers = Array.isArray(source.layers) ? source.layers : []
  const rawLfos = Array.isArray(source.lfos) ? source.lfos : []
  return {
    version: 1,
    duration: typeof top.duration === 'number' ? top.duration : base.duration,
    seed: typeof top.seed === 'number' ? Math.round(top.seed) : base.seed,
    layers: Array.from({ length: LAYER_COUNT }, (_, index) =>
      (index < rawLayers.length ? readLayer(rawLayers[index], base.layers[index] ?? silentLayer()) : base.layers[index] ?? silentLayer())),
    lfos: Array.from({ length: LFO_COUNT }, (_, index) => (
      readSection(AUDIO_FIELDS.lfo, rawLfos[index], makeLfo() as unknown as Record<string, unknown>) as unknown as Lfo
    )),
    fx: readSection(AUDIO_FIELDS.fx, source.fx, base.fx as unknown as Record<string, unknown>) as unknown as FxSettings,
    master: readSection(AUDIO_FIELDS.master, source.master, base.master as unknown as Record<string, unknown>) as unknown as MasterSettings,
  }
}
