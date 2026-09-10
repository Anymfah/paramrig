/**
 * Drive, bit depth and sample crush — the three ways a clean voice is made to sound like it came
 * out of hardware that could not quite afford to be clean.
 *
 * They are two insert kinds now rather than one fixed stage, so they are two functions rather than
 * one: a slot set to drive must not also crush because it was a crusher an hour ago, and the
 * fields it is not reading are still sitting there waiting for it to be one again.
 */

export type ShaperState = { held: number; countdown: number }

export function createShaper(): ShaperState {
  return { held: 0, countdown: 0 }
}

/** Normalised soft saturation: at drive 0 this is an exact bypass, not a gentle one. */
export function saturate(x: number, drive: number): number {
  const amount = Math.min(1, Math.max(0, drive))
  if (amount <= 0) return x
  const k = 1 + amount * 24
  return Math.tanh(x * k) / Math.tanh(k)
}

/** The other half: fewer bits, then fewer samples. */
export function crushSample(state: ShaperState, bitDepth: number, crush: number, input: number): number {
  let value = input
  const bits = Math.min(16, Math.max(1, Math.round(bitDepth)))
  if (bits < 16) {
    const levels = Math.pow(2, bits - 1)
    value = Math.round(value * levels) / levels
  }
  const held = Math.min(1, Math.max(0, crush))
  if (held > 0) {
    const hold = 1 + Math.round(held * 63)
    if (state.countdown <= 0) {
      state.held = value
      state.countdown = hold
    }
    state.countdown -= 1
    return state.held
  }
  return value
}
