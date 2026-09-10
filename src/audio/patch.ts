import { AUDIO_FIELDS, LAYER_COUNT, MOD_COUNT, PERFORMER_COUNT, SCENE_COUNT, STEP_COUNT, LAYER_SECTIONS, type FieldSpec, type LayerSection } from './fields.ts'
import { LINEAR } from './dsp/curve.ts'
import type { AmpSettings, AudioPatch, FilterSettings, FxSettings, InsertSlot, Layer, MasterSettings, ModKind, ModSlot, Performer, PitchSettings, ResonatorSettings, ShaperSettings, SourceSettings } from './types.ts'

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
  filter?: Partial<FilterSettings>
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
    time: 8, feedback: 0.5,
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
    source: { kind: 'tone', wave: 'square', pulseWidth: 0.5, table: 'sweep', position: 0.5, colour: 'white', voices: 1, detune: 12, fmRatio: 2, fmIndex: 0, fmFall: 0.6, ...input.source },
    pitch: {
      start: 440, slide: 0, slideCurve: LINEAR, vibratoRate: 0, vibratoDepth: 0,
      arpeggioRatio: 1, arpeggioAt: 1, jitter: 0, ...input.pitch,
    },
    filter: { kind: 'off', cutoff: 8000, resonance: 0, envAmount: 0, envCurve: LINEAR, ...input.filter },
    insertA: makeInsert({ ...drivenSlot(input.shaper), ...input.insertA }),
    insertB: makeInsert({ ...crushedSlot(input.shaper), ...input.insertB }),
    insertC: makeInsert({ ...bodySlot(input.resonator), ...input.insertC }),
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
    tone: 0, width: 0.6, ...input,
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
  return { enabled: false, rate: 1, shape: 'step', bipolar: false, depth: 0.5, target: 'off', patterns: Array.from({ length: SCENE_COUNT }, makePattern), ...input }
}

/** Three layers, whatever was handed over, padded with silent ones. A patch always has three. */
/**
 * A caller still hands its oscillators and its envelopes in as two lists, because that is how
 * every preset in the library is written, and they land in the slots the reference gives them:
 * the envelopes in the first two, the oscillators in the six after.
 */
export function makePatch(duration: number, layers: Layer[], fx: Partial<FxSettings> = {}, master: Partial<MasterSettings> = {}, seed = 1, lfos: Partial<ModSlot>[] = [], envelopes: Partial<ModSlot>[] = [], performers: Partial<Performer>[] = []): AudioPatch {
  const three = Array.from({ length: LAYER_COUNT }, (_, index) => layers[index] ?? silentLayer())
  const mods = Array.from({ length: MOD_COUNT }, (_, index) => {
    const given = index < 2 ? envelopes[index] : lfos[index - 2]
    if (!given) return emptyMod(index)
    return index < 2 ? makeModEnvelope(given) : makeLfo(given)
  })
  const drawn = Array.from({ length: PERFORMER_COUNT }, (_, index) => makePerformer(performers[index]))
  return { version: PATCH_VERSION, duration, seed, layers: three, mods, performers: drawn, scene: 0, fx: makeFx(fx), master: makeMaster(master) }
}

/** A performer's rows read back from anything: twelve of sixteen levels, each held to 0..1. */
function readPatterns(value: unknown): number[][] {
  const rows = Array.isArray(value) ? value : []
  return Array.from({ length: SCENE_COUNT }, (_, scene) => {
    const row = Array.isArray(rows[scene]) ? rows[scene] as unknown[] : []
    return Array.from({ length: STEP_COUNT }, (_, step) => {
      const level = row[step]
      return typeof level === 'number' && Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
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

/**
 * What version of the patch shape this build writes, and how an older one is carried forward.
 *
 * A field that vanishes or is renamed does not fail loudly: `sanitizeAudioPatch` takes the default
 * for what it cannot find, and `sanitizeAudioRig` deletes every binding whose property no longer
 * parses. Between them, a rename silently throws away someone's exposed controls. A step here is
 * how a rename stops doing that: it moves the old shape to the new one before anything is read.
 *
 * Each step carries a raw record from version n to n + 1, in order. There are none yet; the seam
 * is open so that the first change to the shape has somewhere to go.
 */
export const PATCH_VERSION = 3

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

const MIGRATIONS: ((source: Record<string, unknown>) => Record<string, unknown>)[] = [intoSlots, intoInserts]

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
      const patterns = readPatterns(raw && typeof raw === 'object' ? (raw as Record<string, unknown>).patterns : undefined)
      return { ...fields, patterns } as unknown as Performer
    }),
    fx: readSection(AUDIO_FIELDS.fx, source.fx, base.fx as unknown as Record<string, unknown>) as unknown as FxSettings,
    master: readSection(AUDIO_FIELDS.master, source.master, base.master as unknown as Record<string, unknown>) as unknown as MasterSettings,
  }
}
