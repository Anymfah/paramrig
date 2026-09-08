/**
 * A mono 16-bit PCM file, written by hand.
 *
 * There is no encoder dependency here and there should not be: the format is a 44-byte header and
 * the samples, and every library that wraps it costs more to audit than the thing it wraps. It
 * also keeps the exporter runnable in Node, which is what lets a preview script write files you
 * can listen to before any of the interface exists.
 */

const HEADER_BYTES = 44

function writeAscii(view: DataView, at: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i))
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new ArrayBuffer(HEADER_BYTES + samples.length * 2)
  const view = new DataView(bytes)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.min(1, Math.max(-1, samples[i] ?? 0))
    // Asymmetric on purpose: the negative side of two's complement reaches one step further, and
    // scaling both sides by 32767 would leave the loudest negative peak a step short of full scale.
    // Rounded, not truncated — setInt16 would truncate towards zero, which is a whole step of
    // error on every sample and pulls the waveform towards silence on both sides of it.
    const scaled = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
    view.setInt16(HEADER_BYTES + i * 2, Math.min(0x7fff, Math.max(-0x8000, scaled)), true)
  }

  return new Uint8Array(bytes)
}
