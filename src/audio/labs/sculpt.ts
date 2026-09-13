import { renderPatch } from '@paramrig/audio'
import { writeMacros } from '../macros'
import type { Stereo } from '@paramrig/audio'
import type { LabShape } from './analysis'
import { fitDuration } from './generate'
import { DURATION_MAX, DURATION_MIN, fingerprint, type LabSound } from './model'

/**
 * The three things a person can take hold of on the Shape view, and what each really does to
 * the sound on the bench. Nothing here draws a new seed: the patch is the same patch with one
 * property moved, so the sound is recognisably the one that was there.
 *
 * - Duration is the exact length, stretched by the patch's own timing — envelopes, modulation,
 *   gestures and tails — so the pitch stays where it was. It is not a resample.
 * - Width is the master's mid/side balance, the one width that belongs to the whole sound.
 * - Level is the peak the sound reaches, set through the master gain and held to its target by
 *   rendering again, so what is shown is what is heard and what is exported.
 */
export type SculptKind = 'duration' | 'width' | 'level'
export type SculptValues = { durationMs: number; width: number; levelDb: number }
export const SCULPT_RANGE: Record<SculptKind, readonly [number, number]> = {
  duration: [DURATION_MIN, DURATION_MAX],
  width: [0, 2],
  // Never past -0.3 dBFS: the output stays under full scale, whatever is pulled.
  level: [-48, -0.3],
}
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function clampSculpt(kind: SculptKind, value: number): number {
  const [low, high] = SCULPT_RANGE[kind]
  if (kind === 'duration') return Math.round(clamp(value, low, high))
  if (kind === 'width') return Math.round(clamp(value, low, high) * 1000) / 1000
  return Math.round(clamp(value, low, high) * 10) / 10
}

export function sculptValues(sound: LabSound, shape: LabShape | null): SculptValues {
  return {
    durationMs: Math.round(sound.patch.duration * 1000),
    width: sound.patch.master.width ?? 1,
    levelDb: shape ? Math.round(shape.topDb * 10) / 10 : Number.NaN,
  }
}

export const sculptValue = (values: SculptValues, kind: SculptKind) => (kind === 'duration' ? values.durationMs : kind === 'width' ? values.width : values.levelDb)

/** One property pulled, everything else as it was. `peakDb` is the peak the sound has now. */
export function sculptSound(sound: LabSound, kind: SculptKind, value: number, peakDb: number): LabSound {
  const target = clampSculpt(kind, value)
  let patch = structuredClone(sound.patch)
  if (kind === 'duration') patch = fitDuration(patch, target / 1000)
  else if (kind === 'width') patch.master.width = target
  else if (Number.isFinite(peakDb)) patch.master.gain = clamp(patch.master.gain * Math.pow(10, (target - peakDb) / 20), 0, 3)
  return withPatch(sound, patch)
}

function withPatch(sound: LabSound, patch: LabSound['patch']): LabSound {
  const next: LabSound = { ...sound, patch, rig: writeMacros(sound.rig, sound.macros, patch), fingerprint: fingerprint(patch) }
  delete next.preview
  return next
}

const peakOf = (samples: Stereo) => {
  let peak = 0
  for (let i = 0; i < samples.left.length; i++) peak = Math.max(peak, Math.abs(samples.left[i]!), Math.abs(samples.right[i]!))
  return peak
}

/**
 * Renders a sculpted sound. A level request is held to its target peak within a tenth of a
 * decibel: the master limiter bends the top of the waveform, so a gain computed from the old
 * peak lands a little short, and one or two more renders put it where the handle said.
 */
export function renderSculpted(sound: LabSound, rate: number, targetPeakDb?: number): { sound: LabSound; samples: Stereo } {
  let current = sound
  let samples = renderPatch(current.patch, rate)
  if (targetPeakDb === undefined || !Number.isFinite(targetPeakDb)) return { sound: current, samples }
  for (let pass = 0; pass < 3; pass++) {
    const peak = peakOf(samples)
    const db = 20 * Math.log10(peak + 1e-12)
    if (!(peak > 0) || Math.abs(db - targetPeakDb) <= 0.1) break
    const gain = clamp(current.patch.master.gain * Math.pow(10, (targetPeakDb - db) / 20), 0, 3)
    if (Math.abs(gain - current.patch.master.gain) < 1e-6) break
    current = withPatch(current, { ...current.patch, master: { ...current.patch.master, gain } })
    samples = renderPatch(current.patch, rate)
  }
  return { sound: current, samples }
}
