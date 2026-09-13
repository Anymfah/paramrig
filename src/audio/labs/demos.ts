import { generateSignatureSound as generateSound, fuseSounds } from './generate'
import { DEFAULT_CRITERIA, fingerprint, type LabCriteria, type LabSound } from './model'

/** Reproducible research examples. No DSP runs while the preset menu is being built. */
const designs: { id: string; name: string; seed: number; duration: number; traits: Partial<LabCriteria>; gain: number }[] = [
  { id: 'iron-colossus', name: 'Iron Colossus', seed: 17141, duration: 1560, traits: { type: 'growl', material: 'metal', character: 'industrial', weight: 'heavy' }, gain: 0.201709 },
  { id: 'servo-cathedral', name: 'Servo Cathedral', seed: 3626, duration: 2180, traits: { type: 'transformation', material: 'metal', character: 'mechanical', motion: 'accelerating', weight: 'heavy' }, gain: 0.309393 },
  { id: 'prism-fracture', name: 'Prism Fracture', seed: 7802, duration: 780, traits: { type: 'impact', material: 'glass', character: 'futuristic', weight: 'balanced' }, gain: 0.622109 },
  { id: 'neural-stutter', name: 'Neural Stutter', seed: 2479, duration: 1060, traits: { type: 'glitch', material: 'electrical', character: 'alien', motion: 'stuttering', weight: 'light' }, gain: 1.062103 },
]
const prepared = new Map<string, LabSound>()
export function labDemo(id: string): LabSound {
  const cached = prepared.get(id)
  if (cached) return structuredClone(cached)
  let sound: LabSound
  if (id === 'titan-splice') {
    const a = labDemo('iron-colossus'), b = labDemo('servo-cathedral')
    sound = fuseSounds({ mode: 'fuse', criteria: a.criteria, reference: a, contributor: b, contribution: 'texture', influence: 0.42, seed: 7319 }, 7319)
    sound.name = 'Titan Splice'; sound.patch.master.gain = 0.328301
  } else {
    const definition = designs.find((design) => design.id === id)
    if (!definition) throw new Error(`Unknown Labs preset: ${id}`)
    sound = generateSound({ ...DEFAULT_CRITERIA, ...definition.traits, minMs: definition.duration, maxMs: definition.duration }, definition.seed)
    sound.name = definition.name; sound.patch.master.gain = definition.gain
  }
  sound.id = `lab-demo-${id}`; sound.fingerprint = fingerprint(sound.patch)
  prepared.set(id, sound)
  return structuredClone(sound)
}
export const LAB_DEMOS = [...designs.map(({ id, name }) => ({ id, name })), { id: 'titan-splice', name: 'Titan Splice' }]
export const LAB_PRESETS = LAB_DEMOS.map(({ id, name }) => ({
  id: `labs-${id}`, label: name,
  build: () => labDemo(id).patch,
  rig: () => labDemo(id).rig!,
}))
