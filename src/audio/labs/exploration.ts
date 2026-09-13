import { EASE_IN, EASE_OUT, LINEAR } from '@paramrig/audio/curves'
import { SCENE_COUNT, STEP_COUNT } from '@paramrig/audio/fields'
import { makeLayer, makeMod, makePatch, makePerformer } from '@paramrig/audio'
import { between, chance, clamp, logBetween, pick } from '../shuffle-draw'
import type { AmpSettings, AudioPatch, BodyProfile, Layer } from '@paramrig/audio'
import type { LabCriteria, LabMotion, LabRole } from './model'
import type { LegacyFamily, LEGACY_MATERIALS, LEGACY_CHARACTERS } from './catalog'
import { composeExploration, connectExploration } from './composition'
import { applySearchDesign } from './search-design'
import { hasSelections } from './selections'

type Rng = () => number
type Engine = 'table' | 'phase' | 'cascade' | 'vowel' | 'comb' | 'modal' | 'noise'
type Gesture = 'strike' | 'swell' | 'sustain' | 'phrase' | 'scatter'
type Family = { engines: readonly Engine[]; gestures: readonly Gesture[]; pitch: [number, number] }

// Families constrain the construction, not a single preset. Repeated entries are weights.
const FAMILIES: Record<LegacyFamily, Family> = {
  growl: { engines: ['vowel', 'table', 'phase', 'cascade', 'comb'], gestures: ['phrase', 'swell', 'sustain'], pitch: [48, 165] },
  impact: { engines: ['modal', 'noise', 'phase', 'comb'], gestures: ['strike'], pitch: [50, 360] },
  transformation: { engines: ['cascade', 'table', 'comb', 'phase', 'vowel'], gestures: ['phrase', 'scatter', 'swell'], pitch: [55, 380] },
  servo: { engines: ['phase', 'cascade', 'comb', 'table'], gestures: ['phrase', 'swell', 'scatter'], pitch: [110, 880] },
  scan: { engines: ['table', 'phase', 'cascade', 'noise'], gestures: ['phrase', 'swell', 'sustain'], pitch: [260, 1500] },
  glitch: { engines: ['cascade', 'table', 'phase', 'noise', 'comb'], gestures: ['scatter', 'phrase'], pitch: [85, 1000] },
  pulse: { engines: ['phase', 'table', 'vowel', 'comb', 'modal'], gestures: ['sustain', 'phrase'], pitch: [65, 600] },
  drone: { engines: ['table', 'vowel', 'comb', 'phase', 'noise'], gestures: ['sustain', 'swell'], pitch: [45, 220] },
  rise: { engines: ['noise', 'table', 'cascade', 'comb', 'vowel'], gestures: ['swell'], pitch: [95, 550] },
  fall: { engines: ['phase', 'table', 'noise', 'modal', 'cascade'], gestures: ['phrase', 'strike', 'swell'], pitch: [220, 1300] },
  burst: { engines: ['noise', 'modal', 'cascade', 'comb', 'table'], gestures: ['scatter', 'strike'], pitch: [90, 950] },
  texture: { engines: ['comb', 'noise', 'modal', 'vowel', 'table'], gestures: ['sustain', 'scatter', 'swell'], pitch: [140, 1100] },
}

const TABLE_PALETTE: Record<typeof LEGACY_CHARACTERS[number], readonly string[]> = {
  any: ['sweep', 'pulse', 'formant', 'bell', 'stack', 'fold', 'glass', 'growl', 'titan', 'prism', 'gate', 'serpent', 'ion'],
  futuristic: ['titan', 'ion', 'prism', 'serpent', 'gate', 'fold', 'stack'],
  mechanical: ['growl', 'titan', 'pulse', 'stack', 'bell', 'gate'],
  organic: ['formant', 'serpent', 'sweep', 'growl', 'fold'],
  alien: ['serpent', 'prism', 'glass', 'formant', 'ion', 'fold'],
  industrial: ['titan', 'growl', 'gate', 'stack', 'pulse', 'bell'],
}
const MATERIAL_BIAS: Record<typeof LEGACY_MATERIALS[number], readonly Engine[]> = {
  any: [], metal: ['cascade', 'phase', 'comb', 'modal'], glass: ['modal', 'phase', 'table'],
  liquid: ['vowel', 'comb'], air: ['noise', 'comb'], electrical: ['cascade', 'phase', 'table'],
}

function envelope(rng: Rng, gesture: Gesture, life = 1): AmpSettings {
  const attack = gesture === 'strike' || gesture === 'scatter' ? between(rng, 0.002, 0.012)
    : gesture === 'swell' ? between(rng, 0.28, 0.64) : between(rng, 0.018, 0.12)
  const hold = gesture === 'sustain' ? between(rng, 0.35, 0.58) : between(rng, 0.01, 0.13)
  const decay = gesture === 'strike' ? between(rng, 0.12, 0.48) : between(rng, 0.16, 0.38)
  const release = between(rng, 0.07, 0.2)
  const scale = life * between(rng, 0.82, 0.98) / (attack + hold + decay + release)
  return { attack: attack * scale, hold: hold * scale, decay: decay * scale, release: release * scale,
    sustain: gesture === 'strike' ? 0 : between(rng, 0.12, 0.65), curve: between(rng, 0.65, 3.4) }
}

function modal(layer: Layer, rng: Rng, profiles: readonly BodyProfile[], root: number): void {
  layer.insertC = { ...layer.insertC, kind: 'body', place: 'post', profile: pick(rng, profiles),
    frequency: clamp(root, 60, 7500), spread: between(rng, 0.12, 0.9), partials: pick(rng, [3, 4, 5, 6]),
    decay: logBetween(rng, 0.04, 0.65), character: between(rng, 0.12, 0.88), amount: between(rng, 0.12, 0.38) }
}

function voice(engine: Engine, criteria: LabCriteria, rng: Rng, root: number, gesture: Gesture): Layer {
  const layer = makeLayer({ gain: between(rng, 0.48, 0.72), spread: between(rng, 0.15, 0.68),
    source: { kind: 'tone', wave: pick(rng, ['sine', 'triangle', 'saw', 'square']),
      pulseWidth: between(rng, 0.18, 0.75), fmRatio: pick(rng, [0.5, 1, 1.5, 2, 2.73, 3.17, 5.03, 7.1]),
      fmIndex: between(rng, 0.25, 1.5), fmFall: between(rng, 0.05, 0.85) },
    pitch: { start: root, slide: between(rng, -9, 7), slideCurve: pick(rng, [EASE_IN, EASE_OUT, LINEAR]) },
    filterA: { kind: pick(rng, ['lowpass', 'ladder', 'bandpass']), cutoff: logBetween(rng, 700, 6500),
      resonance: between(rng, 0.1, 0.45), envAmount: between(rng, -2.4, 2.4), envCurve: pick(rng, [EASE_IN, EASE_OUT]) },
    amp: envelope(rng, gesture),
  })
  if (engine === 'table' || engine === 'vowel') {
    layer.source.kind = 'table'
    layer.source.table = engine === 'vowel' ? pick(rng, ['formant', 'growl', 'serpent', 'pulse']) : pick(rng, TABLE_PALETTE[criteria.character as typeof LEGACY_CHARACTERS[number]])
    layer.source.position = between(rng, 0.08, 0.9)
    layer.source.voices = pick(rng, [1, 1, 2, 3, 5]); layer.source.detune = between(rng, 5, 36)
    if (engine === 'vowel') {
      layer.filterA.kind = 'formant'; layer.filterA.cutoff = logBetween(rng, 250, 1750)
      layer.source.fmIndex *= 0.3
    }
  } else if (engine === 'phase' || engine === 'cascade') {
    layer.source.wave = pick(rng, ['sine', 'sine', 'triangle'])
    layer.source.fmIndex = between(rng, 1.8, 6.5)
    layer.filterA.kind = pick(rng, ['lowpass', 'peak', 'notch', 'ladder'])
    if (engine === 'cascade') layer.source.pmFrom = 'layer1'
  } else if (engine === 'comb') {
    layer.source.kind = chance(rng, 0.65) ? 'noise' : 'tone'
    layer.source.colour = pick(rng, ['pink', 'metallic', 'white'])
    layer.filterA.kind = 'bandpass'; layer.filterA.cutoff = logBetween(rng, 400, 4000)
    layer.insertB = { ...layer.insertB, kind: 'comb', amount: between(rng, 0.35, 0.75),
      time: clamp(1 / root * pick(rng, [0.5, 1, 2, 3]), 0.0002, 0.035), feedback: between(rng, 0.4, 0.76) }
  } else if (engine === 'modal') {
    layer.source.kind = chance(rng, 0.55) ? 'noise' : 'tone'; layer.source.colour = pick(rng, ['pink', 'metallic'])
    layer.source.wave = 'sine'; layer.source.fmIndex = between(rng, 0.7, 3.5)
    modal(layer, rng, ['plate', 'bar', 'cavity', 'membrane', 'glass', 'aether'], root * logBetween(rng, 1.5, 9))
  } else {
    layer.source.kind = 'noise'; layer.source.colour = pick(rng, ['pink', 'white', 'metallic'])
    layer.filterA.kind = pick(rng, ['bandpass', 'comb', 'formant', 'lowpass'])
    layer.filterA.cutoff = logBetween(rng, 280, 5500)
  }
  // A controlled nonlinear stage supplies grain even when the exciter is only noise.
  layer.insertA = { ...layer.insertA, kind: pick(rng, ['drive', 'fold']), drive: between(rng, 0.1, 0.48), amount: between(rng, 0.12, 0.42) }
  if (layer.insertB.kind === 'off') {
    if ((criteria.type === 'glitch' || criteria.type === 'scan') && chance(rng, 0.65)) {
      layer.insertB = { ...layer.insertB, kind: 'crusher', amount: between(rng, 0.2, 0.55),
        bitDepth: pick(rng, [5, 7, 9, 11]), crush: between(rng, 0.1, 0.65) }
    } else if ((engine === 'phase' || engine === 'cascade') && chance(rng, 0.3)) {
      layer.insertB = { ...layer.insertB, kind: 'ring', amount: between(rng, 0.15, 0.4), ratio: logBetween(rng, 0.5, 7) }
    }
  }
  if (chance(rng, 0.4) && layer.filterA.kind !== 'formant') {
    layer.routing = pick(rng, ['series', 'parallel']); layer.filterMix = between(rng, 0.25, 0.75)
    layer.filterB = { ...layer.filterB, kind: pick(rng, ['lowpass', 'notch', 'peak']), cutoff: logBetween(rng, 1600, 8500), resonance: between(rng, 0.08, 0.38) }
  }
  return layer
}

/** Material gets a featured voice; it does not replace every layer with the same resonator. */
function materialColour(layer: Layer, criteria: LabCriteria, rng: Rng): void {
  const root = layer.pitch.start
  if (criteria.material === 'metal') {
    if (layer.source.kind === 'noise') layer.source.colour = 'metallic'
    if (chance(rng, 0.6)) modal(layer, rng, ['plate', 'bar', 'cavity'], root * logBetween(rng, 2, 12))
    else layer.insertC = { ...layer.insertC, kind: 'ring', amount: between(rng, 0.15, 0.5), ratio: pick(rng, [1.413, 2.73, 3.17, 5.09, 7.13]) }
  } else if (criteria.material === 'glass') {
    modal(layer, rng, ['glass', 'glass', 'aether'], logBetween(rng, 900, 5800))
    layer.insertC.decay = between(rng, 0.22, 0.7)
    layer.insertA.amount *= 0.4
  } else if (criteria.material === 'liquid') {
    layer.filterA.kind = pick(rng, ['formant', 'bandpass', 'comb'])
    layer.filterA.cutoff = logBetween(rng, 300, 2200); layer.filterA.resonance = between(rng, 0.32, 0.62)
    layer.filterA.envAmount = between(rng, 1.2, 3.4)
    layer.pitch.vibratoRate = between(rng, 5, 18); layer.pitch.vibratoDepth = between(rng, 0.15, 1.1)
  } else if (criteria.material === 'air') {
    layer.source.kind = 'noise'; layer.source.colour = pick(rng, ['pink', 'white'])
    layer.filterA.kind = 'bandpass'; layer.filterA.cutoff = logBetween(rng, 1200, 7000)
    layer.insertA.amount *= 0.25
  } else if (criteria.material === 'electrical') {
    layer.insertC = { ...layer.insertC, kind: pick(rng, ['ring', 'crusher']), amount: between(rng, 0.22, 0.55),
      ratio: logBetween(rng, 0.6, 8), bitDepth: pick(rng, [5, 7, 9, 11]), crush: between(rng, 0.08, 0.6) }
    layer.source.fmRatio = logBetween(rng, 1.3, 8); layer.source.fmIndex = between(rng, 1.2, 4.8)
  }
}

function characterColour(patch: AudioPatch, criteria: LabCriteria, rng: Rng): void {
  for (const layer of patch.layers.filter((l) => l.enabled)) {
    if (criteria.character === 'mechanical') {
      layer.pitch.jitter = between(rng, 2, 24)
      if (chance(rng, 0.55)) { layer.pitch.arpeggioRatio = pick(rng, [0.5, 0.75, 1.5, 2]); layer.pitch.arpeggioAt = between(rng, 0.2, 0.75) }
    } else if (criteria.character === 'organic') {
      layer.pitch.vibratoRate = between(rng, 2, 7); layer.pitch.vibratoDepth = between(rng, 0.08, 0.4)
      layer.source.fmIndex *= 0.65
    } else if (criteria.character === 'alien') {
      layer.source.fmRatio *= pick(rng, [0.707, 1.413, 1.618])
      layer.pitch.vibratoRate = between(rng, 0.4, 13); layer.pitch.vibratoDepth = between(rng, 0.2, 1.2)
    } else if (criteria.character === 'industrial') {
      layer.insertA.drive = between(rng, 0.3, 0.64); layer.insertA.amount = between(rng, 0.2, 0.48)
    } else if (criteria.character === 'futuristic') {
      // Keep PM and noise constructions intact; spectral travel is added in the modulation pass.
      layer.source.detune = between(rng, 9, 42)
      if (layer.insertB.kind === 'off' && chance(rng, 0.45)) layer.insertB = { ...layer.insertB, kind: 'ring', amount: between(rng, 0.08, 0.3), ratio: logBetween(rng, 0.5, 5) }
    }
  }
}

function phrase(rng: Rng, motion: LabMotion): number[] {
  const row = Array<number>(STEP_COUNT).fill(0)
  if (motion === 'continuous' || motion === 'natural') {
    const peaks = pick(rng, [1, 2, 3, 4]), phase = rng()
    return row.map((_, i) => clamp(0.5 + 0.35 * Math.sin((i / STEP_COUNT * peaks + phase) * Math.PI * 2) + between(rng, -0.12, 0.12), 0, 1))
  }
  if (motion === 'collapsing') return row.map((_, i) => Math.pow(1 - i / (STEP_COUNT - 1), between(rng, 0.8, 2.5)) * between(rng, 0.72, 1))
  const floor = between(rng, 0.01, 0.14)
  row.fill(floor)
  if (motion === 'pulsed') {
    const gap = pick(rng, [2, 3, 4, 5]), shift = pick(rng, [0, 1])
    for (let i = shift; i < STEP_COUNT; i += gap) row[i] = between(rng, 0.65, 1)
  } else if (motion === 'accelerating') {
    let position = 0, gap = between(rng, 4, 7)
    while (position < STEP_COUNT) { row[Math.floor(position)] = between(rng, 0.7, 1); position += gap; gap = Math.max(1, gap * between(rng, 0.55, 0.8)) }
  } else {
    // Short clusters and breathing gaps, with a different placement on every draw.
    for (let i = 0; i < STEP_COUNT;) {
      const hits = pick(rng, [1, 2, 3]), gap = pick(rng, [1, 2, 3, 4])
      for (let n = 0; n < hits && i < STEP_COUNT; n++, i++) row[i] = between(rng, 0.55, 1)
      i += gap
    }
  }
  return row
}

function articulate(patch: AudioPatch, criteria: LabCriteria, rng: Rng, gesture: Gesture): void {
  let motion = criteria.motion
  if (motion === 'natural') motion = criteria.type === 'pulse' ? 'pulsed'
    : gesture === 'scatter' ? 'stuttering'
      : criteria.type === 'transformation' ? pick(rng, ['accelerating', 'stuttering', 'pulsed']) : 'natural'
  const rhythmic = !['natural', 'continuous'].includes(motion)
  const row = phrase(rng, motion)
  // Gain modulation consumes bipolar values: unipolar rows never actually close the gate.
  patch.performers[0] = makePerformer({ enabled: true, bipolar: true,
    shape: rhythmic ? 'curve' : pick(rng, ['curve', 'line']), rate: motion === 'accelerating' || motion === 'collapsing' ? 1 : pick(rng, [1, 1, 2, 3]),
    target: rhythmic ? 'layers[0].gain' : 'layers[0].cutoff', depth: rhythmic ? between(rng, 0.65, 0.95) : between(rng, 0.12, 0.4),
    targetB: 'layers[0].pm', depthB: patch.layers[0]!.source.kind === 'noise' ? 0 : between(rng, 0.08, 0.38),
    patterns: Array.from({ length: SCENE_COUNT }, () => [...row]),
  })
  patch.mods[2] = makeMod({ enabled: true, shape: criteria.type === 'glitch' ? 'noise' : pick(rng, ['sine', 'triangle', 'saw']),
    rate: logBetween(rng, criteria.type === 'drone' ? 0.2 : 1.2, criteria.type === 'servo' ? 32 : 13), phase: rng(),
    target: patch.layers[0]!.source.kind === 'table' || patch.layers[0]!.source.wave === 'square' ? 'layers[0].pulseWidth' : 'layers[0].cutoff', depth: between(rng, 0.1, 0.5) })
  patch.mods[0] = makeMod({ kind: 'envelope', enabled: true, delay: between(rng, 0, 0.22), attack: between(rng, 0.02, 0.24),
    hold: between(rng, 0, 0.12), decay: between(rng, 0.15, 0.45), release: 0.1, sustain: between(rng, 0, 0.3),
    target: 'layers[1].cutoff', depth: between(rng, -0.55, 0.55) })
  if (patch.layers[2]!.enabled) {
    patch.performers[1] = makePerformer({ enabled: true, bipolar: true, shape: 'curve', rate: pick(rng, [1, 2]),
      target: 'layers[2].gain', depth: rhythmic && criteria.motion !== 'continuous' ? between(rng, 0.5, 0.9) : 0.12,
      patterns: Array.from({ length: SCENE_COUNT }, () => [...row.slice(3), ...row.slice(0, 3)]) })
  }
  for (const [i, layer] of patch.layers.entries()) {
    if (!layer.enabled) continue
    if (criteria.type === 'rise') { layer.pitch.slide = between(rng, 12, 32); layer.pitch.slideCurve = EASE_IN; layer.amp = envelope(rng, 'swell', 1 - layer.offset) }
    if (criteria.type === 'fall') { layer.pitch.slide = between(rng, -32, -14); layer.pitch.slideCurve = pick(rng, [EASE_IN, EASE_OUT]) }
    if (criteria.type === 'drone' || criteria.motion === 'continuous') {
      if (i < 2) { layer.offset = 0; layer.amp = envelope(rng, 'sustain'); layer.pitch.slide *= 0.1 }
    }
  }
}

export function buildExploration(criteria: LabCriteria, rng: Rng, seed: number, duration = 1, recentRecipes: readonly string[] = []): { patch: AudioPatch; roles: LabRole[]; recipe: string } {
  const family = FAMILIES[criteria.type as LegacyFamily]
  const bias = MATERIAL_BIAS[criteria.material as typeof LEGACY_MATERIALS[number]].filter((engine) => family.engines.includes(engine))
  const recent = recentRecipes.filter((recipe) => /^explore-v\d+\//.test(recipe) && recipe.split('/')[1] === criteria.type).slice(-2)
  const avoid = new Set(recent.map((recipe) => recipe.split('/')[2]))
  const pool = [...family.engines, ...bias]
  const available = pool.filter((engine) => !avoid.has(engine))
  // Choose before rendering: skipping a recent engine should not cost another audio render.
  const engine = pick(rng, available.length ? available : pool)
  const gesture = pick(rng, family.gestures)
  const independentMass = criteria.mass !== undefined || criteria.register !== undefined && criteria.register !== 'auto'
  const root = logBetween(rng, ...family.pitch) * (independentMass ? 1 : criteria.weight === 'heavy' ? 0.65 : criteria.weight === 'light' ? 1.9 : 1)
  const body = voice(engine, criteria, rng, Math.max(30, root), gesture)
  // The second voice either drives a real PM cascade or supplies a complementary body/texture.
  const supporting = engine === 'cascade' ? pick<Engine>(rng, ['phase', 'table', 'noise'])
    : engine === 'noise' || engine === 'comb' ? 'phase' : pick<Engine>(rng, ['noise', 'modal', 'comb', 'phase'])
  const support = voice(supporting, criteria, rng, clamp(root * pick(rng, [0.5, 1.5, 2.73, 4, 7.1]), 35, 4800), gesture)
  support.gain = between(rng, 0.16, 0.35); support.pan = between(rng, -0.3, 0.3)
  support.offset = engine === 'cascade' ? 0 : between(rng, 0, 0.22)
  support.amp = envelope(rng, gesture, 1 - support.offset)
  if (engine === 'cascade') { support.source.voices = 1; support.spread = 0.15; support.source.pmFrom = 'internal' }
  const layers = [body, support]
  const roles: LabRole[] = ['body', engine === 'cascade' ? 'mechanism' : supporting === 'phase' ? 'body' : 'texture']
  const extraCount = pick(rng, [0, 1, 1, 2, 2])
  for (let n = 0; n < extraCount; n++) {
    const role = n === 0 ? pick<LabRole>(rng, criteria.type === 'impact' || criteria.type === 'burst' ? ['attack', 'attack', 'texture'] : ['attack', 'mechanism', 'texture'])
      : pick<LabRole>(rng, ['tail', 'resonance', 'mechanism'])
    const detail = voice(role === 'attack' || role === 'texture' ? 'noise' : pick<Engine>(rng, ['modal', 'phase', 'table']), criteria, rng, logBetween(rng, 280, 3600), role === 'attack' ? 'strike' : 'phrase')
    detail.gain = between(rng, 0.08, 0.24); detail.pan = between(rng, -0.55, 0.55)
    detail.offset = role === 'attack' ? 0 : role === 'tail' ? between(rng, 0.45, 0.7) : between(rng, 0.1, 0.45)
    detail.amp = envelope(rng, role === 'attack' ? 'strike' : 'phrase', role === 'attack' ? between(rng, 0.06, 0.18) : 1 - detail.offset)
    if (role === 'attack') { detail.filterA.kind = 'highpass'; detail.filterA.cutoff = logBetween(rng, 700, 3800) }
    layers.push(detail); roles.push(role)
  }
  // Preserve an airborne exciter's role without destroying the cascade's carrier.
  materialColour(criteria.material === 'air' ? support : chance(rng, 0.65) ? body : support, criteria, rng)
  const patch = makePatch(1, layers, {
    x: { kind: pick(rng, ['off', 'flanger', 'chorus', 'phaser', 'widener']), mix: between(rng, 0.08, 0.3), rate: logBetween(rng, 0.12, 4), depth: between(rng, 0.15, 0.65), feedback: between(rng, 0.1, 0.48) },
    y: { kind: chance(rng, 0.4) ? 'delay' : 'off', mode: 'send', time: logBetween(rng, 0.018, 0.2), mix: between(rng, 0.06, 0.2), feedback: between(rng, 0.12, 0.42) },
    z: { kind: chance(rng, 0.48) ? 'reverb' : 'off', mode: 'send', mix: between(rng, 0.06, 0.2), size: between(rng, 0.12, 0.38), damping: between(rng, 0.25, 0.7) },
    width: between(rng, 0.35, 0.85), tone: between(rng, -0.18, 0.15),
  }, { gain: 0.7, limiter: 0.45, fadeOut: 0.045 }, seed % 10000)
  characterColour(patch, criteria, rng)
  articulate(patch, criteria, rng, gesture)
  const wiring = connectExploration(patch, roles, rng)
  const arrangement = composeExploration(patch, roles, criteria, rng, duration)
  const selected = hasSelections(criteria)
  if (selected || criteria.motion !== 'natural') applySearchDesign(patch, roles, criteria, seed)
  return { patch, roles: patch.layers.map((l, i) => l.enabled ? roles[i]! : 'unknown'),
    recipe: `explore-v${selected ? 4 : 3}/${criteria.type}/${engine}/${gesture}/${arrangement}${selected ? `:${criteria.gesture ?? 'auto'}` : ''}/${wiring}` }
}
