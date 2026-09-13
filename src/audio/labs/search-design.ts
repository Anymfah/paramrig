import { EASE_IN, EASE_OUT } from '@paramrig/audio/curves'
import { mulberry32 } from '@paramrig/audio/random'
import { SCENE_COUNT, STEP_COUNT } from '@paramrig/audio/fields'
import { makeMod, makePerformer } from '@paramrig/audio'
import { between, clamp, logBetween, pick } from '../shuffle-draw'
import type { AudioPatch, Layer } from '@paramrig/audio'
import type { LabCriteria, LabRole } from './model'
import type { LabGesture } from './selections'
import { applyMotionDesign, motionTime } from './motion-design'

type Rng = () => number
const targets = ['target', 'targetB', 'targetC', 'targetD'] as const
const depths = ['depth', 'depthB', 'depthC', 'depthD'] as const
const contourRate = (STEP_COUNT - 1) / STEP_COUNT

/** New controls use independent random streams: moving intensity cannot redraw an oscillator. */
export function applySearchDesign(patch: AudioPatch, roles: LabRole[], criteria: LabCriteria, seed: number, textureLayer = 0, articulate?: () => void, requestedGesture: LabGesture = criteria.gesture ?? 'auto'): void {
  applyRegister(patch, criteria, mulberry32(seed ^ 0x174ac321))
  applyTexture(patch, criteria, mulberry32(seed ^ 0x6d2b79f5), textureLayer)
  applyDensity(patch, roles, criteria)
  applyGesture(patch, criteria, mulberry32(seed ^ 0x91baf320))
  articulate?.()
  applyMotionDesign(patch, criteria, seed, requestedGesture)
  applyMass(patch, roles, criteria)
  applyIntensity(patch, criteria)
}

function applyRegister(patch: AudioPatch, criteria: LabCriteria, rng: Rng): void {
  const register = criteria.register ?? 'auto'
  if (register === 'auto') return
  const active = patch.layers.filter((layer) => layer.enabled)
  const ranges = { low: [48, 150], mid: [220, 550], high: [850, 2100] } as const
  const [low, high] = register === 'full' ? [65, 120] : ranges[register]
  const root = logBetween(rng, low!, high!)
  const ratio = root / active[0]!.pitch.start
  active.forEach((layer, i) => {
    const next = register === 'full' ? root * [1, 4, 16, 30][i]! : layer.pitch.start * ratio
    const scale = next / layer.pitch.start
    layer.pitch.start = clamp(next, 30, 8000)
    // Noise and modal recipes need their spectral anchors moved as well as nominal pitch.
    for (const filter of [layer.filterA, layer.filterB]) {
      if (filter.kind !== 'off') filter.cutoff = clamp(filter.cutoff * Math.sqrt(scale), 70, 14000)
    }
    for (const insert of [layer.insertA, layer.insertB, layer.insertC]) {
      if (insert.kind === 'body') insert.frequency = clamp(insert.frequency * scale, 60, 12000)
      if (insert.kind === 'comb') insert.time = clamp(insert.time / scale, 0.0002, 0.035)
    }
  })
}

function applyTexture(patch: AudioPatch, criteria: LabCriteria, rng: Rng, index: number): void {
  const texture = criteria.texture ?? 'auto'
  if (texture === 'auto') return
  const layer = patch.layers[index]!
  const target = (field: string) => `layers[${index}].${field}`
  const root = layer.pitch.start
  if (texture === 'vocal') {
    layer.source.kind = 'table'; layer.source.table = pick(rng, ['formant', 'growl', 'serpent'])
    layer.source.position = between(rng, 0.18, 0.8); layer.source.fmIndex = Math.min(layer.source.fmIndex, 0.7)
    layer.filterA = { ...layer.filterA, kind: 'formant', cutoff: clamp(root * between(rng, 3, 6), 280, 2600), resonance: between(rng, 0.22, 0.5) }
    patch.mods[4] = makeMod({ enabled: true, target: target('cutoff'), rate: between(rng, 1.5, 5), depth: 0.22, shape: 'sine' })
  } else if (texture === 'buzz') {
    layer.source.kind = pick(rng, ['tone', 'table'])
    layer.source.wave = pick(rng, ['saw', 'square']); layer.source.table = pick(rng, ['pulse', 'gate', 'stack'])
    layer.source.fmIndex = between(rng, 0.2, 0.8); layer.source.voices = pick(rng, [1, 2, 3])
    layer.filterA = { ...layer.filterA, kind: 'lowpass', cutoff: clamp(root * between(rng, 10, 18), 900, 12000), resonance: 0.12 }
  } else if (texture === 'friction' || texture === 'crackle') {
    layer.source.kind = 'noise'; layer.source.pmFrom = 'internal'
    layer.source.colour = texture === 'friction' ? pick(rng, ['pink', 'metallic']) : 'white'
    layer.filterA = { ...layer.filterA, kind: 'bandpass', cutoff: clamp(root * between(rng, 5, 10), 220, 6500), resonance: between(rng, 0.15, 0.4) }
    layer.insertA = { ...layer.insertA, kind: texture === 'crackle' ? 'crusher' : 'drive',
      amount: texture === 'crackle' ? 0.48 : 0.22, drive: 0.2, bitDepth: pick(rng, [5, 7, 9]), crush: 0.22 }
    patch.mods[4] = makeMod({ enabled: true, target: target(texture === 'crackle' ? 'gain' : 'cutoff'),
      shape: texture === 'crackle' ? 'noise' : 'triangle', rate: texture === 'crackle' ? between(rng, 22, 38) : between(rng, 8, 18),
      depth: texture === 'crackle' ? 0.85 : 0.28 })
  } else if (texture === 'resonant') {
    if (criteria.avoid.includes('sub')) {
      // A linear, tuned delay rings without synthesising subharmonics after the high-pass.
      layer.insertC = { ...layer.insertC, kind: 'comb', time: clamp(1 / Math.max(220, root * 3), 0.0002, 0.004), feedback: 0.66, amount: 0.35 }
      layer.filterB = { ...layer.filterB, kind: 'peak', cutoff: Math.max(440, root * 3), resonance: 0.68 }
      layer.routing = 'series'
    } else {
      layer.insertC = { ...layer.insertC, kind: 'body', place: 'post',
        profile: criteria.material === 'glass' ? 'glass' : criteria.material === 'metal' ? pick(rng, ['plate', 'bar']) : pick(rng, ['cavity', 'membrane', 'aether']),
        frequency: clamp(root * between(rng, 2, 7), 120, 7500), partials: pick(rng, [3, 4, 6]),
        spread: between(rng, 0.25, 0.85), decay: between(rng, 0.22, 0.55), character: 0.5, amount: 0.42 }
    }
  } else if (texture === 'pure') {
    layer.source.kind = 'tone'; layer.source.wave = 'sine'; layer.source.fmIndex = 0; layer.source.pmFrom = 'internal'; layer.source.voices = 1
    layer.filterA.kind = 'off'; layer.filterB.kind = 'off'
    layer.insertA.kind = 'off'; layer.insertB.kind = 'off'; layer.insertC.kind = 'off'
  } else if (texture === 'airy') {
    layer.source.kind = 'noise'; layer.source.colour = 'pink'; layer.source.pmFrom = 'internal'
    layer.filterA = { ...layer.filterA, kind: 'highpass', cutoff: between(rng, 1300, 3600), resonance: 0.08, envAmount: 0 }
    layer.insertA.kind = 'off'; layer.insertC.kind = 'off'
    layer.amp.attack = Math.max(0.05, layer.amp.attack)
  } else if (texture === 'gritty') {
    layer.insertA = { ...layer.insertA, kind: 'crusher', bitDepth: pick(rng, [5, 7, 9]), crush: between(rng, 0.15, 0.4), amount: 0.55 }
    layer.insertB = { ...layer.insertB, kind: 'drive', drive: 0.32, amount: 0.3 }
  } else if (texture === 'hollow') {
    layer.insertC = { ...layer.insertC, kind: 'body', place: 'post', profile: 'cavity', frequency: clamp(root * 2, 150, 1100), partials: 3, spread: 0.2, character: 0.1, decay: 0.25, amount: 0.5 }
    layer.filterA = { ...layer.filterA, kind: 'notch', cutoff: clamp(root * 5, 700, 3200), resonance: 0.5 }
  } else if (texture === 'shimmer') {
    layer.source.kind = 'table'; layer.source.table = pick(rng, ['glass', 'prism', 'ion']); layer.source.position = between(rng, 0.6, 0.9)
    layer.source.voices = 3; layer.source.detune = between(rng, 8, 20); layer.source.fmIndex = 0.2
    layer.filterA = { ...layer.filterA, kind: 'highpass', cutoff: between(rng, 1600, 3000), resonance: 0.15, envAmount: 0 }
    patch.mods[4] = makeMod({ enabled: true, target: target('pulseWidth'), shape: 'sine', rate: 3.5, depth: 0.2 })
  } else if (texture === 'rasp') {
    layer.source.kind = 'tone'; layer.source.wave = 'saw'; layer.source.fmRatio = 0.5; layer.source.fmIndex = 1.8
    layer.filterA = { ...layer.filterA, kind: 'bandpass', cutoff: clamp(root * 6, 550, 2400), resonance: 0.3 }
    layer.insertA = { ...layer.insertA, kind: 'ring', ratio: 0.25, amount: 0.45 }
    patch.mods[4] = makeMod({ enabled: true, target: target('cutoff'), shape: 'saw', rate: between(rng, 12, 24), depth: 0.2 })
  }
}

function applyDensity(patch: AudioPatch, roles: LabRole[], criteria: LabCriteria): void {
  const density = criteria.density
  if (density == null) return
  patch.layers.forEach((layer, i) => {
    if (!layer.enabled || i === 0) return
    // Keep PM dependencies enabled even when their audible detail is reduced.
    if (roles[i] !== 'body') layer.gain *= 0.3 + density * 1.25
  })
  for (const mod of patch.mods) if (mod.enabled && mod.kind === 'lfo') mod.rate = clamp(mod.rate * (0.4 + density * 1.7), 0.1, 40)
}

function applyMass(patch: AudioPatch, roles: LabRole[], criteria: LabCriteria): void {
  // Old weight-only callers retain their calibrated transposition. New mass and register are independent.
  if (criteria.mass === undefined && (!criteria.register || criteria.register === 'auto')) return
  const mass = criteria.mass ?? criteria.weight
  if (mass === 'balanced') return
  const heavy = mass === 'heavy'
  patch.layers.forEach((layer, i) => {
    if (!layer.enabled) return
    if (i === 0 || roles[i] === 'body') {
      layer.gain *= heavy ? 1.2 : 0.85
      layer.amp.sustain = clamp(layer.amp.sustain * (heavy ? 1.25 : 0.65), 0, 1)
      layer.amp.release *= heavy ? 1.2 : 0.65
    } else layer.gain *= heavy ? 0.8 : 1.15
  })
  patch.fx.tone = clamp(patch.fx.tone + (heavy ? -0.22 : 0.17), -1, 1)
}

function applyIntensity(patch: AudioPatch, criteria: LabCriteria): void {
  const intensity = criteria.intensity
  if (intensity == null) return
  for (const layer of patch.layers.filter((l) => l.enabled)) {
    layer.amp.attack *= 1.85 - intensity * 1.5
    layer.source.fmIndex *= 0.55 + intensity * 0.9
    for (const insert of [layer.insertA, layer.insertB, layer.insertC]) if (insert.kind === 'drive' || insert.kind === 'fold') {
      insert.drive = clamp(insert.drive * (0.4 + intensity * 1.4), 0.02, 0.8)
      insert.amount = clamp(insert.amount * (0.6 + intensity * 0.8), 0.04, 0.7)
    }
    for (const filter of [layer.filterA, layer.filterB]) if (filter.kind === 'lowpass' || filter.kind === 'ladder') filter.cutoff = clamp(filter.cutoff * (0.65 + intensity * 0.8), 100, 14000)
  }
  for (const mod of [...patch.mods, ...patch.performers]) if (mod.enabled) {
    targets.forEach((target, i) => {
      if (mod[target] !== 'off' && !mod[target].endsWith('.gain')) mod[depths[i]!] = clamp(mod[depths[i]!] * (0.55 + intensity * 0.85), -1, 1)
    })
  }
  // Output gain is deliberately unchanged: intensity changes attack/timbre, not preview loudness.
}

const bump = (t: number, centre: number, width: number) => Math.exp(-Math.pow((t - centre) / width, 2) * 3)
const hit = (t: number, at: number, decay: number) => t < at ? 0 : Math.exp(-(t - at) / decay)

/** All times are at the one-second design scale, before fitDuration. */
function applyGesture(patch: AudioPatch, criteria: LabCriteria, rng: Rng): void {
  const gesture = criteria.gesture ?? 'auto'
  // Density refines an existing scenario; it must not invent a phrase when none was requested.
  if (gesture === 'auto') return
  const density = criteria.density ?? between(rng, 0.25, 0.8)
  const hits = 2 + Math.round(density * 4)
  const pivot = between(rng, 0.55, 0.72)
  const scatter = Array.from({ length: hits }, (_, i) => (i + between(rng, 0.1, 0.6)) / hits * 0.92)
  const textureTarget = patch.mods[4]!.target
  // Long contours replace previous volume sequencing; timbral routes and PM links remain intact.
  for (const mod of [...patch.mods, ...patch.performers]) targets.forEach((target, i) => {
    if (mod[target].endsWith('.gain')) { mod[target] = 'off'; mod[depths[i]!] = 0 }
  })
  const row = (lane: number) => Array.from({ length: STEP_COUNT }, (_, i) => {
    const t = i / (STEP_COUNT - 1)
    const u = motionTime(t, criteria.motion)
    let value: number
    switch (gesture as Exclude<LabGesture, 'auto'>) {
      case 'single-hit': case 'ping': value = Math.exp(-t * (gesture === 'ping' ? 9 : 6)); break
      case 'rebounds': value = Array.from({ length: hits }, (_, n) => hit(u, n / hits * 0.86, 0.055) * Math.pow(0.7, n)).reduce((a, b) => a + b, 0); break
      case 'fracture': value = hit(t, 0, 0.12) + scatter.reduce((sum, at) => sum + 0.65 * bump(u, at, 0.055), 0); break
      case 'assemble-lock': value = t < pivot ? 0.6 * Math.pow(Math.sin(motionTime(t / pivot, criteria.motion) * hits * Math.PI), 2) : hit(t, pivot, 0.13); break
      case 'charge-impact': value = t < pivot ? 0.55 * Math.pow(t / pivot, 1.7) : hit(t, pivot, 0.17); break
      case 'deploy': value = t < pivot ? Math.pow(t / pivot, 1.4) : Math.exp(-(t - pivot) * 0.8); break
      case 'swell': value = Math.pow(Math.sin(Math.PI * Math.min(1, t / 1.1)), 1.8); break
      case 'retract': case 'decay': value = Math.pow(1 - t, gesture === 'retract' ? 1.2 : 2.8); break
      case 'break-apart': value = hit(t, 0, 0.15) + scatter.reduce((sum, at, n) => sum + (0.9 - at * 0.6) * bump(u, at, 0.035 + n * 0.004), 0); break
      case 'move': case 'sweep': value = 0.18 + 0.82 * Math.pow(Math.sin(Math.PI * t), 0.7); break
      case 'spin': value = (0.2 + 0.8 * Math.min(1, t * 4)) * (0.7 + 0.3 * Math.sin(u * hits * Math.PI * 2)); break
      case 'ratchet': case 'pulse': value = 0.04 + 0.96 * Math.pow(Math.max(0, Math.cos(u * hits * Math.PI * 2)), 3); break
      case 'stop': value = t < pivot ? 0.7 : hit(t, pivot, 0.05); break
      case 'sustain': value = 0.85 + 0.15 * Math.sin(t * Math.PI * 2); break
      case 'phrase': value = Array.from({ length: hits }, (_, n) => bump(u, (n + 0.35) / hits, 0.45 / hits)).reduce((a, b) => a + b, 0); break
      case 'surge': value = 0.12 + 0.88 * bump(t, 0.5, 0.28); break
      case 'sequence': value = Array.from({ length: hits }, (_, n) => bump(u, (n + 0.25 + lane * 0.07) / hits, 0.18 / hits)).reduce((a, b) => a + b, 0); break
      case 'stutter': case 'scatter': value = scatter.reduce((sum, at) => sum + bump(u, at + lane * 0.012, gesture === 'stutter' ? 0.035 : 0.065), 0); break
      case 'rub': value = (0.25 + 0.75 * Math.sin(Math.PI * t)) * (0.75 + 0.25 * Math.sin(u * Math.PI * hits * 4)); break
      case 'roll': value = 0.18 + 0.82 * Math.pow(Math.max(0, Math.cos(Math.sqrt(u) * Math.PI * hits * 3)), 2) * (1 - t * 0.7); break
      case 'shake': value = Math.pow(Math.sin(u * Math.PI * hits), 2) * (0.3 + 0.7 * Math.pow(Math.sin(u * Math.PI * hits * 3), 2)); break
      case 'breathe': value = t < pivot ? Math.pow(Math.sin(t / pivot * Math.PI / 2), 1.6) : Math.pow(Math.max(0, Math.cos((t - pivot) / (1 - pivot) * Math.PI / 2)), 2.5); break
      case 'flutter': value = (0.2 + 0.8 * Math.sin(Math.PI * t)) * (0.1 + 0.9 * Math.pow(Math.cos(u * Math.PI * (hits + 2)), 4)); break
      case 'drip': value = scatter.reduce((sum, at, n) => sum + (n % 2 ? 0.6 : 1) * hit(u, at, 0.04), 0); break
      case 'rattle': value = 0.04 + scatter.reduce((sum, at) => sum + bump(u, at, 0.024) + 0.65 * bump(u, at + 0.045, 0.018), 0); break
      case 'strum': value = hit(u, lane * 0.045, 0.18 + lane * 0.035); break
      case 'pluck': value = Math.exp(-t * 13); break
      case 'arpeggiate': value = Array.from({ length: hits }, (_, n) => hit(u, (n + lane * 0.22) / hits * 0.86, 0.075)).reduce((a, b) => a + b, 0); break
      case 'crumble': value = Math.pow(1 - t, 0.8) * (0.15 + scatter.reduce((sum, at) => sum + bump(u, at * 0.75, 0.09), 0)); break
    }
    // Movement changes event spacing above; never multiply two unrelated rhythms together.
    if (criteria.motion === 'collapsing' && ['spin', 'ratchet', 'pulse', 'phrase', 'sequence', 'stutter', 'scatter', 'rub', 'roll', 'shake', 'flutter', 'drip', 'rattle', 'strum', 'arpeggiate'].includes(gesture)) value *= (1 - t) ** 0.8
    return clamp(value, 0, 1)
  })
  for (let i = 0; i < Math.min(3, patch.layers.length); i++) {
    const layer = patch.layers[i]!
    if (!layer.enabled) continue
    const values = row(i)
    patch.performers[i] = makePerformer({ enabled: true, bipolar: true, shape: 'curve', rate: contourRate,
      target: `layers[${i}].gain`, depth: 1, ...(i === 2 && patch.layers[3]?.enabled ? { targetB: 'layers[3].gain' as const, depthB: 1 } : {}),
      patterns: Array.from({ length: SCENE_COUNT }, () => [...values]) })
  }
  for (const layer of patch.layers.filter((l) => l.enabled)) {
    layer.offset = 0
    layer.amp = { attack: criteria.avoid.includes('click') ? 0.035 : 0.008, hold: 0.65, decay: 0.07, sustain: 0.85, release: 0.16, curve: 1.2 }
    if (['deploy', 'swell', 'spin', 'charge-impact', 'sweep'].includes(gesture)) { layer.pitch.slide = Math.abs(layer.pitch.slide) + 5; layer.pitch.slideCurve = EASE_IN }
    if (['retract', 'decay', 'stop', 'break-apart'].includes(gesture)) { layer.pitch.slide = -Math.abs(layer.pitch.slide) - 5; layer.pitch.slideCurve = EASE_OUT }
  }
  // Crackle retains its fast stochastic texture underneath the slower scenario contour.
  if (criteria.texture === 'crackle') patch.mods[4]!.target = textureTarget.replace(/\.gain$/, '.cutoff')
}

function shortenEnvelope(layer: Layer, life: number): void {
  const total = layer.amp.attack + layer.amp.hold + layer.amp.decay + layer.amp.release
  if (total > life) for (const key of ['attack', 'hold', 'decay', 'release'] as const) layer.amp[key] *= life / total
}

/** Applied at the final duration, before exclusions; effects and fade are part of the same file. */
export function applyEnding(patch: AudioPatch, criteria: LabCriteria): void {
  const ending = criteria.ending ?? 'auto'
  if (ending === 'auto') return
  const duration = patch.duration
  for (const layer of patch.layers.filter((l) => l.enabled)) {
    const life = duration - layer.offset
    if (ending === 'cut') {
      const release = Math.min(0.007, life * 0.08)
      layer.amp.hold += Math.max(0, layer.amp.release - release)
      layer.amp.release = release
    } else if (ending === 'fade') layer.amp.release = Math.max(layer.amp.release, life * 0.4)
    else {
      // Excite early, leave time for a resonant decay inside the requested duration.
      layer.amp.hold = Math.min(layer.amp.hold, life * 0.12)
      layer.amp.decay = Math.min(layer.amp.decay, life * 0.24)
      layer.amp.sustain = Math.min(layer.amp.sustain, 0.18)
      layer.amp.release = life * 0.38
      for (const insert of [layer.insertA, layer.insertB, layer.insertC]) if (insert.kind === 'body') insert.decay = clamp(life * 0.5, 0.01, 2)
    }
    shortenEnvelope(layer, life)
  }
  if (ending === 'ring') {
    const slot = ['z', 'y', 'x'].find((key) => patch.fx[key as 'x' | 'y' | 'z'].kind === 'off') as 'x' | 'y' | 'z' | undefined
    const fx = patch.fx[slot ?? 'y']
    // Short feedback delay: resonant ringing, usable even when reverb or sub is excluded.
    Object.assign(fx, { kind: 'delay', mode: 'send', time: Math.min(0.026, duration * 0.075), feedback: 0.67, mix: 0.28 })
  }
  patch.master.fadeOut = ending === 'cut' ? Math.min(0.006, duration * 0.1)
    : ending === 'fade' ? Math.min(0.5, duration * 0.4) : Math.min(0.07, duration * 0.15)
}
