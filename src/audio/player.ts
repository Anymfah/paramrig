import type { AudioPatch, VoiceGate, WavetableResolver } from '@paramrig/audio'
import { wavetableOf, type Wavetable } from '@paramrig/audio/wavetables'
import defaultWorkletUrl from './dsp/worklet.ts?worker&url'

export type AudioMeter = { peak: number; left?: number; right?: number; clock: number; note: number; ended?: boolean }
export type AudioPlayerOptions = {
  context: AudioContext
  destination: AudioNode
  workletUrl?: string | URL
  resolveWavetable?: WavetableResolver
  onError?: (error: Error) => void
}
export const audioWorkletUrl = defaultWorkletUrl
const loaded = new WeakMap<AudioContext, Map<string, Promise<void>>>()

function load(context: AudioContext, url: string): Promise<void> {
  let urls = loaded.get(context)
  if (!urls) { urls = new Map(); loaded.set(context, urls) }
  let pending = urls.get(url)
  if (!pending) {
    pending = context.audioWorklet.addModule(url).catch(error => { urls.delete(url); throw error })
    urls.set(url, pending)
  }
  return pending
}

/** One voice and its resources. The host retains ownership of its AudioContext. */
export function createAudioPlayer(options: AudioPlayerOptions) {
  const { context, destination } = options
  if (destination.context && destination.context !== context) throw new Error('The audio destination belongs to a different AudioContext.')
  let node: AudioWorkletNode | null = null
  let generation = 0
  let destroyed = false
  let error: Error | null = null
  let meter: AudioMeter = { peak: 0, clock: 0, note: 0 }
  const listeners = new Set<(meter: AudioMeter) => void>()
  const sent = new Map<string, Wavetable>()
  const retiring = new Map<AudioWorkletNode, ReturnType<typeof setTimeout>>()
  const emit = (value: AudioMeter) => { meter = value; for (const listener of listeners) listener({ ...meter }) }
  const release = (held: AudioWorkletNode) => {
    const timer = retiring.get(held)
    if (timer) clearTimeout(timer)
    retiring.delete(held)
    held.port.onmessage = null
    held.onprocessorerror = null
    try { held.disconnect() } finally { held.port.close() }
  }
  const tablesOf = (patch: AudioPatch) => {
    const tables: { id: string; frames: Float32Array; limits: number[] }[] = []
    for (const layer of patch.layers) {
      if (layer.source.kind !== 'table') continue
      const id = layer.source.table
      const table = options.resolveWavetable ? options.resolveWavetable(id) : wavetableOf(id)
      if (!table) throw new Error(`Wavetable is unavailable: ${id}`)
      if (sent.get(id) === table) continue
      sent.set(id, table)
      tables.push({ id, frames: table.frames, limits: [...table.limits] })
    }
    return tables
  }
  const stop = () => {
    generation++
    const held = node
    node = null
    sent.clear()
    if (!held) return
    held.port.onmessage = null
    held.onprocessorerror = null
    held.port.postMessage({ type: 'gate', gate: 'stop' })
    retiring.set(held, setTimeout(() => release(held), 30))
  }
  const fail = (cause: unknown) => {
    error = cause instanceof Error ? cause : new Error(String(cause))
    stop()
    options.onError?.(error)
  }
  return {
    async start(patch: AudioPatch, gate: VoiceGate = 'oneshot'): Promise<boolean> {
      if (destroyed) throw new Error('This audio player has been destroyed.')
      stop()
      const ticket = generation
      error = null
      try {
        if (!context.audioWorklet || context.state === 'closed') throw new Error('AudioWorklet requires an open AudioContext in a secure browser context.')
        await context.resume()
        await load(context, String(options.workletUrl ?? audioWorkletUrl))
        if (destroyed || ticket !== generation || String(context.state) === 'closed') return false
        const tables = tablesOf(patch)
        const next = new AudioWorkletNode(context, 'paramrig-voice', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
        node = next
        meter = { peak: 0, clock: 0, note: 0 }
        next.port.onmessage = (event: MessageEvent<AudioMeter & { type: string }>) => {
          if (node !== next) return
          if (event.data?.type === 'ended') { stop(); emit({ ...meter, peak: 0, ended: true }); return }
          if (event.data?.type === 'meter') {
            const { peak, left, right, clock, note } = event.data
            emit({ peak, left, right, clock, note })
          }
        }
        next.onprocessorerror = () => { if (node === next) { fail(new Error('The audio processor stopped unexpectedly.')); emit({ ...meter, peak: 0, ended: true }) } }
        next.connect(destination)
        next.port.postMessage({ type: 'boot', patch, gate, tables })
        return true
      } catch (cause) {
        if (ticket === generation && !destroyed) fail(cause)
        return false
      }
    },
    setPatch(patch: AudioPatch): void {
      if (!node) return
      const tables = tablesOf(patch)
      node.port.postMessage({ type: 'tables', tables })
      node.port.postMessage({ type: 'patch', patch })
    },
    setGate(gate: VoiceGate): void { node?.port.postMessage({ type: 'gate', gate }) },
    trigger(gate?: VoiceGate): void { node?.port.postMessage({ type: 'trig', ...(gate ? { gate } : {}) }) },
    stop,
    getMeter: (): AudioMeter => ({ ...meter }),
    getError: (): Error | null => error,
    isPlaying: (): boolean => node !== null,
    subscribe(listener: (meter: AudioMeter) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      stop()
      for (const held of retiring.keys()) release(held)
      listeners.clear()
    },
  }
}

export type AudioPlayer = ReturnType<typeof createAudioPlayer>
