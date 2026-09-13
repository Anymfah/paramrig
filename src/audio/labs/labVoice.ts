import { audioContext, stopPlayback } from '../playback'
import type { Stereo } from '@paramrig/audio'

/**
 * The one voice Labs plays through.
 *
 * A rendered buffer, then a mid/side matrix and a gain, so that pulling the Shape view's width
 * or height is heard while the hand is still on it — the same mid/side balance and the same
 * gain the next render will bake in, applied to the sound already playing instead of restarting
 * it. Every change is a short ramp, never a step, so nothing clicks.
 *
 * While a gesture is held the voice can loop, with a breath of silence between passes, so a
 * short sound keeps answering for as long as it is being shaped.
 */
export type LabVoice = {
  startedAt: number
  /** The sound's own length, and one loop pass with its gap. */
  duration: number
  period: number
  setGain: (gain: number) => void
  setSide: (side: number) => void
  setLoop: (loop: boolean) => void
  stop: () => void
}

const RAMP = 0.012
export const VOICE_GAP = 0.18
let current: LabVoice | null = null

/*
 * The guard at the end of the chain: exactly the identity below -1 dBFS, and a soft shoulder
 * above it, so a width or a height pulled past the render's own limiter can never clip the
 * speakers. A shaper rather than a compressor: a compressor adds make-up gain to everything it
 * passes, and the level heard here has to be the level exported.
 */
const GUARD_KNEE = 0.89
let guardCurve: Float32Array<ArrayBuffer> | null = null
function guardShape(): Float32Array<ArrayBuffer> {
  if (guardCurve) return guardCurve
  const n = 8193
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    // The shaper reads -1 to 1; the chain halves the signal before it, so this spans ±2.
    const x = (i / (n - 1) * 2 - 1) * 2
    const a = Math.abs(x)
    curve[i] = a <= GUARD_KNEE ? x : Math.sign(x) * (GUARD_KNEE + (1 - GUARD_KNEE) * Math.tanh((a - GUARD_KNEE) / (1 - GUARD_KNEE)))
  }
  guardCurve = curve
  return curve
}

export type VoiceGraph = {
  source: AudioBufferSourceNode
  side: GainNode
  out: GainNode
  release: () => void
}
/** The graph itself, on any context: the page plays it live, a test renders it offline. */
export function wireVoice(context: BaseAudioContext, buffer: AudioBuffer, destination: AudioNode, options: { loop?: boolean; gain?: number; side?: number } = {}): VoiceGraph {
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = options.loop === true
  const gainOf = (value: number) => { const node = context.createGain(); node.gain.value = value; return node }
  const split = context.createChannelSplitter(2)
  const merge = context.createChannelMerger(2)
  const leftMid = gainOf(0.5), rightMid = gainOf(0.5), leftSide = gainOf(0.5), rightSide = gainOf(-0.5)
  const side = gainOf(options.side ?? 1)
  const invert = gainOf(-1)
  const out = gainOf(options.gain ?? 1)
  const into = gainOf(0.5)
  const guard = context.createWaveShaper()
  guard.curve = guardShape()
  guard.oversample = 'none'

  source.connect(split)
  split.connect(leftMid, 0); split.connect(rightMid, 1)
  split.connect(leftSide, 0); split.connect(rightSide, 1)
  for (const mid of [leftMid, rightMid]) { mid.connect(merge, 0, 0); mid.connect(merge, 0, 1) }
  leftSide.connect(side); rightSide.connect(side)
  side.connect(merge, 0, 0)
  side.connect(invert); invert.connect(merge, 0, 1)
  merge.connect(out)
  out.connect(into)
  into.connect(guard)
  guard.connect(destination)
  const nodes: AudioNode[] = [source, split, merge, leftMid, rightMid, leftSide, rightSide, side, invert, out, into, guard]
  return { source, side, out, release: () => { for (const node of nodes) node.disconnect() } }
}

export function stopLabVoice(): void {
  const voice = current
  current = null
  voice?.stop()
}

export function playLabVoice(samples: Stereo, rate: number, options: { loop?: boolean; gain?: number; side?: number; onEnded?: () => void } = {}): LabVoice | null {
  const context = audioContext()
  if (!context || samples.left.length === 0) return null
  stopPlayback()
  stopLabVoice()
  void context.resume().catch(() => { /* A context that will not resume stays silent. */ })
  const gap = Math.round(rate * VOICE_GAP)
  const buffer = context.createBuffer(2, samples.left.length + gap, rate)
  buffer.getChannelData(0).set(samples.left)
  buffer.getChannelData(1).set(samples.right)
  const graph = wireVoice(context, buffer, context.destination, options)
  const { source, side, out } = graph
  let stopped = false
  const voice: LabVoice = {
    startedAt: context.currentTime,
    duration: samples.left.length / rate,
    period: (samples.left.length + gap) / rate,
    setGain: (value) => out.gain.setTargetAtTime(Math.max(0, value), context.currentTime, RAMP),
    setSide: (value) => side.gain.setTargetAtTime(Math.max(0, value), context.currentTime, RAMP),
    setLoop: (loop) => { source.loop = loop },
    stop: () => {
      if (stopped) return
      stopped = true
      source.onended = null
      // A few milliseconds down, then off: a buffer cut mid-cycle is a click.
      out.gain.setTargetAtTime(0, context.currentTime, 0.004)
      try { source.stop(context.currentTime + 0.03) } catch { /* Already finished. */ }
      setTimeout(graph.release, 80)
      if (current === voice) current = null
    },
  }
  source.onended = () => {
    if (stopped) return
    stopped = true
    graph.release()
    if (current === voice) current = null
    options.onEnded?.()
  }
  source.start()
  current = voice
  return voice
}
