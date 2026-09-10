import { AUDIO_FIELDS, FX_SLOTS, INSERT_SLOTS, LAYER_COUNT, MOD_COUNT, PERFORMER_COUNT, SCENE_COUNT, STEP_COUNT, LAYER_SECTIONS, type FieldSpec, type LayerSection } from './fields.ts'
import { LINEAR } from './dsp/curve.ts'
import { sanitizeGestures } from './gestures.ts'
import type { AmpSettings, AudioPatch, FilterRouting, FilterSettings, FxSettings, FxSlot, InsertSlot, Layer, MasterSettings, ModKind, ModSlot, Performer, PitchSettings, ResonatorSettings, ShaperSettings, SourceSettings } from './types.ts'

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
  pan?: number
  spread?: number
  offset?: number
  source?: Partial<SourceSettings>
  pitch?: Partial<PitchSettings>
  /** The one filter a layer used to have, still written the short way; it becomes filter A. */
  filter?: Partial<FilterSettings>
  filterA?: Partial<FilterSettings>
  filterB?: Partial<FilterSettings>
  routing?: FilterRouting
  filterMix?: number
  /**
   * The drive and the resonator, still written the way a preset reads best.
   *
   * They are two of the seven things an insert slot can be now, and a patch stores three slots.
   * Kept here as the shorthand they are: `shaper: { drive: 0.35 }` says what it means, where
   * `insertA: { kind: 'drive', drive: 0.35 }` says how it is filed. Both land in the same place —
   * drive in A, the crusher in B, the body in C, on the side of the amplifier each was always on.
   */
  shaper?: Partial<ShaperSettings>
  resonator?: Partial<ResonatorSettings>
  insertA?: Partial<InsertSlot>
  insertB?: Partial<InsertSlot>
  insertC?: Partial<InsertSlot>
  amp?: Partial<AmpSettings>
}

/** An empty slot carrying the settings of all seven kinds, ready to be any of them. */
export function makeInsert(input: Partial<InsertSlot> = {}): InsertSlot {
  return {
    kind: 'off', place: 'pre', amount: 1,
    drive: 0, bitDepth: 16, crush: 0, ratio: 2,
    frequency: 900, spread: 0.7, decay: 0.25, partials: 4,
    time: 0.008, feedback: 0.5,
    profile: 'bar', character: 0.5,
    ...input,
  }
}

/** What a layer's drive becomes: the first slot, or nothing at all if it was never turned up. */
function drivenSlot(shaper: Partial<ShaperSettings> | undefined): Partial<InsertSlot> {
  const drive = shaper?.drive ?? 0
  return drive > 0 ? { kind: 'drive', drive } : {}
}

/** And its bits and its crush: the second slot, which is a bypass at sixteen bits and no hold. */
function crushedSlot(shaper: Partial<ShaperSettings> | undefined): Partial<InsertSlot> {
  const bitDepth = shaper?.bitDepth ?? 16
  const crush = shaper?.crush ?? 0
  return bitDepth < 16 || crush > 0 ? { kind: 'crusher', bitDepth, crush } : {}
}

/** The resonator: the third slot, standing after the amplifier, where it always stood. */
function bodySlot(resonator: Partial<ResonatorSettings> | undefined): Partial<InsertSlot> {
  const amount = resonator?.amount ?? 0
  if (amount <= 0) return { place: 'post' }
  return {
    kind: 'body', place: 'post', amount,
    frequency: resonator?.frequency ?? 900,
    spread: resonator?.spread ?? 0.7,
    decay: resonator?.decay ?? 0.25,
    partials: resonator?.partials ?? 4,
  }
}

export function makeLayer(input: LayerInput = {}): Layer {
  return {
    enabled: input.enabled ?? true,
    gain: input.gain ?? 0.8,
    pan: input.pan ?? 0,
    spread: input.spread ?? 0.5,
    offset: input.offset ?? 0,
    source: { kind: 'tone', wave: 'square', pulseWidth: 0.5, table: 'sweep', position: 0.5, colour: 'white', voices: 1, detune: 12, pmFrom: 'internal', fmRatio: 2, fmIndex: 0, fmFall: 0.6, ...input.source },
    pitch: {
      start: 440, slide: 0, slideCurve: LINEAR, vibratoRate: 0, vibratoDepth: 0,
      arpeggioRatio: 1, arpeggioAt: 1, jitter: 0, ...input.pitch,
    },
    routing: input.routing ?? 'single',
    filterMix: input.filterMix ?? 0.5,
    filterA: { kind: 'off', cutoff: 8000, resonance: 0, envAmount: 0, envCurve: LINEAR, ...input.filter, ...input.filterA },
    filterB: { kind: 'off', cutoff: 2000, resonance: 0, envAmount: 0, envCurve: LINEAR, ...input.filterB },
    insertA: makeInsert({ ...drivenSlot(input.shaper), ...input.insertA }),
    insertB: makeInsert({ ...crushedSlot(input.shaper), ...input.insertB }),
    insertC: makeInsert({ ...bodySlot(input.resonator), ...input.insertC }),
    amp: { attack: 0.004, hold: 0, decay: 0.12, sustain: 0, release: 0.05, curve: 2, ...input.amp },
  }
}

export function silentLayer(): Layer {
  return makeLayer({ enabled: false })
}

/**
 * The three master effects as a preset still writes them.
 *
 * The same shorthand as a layer's `shaper`: `flangerMix: 0.3` says what it means, where the slot
 * it becomes says how it is filed. They land where the migration of a saved patch puts them —
 * the flanger in X standing in the sound, the delay in Y beside it, the reverb in Z — which is
 * the order they ran in when they were three effects written into one loop.
 */
export type FxInput = Partial<Omit<FxSettings, 'x' | 'y' | 'z'>> & {
  x?: Partial<FxSlot>
  y?: Partial<FxSlot>
  z?: Partial<FxSlot>
  delayTime?: number
  delayFeedback?: number
  delayMix?: number
  reverbSize?: number
  reverbDamping?: number
  reverbMix?: number
  flangerRate?: number
  flangerDepth?: number
  flangerMix?: number
}

export function makeFxSlot(input: Partial<FxSlot> = {}): FxSlot {
  return {
    kind: 'off', mode: 'insert', mix: 0.35,
    rate: 0.5, depth: 0.5, feedback: 0.3,
    time: 0.12, size: 0.5, damping: 0.4, width: 0.5,
    ...input,
  }
}

/** A flanger with nothing to sweep is a fixed comb, which is not what anybody asked for. */
function flangerSlot(input: FxInput): Partial<FxSlot> {
  const mix = input.flangerMix ?? 0
  const depth = input.flangerDepth ?? 0.5
  if (mix <= 0 || depth <= 0) return {}
  return { kind: 'flanger', mode: 'insert', mix, depth, rate: input.flangerRate ?? 0.5, feedback: 0.4 }
}

function delaySlot(input: FxInput): Partial<FxSlot> {
  const mix = input.delayMix ?? 0
  if (mix <= 0) return { mode: 'send' }
  return { kind: 'delay', mode: 'send', mix, time: input.delayTime ?? 0.12, feedback: input.delayFeedback ?? 0.3 }
}

function reverbSlot(input: FxInput): Partial<FxSlot> {
  const mix = input.reverbMix ?? 0
  if (mix <= 0) return { mode: 'send' }
  return { kind: 'reverb', mode: 'insert', mix, size: input.reverbSize ?? 0.5, damping: input.reverbDamping ?? 0.4 }
}

export function makeFx(input: FxInput = {}): FxSettings {
  return {
    x: makeFxSlot({ ...flangerSlot(input), ...input.x }),
    y: makeFxSlot({ ...delaySlot(input), ...input.y }),
    z: makeFxSlot({ ...reverbSlot(input), ...input.z }),
    tone: input.tone ?? 0,
    width: input.width ?? 0.6,
  }
}

export function makeMaster(input: Partial<MasterSettings> = {}): MasterSettings {
  return { gain: 0.9, limiter: 0.6, fadeOut: 0.01, ...input }
}

/**
 * A slot before anything is pointed at it, holding the settings of both kinds it can be.
 *
 * The fields its kind does not read are not junk: they are what it reads the moment its kind
 * changes, which is why an envelope turned into an oscillator and back is the envelope it was.
 */
export function makeMod(input: Partial<ModSlot> = {}): ModSlot {
  return {
    kind: 'lfo',
    enabled: false,
    target: 'off',
    depth: 0.3,
    // The three it may also go to, switched off: a slot carries every field it might need.
    targetB: 'off', depthB: 0.3, targetC: 'off', depthC: 0.3, targetD: 'off', depthD: 0.3,
    delay: 0, attack: 0.01, hold: 0, decay: 0.2, sustain: 0, release: 0.05, curve: 2,
    shape: 'sine', rate: 5, phase: 0,
    ...input,
  }
}

/** What a new patch puts in each slot: two envelopes then six oscillators, as the reference has. */
export const DEFAULT_MOD_KINDS: ModKind[] = ['envelope', 'envelope', 'lfo', 'lfo', 'lfo', 'lfo', 'lfo', 'lfo']

const emptyMod = (index: number): ModSlot => {
  const kind = DEFAULT_MOD_KINDS[index] ?? 'lfo'
  return kind === 'envelope' ? makeMod({ kind, depth: 0.5 }) : makeMod({ kind })
}

/** An oscillator, as a slot. Kept because every preset hands its modulators in as these. */
export function makeLfo(input: Partial<ModSlot> = {}): ModSlot {
  return makeMod({ kind: 'lfo', ...input })
}

/** A free envelope before anything is pointed at it: a quick sweep, half strength, going nowhere. */
export function makeModEnvelope(input: Partial<ModSlot> = {}): ModSlot {
  return makeMod({ kind: 'envelope', depth: 0.5, ...input })
}

/** A row with nothing drawn on it. */
export function makePattern(): number[] {
  return Array.from({ length: STEP_COUNT }, () => 0)
}

/** A performer before anything is drawn on it: at rest, half strength, going nowhere. */
export function makePerformer(input: Partial<Performer> = {}): Performer {
  return {
    enabled: false, rate: 1, shape: 'step', bipolar: false, depth: 0.5, target: 'off', grid: 0,
    targetB: 'off', depthB: 0.5, targetC: 'off', depthC: 0.5, targetD: 'off', depthD: 0.5,
    patterns: Array.from({ length: SCENE_COUNT }, makePattern),
    // Every step joined the way the row says, which is what a performer did before it could say
    // otherwise: the field is new and a patch without it has to sound the same.
    curves: Array.from({ length: SCENE_COUNT }, () => Array.from({ length: STEP_COUNT }, () => 1)),
    ...input,
  }
}

/** Three layers, whatever was handed over, padded with silent ones. A patch always has three. */
/**
 * A caller still hands its oscillators and its envelopes in as two lists, because that is how
 * every preset in the library is written, and they land in the slots the reference gives them:
 * the envelopes in the first two, the oscillators in the six after.
 */
export function makePatch(duration: number, layers: Layer[], fx: FxInput = {}, master: Partial<MasterSettings> = {}, seed = 1, lfos: Partial<ModSlot>[] = [], envelopes: Partial<ModSlot>[] = [], performers: Partial<Performer>[] = []): AudioPatch {
  const three = Array.from({ length: LAYER_COUNT }, (_, index) => layers[index] ?? silentLayer())
  const mods = Array.from({ length: MOD_COUNT }, (_, index) => {
    const given = index < 2 ? envelopes[index] : lfos[index - 2]
    if (!given) return emptyMod(index)
    return index < 2 ? makeModEnvelope(given) : makeLfo(given)
  })
  const drawn = Array.from({ length: PERFORMER_COUNT }, (_, index) => makePerformer(performers[index]))
  return { version: PATCH_VERSION, duration, seed, layers: three, mods, performers: drawn, scene: 0, fx: makeFx(fx), master: makeMaster(master), gestures: [] }
}

/** The master's own two fields, and the three slots read the way a layer's sections are. */
function readFx(value: unknown, base: FxSettings): FxSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const top = readSection(AUDIO_FIELDS.fx, source, base as unknown as Record<string, unknown>)
  const slots = Object.fromEntries(FX_SLOTS.map((slot) => [
    slot,
    readSection(AUDIO_FIELDS.fxSlot, source[slot], base[slot] as unknown as Record<string, unknown>),
  ]))
  return { ...top, ...slots } as unknown as FxSettings
}

/**
 * A performer's rows read back from anything: twelve of sixteen numbers, each held to 0..1.
 *
 * `empty` is what a missing step becomes, and it is not the same for both grids a performer keeps:
 * a level nobody drew is the floor, and a joining nobody drew is the whole of it, which is how a
 * row written before there were joinings reads exactly as it did.
 */
function readRows(value: unknown, empty: number): number[][] {
  const rows = Array.isArray(value) ? value : []
  return Array.from({ length: SCENE_COUNT }, (_, scene) => {
    const row = Array.isArray(rows[scene]) ? rows[scene] as unknown[] : []
    return Array.from({ length: STEP_COUNT }, (_, step) => {
      const level = row[step]
      return typeof level === 'number' && Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : empty
    })
  })
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
  if (spec.type === 'option') {
    if (typeof value !== 'string') return fallback
    if (spec.options?.includes(value) || spec.accept?.(value)) return value
    return fallback
  }
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

/**
 * What version of the patch shape this build writes, and how an older one is carried forward.
 *
 * A field that vanishes or is renamed does not fail loudly: `sanitizeAudioPatch` takes the default
 * for what it cannot find, and `sanitizeAudioRig` deletes every binding whose property no longer
 * parses. Between them, a rename silently throws away someone's exposed controls. A step here is
 * how a rename stops doing that: it moves the old shape to the new one before anything is read.
 *
 * Each step carries a raw record from version n to n + 1, in order, and `MIGRATIONS[n - 1]` is the
 * step out of version n.
 */
export const PATCH_VERSION = 7

/**
 * One to two: the free envelopes and the oscillators were two lists, and are one list of slots
 * that each say which of the two they are. A slot's name is its place in that list, so the second
 * free envelope of an older patch is the second slot and the first oscillator is the third —
 * which is the numbering the routing bar already showed.
 */
function intoSlots(source: Record<string, unknown>): Record<string, unknown> {
  // A patch that already has slots is already here: it simply did not say which version it was,
  // which is what a hand-written object in a test looks like, and what a file trimmed by hand
  // looks like too. Carrying it forward again would throw its slots away.
  if (Array.isArray(source.mods)) return source
  const envelopes = Array.isArray(source.envelopes) ? source.envelopes : []
  const lfos = Array.isArray(source.lfos) ? source.lfos : []
  const mods = Array.from({ length: MOD_COUNT }, (_, index) => {
    const kind = DEFAULT_MOD_KINDS[index] ?? 'lfo'
    const was = index < 2 ? envelopes[index] : lfos[index - 2]
    return was && typeof was === 'object' && !Array.isArray(was) ? { kind, ...was as Record<string, unknown> } : { kind }
  })
  const carried: Record<string, unknown> = { ...source, mods }
  delete carried.envelopes
  delete carried.lfos
  return carried
}

/**
 * Two to three: every layer had one drive and one resonator, in an order nobody could change, and
 * now has three slots that each say what they are. What was there lands where it was — the drive
 * first, the crusher after it, the body on the far side of the amplifier — so a patch saved
 * yesterday sounds today exactly as it did, and can be taken apart afterwards.
 */
function intoInserts(source: Record<string, unknown>): Record<string, unknown> {
  const layers = Array.isArray(source.layers) ? source.layers : null
  if (!layers) return source
  const carried = layers.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const layer = value as Record<string, unknown>
    // Already a layer of slots, saying nothing about its version: a hand-written test object, or
    // a file someone trimmed. Carrying it forward again would throw the slots away.
    if (layer.insertA || layer.insertB || layer.insertC) return layer
    const shaper = layer.shaper as Partial<ShaperSettings> | undefined
    const resonator = layer.resonator as Partial<ResonatorSettings> | undefined
    const next: Record<string, unknown> = {
      ...layer,
      insertA: makeInsert(drivenSlot(shaper)),
      insertB: makeInsert(crushedSlot(shaper)),
      insertC: makeInsert(bodySlot(resonator)),
    }
    delete next.shaper
    delete next.resonator
    return next
  })
  return { ...source, layers: carried }
}

/**
 * Three to four: the flanger, the delay and the reverb were written into one loop in that order,
 * and become three slots that could each be anything. They land where they ran — the flanger in X
 * standing in the sound, the delay in Y beside it, the reverb in Z — so a patch saved yesterday
 * sounds today exactly as it did, and can be rearranged afterwards.
 */
function intoFxSlots(source: Record<string, unknown>): Record<string, unknown> {
  const fx = source.fx
  if (!fx || typeof fx !== 'object' || Array.isArray(fx)) return source
  const held = fx as Record<string, unknown>
  if (held.x || held.y || held.z) return source
  const carried = makeFx(held as FxInput) as unknown as Record<string, unknown>
  return { ...source, fx: carried }
}

/**
 * Four to five: a layer had one filter and has two, which stand in one of three arrangements. The
 * one that was there becomes A and the arrangement becomes `single`, so a patch saved yesterday is
 * the patch it was and the second filter is something to reach for rather than something that
 * happened to it.
 */
function intoTwoFilters(source: Record<string, unknown>): Record<string, unknown> {
  const layers = Array.isArray(source.layers) ? source.layers : null
  if (!layers) return source
  const carried = layers.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const layer = value as Record<string, unknown>
    if (layer.filterA || layer.filterB) return layer
    const next: Record<string, unknown> = { ...layer, filterA: layer.filter ?? {}, routing: 'single' }
    delete next.filter
    return next
  })
  return { ...source, layers: carried }
}

/**
 * Five to six: a comb insert's delay was the one time in this instrument stored in milliseconds.
 *
 * Every other one is in seconds, and `rig.ts` hands a field labelled `ms` the seconds-to-
 * milliseconds units so a control can be read in either — which meant a comb time of eleven was
 * offered to Tune as eleven *seconds* and shown on the plate as eleven thousand milliseconds. One
 * field disagreeing with the convention is worse than either convention, so it joins the rest.
 */
function intoSeconds(source: Record<string, unknown>): Record<string, unknown> {
  const layers = Array.isArray(source.layers) ? source.layers : null
  if (!layers) return source
  const carried = layers.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const layer = { ...(value as Record<string, unknown>) }
    for (const slot of INSERT_SLOTS) {
      const insert = layer[slot]
      if (!insert || typeof insert !== 'object' || Array.isArray(insert)) continue
      const held = insert as Record<string, unknown>
      if (typeof held.time !== 'number') continue
      layer[slot] = { ...held, time: held.time / 1000 }
    }
    return layer
  })
  return { ...source, layers: carried }
}

const MIGRATIONS: ((source: Record<string, unknown>) => Record<string, unknown>)[] = [intoSlots, intoInserts, intoFxSlots, intoTwoFilters, intoSeconds]

function migrate(source: Record<string, unknown>): Record<string, unknown> {
  const claimed = typeof source.version === 'number' && Number.isFinite(source.version) ? Math.floor(source.version) : 1
  let carried = source
  for (let from = Math.max(1, claimed); from < PATCH_VERSION; from += 1) {
    const step = MIGRATIONS[from - 1]
    if (step) carried = step(carried)
  }
  return carried
}

/** A patch read back from storage or from a file that could say anything. */
export function sanitizeAudioPatch(value: unknown): AudioPatch {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const source = migrate(raw)
  const base = defaultPatch()
  const top = readSection(AUDIO_FIELDS.patch, source, base as unknown as Record<string, unknown>)
  const rawLayers = Array.isArray(source.layers) ? source.layers : []
  const rawMods = Array.isArray(source.mods) ? source.mods : []
  const rawPerformers = Array.isArray(source.performers) ? source.performers : []
  return {
    version: PATCH_VERSION,
    duration: typeof top.duration === 'number' ? top.duration : base.duration,
    seed: typeof top.seed === 'number' ? Math.round(top.seed) : base.seed,
    scene: typeof top.scene === 'number' ? Math.round(top.scene) : 0,
    layers: Array.from({ length: LAYER_COUNT }, (_, index) =>
      (index < rawLayers.length ? readLayer(rawLayers[index], base.layers[index] ?? silentLayer()) : base.layers[index] ?? silentLayer())),
    mods: Array.from({ length: MOD_COUNT }, (_, index) => (
      readSection(AUDIO_FIELDS.mod, rawMods[index], emptyMod(index) as unknown as Record<string, unknown>) as unknown as ModSlot
    )),
    performers: Array.from({ length: PERFORMER_COUNT }, (_, index) => {
      const raw = rawPerformers[index]
      const fields = readSection(AUDIO_FIELDS.performer, raw, makePerformer() as unknown as Record<string, unknown>)
      const held = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
      const patterns = readRows(held.patterns, 0)
      const curves = readRows(held.curves, 1)
      return { ...fields, patterns, curves } as unknown as Performer
    }),
    fx: readFx(source.fx, base.fx),
    master: readSection(AUDIO_FIELDS.master, source.master, base.master as unknown as Record<string, unknown>) as unknown as MasterSettings,
    gestures: sanitizeGestures(source.gestures),
  }
}
