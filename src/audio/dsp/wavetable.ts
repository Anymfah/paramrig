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
    note: 'A sine that grows into a saw. The plainest way to open a sound up.',
    spectrum: (h, p) => {
      // The position moves a soft ceiling up the harmonic series rather than switching harmonics on.
      const reach = 1 + p * p * 63
      const fall = Math.exp(-(((h - 1) / reach) ** 2))
      return fall / h
    },
  },
  pulse: {
    label: 'Pulse',
    note: 'A square whose duty narrows to a sliver. Hollow at the top of the knob.',
    spectrum: (h, p) => {
      const duty = 0.5 - p * 0.45
      return Math.abs(Math.sin(Math.PI * h * duty)) / h
    },
  },
  formant: {
    label: 'Formant',
    note: 'A peak that walks up the spectrum. The closest this gets to a vowel.',
    spectrum: (h, p) => {
      const centre = 1 + p * 24
      const width = 2 + p * 6
      return Math.exp(-(((h - centre) / width) ** 2)) / Math.sqrt(h)
    },
  },
  bell: {
    label: 'Bell',
    note: 'Odd harmonics, spaced wider as the knob turns. Struck metal, not a horn.',
    spectrum: (h, p) => {
      if (h % 2 === 0) return 0
      const spread = 1 + p * 3
      return Math.exp(-((h - 1) / (24 / spread))) / Math.sqrt(h)
    },
  },
  stack: {
    label: 'Stack',
    note: 'A saw combed into ridges, the way detuned copies of one wave interfere.',
    spectrum: (h, p) => {
      const comb = 0.5 + 0.5 * Math.cos(2 * Math.PI * h * (0.02 + p * 0.18))
      return (comb * Math.exp(-(h - 1) / 40)) / h
    },
  },
  fold: {
    label: 'Fold',
    note: 'A sine gaining the odd harmonics of a folded wave. Bites without a filter.',
    spectrum: (h, p) => {
      if (h % 2 === 0) return p * 0.1 / h
      const order = (h - 1) / 2
      return (p ** order) * Math.exp(-order * 0.25) / Math.sqrt(h)
    },
  },
  glass: {
    label: 'Glass',
    note: 'Nothing low, everything high, and the floor drops as the knob turns.',
    spectrum: (h, p) => {
      const floor = 20 - p * 17
      return h < floor ? 0 : Math.exp(-(h - floor) / 18) / Math.sqrt(h)
    },
  },
  growl: {
    label: 'Growl',
    note: 'Alternating harmonics, uneven on purpose. Engines and creatures.',
    spectrum: (h, p) => {
      const beat = 0.35 + 0.65 * Math.abs(Math.sin(h * (0.7 + p * 1.9)))
      return (beat * Math.exp(-(h - 1) / 30)) / h
    },
  },
}

export type TableName = keyof typeof TABLES
export const TABLE_NAMES = Object.keys(TABLES) as TableName[]
export const tableOf = (value: unknown): TableName =>
  (typeof value === 'string' && Object.hasOwn(TABLES, value) ? value as TableName : 'sweep')

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
function fill(frames: Float32Array, at: number, spectrum: Spectrum, position: number, harmonics: number): void {
  let loudest = 0
  const amplitudes = new Float64Array(harmonics + 1)
  for (let h = 1; h <= harmonics; h += 1) {
    const amplitude = spectrum(h, position)
    amplitudes[h] = Number.isFinite(amplitude) ? amplitude : 0
    loudest += Math.abs(amplitudes[h] ?? 0)
  }
  // Normalised by the sum of the harmonics, so a table's level does not lurch as the knob turns.
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

/** A table, built the first time it is asked for and kept for the life of the process. */
export function wavetable(name: TableName): Wavetable {
  const kept = built.get(name)
  if (kept) return kept
  const spectrum = TABLES[name]?.spectrum ?? TABLES.sweep!.spectrum
  const frames = new Float32Array(POSITIONS * BANDS.length * FRAME)
  for (let p = 0; p < POSITIONS; p += 1) {
    for (let b = 0; b < BANDS.length; b += 1) {
      fill(frames, (p * BANDS.length + b) * FRAME, spectrum, p / (POSITIONS - 1), BANDS[b] ?? 1)
    }
  }
  const made = { frames, limits: BANDS }
  built.set(name, made)
  return made
}

/**
 * One sample of a table at a phase, a position, and a pitch.
 *
 * `dt` is the phase the oscillator advances per sample, which is the pitch divided by the rate,
 * and it is what chooses the band: every harmonic in the band has to sit under half the rate, so
 * the tallest band allowed holds `0.5 / dt` harmonics.
 */
export function tableAt(table: Wavetable, phase: number, position: number, dt: number): number {
  const allowed = dt > 0 ? 0.5 / dt : Infinity
  let band = 0
  for (let b = 0; b < table.limits.length; b += 1) {
    if ((table.limits[b] ?? 1) <= allowed) band = b
  }
  const held = Math.min(1, Math.max(0, position)) * (POSITIONS - 1)
  const low = Math.floor(held)
  const high = Math.min(POSITIONS - 1, low + 1)
  const blend = held - low
  const wrapped = phase - Math.floor(phase)
  const along = wrapped * FRAME
  const i0 = Math.floor(along)
  const frac = along - i0
  const i1 = (i0 + 1) % FRAME
  const a = (low * table.limits.length + band) * FRAME
  const b = (high * table.limits.length + band) * FRAME
  const first = (table.frames[a + i0] ?? 0) + ((table.frames[a + i1] ?? 0) - (table.frames[a + i0] ?? 0)) * frac
  const second = (table.frames[b + i0] ?? 0) + ((table.frames[b + i1] ?? 0) - (table.frames[b + i0] ?? 0)) * frac
  return first + (second - first) * blend
}
