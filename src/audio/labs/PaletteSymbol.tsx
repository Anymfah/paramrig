import { useId } from 'react'
import { isLegacyFamily, FAMILY_DEFINITIONS, type LabMaterial, type SdkFamily } from './catalog'
import { FamilyGlyph } from './glyphs'

const TAU = Math.PI * 2
const bell = (t: number, at: number, width: number) => Math.exp(-(((t - at) / width) ** 2))

/** Sound silhouettes share the trace language of the instrument's original twelve families. */
function familyTrace(family: Exclude<SdkFamily, 'any'>): string {
  const { domain } = FAMILY_DEFINITIONS[family]
  const salt = [...family].reduce((sum, letter) => sum + letter.charCodeAt(0), 0)
  const impulse = ['percussion', 'interface'].includes(domain) || ['pluck', 'bell', 'footstep', 'crush', 'explosion'].includes(family)
  return Array.from({ length: 144 }, (_, i) => {
    const t = i / 143
    const envelope = impulse ? Math.min(1, t * 50) * Math.exp(-t * (family === 'explosion' ? 3 : 5))
      : Math.sin(Math.PI * t) ** (family === 'pad' || family === 'ambience' ? 0.5 : 1.3)
    const carrier = Math.sin(t * TAU * (3 + salt % 9))
    const grit = ['nature', 'foley', 'creatures'].includes(domain) ? Math.sin(t * TAU * 37) * 0.3 + Math.sin(t * TAU * 59) * 0.2 : 0
    const phrase = family === 'confirmation' ? bell(t, 0.2, 0.11) + bell(t, 0.6, 0.16)
      : family === 'error' || family === 'alarm' ? (Math.floor(t * 8) % 2 ? 0.06 : 0.9) : envelope
    const level = Math.max(-1, Math.min(1, phrase * (carrier * 0.72 + grit)))
    return `${i ? 'L' : 'M'}${(2 + t * 76).toFixed(2)},${(18 - level * 15).toFixed(2)}`
  }).join(' ')
}
const TRACES = Object.fromEntries(Object.keys(FAMILY_DEFINITIONS).map((family) => [family, familyTrace(family as Exclude<SdkFamily, 'any'>)]))

export function PaletteFamilySymbol({ family }: { family: SdkFamily }) {
  const id = useId()
  if (isLegacyFamily(family)) return <FamilyGlyph type={family} />
  const trace = family === 'any' ? 'M3 18C12 18 16 5 26 5S42 31 53 31S67 18 77 18 M3 18C12 18 16 31 26 31S42 5 53 5S67 18 77 18' : TRACES[family]
  return <svg className="labs-glyph labs-glyph--family labs-sound-symbol" viewBox="0 0 80 36" aria-hidden="true">
    <defs><linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--labs-hot)" stopOpacity=".7" /><stop offset=".5" stopColor="var(--labs-glow)" stopOpacity=".28" /><stop offset="1" stopColor="var(--labs-glow)" stopOpacity=".04" /></linearGradient></defs>
    <path className="labs-sound-symbol__floor" d="M2 18H78" />
    <g transform="translate(0 3) scale(.94 .82)">
      <path className="labs-sound-symbol__body" d={`${trace}L78 18H2Z`} fill={`url(#${id}-body)`} stroke="none" />
      {[4, 3, 2, 1].map((depth) => <path key={depth} className="labs-sound-symbol__layer" d={trace} transform={`translate(${depth} ${-depth * 1.7})`} opacity={0.5 - depth * 0.08} />)}
      <path className="labs-sound-symbol__crest" d={trace} />
    </g>
  </svg>
}

/** Facets, layers and surfaces identify the material before its label. */
export function PaletteMaterialSymbol({ material }: { material: LabMaterial }) {
  const id = useId()
  const fill = `url(#${id}-face)`, shade = `url(#${id}-shade)`, side = `url(#${id}-side)`
  const image = (() => {
    switch (material) {
      case 'metal': return <><path fill={fill} d="M17 18 37 6 61 17 40 31Z" /><path fill={shade} d="M17 18 40 31 40 48 17 35Z" /><path fill={side} d="M40 31 61 17 61 34 40 48Z" /><path stroke="var(--labs-symbol-light)" d="m17 18 23 13 21-14 M40 31v17" /><path stroke="var(--labs-symbol-light)" d="m29 11 24 11" opacity=".5" /></>
      case 'glass': return <><path fill={shade} d="M40 5 62 39 39 48 17 38Z" /><path fill={fill} opacity=".5" d="M40 5 39 48 17 38Z" /><path d="m40 5-1 43 23-9-22-34-23 33 22 10 M17 38l23-14 22 15 M40 5v19" /></>
      case 'stone': return <><path fill={shade} d="m16 34 9-20 22-7 17 18-9 18-23 5Z" /><path fill={fill} opacity=".45" d="m25 14 17 14 5-21 17 18-22 3-10 20Z" /><path d="m16 34 26-6 13 15 M25 14l17 14 5-21" opacity=".6" /></>
      case 'ice': return <><path fill={shade} d="m25 14 21-9 14 17-4 22-23 5-17-16Z" /><path fill={fill} opacity=".6" d="m25 14 13 16 8-25 14 17-22 8 18 14-23 5 5-19-22 3Z" /><path d="m25 14 13 16 8-25 M16 33l22-3 18 14" /></>
      case 'liquid': return <><ellipse cx="40" cy="33" rx="28" ry="12" fill={shade} opacity=".55" />{[0, 1, 2, 3].map((n) => <ellipse key={n} cx="40" cy="33" rx={28 - n * 6} ry={12 - n * 2.5} opacity={0.3 + n * 0.16} />)}<path fill={fill} d="M40 7c-3 6-6 9-6 13a6 6 0 0 0 12 0c0-4-3-7-6-13Z" /><path d="M36 19c-1 3 0 5 2 6 M24 32c5-3 11-4 15-4" stroke="var(--labs-symbol-light)" /></>
      case 'air': return <>{[0, 1, 2, 3].map((n) => <path key={n} d={`M9 ${30 + n * 3}C24 ${5 + n * 3} 39 ${48 - n * 3} 70 ${14 + n * 4}`} opacity={0.25 + n * 0.2} />)}</>
      case 'electrical': return <><path opacity=".4" d="m5 35 16-2 5-13 7 24 9-38 6 29 9-10 18-2" /><path fill={fill} d="M45 4 26 30h13l-5 20 23-30H43Z" /></>
      case 'wood': return <><path fill={shade} d="m15 18 34-11 16 14-34 13Z M15 18v18l16 13V34m34-13v16L31 49" /><path d="m23 19 29-10m-23 16 29-11M19 26l9 8m-9-3 9 8m7-1 25-10m-25 16 25-10" opacity=".55" /></>
      case 'ceramic': return <><path fill={fill} d="M20 15h40l-5 22c-2 12-28 12-30 0Z" /><ellipse cx="40" cy="15" rx="20" ry="7" fill={shade} /><path d="M27 21c0 13 5 20 10 21" opacity=".75" /></>
      case 'rubber': return <><ellipse cx="40" cy="28" rx="25" ry="18" fill={shade} /><ellipse cx="40" cy="26" rx="14" ry="9" fill="var(--labs-bg)" /><path d="M16 28c4 18 43 23 49 0M23 17c12-8 27-5 35 3" opacity=".7" /></>
      case 'fabric': return <>{[0, 1, 2, 3, 4].map((n) => <path key={n} d={`M10 ${12 + n * 6}C28 ${-5 + n * 6} 40 ${42 + n * 6} 70 ${12 + n * 6}`} opacity={0.3 + n * 0.12} />)}{[0, 1, 2, 3].map((n) => <path key={n} d={`M${19 + n * 12} 10v32`} opacity=".16" />)}</>
      case 'membrane': return <><ellipse cx="40" cy="27" rx="28" ry="17" fill={shade} /><path d="M12 27c18-19 35 23 56 0M17 18c15 14 32-9 46 18" /><ellipse cx="40" cy="27" rx="21" ry="12" opacity=".4" /></>
      case 'fire': return <><path fill={shade} d="M40 4c2 17 23 14 20 30-4 20-37 18-40 0-2-11 7-16 8-22 5 4 4 9 6 13C39 19 33 12 40 4Z" /><path fill={fill} d="M41 23c-8 12-7 11-10 12-3 13 19 16 18 2-1-6-7-8-8-14Z" /></>
      case 'sand': return <><path opacity=".3" d="M10 40c18-5 40-5 60 0" />{Array.from({ length: 24 }, (_, n) => <circle key={n} cx={16 + (n * 17 % 49)} cy={14 + (n * 13 % 28)} r={n % 3 === 0 ? 1.2 : 0.7} fill="currentColor" opacity={0.35 + n % 4 * 0.2} />)}</>
      default: return <><circle cx="40" cy="27" r="17" fill={`url(#${id}-orb)`} /><path d="M25 21a16 16 0 0 1 26-6" stroke="var(--labs-symbol-light)" strokeWidth="1.1" /></>
    }
  })()
  return <svg className="labs-glyph labs-material-symbol" data-material={material} viewBox="0 0 80 54" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-face`} x1="0" y1="0" x2=".9" y2="1"><stop stopColor="var(--labs-symbol-light)" /><stop offset=".42" stopColor="var(--labs-symbol-mid)" /><stop offset="1" stopColor="var(--labs-symbol-deep)" /></linearGradient>
      <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--labs-symbol-mid)" stopOpacity=".7" /><stop offset="1" stopColor="var(--labs-symbol-deep)" /></linearGradient>
      <linearGradient id={`${id}-side`} x1="0" y1="0" x2="1" y2=".4"><stop stopColor="var(--labs-symbol-deep)" /><stop offset="1" stopColor="var(--labs-symbol-mid)" /></linearGradient>
      <radialGradient id={`${id}-orb`} cx="30%" cy="20%" r="80%"><stop stopColor="var(--labs-symbol-mid)" /><stop offset=".45" stopColor="var(--labs-symbol-deep)" /><stop offset="1" stopColor="var(--labs-bg)" /></radialGradient>
    </defs>
    <ellipse cx="40" cy="49" rx="24" ry="2" fill="currentColor" opacity=".06" stroke="none" />
    <g stroke="var(--labs-symbol-edge)" strokeWidth=".75" strokeLinejoin="round" fill="none">{image}</g>
  </svg>
}
