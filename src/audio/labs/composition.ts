import { makeMod, makePerformer } from '@paramrig/audio'
import { SCENE_COUNT, STEP_COUNT } from '@paramrig/audio/fields'
import { between, clamp, pick } from '../shuffle-draw'
import type { AudioPatch } from '@paramrig/audio'
import type { LabCriteria, LabRole } from './model'
import type { LegacyFamily } from './catalog'

type Rng = () => number
type Arrangement = 'direct' | 'answer' | 'relay' | 'swarm' | 'bloom' | 'rebound' | 'crossfade' | 'latch'
const ARRANGEMENTS: Record<LegacyFamily, readonly Arrangement[]> = {
  growl: ['direct', 'answer', 'relay', 'crossfade', 'bloom'],
  impact: ['direct', 'rebound', 'rebound', 'swarm'],
  transformation: ['answer', 'relay', 'latch', 'swarm', 'crossfade'],
  servo: ['direct', 'answer', 'relay', 'latch'],
  scan: ['direct', 'relay', 'answer', 'crossfade'],
  glitch: ['direct', 'answer', 'swarm', 'relay', 'latch'],
  pulse: ['direct', 'answer', 'swarm', 'rebound'],
  drone: ['direct', 'crossfade', 'bloom'],
  rise: ['direct', 'bloom', 'crossfade'],
  fall: ['direct', 'rebound', 'relay', 'crossfade'],
  burst: ['direct', 'swarm', 'rebound', 'latch'],
  texture: ['direct', 'swarm', 'crossfade', 'bloom', 'answer'],
}
const targetKeys = ['target', 'targetB', 'targetC', 'targetD'] as const
const depthKeys = ['depth', 'depthB', 'depthC', 'depthD'] as const
// Traverse the 16 contour points once, without interpolating back to the attack at the end.
const contourRate = (STEP_COUNT - 1) / STEP_COUNT

/** A smooth event, optionally with a much faster onset than decay. */
function event(t: number, centre: number, width: number, strike = false): number {
  const x = (t - centre) / width
  if (strike) return x >= 0 ? Math.exp(-x * 4) : Math.exp(-x * x * 180)
  return Math.exp(-x * x * 3)
}

function contour(kind: Arrangement, rng: Rng, lane: number): number[] {
  const pivot = between(rng, 0.36, 0.62)
  const width = between(rng, 0.13, 0.3)
  const bloomLength = between(rng, 0.72, 1.18), bloomPower = between(rng, 0.65, 1.8)
  const lockAt = between(rng, 0.55, 0.78), teeth = pick(rng, [3, 4, 5, 7])
  const hits = Array.from({ length: pick(rng, [3, 4, 6, 8]) }, () => ({ t: rng() * 0.9, amp: between(rng, 0.5, 1), width: between(rng, 0.035, 0.11) }))
  return Array.from({ length: STEP_COUNT }, (_, i) => {
    const t = i / (STEP_COUNT - 1)
    let value = 1
    if (kind === 'answer') {
      value = lane === 0 ? event(t, 0.14, width) + event(t, 0.75, width * 0.8)
        : event(t, pivot, width) + 0.45 * event(t, 0.91, width * 0.6)
    } else if (kind === 'relay') {
      value = event(t, 0.12 + lane * 0.27, width * 1.3) + 0.15 * event(t, 0.85, 0.2)
    } else if (kind === 'swarm') {
      value = hits.reduce((sum, hit) => sum + hit.amp * event(t, hit.t, hit.width), 0)
      // A burst starts with a strike; later fragments may be sparse.
      if (lane === 0) value += event(t, 0, 0.12, true)
    } else if (kind === 'bloom') {
      value = Math.pow(Math.sin(Math.PI * clamp(t / (bloomLength + lane * 0.08), 0, 1)), bloomPower + lane * 0.3)
    } else if (kind === 'rebound') {
      const gap = pivot * 0.55
      value = event(t, 0.02, width, true) + 0.65 * event(t, gap, width * 0.65, true)
        + 0.35 * event(t, gap * 2.25, width * 0.6, true)
    } else if (kind === 'crossfade') {
      const fade = clamp((t - pivot + 0.3) / 0.6, 0, 1)
      value = lane === 0 ? Math.cos(fade * Math.PI / 2) : Math.sin(fade * Math.PI / 2)
    } else if (kind === 'latch') {
      const lock = Math.min(0.86, lockAt + lane * 0.04)
      value = t < lock ? 0.7 * Math.pow(Math.sin((t * teeth + lane * 0.3) * Math.PI), 2)
        : event(t, lock + 0.035, 0.22, true)
    }
    return clamp(value, 0.025, 1)
  })
}

/**
 * Arrange at the one-second design scale, before fitDuration. This changes when voices are
 * foregrounded; the oscillator bank, pitches and material remain the same design.
 */
export function composeExploration(patch: AudioPatch, roles: LabRole[], criteria: LabCriteria, rng: Rng, duration: number): string {
  // There is no useful room for a multi-event gesture in a 20 ms click.
  if (duration < 0.12) return 'direct'
  const options = criteria.motion === 'continuous' ? ['direct', 'crossfade', 'bloom'] as const : ARRANGEMENTS[criteria.type as LegacyFamily]
  const kind = pick(rng, options)
  if (kind === 'direct') return kind

  const rhythmic = criteria.motion !== 'natural' && criteria.motion !== 'continuous' || criteria.type === 'pulse'
  // Keep a specifically requested rhythm intact; the new long contour moves its timbre.
  // Natural events can use all three performers to exchange the foreground between voices.
  if (!rhythmic) {
    for (const mod of [...patch.mods, ...patch.performers]) for (let i = 0; i < 4; i++) {
      if (mod[targetKeys[i]!].endsWith('.gain')) mod[targetKeys[i]!] = 'off'
    }
  }
  const rowCount = rhythmic ? 1 : Math.min(3, patch.layers.filter((layer) => layer.enabled).length)
  for (let lane = 0; lane < rowCount; lane++) {
    const index = rhythmic ? 2 : lane
    const layer = patch.layers[lane]!
    const row = contour(kind, rng, lane)
    if (rhythmic) {
      patch.performers[index] = makePerformer({ enabled: true, bipolar: true, rate: contourRate, shape: 'curve',
        target: layer.source.kind === 'table' ? `layers[${lane}].pulseWidth` : `layers[${lane}].cutoff`, depth: between(rng, 0.22, 0.48),
        targetB: 'layers[1].cutoff', depthB: -0.25, patterns: Array.from({ length: SCENE_COUNT }, () => [...row]) })
      continue
    }
    const sustained = criteria.motion === 'continuous' || criteria.type === 'drone'
    const sweepTarget = layer.source.kind === 'table' ? 'pulseWidth' : 'cutoff'
    // Deep gain travel for replies and bursts; continuous material instead changes spectrum.
    patch.performers[index] = makePerformer({ enabled: true, bipolar: true, rate: contourRate, shape: 'curve',
      target: `layers[${lane}].${sustained ? sweepTarget : 'gain'}`, depth: sustained ? between(rng, 0.2, 0.45) : between(rng, 0.82, 0.96),
      targetB: `layers[${lane}].${sustained ? 'pan' : sweepTarget}`, depthB: between(rng, 0.06, 0.25),
      patterns: Array.from({ length: SCENE_COUNT }, () => [...row]) })
    if (roles[lane] === 'attack') continue
    // An early AHDSR decay would silence an answering voice before its turn. The performer
    // now supplies the event envelope, with AHDSR retaining smooth onset and final release.
    layer.offset = 0
    layer.amp = { attack: criteria.type === 'rise' ? between(rng, 0.32, 0.58) : between(rng, 0.008, 0.04),
      hold: between(rng, 0.32, 0.44), decay: between(rng, 0.12, 0.2), sustain: between(rng, 0.65, 0.9),
      release: between(rng, 0.1, 0.18), curve: between(rng, 0.8, 2) }
    if (lane === 1 && (kind === 'answer' || kind === 'relay' || kind === 'crossfade')) layer.gain = Math.min(0.55, layer.gain * 1.6)
  }

  // A second independent timbral movement makes the secondary voice change character during
  // its response, rather than just becoming a quieter copy of the primary movement.
  const second = patch.layers[1]!
  patch.mods[3] = makeMod({ enabled: true, target: second.source.kind === 'noise' ? 'layers[1].cutoff' : 'layers[1].pm',
    shape: pick(rng, ['sine', 'triangle', 'saw', 'noise']), phase: rng(), rate: between(rng, 0.7, 9), depth: between(rng, 0.07, 0.32) })
  // Unused routes should not appear as motion destinations when macros are prepared.
  for (const performer of patch.performers) {
    for (let route = 0; route < 4; route++) if (performer[targetKeys[route]!] === 'off') performer[depthKeys[route]!] = 0
  }
  return kind
}

/** Diversify PM wiring without feedback loops: every edge goes to a higher-numbered source. */
export function connectExploration(patch: AudioPatch, roles: LabRole[], rng: Rng): string {
  if (patch.layers[0]!.source.pmFrom !== 'layer1') return 'independent'
  const third = patch.layers[2]
  if (!third?.enabled) return 'pair'
  const kind = pick(rng, ['pair', 'chain', 'fork'] as const)
  if (kind === 'chain' && patch.layers[1]!.source.kind !== 'noise') {
    patch.layers[1]!.source.pmFrom = 'layer2'
    patch.layers[1]!.source.fmIndex = between(rng, 0.45, 1.8)
    third.offset = 0
    third.amp = { ...patch.layers[1]!.amp }
  } else if (kind === 'fork' && patch.layers[1]!.source.kind !== 'noise') {
    patch.layers[0]!.source.pmFrom = 'layer2'; patch.layers[1]!.source.pmFrom = 'layer2'
    third.offset = 0
    third.amp = { ...patch.layers[0]!.amp }
  } else return 'pair'
  // The modulator can be predominantly a texture, with both carriers providing the body.
  third.gain = Math.min(third.gain, 0.15)
  roles[2] = 'mechanism'
  return kind
}
