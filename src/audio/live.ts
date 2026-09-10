import { audioContext, stopPlayback } from '@/audio/playback'
import type { AudioPatch } from '@/audio/types'
import type { VoiceGate } from '@/audio/dsp/engine'
import { wavetableOf } from '@/audio/dsp/wavetable'
import workletUrl from '@/audio/dsp/worklet.ts?worker&url'

/**
 * Real-time playback: an AudioWorklet running the same voice the exporter uses.
 *
 * A finished buffer is still how a file is written. This is how a knob is heard while it turns.
 */

export type LiveMeter = { peak: number; left?: number; right?: number; clock: number; note: number; ended?: boolean }

let node: AudioWorkletNode | null = null
const modules = new WeakMap<AudioContext, Promise<boolean>>()
let generation = 0
const sentTables = new Set<string>()
let meter: LiveMeter = { peak: 0, clock: 0, note: 0 }
let onMeter: ((meter: LiveMeter) => void) | null = null

async function ensureWorklet(context: AudioContext): Promise<boolean> {
  let loading = modules.get(context)
  if (!loading) {
    loading = context.audioWorklet.addModule(workletUrl).then(() => true, () => {
      modules.delete(context)
      return false
    })
    modules.set(context, loading)
  }
  return loading
}

function tablesOf(patch: AudioPatch): { id: string; frames: Float32Array; limits: number[] }[] {
  const seen = new Set<string>()
  const out: { id: string; frames: Float32Array; limits: number[] }[] = []
  for (const layer of patch.layers) {
    if (layer.source.kind !== 'table' || sentTables.has(layer.source.table)) continue
    if (seen.has(layer.source.table)) continue
    seen.add(layer.source.table)
    const table = wavetableOf(layer.source.table)
    if (!table) continue
    sentTables.add(layer.source.table)
    out.push({ id: layer.source.table, frames: table.frames, limits: [...table.limits] })
  }
  return out
}

export function liveMeter(): LiveMeter {
  return meter
}

export function watchLiveMeter(listener: ((next: LiveMeter) => void) | null): void {
  onMeter = listener
}

export async function startLive(patch: AudioPatch, gate: VoiceGate = 'oneshot'): Promise<boolean> {
  stopLive()
  const ticket = generation
  const context = audioContext()
  if (!context?.audioWorklet) return false
  await context.resume().catch(() => undefined)
  if (!(await ensureWorklet(context))) return false
  if (ticket !== generation || context.state === 'closed') return false
  stopPlayback()
  let next: AudioWorkletNode
  try {
    next = new AudioWorkletNode(context, 'paramrig-voice', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
  } catch { return false }
  meter = { peak: 0, clock: 0, note: 0 }
  next.port.onmessage = (event: MessageEvent<LiveMeter & { type: string }>) => {
    if (node !== next) return
    if (event.data?.type === 'ended') {
      stopLive()
      onMeter?.({ ...meter, peak: 0, ended: true })
      return
    }
    if (event.data?.type !== 'meter') return
    meter = { peak: event.data.peak, left: event.data.left, right: event.data.right, clock: event.data.clock, note: event.data.note }
    onMeter?.(meter)
  }
  next.onprocessorerror = () => {
    if (node !== next) return
    stopLive()
    onMeter?.({ ...meter, peak: 0, ended: true })
  }
  sentTables.clear()
  next.connect(context.destination)
  next.port.postMessage({ type: 'boot', patch, gate, tables: tablesOf(patch) })
  node = next
  return true
}

export function updateLive(patch: AudioPatch): void {
  node?.port.postMessage({ type: 'tables', tables: tablesOf(patch) })
  node?.port.postMessage({ type: 'patch', patch })
}

export function gateLive(gate: VoiceGate): void {
  node?.port.postMessage({ type: 'gate', gate })
}

export function triggerLive(gate?: VoiceGate): void {
  node?.port.postMessage({ type: 'trig', ...(gate ? { gate } : {}) })
}

export function stopLive(): void {
  generation += 1
  if (!node) return
  node.port.postMessage({ type: 'gate', gate: 'stop' })
  const held = node
  node = null
  held.port.onmessage = null
  window.setTimeout(() => {
    try { held.disconnect() } catch { /* already gone */ }
    held.port.close()
  }, 30)
}

export function isLive(): boolean {
  return node !== null
}
