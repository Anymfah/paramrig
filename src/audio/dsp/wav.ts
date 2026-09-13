/**
 * An interleaved stereo 16-bit PCM file, written by hand.
 *
 * There is no encoder dependency here and there should not be: the format is a 44-byte header and
 * the samples, and every library that wraps it costs more to audit than the thing it wraps. It
 * also keeps the exporter runnable in Node, which is what lets a preview script write files you
 * can listen to before any of the interface exists.
 */

import type { Stereo } from '../types.ts'

const HEADER_BYTES = 44
const CHANNELS = 2

function writeAscii(view: DataView, at: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i))
}

export function encodeWav(stereo: Stereo, sampleRate: number): Uint8Array {
  const frames = stereo.left.length
  const dataBytes = frames * CHANNELS * 2
  const bytes = new ArrayBuffer(HEADER_BYTES + dataBytes)
  const view = new DataView(bytes)
  const blockAlign = CHANNELS * 2

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < frames * CHANNELS; i += 1) {
    const channel = i % CHANNELS === 0 ? stereo.left : stereo.right
    const sample = Math.min(1, Math.max(-1, channel[Math.floor(i / CHANNELS)] ?? 0))
    // Asymmetric on purpose: the negative side of two's complement reaches one step further, and
    // scaling both sides by 32767 would leave the loudest negative peak a step short of full scale.
    // Rounded, not truncated — setInt16 would truncate towards zero, which is a whole step of
    // error on every sample and pulls the waveform towards silence on both sides of it.
    const scaled = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
    view.setInt16(HEADER_BYTES + i * 2, Math.min(0x7fff, Math.max(-0x8000, scaled)), true)
  }

  return new Uint8Array(bytes)
}

export type DecodedWav = { samples: Float32Array; sampleRate: number; channels: number }

/**
 * A mono stream from a WAV file. Stereo is reduced to the first channel rather than mixed: a
 * wavetable's cycle is a shape, and mixing two shapes is a third one nobody wrote.
 *
 * Only PCM 16 and IEEE float 32 are accepted. Anything else is refused with a reason, not guessed.
 */
export function decodeWav(bytes: ArrayBuffer): DecodedWav | { error: string } {
  if (bytes.byteLength < 44) return { error: 'That file is too small to be a WAV.' }
  const view = new DataView(bytes)
  const ascii = (at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(at + i)))
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return { error: 'That file is not a WAV.' }
  let at = 12
  let format = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let dataAt = -1
  let dataBytes = 0
  while (at + 8 <= view.byteLength) {
    const id = ascii(at, 4)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (body + size > view.byteLength) return { error: 'That WAV is truncated.' }
    if (id === 'fmt ') {
      if (size < 16) return { error: 'That WAV has an invalid format chunk.' }
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
    } else if (id === 'data') {
      dataAt = body
      dataBytes = size
    }
    at = body + size + (size % 2)
  }
  if (dataAt < 0 || channels < 1 || sampleRate < 1) return { error: 'That WAV has no audio data.' }
  if (format !== 1 && format !== 3) return { error: 'Only PCM 16-bit or 32-bit float WAV files can be imported.' }
  if (format === 1 && bits !== 16) return { error: 'Only 16-bit PCM WAV files can be imported.' }
  if (format === 3 && bits !== 32) return { error: 'Only 32-bit float WAV files can be imported.' }
  const width = bits / 8
  if (channels > 32 || dataBytes % (width * channels) !== 0) return { error: 'That WAV has invalid audio frames.' }
  const frames = Math.floor(dataBytes / (width * channels))
  if (frames < 32) return { error: 'That file is too short to be a wavetable.' }
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) {
    const offset = dataAt + i * width * channels
    let mono = 0
    for (let channel = 0; channel < channels; channel += 1) {
      const value = format === 3 ? view.getFloat32(offset + channel * width, true) : view.getInt16(offset + channel * width, true) / 0x8000
      if (!Number.isFinite(value)) return { error: 'That WAV contains non-finite samples.' }
      mono += value / channels
    }
    samples[i] = mono
  }
  return { samples, sampleRate, channels }
}
