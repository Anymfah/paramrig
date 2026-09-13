import type { AudioPatch, Stereo } from '../types.ts'
import { renderVoice } from './engine.ts'

/**
 * The whole synthesiser, as one pure function.
 *
 * A patch and a sample rate in, two channels out. The voice underneath processes in blocks so the
 * same code can run in an AudioWorklet; asked for a whole file it still returns the same samples
 * whether the block is sixty-four long or the whole duration.
 */

export { createVoice, pmOrder, processVoice, renderVoice, setVoiceGate, triggerVoice, updateVoice } from './engine.ts'
export type { Voice, VoiceGate, VoiceOptions, WavetableResolver } from './engine.ts'

export function renderPatch(patch: AudioPatch, sampleRate: number, blockSize = 0): Stereo {
  return renderVoice(patch, sampleRate, blockSize)
}

/** One channel, for anything that measures or draws rather than plays. */
export function monoSum(stereo: Stereo): Float32Array {
  const out = new Float32Array(stereo.left.length)
  for (let i = 0; i < out.length; i += 1) out[i] = ((stereo.left[i] ?? 0) + (stereo.right[i] ?? 0)) * 0.5
  return out
}
