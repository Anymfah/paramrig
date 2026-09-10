import { createVoice, processVoice, setVoiceGate, triggerVoice, updateVoice, type Voice, type VoiceGate } from './engine.ts'
import { registerWavetable } from './wavetable.ts'
import type { AudioPatch } from '../types.ts'

/**
 * The AudioWorklet processor. It holds one voice and writes the next block; the main thread sends
 * the patch, the gate, and any user tables. Built-in tables live in this bundle; imported ones
 * arrive as frames so this thread never loads a file.
 */

type TableMsg = { id: string; frames: Float32Array; limits: number[] }
type Boot = { type: 'boot'; patch: AudioPatch; gate: VoiceGate; tables?: TableMsg[] }
type PatchMsg = { type: 'patch'; patch: AudioPatch }
type GateMsg = { type: 'gate'; gate: VoiceGate }
type TrigMsg = { type: 'trig'; gate?: VoiceGate }
type TablesMsg = { type: 'tables'; tables: TableMsg[] }
type Msg = Boot | PatchMsg | GateMsg | TrigMsg | TablesMsg

function takeTables(tables: TableMsg[] | undefined): void {
  if (!tables) return
  for (const table of tables) {
    registerWavetable(table.id, { frames: table.frames, limits: table.limits })
  }
}

class ParamRigVoice extends AudioWorkletProcessor {
  voice: Voice | null = null
  meter = 0
  quiet = 0
  scratch = new Float32Array(128)

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<Msg>) => {
      const data = event.data
      if (data.type === 'tables') {
        takeTables(data.tables)
        return
      }
      if (data.type === 'boot') {
        takeTables(data.tables)
        this.voice = createVoice(data.patch, sampleRate, { live: true, gate: data.gate })
        return
      }
      if (!this.voice) return
      if (data.type === 'patch') updateVoice(this.voice, data.patch)
      if (data.type === 'gate') setVoiceGate(this.voice, data.gate)
      if (data.type === 'trig') { this.quiet = 0; triggerVoice(this.voice, data.gate) }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    const left = output?.[0]
    const right = output?.[1] ?? left
    if (!left || !right) return true
    if (!this.voice) {
      left.fill(0)
      if (right !== left) right.fill(0)
      return true
    }
    const ended = (this.voice.gate === 'oneshot' && this.voice.note >= this.voice.length)
      || (this.voice.gate === 'stop' && this.voice.stopGain <= 0)
      || (this.voice.gate === 'release' && this.voice.releasedAt !== null
        && this.quiet > sampleRate * 0.1)
      || (this.voice.gate === 'release' && this.voice.releasedAt !== null
        && this.voice.note / sampleRate >= this.voice.releasedAt + Math.max(...this.voice.patch.layers.map((layer) => layer.amp.release)) + 10)
    if (ended) {
      left.fill(0)
      if (right !== left) right.fill(0)
      this.port.postMessage({ type: 'ended' })
      return false
    }
    if (left === right) {
      if (this.scratch.length < left.length) this.scratch = new Float32Array(left.length)
      const extra = this.scratch.subarray(0, left.length)
      processVoice(this.voice, left, extra)
      for (let i = 0; i < left.length; i += 1) left[i] = ((left[i] ?? 0) + (extra[i] ?? 0)) * 0.5
    } else {
      processVoice(this.voice, left, right)
    }
    let blockPeak = 0
    for (let i = 0; i < left.length; i += 1) blockPeak = Math.max(blockPeak, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0))
    this.quiet = blockPeak < 1e-6 ? this.quiet + left.length : 0
    this.meter += 1
    if (this.meter % 8 === 0) {
      let peakL = 0, peakR = 0
      for (let i = 0; i < left.length; i += 1) { peakL = Math.max(peakL, Math.abs(left[i] ?? 0)); peakR = Math.max(peakR, Math.abs(right[i] ?? 0)) }
      this.port.postMessage({ type: 'meter', peak: Math.max(peakL, peakR), left: peakL, right: peakR, clock: this.voice.clock, note: this.voice.note })
    }
    return true
  }
}

registerProcessor('paramrig-voice', ParamRigVoice)
