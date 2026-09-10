import { describe, expect, it } from 'vitest'
import { decodeWav, encodeWav } from '@/audio/dsp/wav'

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...Array.from(bytes.slice(at, at + length)))

const readInt16 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(at, true)

/** The file is two channels now; most of these only care about one, so both get the same. */
const both = (values: number[] | Float32Array) => ({
  left: Float32Array.from(values),
  right: Float32Array.from(values),
})

describe('encodeWav', () => {
  it('writes the chunk names a player looks for', () => {
    const bytes = encodeWav(both(new Float32Array(8)), 44100)
    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(ascii(bytes, 8, 4)).toBe('WAVE')
    expect(ascii(bytes, 12, 4)).toBe('fmt ')
    expect(ascii(bytes, 36, 4)).toBe('data')
  })

  it('is a header plus two bytes a sample', () => {
    expect(encodeWav(both(new Float32Array(100)), 44100)).toHaveLength(44 + 100 * 2 * 2)
  })

  it('declares stereo 16-bit at the rate it was given', () => {
    const bytes = encodeWav(both(new Float32Array(4)), 22050)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(28, true)).toBe(22050 * 4)
    expect(view.getUint16(32, true)).toBe(4)
  })

  it('carries samples through to full scale on both sides', () => {
    const bytes = encodeWav(both([0, 1, -1, 0.5]), 44100)
    // Interleaved, so each frame is left then right and the two are the same here.
    expect(readInt16(bytes, 44)).toBe(0)
    expect(readInt16(bytes, 48)).toBe(32767)
    expect(readInt16(bytes, 52)).toBe(-32768)
    expect(readInt16(bytes, 56)).toBe(Math.round(0.5 * 32767))
  })

  it('interleaves the two channels rather than writing one after the other', () => {
    const bytes = encodeWav({ left: Float32Array.from([1, 0]), right: Float32Array.from([-1, 0]) }, 44100)
    expect(readInt16(bytes, 44)).toBe(32767)
    expect(readInt16(bytes, 46)).toBe(-32768)
  })

  it('clamps rather than wrapping, because a wrapped sample is the loudest click in the file', () => {
    const bytes = encodeWav(both([9, -9]), 44100)
    expect(readInt16(bytes, 44)).toBe(32767)
    expect(readInt16(bytes, 48)).toBe(-32768)
  })
})

it('refuses truncated chunks without throwing', () => {
  const bytes = new ArrayBuffer(44)
  const raw = new Uint8Array(bytes)
  for (const [at, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt ']] as const) [...text].forEach((char, index) => { raw[at + index] = char.charCodeAt(0) })
  new DataView(bytes).setUint32(16, 1000, true)
  expect(decodeWav(bytes)).toHaveProperty('error')
})
