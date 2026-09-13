/**
 * A delay line and the two things everything builds out of one.
 *
 * A comb filter, a chorus, a flanger, a ping-pong delay and the diffusers of a reverb are all the
 * same object read at different distances: a ring of samples, a fractional read so a moving length
 * glides instead of stepping, and an allpass that passes everything and scrambles the phase. They
 * lived inside the master effects until the filter models and the insert slots needed them too.
 */

export type Line = { buffer: Float32Array; index: number }

export function line(length: number): Line {
  return { buffer: new Float32Array(Math.max(2, Math.round(length))), index: 0 }
}

/** Reads `delay` samples back, interpolating, so a modulated length glides instead of stepping. */
export function readAt(l: Line, delay: number): number {
  const size = l.buffer.length
  const want = Math.min(size - 1, Math.max(0, delay))
  const back = l.index - want
  const at = back < 0 ? back + size : back
  const i0 = Math.floor(at)
  const frac = at - i0
  const a = l.buffer[i0 % size] ?? 0
  const b = l.buffer[(i0 + 1) % size] ?? 0
  return a + (b - a) * frac
}

export function write(l: Line, value: number): void {
  l.buffer[l.index] = value
  l.index = (l.index + 1) % l.buffer.length
}

/** One allpass: passes everything, delays it, and leaves the phase scrambled. */
export function allpass(l: Line, input: number, gain: number): number {
  const delayed = readAt(l, l.buffer.length - 1)
  const value = -input * gain + delayed
  write(l, input + delayed * gain)
  return value
}
