import { mulberry32 } from '@paramrig/audio/random'
import type { LabCriteria } from './model'
import { FAMILY_DEFINITIONS } from './catalog'

/**
 * A name a person can say back.
 *
 * Twenty sounds called "Metal Growl" is a list nobody can point at. The seed that made the sound
 * also names it, so the same recipe always carries the same name, and the two words say what was
 * asked for — the material or the character first, the family second.
 */
const MATERIAL: Record<LabCriteria['material'], string[]> = {
  any: [],
  metal: ['Iron', 'Steel', 'Chrome', 'Brass', 'Rivet', 'Anvil', 'Forge', 'Cobalt'],
  glass: ['Prism', 'Crystal', 'Quartz', 'Shard', 'Frost', 'Lens', 'Opal'],
  liquid: ['Tide', 'Brine', 'Marsh', 'Ink', 'Mercury', 'Silt', 'Undertow'],
  air: ['Vapor', 'Gale', 'Draft', 'Haze', 'Sirocco', 'Zephyr', 'Cirrus'],
  electrical: ['Volt', 'Arc', 'Neon', 'Static', 'Relay', 'Cathode', 'Flux'],
  wood: ['Oak', 'Cedar', 'Birch', 'Willow', 'Hollow', 'Timber'],
  stone: ['Granite', 'Basalt', 'Slate', 'Boulder', 'Cairn', 'Pebble'],
  sand: ['Dune', 'Silt', 'Gravel', 'Dust', 'Desert', 'Shore'],
  ice: ['Glacier', 'Frost', 'Sleet', 'Tundra', 'Polar', 'Rime'],
  ceramic: ['Porcelain', 'Clay', 'Kiln', 'Tile', 'Glaze', 'Ivory'],
  rubber: ['Elastic', 'Bounce', 'Spring', 'Tread', 'Coil', 'Flex'],
  fabric: ['Silk', 'Linen', 'Velvet', 'Canvas', 'Cotton', 'Thread'],
  membrane: ['Hide', 'Skin', 'Drum', 'Taut', 'Tension', 'Tympan'],
  fire: ['Ember', 'Cinder', 'Flame', 'Ash', 'Blaze', 'Flicker'],
}
const CHARACTER: Record<LabCriteria['character'], string[]> = {
  any: ['Echo', 'Drift', 'Signal', 'Vector', 'Ember', 'Cinder'],
  mechanical: ['Servo', 'Piston', 'Gear', 'Ratchet', 'Cam', 'Flywheel'],
  futuristic: ['Neural', 'Photon', 'Orbital', 'Quantum', 'Helix', 'Ion'],
  organic: ['Marrow', 'Fern', 'Sinew', 'Amber', 'Moss', 'Hollow'],
  alien: ['Xeno', 'Void', 'Umbra', 'Nebula', 'Cipher', 'Specter'],
  industrial: ['Furnace', 'Girder', 'Turbine', 'Titan', 'Anvil', 'Colossus'],
  acoustic: ['Natural', 'Open', 'Chamber', 'Bare', 'Close', 'Earth'],
  analog: ['Warm', 'Tape', 'Copper', 'Amber', 'Velvet', 'Valve'],
  digital: ['Pixel', 'Binary', 'Logic', 'Vector', 'Prism', 'Signal'],
  retro: ['Arcade', 'Raster', 'Cartridge', 'Chip', 'Raster', 'Console'],
  ethereal: ['Halo', 'Aura', 'Veil', 'Lunar', 'Mist', 'Astral'],
  corrupted: ['Broken', 'Frayed', 'Shattered', 'Torn', 'Fault', 'Static'],
  clean: ['Clear', 'Pure', 'Lucid', 'Satin', 'Bright', 'Pristine'],
}
const FAMILY: Partial<Record<LabCriteria['type'], string[]>> = {
  growl: ['Colossus', 'Throat', 'Maw', 'Roar', 'Beast', 'Rumble'],
  impact: ['Strike', 'Slam', 'Hammer', 'Fracture', 'Crash', 'Blow'],
  transformation: ['Cathedral', 'Bloom', 'Shift', 'Morph', 'Unfold', 'Passage'],
  servo: ['Grind', 'Hinge', 'Actuator', 'Torque', 'Crank', 'Motor'],
  scan: ['Sweep', 'Beacon', 'Probe', 'Radar', 'Sonar', 'Scanner'],
  glitch: ['Stutter', 'Splice', 'Tear', 'Jitter', 'Skip', 'Fault'],
  pulse: ['Beat', 'Tick', 'Throb', 'Meter', 'Cadence', 'Pulse'],
  drone: ['Hum', 'Field', 'Halo', 'Choir', 'Depth', 'Drone'],
  rise: ['Ascent', 'Climb', 'Surge', 'Lift', 'Riser', 'Escalation'],
  fall: ['Descent', 'Drop', 'Sink', 'Plunge', 'Collapse', 'Fall'],
  burst: ['Salvo', 'Scatter', 'Flare', 'Volley', 'Burst', 'Shatter'],
  texture: ['Grain', 'Weave', 'Dust', 'Fabric', 'Texture', 'Sediment'],
  whoosh: ['Pass', 'Swish', 'Rush'], scrape: ['Drag', 'Scuff', 'Scrape'], roll: ['Tumble', 'Roll', 'Rumble'],
  shake: ['Shake', 'Shiver', 'Rattle'], crush: ['Crunch', 'Fracture', 'Crush'], footstep: ['Step', 'Stride', 'Tread'],
  wind: ['Gust', 'Whistle', 'Breeze'], water: ['Drop', 'Stream', 'Bubble'], fire: ['Crackle', 'Flare', 'Burn'],
  rain: ['Drizzle', 'Shower', 'Rain'], ambience: ['Field', 'Atmosphere', 'Horizon'], creature: ['Call', 'Howl', 'Murmur'],
  chirp: ['Trill', 'Chirp', 'Peep'], breath: ['Breath', 'Exhale', 'Hiss'], notification: ['Ping', 'Notice', 'Badge'],
  confirmation: ['Resolve', 'Accept', 'Chime'], error: ['Reject', 'Warning', 'Denial'], alarm: ['Alert', 'Alarm', 'Signal'],
  kick: ['Kick', 'Thump', 'Punch'], snare: ['Snare', 'Snap', 'Clap'], hat: ['Hat', 'Tick', 'Sizzle'],
  percussion: ['Strike', 'Tap', 'Drum'], bass: ['Bass', 'Low', 'Foundation'], lead: ['Lead', 'Voice', 'Line'],
  pad: ['Pad', 'Cloud', 'Harmonics'], pluck: ['Pluck', 'String', 'Plectrum'], bell: ['Bell', 'Chime', 'Toll'], keys: ['Keys', 'Tines', 'Clavier'],
  explosion: ['Blast', 'Detonation', 'Shockwave'], engine: ['Engine', 'Drive', 'Propulsion'], spring: ['Bounce', 'Coil', 'Twang'],
  creak: ['Strain', 'Groan', 'Hinge'], tear: ['Rip', 'Rupture', 'Rend'], pressure: ['Jet', 'Valve', 'Intake'],
  bowed: ['Bow', 'String', 'Singing'], 'wind-instrument': ['Breath', 'Reed', 'Horn'], choir: ['Choir', 'Voices', 'Chorus'],
}

export function nameSound(criteria: Pick<LabCriteria, 'type' | 'material' | 'character'>, seed: number): string {
  const random = mulberry32((seed ^ 0x5f3759df) >>> 0)
  const first = criteria.material === 'any' ? CHARACTER[criteria.character] : MATERIAL[criteria.material]
  const second = FAMILY[criteria.type] ?? [criteria.type === 'any' ? 'Sound' : FAMILY_DEFINITIONS[criteria.type].label]
  const pick = (list: string[]) => list[Math.floor(random() * list.length)]!
  const noun = pick(second)
  let adjective = pick(first)
  if (adjective === noun) adjective = pick(first.filter((word) => word !== noun)) ?? adjective
  return `${adjective} ${noun}`
}
