import { SCENE_COUNT, STEP_COUNT } from '@paramrig/audio/fields'
import { makeMod, makePerformer } from '@paramrig/audio'
import { mulberry32 } from '@paramrig/audio/random'
import { between, clamp, pick } from '../shuffle-draw'
import type { AudioPatch } from '@paramrig/audio'
import type { LabCriteria } from './model'
import type { LabGesture } from './selections'
import { hasChord } from './harmony-catalog'

const targets = ['target', 'targetB', 'targetC', 'targetD'] as const
const depths = ['depth', 'depthB', 'depthC', 'depthD'] as const
const contourRate = (STEP_COUNT - 1) / STEP_COUNT
export const ownsAutoMotion = (criteria: LabCriteria, gesture = criteria.gesture ?? 'auto') => gesture === 'auto' && criteria.motion !== 'natural'

/** Change event spacing, not the volume of a second, competing train of pulses. */
export function motionTime(t: number, motion: LabCriteria['motion']): number {
  const x = clamp(t, 0, 1)
  if (motion === 'stuttering' || motion === 'irregular') {
    const knots = motion === 'stuttering' ? [0, 0.28, 0.32, 0.6, 0.64, 0.92, 1] : [0, 0.08, 0.39, 0.48, 0.59, 0.9, 1]
    const at = x * (knots.length - 1), index = Math.min(knots.length - 2, Math.floor(at))
    return knots[index]! + (knots[index + 1]! - knots[index]!) * (at - index)
  }
  return motion === 'accelerating' ? x ** 1.8
    : motion === 'decelerating' || motion === 'collapsing' ? 1 - (1 - x) ** 1.8 : x
}

/** Compose repeated hits and breaks within the existing, smoothly interpolated contour. */
function stutterPositions(density: number, rng: () => number): number[] {
  const count = 3 + Math.floor(density * 2 + rng() * 2)
  const intervals = Array.from({ length: count - 1 }, () => 2)
  // Keep one close pair and one audible break, wherever they land. Independent random
  // gates tend to produce a regular pulse or isolated hits rather than a stutter.
  const pair = Math.floor(rng() * intervals.length)
  const pause = (pair + 1 + Math.floor(rng() * (intervals.length - 1))) % intervals.length
  intervals[pause] = 4
  const flexible = intervals.map((_, i) => i).filter((i) => i !== pair)
  const occupied = intervals.reduce((sum, gap) => sum + gap, 0)
  // Use the duration without a long empty tail, but leave the final step for release.
  const end = STEP_COUNT - 4 + Math.floor(rng() * 3)
  const start = Math.floor(rng() * (Math.min(2, end - occupied) + 1))
  const extra = end - start - occupied
  for (let i = 0; i < extra; i++) intervals[pick(rng, flexible)]! += 1
  const positions = [start]
  for (const gap of intervals) positions.push(positions.at(-1)! + gap)
  return positions
}

/** Final temporal ownership after the family/gesture passes, still at the one-second scale. */
export function applyMotionDesign(patch: AudioPatch, criteria: LabCriteria, seed: number, gesture: LabGesture): void {
  const motion = criteria.motion
  if (motion === 'natural') return
  const automatic = ownsAutoMotion(criteria, gesture)
  // Explicit gestures own their attacks. An unrelated gain LFO must not chop them again.
  for (const mod of patch.mods) for (const [i, target] of targets.entries()) {
    if (mod[target].endsWith('.gain')) mod[depths[i]!] = clamp(mod[depths[i]!]!, -0.18, 0.18)
  }
  if (!automatic) {
    if (['accelerating', 'decelerating', 'collapsing'].includes(motion)) {
      const free = patch.mods.findIndex((mod) => !mod.enabled)
      if (free >= 0) patch.mods[free] = makeMod({ enabled: true, kind: 'envelope', attack: 0.86, hold: 0.08, decay: 0, sustain: 1, release: 0.06,
        curve: motion === 'accelerating' ? 2.2 : 0.7, target: 'layers[0].cutoff', depth: motion === 'accelerating' ? 0.2 : -0.2 })
    }
    return
  }
  const rng = mulberry32(seed ^ 0x74ba3d19)
  const density = criteria.density ?? between(rng, 0.3, 0.75)
  const count = density < 0.3 ? 3 : density > 0.75 ? 5 : 4
  const accelerating = count === 3 ? [0, 8, 13] : count === 5 ? [0, 5, 9, 12, 14] : pick(rng, [[0, 6, 10, 13], [0, 7, 11, 14]])
  const positions = motion === 'accelerating' ? accelerating
    : motion === 'decelerating' ? accelerating.map((_, i) => accelerating.at(-1)! - accelerating[accelerating.length - 1 - i]!)
      : motion === 'pulsed' ? Array.from({ length: count }, (_, i) => i * (count === 3 ? 6 : count === 4 ? 4 : 3))
        : motion === 'stuttering' ? stutterPositions(density, rng)
          : pick(rng, [[0, 3, 8, 10, 14], [0, 5, 7, 11, 14], [0, 2, 7, 10, 14]])
  const floor = between(rng, 0.025, 0.065), power = between(rng, 1.4, 2.5)
  const pulses = Array.from({ length: STEP_COUNT }, () => floor)
  positions.forEach((position, i) => {
    const repeat = motion === 'stuttering' && i > 0 && position - positions[i - 1]! === 2
    pulses[position] = between(rng, repeat ? 0.72 : 0.86, 1)
  })
  const cycles = count === 3 ? 2 : 3, phase = between(rng, -0.1, 0.1)
  // Remove competing amplitude contours, including delayed/repeated envelope routes.
  for (const mod of [...patch.mods.filter((m) => m.kind === 'envelope'), ...patch.performers]) for (const [i, target] of targets.entries()) {
    if (mod[target].endsWith('.gain')) { mod[target] = 'off'; mod[depths[i]!] = 0 }
  }
  for (let lane = 0; lane < 3; lane++) {
    const values = Array.from({ length: STEP_COUNT }, (_, i) => {
      const t = i / (STEP_COUNT - 1)
      if (motion === 'collapsing') return (1 - t) ** power
      if (motion === 'continuous' || motion === 'alternating' && hasChord(criteria)) return 0.75 + 0.15 * Math.sin((t + phase) * Math.PI)
      if (motion === 'alternating') return 0.5 + 0.45 * Math.sin(t * cycles * Math.PI * 2 + phase + lane % 2 * Math.PI)
      return pulses[i]!
    })
    const continuous = motion === 'continuous' || motion === 'alternating' && hasChord(criteria)
    const collapse = motion === 'collapsing'
    patch.performers[lane] = makePerformer({ enabled: patch.layers[lane]!.enabled, bipolar: true, rate: contourRate, shape: 'curve',
      target: `layers[${lane}].${continuous ? 'cutoff' : 'gain'}`, depth: continuous ? 0.15 : 1,
      ...(lane === 2 && patch.layers[3]!.enabled ? { targetB: `layers[3].${continuous ? 'cutoff' : 'gain'}`, depthB: continuous ? 0.15 : 1 } : {}),
      ...(collapse ? { targetC: `layers[${lane}].cutoff`, depthC: 0.22 } : {}),
      patterns: Array.from({ length: SCENE_COUNT }, () => [...values]) })
  }
  for (const [index, layer] of patch.layers.entries()) {
    if (!layer.enabled) continue
    layer.offset = 0
    layer.amp = { attack: criteria.avoid.includes('click') ? 0.025 : 0.006, hold: 0.78, decay: 0.01, sustain: 1, release: 0.12, curve: 1.2 }
    if (motion === 'alternating' && !hasChord(criteria)) layer.pan = index % 2 ? 0.45 : -0.45
  }
  if (motion === 'collapsing') for (const mod of patch.mods) {
    // Slow, cyclic filter sweeps can sound like a fresh pulse even under a falling envelope.
    if (mod.enabled && mod.kind === 'lfo' && mod.rate < 12) for (const [i, target] of targets.entries()) {
      if (/\.(cutoff|pulseWidth|pm)$/.test(mod[target])) mod[depths[i]!] *= 0.25
    }
  }
}
