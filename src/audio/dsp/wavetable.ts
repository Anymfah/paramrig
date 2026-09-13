/**
 * Wavetables, made rather than loaded.
 *
 * A table is a spectrum that changes shape as a knob turns: for each position from zero to one,
 * how loud each harmonic is. That is all a wavetable is, and writing it as a function of the
 * harmonic and the position rather than as a file means the whole library weighs nothing, ships
 * with the code, and can be drawn by the same maths that plays it.
 *
 * Playing one honestly is the work. Summing harmonics per sample would cost sixty sines a sample;
 * playing a single stored cycle would fold every harmonic above Nyquist back down as grit — the
 * same failure PolyBLEP exists to prevent in `osc.ts`. So each table is built once into frames
 * that hold a fixed number of harmonics, and the oscillator reads the frame whose harmonics all
 * fit under Nyquist at the pitch it is playing. Between two frames it interpolates, in position
 * and in phase, so neither knob nor pitch steps.
 *
 * The build is paid once per table per rate, on the first note that uses it, and kept. It is
 * about a hundred milliseconds of arithmetic for a library nobody has to download.
 */

/** Samples in one cycle. A thousand is under a tenth of a decibel of error at the top harmonic. */
const FRAME = 1024
/** How many shapes are stored across the position knob; between two of them it interpolates. */
const POSITIONS = 17
/** Harmonic counts of the stored bands. A pitch picks the tallest band that fits under Nyquist. */
const BANDS = [1, 2, 4, 8, 16, 32, 64] as const

/** How loud harmonic `h` (one is the fundamental) is at this position, and where its phase starts. */
type Spectrum = (harmonic: number, position: number) => number

/**
 * The library.
 *
 * Each entry is a spectrum, not a recording. They are chosen to cover what a generator of short
 * sounds actually reaches for: something that opens, something that narrows, something that
 * speaks, something that rings, something that thickens, something that bites.
 */
export const TABLES: Record<string, { label: string; note: string; spectrum: Spectrum }> = {
  sweep: {
    label: 'Sweep',
    note: 'Sine into saw. The plainest way to open up.',
    spectrum: (h, p) => {
      // The position moves a soft ceiling up the harmonic series rather than switching harmonics on.
      const reach = 1 + p * p * 63
      const fall = Math.exp(-(((h - 1) / reach) ** 2))
      return fall / h
    },
  },
  pulse: {
    label: 'Pulse',
    note: 'A square narrowing to a hollow sliver.',
    spectrum: (h, p) => {
      const duty = 0.5 - p * 0.45
      return Math.abs(Math.sin(Math.PI * h * duty)) / h
    },
  },
  formant: {
    label: 'Formant',
    note: 'A peak walking up the spectrum. Nearly a vowel.',
    spectrum: (h, p) => {
      const centre = 1 + p * 24
      const width = 2 + p * 6
      return Math.exp(-(((h - centre) / width) ** 2)) / Math.sqrt(h)
    },
  },
  bell: {
    label: 'Bell',
    note: 'Odd harmonics, spaced wider. Struck metal.',
    spectrum: (h, p) => {
      if (h % 2 === 0) return 0
      const spread = 1 + p * 3
      return Math.exp(-((h - 1) / (24 / spread))) / Math.sqrt(h)
    },
  },
  stack: {
    label: 'Stack',
    note: 'A saw combed into ridges, like detuned copies.',
    spectrum: (h, p) => {
      const comb = 0.5 + 0.5 * Math.cos(2 * Math.PI * h * (0.02 + p * 0.18))
      return (comb * Math.exp(-(h - 1) / 40)) / h
    },
  },
  fold: {
    label: 'Fold',
    note: 'A sine folding over. Bites without a filter.',
    spectrum: (h, p) => {
      if (h % 2 === 0) return p * 0.1 / h
      const order = (h - 1) / 2
      return (p ** order) * Math.exp(-order * 0.25) / Math.sqrt(h)
    },
  },
  glass: {
    label: 'Glass',
    note: 'Nothing low, and the floor drops as it turns.',
    spectrum: (h, p) => {
      const floor = 20 - p * 17
      return h < floor ? 0 : Math.exp(-(h - floor) / 18) / Math.sqrt(h)
    },
  },
  growl: {
    label: 'Growl',
    note: 'Uneven harmonics. Engines and creatures.',
    spectrum: (h, p) => {
      const beat = 0.35 + 0.65 * Math.abs(Math.sin(h * (0.7 + p * 1.9)))
      return (beat * Math.exp(-(h - 1) / 30)) / h
    },
  },
  titan: {
    label: 'Titan',
    note: 'A thick inharmonic stack. Mass with a bright edge.',
    spectrum: (h, p) => {
      const metal = h % 3 === 0 ? 0.15 : 1
      const reach = 8 + p * 40
      return (metal * Math.exp(-((h - 1) / reach))) / Math.sqrt(h)
    },
  },
  prism: {
    label: 'Prism',
    note: 'A sine that opens into a lattice of odd partials.',
    spectrum: (h, p) => {
      if (h === 1) return 1
      if (h % 2 === 0) return p * 0.04 / h
      const bloom = Math.pow(p, 0.6)
      return bloom * Math.exp(-(((h - 3) / (6 + p * 18)) ** 2)) / Math.sqrt(h)
    },
  },
  gate: {
    label: 'Gate',
    note: 'A hollow tube that fills as it turns.',
    spectrum: (h, p) => {
      const floor = 1 + (1 - p) * 10
      if (h < floor) return 1 / h
      const air = Math.exp(-((h - floor) / (4 + p * 20)))
      return air / Math.sqrt(h)
    },
  },
  serpent: {
    label: 'Serpent',
    note: 'A moving formant over a metallic bed.',
    spectrum: (h, p) => {
      const centre = 2 + p * 18
      const vowel = Math.exp(-(((h - centre) / (1.4 + p * 3)) ** 2))
      const metal = h % 2 === 0 ? 0.08 : 0.45
      return (vowel * 1.4 + metal * Math.exp(-(h - 1) / 28)) / Math.sqrt(h)
    },
  },
  ion: {
    label: 'Ion',
    note: 'Stacked ridges that beat as the position turns.',
    spectrum: (h, p) => {
      const comb = 0.35 + 0.65 * Math.abs(Math.cos(Math.PI * h * (0.08 + p * 0.22)))
      const lift = Math.exp(-((h - 1) / (18 + p * 30)))
      return (comb * lift) / h
    },
  },
}

export type TableName = keyof typeof TABLES
export const TABLE_NAMES = Object.keys(TABLES) as TableName[]

/** A built-in name, or a user table stored beside the patch. */
export const isTableName = (value: string): boolean =>
  Object.hasOwn(TABLES, value) || /^user:[a-z0-9-]{8,}$/i.test(value)

export const tableOf = (value: unknown): string =>
  (typeof value === 'string' && isTableName(value) ? value : 'sweep')

/** A built table: one frame per position per band, all in one array. */
export type Wavetable = { frames: Float32Array; limits: readonly number[] }

/**
 * One frame, summed from the harmonics that fit in its band.
 *
 * Built by recurrence rather than by calling a sine per harmonic per sample: rotating a unit
 * vector by the harmonic's angle costs two multiplies and an add, and a frame of a thousand
 * samples with sixty-four harmonics is sixty-five thousand of those rather than sixty-five
 * thousand transcendental calls. The rounding of the recurrence is far below the level a table is
 * played back at.
 */
function fill(frames: Float32Array, at: number, spectrum: Spectrum, position: number, harmonics: number, loudest: number): void {
  const amplitudes = new Float64Array(harmonics + 1)
  for (let h = 1; h <= harmonics; h += 1) {
    const amplitude = spectrum(h, position)
    amplitudes[h] = Number.isFinite(amplitude) ? amplitude : 0
  }
  /*
   * Normalised by the sum of the harmonics of the *widest* band, not of this one.
   *
   * Each band used to be scaled by its own sum, which meant the 32-harmonic frame and the
   * 64-harmonic frame of the same position were two different levels — so crossing a band
   * boundary, which happens at fixed pitches as a note slides, stepped the level by up to six
   * decibels and put a discontinuity in the waveform. A downward laser, which is the thing tables
   * are here for, walked down a staircase. Scaled together, dropping a band only removes the
   * harmonics that no longer fit, which is all it was ever supposed to do.
   */
  const scale = loudest > 1e-9 ? 1 / loudest : 0
  for (let h = 1; h <= harmonics; h += 1) {
    const amplitude = (amplitudes[h] ?? 0) * scale
    if (amplitude === 0) continue
    const angle = (2 * Math.PI * h) / FRAME
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    let re = 1
    let im = 0
    for (let i = 0; i < FRAME; i += 1) {
      frames[at + i] = (frames[at + i] ?? 0) + amplitude * im
      const next = re * cos - im * sin
      im = re * sin + im * cos
      re = next
    }
  }
}

const built = new Map<string, Wavetable>()
const custom = new Map<string, Wavetable>()

/** A table, built the first time it is asked for and kept for the life of the process. */
export function wavetable(name: string): Wavetable {
  const customHeld = custom.get(name)
  if (customHeld) return customHeld
  const kept = built.get(name)
  if (kept) return kept
  const spectrum = TABLES[name as TableName]?.spectrum
  if (!spectrum) return wavetable('sweep')
  const frames = new Float32Array(POSITIONS * BANDS.length * FRAME)
  const widest = BANDS[BANDS.length - 1] ?? 1
  for (let p = 0; p < POSITIONS; p += 1) {
    const position = p / (POSITIONS - 1)
    let loudest = 0
    for (let h = 1; h <= widest; h += 1) {
      const amplitude = spectrum(h, position)
      loudest += Number.isFinite(amplitude) ? Math.abs(amplitude) : 0
    }
    for (let b = 0; b < BANDS.length; b += 1) {
      fill(frames, (p * BANDS.length + b) * FRAME, spectrum, position, BANDS[b] ?? 1, loudest)
    }
  }
  const made = { frames, limits: BANDS }
  built.set(name, made)
  return made
}

/**
 * A user table, prepared off the audio thread and handed in by id.
 *
 * Missing tables are not replaced by a built-in: the caller gets null and the layer stays silent
 * rather than playing a different shape under the same name.
 */
export function registerWavetable(id: string, table: Wavetable): void {
  custom.set(id, table)
}

export function listedWavetables(): { id: string; label: string; note: string }[] {
  const builtIn = TABLE_NAMES.map((id) => ({ id, label: TABLES[id]?.label ?? id, note: TABLES[id]?.note ?? '' }))
  const users = [...custom.keys()].filter((id) => id.startsWith('user:')).map((id) => ({ id, label: id.startsWith('user:') ? 'Imported' : id, note: 'A table brought in from a WAV file.' }))
  return [...builtIn, ...users]
}

export function wavetableOf(name: string): Wavetable | null {
  if (custom.has(name)) return custom.get(name) ?? null
  if (Object.hasOwn(TABLES, name)) return wavetable(name)
  // A missing imported table is a broken asset: stay silent rather than play a different one.
  if (/^user:/i.test(name)) return null
  return wavetable('sweep')
}

/**
 * One sample of a table at a phase, a position, and a pitch.
 *
 * `dt` is the phase the oscillator advances per sample, which is the pitch divided by the rate,
 * and it is what chooses the band: every harmonic in the band has to sit under half the rate, so
 * the tallest band allowed holds `0.5 / dt` harmonics.
 */
export function tableAt(table: Wavetable, phase: number, position: number, dt: number): number {
  const bands = table.limits.length
  const allowed = dt > 0 ? 0.5 / dt : Infinity
  let band = 0
  for (let b = 0; b < bands; b += 1) {
    if ((table.limits[b] ?? 1) <= allowed) band = b
  }
  /*
   * And the band above it, faded in as the pitch falls towards being able to carry it.
   *
   * Position is interpolated between two frames; the band used to be a hard switch, which put a
   * step in the waveform at fixed pitches — one sample, and a click. The two are blended the same
   * way now, over the whole octave between one band's harmonic count and the next's, so what is
   * left of the change is spread across an octave of the slide instead of landing on one sample.
   */
  const wide = Math.min(bands - 1, band + 1)
  const lower = table.limits[band] ?? 1
  const upper = table.limits[wide] ?? lower
  const rise = wide === band || upper <= lower || !Number.isFinite(allowed)
    ? 0
    : Math.min(1, Math.max(0, (allowed - lower) / (upper - lower)))
  const held = Math.min(1, Math.max(0, position)) * (POSITIONS - 1)
  const low = Math.floor(held)
  const high = Math.min(POSITIONS - 1, low + 1)
  const blend = held - low
  const wrapped = phase - Math.floor(phase)
  const along = wrapped * FRAME
  const i0 = Math.floor(along)
  const frac = along - i0
  const i1 = (i0 + 1) % FRAME
  const a = (low * bands + band) * FRAME
  const b = (high * bands + band) * FRAME
  const first = (table.frames[a + i0] ?? 0) + ((table.frames[a + i1] ?? 0) - (table.frames[a + i0] ?? 0)) * frac
  const second = (table.frames[b + i0] ?? 0) + ((table.frames[b + i1] ?? 0) - (table.frames[b + i0] ?? 0)) * frac
  const under = first + (second - first) * blend
  if (rise <= 0) return under
  const c = (low * bands + wide) * FRAME
  const d = (high * bands + wide) * FRAME
  const third = (table.frames[c + i0] ?? 0) + ((table.frames[c + i1] ?? 0) - (table.frames[c + i0] ?? 0)) * frac
  const fourth = (table.frames[d + i0] ?? 0) + ((table.frames[d + i1] ?? 0) - (table.frames[d + i0] ?? 0)) * frac
  const over = third + (fourth - third) * blend
  return under + (over - under) * rise
}

/** Samples in one stored cycle. Importers resample onto this so the player can stay one shape. */
export const WAVETABLE_FRAME = FRAME
export const WAVETABLE_POSITIONS = POSITIONS
export const WAVETABLE_MAX_CYCLES = 256

/**
 * A table from recorded cycles, not from a spectrum.
 *
 * Each cycle is resampled onto one stored frame. Harmonics are taken by a DFT so the same
 * band-limiting the built-in tables use still applies. Levels are left relative: a swell written
 * into the file stays a swell, instead of every frame being scaled to the same peak.
 */
export function wavetableFromCycles(cycles: Float32Array[]): Wavetable {
  const count = Math.min(WAVETABLE_MAX_CYCLES, Math.max(1, cycles.length))
  const spectra: number[][] = []
  const widest = BANDS[BANDS.length - 1] ?? 1
  for (let c = 0; c < count; c += 1) {
    const cycle = resampleCycle(cycles[c] ?? new Float32Array(FRAME), FRAME)
    spectra.push(harmonicsOf(cycle, widest))
  }
  let loudest = 0
  for (const spectrum of spectra) {
    let sum = 0
    for (let h = 1; h <= widest; h += 1) sum += Math.abs(spectrum[h] ?? 0)
    if (sum > loudest) loudest = sum
  }
  const frames = new Float32Array(POSITIONS * BANDS.length * FRAME)
  for (let p = 0; p < POSITIONS; p += 1) {
    const along = count === 1 ? 0 : (p / (POSITIONS - 1)) * (count - 1)
    const low = Math.floor(along)
    const high = Math.min(count - 1, low + 1)
    const blend = along - low
    const spectrum: Spectrum = (h) => {
      const a = spectra[low]?.[h] ?? 0
      const b = spectra[high]?.[h] ?? 0
      return a + (b - a) * blend
    }
    for (let b = 0; b < BANDS.length; b += 1) {
      fill(frames, (p * BANDS.length + b) * FRAME, spectrum, 0, BANDS[b] ?? 1, loudest)
    }
  }
  return { frames, limits: BANDS }
}

function resampleCycle(source: Float32Array, size: number): Float32Array {
  const out = new Float32Array(size)
  const span = source.length
  if (span <= 0) return out
  for (let i = 0; i < size; i += 1) {
    const at = (i / size) * span
    const lo = Math.floor(at) % span
    const hi = (lo + 1) % span
    const frac = at - Math.floor(at)
    out[i] = (source[lo] ?? 0) + ((source[hi] ?? 0) - (source[lo] ?? 0)) * frac
  }
  return out
}

function harmonicsOf(cycle: Float32Array, widest: number): number[] {
  const n = cycle.length
  const out = new Array<number>(widest + 1).fill(0)
  for (let h = 1; h <= widest; h += 1) {
    let re = 0
    let im = 0
    const step = (2 * Math.PI * h) / n
    for (let i = 0; i < n; i += 1) {
      const sample = cycle[i] ?? 0
      re += sample * Math.cos(step * i)
      im -= sample * Math.sin(step * i)
    }
    out[h] = Math.hypot(re, im) * (2 / n)
  }
  return out
}
