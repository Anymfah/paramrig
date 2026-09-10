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

/**
 * Peak and RMS of a stereo pair. The peak is the loudest sample in either channel, because that
 * is what clips; the RMS is of the sum, because that is what the room hears. Measuring both on
 * the sum would understate a peak by three decibels the moment anything is panned.
 */
export function stereoLevels(stereo: { left: Float32Array; right: Float32Array }): { peak: number; rms: number } {
  let peak = 0
  let sum = 0
  for (let i = 0; i < stereo.left.length; i += 1) {
    const left = stereo.left[i] ?? 0
    const right = stereo.right[i] ?? 0
    peak = Math.max(peak, Math.abs(left), Math.abs(right))
    const middle = (left + right) * 0.5
    sum += middle * middle
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, stereo.left.length)) }
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

/**
 * The level a meter shows at one point in the buffer, a channel each.
 *
 * The fall is what makes a meter readable — a needle that followed the waveform of a two-hundred
 * millisecond sound would be a blur — but it does not have to be *remembered*. Reading backwards
 * from the playhead with a weight that fades gives the same held-and-let-down shape as a decay
 * applied frame by frame, and gives it as a function of the buffer alone: the same instant reads
 * the same whether the meter arrives at it playing, scrubbing, or rendered twice over by React.
 */
export function meterAt(
  stereo: { left: Float32Array; right: Float32Array },
  at: number,
  sampleRate: number,
): { left: number; right: number } {
  const rate = Math.max(1, sampleRate)
  const head = Math.min(Math.max(0, Math.round(at)), stereo.left.length - 1)
  if (head < 0) return { left: 0, right: 0 }
  // Eighty-five milliseconds to fall by a factor of e, and nothing before three of those is
  // audible in the needle: the weight there is under five per cent of full scale.
  const fall = 0.085
  const back = Math.min(head + 1, Math.round(rate * fall * 3))
  const step = Math.exp(-1 / (rate * fall))
  let weight = 1
  let left = 0
  let right = 0
  for (let i = 0; i < back; i += 1) {
    const index = head - i
    const l = Math.abs(stereo.left[index] ?? 0) * weight
    const r = Math.abs(stereo.right[index] ?? 0) * weight
    if (l > left) left = l
    if (r > right) right = r
    weight *= step
  }
  return { left, right }
}
