import type { SoundFamily } from './catalog'

/** Focused constructions within existing families; groups help future frontends organize them. */
export const DETAIL_SUBTYPES = {
  'electrical-arc': { family: 'burst', group: 'electricity', label: 'Electrical arc', description: 'An unstable discharge with noisy sparks and a tearing buzz.' },
  'short-circuit': { family: 'glitch', group: 'electricity', label: 'Short circuit', description: 'Interrupted contact, sputtering current and abrupt failure.' },
  'electric-discharge': { family: 'burst', group: 'electricity', label: 'Electric discharge', description: 'A single sharp discharge followed by collapsing charge.' },
  'transformer-hum': { family: 'drone', group: 'electricity', label: 'Transformer hum', description: 'A stable harmonic hum with a small electrical rattle.' },
  'radio-tuning': { family: 'scan', group: 'transmissions', label: 'Radio tuning', description: 'Moving interference tones crossing bands of static.' },
  'radio-squelch': { family: 'scan', group: 'transmissions', label: 'Radio squelch', description: 'A noise gate opening into a narrow radio channel, then closing.' },
  'radio-static': { family: 'texture', group: 'transmissions', label: 'Radio static', description: 'Broad interference with drifting narrow-band disturbances.' },
  'coded-transmission': { family: 'scan', group: 'transmissions', label: 'Coded transmission', description: 'Discrete short and long carrier bursts with deliberate gaps.' },
  ticking: { family: 'pulse', group: 'mechanisms', label: 'Clock ticking', description: 'Alternating escapement ticks with unequal resonant bodies.' },
  'small-ratchet': { family: 'servo', group: 'mechanisms', label: 'Small ratchet', description: 'Repeated tooth contacts and a short mechanical stop.' },
  'lock-mechanism': { family: 'servo', group: 'mechanisms', label: 'Lock mechanism', description: 'Small pin contacts resolving into a heavier latch.' },
  zipper: { family: 'scrape', group: 'mechanisms', label: 'Zipper', description: 'Dense tooth contacts travelling under fabric friction.' },
  'switch-click': { family: 'impact', group: 'mechanisms', label: 'Switch', description: 'A paired contact snap inside a small damped enclosure.' },
  'paper-crumple': { family: 'crush', group: 'soft-matter', label: 'Paper crumple', description: 'Dry sheet buckling with several irregular small fractures.' },
  'plastic-rustle': { family: 'shake', group: 'soft-matter', label: 'Plastic rustle', description: 'Bright crinkles and short resonant film snaps.' },
  'fabric-rustle': { family: 'scrape', group: 'soft-matter', label: 'Fabric rustle', description: 'Soft broad friction following uneven folds of fabric.' },
  'leather-flex': { family: 'creak', group: 'soft-matter', label: 'Leather flex', description: 'Damped rubbing, sticking and low flexible squeaks.' },
  slime: { family: 'water', group: 'viscous', label: 'Slime', description: 'Sticky stretching with slow wet resonances and releases.' },
  mud: { family: 'water', group: 'viscous', label: 'Mud', description: 'Dense wet compression, low suction and dirty splatter.' },
  gurgle: { family: 'water', group: 'viscous', label: 'Gurgle', description: 'Uneven bubbles moving through a hollow liquid passage.' },
  'suction-pop': { family: 'pressure', group: 'viscous', label: 'Suction pop', description: 'Gathering hollow pressure followed by a small wet release.' },
  'bubble-pop': { family: 'water', group: 'viscous', label: 'Bubble pop', description: 'One rounded pressure pop and a very short liquid ring.' },
  purr: { family: 'creature', group: 'animals', label: 'Purr', description: 'A low voiced vibration with rapid soft flutter.' },
  croak: { family: 'creature', group: 'animals', label: 'Croak', description: 'Hollow repeated calls with uneven throat modulation.' },
  bark: { family: 'creature', group: 'animals', label: 'Stylized bark', description: 'A sharp voiced onset, noisy throat and falling mouth resonance.' },
  'wing-flap': { family: 'whoosh', group: 'animals', label: 'Wing flap', description: 'Alternating air strokes with a light feather-like rustle.' },
  marimba: { family: 'percussion', group: 'tuned-percussion', label: 'Marimba', description: 'A rounded pitched bar strike with rapidly fading upper modes.' },
  vibraphone: { family: 'percussion', group: 'tuned-percussion', label: 'Vibraphone', description: 'A bright tuned bar with ringing overtones and tremolo.' },
  kalimba: { family: 'pluck', group: 'tuned-percussion', label: 'Kalimba', description: 'A plucked metal tine over a hollow resonant body.' },
  handpan: { family: 'percussion', group: 'tuned-percussion', label: 'Handpan', description: 'A soft pitched shell strike with coupled ringing modes.' },
  vinyl: { family: 'texture', group: 'recording-media', label: 'Vinyl', description: 'Surface hiss, isolated clicks and a slow rotational disturbance.' },
  'tape-hiss': { family: 'texture', group: 'recording-media', label: 'Tape hiss', description: 'Steady soft high-band noise over a faint low recording bed.' },
  'cassette-wobble': { family: 'texture', group: 'recording-media', label: 'Cassette wobble', description: 'A recorded tonal bed with slow wow, fast flutter and hiss.' },
  'digital-dropout': { family: 'glitch', group: 'recording-media', label: 'Digital dropout', description: 'A carrier interrupted by missing blocks and held digital fragments.' },
} as const satisfies Record<string, { family: SoundFamily; group: string; label: string; description: string }>

export type DetailSubtype = keyof typeof DETAIL_SUBTYPES
export type LabSubtypeGroup = typeof DETAIL_SUBTYPES[DetailSubtype]['group']
export function isDetailSubtype(id: string): id is DetailSubtype { return Object.hasOwn(DETAIL_SUBTYPES, id) }
