import type { SdkFamily, SoundFamily } from './catalog'
import { DETAIL_SUBTYPES, type LabSubtypeGroup } from './detail-catalog'

/** Subtypes describe constructions inside a family, independently of material and character. */
export const SUBTYPE_DEFINITIONS = {
  blast: { family: 'explosion', label: 'Expanding blast', description: 'Low pressure front, spreading air and falling debris.' },
  detonation: { family: 'explosion', label: 'Dry detonation', description: 'A compact crack followed by a short pressure tail.' },
  'muffled-blast': { family: 'explosion', label: 'Muffled blast', description: 'A damped pressure wave behind a dense obstruction.' },
  combustion: { family: 'engine', label: 'Combustion', description: 'Uneven firing pulses coupled to a harmonic engine body.' },
  turbine: { family: 'engine', label: 'Turbine', description: 'Spooling whine over broadband exhaust turbulence.' },
  'electric-motor': { family: 'engine', label: 'Electric motor', description: 'Harmonic drive whine with a small switching component.' },
  ignition: { family: 'engine', label: 'Ignition', description: 'Starter interruptions resolving into running combustion.' },
  boing: { family: 'spring', label: 'Elastic bounce', description: 'Large damped pitch oscillations after an elastic release.' },
  twang: { family: 'spring', label: 'Twang', description: 'A taut string transient and bending harmonic decay.' },
  coil: { family: 'spring', label: 'Metal coil', description: 'Inharmonic coil ringing with a fluttering decay.' },
  hinge: { family: 'creak', label: 'Hinge', description: 'Intermittent squeals as a sticking joint moves.' },
  'wood-stress': { family: 'creak', label: 'Wood under tension', description: 'Low structural groans interrupted by dry fibre slips.' },
  'hull-stress': { family: 'creak', label: 'Hull under tension', description: 'Slow bending with resonant metal strain.' },
  'paper-rip': { family: 'tear', label: 'Paper rip', description: 'Fine noisy fractures that accelerate through a sheet.' },
  'fabric-rip': { family: 'tear', label: 'Fabric rip', description: 'Damped, irregular fibre releases under sustained tension.' },
  'metal-rip': { family: 'tear', label: 'Metal rip', description: 'Progressive tearing with pitched strain and a final ring.' },
  valve: { family: 'pressure', label: 'Valve release', description: 'An opening transient and a rapidly falling pressure jet.' },
  steam: { family: 'pressure', label: 'Steam jet', description: 'Sustained turbulent air with a narrow whistling component.' },
  suction: { family: 'pressure', label: 'Suction', description: 'A hollow intake that gathers pressure before closing.' },
  'bowed-string': { family: 'bowed', label: 'Bowed string', description: 'Sustained harmonic friction and a resonant wooden body.' },
  'rubbed-glass': { family: 'bowed', label: 'Rubbed glass', description: 'A narrow singing resonance with delicate friction.' },
  'abrasive-bow': { family: 'bowed', label: 'Abrasive bow', description: 'Rough sustained excitation with beating upper partials.' },
  flute: { family: 'wind-instrument', label: 'Flute', description: 'A rounded fundamental and a softly articulated air edge.' },
  reed: { family: 'wind-instrument', label: 'Reed', description: 'Odd-rich harmonics with breath and a resonant bore.' },
  brass: { family: 'wind-instrument', label: 'Brass', description: 'A swelling harmonic spectrum with lip-like instability.' },
  'vowel-choir': { family: 'choir', label: 'Vowel choir', description: 'Harmonic voices moving through contrasting vowel resonances.' },
  'robot-choir': { family: 'choir', label: 'Robot choir', description: 'Quantized vowels and tightly coupled synthetic voices.' },
  'whisper-choir': { family: 'choir', label: 'Whisper choir', description: 'Soft pitched voices behind several bands of breath.' },
  thunder: { family: 'ambience', label: 'Thunder', description: 'Several low rolling fronts under a diffuse noise tail.' },
  insects: { family: 'ambience', label: 'Insects', description: 'Interleaved narrow buzzing bands and irregular chirrs.' },
  surf: { family: 'water', label: 'Surf', description: 'A breaking wave, noisy foam and receding water.' },
  stream: { family: 'water', label: 'Stream', description: 'Continuous flowing water over small resonant bubbles.' },
  clap: { family: 'percussion', label: 'Clap', description: 'Closely spaced noisy hand-like transients and a short room tail.' },
  cymbal: { family: 'percussion', label: 'Cymbal', description: 'Dense high inharmonic resonances with a spreading decay.' },
  gong: { family: 'percussion', label: 'Gong', description: 'A low strike with slowly blooming metallic partials.' },
  tom: { family: 'percussion', label: 'Tom', description: 'A pitched membrane strike with a descending body.' },
  shaker: { family: 'percussion', label: 'Shaker', description: 'Dense particle contacts grouped into hand-sized strokes.' },
  organ: { family: 'pad', label: 'Organ', description: 'Stable harmonic drawbar-like layers and a brief key transient.' },
  'electric-piano': { family: 'keys', label: 'Electric piano', description: 'A tine-like FM transient over a rounded harmonic decay.' },
  harp: { family: 'pluck', label: 'Harp', description: 'A bright string excitation and a softer resonant body.' },
  portal: { family: 'transformation', label: 'Portal', description: 'An opening spectral sweep resolving into an unstable field.' },
  spell: { family: 'burst', label: 'Spell', description: 'A charged transient with scattered sparkling harmonics.' },
  enchantment: { family: 'texture', label: 'Enchantment', description: 'Interwoven ringing particles over a sustained harmonic field.' },
  apparition: { family: 'rise', label: 'Apparition', description: 'A breathy emergence followed by a ghostly vocal resonance.' },
  ...DETAIL_SUBTYPES,
} as const satisfies Record<string, { family: SoundFamily; label: string; description: string; group?: string }>

export type LabSubtype = keyof typeof SUBTYPE_DEFINITIONS
export type LabSubtypeOption = { id: LabSubtype; family: SoundFamily; label: string; description: string; group?: LabSubtypeGroup }
export const LAB_SUBTYPES: readonly LabSubtype[] = Object.freeze(Object.keys(SUBTYPE_DEFINITIONS) as LabSubtype[])
export function labSubtypeCatalog(family: SdkFamily = 'any'): LabSubtypeOption[] {
  return LAB_SUBTYPES.filter((id) => family === 'any' || SUBTYPE_DEFINITIONS[id].family === family)
    .map((id) => ({ id, ...SUBTYPE_DEFINITIONS[id] }))
}
export function subtypeBelongsTo(value: unknown, family: SdkFamily): value is LabSubtype {
  return typeof value === 'string' && Object.hasOwn(SUBTYPE_DEFINITIONS, value)
    && (family === 'any' || SUBTYPE_DEFINITIONS[value as LabSubtype].family === family)
}
