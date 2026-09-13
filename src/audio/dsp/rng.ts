/**
 * A seeded stream, because a parametric tool whose output moves under you is broken. Every random
 * decision in a render — noise, detune — is drawn from here, so the same patch and the same seed
 * give back the identical Float32Array on any machine.
 */

/** Mulberry32: one multiply-xorshift round, a period long past anything a short sound needs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Each layer draws from its own stream, so editing layer one does not reshuffle the noise in
 * layer two. Without this, nudging a slider changes a sound you were not touching.
 */
export function streamFor(seed: number, index: number): () => number {
  return mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0)
}
