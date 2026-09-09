import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ParameterDef, ParamValue } from '@/rigs/types'
import { AudioKnob, type KnobMod, type KnobSize, type KnobTone } from '@/audio/AudioKnob'
import { AudioFader } from '@/audio/AudioFader'
import { AudioEnvelope } from '@/audio/AudioEnvelope'
import { AudioLfoShape } from '@/audio/AudioLfoShape'
import { ParameterField } from '@/ui/ParameterField'
import { LFO_COUNT } from '@/audio/fields'

/**
 * The face-plate, transcribed from the reference at its own scale.
 *
 * Every number in this file is a measurement in CSS pixels off a Retina capture of the reference
 * window: the plate is 1250 wide and 696 tall below its title bar, and each control is placed at
 * the coordinates the capture gave for it. Earlier versions laid the same controls out with grids
 * and flex boxes and asked the browser to distribute them, and the browser distributed them
 * differently from the reference every time; a fixed object does not flow, so nothing here does.
 * The stage scales the whole plate to fit whatever window it has, which is how the plugin itself
 * handles a window that is not its own size.
 *
 * What the controls do is ParamRig's. Two oscillators and two noise generators are the four
 * layers; the panels that act on one layer at a time — Comb, Filter, the amp envelope — follow
 * the layer whose badge is lit in the oscillator or noise head. A few controls the reference has
 * and this engine does not are drawn and inert, and say so in a title.
 */

const PLATE = { w: 1250, h: 696 }

/** Where a text's cap line sits below its box top at line-height 1, in ems; Roboto's metrics. */
const CAP = 0.054

type Num = Extract<ParameterDef, { kind: 'number' }>

type Ctx = {
  byId: Map<string, ParameterDef>
  values: Record<string, ParamValue>
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  focus: number
  setFocus: (index: number) => void
}
const num = (ctx: Ctx, id: string): Num | null => {
  const parameter = ctx.byId.get(id)
  return parameter && parameter.kind === 'number' ? (parameter as Num) : null
}
const read = (ctx: Ctx, id: string) => ctx.values[id] ?? ctx.byId.get(id)?.defaultValue
const readNum = (ctx: Ctx, id: string, fallback = 0) => {
  const value = read(ctx, id)
  return typeof value === 'number' ? value : fallback
}

/* ── Modulation ──────────────────────────────────────────────────────────────────────────────── */

/** The colour of each kind of source, as the reference paints its buttons. */
const SOURCE_COLOUR = { p: '#efa807', e: '#4576c4', l: '#6fb904', t: '#8d52a4', v: '#d0708b' } as const

/** The modulation target a parameter stands for, when an LFO may be pointed at it. */
const targetOf = (id: string): string | undefined => {
  const found = /^layers\[(\d)\]\.(pitch\.start|filter\.cutoff|source\.pulseWidth|gain)$/.exec(id)
  if (!found) return undefined
  const where: Record<string, string> = { 'pitch.start': 'pitch', 'filter.cutoff': 'cutoff', 'source.pulseWidth': 'pulseWidth', gain: 'gain' }
  return `layers[${found[1]}].${where[found[2] ?? ''] ?? ''}`
}

/** The LFO pointed at a target, if one is, as the arc the control will wear. */
const modOf = (ctx: Ctx, target: string | undefined): KnobMod | undefined => {
  if (!target) return undefined
  for (let index = 0; index < LFO_COUNT; index += 1) {
    if (read(ctx, `lfos[${index}].enabled`) === false || read(ctx, `lfos[${index}].target`) !== target) continue
    return { colour: SOURCE_COLOUR.l, depth: readNum(ctx, `lfos[${index}].depth`), onDepth: (next) => ctx.onChange(`lfos[${index}].depth`, next) }
  }
  return undefined
}

/* ── Placement ───────────────────────────────────────────────────────────────────────────────── */

/** A panel's top-left corner on the plate, so its children can be placed in plate coordinates. */
const Origin = createContext({ x: 0, y: 0 })
function useAt() {
  const origin = useContext(Origin)
  return (x: number, y: number): CSSProperties => ({ left: x - origin.x, top: y - origin.y })
}

function Panel({ x, y, w, h, label, tone, children }: { x: number; y: number; w: number; h: number; label: string; tone?: 'panel' | 'noise' | 'bare'; children: ReactNode }) {
  return (
    <Origin.Provider value={{ x, y }}>
      <section className="fp-panel" data-tone={tone ?? 'panel'} aria-label={label} style={{ left: x, top: y, width: w, height: h }}>
        {children}
      </section>
    </Origin.Provider>
  )
}

/** A word placed by the top of its capitals and, usually, its centre. */
function Text({ x, y, size = 13, align = 'center', kind, u, onClick, checked, label, children }: {
  x: number; y: number; size?: number; align?: 'center' | 'left' | 'right'
  kind?: 'label' | 'title' | 'bold' | 'macro' | 'digit' | 'dim' | 'source'
  u?: boolean; onClick?: () => void; checked?: boolean; label?: string; children: ReactNode
}) {
  const at = useAt()
  const style = { ...at(x, y - size * CAP), fontSize: size }
  if (onClick) {
    return (
      <button type="button" className="fp-text" data-align={align} data-kind={kind} data-u={u || undefined}
        role={checked === undefined ? undefined : 'radio'} aria-checked={checked} aria-label={label} style={style} onClick={onClick}>
        {children}
      </button>
    )
  }
  return <span className="fp-text" data-align={align} data-kind={kind} data-u={u || undefined} style={style}>{children}</span>
}

function Knob({ ctx, x, y, id, label, size = 'std', tone, digit, face, param, inert, dots }: {
  ctx: Ctx; x: number; y: number; id: string; label: string; size?: KnobSize; tone?: KnobTone; digit?: string | number; face?: ReactNode; param?: Num
  /** Drawn where the reference draws it, wired to nothing: the fraction of the turn it shows. */
  inert?: number
  /** The two dots at the ends of the arc that mark a bipolar range. */
  dots?: boolean
}) {
  const at = useAt()
  if (inert !== undefined) {
    return <AudioKnob param={{ kind: 'number', id: `inert.${label}`, label, group: '', min: 0, max: 1, step: 0.01, defaultValue: inert }} value={inert} size={size} tone={tone} style={at(x, y)} inert dots={dots} onChange={() => undefined} />
  }
  const parameter = param ?? num(ctx, id)
  if (!parameter) return <span className="fp-knob-empty" data-size={size} style={at(x, y)} aria-hidden="true"><Ring /></span>
  const current = read(ctx, id)
  const target = targetOf(id)
  return (
    <AudioKnob
      param={{ ...parameter, label }}
      value={typeof current === 'number' ? current : parameter.min}
      size={size}
      tone={tone}
      digit={digit}
      face={face}
      target={target}
      mod={modOf(ctx, target)}
      style={at(x, y)}
      onChange={(next) => ctx.onChange(id, next)}
      onGestureStart={ctx.onGestureStart}
      onGestureEnd={ctx.onGestureEnd}
    />
  )
}
const Ring = () => <svg className="fp-knob__ring" viewBox="0 0 100 100" aria-hidden="true"><path className="fp-knob__track" d="M14.645 85.355 A50 50 0 1 1 85.355 85.355" /></svg>

/** A knob over a list of options: the dial steps through them, the reference's way of choosing a shape. */
function OptionKnob({ ctx, x, y, id, label, options, size = 'sm' }: { ctx: Ctx; x: number; y: number; id: string; label: string; options: readonly string[]; size?: KnobSize }) {
  const at = useAt()
  const current = read(ctx, id)
  const index = Math.max(0, options.indexOf(typeof current === 'string' ? current : ''))
  const param: Num = { kind: 'number', id, label, group: '', min: 0, max: options.length - 1, step: 1, defaultValue: 0 }
  return (
    <AudioKnob param={param} value={index} size={size} style={at(x, y)}
      onChange={(next) => ctx.onChange(id, options[Math.round(next)] ?? options[0] ?? '')}
      onGestureStart={ctx.onGestureStart} onGestureEnd={ctx.onGestureEnd} />
  )
}

function Fader({ ctx, x, top, id, label, kind, digit }: { ctx: Ctx; x: number; top: number; id: string; label: string; kind?: 'osc' | 'noise'; digit?: string | number }) {
  const at = useAt()
  const parameter = num(ctx, id)
  if (!parameter) return null
  const current = read(ctx, id)
  const target = targetOf(id)
  return (
    <AudioFader param={{ ...parameter, label }} value={typeof current === 'number' ? current : parameter.min} kind={kind} digit={digit} target={target} mod={modOf(ctx, target)} style={at(x, top)}
      onChange={(next) => ctx.onChange(id, next)} onGestureStart={ctx.onGestureStart} onGestureEnd={ctx.onGestureEnd} />
  )
}

/** The reference's quiet grey box: mid-grey, dark text, a pixel of radius. Lighter when chosen. */
function Box({ x, y, w, h = 14.5, align = 'center', selected, onClick, label, checked, children }: {
  x: number; y: number; w: number; h?: number; align?: 'center' | 'right'; selected?: boolean; onClick?: () => void; label?: string; checked?: boolean; children: ReactNode
}) {
  const at = useAt()
  const style = { ...at(x, y), width: w, height: h, lineHeight: `${h}px` }
  if (onClick) {
    return <button type="button" className="fp-box" data-align={align} data-selected={selected || undefined} role={checked === undefined ? undefined : 'radio'} aria-checked={checked} aria-label={label} style={style} onClick={onClick}>{children}</button>
  }
  return <span className="fp-box" data-align={align} data-selected={selected || undefined} style={style}>{children}</span>
}

/** The little light-grey markers: a hexagon, a circle, a square, or the serrated square of a noise generator. */
function Badge({ x, y, kind, selected, onClick, label, tab, children }: {
  x: number; y: number; kind: 'hex' | 'circle' | 'square' | 'noise'; selected?: boolean; onClick?: () => void; label?: string; tab?: boolean; children: ReactNode
}) {
  const at = useAt()
  if (onClick) {
    return <button type="button" className="fp-badge" data-kind={kind} data-selected={selected || undefined} role={tab ? 'tab' : undefined} aria-selected={tab ? selected : undefined} aria-label={label} style={at(x, y)} onClick={onClick}>{children}</button>
  }
  return <span className="fp-badge" data-kind={kind} style={at(x, y)} aria-hidden="true">{children}</span>
}

/** A positioned block, placed by its top-left corner in plate coordinates. */
function Block({ x, y, w, h, className, off, children }: { x: number; y: number; w: number; h: number; className: string; off?: boolean; children: ReactNode }) {
  const at = useAt()
  return <div className={className} style={{ ...at(x, y), width: w, height: h }} data-off={off || undefined}>{children}</div>
}

/** A hairline, placed by its top-left corner. */
function Line({ x, y, w, h = 1, colour = '#000' }: { x: number; y: number; w: number; h?: number; colour?: string }) {
  const at = useAt()
  return <span className="fp-line" style={{ ...at(x, y), width: w, height: h, background: colour }} aria-hidden="true" />
}

/** A modulator's handle in the routing bar: picked up with the pointer and dropped on a control. */
function Grab({ x, y, label, held, children, ...handlers }: {
  x: number; y: number; label: string; held?: boolean; children: ReactNode
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onPointerMove?: (event: React.PointerEvent<HTMLElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void
  onPointerCancel: () => void
}) {
  const at = useAt()
  return (
    <span className="fp-icon fp-source__grab" role="button" tabIndex={-1} aria-label={label} data-held={held || undefined} style={{ ...at(x, y), width: 17.5, height: 14.5 }} {...handlers}>
      {children}
    </span>
  )
}

/** An icon placed by its centre. */
function Icon({ x, y, w, h, children, className }: { x: number; y: number; w: number; h: number; children: ReactNode; className?: string }) {
  const at = useAt()
  return <span className={`fp-icon${className ? ` ${className}` : ''}`} style={{ ...at(x, y), width: w, height: h }} aria-hidden="true">{children}</span>
}

/**
 * The reference's big readout: a note or a ratio sign, then the integer part in tall condensed
 * figures and the three decimals smaller, all on one baseline. Placed by the mark's left edge and
 * the baseline.
 */
function Readout({ x, base, mark, value }: { x: number; base: number; mark: 'note' | 'ratio' | 'none'; value: number }) {
  const at = useAt()
  const negative = value < 0
  const whole = Math.floor(Math.abs(value) + 0.0005)
  const frac = Math.round((Math.abs(value) - whole) * 1000) % 1000
  const shift = mark === 'ratio' ? 3 : 0
  return (
    <span className="fp-read" style={at(x, base)} aria-hidden="true">
      {mark === 'note' ? (
        <svg className="fp-read__mark" viewBox="0 0 6 12" style={{ left: 0, top: -12, width: 6, height: 12 }}>
          <path d="M4.5 0.2h1.1v9.4h-1.1z" fill="#8a8a8a" /><ellipse cx="2.95" cy="9.85" rx="3" ry="2.05" transform="rotate(-28 2.95 9.85)" fill="#8a8a8a" />
        </svg>
      ) : null}
      {mark === 'ratio' ? (
        <svg className="fp-read__mark" viewBox="0 0 12 11" style={{ left: 0, top: -11.5, width: 12, height: 11 }}>
          <circle cx="2.6" cy="2.6" r="2.1" fill="#8a8a8a" /><circle cx="9.4" cy="8.4" r="2.1" fill="#8a8a8a" /><path d="M1.2 10.2 10.8 0.8" stroke="#8a8a8a" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : null}
      {mark !== 'none' ? <i className="fp-read__u" style={{ left: -0.5, top: 0.5, width: mark === 'ratio' ? 13 : 9.5 }} /> : null}
      <span className="fp-read__row" style={{ left: 25 + shift, top: -12.5 - 17.6 * CAP }}>
        <b className="fp-read__big">{negative ? '-' : ''}{whole}</b>
        <i className="fp-read__dot" />
        <small className="fp-read__small">{String(frac).padStart(3, '0')}</small>
      </span>
    </span>
  )
}

/* ── Glyphs, as the reference draws them ─────────────────────────────────────────────────────── */

const WAVES = ['sine', 'triangle', 'saw', 'square'] as const
type Wave = typeof WAVES[number]
const WAVE_NAMES: Record<string, string> = { sine: 'Sine', triangle: 'Tri', saw: 'Saw', square: 'SQ' }
const waveOf = (value: unknown): Wave => (typeof value === 'string' && (WAVES as readonly string[]).includes(value) ? value as Wave : 'sine')

/** The wave on the face of a hero dial: one thin light line across the body. */
function WaveGlyph({ kind, wave }: { kind: unknown; wave: unknown }) {
  const d = kind === 'noise'
    ? 'M1 11 L4 4 L7 16 L10 7 L13 14 L16 3 L19 13 L22 8 L25 17 L28 5 L31 12 L34 6 L37 15 L40 9 L43 11'
    : wave === 'triangle' ? 'M1 11.5 L12 2 L34 21 L45 11.5'
    : wave === 'saw' ? 'M1 15 L11 11 L11 2 L45 14 L45 11.5'
    : wave === 'square' ? 'M1 11.5 L1 2 L23 2 L23 21 L45 21 L45 11.5'
    : 'M1 11.5 C8 -3 16 -3 23 11.5 S38 26 45 11.5'
  return (
    <svg viewBox="0 0 46 23" className="fp-waveglyph">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The big round wave icon of the phase-modulation row: a light disc with the wave cut through it. */
function WaveDisc({ wave }: { wave: Wave }) {
  const d = wave === 'triangle' ? 'M5 21 L13 11 L22 24 L30 14'
    : wave === 'saw' ? 'M5 22 L17 12 L17 22 L30 12'
    : wave === 'square' ? 'M5 22 V12 H17.5 V23 H30'
    : 'M5 17.5 C9 8 14 8 17.5 17.5 S26 27 30 17.5'
  return (
    <svg viewBox="0 0 35 35" style={{ width: 35, height: 35 }}>
      <circle cx="17.5" cy="17.5" r="17.5" fill="#9a9a9a" />
      <path d={d} fill="none" stroke="#2b2b2b" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The reference's ART flask: a cap, a neck, a body, a wave in the body. */
const Flask = () => (
  <svg viewBox="0 0 38 35" style={{ width: 38, height: 35 }}>
    <rect x="13" y="0" width="12" height="4" rx="2" fill="#9a9a9a" />
    <rect x="15.5" y="3" width="7" height="8" fill="#9a9a9a" />
    <path d="M15.5 10.5 L3.5 31 a2.6 2.6 0 0 0 2.3 4 H32.2 a2.6 2.6 0 0 0 2.3 -4 L22.5 10.5 Z" fill="#9a9a9a" />
    <path d="M9 27 l3 -4.5 l3 7 l3 -9 l3 8 l3 -5.5 l3 4" fill="none" stroke="#2b2b2b" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
)
/** Hardsync's three teeth. */
const Teeth = () => (
  <svg viewBox="0 0 38 34" style={{ width: 38, height: 34 }}>
    <path d="M0 34 V13 L11.5 34 Z M12.5 34 V0 L24.5 34 Z M25.5 34 V15 L38 34 Z" fill="#9a9a9a" />
  </svg>
)
/** The comb's exciter: a disc with an arch in it. */
const Bell = () => (
  <svg viewBox="0 0 38 35" style={{ width: 38, height: 35 }}>
    <circle cx="19" cy="17.5" r="17.5" fill="#9a9a9a" />
    <path d="M10 28 V19 a9 9.5 0 0 1 18 0 V28 Z" fill="#2b2b2b" />
    <path d="M14 28 V20 a5 5.5 0 0 1 10 0 V28 Z" fill="#9a9a9a" />
  </svg>
)
/** A burst of noise, drawn as the reference draws it: dense spikes, louder in the middle. */
function NoiseBurst({ seed }: { seed: number }) {
  let state = seed * 7919 + 13
  const rnd = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff }
  const bars: string[] = []
  for (let index = 0; index <= 75; index += 1) {
    const x = 0.25 + index * 0.5
    const env = Math.sin(((index + 0.5) / 76) * Math.PI) * 0.5 + 0.5
    const up = (0.25 + rnd() * 0.75) * 14.5 * env
    const down = (0.25 + rnd() * 0.75) * 14.5 * env
    bars.push(`M${x.toFixed(2)} ${(14.75 - up).toFixed(1)}V${(14.75 + down).toFixed(1)}`)
  }
  return (
    <svg viewBox="0 0 38 29.5" style={{ width: 38, height: 29.5 }}>
      <path d={bars.join('')} fill="none" stroke="#9a9a9a" strokeWidth="0.5" />
    </svg>
  )
}
const Plus = () => (
  <svg viewBox="0 0 13 13" style={{ width: 13, height: 13 }}>
    <circle cx="6.5" cy="6.5" r="6.5" fill="#9a9a9a" /><path d="M3 6.5h7M6.5 3v7" stroke="#262626" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)
const Pill = ({ curve }: { curve: 'vel' | 'fb' }) => (
  <svg viewBox="0 0 18.5 10.5" style={{ width: 18.5, height: 10.5 }}>
    <rect x="0" y="0" width="18.5" height="10.5" rx="5.25" fill="#555" />
    <path d={curve === 'vel' ? 'M4 8 Q7 2.8 15 2.8' : 'M4 8 H7.5 L11 3 H15'} fill="none" stroke="#1e1e1e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const Slash = () => (
  <svg viewBox="0 0 6 8" style={{ width: 6, height: 8 }}><path d="M0.8 7.2 5.2 0.8" stroke="#9a9a9a" strokeWidth="1.5" strokeLinecap="round" /></svg>
)
const MenuIcon = () => (
  <svg viewBox="0 0 17 9" style={{ width: 17, height: 9 }}><path d="M0 0.75h17M0 4.5h17M0 8.25h17" stroke="#767676" strokeWidth="1.5" /></svg>
)
const RoutingIcon = () => (
  <svg viewBox="0 0 16 12" style={{ width: 16, height: 12 }}>
    <path d="M2 2 L12 6 L2 10" fill="none" stroke="#767676" strokeWidth="1" />
    <rect x="0" y="0" width="4" height="4" fill="#767676" /><rect x="0" y="8" width="4" height="4" fill="#767676" /><rect x="12" y="4" width="4" height="4" fill="#767676" />
  </svg>
)
const MoveIcon = () => (
  <svg viewBox="0 0 17.5 14.5" style={{ width: 17.5, height: 14.5 }}>
    <path d="M8.75 1v12.5M2 7.25h13.5" stroke="#6a6a6a" strokeWidth="1.5" />
    <path d="M8.75 0 l2.4 3 h-4.8z M8.75 14.5 l2.4 -3 h-4.8z M1 7.25 l3 -2.4 v4.8z M16.5 7.25 l-3 -2.4 v4.8z" fill="#6a6a6a" />
  </svg>
)
const DinIcon = () => (
  <svg viewBox="0 0 17.5 14.5" style={{ width: 17.5, height: 14.5 }}>
    <path d="M8.75 0 a7.25 7.25 0 1 1 -0.01 0 z M6.5 13.6 h4.5 l-1 -2.2 h-2.5 z" fill="#eba806" fillRule="evenodd" />
    <circle cx="8.75" cy="3.4" r="1.1" fill="#262626" /><circle cx="5" cy="4.6" r="1.1" fill="#262626" /><circle cx="12.5" cy="4.6" r="1.1" fill="#262626" /><circle cx="3.6" cy="8.4" r="1.1" fill="#262626" /><circle cx="13.9" cy="8.4" r="1.1" fill="#262626" />
  </svg>
)

/** The thin bracket that gathers two dials towards the name of the stage they shape. */
function Bracket({ x0, x1, top, mid, tip, width }: { x0: number; x1: number; top: number; mid: number; tip: number; width: number }) {
  const at = useAt()
  const left = Math.min(x0, x1) - 1
  const w = Math.abs(x1 - x0) + 2
  const h = tip - top + 1
  const centre = (x0 + x1) / 2
  const gap = width / 2 + 5
  const rel = (x: number) => x - left
  return (
    <svg className="fp-bracket" style={{ ...at(left, top), width: w, height: h }} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`M${rel(x0)} 0 V${mid - top} L${rel(centre - gap)} ${tip - top}`} fill="none" stroke="#4e4e4e" strokeWidth="1" />
      <path d={`M${rel(x1)} 0 V${mid - top} L${rel(centre + gap)} ${tip - top}`} fill="none" stroke="#4e4e4e" strokeWidth="1" />
    </svg>
  )
}

/* ── The plate ───────────────────────────────────────────────────────────────────────────────── */

/** The sixteen macros. Which are wired follows the reference's own patch: 1–4 and 7–8. */
const MACROS: { label: string; id?: string }[] = [
  { label: 'Pos1', id: 'layers[0].pitch.start' },
  { label: 'Level1', id: 'layers[0].gain' },
  { label: 'Pos2', id: 'layers[1].pitch.start' },
  { label: 'Level2', id: 'layers[1].gain' },
  { label: '' }, { label: '' },
  { label: 'Attack', id: 'layers[0].amp.attack' },
  { label: 'Release', id: 'layers[0].amp.release' },
  { label: '' }, { label: '' }, { label: '' }, { label: '' }, { label: '' }, { label: '' }, { label: '' }, { label: '' },
]

/** Hertz as the reference's semitone readout: distance from A4, to the thousandth. */
const semitones = (hz: number) => (hz > 0 ? 12 * Math.log2(hz / 440) : 0)

const SOURCES: { id: string; kind: 'p' | 'e' | 'l' | 't' | 'v'; x: number; lfo?: number; fixed?: boolean }[] = [
  { id: 'P1', kind: 'p', x: 357.4 }, { id: 'P2', kind: 'p', x: 397.8 }, { id: 'P3', kind: 'p', x: 438.1 },
  { id: 'E1', kind: 'e', x: 518, fixed: true }, { id: 'L2', kind: 'l', x: 558.5, lfo: 0 }, { id: 'L3', kind: 'l', x: 598.8, lfo: 1 },
  { id: 'L4', kind: 'l', x: 679.3 }, { id: 'L5', kind: 'l', x: 719.5 }, { id: 'L6', kind: 'l', x: 759.7 },
  { id: 'E7', kind: 'e', x: 840 }, { id: 'L8', kind: 'l', x: 880.3 }, { id: 'L9', kind: 'l', x: 920.6 },
  { id: 'T1', kind: 't', x: 1001 }, { id: 'T2', kind: 't', x: 1041.5 }, { id: 'T3', kind: 't', x: 1081.8 }, { id: 'T4', kind: 't', x: 1122 },
  { id: 'VR', kind: 'v', x: 1202.3 },
]

const LFO_SHAPES = ['sine', 'triangle', 'square', 'saw', 'noise'] as const

export function AudioFacePlate({ parameters, values, duration, onChange, onGestureStart, onGestureEnd, slots }: {
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  duration: number
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  /** The strip of twelve along the foot: the document's kept sounds, one a slot. */
  slots?: { name: string; active: boolean; onPick: () => void }[]
}) {
  const [focus, setFocus] = useState(0)
  const ctx: Ctx = {
    byId: new Map(parameters.map((parameter) => [parameter.id, parameter])),
    values, onChange, onGestureStart, onGestureEnd, focus, setFocus,
  }
  const f = focus
  const L = (index: number, tail: string) => `layers[${index}].${tail}`
  const gesture = { onGestureStart, onGestureEnd }

  // The stage fits the plate to the room it has, as the plugin's window zoom does.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const plateRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  /**
   * Assigning a modulator the reference's way: pick up its handle in the routing bar and drop it
   * on a control. While it is held, every control that could take it lights its arc in the
   * source's colour, and a small badge of its name follows the pointer. The Target field in the
   * modulator's own panel does the same job for a keyboard.
   */
  const [assigning, setAssigning] = useState<number | null>(null)
  const ghostRef = useRef<HTMLSpanElement | null>(null)
  const follow = (event: { clientX: number; clientY: number }) => {
    const plate = plateRef.current?.getBoundingClientRect()
    const ghost = ghostRef.current
    if (!plate || !ghost) return
    ghost.style.left = `${(event.clientX - plate.left) / scale + 14}px`
    ghost.style.top = `${(event.clientY - plate.top) / scale - 9}px`
  }
  const pickUp = (index: number) => (event: React.PointerEvent<HTMLElement>) => {
    if (event.button && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setAssigning(index)
    follow(event)
  }
  const putDown = (event: React.PointerEvent<HTMLElement>) => {
    if (assigning === null) return
    const under = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY) : null
    const target = under?.closest?.('[data-target]')?.getAttribute('data-target')
    if (target) {
      onChange(`lfos[${assigning}].target`, target)
      if (read(ctx, `lfos[${assigning}].enabled`) === false) onChange(`lfos[${assigning}].enabled`, true)
    }
    setAssigning(null)
  }
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect || !rect.width || !rect.height) return
      setScale(Math.min(rect.width / PLATE.w, rect.height / PLATE.h))
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  /** The ART column of an oscillator: Hard is a tone, Neutral is noise, Nobody is silence. */
  const art = (index: number) => {
    const enabled = read(ctx, L(index, 'enabled')) !== false
    const kind = read(ctx, L(index, 'source.kind'))
    return !enabled ? 'nobody' : kind === 'noise' ? 'neutral' : 'hard'
  }
  const setArt = (index: number, mode: 'hard' | 'neutral' | 'nobody') => {
    if (mode === 'nobody') { onChange(L(index, 'enabled'), false); return }
    if (read(ctx, L(index, 'enabled')) === false) onChange(L(index, 'enabled'), true)
    onChange(L(index, 'source.kind'), mode === 'hard' ? 'tone' : 'noise')
  }
  const filterKind = read(ctx, L(f, 'filter.kind'))
  const setFilter = (kind: string) => onChange(L(f, 'filter.kind'), filterKind === kind ? 'off' : kind)
  const colourName = (index: number) => {
    const colour = read(ctx, L(index, 'source.colour'))
    return colour === 'pink' ? 'Pink' : colour === 'metallic' ? 'Metal' : 'White'
  }
  const cycleColour = (index: number) => {
    const order = ['white', 'pink', 'metallic']
    const current = read(ctx, L(index, 'source.colour'))
    onChange(L(index, 'source.colour'), order[(order.indexOf(typeof current === 'string' ? current : 'white') + 1) % order.length] ?? 'white')
  }
  const cycleWave = (index: number) => {
    const wave = waveOf(read(ctx, L(index, 'source.wave')))
    onChange(L(index, 'source.wave'), WAVES[(WAVES.indexOf(wave) + 1) % WAVES.length] ?? 'sine')
  }

  return (
    <div className="fp-stage" ref={stageRef} style={{ '--fp-scale': scale } as CSSProperties}>
      <div className="fp" role="group" aria-label="Face-plate" ref={plateRef} data-assigning={assigning === null ? undefined : ''} style={{ width: PLATE.w, height: PLATE.h, '--assign': SOURCE_COLOUR.l } as CSSProperties}>
        <span className="fp-ghost" ref={ghostRef} aria-hidden="true">{assigning === null ? '' : `L${assigning + 2}`}</span>
        {/* ═══ Macro band ═══ */}
        <Origin.Provider value={{ x: 0, y: 0 }}>
          <div className="fp-band" role="group" aria-label="Macros" style={{ left: 0, top: 0, width: PLATE.w, height: 53 }}>
            <Text x={5} y={19.5} align="left" kind="bold">PB</Text>
            <span className="fp-wheel" style={{ left: 31, top: 11 }} aria-hidden="true"><i style={{ top: 12 }} /></span>
            <Text x={72.5} y={19.5} align="left" kind="bold">M</Text>
            <span className="fp-wheel" style={{ left: 95, top: 11 }} aria-hidden="true"><i style={{ top: 22.5 }} /></span>
            <Text x={136} y={19.5} align="left" kind="bold">AT</Text>
            <span className="fp-at" style={{ left: 168.3, top: 24.8 }} aria-hidden="true" />
            {MACROS.map((macro, index) => {
              const cx = 258 + 64.25 * index
              return (
                <span key={index} className="fp-macro" data-wired={macro.id ? '' : undefined}>
                  <Text x={cx - 28.3} y={19.5} kind="digit">{index + 1}</Text>
                  {macro.id
                    ? <Knob ctx={ctx} x={cx} y={25} id={macro.id} label={macro.label} size="macro" />
                    : <span className="fp-knob-empty" data-size="macro" style={{ left: cx, top: 25 }} aria-hidden="true"><Ring /></span>}
                  {macro.label ? <Text x={cx} y={40.5} kind="macro">{macro.label}</Text> : null}
                </span>
              )
            })}
          </div>
          <Line x={0} y={52.5} w={PLATE.w} h={1.5} />
        </Origin.Provider>

        {/* ═══ Main row ═══ */}
        <Panel x={0} y={54} w={67} h={288} label="Pitch" tone="bare">
          <Text x={32} y={59.5} kind="title">Pitch</Text>
          <Readout x={0} base={96.5} mark="none" value={duration} />
          <Box x={10.5} y={106.5} w={41} align="right">0.00</Box>
          <Box x={10.5} y={122.5} w={41} align="right">0.00</Box>
          <Box x={12.5} y={214} w={39} h={16.5}>Glide</Box>
          <Text x={31.8} y={261}>Time</Text>
          <Knob ctx={ctx} x={31.5} y={298.7} id="duration" label="Time" tone="light" />
        </Panel>

        <Panel x={68} y={54} w={515} h={288} label="Oscillators">
          {/* the head */}
          <Text x={204.5} y={60} kind="title" u onClick={() => cycleWave(0)} label={`Oscillator 1 wave: ${WAVE_NAMES[waveOf(read(ctx, L(0, 'source.wave')))]}`}>Sin-Tri-Saw-SQ</Text>
          <span role="tablist" aria-label="Oscillator layer" className="fp-tabs">
            <Badge x={281} y={65} kind="hex" tab selected={f === 0} onClick={() => setFocus(0)} label="Oscillator 1">1</Badge>
            <Badge x={369.5} y={65} kind="hex" tab selected={f === 1} onClick={() => setFocus(1)} label="Oscillator 2">2</Badge>
          </span>
          <Text x={324} y={60} kind="title">Wavetable</Text>
          <Text x={446.2} y={60} kind="title" u onClick={() => cycleWave(1)} label={`Oscillator 2 wave: ${WAVE_NAMES[waveOf(read(ctx, L(1, 'source.wave')))]}`}>SQ-Sin-Saw</Text>
          <Line x={325} y={54} w={1} h={215.5} colour="#050505" />
          {/* oscillator 1 */}
          <Readout x={72.5} base={96.5} mark="note" value={semitones(readNum(ctx, L(0, 'pitch.start'), 440))} />
          <Box x={83} y={106.5} w={40.5} align="right">0.00</Box>
          <Box x={83} y={122.5} w={40.5} align="right">0.00</Box>
          <Text x={104.2} y={148.5} u>ART</Text>
          <Icon x={104} y={182} w={38} h={35}><Flask /></Icon>
          <span role="radiogroup" aria-label="Oscillator 1 mode">
            <Text x={103.2} y={203.5} u checked={art(0) === 'hard'} onClick={() => setArt(0, 'hard')}>Hard</Text>
            <Text x={104.9} y={220} u checked={art(0) === 'neutral'} onClick={() => setArt(0, 'neutral')}>Neutral</Text>
            <Text x={105.4} y={235} u checked={art(0) === 'nobody'} onClick={() => setArt(0, 'nobody')}>Nobody</Text>
          </span>
          <Knob ctx={ctx} x={204.5} y={128.4} id={L(0, 'pitch.start')} label="Pos1" size="hero" digit={1} face={<WaveGlyph kind={read(ctx, L(0, 'source.kind'))} wave={read(ctx, L(0, 'source.wave'))} />} />
          <Text x={166.9} y={184}>Width</Text>
          <Text x={240.7} y={184.5}>Pitch</Text>
          <Knob ctx={ctx} x={166.9} y={225.5} id={L(0, 'source.pulseWidth')} label="Width" />
          <Knob ctx={ctx} x={240.7} y={226.2} id={L(0, 'pitch.slide')} label="Pitch" />
          <Fader ctx={ctx} x={298} top={85.5} id={L(0, 'gain')} label="Level1" digit={2} />
          <Box x={286} y={203} w={24.5}>PM1</Box>
          <Box x={286} y={219} w={24.5}>Aux</Box>
          <Box x={286} y={235} w={24.5}>PM2</Box>
          {/* oscillator 2 */}
          <Fader ctx={ctx} x={352.5} top={85.5} id={L(1, 'gain')} label="Level2" digit={4} />
          <Box x={340.5} y={203} w={24.5}>PM1</Box>
          <Box x={340.5} y={219} w={24.5}>Aux</Box>
          <Box x={340.5} y={235} w={24.5}>PM2</Box>
          <Knob ctx={ctx} x={445.8} y={128.2} id={L(1, 'pitch.start')} label="Pos2" size="hero" digit={3} face={<WaveGlyph kind={read(ctx, L(1, 'source.kind'))} wave={read(ctx, L(1, 'source.wave'))} />} />
          <Text x={409.3} y={184}>2nd Lev</Text>
          <Text x={482} y={184.5}>Ratio</Text>
          <Knob ctx={ctx} x={409.3} y={225.5} id={L(1, 'source.detune')} label="2nd Lev" />
          <Knob ctx={ctx} x={482} y={226.3} id={L(1, 'source.fmRatio')} label="Ratio" />
          <Readout x={518} base={96.5} mark="note" value={semitones(readNum(ctx, L(1, 'pitch.start'), 440))} />
          <Box x={525.5} y={106.5} w={40.5} align="right">0.00</Box>
          <Box x={525.5} y={122.5} w={40.5} align="right">0.00</Box>
          <Text x={547.5} y={147} u>Hardsync</Text>
          <Icon x={547} y={182} w={38} h={34}><Teeth /></Icon>
          <span role="radiogroup" aria-label="Oscillator 2 mode">
            <Text x={546.2} y={204.5} u checked={art(1) === 'hard'} onClick={() => setArt(1, 'hard')}>Hard</Text>
            <Text x={547.8} y={220} u checked={art(1) === 'neutral'} onClick={() => setArt(1, 'neutral')}>Neutral</Text>
            <Text x={548} y={235} u checked={art(1) === 'nobody'} onClick={() => setArt(1, 'nobody')}>Nobody</Text>
          </span>
          {/* the foot, with its notched rim */}
          <svg className="fp-osc-foot" viewBox="0 0 515 14" style={{ left: 0, top: 203, width: 515, height: 14 }} aria-hidden="true">
            <path d="M0 0.5 H61 L77 12.5 H438 L454 0.5 H515" fill="none" stroke="#000" strokeWidth="1" />
            <path d="M0 1.5 H61.5 L77.5 13.5 H437.5 L453.5 1.5 H515" fill="none" stroke="#161616" strokeWidth="1" />
          </svg>
          <Readout x={70.5} base={281} mark="ratio" value={readNum(ctx, L(0, 'source.fmRatio'), 1)} />
          <Box x={83} y={291.5} w={40.5} align="right">0.00</Box>
          <Box x={83} y={307.5} w={40.5} align="right">0.00</Box>
          <Text x={203.8} y={272} u onClick={() => cycleWave(0)} label={`Oscillator 1 wave: ${WAVE_NAMES[waveOf(read(ctx, L(0, 'source.wave')))]}`}>{WAVE_NAMES[waveOf(read(ctx, L(0, 'source.wave')))]}</Text>
          <Icon x={204.6} y={306.3} w={35} h={35}><WaveDisc wave={waveOf(read(ctx, L(0, 'source.wave')))} /></Icon>
          <Text x={277.2} y={273}>PM1</Text>
          <Text x={325.5} y={274}>Aux</Text>
          <Text x={373.8} y={273}>PM2</Text>
          <Knob ctx={ctx} x={277.2} y={305.9} id={L(0, 'source.fmIndex')} label="PM1" size="sm" />
          <Knob ctx={ctx} x={325.5} y={306} id={L(0, 'source.fmFall')} label="Aux" size="sm" />
          <Knob ctx={ctx} x={373.8} y={305.9} id={L(1, 'source.fmIndex')} label="PM2" size="sm" />
          <Text x={447.3} y={272} u onClick={() => cycleWave(1)} label={`Oscillator 2 wave: ${WAVE_NAMES[waveOf(read(ctx, L(1, 'source.wave')))]}`}>{WAVE_NAMES[waveOf(read(ctx, L(1, 'source.wave')))]}</Text>
          <Icon x={445.9} y={306.4} w={35} h={35}><WaveDisc wave={waveOf(read(ctx, L(1, 'source.wave')))} /></Icon>
          <Readout x={512.5} base={281} mark="ratio" value={readNum(ctx, L(1, 'source.fmRatio'), 1)} />
          <Box x={525.5} y={291.5} w={40.5} align="right">0.00</Box>
          <Box x={525.5} y={307.5} w={40.5} align="right">0.00</Box>
        </Panel>

        <Panel x={599.5} y={54} w={95} h={288} label="Noise" tone="noise">
          <span role="tablist" aria-label="Noise layer" className="fp-tabs">
            <Badge x={604} y={65} kind="noise" tab selected={f === 2} onClick={() => setFocus(2)} label="Noise 1">1</Badge>
            <Badge x={673} y={65} kind="noise" tab selected={f === 3} onClick={() => setFocus(3)} label="Noise 2">2</Badge>
          </span>
          <Text x={639} y={59.5} kind="title">Noise</Text>
          <Fader ctx={ctx} x={615} top={87.5} id={L(2, 'gain')} label="Noise 1 level" kind="noise" />
          <Fader ctx={ctx} x={663} top={87.5} id={L(3, 'gain')} label="Noise 2 level" kind="noise" />
          <Text x={614.7} y={204} u onClick={() => cycleColour(2)} label={`Noise 1 colour: ${colourName(2)}`}>{colourName(2)}</Text>
          <Text x={661.8} y={204.5} u onClick={() => cycleColour(3)} label={`Noise 2 colour: ${colourName(3)}`}>{colourName(3)}</Text>
          <Icon x={614.8} y={239.2} w={38} h={29.5}><NoiseBurst seed={1} /></Icon>
          <Icon x={663.2} y={239} w={38} h={29.5}><NoiseBurst seed={2} /></Icon>
          <Icon x={591.5} y={278} w={6} h={8}><Slash /></Icon>
          <Line x={588} y={284.5} w={7} h={0.5} colour="#8a8a8a" />
          <Text x={614} y={273}>Pitch</Text>
          <Icon x={638.5} y={278} w={6} h={8}><Slash /></Icon>
          <Line x={635} y={284.5} w={7} h={0.5} colour="#8a8a8a" />
          <Text x={662} y={273}>Pitch</Text>
          <Knob ctx={ctx} x={614.9} y={306.7} id={L(2, 'pitch.start')} label="Noise 1 pitch" size="sm" tone="light" />
          <Knob ctx={ctx} x={663} y={306.7} id={L(3, 'pitch.start')} label="Noise 2 pitch" size="sm" tone="light" />
        </Panel>

        <Panel x={696.5} y={54} w={159} h={288} label="Comb">
          <Badge x={707.5} y={65} kind="circle">F</Badge>
          <Text x={775.8} y={59.5} kind="title" u>Comb</Text>
          <Text x={731.3} y={83} u>Exciter</Text>
          <Icon x={731.5} y={121.6} w={38} h={35}><Bell /></Icon>
          <Readout x={788} base={96.5} mark="note" value={semitones(readNum(ctx, L(f, 'resonator.frequency'), 440))} />
          <Box x={799} y={106.5} w={40.5} align="right">0.00</Box>
          <Box x={799} y={122.5} w={40.5} align="right">0.00</Box>
          <Box x={748.5} y={150.5} w={55} selected={readNum(ctx, L(f, 'resonator.amount')) > 0}>FBW</Box>
          <Text x={777} y={168.5}>FB</Text>
          <Icon x={803.9} y={174.7} w={13} h={13}><Plus /></Icon>
          <Knob ctx={ctx} x={775.2} y={210} id={L(f, 'resonator.amount')} label="FB" />
          <Text x={739.9} y={257}>AP Freq</Text>
          <Text x={811.4} y={257}>LP Freq</Text>
          <Knob ctx={ctx} x={739.9} y={298.4} id={L(f, 'resonator.frequency')} label="AP Freq" />
          <Knob ctx={ctx} x={811.4} y={298.4} id={L(f, 'resonator.decay')} label="LP Freq" />
        </Panel>

        <Panel x={857} y={54} w={160} h={288} label="Filter">
          <span role="radiogroup" aria-label="Filter mode">
            <Badge x={868.5} y={65.5} kind="circle">A</Badge>
            <Text x={881} y={60} align="left" kind="title" u={filterKind === 'lowpass'} checked={filterKind === 'lowpass'} onClick={() => setFilter('lowpass')}>Fold</Text>
            <Badge x={921} y={65.5} kind="circle">B</Badge>
            <Text x={932.5} y={60} align="left" kind="title" u={filterKind === 'highpass'} checked={filterKind === 'highpass'} onClick={() => setFilter('highpass')}>ANM</Text>
            <Badge x={973.5} y={65.5} kind="circle">C</Badge>
            <Text x={985.5} y={60} align="left" kind="title" u={filterKind === 'bandpass'} checked={filterKind === 'bandpass'} onClick={() => setFilter('bandpass')}>RM</Text>
          </span>
          <Text x={900.5} y={79.5}>Pitch</Text>
          <Text x={972.4} y={80}>Mix</Text>
          <Knob ctx={ctx} x={900.5} y={122} id={L(f, 'filter.cutoff')} label="Pitch" />
          <Knob ctx={ctx} x={972.4} y={121.2} id={L(f, 'filter.resonance')} label="Mix" />
          <Text x={900} y={171.5}>FB</Text>
          <Icon x={922.5} y={178} w={13} h={13}><Plus /></Icon>
          <Text x={972.7} y={172.5}>Smear</Text>
          <Knob ctx={ctx} x={900.2} y={209.6} id={L(f, 'filter.envAmount')} label="FB" />
          <Knob ctx={ctx} x={972.7} y={210.4} id={L(f, 'shaper.drive')} label="Smear" />
          <Text x={894.5} y={275}>Amount</Text>
          <Box x={921.5} y={299.5} w={30.5}>Fast</Box>
          <Text x={981.5} y={273.5}>Rate</Text>
          <Knob ctx={ctx} x={892.6} y={306.9} id={L(f, 'shaper.bitDepth')} label="Amount" size="sm" />
          <Knob ctx={ctx} x={980.7} y={306.8} id={L(f, 'shaper.crush')} label="Rate" size="sm" />
        </Panel>

        <Panel x={1018.5} y={54} w={70.5} h={288} label="Amp" tone="bare">
          <Text x={1053.5} y={60} kind="title">Amp</Text>
          <Text x={1053.5} y={83.5}>Level</Text>
          <Knob ctx={ctx} x={1053} y={120.9} id="master.gain" label="Level" tone="light" />
          <Text x={1052.4} y={172.5}>Pan</Text>
          <Knob ctx={ctx} x={1053.3} y={210} id="fx.width" label="Pan" tone="light" />
          <Text x={1054.5} y={261}>FB</Text>
          <Icon x={1073.75} y={266.25} w={18.5} h={10.5}><Pill curve="fb" /></Icon>
          <Knob ctx={ctx} x={1053.6} y={297.9} id="master.limiter" label="FB" tone="light" />
        </Panel>

        <Panel x={1090.5} y={54} w={159.5} h={288} label="FX">
          <Badge x={1100.5} y={65} kind="square">X</Badge>
          <Text x={1112} y={60} align="left" kind="title">QCho</Text>
          <Badge x={1152.5} y={65} kind="square">Y</Badge>
          <Text x={1163.5} y={60} align="left" kind="title">Verb</Text>
          <Badge x={1205} y={65} kind="square">Z</Badge>
          <Text x={1216} y={60} align="left" kind="title" u>EQ</Text>
          <Line x={1090.5} y={165.5} w={159.5} h={0.5} colour="#989897" />
          <Line x={1090.5} y={254} w={159.5} h={0.5} colour="#989897" />
          <Text x={1118} y={84}>Freq</Text>
          <Text x={1169.5} y={84}>Hi Gain</Text>
          <Knob ctx={ctx} x={1117.8} y={122} id="fx.flangerRate" label="Freq" size="sm" />
          <Knob ctx={ctx} x={1169.9} y={122} id="fx.flangerMix" label="Hi Gain" />
          <Text x={1118} y={172.5}>Freq</Text>
          <Text x={1168} y={172}>Mid Gain</Text>
          <Text x={1222.3} y={173}>Q</Text>
          <Knob ctx={ctx} x={1117.8} y={210.4} id="fx.delayTime" label="Freq" size="sm" />
          <Knob ctx={ctx} x={1169.9} y={210.3} id="fx.delayMix" label="Mid Gain" />
          <Knob ctx={ctx} x={1222} y={210.4} id="fx.delayFeedback" label="Q" size="sm" />
          <Text x={1170.2} y={261}>Low Gain</Text>
          <Knob ctx={ctx} x={1169.9} y={298.8} id="fx.reverbMix" label="Low Gain" />
        </Panel>
        <Origin.Provider value={{ x: 0, y: 0 }}>
          <Line x={0} y={342} w={PLATE.w} h={1.5} />
        </Origin.Provider>

        {/* ═══ Routing bar ═══ */}
        <Origin.Provider value={{ x: 0, y: 343.5 }}>
          <div className="fp-routing" role="group" aria-label="Routing bar" style={{ left: 0, top: 343.5, width: PLATE.w, height: 39 }}>
            <Icon x={40.75} y={373} w={17} h={9}><MenuIcon /></Icon>
            <Text x={65} y={367.5} align="left" kind="dim">Voice</Text>
            <Icon x={177.25} y={373} w={16} h={12}><RoutingIcon /></Icon>
            <Text x={196.5} y={367.5} align="left" kind="dim">Routing</Text>
            <span className="fp-sources__box" style={{ left: 502, top: 364 - 343.5 }} aria-hidden="true" />
            <ul className="fp-sources" role="list" aria-label="Routing">
              {SOURCES.map((source) => (
                <li key={source.id} className="fp-source" data-kind={source.kind} data-live={source.lfo !== undefined || source.fixed || undefined}>
                  {source.lfo !== undefined ? (
                    <Grab x={source.x} y={352.6} label={`Drag ${source.id} onto a control to modulate it`} held={assigning === source.lfo}
                      onPointerDown={pickUp(source.lfo)} onPointerMove={assigning === source.lfo ? follow : undefined} onPointerUp={putDown} onPointerCancel={() => setAssigning(null)}>
                      <MoveIcon />
                    </Grab>
                  ) : (
                    <Icon x={source.x} y={352.6} w={17.5} h={14.5} className={source.fixed ? 'fp-source__fixed' : undefined}><MoveIcon /></Icon>
                  )}
                  <Text x={source.x + 1} y={367.5} kind="source">{source.id}</Text>
                </li>
              ))}
            </ul>
          </div>
        </Origin.Provider>
        <Origin.Provider value={{ x: 0, y: 0 }}>
          <Line x={0} y={382.5} w={PLATE.w} h={1.5} />
        </Origin.Provider>

        {/* ═══ Modulators ═══ */}
        <Panel x={0} y={384} w={413.5} h={288} label="Amp envelope">
          <Text x={2.5} y={389.5} align="left" kind="title">Modulator 1</Text>
          <Text x={205.5} y={389} kind="title">Amp-Envelope</Text>
          <Text x={70.9} y={413.5}>Shape</Text>
          <Text x={120.8} y={413.5}>Peak</Text>
          <Text x={209} y={413.5}>Shape</Text>
          <Text x={257.5} y={413.5}>Sustain</Text>
          <Icon x={305.75} y={429.25} w={18.5} h={10.5}><Pill curve="vel" /></Icon>
          <Text x={315} y={423.5} align="left">Vel</Text>
          <Text x={370.5} y={413}>Env Level</Text>
          <Knob ctx={ctx} x={71.7} y={451.6} id={L(f, 'amp.curve')} label="Shape" size="sm" />
          <Knob ctx={ctx} x={119.6} y={450.9} id="" label="Peak" size="sm" inert={0.62} />
          <Knob ctx={ctx} x={208.5} y={451.7} id="" label="Shape" size="sm" inert={0.5} />
          <Knob ctx={ctx} x={256.4} y={450.8} id={L(f, 'amp.sustain')} label="Sustain" size="sm" />
          <Knob ctx={ctx} x={317.5} y={450.8} id="" label="Vel" size="sm" inert={0.2} dots />
          <Knob ctx={ctx} x={369.1} y={450.8} id={L(f, 'gain')} label="Env Level" tone="light" />
          <Bracket x0={40} x1={151} top={474} mid={486.5} tip={500} width={8} />
          <Bracket x0={177.5} x1={287.5} top={474} mid={486.5} tip={500} width={11.5} />
          <Text x={96} y={500}>A</Text>
          <Text x={232.4} y={499.5}>D</Text>
          <Text x={368.6} y={499.5}>R</Text>
          <Text x={27.6} y={510}>Delay</Text>
          <Text x={164.8} y={510}>Hold</Text>
          <Text x={300.9} y={510}>Hold</Text>
          <Knob ctx={ctx} x={27.8} y={547.1} id={L(f, 'offset')} label="Delay" size="sm" />
          <Knob ctx={ctx} x={96} y={539.4} id={L(f, 'amp.attack')} label="A" digit={f === 0 ? 7 : undefined} />
          <Knob ctx={ctx} x={164.6} y={547.2} id={L(f, 'amp.hold')} label="Hold" size="sm" />
          <Knob ctx={ctx} x={232.6} y={540} id={L(f, 'amp.decay')} label="D" />
          <Knob ctx={ctx} x={301.4} y={547.1} id="" label="Hold" size="sm" inert={0.2} />
          <Knob ctx={ctx} x={369.7} y={539.7} id={L(f, 'amp.release')} label="R" digit={f === 0 ? 8 : undefined} />
          <Line x={0} y={583.5} w={413.5} h={1} colour="#282828" />
          <Text x={40.4} y={592} u>Gate</Text>
          <Block className="fp-plot" x={82} y={595.5} w={318} h={62}>
            <AudioEnvelope layer={f} values={values} duration={duration} onChange={onChange} height={62} pad={1} {...gesture} />
          </Block>
        </Panel>

        {[0, 1].map((index) => {
          const o = 418.3 * (index + 1)
          const px = index === 0 ? 414.5 : 832.5
          const pw = 417.5
          const id = (tail: string) => `lfos[${index}].${tail}`
          const target = ctx.byId.get(id('target'))
          const on = read(ctx, id('enabled')) !== false
          return (
            <Panel key={index} x={px} y={384} w={pw} h={288} label={`LFO ${index + 1}`}>
              <Text x={2.5 + o} y={389.5} align="left" kind="title">Modulator {index + 2}</Text>
              <Text x={203.3 + o} y={389} kind="title" u onClick={() => onChange(id('enabled'), !on)} label={`Modulator ${index + 2} ${on ? 'on' : 'off'}`}>Switcher LFO</Text>
              <Text x={70.9 + o} y={413.5}>Shape</Text>
              <Text x={120.8 + o} y={413.5}>Delay</Text>
              <Text x={368.6 + o} y={413}>LFO Level</Text>
              <OptionKnob ctx={ctx} x={71.7 + o} y={451.6} id={id('shape')} label="Shape" options={LFO_SHAPES} />
              <Knob ctx={ctx} x={119.6 + o} y={450.9} id={id('phase')} label="Delay" size="sm" />
              <Knob ctx={ctx} x={369.1 + o} y={450.8} id={id('depth')} label="LFO Level" tone="light" />
              <Text x={96 + o} y={500}>Rate</Text>
              <Knob ctx={ctx} x={96 + o} y={539.4} id={id('rate')} label="Rate" />
              <Line x={px} y={583.5} w={pw} h={1} colour="#282828" />
              <Text x={38.4 + o} y={592} u>Target</Text>
              <Block className="fp-target" x={10 + o} y={609} w={105} h={14.5}>
                {target ? (
                  <ParameterField param={target} value={read(ctx, id('target')) ?? target.defaultValue} onChange={(next) => onChange(id('target'), next)} {...gesture} />
                ) : null}
              </Block>
              <Block className="fp-plot" x={125 + o} y={596.5} w={274} h={60} off={!on}>
                <AudioLfoShape index={index} values={values} duration={duration} />
              </Block>
            </Panel>
          )
        })}
        <Origin.Provider value={{ x: 0, y: 0 }}>
          <Line x={413.5} y={384} w={1} h={288} colour="#050505" />
          <Line x={832} y={384} w={1} h={288} colour="#050505" />
          <Line x={0} y={672} w={PLATE.w} h={1} />
        </Origin.Provider>

        {/* ═══ The strip of kept sounds ═══ */}
        <Origin.Provider value={{ x: 0, y: 673 }}>
          <div className="fp-strip" role="group" aria-label="Kept sounds" style={{ left: 0, top: 673, width: PLATE.w, height: 23 }}>
            <Icon x={14.75} y={684.25} w={17.5} h={14.5}><DinIcon /></Icon>
            {Array.from({ length: 12 }, (_, index) => {
              const slot = slots?.[index]
              const x = index === 0 ? 168 : 255.5 + 90.5 * (index - 1)
              const w = index === 0 ? 84 : 89.5
              return (
                <button type="button" key={index} className="fp-slot" data-filled={slot ? '' : undefined} data-active={slot?.active || undefined}
                  style={{ left: x, top: 2, width: w, height: 18.5 }} disabled={!slot} aria-label={slot ? `Kept sound ${index + 1}: ${slot.name}` : `Empty slot ${index + 1}`} onClick={slot?.onPick}>
                  {index + 1}
                </button>
              )
            })}
          </div>
        </Origin.Provider>
      </div>
    </div>
  )
}
