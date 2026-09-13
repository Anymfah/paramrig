import { useId } from 'react'
import type { LegacyFamily } from './catalog'
import type { LabGesture } from './selections'
import type { LabCriteria, LabMotion, LabType, LAB_MATERIALS } from './model'

/**
 * The pictures on the palette: what a family sounds like, what a material is, how a movement goes.
 *
 * Each family is a real trace — an envelope over a carrier, sampled — rather than a symbol, so the
 * twelve tiles read as twelve shapes of sound. Everything is a stroke in the current colour, one
 * weight throughout, and scales with the tile.
 */
const trace = (points: [number, number][]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('')
const frac = (v: number) => v - Math.floor(v)
const hash = (t: number, salt = 1) => frac(Math.sin(t * 127.1 * salt + 311.7) * 43758.5453)
const sampled = (count: number, f: (t: number) => number, width = 32, mid = 10, height = 8): string =>
  trace(Array.from({ length: count }, (_, i) => { const t = i / (count - 1); return [t * width, mid - Math.max(-1, Math.min(1, f(t))) * height] }))

type PaletteMaterial = typeof LAB_MATERIALS[number]
const FAMILY: Record<LegacyFamily, string> = {
  growl: sampled(96, (t) => Math.pow(Math.sin(Math.PI * t), 0.7) * (Math.sin(t * Math.PI * 2 * 7) * 0.6 + Math.sin(t * Math.PI * 2 * 23) * 0.4)),
  impact: sampled(96, (t) => (t < 0.06 ? t / 0.06 : Math.exp(-(t - 0.06) * 5.5)) * Math.sin(t * Math.PI * 2 * 15)),
  transformation: sampled(112, (t) => { const s = Math.sin(t * Math.PI * 2 * 6); return (0.55 + 0.35 * Math.sin(Math.PI * t)) * (s * (1 - t) + Math.tanh(s * 6) * t) }),
  servo: sampled(72, (t) => 0.78 * (2 * frac(t * 6) - 1)),
  scan: sampled(120, (t) => 0.8 * Math.sin(Math.PI * 2 * (1.5 * t + 9 * t * t))),
  glitch: sampled(64, (t) => { const k = Math.floor(t * 9); const on = hash(k, 3) > 0.35; return on ? (hash(k, 7) * 1.8 - 0.9) : 0 }),
  pulse: sampled(96, (t) => (frac(t * 4) < 0.45 ? 0.8 : -0.8)),
  drone: sampled(112, (t) => Math.sin(t * Math.PI * 2 * 9) * 0.55 + Math.sin(t * Math.PI * 2 * 9.6) * 0.3),
  rise: sampled(112, (t) => Math.pow(t, 1.4) * Math.sin(Math.PI * 2 * (3 * t + 6 * t * t))),
  fall: sampled(112, (t) => Math.pow(1 - t, 1.4) * Math.sin(Math.PI * 2 * (9 * t - 4.5 * t * t))),
  burst: sampled(120, (t) => { let env = 0; for (let k = 0; k < 4; k++) { const from = k * 0.14; if (t >= from) env += Math.exp(-(t - from) * 28) * (1 - k * 0.15) }; return Math.min(1, env) * Math.sin(t * Math.PI * 2 * 30) }),
  texture: sampled(120, (t) => (hash(t, 5) * 2 - 1) * 0.55),
}
const MOTION: Record<LabMotion, string> = {
  natural: sampled(64, (t) => 0.55 * Math.sin(Math.PI * 2 * t * 1.25 - 0.4), 48, 8, 6),
  continuous: 'M2 12 C4 4, 8 4, 12 4 L36 4 C40 4, 44 4, 46 12',
  pulsed: 'M2 13V3H10V13H16V3H24V13H30V3H38V13H46',
  stuttering: 'M2 13V3H7V13 M11 13V3H13V13 M17 13V3H24V13 M28 13V3H30V13 M34 13V3H36V13 M40 13V3H46V13',
  accelerating: trace([[2, 13], [2, 11]]).replace('L', 'L') + [2, 12, 20, 26, 31, 35, 38.5, 41.5, 44, 46].map((x, i, all) => `M${x} 13V${13 - 2 - (i / (all.length - 1)) * 8}`).join(''),
  decelerating: sampled(96, (t) => 0.7 * Math.sin(Math.PI * 2 * (7 * t - 3.8 * t * t)), 48, 8, 6),
  irregular: sampled(60, (t) => 0.45 * Math.sin(t * 22) + 0.3 * Math.sin(t * 55) + 0.2 * Math.sin(t * 109), 48, 8, 6),
  alternating: 'M2 8 C4 1,8 1,10 8 S16 15,18 8 S24 1,26 8 S32 15,34 8 S40 1,42 8 L46 8',
  collapsing: [2, 4, 6.5, 9.5, 13, 17, 22, 28, 35, 46].map((x, i, all) => `M${x} 13V${13 - 10 + (i / (all.length - 1)) * 8}`).join(''),
}
const MATERIAL: Record<PaletteMaterial, string> = {
  any: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16Z',
  metal: 'M3 15 L8 9 H21 L16 15 Z M3 15 V18 H16 V15 M16 15 L21 9 V12 L16 18',
  glass: 'M12 3 L21 19 H3 Z M12 3 L12 19 M8 12 L16 19',
  liquid: 'M12 4 C9 8, 7 10, 7 12.5 A5 5 0 0 0 17 12.5 C17 10, 15 8, 12 4 Z M4 20 C7 17, 9 17, 12 20 C15 17, 17 17, 20 20',
  air: 'M3 8 C7 5, 10 5, 14 8 S20 11, 21 8 M3 13 C7 10, 10 10, 14 13 S20 16, 21 13 M6 18 C9 15.5, 11 15.5, 14 18 S18 20, 20 18',
  electrical: 'M13 3 L6 13 H12 L10 21 L18 10 H12 Z',
}

// The palette draws the families, materials and movements it offers; anything else the catalog
// grows is drawn with the nearest general picture rather than nothing.
export function FamilyGlyph({ type }: { type: LabType }) {
  const id = useId()
  const path = FAMILY[type as LegacyFamily] ?? FAMILY.texture
  return (
    <svg className="labs-glyph labs-glyph--family" viewBox="0 0 80 36" aria-hidden="true">
      <defs><linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--labs-hot)" stopOpacity=".7" /><stop offset=".5" stopColor="var(--labs-glow)" stopOpacity=".28" /><stop offset="1" stopColor="var(--labs-glow)" stopOpacity=".04" /></linearGradient></defs>
      <path className="labs-sound-symbol__floor" d="M0 18H80" />
      <g transform="translate(2 7) scale(2.25 1.1)">
        <path className="labs-sound-symbol__body" d={`${path}L32 10H0Z`} fill={`url(#${id}-body)`} stroke="none" />
        {[4, 3, 2, 1].map((depth) => <path key={depth} className="labs-sound-symbol__layer" d={path} transform={`translate(${depth * 0.45} ${-depth * 1.4})`} opacity={0.5 - depth * 0.08} vectorEffect="non-scaling-stroke" />)}
        <path className="labs-sound-symbol__crest" d={path} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  )
}
export function MaterialGlyph({ material }: { material: LabCriteria['material'] }) {
  return <svg className="labs-glyph labs-glyph--material" viewBox="0 0 24 24" aria-hidden="true"><path d={MATERIAL[material as PaletteMaterial] ?? MATERIAL.any} /></svg>
}
export function MotionGlyph({ motion }: { motion: LabMotion }) {
  return <svg className="labs-glyph labs-glyph--motion" viewBox="0 0 48 16" aria-hidden="true"><path d={MOTION[motion] ?? MOTION.natural} /></svg>
}
export function WeightGlyph({ weight }: { weight: LabCriteria['weight'] }) {
  const bars = weight === 'light' ? [3] : weight === 'balanced' ? [3, 6] : [3, 6, 9]
  return <svg className="labs-glyph labs-glyph--weight" viewBox="0 0 14 12" aria-hidden="true">{bars.map((h, i) => <path key={h} d={`M${2 + i * 4.5} 11 V${11 - h}`} />)}</svg>
}

/*
 * Gestures: the contour of the event over its length, drawn as the silhouette the Shape view
 * would stand up for it — a filled profile on a floor line with a lit crest.
 */
const bump = (t: number, at: number, width: number) => Math.exp(-(((t - at) / width) ** 2))
const hit = (t: number, at: number, decay: number) => (t < at ? 0 : Math.exp(-(t - at) / decay))
const rise = (t: number, at = 0.03) => Math.min(1, t / at)
const SCATTER = [0.1, 0.26, 0.45, 0.61, 0.8]
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const GESTURE: Record<LabGesture, (t: number) => number> = {
  auto: (t) => 0.16 + 0.84 * bump(t, 0.46, 0.17),
  'assemble-lock': (t) => (t < 0.64 ? 0.42 * Math.sin(t / 0.64 * 4 * Math.PI) ** 2 : hit(t, 0.64, 0.12)),
  'charge-impact': (t) => (t < 0.64 ? 0.5 * (t / 0.64) ** 1.7 : hit(t, 0.64, 0.16)),
  deploy: (t) => (t < 0.58 ? (t / 0.58) ** 1.4 : Math.exp(-(t - 0.58) * 3.2)),
  retract: (t) => (1 - t) ** 1.2 * rise(t, 0.06),
  'break-apart': (t) => hit(t, 0.02, 0.15) * rise(t) + sum(SCATTER.map((at, n) => (0.9 - at * 0.6) * bump(t, at, 0.03 + n * 0.004))),
  'single-hit': (t) => rise(t) * hit(t, 0.03, 0.17),
  rebounds: (t) => sum([0, 1, 2, 3].map((n) => hit(t, n / 4 * 0.86 + 0.02, 0.055) * 0.7 ** n)) * rise(t),
  fracture: (t) => hit(t, 0.02, 0.12) * rise(t) + sum(SCATTER.map((at) => 0.62 * bump(t, at, 0.04))),
  move: (t) => 0.18 + 0.82 * Math.sin(Math.PI * t) ** 0.7,
  spin: (t) => (0.2 + 0.8 * Math.min(1, t * 4)) * (0.7 + 0.3 * Math.sin(t * 8 * Math.PI)) * rise(1 - t, 0.08),
  ratchet: (t) => 0.04 + 0.96 * Math.max(0, Math.cos(t * 8 * Math.PI)) ** 3,
  stop: (t) => (t < 0.62 ? 0.7 * rise(t, 0.05) : hit(t, 0.62, 0.05)),
  sustain: (t) => rise(t, 0.08) * rise(1 - t, 0.1) * (0.78 + 0.12 * Math.sin(2 * Math.PI * t)),
  phrase: (t) => sum([0, 1, 2, 3].map((n) => bump(t, (n + 0.35) / 4, 0.1))),
  surge: (t) => 0.12 + 0.88 * bump(t, 0.5, 0.28),
  sweep: (t) => Math.sin(Math.PI * t ** 1.4) ** 0.8,
  ping: (t) => rise(t, 0.02) * hit(t, 0.02, 0.1),
  sequence: (t) => sum([0, 1, 2, 3].map((n) => bump(t, (n + 0.3) / 4, 0.045))),
  stutter: (t) => sum(SCATTER.map((at) => bump(t, at, 0.028))),
  scatter: (t) => sum(SCATTER.map((at) => bump(t, at + 0.02, 0.05) * (1 - at * 0.4))),
  pulse: (t) => 0.04 + 0.96 * Math.max(0, Math.cos(t * 6 * Math.PI)) ** 5,
  swell: (t) => Math.sin(Math.PI * Math.min(1, t / 1.1)) ** 1.8,
  decay: (t) => (1 - t) ** 2.8 * rise(t, 0.02),
  rub: (t) => rise(t, 0.1) * rise(1 - t, 0.15) * (0.55 + 0.22 * Math.sin(t * 30) + 0.13 * Math.sin(t * 71)),
  roll: (t) => (0.3 + 0.4 * Math.sin(Math.PI * t)) * (0.55 + 0.45 * Math.max(0, Math.sin(t * 14 * Math.PI))),
  shake: (t) => sum([0, 1, 2].map((k) => bump(t, 0.2 + k * 0.3, 0.07))) * (0.7 + 0.3 * Math.sin(t * 90)),
  breathe: (t) => 0.9 * bump(t, 0.3, 0.16) + 0.6 * bump(t, 0.72, 0.14),
  flutter: (t) => bump(t, 0.5, 0.3) * (0.55 + 0.45 * Math.sin(t * 50)),
  drip: (t) => sum([[0.1, 1], [0.45, 0.7], [0.8, 0.85]].map(([at, gain]) => hit(t, at!, 0.03) * gain!)),
  rattle: (t) => sum(Array.from({ length: 9 }, (_, n) => hit(t, n * 0.1 + 0.02, 0.02) * (1 - n * 0.08))),
  strum: (t) => Math.min(1, sum([0, 1, 2, 3].map((n) => hit(t, 0.04 + n * 0.07, 0.35) * 0.45))),
  pluck: (t) => rise(t, 0.02) * hit(t, 0.02, 0.22),
  arpeggiate: (t) => sum([0, 1, 2, 3].map((n) => hit(t, n / 4 + 0.02, 0.1) * (0.6 + n * 0.12))),
  crumble: (t) => sum([0.04, 0.16, 0.3, 0.41, 0.55, 0.7, 0.83].map((at) => hit(t, at, 0.04) * (1 - at * 0.8))),
}
const GESTURE_PATHS = new Map<LabGesture, { crest: string; fill: string }>()
function gesturePath(gesture: LabGesture) {
  const cached = GESTURE_PATHS.get(gesture)
  if (cached) return cached
  const contour = GESTURE[gesture] ?? GESTURE.auto
  const floor = 15, height = 12, count = 72
  const points = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    // A grain of texture on the crest, so the silhouette reads as sound rather than as a curve.
    const grain = 0.86 + 0.14 * hash(t * 3.1, 2)
    return [2 + t * 44, floor - Math.max(0, Math.min(1, contour(t))) * height * grain] as [number, number]
  })
  const crest = trace(points)
  const made = { crest, fill: `${crest}L46 ${floor}L2 ${floor}Z` }
  GESTURE_PATHS.set(gesture, made)
  return made
}
export function GestureGlyph({ gesture }: { gesture: LabGesture }) {
  const { crest, fill } = gesturePath(gesture)
  return (
    <svg className="labs-glyph labs-glyph--gesture" viewBox="0 0 48 17" aria-hidden="true">
      <path className="labs-glyph__fill" d={fill} />
      <path d="M2 15.5H46" className="labs-glyph__floor" />
      <path d={crest} />
    </svg>
  )
}
