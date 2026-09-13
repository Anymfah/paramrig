import { mulberry32 } from '@paramrig/audio/random'
import { clamp, pick } from '../shuffle-draw'
import type { AudioPatch, Layer } from '@paramrig/audio'
import type { LabCriteria, LabRole } from './model'
import type { LabGesture } from './selections'
import { CHORD_DEFINITIONS, chordIntervals, type LabChord, type LabVoicing } from './harmony-catalog'

export const CHORD_LAYERS = [0, 2, 3] as const
const targets = ['target', 'targetB', 'targetC', 'targetD'] as const
const depths = ['depth', 'depthB', 'depthC', 'depthD'] as const

export function resolveHarmony(criteria: LabCriteria, seed: number, recent: readonly { chord?: LabChord; voicing?: LabVoicing }[]) {
  const rng = mulberry32(seed ^ 0x39ba415f)
  const options: LabChord[] = criteria.scale === 'major' ? ['major', 'sus2', 'sus4']
    : criteria.scale === 'minor' ? ['minor', 'sus2', 'sus4']
      : criteria.scale === 'pentatonic' ? ['major', 'sus2'] : Object.keys(CHORD_DEFINITIONS) as LabChord[]
  const available = options.filter((id) => id !== recent.at(-1)?.chord)
  const chord = criteria.chord && criteria.chord !== 'auto' && criteria.chord !== 'none' ? criteria.chord : pick(rng, available.length ? available : options)
  const voicing = criteria.voicing && criteria.voicing !== 'auto' ? criteria.voicing : pick(rng, ['close', 'open'] as const)
  return { chord, voicing }
}

function tune(layer: Layer, frequency: number): void {
  const ratio = frequency / layer.pitch.start
  layer.pitch.start = frequency
  for (const filter of [layer.filterA, layer.filterB]) if (filter.kind !== 'off') filter.cutoff = clamp(filter.cutoff * Math.sqrt(ratio), 70, 14000)
  for (const insert of [layer.insertA, layer.insertB, layer.insertC]) {
    if (insert.kind === 'body') insert.frequency = clamp(insert.frequency * ratio, 60, 12000)
    if (insert.kind === 'comb') insert.time = clamp(insert.time / ratio, 0.0001, 0.035)
  }
}

/** Three independent pitched voices; the remaining layer belongs to material and texture. */
export function buildChordVoices(patch: AudioPatch, roles: LabRole[], chord: LabChord, voicing: LabVoicing): void {
  const root = patch.layers[0]!
  if (root.source.kind === 'noise') { root.source.kind = 'tone'; root.source.wave = 'triangle' }
  root.source.pmFrom = 'internal'
  const original = structuredClone(root), intervals = chordIntervals(chord, voicing)
  CHORD_LAYERS.forEach((index, note) => {
    const layer = structuredClone(original)
    layer.enabled = true; layer.offset = 0
    layer.gain *= note === 0 ? 0.65 : 0.55
    layer.pan = [0, -0.22, 0.22][note]!
    tune(layer, original.pitch.start * 2 ** (intervals[note]! / 12))
    patch.layers[index] = layer; roles[index] = 'body'
  })
  patch.layers[1]!.enabled = true; patch.layers[1]!.source.pmFrom = 'internal'
  roles[1] = 'texture'
}

/** Reassert harmony after register, scenario and character shaping, without redrawing the sound. */
export function finishChord(patch: AudioPatch, criteria: LabCriteria, chord: LabChord, voicing: LabVoicing, gesture: LabGesture): void {
  const root = criteria.rootNote === undefined ? patch.layers[0]!.pitch.start : 440 * 2 ** ((criteria.rootNote - 69) / 12)
  const intervals = chordIntervals(chord, voicing)
  CHORD_LAYERS.forEach((index, note) => {
    const layer = patch.layers[index]!
    tune(layer, root * 2 ** (intervals[note]! / 12))
    layer.offset = 0; layer.pitch.slide = 0; layer.pitch.jitter = 0; layer.pitch.arpeggioRatio = 1
    layer.pitch.vibratoDepth = Math.min(layer.pitch.vibratoDepth, 0.18)
    layer.source.pmFrom = 'internal'
    // Keep the voiced fundamental legible even with an alien or metallic coloration.
    layer.source.fmRatio = Math.max(1, Math.round(layer.source.fmRatio))
    layer.source.fmIndex = Math.min(layer.source.fmIndex, 1.4)
    layer.source.detune = Math.min(layer.source.detune, 18)
  })
  const material = patch.layers[1]!
  if (material.source.kind !== 'noise') {
    tune(material, root)
    material.pitch.slide = 0; material.pitch.jitter = 0; material.pitch.arpeggioRatio = 1
    material.pitch.vibratoDepth = Math.min(material.pitch.vibratoDepth, 0.18)
  }
  material.offset = 0
  // The three existing scenario lanes become root/third/fifth (or root/fifth/tenth).
  const contours = structuredClone(patch.performers.slice(0, 3))
  for (const mod of [...patch.mods, ...patch.performers]) targets.forEach((key, route) => {
    if (mod[key].endsWith('.pitch')) { mod[key] = 'off'; mod[depths[route]!] = 0 }
  })
  CHORD_LAYERS.forEach((index, note) => {
    const lane = structuredClone(contours[gesture === 'strum' || gesture === 'arpeggiate' ? note : 0]!)
    for (const key of targets) lane[key] = 'off'
    if (lane.enabled && contours[0]!.target.endsWith('.gain')) {
      lane.target = `layers[${index}].gain`; lane.depth = 1
      if (note === 0) { lane.targetB = 'layers[1].gain'; lane.depthB = 1 }
    }
    patch.performers[note] = lane
  })
  if (gesture !== 'strum' && gesture !== 'arpeggiate') {
    const lane = patch.performers[0]!
    if (lane.target === 'layers[0].gain') {
      lane.targetC = 'layers[2].gain'; lane.depthC = 1
      lane.targetD = 'layers[3].gain'; lane.depthD = 1
    }
    patch.performers[1]!.enabled = false; patch.performers[2]!.enabled = false
  }
  if (gesture === 'auto' && criteria.motion !== 'natural') {
    // Movement may own cutoff as well as gain. Carry both over the whole chord;
    // rebuilding only gain routes would silently erase Continuous and the collapse darkening.
    const rootContour = contours[0]!
    const routes = targets.map((key, i) => ({ target: rootContour[key], depth: rootContour[depths[i]!] }))
      .filter((route) => route.target.startsWith('layers[0].'))
    routes.forEach((route, i) => {
      const lane = structuredClone(rootContour)
      targets.forEach((key, layer) => { lane[key] = route.target.replace('layers[0]', `layers[${layer}]`); lane[depths[layer]!] = route.depth })
      patch.performers[i] = lane
    })
  }
  // Identity tremolo and filter gestures move the entire chord together.
  for (const mod of patch.mods) {
    const primary = targets.findIndex((key) => mod[key].startsWith('layers[0].'))
    if (!mod.enabled || primary < 0) continue
    for (const index of [2, 3]) {
      const target = mod[targets[primary]!].replace('layers[0]', `layers[${index}]`)
      if (targets.some((key) => mod[key] === target)) continue
      const free = targets.findIndex((key) => mod[key] === 'off')
      if (free >= 0) { mod[targets[free]!] = target; mod[depths[free]!] = mod[depths[primary]!] }
    }
  }
}
