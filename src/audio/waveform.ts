/**
 * Turning a buffer into something a canvas can draw.
 *
 * A tenth of a second at 44.1 kHz is four thousand samples and a waveform view is a few hundred
 * pixels wide, so drawing sample by sample would both cost more and show less: the peak that gives
 * a click its character falls between two pixels and disappears. One column keeps the extremes of
 * everything that landed in it, which is what makes a transient visible at any width.
 */

export type WaveformBand = { min: number; max: number }

export function waveformBands(samples: Float32Array, columns: number): WaveformBand[] {
  const width = Math.max(1, Math.floor(columns))
  if (samples.length === 0) return Array.from({ length: width }, () => ({ min: 0, max: 0 }))
  const perColumn = samples.length / width
  return Array.from({ length: width }, (_, column) => {
    const start = Math.floor(column * perColumn)
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((column + 1) * perColumn)))
    let min = Infinity
    let max = -Infinity
    for (let i = start; i < end; i += 1) {
      const value = samples[i] ?? 0
      if (value < min) min = value
      if (value > max) max = value
    }
    return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 }
  })
}

/** Peak and RMS, the two numbers worth putting under a waveform. */
export function levels(samples: Float32Array): { peak: number; rms: number } {
  let peak = 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] ?? 0
    const size = Math.abs(value)
    if (size > peak) peak = size
    sum += value * value
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, samples.length)) }
}

/** Decibels, or the word for silence. A dash reads better than "-Infinity dB" under a waveform. */
export function decibels(value: number): string {
  return value <= 0 ? '—' : `${(20 * Math.log10(value)).toFixed(1)} dB`
}
