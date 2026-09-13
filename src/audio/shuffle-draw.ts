import type { AudioPatch, Stereo } from './types.ts'
import { renderPatch } from './dsp/render.ts'

export const pick = <T,>(random: () => number, choices: readonly T[]): T =>
  choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))] as T

export const between = (random: () => number, low: number, high: number) => low + random() * (high - low)

/** Frequencies and times are heard logarithmically, so they are drawn that way. */
export const logBetween = (random: () => number, low: number, high: number) =>
  Math.exp(between(random, Math.log(Math.max(1e-9, low)), Math.log(Math.max(1e-9, high))))

export const chance = (random: () => number, odds: number) => random() < odds

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function peakOf(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i += 1) {
    const size = Math.abs(samples[i] ?? 0)
    if (!Number.isFinite(size)) return Number.POSITIVE_INFINITY
    if (size > peak) peak = size
  }
  return peak
}

export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] ?? 0
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}

export type Probe = {
  left: number
  right: number
  peak: number
  mono: number
  rms: number
  finite: boolean
}

function hasNonFinite(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i += 1) {
    if (!Number.isFinite(samples[i] ?? 0)) return true
  }
  return false
}

export function probeStereo(stereo: Stereo): Probe {
  const finite = !hasNonFinite(stereo.left) && !hasNonFinite(stereo.right)
  const left = finite ? peakOf(stereo.left) : Number.POSITIVE_INFINITY
  const right = finite ? peakOf(stereo.right) : Number.POSITIVE_INFINITY
  const mono = new Float32Array(stereo.left.length)
  for (let i = 0; i < mono.length; i += 1) mono[i] = ((stereo.left[i] ?? 0) + (stereo.right[i] ?? 0)) * 0.5
  return {
    left,
    right,
    peak: Math.max(left, right),
    mono: finite ? peakOf(mono) : Number.POSITIVE_INFINITY,
    rms: finite ? Math.max(rmsOf(stereo.left), rmsOf(stereo.right)) : Number.POSITIVE_INFINITY,
    finite,
  }
}

/**
 * Rendered with the master out of the way, so a make-up reads the true peak rather than the
 * limiter's ceiling. Both channels are measured: a hard-panned spike is silent in a mono sum.
 */
export const PROBE_GAIN = 1 / 64

export function probePatch(patch: AudioPatch, sampleRate: number): Probe {
  const raw = renderPatch({ ...patch, master: { ...patch.master, gain: PROBE_GAIN, limiter: 0 } }, sampleRate)
  const measured = probeStereo(raw)
  if (!measured.finite) return measured
  return {
    ...measured,
    left: measured.left / PROBE_GAIN,
    right: measured.right / PROBE_GAIN,
    peak: measured.peak / PROBE_GAIN,
    mono: measured.mono / PROBE_GAIN,
    rms: measured.rms / PROBE_GAIN,
  }
}

/**
 * A short click is judged on its peak; a long pad on a blend of peak and RMS. Peak equality is
 * not loudness equality, and an RMS window that swallows a 40 ms transient is the wrong meter.
 */
export function perceivedLevel(probe: Probe, duration: number): number {
  const peak = probe.peak
  if (duration < 0.18) return peak
  const rms = probe.rms
  const weight = duration > 1.2 ? 0.45 : 0.25
  return peak * (1 - weight) + Math.min(peak, rms * 6) * weight
}

export type CandidateIssue = 'silent' | 'nan' | 'clip' | 'mono' | 'loud'

export function candidateIssue(probe: Probe, duration: number): CandidateIssue | null {
  if (!probe.finite) return 'nan'
  if (probe.peak <= 1e-5) return 'silent'
  if (probe.mono <= probe.peak * 0.08 && probe.peak > 0.05) return 'mono'
  const heard = perceivedLevel(probe, duration)
  if (heard < 0.04) return 'silent'
  if (probe.peak > 8) return 'clip'
  return null
}

function tame(patch: AudioPatch, issue: CandidateIssue): AudioPatch {
  const layers = patch.layers.map((layer) => {
    if (!layer.enabled) return layer
    const filterA = { ...layer.filterA, resonance: layer.filterA.resonance * 0.72, envAmount: layer.filterA.envAmount * 0.85 }
    const filterB = { ...layer.filterB, resonance: layer.filterB.resonance * 0.72 }
    const insert = (slot: typeof layer.insertA) => (
      slot.kind === 'off' ? slot : { ...slot, amount: slot.amount * 0.82, drive: slot.drive * 0.82, feedback: slot.feedback * 0.88 }
    )
    return {
      ...layer,
      gain: layer.gain * (issue === 'silent' ? 1.15 : 0.88),
      filterA, filterB,
      insertA: insert(layer.insertA),
      insertB: insert(layer.insertB),
      insertC: insert(layer.insertC),
      source: { ...layer.source, fmIndex: layer.source.fmIndex * 0.88 },
    }
  })
  const fxSlot = (slot: typeof patch.fx.x) => (
    slot.kind === 'off' ? slot : { ...slot, mix: slot.mix * 0.85, feedback: slot.feedback * 0.9 }
  )
  return {
    ...patch,
    layers,
    fx: { ...patch.fx, x: fxSlot(patch.fx.x), y: fxSlot(patch.fx.y), z: fxSlot(patch.fx.z) },
    master: { ...patch.master, limiter: issue === 'silent' ? patch.master.limiter : Math.min(1, Math.max(patch.master.limiter, 0.7)) },
  }
}

export function fitTo(patch: AudioPatch, sampleRate: number, target: number): AudioPatch {
  const probe = probePatch(patch, sampleRate)
  if (!probe.finite || probe.peak <= 1e-6) return patch
  const gain = clamp(target / probe.peak, 0.05, 3)
  return { ...patch, master: { ...patch.master, gain } }
}

/**
 * Level a candidate, try one targeted correction if it fails, and report whether it is usable.
 * Unlimited search belongs nowhere near a button press.
 */
export function settleCandidate(
  patch: AudioPatch,
  sampleRate: number,
  target = 0.75,
  original?: Probe,
): { patch: AudioPatch; ok: boolean } {
  const aim = original ? clamp(perceivedLevel(original, patch.duration), 0.1, 0.9) : target
  let next = fitTo(patch, sampleRate, aim)
  let probe = probePatch(next, sampleRate)
  let issue = candidateIssue(probe, next.duration)
  if (issue && issue !== 'nan') {
    next = fitTo(tame(next, issue), sampleRate, aim)
    probe = probePatch(next, sampleRate)
    issue = candidateIssue(probe, next.duration)
  }
  if (original) {
    const heard = perceivedLevel(probe, next.duration)
    const before = perceivedLevel(original, patch.duration)
    if (before > 0.05 && (heard < before * 0.35 || heard > before * 2.8)) {
      next = fitTo(next, sampleRate, aim)
      probe = probePatch(next, sampleRate)
      issue = candidateIssue(probe, next.duration)
    }
  }
  return { patch: next, ok: issue == null && probe.peak <= 1.05 }
}
