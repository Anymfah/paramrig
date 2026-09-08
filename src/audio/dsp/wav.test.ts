import { describe, expect, it } from 'vitest'
import { encodeWav } from '@/audio/dsp/wav'

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...Array.from(bytes.slice(at, at + length)))

const readInt16 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(at, true)

describe('encodeWav', () => {
  it('writes the chunk names a player looks for', () => {
    const bytes = encodeWav(new Float32Array(8), 44100)
    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(ascii(bytes, 8, 4)).toBe('WAVE')
    expect(ascii(bytes, 12, 4)).toBe('fmt ')
    expect(ascii(bytes, 36, 4)).toBe('data')
  })

  it('is a header plus two bytes a sample', () => {
    expect(encodeWav(new Float32Array(100), 44100)).toHaveLength(44 + 200)
  })

  it('declares mono 16-bit at the rate it was given', () => {
    const bytes = encodeWav(new Float32Array(4), 22050)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(28, true)).toBe(22050 * 2)
  })

  it('carries samples through to full scale on both sides', () => {
    const bytes = encodeWav(Float32Array.from([0, 1, -1, 0.5]), 44100)
    expect(readInt16(bytes, 44)).toBe(0)
    expect(readInt16(bytes, 46)).toBe(32767)
    expect(readInt16(bytes, 48)).toBe(-32768)
    expect(readInt16(bytes, 50)).toBe(Math.round(0.5 * 32767))
  })

  it('clamps rather than wrapping, because a wrapped sample is the loudest click in the file', () => {
    const bytes = encodeWav(Float32Array.from([9, -9]), 44100)
    expect(readInt16(bytes, 44)).toBe(32767)
    expect(readInt16(bytes, 46)).toBe(-32768)
  })
})
