import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ParameterDef, ParamValue } from '@/rigs/types'
import { AudioKnob, type KnobMod, type KnobSize, type KnobTone } from '@/audio/AudioKnob'
import { AudioFader } from '@/audio/AudioFader'
import { AudioEnvelope } from '@/audio/AudioEnvelope'
import { ParameterField } from '@/ui/ParameterField'
import { LFO_COUNT, MOD_ENVELOPE_COUNT } from '@/audio/fields'

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

/**
 * The source pointed at a target, if one is, as the arc the control will wear: a free envelope in
 * its blue, an LFO in its green. Two sources on one control add in the engine; the arc shows the
 * first.
 */
const modOf = (ctx: Ctx, target: string | undefined): KnobMod | undefined => {
  if (!target) return undefined
  for (let index = 0; index < MOD_ENVELOPE_COUNT; index += 1) {
    const id = `envelopes[${index}]`
    if (read(ctx, `${id}.enabled`) === false || read(ctx, `${id}.target`) !== target) continue
    return { colour: SOURCE_COLOUR.e, depth: readNum(ctx, `${id}.depth`), bipolar: false, onDepth: (next) => ctx.onChange(`${id}.depth`, next), onClear: () => ctx.onChange(`${id}.target`, 'off') }
  }
  for (let index = 0; index < LFO_COUNT; index += 1) {
    const id = `lfos[${index}]`
    if (read(ctx, `${id}.enabled`) === false || read(ctx, `${id}.target`) !== target) continue
    return { colour: SOURCE_COLOUR.l, depth: readNum(ctx, `${id}.depth`), onDepth: (next) => ctx.onChange(`${id}.depth`, next), onClear: () => ctx.onChange(`${id}.target`, 'off') }
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
  // Macro-band dials keep the index to their left; they do not wear a red digit on the face.
  const shownDigit = size === 'macro' ? undefined : (digit ?? macroDigit(id))
  return (
    <AudioKnob
      param={{ ...parameter, label }}
      value={typeof current === 'number' ? current : parameter.min}
      size={size}
      tone={tone}
      digit={shownDigit}
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
  // Half a step of room either side, so the hand points at the middle of a sector rather than its edge.
  const param: Num = { kind: 'number', id, label, group: '', min: -0.5, max: options.length - 0.5, step: 1, defaultValue: 0 }
  return (
    <AudioKnob param={param} value={index} size={size} style={at(x, y)}
      onChange={(next) => ctx.onChange(id, options[Math.min(options.length - 1, Math.max(0, Math.round(next)))] ?? options[0] ?? '')}
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
    <AudioFader param={{ ...parameter, label }} value={typeof current === 'number' ? current : parameter.min} kind={kind} digit={digit ?? macroDigit(id)} target={target} mod={modOf(ctx, target)} style={at(x, top)}
      onChange={(next) => ctx.onChange(id, next)} onGestureStart={ctx.onGestureStart} onGestureEnd={ctx.onGestureEnd} />
  )
}

/** The reference's quiet grey box: mid-grey, dark text, a pixel of radius. Lighter when chosen. */
function Box({ x, y, w, h = 14.5, align = 'center', selected, onClick, label, checked, pressed, children }: {
  x: number; y: number; w: number; h?: number; align?: 'center' | 'right'; selected?: boolean; onClick?: () => void; label?: string; checked?: boolean; pressed?: boolean; children: ReactNode
}) {
  const at = useAt()
  const style = { ...at(x, y), width: w, height: h, lineHeight: `${h}px` }
  if (onClick) {
    return <button type="button" className="fp-box" data-align={align} data-selected={selected || undefined} role={checked === undefined ? undefined : 'radio'} aria-checked={checked} aria-pressed={pressed} aria-label={label} style={style} onClick={onClick}>{children}</button>
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

/** How a readout edits its number: the reference's, dragged up and down, doubled-clicked to reset. */
type Edit = {
  get: () => number
  set: (next: number) => void
  reset: () => void
  perPx: number
  step: number
  min: number
  max: number
  text: (value: number) => string
}

/**
 * The reference's big readout: a note or a ratio sign, then the whole part in tall condensed
 * figures and the three decimals smaller, all on one baseline. Placed by the mark's left edge and
 * the baseline. Given an edit, it is a control: a vertical drag moves the number, a double-click
 * puts it back, and the arrow keys step it.
 */
function Readout({ x, base, mark, value, label, edit }: { x: number; base: number; mark: 'note' | 'ratio' | 'none'; value: number; label?: string; edit?: Edit }) {
  const at = useAt()
  const origin = useRef({ y: 0, start: 0 })
  const dragging = useRef(false)
  const negative = value < 0
  const whole = Math.floor(Math.abs(value) + 0.0005)
  const frac = Math.round((Math.abs(value) - whole) * 1000) % 1000
  const shift = mark === 'ratio' ? 3 : 0
  const clamp = (next: number) => Math.min(edit?.max ?? next, Math.max(edit?.min ?? next, next))
  const figures = (
    <span className="fp-read__anchor">
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
  if (!edit) return <span className="fp-read" style={at(x, base)} aria-hidden="true">{figures}</span>
  return (
    <div
      className="fp-read"
      data-edit=""
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={edit.min}
      aria-valuemax={edit.max}
      aria-valuenow={Number(value.toFixed(3))}
      aria-valuetext={edit.text(value)}
      style={{ ...at(x - 2, base - 14), width: 66 + shift, height: 17 }}
      onPointerDown={(event) => {
        if (event.button && event.button !== 0) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        dragging.current = true
        origin.current = { y: event.clientY, start: edit.get() }
      }}
      onPointerMove={(event) => { if (dragging.current) edit.set(clamp(origin.current.start + (origin.current.y - event.clientY) * edit.perPx)) }}
      onPointerUp={(event) => { if (!dragging.current) return; dragging.current = false; event.currentTarget.releasePointerCapture?.(event.pointerId) }}
      onPointerCancel={() => { dragging.current = false }}
      onDoubleClick={edit.reset}
      onKeyDown={(event) => {
        const forward = event.key === 'ArrowUp' || event.key === 'ArrowRight'
        const back = event.key === 'ArrowDown' || event.key === 'ArrowLeft'
        if (!forward && !back) return
        event.preventDefault()
        edit.set(clamp(edit.get() + (forward ? 1 : -1) * edit.step * (event.shiftKey ? 0.1 : 1)))
      }}
    >
      {figures}
    </div>
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

/**
 * A burst of noise, drawn as the reference draws it: dense spikes, louder in the middle. Its
 * colour shows in the drawing — white even, pink leaning low and slow, metallic sparse and tall.
 */
function NoiseBurst({ seed, colour }: { seed: number; colour: unknown }) {
  let state = seed * 7919 + 13
  const rnd = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff }
  const bars: string[] = []
  const count = colour === 'metallic' ? 25 : 76
  let slow = 0.5
  for (let index = 0; index <= count; index += 1) {
    const x = 0.25 + (index / count) * 37.5
    const env = Math.sin(((index + 0.5) / (count + 1)) * Math.PI) * 0.5 + 0.5
    slow = slow * 0.7 + rnd() * 0.3
    const amp = colour === 'pink' ? 0.35 + slow * 0.65 : 0.25 + rnd() * 0.75
    const up = amp * 14.5 * env
    const down = (colour === 'pink' ? 0.35 + slow * 0.65 : 0.25 + rnd() * 0.75) * 14.5 * env
    bars.push(`M${x.toFixed(2)} ${(14.75 - up).toFixed(1)}V${(14.75 + down).toFixed(1)}`)
  }
  return (
    <svg viewBox="0 0 38 29.5" style={{ width: 38, height: 29.5 }}>
      <path d={bars.join('')} fill="none" stroke="#9a9a9a" strokeWidth={colour === 'metallic' ? '0.9' : '0.5'} />
    </svg>
  )
}
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

/**
 * The Switcher LFO's shape wheel: a band of waveforms round a central dial, the chosen one lit in
 * the source's green with a line from the dial to it. The reference spreads sixteen shapes round
 * its band; this engine has five, so five sectors share the same two hundred and seventy degrees.
 */
const WHEEL = { r1: 72, r2: 102, span: 270, start: 135 }
const LFO_SHAPES = ['sine', 'triangle', 'square', 'saw', 'noise'] as const
const LFO_GLYPH: Record<string, string> = {
  sine: 'M-7 0 C-5 -6 -2 -6 0 0 S5 6 7 0',
  triangle: 'M-7 3 L-3.5 -4 L3.5 4 L7 -3',
  square: 'M-7 3 V-4 H0 V4 H7 V-3',
  saw: 'M-7 3 L-1 -4 V3 L6 -4',
  noise: 'M-7 1 L-5 -4 L-3 3 L-1 -2 L1 4 L3 -3 L5 2 L7 -1',
}
const polar = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180
  return `${(r * Math.cos(rad)).toFixed(2)} ${(r * Math.sin(rad)).toFixed(2)}`
}
function ShapeWheel({ x, y, value, label, onPick }: { x: number; y: number; value: string; label: string; onPick: (shape: string) => void }) {
  const at = useAt()
  const { r1, r2, span, start } = WHEEL
  const step = span / LFO_SHAPES.length
  const chosen = Math.max(0, LFO_SHAPES.indexOf(value as typeof LFO_SHAPES[number]))
  const mid = start + step * (chosen + 0.5)
  return (
    <svg className="fp-shapes" viewBox={`${-r2 - 1} ${-r2 - 1} ${2 * r2 + 2} ${2 * r2 + 2}`} style={{ ...at(x, y), width: 2 * r2 + 2, height: 2 * r2 + 2 }} role="radiogroup" aria-label={label}>
      {LFO_SHAPES.map((shape, index) => {
        const a0 = start + step * index
        const a1 = a0 + step
        const centre = a0 + step / 2
        const d = `M${polar(r2, a0)} A${r2} ${r2} 0 0 1 ${polar(r2, a1)} L${polar(r1, a1)} A${r1} ${r1} 0 0 0 ${polar(r1, a0)} Z`
        return (
          <g key={shape} className="fp-shapes__sector" data-chosen={index === chosen || undefined} role="radio" aria-checked={index === chosen} aria-label={shape} tabIndex={-1} onClick={() => onPick(shape)}>
            <path className="fp-shapes__band" d={d} />
            <path className="fp-shapes__glyph" d={LFO_GLYPH[shape]} transform={`translate(${polar((r1 + r2) / 2, centre).replace(' ', ',')}) rotate(${centre - 270})`} />
          </g>
        )
      })}
      {LFO_SHAPES.map((_, index) => index > 0 ? <path key={index} className="fp-shapes__rule" d={`M${polar(r1, start + step * index)} L${polar(r2, start + step * index)}`} /> : null)}
      <path className="fp-shapes__pointer" d={`M${polar(26, mid)} L${polar(r1 - 2, mid)}`} />
      <circle className="fp-shapes__dot" cx={Number(polar(26, mid).split(' ')[0])} cy={Number(polar(26, mid).split(' ')[1])} r="2.2" />
    </svg>
  )
}

/** The thin bracket that gathers two dials towards the name of the stage under them. */
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

/**
 * The sixteen macros, every one wired: the reference's first eight as it names them, then the
 * eight this engine reaches for next. A dial a macro drives wears its number in red.
 */
const MACROS: { label: string; id: string }[] = [
  { label: 'Pos1', id: 'layers[0].pitch.start' },
  { label: 'Level1', id: 'layers[0].gain' },
  { label: 'Pos2', id: 'layers[1].pitch.start' },
  { label: 'Level2', id: 'layers[1].gain' },
  { label: 'Cutoff', id: 'layers[0].filter.cutoff' },
  { label: 'Reso', id: 'layers[0].filter.resonance' },
  { label: 'Attack', id: 'layers[0].amp.attack' },
  { label: 'Release', id: 'layers[0].amp.release' },
  { label: 'Drive', id: 'layers[0].shaper.drive' },
  { label: 'Body', id: 'layers[0].resonator.frequency' },
  { label: 'Ring', id: 'layers[0].resonator.decay' },
  { label: 'Delay', id: 'fx.delayMix' },
  { label: 'Verb', id: 'fx.reverbMix' },
  { label: 'Width', id: 'fx.width' },
  { label: 'Limit', id: 'master.limiter' },
  { label: 'Fade', id: 'master.fadeOut' },
]
const macroDigit = (id: string) => {
  const index = MACROS.findIndex((macro) => macro.id === id)
  return index < 0 ? undefined : index + 1
}

/** Hertz as the reference's semitone readout: distance from A4, to the thousandth. */
const semitones = (hz: number) => (hz > 0 ? 12 * Math.log2(hz / 440) : 0)
const hertz = (st: number) => 440 * Math.pow(2, st / 12)

/** A modulation source of the routing bar: which slot it is, which page of panels shows it. */
type Source = { id: string; kind: 'e' | 'l'; x: number; page: number; lfo?: number; envelope?: number }
const SOURCES: Source[] = [
  { id: 'E1', kind: 'e', x: 518, page: 0 },
  { id: 'E2', kind: 'e', x: 558.5, page: 0, envelope: 0 },
  { id: 'E3', kind: 'e', x: 598.8, page: 0, envelope: 1 },
  { id: 'L4', kind: 'l', x: 679.3, page: 1, lfo: 0 },
  { id: 'L5', kind: 'l', x: 719.5, page: 1, lfo: 1 },
  { id: 'L6', kind: 'l', x: 759.7, page: 1, lfo: 2 },
  { id: 'L7', kind: 'l', x: 840, page: 2, lfo: 3 },
  { id: 'L8', kind: 'l', x: 880.3, page: 2, lfo: 4 },
  { id: 'L9', kind: 'l', x: 920.6, page: 2, lfo: 5 },
]
/** The three slots' left edges. */
const SLOT_X = [0, 414.5, 832.5]
/** Where the box behind the visible trio sits, a page each. */
const PAGE_BOX = [502, 663, 824]
/** The slot a modulator's property path names, or null. */
const held = (source: Source): { path: string; id: string } | null =>
  source.lfo !== undefined ? { path: `lfos[${source.lfo}]`, id: source.id }
  : source.envelope !== undefined ? { path: `envelopes[${source.envelope}]`, id: source.id }
  : null

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
  const [assigning, setAssigning] = useState<Source | null>(null)
  const [page, setPage] = useState(0)
  /** The LFOs the page shows, and the slot of the three each takes. */
  const lfosOnPage = page === 0 ? [] : [0, 1, 2].map((slot) => ({ index: (page - 1) * 3 + slot, slot }))
  const ghostRef = useRef<HTMLSpanElement | null>(null)
  const follow = (event: { clientX: number; clientY: number }) => {
    const plate = plateRef.current?.getBoundingClientRect()
    const ghost = ghostRef.current
    if (!plate || !ghost) return
    ghost.style.left = `${(event.clientX - plate.left) / scale + 14}px`
    ghost.style.top = `${(event.clientY - plate.top) / scale - 9}px`
  }
  const pickUp = (source: Source) => (event: React.PointerEvent<HTMLElement>) => {
    if (event.button && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setAssigning(source)
    follow(event)
  }
  const putDown = (event: React.PointerEvent<HTMLElement>) => {
    const slot = assigning ? held(assigning) : null
    if (!slot) { setAssigning(null); return }
    const under = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY) : null
    const target = under?.closest?.('[data-target]')?.getAttribute('data-target')
    if (target) {
      onChange(`${slot.path}.target`, target)
      if (read(ctx, `${slot.path}.enabled`) === false) onChange(`${slot.path}.enabled`, true)
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

  /** An oscillator's source column: a tone, noise, or nothing at all. */
  const source = (index: number) => {
    const enabled = read(ctx, L(index, 'enabled')) !== false
    return !enabled ? 'off' : read(ctx, L(index, 'source.kind')) === 'noise' ? 'noise' : 'tone'
  }
  const setSource = (index: number, mode: 'tone' | 'noise' | 'off') => {
    if (mode === 'off') { onChange(L(index, 'enabled'), false); return }
    if (read(ctx, L(index, 'enabled')) === false) onChange(L(index, 'enabled'), true)
    onChange(L(index, 'source.kind'), mode)
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

  /** A pitch readout edits its parameter in semitones, whatever the parameter counts in. */
  const pitchEdit = (id: string): Edit | undefined => {
    const parameter = num(ctx, id)
    if (!parameter) return undefined
    return {
      get: () => semitones(readNum(ctx, id, 440)),
      set: (st) => onChange(id, Math.min(parameter.max, Math.max(parameter.min, Math.round(hertz(st))))),
      reset: () => onChange(id, parameter.defaultValue),
      perPx: 0.1, step: 1, min: semitones(parameter.min), max: semitones(parameter.max),
      text: (st) => `${st.toFixed(2)} semitones, ${Math.round(hertz(st))} Hz`,
    }
  }
  const ratioEdit = (id: string): Edit | undefined => {
    const parameter = num(ctx, id)
    if (!parameter) return undefined
    return {
      get: () => readNum(ctx, id, 1),
      set: (next) => onChange(id, Number(next.toFixed(3))),
      reset: () => onChange(id, parameter.defaultValue),
      perPx: 0.01, step: 0.05, min: parameter.min, max: parameter.max,
      text: (ratio) => `ratio ${ratio.toFixed(3)}`,
    }
  }
  const seed = readNum(ctx, 'seed', 0)

  /** The wave picker at the head of an oscillator: the four waves of the table, the chosen one lit. */
  const wavePicker = (index: number, left: number) => {
    const wave = waveOf(read(ctx, L(index, 'source.wave')))
    const widths = { sine: 25, triangle: 16, saw: 24, square: 18 }
    let x = left
    return (
      <span role="radiogroup" aria-label={`Oscillator ${index + 1} wave`}>
        {WAVES.map((entry) => {
          const here = x
          x += widths[entry] + 9
          return <Text key={entry} x={here} y={60} align="left" kind="title" u={entry === wave} checked={entry === wave} onClick={() => onChange(L(index, 'source.wave'), entry)}>{WAVE_NAMES[entry]}</Text>
        })}
      </span>
    )
  }

  /** An oscillator's side column: jitter, the source, the unison voices. Mirrored for the second. */
  const sideColumn = (index: number, cx: number) => (
    <>
      <Text x={cx} y={98} size={11}>Jitter</Text>
      <Knob ctx={ctx} x={cx} y={131} id={L(index, 'pitch.jitter')} label="Jitter" size="sm" />
      <Text x={cx} y={154} size={11}>Source</Text>
      <span role="radiogroup" aria-label={`Oscillator ${index + 1} source`}>
        <Text x={cx} y={167} size={11} u checked={source(index) === 'tone'} onClick={() => setSource(index, 'tone')}>Tone</Text>
        <Text x={cx} y={181} size={11} u checked={source(index) === 'noise'} onClick={() => setSource(index, 'noise')}>Noise</Text>
        <Text x={cx} y={195} size={11} u checked={source(index) === 'off'} onClick={() => setSource(index, 'off')}>Off</Text>
      </span>
      <Text x={cx} y={210} size={11}>Voices</Text>
      <Knob ctx={ctx} x={cx} y={242.5} id={L(index, 'source.voices')} label="Voices" size="sm" />
    </>
  )

  return (
    <div className="fp-stage" ref={stageRef} style={{ '--fp-scale': scale } as CSSProperties}>
      <div className="fp" role="group" aria-label="Face-plate" ref={plateRef} data-assigning={assigning ? '' : undefined} style={{ width: PLATE.w, height: PLATE.h, '--assign': SOURCE_COLOUR[assigning?.kind ?? 'l'] } as CSSProperties}>
        <span className="fp-ghost" ref={ghostRef} aria-hidden="true">{assigning?.id ?? ''}</span>
        {/* ═══ Macro band ═══ */}
        <Origin.Provider value={{ x: 0, y: 0 }}>
          <div className="fp-band" role="group" aria-label="Macros" style={{ left: 0, top: 0, width: PLATE.w, height: 53 }}>
            <Text x={5} y={19.5} align="left" kind="bold">Seed</Text>
            <Box x={40} y={12} w={62} h={16.5} onClick={() => onChange('seed', Math.floor(Math.random() * 10000))} label={`Seed ${seed}; click for another`}>{seed}</Box>
            {MACROS.map((macro, index) => {
              const cx = 258 + 64.25 * index
              return (
                <span key={index} className="fp-macro" data-wired="">
                  <Text x={cx - 28.3} y={19.5} kind="digit">{index + 1}</Text>
                  <Knob ctx={ctx} x={cx} y={25} id={macro.id} label={macro.label} size="macro" />
                  <Text x={cx} y={40.5} kind="macro">{macro.label}</Text>
                </span>
              )
            })}
          </div>
          <Line x={0} y={52.5} w={PLATE.w} h={1.5} />
        </Origin.Provider>

        {/* ═══ Main row ═══ */}
        <Panel x={0} y={54} w={67} h={288} label="Pitch" tone="bare">
          <Text x={32} y={59.5} kind="title">Pitch</Text>
          <Readout x={-18} base={96.5} mark="none" value={semitones(readNum(ctx, L(f, 'pitch.start'), 440))} label={`Layer ${f + 1} pitch`} edit={pitchEdit(L(f, 'pitch.start'))} />
          <Text x={32} y={104}>Arp Ratio</Text>
          <Knob ctx={ctx} x={32} y={137} id={L(f, 'pitch.arpeggioRatio')} label="Arp Ratio" size="sm" />
          <Text x={32} y={156}>Arp At</Text>
          <Knob ctx={ctx} x={32} y={189} id={L(f, 'pitch.arpeggioAt')} label="Arp At" size="sm" />
          <Text x={32} y={208}>Detune</Text>
          <Knob ctx={ctx} x={32} y={241} id={L(f, 'source.detune')} label="Detune" size="sm" />
          <Text x={31.8} y={261}>Time</Text>
          <Knob ctx={ctx} x={31.5} y={298.7} id="duration" label="Time" tone="light" />
        </Panel>

        <Panel x={68} y={54} w={515} h={288} label="Oscillators">
          {/* the head */}
          {wavePicker(0, 149.5)}
          <span role="tablist" aria-label="Oscillator layer" className="fp-tabs">
            <Badge x={281} y={65} kind="hex" tab selected={f === 0} onClick={() => setFocus(0)} label="Oscillator 1">1</Badge>
            <Badge x={369.5} y={65} kind="hex" tab selected={f === 1} onClick={() => setFocus(1)} label="Oscillator 2">2</Badge>
          </span>
          <Text x={324} y={60} kind="title">Osc</Text>
          {wavePicker(1, 391.2)}
          <Line x={325} y={54} w={1} h={215.5} colour="#050505" />
          {/* oscillator 1 */}
          <Readout x={72.5} base={96.5} mark="note" value={semitones(readNum(ctx, L(0, 'pitch.start'), 440))} label="Oscillator 1 pitch" edit={pitchEdit(L(0, 'pitch.start'))} />
          {sideColumn(0, 104)}
          <Knob ctx={ctx} x={204.5} y={128.4} id={L(0, 'pitch.start')} label="Pos1" size="hero" face={<WaveGlyph kind={read(ctx, L(0, 'source.kind'))} wave={read(ctx, L(0, 'source.wave'))} />} />
          <Text x={166.9} y={184}>Width</Text>
          <Text x={240.7} y={184.5}>Slide</Text>
          <Knob ctx={ctx} x={166.9} y={225.5} id={L(0, 'source.pulseWidth')} label="Width" />
          <Knob ctx={ctx} x={240.7} y={226.2} id={L(0, 'pitch.slide')} label="Slide" />
          <Fader ctx={ctx} x={298} top={85.5} id={L(0, 'gain')} label="Level1" />
          {/* oscillator 2 */}
          <Fader ctx={ctx} x={352.5} top={85.5} id={L(1, 'gain')} label="Level2" />
          <Knob ctx={ctx} x={445.8} y={128.2} id={L(1, 'pitch.start')} label="Pos2" size="hero" face={<WaveGlyph kind={read(ctx, L(1, 'source.kind'))} wave={read(ctx, L(1, 'source.wave'))} />} />
          <Text x={409.3} y={184}>Width</Text>
          <Text x={482} y={184.5}>Slide</Text>
          <Knob ctx={ctx} x={409.3} y={225.5} id={L(1, 'source.pulseWidth')} label="Width" />
          <Knob ctx={ctx} x={482} y={226.3} id={L(1, 'pitch.slide')} label="Slide" />
          <Readout x={518} base={96.5} mark="note" value={semitones(readNum(ctx, L(1, 'pitch.start'), 440))} label="Oscillator 2 pitch" edit={pitchEdit(L(1, 'pitch.start'))} />
          {sideColumn(1, 547.5)}
          {/* the foot, with its notched rim: phase modulation between the two */}
          <svg className="fp-osc-foot" viewBox="0 0 515 14" style={{ left: 0, top: 203, width: 515, height: 14 }} aria-hidden="true">
            <path d="M0 0.5 H61 L77 12.5 H438 L454 0.5 H515" fill="none" stroke="#000" strokeWidth="1" />
            <path d="M0 1.5 H61.5 L77.5 13.5 H437.5 L453.5 1.5 H515" fill="none" stroke="#161616" strokeWidth="1" />
          </svg>
          <Readout x={70.5} base={289} mark="ratio" value={readNum(ctx, L(0, 'source.fmRatio'), 1)} label="Oscillator 1 modulator ratio" edit={ratioEdit(L(0, 'source.fmRatio'))} />
          <Text x={203.8} y={280} u onClick={() => cycleWave(0)} label={`Oscillator 1 wave: ${WAVE_NAMES[waveOf(read(ctx, L(0, 'source.wave')))]}`}>{WAVE_NAMES[waveOf(read(ctx, L(0, 'source.wave')))]}</Text>
          <Icon x={204.6} y={314.3} w={35} h={35}><WaveDisc wave={waveOf(read(ctx, L(0, 'source.wave')))} /></Icon>
          <Text x={277.2} y={281}>PM1</Text>
          <Text x={325.5} y={282}>Fall</Text>
          <Text x={373.8} y={281}>PM2</Text>
          <Knob ctx={ctx} x={277.2} y={313.9} id={L(0, 'source.fmIndex')} label="PM1" size="sm" />
          <Knob ctx={ctx} x={325.5} y={314} id={L(0, 'source.fmFall')} label="Fall" size="sm" />
          <Knob ctx={ctx} x={373.8} y={313.9} id={L(1, 'source.fmIndex')} label="PM2" size="sm" />
          <Text x={447.3} y={280} u onClick={() => cycleWave(1)} label={`Oscillator 2 wave: ${WAVE_NAMES[waveOf(read(ctx, L(1, 'source.wave')))]}`}>{WAVE_NAMES[waveOf(read(ctx, L(1, 'source.wave')))]}</Text>
          <Icon x={445.9} y={314.4} w={35} h={35}><WaveDisc wave={waveOf(read(ctx, L(1, 'source.wave')))} /></Icon>
          <Readout x={512.5} base={289} mark="ratio" value={readNum(ctx, L(1, 'source.fmRatio'), 1)} label="Oscillator 2 modulator ratio" edit={ratioEdit(L(1, 'source.fmRatio'))} />
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
          <Icon x={614.8} y={239.2} w={38} h={29.5}><NoiseBurst seed={1} colour={read(ctx, L(2, 'source.colour'))} /></Icon>
          <Icon x={663.2} y={239} w={38} h={29.5}><NoiseBurst seed={2} colour={read(ctx, L(3, 'source.colour'))} /></Icon>
          <Text x={614.9} y={273}>Pitch</Text>
          <Text x={663} y={273}>Pitch</Text>
          <Knob ctx={ctx} x={614.9} y={306.7} id={L(2, 'pitch.start')} label="Noise 1 pitch" size="sm" tone="light" />
          <Knob ctx={ctx} x={663} y={306.7} id={L(3, 'pitch.start')} label="Noise 2 pitch" size="sm" tone="light" />
        </Panel>

        <Panel x={696.5} y={54} w={159} h={288} label="Body">
          <Badge x={707.5} y={65} kind="circle">B</Badge>
          <Text x={775.8} y={59.5} kind="title">Body</Text>
          <Text x={731.3} y={83}>Partials</Text>
          <Knob ctx={ctx} x={731.5} y={121.6} id={L(f, 'resonator.partials')} label="Partials" size="sm" />
          <Readout x={788} base={96.5} mark="note" value={semitones(readNum(ctx, L(f, 'resonator.frequency'), 440))} label="Body pitch" edit={pitchEdit(L(f, 'resonator.frequency'))} />
          <Text x={819} y={104}>Spread</Text>
          <Knob ctx={ctx} x={819} y={138} id={L(f, 'resonator.spread')} label="Spread" size="sm" />
          <Text x={777} y={168.5}>Amount</Text>
          <Knob ctx={ctx} x={775.2} y={210} id={L(f, 'resonator.amount')} label="Amount" />
          <Text x={739.9} y={257}>Freq</Text>
          <Text x={811.4} y={257}>Ring</Text>
          <Knob ctx={ctx} x={739.9} y={298.4} id={L(f, 'resonator.frequency')} label="Freq" />
          <Knob ctx={ctx} x={811.4} y={298.4} id={L(f, 'resonator.decay')} label="Ring" />
        </Panel>

        <Panel x={857} y={54} w={160} h={288} label="Filter">
          <span role="radiogroup" aria-label="Filter mode">
            <Badge x={868.5} y={65.5} kind="circle">A</Badge>
            <Text x={881} y={60} align="left" kind="title" u={filterKind === 'lowpass'} checked={filterKind === 'lowpass'} onClick={() => setFilter('lowpass')}>Low</Text>
            <Badge x={921} y={65.5} kind="circle">B</Badge>
            <Text x={932.5} y={60} align="left" kind="title" u={filterKind === 'highpass'} checked={filterKind === 'highpass'} onClick={() => setFilter('highpass')}>High</Text>
            <Badge x={973.5} y={65.5} kind="circle">C</Badge>
            <Text x={984} y={60} align="left" kind="title" u={filterKind === 'bandpass'} checked={filterKind === 'bandpass'} onClick={() => setFilter('bandpass')}>Band</Text>
          </span>
          <Text x={900.5} y={79.5}>Cutoff</Text>
          <Text x={972.4} y={80}>Reso</Text>
          <Knob ctx={ctx} x={900.5} y={122} id={L(f, 'filter.cutoff')} label="Cutoff" />
          <Knob ctx={ctx} x={972.4} y={121.2} id={L(f, 'filter.resonance')} label="Reso" />
          <Text x={900.2} y={167.5}>Env</Text>
          <Text x={972.7} y={168.5}>Drive</Text>
          <Knob ctx={ctx} x={900.2} y={209.6} id={L(f, 'filter.envAmount')} label="Env" />
          <Knob ctx={ctx} x={972.7} y={210.4} id={L(f, 'shaper.drive')} label="Drive" />
          <Text x={892.6} y={275}>Bits</Text>
          <Text x={980.7} y={273.5}>Crush</Text>
          <Knob ctx={ctx} x={892.6} y={306.9} id={L(f, 'shaper.bitDepth')} label="Bits" size="sm" />
          <Knob ctx={ctx} x={980.7} y={306.8} id={L(f, 'shaper.crush')} label="Crush" size="sm" />
        </Panel>

        <Panel x={1018.5} y={54} w={70.5} h={288} label="Amp" tone="bare">
          <Text x={1053.5} y={60} kind="title">Amp</Text>
          <Text x={1053.5} y={83.5}>Level</Text>
          <Knob ctx={ctx} x={1053} y={121} id="master.gain" label="Level" tone="light" />
          <Text x={1053.5} y={160.5}>Width</Text>
          <Knob ctx={ctx} x={1053.3} y={198} id="fx.width" label="Width" tone="light" />
          <Text x={1053.5} y={224.5}>Limit</Text>
          <Knob ctx={ctx} x={1053.6} y={262} id="master.limiter" label="Limit" tone="light" />
          <Text x={1053.5} y={280.5}>Tone</Text>
          <Knob ctx={ctx} x={1053.6} y={318} id="fx.tone" label="Tone" tone="light" />
        </Panel>

        <Panel x={1090.5} y={54} w={159.5} h={288} label="FX">
          <Badge x={1100.5} y={65} kind="square">X</Badge>
          <Text x={1110} y={60} align="left" kind="title">Flanger</Text>
          <Text x={1118} y={80}>Rate</Text>
          <Text x={1169.5} y={80}>Mix</Text>
          <Text x={1222} y={80}>Depth</Text>
          <Knob ctx={ctx} x={1117.8} y={122} id="fx.flangerRate" label="Flanger rate" size="sm" />
          <Knob ctx={ctx} x={1169.9} y={122} id="fx.flangerMix" label="Flanger mix" />
          <Knob ctx={ctx} x={1222} y={122} id="fx.flangerDepth" label="Flanger depth" size="sm" />
          <Line x={1090.5} y={143} w={159.5} h={0.5} colour="#989897" />
          <Badge x={1100.5} y={154} kind="square">Y</Badge>
          <Text x={1110} y={149} align="left" kind="title">Delay</Text>
          <Text x={1118} y={172.5}>Time</Text>
          <Text x={1169.5} y={172.5}>Mix</Text>
          <Text x={1222} y={172.5}>Feed</Text>
          <Knob ctx={ctx} x={1117.8} y={210.4} id="fx.delayTime" label="Delay time" size="sm" />
          <Knob ctx={ctx} x={1169.9} y={210.3} id="fx.delayMix" label="Delay mix" />
          <Knob ctx={ctx} x={1222} y={210.4} id="fx.delayFeedback" label="Delay feedback" size="sm" />
          <Line x={1090.5} y={232} w={159.5} h={0.5} colour="#989897" />
          <Badge x={1100.5} y={243} kind="square">Z</Badge>
          <Text x={1110} y={238} align="left" kind="title">Reverb</Text>
          <Text x={1118} y={261}>Size</Text>
          <Text x={1169.5} y={261}>Mix</Text>
          <Text x={1222} y={261}>Damp</Text>
          <Knob ctx={ctx} x={1117.8} y={298.8} id="fx.reverbSize" label="Reverb size" size="sm" />
          <Knob ctx={ctx} x={1169.9} y={298.8} id="fx.reverbMix" label="Reverb mix" />
          <Knob ctx={ctx} x={1222} y={298.8} id="fx.reverbDamping" label="Reverb damping" size="sm" />
        </Panel>
        <Origin.Provider value={{ x: 0, y: 0 }}>
          <Line x={0} y={342} w={PLATE.w} h={1.5} />
        </Origin.Provider>

        {/* ═══ Routing bar: the sources, three of them shown below at a time ═══ */}
        <Origin.Provider value={{ x: 0, y: 343.5 }}>
          <div className="fp-routing" role="group" aria-label="Routing bar" style={{ left: 0, top: 343.5, width: PLATE.w, height: 39 }}>
            <span className="fp-sources__box" style={{ left: PAGE_BOX[page], top: 364 - 343.5 }} aria-hidden="true" />
            <ul className="fp-sources" role="list" aria-label="Routing">
              {SOURCES.map((source) => (
                <li key={source.id} className="fp-source" data-kind={source.kind} data-live="">
                  {held(source) ? (
                    <Grab x={source.x} y={352.6} label={`Drag ${source.id} onto a control to modulate it`} held={assigning?.id === source.id}
                      onPointerDown={pickUp(source)} onPointerMove={assigning?.id === source.id ? follow : undefined} onPointerUp={putDown} onPointerCancel={() => setAssigning(null)}>
                      <MoveIcon />
                    </Grab>
                  ) : (
                    <Icon x={source.x} y={352.6} w={17.5} h={14.5} className="fp-source__fixed"><MoveIcon /></Icon>
                  )}
                  <Text x={source.x + 1} y={367.5} kind="source" onClick={() => setPage(source.page)} label={`Show modulator ${source.id}`}>{source.id}</Text>
                </li>
              ))}
            </ul>
          </div>
        </Origin.Provider>
        <Origin.Provider value={{ x: 0, y: 0 }}>
          <Line x={0} y={382.5} w={PLATE.w} h={1.5} />
        </Origin.Provider>

        {/* ═══ Modulators: three of nine at a time, the page the routing bar chose ═══ */}
        {page === 0 ? (
          <Panel x={0} y={384} w={413.5} h={288} label="Amp envelope">
            <Text x={2.5} y={389.5} align="left" kind="title">Modulator 1</Text>
            <Text x={205.5} y={389} kind="title">Amp-Envelope</Text>
            <Text x={70.9} y={413.5}>Shape</Text>
            <Text x={120.8} y={413.5}>Pan</Text>
            <Text x={209} y={413.5}>Spread</Text>
            <Text x={257.5} y={413.5}>Sustain</Text>
            <Text x={370.5} y={413}>Env Level</Text>
            <Knob ctx={ctx} x={71.7} y={451.6} id={L(f, 'amp.curve')} label="Shape" size="sm" />
            <Knob ctx={ctx} x={119.6} y={450.9} id={L(f, 'pan')} label="Pan" size="sm" />
            <Knob ctx={ctx} x={208.5} y={451.7} id={L(f, 'spread')} label="Spread" size="sm" />
            <Knob ctx={ctx} x={256.4} y={450.8} id={L(f, 'amp.sustain')} label="Sustain" size="sm" />
            <Knob ctx={ctx} x={369.1} y={450.8} id={L(f, 'gain')} label="Env Level" tone="light" />
            <Bracket x0={40} x1={151} top={474} mid={486.5} tip={500} width={8} />
            <Bracket x0={177.5} x1={287.5} top={474} mid={486.5} tip={500} width={11.5} />
            <Text x={96} y={496}>A</Text>
            <Text x={232.4} y={495.5}>D</Text>
            <Text x={368.6} y={495.5}>R</Text>
            <Text x={27.6} y={510}>Delay</Text>
            <Text x={164.8} y={510}>Hold</Text>
            <Knob ctx={ctx} x={27.8} y={547.1} id={L(f, 'offset')} label="Delay" size="sm" />
            <Knob ctx={ctx} x={96} y={539.4} id={L(f, 'amp.attack')} label="A" />
            <Knob ctx={ctx} x={164.6} y={547.2} id={L(f, 'amp.hold')} label="Hold" size="sm" />
            <Knob ctx={ctx} x={232.6} y={540} id={L(f, 'amp.decay')} label="D" />
            <Knob ctx={ctx} x={369.7} y={539.7} id={L(f, 'amp.release')} label="R" />
            <Line x={0} y={583.5} w={413.5} h={1} colour="#282828" />
            <Text x={40.4} y={592} u>Gate</Text>
            <Block className="fp-plot" x={82} y={595.5} w={318} h={62}>
              <AudioEnvelope layer={f} values={values} duration={duration} onChange={onChange} height={62} pad={1} {...gesture} />
            </Block>
          </Panel>

        ) : null}
        {page === 0 ? [0, 1].map((index) => {
          const slot = index + 1
          const o = 418.3 * slot
          const px = SLOT_X[slot] ?? 0
          const id = (tail: string) => `envelopes[${index}].${tail}`
          const target = ctx.byId.get(id('target'))
          const on = read(ctx, id('enabled')) !== false
          const Y = (local: number) => 384 + local
          return (
            <Panel key={index} x={px} y={384} w={417.5} h={288} label={`Envelope ${index + 2}`}>
              <Text x={2.5 + o} y={Y(5.5)} align="left" kind="title">Modulator {index + 2}</Text>
              <Text x={205.5 + o} y={Y(5)} kind="title">Envelope</Text>
              <Text x={70.9 + o} y={Y(29.5)}>Shape</Text>
              <Text x={257.5 + o} y={Y(29.5)}>Sustain</Text>
              <Text x={370.5 + o} y={Y(29)}>Env Level</Text>
              <Knob ctx={ctx} x={71.7 + o} y={Y(67.6)} id={id('curve')} label="Shape" size="sm" />
              <Knob ctx={ctx} x={256.4 + o} y={Y(66.8)} id={id('sustain')} label="Sustain" size="sm" />
              <Knob ctx={ctx} x={369.1 + o} y={Y(66.8)} id={id('depth')} label="Env Level" tone="light" dots />
              <Text x={96 + o} y={Y(116)}>A</Text>
              <Text x={232.4 + o} y={Y(115.5)}>D</Text>
              <Text x={368.6 + o} y={Y(115.5)}>R</Text>
              <Text x={27.6 + o} y={Y(126)}>Delay</Text>
              <Text x={164.8 + o} y={Y(126)}>Hold</Text>
              <Knob ctx={ctx} x={27.8 + o} y={Y(163.1)} id={id('delay')} label="Delay" size="sm" />
              <Knob ctx={ctx} x={96 + o} y={Y(155.4)} id={id('attack')} label="A" />
              <Knob ctx={ctx} x={164.6 + o} y={Y(163.2)} id={id('hold')} label="Hold" size="sm" />
              <Knob ctx={ctx} x={232.6 + o} y={Y(156)} id={id('decay')} label="D" />
              <Knob ctx={ctx} x={369.7 + o} y={Y(155.7)} id={id('release')} label="R" />
              <Line x={px} y={Y(199.5)} w={417.5} h={1} colour="#282828" />
              <Text x={38.4 + o} y={Y(208)} u>Target</Text>
              <Block className="fp-target" x={10 + o} y={Y(225)} w={105} h={14.5}>
                {target ? (
                  <ParameterField param={target} value={read(ctx, id('target')) ?? target.defaultValue} onChange={(next) => onChange(id('target'), next)} {...gesture} />
                ) : null}
              </Block>
              <Box x={10 + o} y={Y(246)} w={105} selected={on} pressed={on} onClick={() => onChange(id('enabled'), !on)} label={`Modulator ${index + 2} on`}>On</Box>
              <Block className="fp-plot" x={124 + o} y={Y(211.5)} w={276} h={62} off={!on}>
                <AudioEnvelope layer={-1} prefix={`envelopes[${index}]`} offsetId={id('delay')} name={`envelope ${index + 2}`} values={values} duration={duration} onChange={onChange} height={62} pad={1} {...gesture} />
              </Block>
            </Panel>
          )
        }) : null}
        {lfosOnPage.map(({ index, slot }) => {
          const o = 418.3 * slot
          const px = SLOT_X[slot] ?? 0
          const pw = slot === 0 ? 413.5 : 417.5
          const id = (tail: string) => `lfos[${index}].${tail}`
          const target = ctx.byId.get(id('target'))
          const on = read(ctx, id('enabled')) !== false
          const shape = read(ctx, id('shape'))
          const cycles = readNum(ctx, id('rate'), 5) * duration
          const Y = (local: number) => 384 + local
          return (
            <Panel key={index} x={px} y={384} w={pw} h={288} label={`LFO ${index + 1}`}>
              <Text x={2.5 + o} y={Y(5.5)} align="left" kind="title">Modulator {index + 4}</Text>
              <Text x={203.3 + o} y={Y(5)} kind="title">Switcher LFO</Text>
              {/* the left column: how fast, and whether at all */}
              <Text x={36.5 + o} y={Y(104)}>Rate</Text>
              <Knob ctx={ctx} x={36 + o} y={Y(142)} id={id('rate')} label="Rate" />
              <Text x={36.5 + o} y={Y(178)} size={11} kind="dim">{cycles.toFixed(1)} cycles</Text>
              <Box x={5 + o} y={Y(252)} w={62.5} selected={on} pressed={on} onClick={() => onChange(id('enabled'), !on)} label={`Modulator ${index + 4} on`}>On</Box>
              {/* the wheel */}
              <Text x={193 + o} y={Y(30)}>Shape</Text>
              <ShapeWheel x={193 + o} y={Y(152)} value={typeof shape === 'string' ? shape : 'sine'} label={`LFO ${index + 1} shape`} onPick={(next) => onChange(id('shape'), next)} />
              <OptionKnob ctx={ctx} x={193 + o} y={Y(152)} id={id('shape')} label="Shape" options={LFO_SHAPES} size="mid" />
              {/* the right column: how much, and from where in the cycle */}
              <Text x={351.5 + o} y={Y(26)}>LFO Level</Text>
              <Knob ctx={ctx} x={351.5 + o} y={Y(64)} id={id('depth')} label="LFO Level" tone="light" />
              <Text x={351.5 + o} y={Y(164)}>Phase</Text>
              <Knob ctx={ctx} x={351.5 + o} y={Y(188)} id={id('phase')} label="Phase" size="sm" />
              {/* where it goes, for a keyboard; the pointer drops the handle from the routing bar */}
              <Block className="fp-target" x={140.5 + o} y={Y(269)} w={105} h={14.5}>
                {target ? (
                  <ParameterField param={target} value={read(ctx, id('target')) ?? target.defaultValue} onChange={(next) => onChange(id('target'), next)} {...gesture} />
                ) : null}
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
