import { EASE_IN, EASE_OUT } from '@paramrig/audio/curves'
import { SCENE_COUNT, STEP_COUNT } from '@paramrig/audio/fields'
import { makeMod, makePerformer } from '@paramrig/audio'
import { between, clamp, logBetween, pick } from '../shuffle-draw'
import type { AudioPatch, BodyProfile, Layer } from '@paramrig/audio'
import type { LabCriteria, LabRole } from './model'
import { discoveryVoice } from './discovery-voices'
import { SUBTYPE_DEFINITIONS, type LabSubtype } from './subtypes'
import type { SynthesisEngine } from './catalog'
import { isDetailSubtype } from './detail-catalog'
import { buildDetailIdentity, articulateDetailIdentity } from './detail-identity'

type Rng = () => number
const familyOf = (id: LabSubtype) => SUBTYPE_DEFINITIONS[id].family
const lowpass = (layer: Layer, cutoff: number) => { layer.filterA.kind = 'lowpass'; layer.filterA.cutoff = clamp(cutoff, 100, 14000); layer.filterA.envAmount = 0 }
const band = (layer: Layer, cutoff: number, resonance = 0.2) => { layer.filterA.kind = 'bandpass'; layer.filterA.cutoff = clamp(cutoff, 100, 9000); layer.filterA.resonance = resonance; layer.filterA.envAmount = 0 }
function resonate(layer: Layer, profile: BodyProfile, frequency: number, decay: number): void {
  layer.insertC = { ...layer.insertC, kind: 'body', place: 'post', profile, frequency: clamp(frequency, 50, 9000),
    partials: 5, spread: 0.48, decay, character: 0.25, amount: 0.24 }
}
function tonal(layer: Layer, wave: 'sine' | 'triangle' | 'square' | 'saw'): void {
  if (layer.source.kind === 'noise') { layer.source.kind = 'tone'; layer.source.wave = wave }
}

/** Design the excitation before material, character and user selections are applied. */
export function buildFamilyIdentity(patch: AudioPatch, roles: LabRole[], subtype: LabSubtype, rng: Rng): void {
  if (isDetailSubtype(subtype)) { buildDetailIdentity(patch, roles, subtype, rng); return }
  const family = familyOf(subtype), main = patch.layers[0]!, root = main.pitch.start
  // Layer 1 remains the material/texture voice. A separate layer carries the defining accompaniment.
  const support = (engine: SynthesisEngine, ratio: number, gain: number, role: LabRole = 'texture') => {
    const layer = discoveryVoice(engine, clamp(root * ratio, 30, 7800), 'sustain', rng, true)
    layer.gain = gain; layer.pan = between(rng, -0.32, 0.32); layer.offset = 0
    patch.layers[2] = layer; roles[2] = role
    return layer
  }
  if (family === 'explosion' || subtype === 'thunder') {
    lowpass(main, subtype === 'muffled-blast' ? 500 : subtype === 'detonation' ? 3800 : 1400)
    const air = support('noise', 2, 0.3, 'tail'); air.source.colour = 'pink'
    lowpass(air, subtype === 'muffled-blast' ? 700 : subtype === 'thunder' ? 900 : between(rng, 2400, 5500))
    main.pitch.slide = -between(rng, 12, 28)
    if (main.source.kind !== 'noise') main.source.fmFall = 0.95
    if (subtype === 'thunder') resonate(main, 'cavity', root, 0.45)
    patch.fx.width = 0.55
  } else if (family === 'engine') {
    tonal(main, subtype === 'electric-motor' ? 'triangle' : 'saw')
    if (main.source.kind === 'tone') main.source.wave = subtype === 'electric-motor' ? 'sine' : subtype === 'turbine' ? 'saw' : 'square'
    if (main.source.kind === 'table') main.source.table = subtype === 'electric-motor' ? 'ion' : subtype === 'turbine' ? 'stack' : 'pulse'
    main.source.pulseWidth = subtype === 'combustion' || subtype === 'ignition' ? between(rng, 0.12, 0.24) : 0.5
    main.source.voices = 1; main.source.detune = 0
    main.source.fmRatio = subtype === 'turbine' ? 7 : subtype === 'electric-motor' ? 4 : 1
    main.source.fmIndex = between(rng, 0.2, subtype === 'electric-motor' ? 1.2 : 2.5)
    main.source.fmFall = 0
    lowpass(main, root * (subtype === 'turbine' ? 28 : subtype === 'electric-motor' ? 8 : 16))
    const exhaust = support(subtype === 'electric-motor' ? 'additive' : 'noise', subtype === 'turbine' ? 8 : 4, subtype === 'electric-motor' ? 0.12 : 0.23)
    if (subtype === 'electric-motor') exhaust.source.wave = 'sine'
    else { exhaust.source.colour = 'pink'; band(exhaust, subtype === 'turbine' ? 3200 : 450, 0.1) }
  } else if (family === 'spring') {
    main.source.fmRatio = subtype === 'coil' ? 2.73 : subtype === 'twang' ? 2 : 1.5
    main.source.fmIndex = between(rng, 0.3, 2.2); main.source.fmFall = 0.85
    resonate(main, subtype === 'coil' ? 'bar' : 'membrane', root * (subtype === 'coil' ? 2.73 : 1), 0.35)
    const ring = support('fm', subtype === 'coil' ? 3.17 : 2, 0.16, 'resonance')
    ring.source.fmRatio = subtype === 'coil' ? 1.413 : 1; ring.source.fmFall = 0.9
  } else if (family === 'creak') {
    tonal(main, 'saw')
    main.source.fmRatio = subtype === 'hinge' ? 3.17 : 1.413; main.source.fmIndex = between(rng, 0.4, 2)
    band(main, root * (subtype === 'hinge' ? 4 : 2), 0.38)
    resonate(main, subtype === 'wood-stress' ? 'bar' : 'plate', root * 2.1, subtype === 'hull-stress' ? 0.4 : 0.12)
    const slip = support('noise', 3, 0.16); slip.source.colour = 'pink'
    band(slip, subtype === 'wood-stress' ? 800 : 2400)
  } else if (family === 'tear') {
    const fibres = support('noise', 4, 0.32); fibres.source.colour = subtype === 'fabric-rip' ? 'pink' : 'white'
    band(fibres, subtype === 'fabric-rip' ? 1300 : subtype === 'paper-rip' ? 3800 : 2600, 0.08)
    if (subtype === 'metal-rip') { resonate(main, 'plate', root * 3.17, 0.3); main.source.fmRatio = 2.73 }
    else {
      main.source.kind = 'noise'; main.source.pmFrom = 'internal'; main.source.colour = subtype === 'fabric-rip' ? 'pink' : 'white'
      lowpass(main, subtype === 'fabric-rip' ? 1800 : 5200)
    }
  } else if (family === 'pressure') {
    const jet = support('noise', 3, 0.34); jet.source.colour = subtype === 'steam' ? 'white' : 'pink'
    band(jet, subtype === 'steam' ? 4200 : subtype === 'suction' ? 900 : 2400, subtype === 'suction' ? 0.45 : 0.15)
    band(main, main.source.kind === 'noise' ? 1000 : root * 2, 0.25)
    if (subtype === 'suction') resonate(main, 'cavity', root * 1.5, 0.12)
  } else if (family === 'bowed') {
    if (subtype === 'rubbed-glass') {
      tonal(main, 'sine'); main.source.fmIndex = 0.15
      resonate(main, 'glass', root, 0.6); lowpass(main, root * 5)
    } else {
      tonal(main, 'saw'); lowpass(main, root * (subtype === 'abrasive-bow' ? 24 : 12))
      if (main.source.kind === 'tone') main.source.wave = subtype === 'abrasive-bow' ? 'saw' : 'triangle'
      if (subtype === 'abrasive-bow') main.insertA = { ...main.insertA, kind: 'ring', ratio: 0.5, amount: 0.22 }
      resonate(main, subtype === 'abrasive-bow' ? 'plate' : 'bar', root * 2, 0.2)
    }
    const bow = support('noise', 2, subtype === 'abrasive-bow' ? 0.3 : 0.07)
    bow.source.colour = 'pink'; band(bow, root * 5, 0.12)
  } else if (family === 'wind-instrument') {
    tonal(main, subtype === 'flute' ? 'sine' : subtype === 'reed' ? 'square' : 'saw')
    if (main.source.kind === 'tone') main.source.wave = subtype === 'flute' ? pick(rng, ['sine', 'triangle']) : subtype === 'reed' ? 'square' : 'saw'
    main.source.fmRatio = subtype === 'reed' ? 2 : 1; main.source.fmIndex = subtype === 'flute' ? 0.15 : subtype === 'brass' ? 1.2 : 0.45
    main.source.voices = 1; main.source.detune = 0
    lowpass(main, root * (subtype === 'flute' ? 4 : subtype === 'reed' ? 10 : 18))
    const air = support(subtype === 'reed' ? 'additive' : 'noise', 3, subtype === 'reed' ? 0.18 : subtype === 'flute' ? 0.12 : 0.055)
    if (subtype === 'reed') air.source.wave = 'triangle'
    else { air.source.colour = 'pink'; band(air, root * 6, 0.1) }
  } else if (family === 'choir') {
    tonal(main, 'saw'); main.filterA.kind = 'formant'; main.filterA.cutoff = logBetween(rng, 450, 1500); main.filterA.resonance = 0.3
    if (main.source.kind === 'table') main.source.table = 'formant'
    main.source.voices = subtype === 'robot-choir' ? 1 : 3; main.source.detune = subtype === 'robot-choir' ? 0 : between(rng, 5, 14)
    const voice = support(subtype === 'whisper-choir' ? 'noise' : 'vocal', 2, subtype === 'whisper-choir' ? 0.2 : 0.16, 'resonance')
    voice.filterA.kind = 'formant'; voice.filterA.cutoff = logBetween(rng, 700, 1900); voice.filterA.resonance = 0.25
  } else if (subtype === 'surf' || subtype === 'stream') {
    const flow = support('noise', 2, 0.34); flow.source.colour = 'pink'; lowpass(flow, subtype === 'surf' ? 5200 : 2700)
    main.filterA.envAmount = subtype === 'surf' ? 2.5 : 0.4
    if (subtype === 'stream') { main.source.fmRatio = 1.413; main.source.fmIndex = 1.2; main.pitch.vibratoDepth = 0.4; main.pitch.vibratoRate = 13 }
  } else if (subtype === 'insects') {
    tonal(main, 'square'); main.source.fmRatio = 5; main.source.fmIndex = 1.3
    main.pitch.start = clamp(root * 12, 1500, 4200); band(main, main.pitch.start * 1.5)
    const swarm = support('fm', 16, 0.19); swarm.pitch.start = clamp(root * 16, 2200, 6000)
    swarm.source.fmRatio = 3; swarm.source.fmIndex = 1.1; band(swarm, swarm.pitch.start)
  } else if (family === 'percussion') {
    if (subtype === 'tom') {
      tonal(main, 'sine'); main.pitch.start = clamp(root, 80, 280); main.source.fmIndex = 0.3; main.source.fmFall = 0.95
      resonate(main, 'membrane', main.pitch.start, 0.22); lowpass(main, 2400)
      const skin = support('noise', 2, 0.09, 'attack'); lowpass(skin, 2200)
    } else if (subtype === 'gong') {
      main.source.fmRatio = 1.413; main.source.fmIndex = 2.3; main.source.fmFall = 0.35
      resonate(main, 'plate', root, 0.65)
      const bloom = support('fm', 2.73, 0.18, 'resonance'); bloom.source.fmRatio = 1.413; bloom.source.fmIndex = 1.8
    } else {
      const grains = support('noise', 3, subtype === 'cymbal' ? 0.28 : 0.36, subtype === 'clap' ? 'attack' : 'texture')
      grains.source.colour = subtype === 'cymbal' ? 'metallic' : 'white'
      if (subtype === 'clap') { band(grains, 1600, 0.12); band(main, Math.max(root, 900), 0.15) }
      else { grains.filterA.kind = 'highpass'; grains.filterA.cutoff = subtype === 'cymbal' ? 3600 : 2200; lowpass(main, 7000) }
      if (subtype === 'cymbal') resonate(main, 'plate', Math.max(root * 4, 1800), 0.48)
    }
  } else if (subtype === 'organ') {
    tonal(main, 'sine'); main.source.fmIndex = 0; main.source.voices = 1; main.source.detune = 0
    lowpass(main, root * 12)
    const drawbar = support('additive', pick(rng, [2, 3, 4, 6]), 0.25, 'resonance'); drawbar.source.wave = 'sine'
  } else if (subtype === 'electric-piano') {
    tonal(main, 'sine'); main.source.fmRatio = 1; main.source.fmIndex = between(rng, 0.7, 2.2); main.source.fmFall = 0.92
    lowpass(main, root * 14)
    const tine = support('fm', 3, 0.15, 'resonance'); tine.source.fmRatio = 4; tine.source.fmIndex = 0.7; tine.source.fmFall = 0.95
  } else if (subtype === 'harp') {
    tonal(main, 'triangle'); main.source.fmIndex = 0.3
    main.insertB = { ...main.insertB, kind: 'comb', place: 'post', time: clamp(1 / root, 0.0001, 0.035), feedback: 0.82, amount: 0.38 }
    const string = support('additive', 2, 0.16, 'resonance'); string.source.wave = 'triangle'
  } else {
    // Fantasy profiles are arrangements of existing excitation and resonances, not new DSP engines.
    const halo = support(subtype === 'apparition' ? 'vocal' : 'fm', subtype === 'portal' ? 1.5 : 4, 0.2, 'tail')
    halo.source.fmRatio = subtype === 'spell' ? 3.17 : 2; halo.source.fmIndex = between(rng, 0.25, 1.3)
    resonate(halo, subtype === 'portal' ? 'aether' : 'glass', root * 4, 0.42)
    if (subtype === 'apparition') { main.filterA.kind = 'formant'; main.filterA.cutoff = 750 }
    if (subtype === 'enchantment') { tonal(main, 'triangle'); main.source.fmIndex *= 0.35 }
  }
}

/** Family evolution overlays the requested gesture, then intensity/mass still have the final say. */
export function articulateFamilyIdentity(patch: AudioPatch, roles: LabRole[], subtype: LabSubtype, criteria: LabCriteria, rng: Rng): void {
  if (isDetailSubtype(subtype)) { articulateDetailIdentity(patch, subtype, criteria, rng); return }
  const family = familyOf(subtype), main = patch.layers[0]!
  const explicit = criteria.gesture !== undefined && criteria.gesture !== 'auto'
  const continuous = criteria.motion === 'continuous'
  const density = criteria.density ?? between(rng, 0.35, 0.75)
  const cycles = 3 + Math.round(density * 7), pivot = between(rng, 0.52, 0.72)
  const slips = Array.from({ length: cycles }, (_, i) => (i + between(rng, 0.08, 0.8)) / cycles)
  const bump = (t: number, at: number, width: number) => Math.exp(-Math.pow((t - at) / width, 2) * 2)
  const decay = (t: number, rate: number) => Math.exp(-t * rate)
  function contour(t: number, lane: number): number {
    if (family === 'explosion') return lane === 2 ? (1 - decay(t, 32)) * decay(t, subtype === 'detonation' ? 11 : 3.6)
      : decay(t, subtype === 'detonation' ? 18 : subtype === 'muffled-blast' ? 6 : 9)
    if (subtype === 'thunder') return 0.3 * decay(t, 2) + slips.slice(0, 4).reduce((sum, at) => sum + bump(t, at * 0.65, 0.13), 0) * 0.4
    if (family === 'engine') {
      if (subtype === 'ignition') return t < pivot ? 0.12 + 0.7 * Math.max(0, Math.cos(t * cycles * Math.PI * 2)) ** 4 : 0.9
      return subtype === 'turbine' ? 0.3 + 0.7 * Math.sin(Math.PI * t * 0.7) : 0.82 + 0.18 * Math.sin(t * cycles * Math.PI * 2)
    }
    if (family === 'spring') return decay(t, subtype === 'twang' ? 5 : 3.4) * (0.7 + 0.3 * Math.cos(t * cycles * Math.PI * 2))
    if (family === 'creak' || family === 'tear') {
      const width = subtype === 'hinge' ? 0.025 : subtype === 'hull-stress' ? 0.13 : subtype === 'fabric-rip' ? 0.065 : family === 'creak' ? 0.055 : 0.028
      const friction = slips.reduce((sum, at) => sum + bump(t, subtype === 'paper-rip' ? Math.sqrt(at) : at, width), 0)
      return (0.15 + friction * 0.8) * (family === 'tear' ? 0.35 + 0.65 * t : 0.5 + 0.5 * Math.sin(Math.PI * t))
    }
    if (family === 'pressure') return subtype === 'valve' ? (0.2 + 0.8 * (1 - decay(t, 80))) * decay(t, 4)
      : subtype === 'suction' ? 0.12 + 0.88 * bump(t, 0.7, 0.25) : 0.5 + 0.5 * Math.sin(Math.PI * t)
    if (subtype === 'clap') return [0, 0.035, 0.07].reduce((sum, at) => sum + (t >= at ? decay(t - at, lane === 2 ? 32 : 15) : 0), 0) / 2
    if (subtype === 'cymbal') return decay(t, 3.8)
    if (subtype === 'gong') return lane === 2 ? (1 - decay(t, 9)) * decay(t, 2.5) : decay(t, 3)
    if (subtype === 'tom') return decay(t, lane === 2 ? 28 : 7)
    if (subtype === 'shaker') return (0.2 + 0.8 * Math.sin(Math.PI * t) ** 2) * (0.1 + 0.9 * Math.cos(t * cycles * Math.PI) ** 4)
    if (subtype === 'surf') return t < pivot ? 0.08 + 0.92 * (t / pivot) ** 1.3 : decay((t - pivot) / (1 - pivot), 2.8)
    if (subtype === 'stream') return 0.78 + 0.22 * Math.sin(t * cycles * Math.PI * 2 + lane)
    if (subtype === 'insects') return 0.08 + 0.92 * Math.max(0, Math.sin(t * (cycles + lane * 2) * Math.PI)) ** 3
    if (subtype === 'electric-piano' || subtype === 'harp') return decay(t, lane === 2 ? 8 : 4.2)
    if (subtype === 'portal') return t < pivot ? 0.1 + 0.8 * (t / pivot) ** 2 : 0.65 + 0.2 * Math.cos(t * cycles * Math.PI)
    if (subtype === 'spell') return lane === 2 ? slips.reduce((sum, at) => sum + bump(t, at, 0.045), 0) * (1 - t) : decay(t, 7)
    if (subtype === 'apparition') return Math.sin(Math.PI * t) ** 1.7
    if (subtype === 'enchantment') return lane === 2 ? 0.1 + slips.reduce((sum, at) => sum + bump(t, at, 0.065), 0) * 0.6 : 0.75
    if (subtype === 'robot-choir') return 0.25 + 0.75 * Math.max(0, Math.cos(t * 3 * Math.PI)) ** 2
    if (subtype === 'whisper-choir') return 0.18 + 0.82 * Math.sin(Math.PI * t) ** 2
    if (subtype === 'brass') return 0.2 + 0.8 * Math.min(1, t * 4) ** 1.7
    return subtype === 'organ' ? 0.96 : 0.65 + 0.35 * Math.sin(Math.PI * t)
  }
  // Three performer lanes can independently shape body, selected texture and accompaniment.
  for (let lane = 0; lane < 3; lane++) {
    const existing = patch.performers[lane]!.patterns[patch.scene]!
    const row = Array.from({ length: STEP_COUNT }, (_, i) => {
      const t = i / (STEP_COUNT - 1), identity = clamp(contour(t, lane), 0, 1)
      return clamp(explicit ? existing[i]!
        : (continuous ? 0.65 + identity * 0.35 : identity) * (criteria.motion !== 'natural' && !continuous ? 0.4 + existing[i]! * 0.6 : 1), 0, 1)
    })
    patch.performers[lane] = makePerformer({ enabled: true, bipolar: true, shape: 'curve', rate: (STEP_COUNT - 1) / STEP_COUNT,
      target: `layers[${lane}].gain`, depth: 1, ...(lane === 2 && patch.layers[3]!.enabled ? { targetB: 'layers[3].gain', depthB: 0.7 } : {}),
      patterns: Array.from({ length: SCENE_COUNT }, () => [...row]) })
  }
  // Mechanical pitch evolution and friction remain separate from global amplitude gestures.
  if (family === 'engine') {
    const direction = criteria.motion === 'decelerating' || criteria.gesture === 'stop' ? -1 : 1
    if (!explicit || ['spin', 'deploy', 'stop'].includes(criteria.gesture!)) main.pitch.slide = continuous ? 0 : direction * between(rng, 7, subtype === 'turbine' ? 22 : 13)
    main.pitch.slideCurve = direction < 0 ? EASE_OUT : EASE_IN
    const firing = subtype === 'combustion' || subtype === 'ignition'
    patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].cutoff', shape: firing ? 'saw' : 'sine', rate: between(rng, 14, 34), depth: 0.18,
      targetB: firing ? 'layers[0].gain' : 'layers[0].pm', depthB: firing ? 0.55 : 0.12 })
    // Accompaniment follows the same acceleration, rather than a disconnected second motor.
    if (patch.layers[2]!.source.kind !== 'noise') patch.layers[2]!.pitch.slide = main.pitch.slide
  } else if (family === 'spring') {
    main.pitch.slide = subtype === 'twang' ? -3 : -between(rng, 6, 15); main.pitch.slideCurve = EASE_OUT
    // A finite pitch contour damps the oscillation; an ordinary LFO would never settle.
    const bounces = between(rng, 2, 3.5)
    const row = Array.from({ length: STEP_COUNT }, (_, i) => {
      const t = i / (STEP_COUNT - 1)
      return 0.5 + 0.48 * Math.sin(t * bounces * Math.PI * 2) * Math.exp(-t * 4)
    })
    patch.performers[0]!.targetB = 'layers[1].gain'; patch.performers[0]!.depthB = 1
    patch.performers[1] = makePerformer({ enabled: true, bipolar: true, shape: 'curve', rate: (STEP_COUNT - 1) / STEP_COUNT,
      target: 'layers[0].pitch', depth: subtype === 'boing' ? 0.32 : 0.06, patterns: Array.from({ length: SCENE_COUNT }, () => [...row]) })
    patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].cutoff', shape: 'sine', rate: 5, depth: 0.08 })
  } else if (family === 'creak' || family === 'tear') {
    patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].pitch', shape: family === 'creak' ? 'noise' : 'saw', rate: between(rng, 8, 28), depth: family === 'creak' ? 0.07 : 0.025,
      targetB: 'layers[2].cutoff', depthB: 0.25 })
    if (family === 'tear') main.pitch.slide = subtype === 'metal-rip' ? -9 : 3
  } else if (family === 'pressure') {
    patch.mods[2] = makeMod({ enabled: true, kind: 'envelope', attack: subtype === 'suction' ? 0.6 : 0.008, hold: 0.02, decay: 0.55, sustain: 0.05, release: 0.15,
      target: 'layers[2].cutoff', depth: subtype === 'suction' ? -0.35 : 0.45 })
  } else if (family === 'bowed' || family === 'wind-instrument' || family === 'choir') {
    if (subtype !== 'robot-choir') { main.pitch.vibratoRate = between(rng, 4, 6.5); main.pitch.vibratoDepth = between(rng, 0.035, 0.16) }
    patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].cutoff', shape: subtype === 'robot-choir' ? 'square' : 'sine', rate: family === 'bowed' ? between(rng, 9, 18) : between(rng, 0.5, 2.5), depth: family === 'choir' ? 0.26 : 0.12 })
    if (!explicit) main.amp.attack = family === 'choir' ? 0.1 : subtype === 'brass' ? 0.08 : 0.035
  } else if (subtype === 'tom') { main.pitch.slide = -7; main.pitch.slideCurve = EASE_OUT }
  else if (subtype === 'insects') patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].pm', shape: 'square', rate: between(rng, 22, 39), depth: 0.4, targetB: 'layers[2].cutoff', depthB: 0.2 })
  else if (subtype === 'surf') patch.mods[2] = makeMod({ enabled: true, kind: 'envelope', attack: 0.4, hold: 0.02, decay: 0.3, release: 0.2, target: 'layers[2].cutoff', depth: 0.4 })
  // Explicit gestures retain their envelope policy; automatic sustained identities need sustained excitation.
  if (!explicit) for (const layer of patch.layers.filter((l) => l.enabled)) {
    layer.offset = 0
    layer.amp.hold = 0.55; layer.amp.decay = 0.1; layer.amp.sustain = 0.8; layer.amp.release = 0.2
  }
  roles[2] = roles[2] === 'unknown' ? 'texture' : roles[2]!
}

/**
 * The existing body bank is calibrated for strikes. Sustaining a harmonic at its resonance
 * can accumulate enough energy to mask every other voice. Compensate the wet contribution
 * using its actual decay, after duration fitting; preserve the dry excitation and decay itself.
 * Noise excites less coherently. A preceding comb adds another bounded feedback gain.
 */
export function balanceIdentityResonators(patch: AudioPatch): void {
  for (const layer of patch.layers.filter((entry) => entry.enabled)) {
    let buildup = 1
    for (const insert of [layer.insertA, layer.insertB, layer.insertC]) {
      if (insert.kind === 'comb') buildup *= 1 + insert.amount * insert.feedback / Math.max(0.05, 1 - insert.feedback)
      if (insert.kind === 'body') insert.amount /= 1 + insert.decay * (layer.source.kind === 'noise' ? 20 : 240) * buildup
    }
  }
}
