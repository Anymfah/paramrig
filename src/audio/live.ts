import { audioContext, stopPlayback } from '@/audio/playback'
import { createAudioPlayer, type AudioPlayer, type AudioMeter } from '@paramrig/audio-browser'
import type { AudioPatch, VoiceGate } from '@paramrig/audio'
import { wavetableOf } from '@paramrig/audio/wavetables'

export type LiveMeter = AudioMeter
let player: AudioPlayer | null = null
let meter: LiveMeter = { peak: 0, clock: 0, note: 0 }
let listener: ((meter: LiveMeter) => void) | null = null
const retiring = new Map<AudioPlayer, ReturnType<typeof setTimeout>>()

export const liveMeter = (): LiveMeter => meter
export function watchLiveMeter(next: ((meter: LiveMeter) => void) | null): void { listener = next }
export async function startLive(patch: AudioPatch, gate: VoiceGate = 'oneshot'): Promise<boolean> {
  stopLive()
  const context = audioContext()
  if (!context?.audioWorklet) return false
  const next = createAudioPlayer({ context, destination: context.destination, resolveWavetable: wavetableOf })
  player = next
  next.subscribe(value => { if (player === next) { meter = value; listener?.(value) } })
  const started = await next.start(patch, gate)
  if (started && player === next) { meter = next.getMeter(); stopPlayback() }
  return started
}
export function updateLive(patch: AudioPatch): void { player?.setPatch(patch) }
export function gateLive(gate: VoiceGate): void { player?.setGate(gate) }
export function triggerLive(gate?: VoiceGate): void { player?.trigger(gate) }
export function stopLive(): void {
  const held = player
  player = null
  if (!held) return
  held.stop()
  // Keep the worklet connected for its stop envelope; a new player may start independently.
  retiring.set(held, setTimeout(() => { held.destroy(); retiring.delete(held) }, 40))
}
export function disposeLive(): void {
  player?.destroy(); player = null
  for (const [held, timer] of retiring) { clearTimeout(timer); held.destroy() }
  retiring.clear(); listener = null
}
export function isLive(): boolean { return player?.isPlaying() ?? false }
