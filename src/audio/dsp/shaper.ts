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

/**
 * The other half: fewer bits, then fewer samples.
 *
 * The hold is a *time*, taken from the rate, not a count of samples. It used to be a count, and a
 * count is not a sound: the editor renders at whatever rate the machine's audio device runs at, so
 * the same patch held for 63 samples at 44 100 and for 63 samples at 48 000 — a rate a semitone
 * and a half apart, on the same knob, for the reason that the machine was a Mac. The reference is
 * 44 100, so a patch made before this reads exactly as it did.
 */
const CRUSH_REFERENCE_RATE = 44100

export function crushSample(state: ShaperState, bitDepth: number, crush: number, input: number, sampleRate = CRUSH_REFERENCE_RATE): number {
  let value = input
  const bits = Math.min(16, Math.max(1, Math.round(bitDepth)))
  if (bits < 16) {
    const levels = Math.pow(2, bits - 1)
    value = Math.round(value * levels) / levels
  }
  const held = Math.min(1, Math.max(0, crush))
  if (held > 0) {
    const hold = Math.max(1, Math.round((1 + held * 63) * (sampleRate / CRUSH_REFERENCE_RATE)))
    if (state.countdown <= 0) {
      state.held = value
      state.countdown = hold
    }
    state.countdown -= 1
    return state.held
  }
  return value
}
