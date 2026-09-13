import type { Stereo } from '@paramrig/audio'

/**
 * What the relief is built from: the sound itself, measured.
 *
 * A spectrogram on a log-frequency grid, small enough to ship from the worker with the samples and
 * to upload as a texture, and a min/max envelope for the waveform strip. Both are computed once per
 * render, in the worker, so pressing play never costs the main thread an FFT.
 */
export const SPECTRUM_COLUMNS = 384
export const SPECTRUM_ROWS = 128
export const WAVE_COLUMNS = 384
/** Quieter than this many decibels under the loudest bin is drawn flat. */
export const SPECTRUM_FLOOR_DB = 80
export const SPECTRUM_MIN_HZ = 40

export type LabSpectrum = {
  columns: number
  rows: number
  /** Row-major, `row * columns + column`, 0–1 where 1 is the loudest bin of the sound. Row 0 is the lowest band. */
  values: Float32Array
  minHz: number
  maxHz: number
}

const twiddles = new Map<number, { cos: Float32Array; sin: Float32Array; reverse: Uint32Array }>()
function tables(size: number) {
  const cached = twiddles.get(size)
  if (cached) return cached
  const cos = new Float32Array(size / 2), sin = new Float32Array(size / 2)
  for (let i = 0; i < size / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / size); sin[i] = Math.sin(-2 * Math.PI * i / size) }
  const reverse = new Uint32Array(size)
  const bits = Math.log2(size)
  for (let i = 0; i < size; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    reverse[i] = r
  }
  const made = { cos, sin, reverse }
  twiddles.set(size, made)
  return made
}

/** In-place radix-2 transform; `re.length` must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const size = re.length
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two.')
  const { cos, sin, reverse } = tables(size)
  for (let i = 0; i < size; i++) {
    const j = reverse[i]!
    if (j > i) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const half = len >> 1, step = size / len
    for (let start = 0; start < size; start += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]!, wi = sin[k * step]!
        const a = start + k, b = a + half
        const xr = re[b]! * wr - im[b]! * wi
        const xi = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - xr; im[b] = im[a]! - xi
        re[a] = re[a]! + xr; im[a] = im[a]! + xi
      }
    }
  }
}

export function analyseSpectrum(samples: Stereo, rate: number, columns = SPECTRUM_COLUMNS, rows = SPECTRUM_ROWS): LabSpectrum {
  const length = samples.left.length
  // The window follows the sound: 43 ms is a tenth of a short sound and turns its pulses into
  // humps, so a short sound is read with a shorter window, down to 5 ms, and a long one at 2048.
  const window = Math.pow(2, Math.round(Math.log2(Math.min(2048, Math.max(256, length / 20)))))
  const minHz = SPECTRUM_MIN_HZ
  const maxHz = Math.min(20000, rate / 2)
  const values = new Float32Array(columns * rows)
  // A longer window resolves bass harmonics; the original short window preserves transients.
  // Never stretch a tiny sound into a long sustained spectrum, or exceed an 8192-point transform.
  const bassWindow = Math.max(window, Math.pow(2, Math.round(Math.log2(Math.max(256, Math.min(8192, rate * 0.17, length / 3))))))
  const short = spectrumFrame(window, rate, rows, minHz, maxHz)
  const bass = bassWindow > window ? spectrumFrame(bassWindow, rate, rows, minHz, maxHz) : short
  const blend = Float32Array.from({ length: rows }, (_, row) => {
    const hz = minHz * Math.pow(maxHz / minHz, (row + 0.5) / rows)
    const t = Math.min(1, Math.max(0, Math.log(hz / 250) / Math.log(1000 / 250)))
    return 1 - t * t * (3 - 2 * t)
  })
  const db = new Float32Array(columns * rows) // power first, decibels at the end
  let loudest = 0
  for (let column = 0; column < columns; column++) {
    const centre = Math.round((column + 0.5) / columns * length)
    short.read(samples, centre)
    if (bass !== short) bass.read(samples, centre)
    // The long window must not paint bass into a silent gap outside the short window's support.
    const activity = Math.min(1, short.energy / Math.max(1e-20, bass.energy))
    for (let row = 0; row < rows; row++) {
      const value = short.bands[row]! * (1 - blend[row]!) + bass.bands[row]! * activity * blend[row]!
      if (value > loudest) loudest = value
      db[row * columns + column] = value
    }
  }
  // Silence stays on the floor rather than becoming its own loudest bin.
  if (loudest < 1e-14) return { columns, rows, values, minHz, maxHz }
  // Only remove sub-bin jitter. The FFT window already smooths time: a second broad blur erased
  // attacks and narrow harmonics, turning different sounds into similar rounded ribbons.
  // Work in power, so the light smoothing cannot invent energy between neighbouring bands.
  const along = gaussian(0.35), across = gaussian(0.3)
  const pass = new Float32Array(columns * rows)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let sum = 0
      for (let k = 0; k < along.length; k++) sum += along[k]! * db[row * columns + Math.min(columns - 1, Math.max(0, column + k - (along.length >> 1)))]!
      pass[row * columns + column] = sum
    }
  }
  let peak = -Infinity
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let sum = 0
      for (let k = 0; k < across.length; k++) sum += across[k]! * pass[Math.min(rows - 1, Math.max(0, row + k - (across.length >> 1))) * columns + column]!
      const level = 10 * Math.log10(sum + 1e-20)
      values[row * columns + column] = level
      if (level > peak) peak = level
    }
  }
  for (let i = 0; i < values.length; i++) values[i] = Math.min(1, Math.max(0, (values[i]! - peak + SPECTRUM_FLOOR_DB) / SPECTRUM_FLOOR_DB))
  return { columns, rows, values, minHz, maxHz }
}

/** Reusable stereo FFT frame, amplitude-calibrated so different window lengths can be blended. */
function spectrumFrame(size: number, rate: number, rows: number, minHz: number, maxHz: number) {
  const re = new Float32Array(size), im = new Float32Array(size), hann = new Float32Array(size)
  const power = new Float32Array(size / 2), bands = new Float32Array(rows)
  let weight = 0
  for (let i = 0; i < size; i++) { hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)); weight += hann[i]! }
  const top = size / 2 - 1, scale = 1 / (weight * weight)
  const edges = Array.from({ length: rows + 1 }, (_, row) => Math.min(top, minHz * Math.pow(maxHz / minHz, row / rows) * size / rate))
  const frame = {
    bands, energy: 0,
    read(samples: Stereo, centre: number) {
      let energy = 0
      for (let i = 0; i < size; i++) {
        const at = centre - size / 2 + i
        const left = samples.left[at] ?? 0, right = samples.right[at] ?? 0
        re[i] = left * hann[i]!; im[i] = right * hann[i]!
        energy += (left * left + right * right) * 0.5 * hann[i]!
      }
      frame.energy = energy / weight
      // Two real channels in one complex transform retain stereo and opposite-phase detail.
      fft(re, im)
      for (let i = 0; i < size / 2; i++) {
        const mirror = (size - i) % size
        power[i] = (re[i]! ** 2 + im[i]! ** 2 + re[mirror]! ** 2 + im[mirror]! ** 2) * scale
      }
      for (let row = 0; row < rows; row++) {
        const lo = edges[row]!, hi = edges[row + 1]!
        let value = 0
        if (hi - lo < 2) {
          const at = Math.max(1, Math.sqrt(lo * hi)), i = Math.min(top - 1, Math.floor(at)), f = at - i
          value = power[i]! * (1 - f) + power[i + 1]! * f
        } else {
          for (let i = Math.max(1, Math.ceil(lo)); i <= Math.min(top, Math.floor(hi)); i++) value = Math.max(value, power[i]!)
        }
        bands[row] = value
      }
    },
  }
  return frame
}

/** A normalised Gaussian kernel of the given width, three sigmas each side. */
function gaussian(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float32Array(radius * 2 + 1)
  let total = 0
  for (let i = -radius; i <= radius; i++) { const w = Math.exp(-0.5 * (i / sigma) ** 2); kernel[i + radius] = w; total += w }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= total
  return kernel
}

/** Min and max per column, interleaved, from the louder of the two channels. */
export function waveEnvelope(samples: Stereo, columns = WAVE_COLUMNS): Float32Array {
  const length = samples.left.length
  const out = new Float32Array(columns * 2)
  for (let column = 0; column < columns; column++) {
    const from = Math.floor(column * length / columns), to = Math.max(from + 1, Math.floor((column + 1) * length / columns))
    let low = 0, high = 0
    for (let i = from; i < to && i < length; i++) {
      const l = samples.left[i] ?? 0, r = samples.right[i] ?? 0
      const value = Math.abs(l) > Math.abs(r) ? l : r
      if (value < low) low = value
      if (value > high) high = value
    }
    out[column * 2] = low; out[column * 2 + 1] = high
  }
  return out
}

/**
 * Two measurements of the whole rendered sound that the bench's shaping reads: its sample peak, in
 * dBFS, so a level asked for can be checked against the level reached, and its stereo spread —
 * side over mid, weighted by energy — so a width change can be told apart from a mono sound.
 */
export type LabShape = {
  /** The whole sound's peak, dBFS. */
  topDb: number
  /** Side over mid across the whole sound: 0 is mono, 1 is as wide as it is deep. */
  spreadAll: number
}

export function analyseShape(samples: Stereo): LabShape {
  let top = 0, mid = 0, side = 0
  for (let i = 0; i < samples.left.length; i++) {
    const l = samples.left[i]!, r = samples.right[i]!
    top = Math.max(top, Math.abs(l), Math.abs(r))
    const m = (l + r) * 0.5, d = (l - r) * 0.5
    mid += m * m; side += d * d
  }
  return { topDb: Math.max(-90, 20 * Math.log10(top + 1e-9)), spreadAll: mid > 1e-12 ? Math.min(3, Math.sqrt(side / mid)) : 0 }
}

/** Where a frequency sits across the rows, 0 at the lowest band and 1 at the highest. */
export function spectrumPosition(hz: number, spectrum: Pick<LabSpectrum, 'minHz' | 'maxHz'>): number {
  return Math.log(hz / spectrum.minHz) / Math.log(spectrum.maxHz / spectrum.minHz)
}
