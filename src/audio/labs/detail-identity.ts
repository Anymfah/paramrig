import { EASE_IN, EASE_OUT } from '@paramrig/audio/curves'
import { SCENE_COUNT, STEP_COUNT } from '@paramrig/audio/fields'
import { makeMod, makePerformer } from '@paramrig/audio'
import { between, clamp, pick } from '../shuffle-draw'
import type { AudioPatch, BodyProfile, Layer } from '@paramrig/audio'
import type { LabCriteria, LabRole } from './model'
import { discoveryVoice } from './discovery-voices'
import { DETAIL_SUBTYPES, type DetailSubtype } from './detail-catalog'
import type { SynthesisEngine } from './catalog'

type Rng = () => number
function noise(layer: Layer, colour: 'pink' | 'white' | 'metallic') {
  layer.source.kind = 'noise'; layer.source.colour = colour; layer.source.pmFrom = 'internal'
}
function tone(layer: Layer, wave: 'sine' | 'triangle' | 'saw' | 'square') {
  if (layer.source.kind === 'noise') layer.source.kind = 'tone'
  if (layer.source.kind === 'tone') layer.source.wave = wave
}
function filter(layer: Layer, kind: 'lowpass' | 'bandpass' | 'highpass' | 'formant', cutoff: number, resonance = 0.1) {
  Object.assign(layer.filterA, { kind, cutoff: clamp(cutoff, 100, 9500), resonance, envAmount: 0 })
}
function body(layer: Layer, profile: BodyProfile, frequency: number, decay: number, amount = 0.22) {
  Object.assign(layer.insertC, { kind: 'body', place: 'post', profile, frequency: clamp(frequency, 50, 9000), decay,
    amount, spread: 0.45, partials: 4, character: 0.25 })
}

/** Dedicated excitation, with random constructions retained underneath each recognizable event. */
export function buildDetailIdentity(patch: AudioPatch, roles: LabRole[], id: DetailSubtype, rng: Rng): void {
  const main = patch.layers[0]!, root = main.pitch.start, group = DETAIL_SUBTYPES[id].group
  const support = (engine: SynthesisEngine, ratio: number, gain: number, role: LabRole = 'texture') => {
    const layer = discoveryVoice(engine, clamp(root * ratio, 30, 7800), 'sustain', rng, true)
    layer.gain = gain; layer.pan = between(rng, -0.3, 0.3); layer.offset = 0
    patch.layers[2] = layer; roles[2] = role
    return layer
  }
  if (group === 'electricity') {
    tone(main, id === 'transformer-hum' ? 'sine' : 'saw')
    main.source.fmRatio = id === 'transformer-hum' ? 2 : pick(rng, [1.413, 2.73, 5.09])
    main.source.fmIndex = id === 'transformer-hum' ? 0.35 : between(rng, 1.4, 3.8)
    main.source.fmFall = id === 'electric-discharge' ? 0.95 : 0
    if (id === 'transformer-hum') {
      main.pitch.start = pick(rng, [50, 60, 100, 120]); filter(main, 'lowpass', 950)
      const wire = support('additive', 3, 0.14, 'resonance'); wire.source.wave = 'triangle'
    } else {
      filter(main, id === 'electrical-arc' ? 'bandpass' : 'lowpass', id === 'short-circuit' ? 3400 : 5200, 0.2)
      const sparks = support('noise', 4, 0.28); noise(sparks, id === 'electrical-arc' ? 'metallic' : 'white')
      filter(sparks, 'highpass', id === 'electric-discharge' ? 1700 : 2800)
      main.insertA = { ...main.insertA, kind: id === 'short-circuit' ? 'crusher' : 'ring', amount: 0.25, ratio: 2.73, bitDepth: 7, crush: 0.2 }
    }
  } else if (group === 'transmissions') {
    const carrier = support(id === 'radio-squelch' ? 'noise' : 'fm', 2, 0.16)
    if (id === 'coded-transmission') {
      main.source.kind = 'tone'; main.source.wave = pick(rng, ['sine', 'triangle']); main.source.fmIndex = 0; main.source.pmFrom = 'internal'
      main.pitch.start = clamp(root, 550, 1500); filter(main, 'lowpass', 3500)
      carrier.source.fmIndex = 0.25; filter(carrier, 'bandpass', carrier.pitch.start)
    } else {
      noise(main, id === 'radio-static' ? 'white' : 'pink')
      filter(main, id === 'radio-static' ? 'highpass' : 'bandpass', id === 'radio-static' ? 1100 : 1600, 0.15)
      if (id === 'radio-tuning') { filter(carrier, 'lowpass', 6200); carrier.source.fmRatio = 1.413; carrier.source.fmIndex = 1.4 }
      else filter(carrier, 'bandpass', id === 'radio-squelch' ? 3000 : 2200, 0.4)
    }
  } else if (group === 'mechanisms') {
    if (id === 'zipper') { noise(main, 'pink'); filter(main, 'bandpass', 1900, 0.2) }
    else {
      main.source.fmFall = 0.95; filter(main, 'lowpass', id === 'lock-mechanism' ? 2200 : 4800)
      body(main, id === 'lock-mechanism' ? 'cavity' : 'bar', root * (id === 'switch-click' ? 3.7 : 2), 0.045)
    }
    const contact = support(id === 'ticking' ? 'membrane' : 'noise', id === 'ticking' ? 1.25 : 3, 0.24, 'attack')
    filter(contact, id === 'zipper' ? 'highpass' : 'bandpass', id === 'zipper' ? 2700 : id === 'switch-click' ? 3600 : 1800)
  } else if (group === 'soft-matter') {
    if (id === 'leather-flex') {
      tone(main, 'triangle'); main.source.fmIndex = 0.6; filter(main, 'formant', 400, 0.3)
      body(main, 'membrane', root, 0.06)
    } else {
      noise(main, id === 'plastic-rustle' ? 'metallic' : id === 'paper-crumple' ? 'white' : 'pink')
      filter(main, id === 'fabric-rustle' ? 'lowpass' : 'bandpass', id === 'fabric-rustle' ? 1600 : id === 'plastic-rustle' ? 3600 : 1800, 0.12)
      for (const insert of [main.insertA, main.insertB, main.insertC]) if (insert.kind === 'body') { insert.decay = 0.025; insert.amount = 0.12 }
    }
    const fold = support('noise', 2, id === 'fabric-rustle' ? 0.14 : 0.26)
    noise(fold, id === 'plastic-rustle' ? 'white' : 'pink')
    filter(fold, 'bandpass', id === 'fabric-rustle' ? 650 : id === 'leather-flex' ? 1100 : 4500, 0.1)
  } else if (group === 'viscous') {
    tone(main, 'sine'); main.source.fmRatio = id === 'mud' ? 0.5 : id === 'gurgle' ? 1.413 : 1
    main.source.fmIndex = id === 'slime' ? 1.5 : 0.65; main.source.fmFall = id === 'bubble-pop' ? 0.95 : 0.2
    main.pitch.start = clamp(root, id === 'mud' ? 70 : 140, id === 'bubble-pop' ? 1100 : 500)
    filter(main, id === 'slime' || id === 'gurgle' ? 'formant' : 'lowpass', id === 'mud' ? 850 : id === 'bubble-pop' ? 2600 : 1100, 0.35)
    body(main, 'cavity', main.pitch.start * 1.5, id === 'bubble-pop' ? 0.055 : 0.13, 0.15)
    const wet = support(id === 'gurgle' || id === 'bubble-pop' ? 'fm' : 'noise', 1.7, 0.2)
    filter(wet, 'bandpass', id === 'mud' ? 600 : 1700, 0.25)
  } else if (group === 'animals') {
    if (id === 'wing-flap') { noise(main, 'pink'); filter(main, 'bandpass', 850, 0.1) }
    else {
      main.source.kind = 'table'; main.source.pmFrom = 'internal'; main.source.table = id === 'bark' ? 'growl' : 'formant'
      main.source.position = between(rng, 0.18, 0.75); main.source.fmRatio = id === 'croak' ? 0.5 : 1
      main.source.fmIndex = id === 'bark' ? 1.1 : 0.4
      main.pitch.start = clamp(root, id === 'purr' ? 45 : 90, id === 'purr' ? 140 : 450)
      filter(main, 'formant', id === 'purr' ? 400 : id === 'croak' ? 800 : 1300, 0.28)
    }
    const air = support('noise', 2, id === 'bark' ? 0.3 : 0.12)
    filter(air, id === 'wing-flap' ? 'highpass' : 'bandpass', id === 'wing-flap' ? 2800 : id === 'purr' ? 450 : 2100)
  } else if (group === 'tuned-percussion') {
    tone(main, 'sine'); main.source.pmFrom = 'internal'
    main.source.fmRatio = id === 'marimba' ? 4 : id === 'handpan' ? 2 : id === 'kalimba' ? 2.76 : 1
    main.source.fmIndex = id === 'marimba' ? 0.55 : id === 'kalimba' ? 1.1 : 0.35
    main.source.fmFall = id === 'marimba' ? 0.98 : 0.7
    body(main, id === 'handpan' ? 'plate' : 'bar', root, id === 'vibraphone' ? 0.6 : id === 'handpan' ? 0.35 : 0.15)
    filter(main, 'lowpass', root * (id === 'marimba' ? 9 : 18))
    const partial = support('fm', id === 'kalimba' ? 2.76 : id === 'handpan' ? 3 : 4, id === 'marimba' ? 0.1 : 0.18, 'resonance')
    partial.source.fmRatio = id === 'handpan' ? 1 : 2; partial.source.fmIndex = 0.4; partial.source.fmFall = 0.9
    if (id === 'kalimba') main.insertB = { ...main.insertB, kind: 'comb', time: clamp(1 / root, 0.0001, 0.035), feedback: 0.68, amount: 0.3 }
  } else {
    const bed = support(id === 'vinyl' || id === 'cassette-wobble' ? 'noise' : 'additive', 0.5, id === 'vinyl' ? 0.25 : 0.08)
    if (id === 'vinyl' || id === 'tape-hiss') {
      noise(main, id === 'vinyl' ? 'pink' : 'white'); filter(main, 'highpass', id === 'vinyl' ? 450 : 2600)
      filter(bed, id === 'vinyl' ? 'highpass' : 'lowpass', id === 'vinyl' ? 3800 : 250)
    } else {
      tone(main, id === 'cassette-wobble' ? 'triangle' : 'square')
      main.source.fmIndex = id === 'cassette-wobble' ? 0.1 : 0.8; filter(main, 'lowpass', id === 'cassette-wobble' ? 2600 : 6000)
      if (id === 'digital-dropout') main.insertA = { ...main.insertA, kind: 'crusher', amount: 0.4, bitDepth: 8, crush: 0.35 }
      else filter(bed, 'highpass', 3200)
    }
  }
}

export function articulateDetailIdentity(patch: AudioPatch, id: DetailSubtype, criteria: LabCriteria, rng: Rng): void {
  const main = patch.layers[0]!, group = DETAIL_SUBTYPES[id].group
  const density = criteria.density ?? between(rng, 0.25, 0.75), cycles = 2 + Math.round(density * 5)
  const events = Array.from({ length: cycles + 2 }, (_, i) => (i + between(rng, 0.1, 0.7)) / (cycles + 2))
  const codes = Array.from({ length: STEP_COUNT }, (_, i) => i % 5 === 4 ? 0 : rng() > 0.45 ? 1 : 0)
  const bump = (t: number, at: number, width: number) => Math.exp(-2 * ((t - at) / width) ** 2)
  const hit = (t: number, at: number, decay: number) => t < at ? 0 : Math.exp(-(t - at) / decay)
  const grains = (t: number, width: number) => events.reduce((sum, at) => sum + bump(t, at, width), 0)
  function shape(t: number, lane: number): number {
    switch (id) {
      case 'electrical-arc': return 0.12 + 0.75 * grains(t, 0.04) + 0.2 * Math.sin(t * cycles * 17) ** 2
      case 'short-circuit': return t < 0.7 ? (0.12 + 0.8 * grains(t, 0.025)) : hit(t, 0.74, 0.04)
      case 'electric-discharge': return hit(t, 0, lane === 2 ? 0.12 : 0.055)
      case 'transformer-hum': return 0.9 + 0.1 * Math.sin(t * Math.PI * 4)
      case 'radio-tuning': return 0.12 + 0.88 * grains(t, lane === 2 ? 0.07 : 0.13)
      case 'radio-squelch': return lane === 2 ? hit(t, 0.03, 0.07) + hit(t, 0.78, 0.05) : t > 0.12 && t < 0.77 ? 0.9 : 0.04
      case 'radio-static': return 0.65 + 0.35 * grains(t, 0.12)
      case 'coded-transmission': return codes[Math.min(STEP_COUNT - 1, Math.round(t * (STEP_COUNT - 1)))]!
      case 'ticking': return Array.from({ length: cycles }, (_, i) => hit(t, (i + (lane === 2 ? 0.5 : 0)) / cycles, 0.025)).reduce((a, b) => a + b, 0)
      case 'small-ratchet': return t < 0.75 ? 0.05 + 0.9 * Math.max(0, Math.cos(t * cycles * Math.PI * 4)) ** 5 : hit(t, 0.8, 0.07)
      case 'lock-mechanism': return 0.4 * hit(t, 0.05, 0.04) + 0.35 * hit(t, 0.25, 0.03) + hit(t, 0.65, 0.14)
      case 'zipper': return Math.sin(Math.PI * t) * (0.25 + 0.75 * Math.cos(t * (cycles + 3) * Math.PI) ** 4)
      case 'switch-click': return hit(t, 0, 0.035) + 0.75 * hit(t, 0.1, 0.055)
      case 'paper-crumple': return 0.08 + 0.9 * grains(t, 0.055)
      case 'plastic-rustle': return 0.12 + 0.88 * grains(t, 0.025)
      case 'fabric-rustle': return 0.15 + 0.85 * Math.sin(Math.PI * t) ** 1.7
      case 'leather-flex': return 0.3 * Math.sin(Math.PI * t) + 0.7 * grains(t, 0.13)
      case 'slime': return 0.18 + 0.7 * bump(t, 0.45, 0.3) + 0.25 * hit(t, 0.78, 0.08)
      case 'mud': return hit(t, 0.08, 0.2) + 0.65 * bump(t, 0.65, 0.15)
      case 'gurgle': return 0.1 + grains(t, 0.07)
      case 'suction-pop': return t < 0.65 ? 0.5 * (t / 0.65) ** 1.5 : hit(t, 0.65, 0.09)
      case 'bubble-pop': return hit(t, 0, lane === 2 ? 0.12 : 0.06)
      case 'purr': return 0.72 + 0.28 * Math.sin(Math.PI * t)
      case 'croak': return grains(t, 0.1)
      case 'bark': return hit(t, 0, 0.11) + (cycles > 4 ? 0.65 * hit(t, 0.45, 0.1) : 0)
      case 'wing-flap': return Array.from({ length: cycles }, (_, i) => bump(t, (i + (lane === 2 ? 0.7 : 0.2)) / cycles, 0.25 / cycles)).reduce((a, b) => a + b, 0)
      case 'marimba': return hit(t, 0, lane === 2 ? 0.055 : 0.18)
      case 'vibraphone': return hit(t, 0, 0.55)
      case 'kalimba': return hit(t, 0, lane === 2 ? 0.09 : 0.3)
      case 'handpan': return hit(t, 0, lane === 2 ? 0.45 : 0.25)
      case 'vinyl': return lane === 2 ? grains(t, 0.016) : 0.55 + 0.1 * Math.sin(t * Math.PI * 2)
      case 'tape-hiss': return 0.95
      case 'cassette-wobble': return 0.8 + 0.15 * Math.sin(t * Math.PI * 3)
      case 'digital-dropout': return t > 0.2 && t < 0.35 || t > 0.7 && t < 0.83 ? 0 : t > 0.4 && t < 0.6 ? codes[Math.floor(t * 15)]! : 0.9
    }
  }
  const explicit = !!criteria.gesture && criteria.gesture !== 'auto', continuous = criteria.motion === 'continuous'
  for (let lane = 0; lane < 3; lane++) {
    const old = patch.performers[lane]!.patterns[patch.scene]!
    const values = Array.from({ length: STEP_COUNT }, (_, i) => {
      const own = clamp(shape(i / (STEP_COUNT - 1), lane), 0, 1)
      return explicit ? old[i]! : continuous ? 0.65 + own * 0.35 : own * (criteria.motion === 'natural' ? 1 : 0.4 + old[i]! * 0.6)
    })
    patch.performers[lane] = makePerformer({ enabled: true, bipolar: true,
      shape: id === 'coded-transmission' || id === 'digital-dropout' ? 'step' : 'curve', rate: (STEP_COUNT - 1) / STEP_COUNT,
      target: `layers[${lane}].gain`, depth: 1, ...(lane === 2 && patch.layers[3]!.enabled ? { targetB: 'layers[3].gain', depthB: 0.7 } : {}),
      patterns: Array.from({ length: SCENE_COUNT }, () => [...values]) })
  }
  if (!explicit) for (const layer of patch.layers.filter((l) => l.enabled)) {
    Object.assign(layer.amp, { attack: criteria.avoid.includes('click') ? 0.025 : 0.005, hold: 0.55, decay: 0.1, sustain: 0.85, release: 0.2 })
    layer.offset = 0
  }
  // Microstructure uses fast LFOs beneath the finite event contour, never new random patches.
  if (group === 'electricity') {
    patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].pm', shape: id === 'transformer-hum' ? 'sine' : 'noise', rate: id === 'transformer-hum' ? 5 : between(rng, 15, 38), depth: id === 'transformer-hum' ? 0.05 : 0.35 })
    if (id === 'electric-discharge') { main.pitch.slide = -18; main.pitch.slideCurve = EASE_OUT }
  } else if (group === 'transmissions') {
    patch.mods[2] = makeMod({ enabled: true, target: id === 'radio-tuning' ? 'layers[2].pitch' : 'layers[0].cutoff', shape: id === 'radio-static' ? 'noise' : 'triangle', rate: id === 'radio-static' ? 19 : 2, depth: id === 'radio-tuning' ? 0.5 : 0.12 })
    if (id === 'coded-transmission') { main.pitch.slide = 0; main.pitch.vibratoDepth = 0; main.pitch.arpeggioRatio = 1 }
  } else if (group === 'mechanisms' || group === 'soft-matter') {
    patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].cutoff', shape: id === 'zipper' || id === 'small-ratchet' ? 'saw' : 'noise', rate: id === 'fabric-rustle' ? 4 : between(rng, 18, 36), depth: 0.25 })
    if (id === 'leather-flex') { main.pitch.vibratoRate = 6; main.pitch.vibratoDepth = 0.5 }
  } else if (group === 'viscous') {
    main.pitch.slide = id === 'slime' || id === 'suction-pop' ? 8 : id === 'bubble-pop' ? -19 : -5
    main.pitch.slideCurve = id === 'suction-pop' ? EASE_IN : EASE_OUT
    patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].cutoff', targetB: 'layers[2].pm', depth: 0.25, depthB: 0.16, shape: id === 'gurgle' ? 'noise' : 'sine', rate: id === 'slime' ? 2 : between(rng, 7, 16) })
  } else if (group === 'animals') {
    patch.mods[2] = makeMod({ enabled: true, target: id === 'wing-flap' ? 'layers[0].cutoff' : 'layers[0].gain', shape: id === 'croak' ? 'saw' : 'sine', rate: id === 'purr' ? between(rng, 21, 33) : id === 'croak' ? 16 : 5, depth: id === 'purr' ? 0.55 : 0.3 })
    if (id === 'bark') { main.pitch.slide = -9; main.pitch.slideCurve = EASE_OUT }
  } else if (group === 'tuned-percussion') {
    main.pitch.slide = 0
    patch.mods[2] = makeMod({ enabled: true, target: id === 'vibraphone' ? 'layers[0].gain' : 'layers[0].cutoff', shape: 'sine', rate: id === 'vibraphone' ? between(rng, 4, 7) : 2, depth: id === 'vibraphone' ? 0.48 : 0.08 })
  } else if (id === 'cassette-wobble') {
    main.pitch.slide = 0; main.pitch.vibratoRate = between(rng, 7, 11); main.pitch.vibratoDepth = between(rng, 0.025, 0.07)
    patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].pitch', shape: 'sine', rate: between(rng, 0.6, 1.4), depth: 0.015 })
  } else patch.mods[2] = makeMod({ enabled: true, target: 'layers[0].cutoff', shape: 'noise', rate: id === 'tape-hiss' ? 2 : 27, depth: id === 'tape-hiss' ? 0.025 : 0.18 })
}
