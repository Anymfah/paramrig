import type { ShaperSettings } from '../types.ts'

/**
 * Drive, bit depth and sample crush — the three ways a clean voice is made to sound like it came
 * out of hardware that could not quite afford to be clean.
 */

export type ShaperState = { held: number; countdown: number }

export function createShaper(): ShaperState {
  return { held: 0, countdown: 0 }
}

/** Normalised soft saturation: at drive 0 this is an exact bypass, not a gentle one. */
function saturate(x: number, drive: number): number {
  if (drive <= 0) return x
  const k = 1 + drive * 24
  return Math.tanh(x * k) / Math.tanh(k)
}

export function shapeSample(state: ShaperState, settings: ShaperSettings, input: number): number {
  let value = saturate(input, Math.min(1, Math.max(0, settings.drive)))
  const bits = Math.min(16, Math.max(1, Math.round(settings.bitDepth)))
  if (bits < 16) {
    const levels = Math.pow(2, bits - 1)
    value = Math.round(value * levels) / levels
  }
  const crush = Math.min(1, Math.max(0, settings.crush))
  if (crush > 0) {
    const hold = 1 + Math.round(crush * 63)
    if (state.countdown <= 0) {
      state.held = value
      state.countdown = hold
    }
    state.countdown -= 1
    return state.held
  }
  return value
}
