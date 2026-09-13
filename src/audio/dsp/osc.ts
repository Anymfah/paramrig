import type { NoiseColour, WaveShape } from '../types.ts'

/**
 * Oscillators, band-limited where it counts.
 *
 * A naive saw or square is a stack of discontinuities, and every one of them folds the harmonics
 * above Nyquist back down into the audible band as inharmonic grit. On a sound that sweeps — a
 * laser, a whoosh, anything with slide — that grit sweeps the other way and the ear hears it
 * immediately. PolyBLEP rounds each discontinuity over one sample either side, which costs two
 * multiplies and removes almost all of it.
 *
 * Triangle is left naive on purpose: its harmonics fall off as 1/n² instead of 1/n, so its worst
 * alias sits around −28 dB, under everything else in a layered effect. Sine has none.
 */

/** The correction to subtract at a step discontinuity, over the sample either side of it. */
export function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

/**
 * A cycle skewed: the first `width` of it stretched to fill the first half, the rest squeezed into
 * the second.
 *
 * On a square this is exactly the duty cycle, which is why the control is called Width. On any
 * other shape it is the same gesture — the wave leaning one way — and it is what gives a wavetable
 * the movement a pulse gets for free. At a half it is an exact bypass, so a table nobody has
 * skewed reads as it was written.
 */
export function warp(phase: number, width: number): number {
  const w = Math.min(0.95, Math.max(0.05, width))
  if (w === 0.5) return phase
  return phase < w ? (phase * 0.5) / w : 0.5 + ((phase - w) * 0.5) / (1 - w)
}

/** One sample of a shape at `phase`, given the per-sample phase increment `dt`. */
export function waveAt(shape: WaveShape, phase: number, dt: number, pulseWidth: number): number {
  if (shape === 'sine') return Math.sin(phase * Math.PI * 2)
  if (shape === 'triangle') return 4 * Math.abs(phase - Math.floor(phase + 0.5)) - 1
  if (shape === 'saw') return 2 * phase - 1 - polyBlep(phase, dt)
  const width = Math.min(0.95, Math.max(0.05, pulseWidth))
  const raw = phase < width ? 1 : -1
  const falling = phase - width < 0 ? phase - width + 1 : phase - width
  return raw + polyBlep(phase, dt) - polyBlep(falling, dt)
}

export type NoiseSource = { next: (dt: number) => number }

/** Ratios of a struck metal bar — the same set an 808 uses for its cymbal. Inharmonic on purpose. */
const METALLIC_RATIOS = [1, 1.4471, 1.617, 1.9265, 2.5028, 2.6637]

/**
 * Noise carries its own state, so it is built once a layer rather than sampled from a table:
 * pink needs its filter history and metallic needs its bank of phases.
 */
export function createNoise(colour: NoiseColour, random: () => number): NoiseSource {
  if (colour === 'white') {
    return { next: () => random() * 2 - 1 }
  }
  if (colour === 'pink') {
    let b0 = 0
    let b1 = 0
    let b2 = 0
    return {
      next: () => {
        const white = random() * 2 - 1
        b0 = 0.99765 * b0 + white * 0.099046
        b1 = 0.963 * b1 + white * 0.2965164
        b2 = 0.57 * b2 + white * 0.1050186
        return (b0 + b1 + b2 + white * 0.1848) * 0.5
      },
    }
  }
  const phases = METALLIC_RATIOS.map(() => random())
  return {
    next: (dt: number) => {
      let sum = 0
      for (let i = 0; i < METALLIC_RATIOS.length; i += 1) {
        const ratio = METALLIC_RATIOS[i] ?? 1
        const step = dt * ratio
        const phase = ((phases[i] ?? 0) + step) % 1
        phases[i] = phase
        sum += waveAt('square', phase, step, 0.5)
      }
      return sum / METALLIC_RATIOS.length
    },
  }
}
