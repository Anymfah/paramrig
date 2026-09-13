import { EASE_IN, EASE_OUT, LINEAR } from '@paramrig/audio/curves'
import { makeLayer, makeMod } from '@paramrig/audio'
import { between, chance, clamp, logBetween, pick } from '../shuffle-draw'
import type { AmpSettings, AudioPatch, BodyProfile, Layer } from '@paramrig/audio'
import type { LabCriteria } from './model'
import type { LabMaterial, SoundBehaviour, SynthesisEngine } from './catalog'

type Rng = () => number
export function discoveryEnvelope(behaviour: SoundBehaviour, rng: Rng): AmpSettings {
  if (behaviour === 'strike') return { attack: between(rng, 0.001, 0.008), hold: between(rng, 0, 0.025), decay: between(rng, 0.08, 0.42), sustain: 0, release: between(rng, 0.08, 0.26), curve: between(rng, 1.3, 3) }
  if (behaviour === 'swell' || behaviour === 'sweep') return { attack: between(rng, 0.22, 0.48), hold: 0.05, decay: 0.16, sustain: 0.6, release: 0.22, curve: between(rng, 0.8, 1.7) }
  return { attack: between(rng, 0.015, 0.07), hold: 0.5, decay: 0.12, sustain: 0.82, release: 0.17, curve: 1.2 }
}

export function discoveryVoice(engine: SynthesisEngine, root: number, behaviour: SoundBehaviour, rng: Rng, pitched: boolean): Layer {
  const layer = makeLayer({ gain: between(rng, 0.36, 0.58), pan: 0, spread: between(rng, 0.15, 0.7),
    source: { kind: 'tone', wave: 'sine', fmIndex: 0, fmRatio: 1, voices: 1, detune: 0, pmFrom: 'internal' },
    pitch: { start: root, slide: pitched ? 0 : between(rng, -4, 4), slideCurve: EASE_OUT },
    amp: discoveryEnvelope(behaviour, rng),
    filterA: { kind: 'lowpass', cutoff: clamp(root * logBetween(rng, 5, 32), 500, 14000), resonance: between(rng, 0.04, 0.24), envAmount: 0 },
  })
  if (engine === 'subtractive') {
    layer.source.wave = pick(rng, ['saw', 'square', 'triangle'])
    layer.source.pulseWidth = between(rng, 0.2, 0.75)
    layer.source.voices = pick(rng, [1, 2, 3, 5]); layer.source.detune = between(rng, 3, 20)
    layer.filterA.kind = pick(rng, ['lowpass', 'ladder', 'bandpass'])
    if (layer.filterA.kind === 'bandpass') layer.filterA.cutoff = clamp(root * logBetween(rng, 1, layer.source.wave === 'triangle' ? 3 : 6), 160, 6500)
    layer.filterA.envAmount = between(rng, -1.5, 2.2)
  } else if (engine === 'fm' || engine === 'cascade') {
    layer.source.wave = chance(rng, 0.8) ? 'sine' : 'triangle'
    layer.source.fmRatio = pick(rng, pitched ? [0.5, 1, 2, 3, 4] : [0.5, 1.413, 2, 2.73, 3.17, 5.09, 7.13])
    layer.source.fmIndex = logBetween(rng, 0.25, pitched ? 3 : 6)
    layer.source.fmFall = between(rng, 0.2, 0.95)
    if (engine === 'cascade') layer.source.pmFrom = 'layer1'
  } else if (engine === 'wavetable' || engine === 'vocal') {
    layer.source.kind = 'table'
    layer.source.table = pick(rng, engine === 'vocal' ? ['formant', 'growl', 'serpent'] : ['sweep', 'pulse', 'bell', 'stack', 'fold', 'glass', 'titan', 'prism', 'gate', 'ion'])
    layer.source.position = between(rng, 0.05, 0.92)
    layer.source.voices = pick(rng, [1, 2, 3, 5]); layer.source.detune = between(rng, 2, 24)
    if (engine === 'vocal') {
      // Sparse high-register harmonics cannot excite a low speech-formant bank reliably.
      layer.filterA.kind = root > 1200 ? 'bandpass' : 'formant'
      layer.filterA.cutoff = root > 1200 ? clamp(root * 1.25, 1500, 7500) : logBetween(rng, 300, 1900)
      layer.filterA.resonance = 0.3
    }
  } else if (engine === 'comb') {
    layer.source.kind = chance(rng, 0.7) ? 'noise' : 'tone'; layer.source.colour = 'pink'
    layer.source.wave = 'triangle'
    layer.insertB = { ...layer.insertB, kind: 'comb', place: 'post', time: clamp(1 / root, 0.0001, 0.035), feedback: between(rng, 0.64, 0.9), amount: between(rng, 0.5, 0.8) }
    if (behaviour === 'strike') layer.amp = { ...layer.amp, hold: 0, decay: between(rng, 0.015, 0.05), release: 0.015 }
  } else if (engine === 'modal') {
    layer.source.kind = chance(rng, 0.65) ? 'noise' : 'tone'; layer.source.colour = pick(rng, ['white', 'pink', 'metallic'])
    body(layer, rng, pick(rng, ['bar', 'plate', 'cavity', 'glass', 'membrane']), root * (pitched ? 1 : logBetween(rng, 1, 5)), between(rng, 0.12, 0.6))
    if (behaviour === 'strike') layer.amp = { ...layer.amp, hold: 0, decay: 0.04, release: 0.018 }
  } else if (engine === 'noise') {
    layer.source.kind = 'noise'; layer.source.colour = pick(rng, ['pink', 'white', 'metallic'])
    layer.filterA.kind = pick(rng, ['bandpass', 'highpass', 'lowpass'])
    layer.filterA.cutoff = logBetween(rng, 250, 7000)
    layer.filterA.envAmount = between(rng, -2, 2)
  } else if (engine === 'membrane') {
    layer.source.fmRatio = pick(rng, [0.5, 1, 1.59]); layer.source.fmIndex = between(rng, 0.05, 1.2); layer.source.fmFall = 0.95
    layer.pitch.slide = pitched ? 0 : between(rng, -8, -22)
    body(layer, rng, 'membrane', root, between(rng, 0.06, 0.3))
    layer.filterA.cutoff = clamp(root * 8, 400, 5000)
  } else {
    // Additive constructions use independent sine/triangle partials in the other layers.
    layer.source.wave = chance(rng, 0.75) ? 'sine' : 'triangle'
    layer.filterA.kind = 'off'
  }
  if (chance(rng, 0.35) && !['additive', 'noise', 'modal', 'membrane'].includes(engine)) layer.insertA = { ...layer.insertA, kind: chance(rng, 0.7) ? 'drive' : 'fold', amount: between(rng, 0.06, 0.25), drive: between(rng, 0.08, 0.3) }
  return layer
}

function body(layer: Layer, rng: Rng, profile: BodyProfile, frequency: number, decay: number): void {
  layer.insertC = { ...layer.insertC, kind: 'body', place: 'post', profile, frequency: clamp(frequency, 50, 9000), decay,
    partials: pick(rng, [3, 4, 5, 6]), spread: between(rng, 0.15, 0.7), character: between(rng, 0.15, 0.65), amount: between(rng, 0.18, 0.4) }
}

/** Material colours one featured layer, leaving the remaining source graph free to vary. */
export function colourDiscoveryMaterial(patch: AudioPatch, material: LabMaterial, rng: Rng, featured: number): void {
  const layer = patch.layers[featured]!, root = layer.pitch.start
  if (material === 'metal') {
    body(layer, rng, pick(rng, ['plate', 'bar', 'cavity']), root * logBetween(rng, 1.5, 7), between(rng, 0.1, 0.5))
    if (layer.source.kind === 'noise') layer.source.colour = 'metallic'
  } else if (material === 'glass' || material === 'ceramic' || material === 'ice') {
    body(layer, rng, 'glass', logBetween(rng, material === 'ceramic' ? 700 : 1400, 6000), material === 'glass' ? between(rng, 0.3, 0.7) : between(rng, 0.05, 0.22))
    layer.insertC.spread = material === 'ice' ? 0.82 : material === 'ceramic' ? 0.3 : 0.55
    layer.insertC.partials = material === 'ceramic' ? 3 : 6
    if (layer.filterA.kind === 'lowpass' || layer.filterA.kind === 'ladder') layer.filterA.cutoff = Math.max(layer.filterA.cutoff, 4000)
    if (material === 'ice') { layer.pitch.jitter = between(rng, 15, 40); layer.source.fmIndex = between(rng, 0.6, 2) }
  } else if (material === 'wood') {
    body(layer, rng, pick(rng, ['bar', 'cavity']), logBetween(rng, 180, 1500), between(rng, 0.025, 0.14))
    layer.insertC.partials = 3; layer.insertC.spread = 0.26; layer.insertC.character = 0.12
    layer.filterA.kind = 'lowpass'; layer.filterA.cutoff = logBetween(rng, 1200, 4200); layer.filterA.resonance = 0.08
  } else if (material === 'stone') {
    body(layer, rng, 'cavity', logBetween(rng, 120, 900), between(rng, 0.025, 0.09))
    layer.insertC.character = 0.8; layer.insertC.spread = 0.75
    layer.source.kind = 'noise'; layer.source.colour = 'pink'; layer.source.pmFrom = 'internal'
    layer.filterA.kind = 'lowpass'; layer.filterA.cutoff = logBetween(rng, 900, 2800)
  } else if (material === 'membrane') {
    body(layer, rng, 'membrane', clamp(root, 65, 700), between(rng, 0.08, 0.32))
    layer.source.kind = 'tone'; layer.source.wave = 'sine'; layer.source.fmRatio = 1.59; layer.source.fmIndex = between(rng, 0.1, 0.8)
  } else if (material === 'rubber') {
    layer.filterA.kind = 'bandpass'; layer.filterA.cutoff = logBetween(rng, 250, 1200); layer.filterA.resonance = 0.5
    layer.pitch.vibratoRate = between(rng, 3, 10); layer.pitch.vibratoDepth = between(rng, 0.5, 2)
    layer.pitch.slide = between(rng, -12, 9); layer.pitch.slideCurve = EASE_IN
    layer.insertC.kind = 'off'
  } else if (material === 'liquid') {
    layer.filterA.kind = pick(rng, ['formant', 'comb', 'bandpass']); layer.filterA.cutoff = logBetween(rng, 350, 2200)
    layer.filterA.resonance = between(rng, 0.3, 0.6); layer.filterA.envAmount = between(rng, -3, 3)
    layer.pitch.vibratoRate = between(rng, 5, 17); layer.pitch.vibratoDepth = between(rng, 0.2, 1)
    layer.insertB = { ...layer.insertB, kind: 'comb', amount: 0.32, time: logBetween(rng, 0.0005, 0.008), feedback: between(rng, 0.3, 0.65) }
  } else if (material === 'electrical') {
    layer.source.fmRatio = pick(rng, [1.413, 2.73, 5.09]); layer.source.fmIndex = between(rng, 1, 4)
    layer.insertA = { ...layer.insertA, kind: pick(rng, ['ring', 'crusher']), amount: between(rng, 0.18, 0.45), ratio: 3.17, bitDepth: pick(rng, [5, 7, 10]), crush: 0.15 }
  } else if (material !== 'any') {
    // Air, sand, fabric and fire have different excitation bands and fluctuation speeds.
    layer.source.kind = 'noise'; layer.source.pmFrom = 'internal'; layer.source.colour = material === 'sand' ? 'white' : 'pink'
    layer.filterA.kind = material === 'sand' ? 'highpass' : material === 'fire' ? 'lowpass' : 'bandpass'
    layer.filterA.cutoff = material === 'sand' ? logBetween(rng, 2500, 7000) : material === 'fabric' ? logBetween(rng, 350, 1800) : material === 'fire' ? logBetween(rng, 250, 1200) : logBetween(rng, 1500, 6000)
    layer.filterA.resonance = material === 'air' ? 0.25 : 0.07
    layer.insertA.kind = 'off'; layer.insertC.kind = 'off'
    patch.mods[5] = makeMod({ enabled: true, shape: material === 'air' ? 'sine' : 'noise', target: `layers[${featured}].gain`,
      rate: material === 'sand' ? between(rng, 23, 38) : material === 'fire' ? between(rng, 12, 30) : between(rng, 1, 8), depth: material === 'fabric' ? 0.25 : 0.6 })
  }
}

export function colourDiscoveryCharacter(patch: AudioPatch, criteria: LabCriteria, rng: Rng): void {
  const character = criteria.character
  for (const layer of patch.layers.filter((l) => l.enabled)) {
    if (character === 'acoustic') {
      layer.source.voices = 1; layer.source.detune = 0; layer.pitch.jitter = between(rng, 2, 7)
      layer.source.fmIndex *= 0.25
      for (const insert of [layer.insertA, layer.insertB, layer.insertC]) if (['drive', 'fold', 'crusher', 'ring'].includes(insert.kind)) insert.kind = 'off'
    } else if (character === 'analog') {
      layer.pitch.jitter = between(rng, 4, 13); layer.pitch.vibratoRate = between(rng, 0.3, 2); layer.pitch.vibratoDepth = between(rng, 0.025, 0.12)
      layer.insertA = { ...layer.insertA, kind: 'drive', drive: between(rng, 0.08, 0.22), amount: 0.2 }
      layer.filterA.kind = layer.filterA.kind === 'lowpass' ? 'ladder' : layer.filterA.kind
    } else if (character === 'digital' || character === 'retro') {
      layer.pitch.jitter = 0; layer.source.detune = 0; layer.source.voices = 1
      layer.source.fmRatio = Math.max(1, Math.round(layer.source.fmRatio))
      if (character === 'retro') {
        if (layer.source.kind === 'tone') layer.source.wave = pick(rng, ['square', 'triangle'])
        layer.insertA = { ...layer.insertA, kind: 'crusher', bitDepth: pick(rng, [5, 6, 8]), crush: between(rng, 0.12, 0.45), amount: 0.45 }
        layer.pitch.slideCurve = LINEAR
      } else if (chance(rng, 0.5)) layer.insertA = { ...layer.insertA, kind: 'crusher', bitDepth: 12, crush: 0.06, amount: 0.15 }
    } else if (character === 'ethereal') {
      layer.source.detune = between(rng, 8, 22); layer.source.voices = layer.source.kind === 'noise' ? 1 : 3
      layer.amp.attack = Math.max(layer.amp.attack, 0.12); layer.amp.release = Math.max(layer.amp.release, 0.25)
      layer.source.fmIndex *= 0.35; layer.spread = 0.8
    } else if (character === 'corrupted') {
      layer.insertA = { ...layer.insertA, kind: pick(rng, ['crusher', 'fold']), amount: between(rng, 0.25, 0.6), drive: 0.4, bitDepth: pick(rng, [4, 6, 9]), crush: between(rng, 0.1, 0.55) }
      layer.pitch.jitter = between(rng, 12, 40)
    } else if (character === 'clean') {
      layer.pitch.jitter = 0; layer.source.fmRatio = Math.max(1, Math.round(layer.source.fmRatio)); layer.source.fmIndex = Math.min(layer.source.fmIndex, 0.7)
      for (const insert of [layer.insertA, layer.insertB, layer.insertC]) if (['drive', 'fold', 'crusher'].includes(insert.kind)) insert.kind = 'off'
    } else if (character === 'mechanical') {
      layer.pitch.jitter = between(rng, 2, 15); layer.pitch.arpeggioRatio = pick(rng, [0.5, 1.5, 2]); layer.pitch.arpeggioAt = between(rng, 0.3, 0.7)
    } else if (character === 'organic') {
      layer.pitch.vibratoRate = between(rng, 2, 6); layer.pitch.vibratoDepth = between(rng, 0.08, 0.3); layer.source.fmIndex *= 0.6
    } else if (character === 'alien') {
      layer.source.fmRatio *= pick(rng, [0.707, 1.413, 1.618]); layer.pitch.vibratoDepth = between(rng, 0.25, 1.1); layer.pitch.vibratoRate = between(rng, 0.5, 12)
    } else if (character === 'industrial') {
      layer.insertA = { ...layer.insertA, kind: 'drive', amount: 0.38, drive: between(rng, 0.25, 0.5) }
    } else if (character === 'futuristic') {
      layer.source.detune = between(rng, 12, 32); layer.source.voices = layer.source.kind === 'noise' ? 1 : pick(rng, [2, 3])
      if (layer.insertA.kind === 'off') layer.insertA = { ...layer.insertA, kind: 'ring', ratio: 1.413, amount: 0.1 }
    }
  }
  if (character === 'ethereal') patch.fx.x = { ...patch.fx.x, kind: 'chorus', mix: 0.24, rate: 0.3, depth: 0.55 }
  if (character === 'corrupted') patch.mods[6] = makeMod({ enabled: true, target: 'layers[0].gain', shape: 'noise', rate: between(rng, 8, 35), depth: 0.55 })
  if (character === 'clean' || character === 'acoustic') for (const key of ['x', 'y', 'z'] as const) patch.fx[key].mix *= 0.35
}
