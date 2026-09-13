import { Fragment, createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { tooltipDelay } from '@/ui/tooltipDelay'
import type { ParameterDef, ParamValue } from '@/rigs/types'
import { AudioKnob, type KnobMod, type KnobSize, type KnobTone } from '@/audio/AudioKnob'
import { AudioFader } from '@/audio/AudioFader'
import { AudioEnvelope } from '@/audio/AudioEnvelope'
import { FILTER_SLOTS, FX_SLOTS, INSERT_SLOTS, LFO_TARGET_LABELS, MOD_COUNT, MOD_ROUTES, PERFORMER_COUNT, PM_SOURCES, SCENE_COUNT, STEP_COUNT, routeAt } from '@/audio/fields'
import { AudioPattern } from '@/audio/AudioPattern'
import { waveAt } from '@/audio/dsp/osc'
import { warp } from '@/audio/dsp/osc'
import { listedWavetables, tableAt, tableOf, wavetable, wavetableOf } from '@/audio/dsp/wavetable'
import { RESPONSE_CEILING, RESPONSE_FLOOR, filterResponse, fxResponse, insertResponse } from '@/audio/dsp/response'
import { createInsert, insertSample } from '@/audio/dsp/insert'
import type { AudioPatch, FilterKind, FxKind, InsertKind, InsertPlace, InsertSlot } from '@/audio/types'
import { type AudioRig } from '@/audio/rig'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { PerformerShape } from '@/audio/types'
import {
  applyMacros, bindMacro as addMacroDestination, inactiveMacroDestinations, macroIsMapped,
  macroIsParked, macroPropertyLabel, macrosOf, prepareMacroMove, renameMacro, setMacroValue,
  unbindMacro as removeMacro, writeMacros, type MacroSlot,
} from '@/audio/macros'
import { DEAL, fitPlate, plateBox, type Item, type Layout } from '@/audio/faces'

/**
 * The face-plate, transcribed from the reference at its own scale.
 *
 * Every number in this file is a measurement in CSS pixels off a Retina capture of the reference
 * window: the plate is 1250 wide and 744 tall below its title bar, and each control is placed at
 * the coordinates the capture gave for it. Earlier versions laid the same controls out with grids
 * and flex boxes and asked the browser to distribute them, and the browser distributed them
 * differently from the reference every time; a fixed object does not flow, so nothing here does.
 * The stage scales the whole plate to fit whatever window it has, which is how the plugin itself
 * handles a window that is not its own size — down to a point. Below it the plate folds to one of
 * its other faces rather than shrink past reading, and if it must, the stage scrolls. The panels
 * are flex items for that reason: a face is an order for them and a width for the row (faces.ts),
 * and the browser wraps the row; inside a panel nothing flows.
 *
 * What the controls do is ParamRig's. Two oscillators and two noise generators are the four
 * layers; the panels that act on one layer at a time — Comb, Filter, the amp envelope — follow
 * the layer whose badge is lit in the oscillator or noise head. A few controls the reference has
 * and this engine does not are drawn and inert, and say so in a title.
 */

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
  /** The sixteen macros as they stand: which properties each drives, if any. */
  macros: MacroSlot[]
}
/** The number a dial wears when a macro drives it. */
const macroDigit = (ctx: Ctx, id: string) => {
  const index = ctx.macros.findIndex((macro) => macro.destinations.some((dest) => dest.property === id))
  return index < 0 ? undefined : index + 1
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
const SOURCE_COLOUR = { p: 'var(--fp-src-p)', e: 'var(--fp-src-e)', l: 'var(--fp-src-l)', t: 'var(--fp-src-t)', v: 'var(--fp-src-v)', m: 'var(--fp-red)' } as const

/** The modulation target a parameter stands for, when an LFO may be pointed at it. */
const targetOf = (id: string): string | undefined => {
  const found = /^layers\[(\d)\]\.(.+)$/.exec(id)
  if (!found) return undefined
  // Width and position are one destination in the engine — how far along the shape sits — so a
  // modulator dropped on either moves whichever of the two its source reads.
  const where: Record<string, string> = {
    'pitch.start': 'pitch',
    'filterA.cutoff': 'cutoff',
    'filterA.resonance': 'resonance',
    'filterB.cutoff': 'cutoff',
    'filterB.resonance': 'resonance',
    'source.pulseWidth': 'pulseWidth',
    'source.position': 'pulseWidth',
    'source.fmIndex': 'pm',
    'insertA.amount': 'insertA',
    'insertB.amount': 'insertB',
    'insertC.amount': 'insertC',
    gain: 'gain',
    pan: 'pan',
  }
  const destination = where[found[2] ?? '']
  return destination ? `layers[${found[1]}].${destination}` : undefined
}

/**
 * Every source pointed at a target, as the rings the control will wear: a performer in its amber,
 * a free envelope in its blue, an oscillator in its green.
 *
 * Several may point at one control and the engine adds their swings, so the plate has to answer
 * with several. It used to answer with the first, which was not a shorthand — it was a picture
 * that said the other two were not there.
 */
function modsOf(ctx: Ctx, target: string | undefined): KnobMod[] {
  if (!target) return []
  const found: KnobMod[] = []
  /*
   * Every route of every source, not the first of each.
   *
   * A modulator holds four (target, depth) pairs and may be pointed at four places at once, so a
   * control has to ask each of them rather than asking the slot where it goes. The id carries the
   * route number because it is what the ring, the menu entry and React's key are all told apart
   * by: the same oscillator may appear on this control once and on the next one twice.
   */
  const routesOf = (id: string, name: string, colour: string, bipolar: boolean) => {
    if (read(ctx, `${id}.enabled`) === false) return
    for (let at = 0; at < MOD_ROUTES; at += 1) {
      const route = routeAt(at)
      if (read(ctx, `${id}.${route.target}`) !== target) continue
      found.push({
        id: `${id}#${at}`, name, colour, bipolar,
        depth: readNum(ctx, `${id}.${route.depth}`),
        onDepth: (next) => ctx.onChange(`${id}.${route.depth}`, next),
        onClear: () => ctx.onChange(`${id}.${route.target}`, 'off'),
      })
    }
  }
  for (let index = 0; index < PERFORMER_COUNT; index += 1) {
    routesOf(`performers[${index}]`, `P${index + 1}`, SOURCE_COLOUR.p, read(ctx, `performers[${index}].bipolar`) === true)
  }
  for (let index = 0; index < MOD_COUNT; index += 1) {
    const envelope = read(ctx, `mods[${index}].kind`) === 'envelope'
    // An envelope happens once and pushes one way, the sign of its depth saying which; an
    // oscillator swings either side of the value. Drawn the same, the envelope's arc claimed a
    // swing it does not have and its depth could not be dragged below zero.
    routesOf(`mods[${index}]`, `${envelope ? 'E' : 'L'}${index + 2}`, envelope ? SOURCE_COLOUR.e : SOURCE_COLOUR.l, !envelope)
  }
  return found
}

/* ── Hints ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * The line under the pointer. The plate's controls are drawn where the reference draws them and
 * say no more than it does, which is nothing; so any of them can carry a `data-hint`, and the
 * plate shows it — one floating line in the app's tooltip style, after the app's tooltip delay,
 * over the control the pointer or the focus is on. The app's own Tooltip wraps its child in a
 * span it measures, and a span around an absolutely placed control measures nothing.
 */
function Hint({ target }: { target: HTMLElement | null }) {
  const [shown, setShown] = useState<{ left: number; top: number; text: string } | null>(null)
  useLayoutEffect(() => {
    if (!target) { setShown(null); return }
    const timer = setTimeout(() => {
      const rect = target.getBoundingClientRect()
      setShown({ left: rect.left + rect.width / 2, top: rect.top, text: target.dataset.hint ?? '' })
    }, tooltipDelay())
    return () => clearTimeout(timer)
  }, [target])
  if (!shown || !shown.text || typeof document === 'undefined') return null
  return createPortal(
    <div role="tooltip" className="tt fp-hint" data-side="top" data-placed="" style={{ left: shown.left, top: shown.top - 8 }}>{shown.text}</div>,
    document.body,
  )
}

/* ── Placement ───────────────────────────────────────────────────────────────────────────────── */

/** A panel's top-left corner on the plate, so its children can be placed in plate coordinates. */
const Origin = createContext({ x: 0, y: 0 })
function useAt() {
  const origin = useContext(Origin)
  return (x: number | string, y: number): CSSProperties => ({ left: typeof x === 'number' ? x - origin.x : x, top: y - origin.y })
}

function Panel({ x, y, w, h, label, tone, gap, follow, children }: {
  x: number; y: number; w: number; h: number; label: string; tone?: 'panel' | 'noise' | 'bare'
  /** The gap before it in its row, as the reference measures it. */
  gap?: number
  /** Layer this panel follows; shown so a change of oscillator is a change of context, not a surprise. */
  follow?: number
  children: ReactNode
}) {
  // A flex item at the size it was measured at, which grows with its row in proportion to its
  // width and centres what it holds; inside, every control keeps the coordinates it was measured at.
  return (
    <Origin.Provider value={{ x, y }}>
      <section className="fp-panel" data-tone={tone ?? 'panel'} data-layer={follow} aria-label={label} aria-description={follow !== undefined ? `Layer ${follow}` : undefined} style={{ flex: `${w} 1 ${w}px`, marginInlineStart: gap }}>
        <div className="fp-panel__body" style={{ width: w, height: h }}>{children}</div>
      </section>
    </Origin.Provider>
  )
}

/** A word placed by the top of its capitals and, usually, its centre. */
function Text({ x, y, size = 13, align = 'center', kind, u, onClick, checked, label, hint, children }: {
  x: number; y: number; size?: number; align?: 'center' | 'left' | 'right'
  kind?: 'label' | 'title' | 'bold' | 'macro' | 'digit' | 'dim' | 'source'
  u?: boolean; onClick?: () => void; checked?: boolean; label?: string
  /** A line under the pointer that says what it does. */
  hint?: string; children: ReactNode
}) {
  const at = useAt()
  const style = { ...at(x, y - size * CAP), '--size': `${size}px` } as CSSProperties
  if (onClick) {
    return (
      <button type="button" className="fp-text" data-align={align} data-kind={kind} data-u={u || undefined} data-hint={hint}
        role={checked === undefined ? undefined : 'radio'} aria-checked={checked} aria-label={label} style={style} onClick={onClick}>
        {children}
      </button>
    )
  }
  return <span className="fp-text" data-align={align} data-kind={kind} data-u={u || undefined} data-hint={hint} style={style}>{children}</span>
}

function Knob({ ctx, x, y, id, label, size = 'std', tone, digit, face, param, inert, idle, dots }: {
  ctx: Ctx; x: number | string; y: number; id: string; label: string; size?: KnobSize; tone?: KnobTone; digit?: string | number; face?: ReactNode; param?: Num
  /** Drawn where the reference draws it, wired to nothing: the fraction of the turn it shows. */
  inert?: number
  /** Wired, but nothing reads it in the arrangement the patch is in: why, in a few words. */
  idle?: string
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
  const shownDigit = size === 'macro' ? undefined : (digit ?? macroDigit(ctx, id))
  return (
    <AudioKnob
      param={{ ...parameter, label }}
      value={typeof current === 'number' ? current : parameter.min}
      size={size}
      tone={tone}
      digit={shownDigit}
      idle={idle}
      face={face}
      target={target}
      property={size === 'macro' ? undefined : id}
      mods={modsOf(ctx, target)}
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
    <AudioFader param={{ ...parameter, label }} value={typeof current === 'number' ? current : parameter.min} kind={kind} digit={digit ?? macroDigit(ctx, id)} target={target} property={id} mods={modsOf(ctx, target)} style={at(x, top)}
      onChange={(next) => ctx.onChange(id, next)} onGestureStart={ctx.onGestureStart} onGestureEnd={ctx.onGestureEnd} />
  )
}

/** The reference's quiet grey box: mid-grey, dark text, a pixel of radius. Lighter when chosen. */
function Box({ x, y, w, h = 14.5, align = 'center', selected, onClick, label, checked, pressed, hint, children }: {
  x: number; y: number; w: number; h?: number; align?: 'center' | 'right'; selected?: boolean; onClick?: () => void; label?: string; checked?: boolean; pressed?: boolean; hint?: string; children: ReactNode
}) {
  const at = useAt()
  const style = { ...at(x, y), width: w, height: h, lineHeight: `${h}px` }
  if (onClick) {
    return <button type="button" className="fp-box" data-align={align} data-selected={selected || undefined} data-hint={hint} role={checked === undefined ? undefined : 'radio'} aria-checked={checked} aria-pressed={pressed} aria-label={label} style={style} onClick={onClick}>{children}</button>
  }
  return <span className="fp-box" data-align={align} data-selected={selected || undefined} style={style}>{children}</span>
}

/** The little light-grey markers: a hexagon, a circle, a square, or the serrated square of a noise generator. */
function Badge({ x, y, kind, selected, onClick, label, tab, hint, children }: {
  x: number; y: number; kind: 'hex' | 'circle' | 'square' | 'noise'; selected?: boolean; onClick?: () => void; label?: string; tab?: boolean; hint?: string; children: ReactNode
}) {
  const at = useAt()
  if (onClick) {
    return <button type="button" className="fp-badge" data-kind={kind} data-selected={selected || undefined} data-hint={hint} role={tab ? 'tab' : undefined} aria-selected={tab ? selected : undefined} aria-label={label} style={at(x, y)} onClick={onClick}>{children}</button>
  }
  return <span className="fp-badge" data-kind={kind} style={at(x, y)} aria-hidden="true">{children}</span>
}

/**
 * What a table looks like across its knob, drawn by the function that plays it.
 *
 * Five readings of it, from the near end of the position dial to the far one, stacked back to
 * front the way every wavetable has been drawn since the first one — because a single trace says
 * what the wave is and a stack says what the dial will do to it, which is the thing being chosen.
 * A picker of eight names is a picker nobody uses.
 */
function TableMark({ name }: { name: string }) {
  const built = wavetableOf(name) ?? wavetable(tableOf(name))
  const frames = 5
  const points = 96
  return (
    <svg className="fp-menu__mark" viewBox="0 0 64 34" aria-hidden="true">
      {Array.from({ length: frames }, (_, frame) => {
        const position = frame / (frames - 1)
        const base = 8 + frame * 5
        const shift = (frames - 1 - frame) * 3
        const d = Array.from({ length: points + 1 }, (_, at) => {
          const along = at / points
          const value = tableAt(built, along, position, 1 / 512)
          return `${at === 0 ? 'M' : 'L'}${(shift + along * 52).toFixed(2)} ${(base - value * 4.8).toFixed(2)}`
        }).join(' ')
        return <path key={frame} d={d} opacity={0.3 + frame * 0.175} />
      })}
    </svg>
  )
}

/** What a filter model does, measured by pushing tones through the filter itself. */
function FilterMark({ kind }: { kind: FilterKind }) {
  const curve = filterResponse(kind)
  const d = Array.from(curve, (level, at) =>
    `${at === 0 ? 'M' : 'L'}${((at / (curve.length - 1)) * 60 + 2).toFixed(2)} ${responseY(level).toFixed(2)}`).join(' ')
  return (
    <svg className="fp-menu__mark" viewBox="0 0 64 34" aria-hidden="true">
      <path className="fp-menu__floor" d={`M2 ${responseY(0).toFixed(2)} H62`} opacity="0.25" />
      <path d={d} />
    </svg>
  )
}

/** What an insert does to a sound, drawn by running one short burst through the insert itself. */
function InsertMark({ kind }: { kind: InsertKind }) {
  const shape = insertResponse(kind)
  const d = Array.from(shape, (value, at) => {
    const x = (at / (shape.length - 1)) * 60 + 2
    return `${at === 0 ? 'M' : 'L'}${x.toFixed(2)} ${(17 - value * 14).toFixed(2)}`
  }).join(' ')
  return (
    <svg className="fp-menu__mark" viewBox="0 0 64 34" aria-hidden="true">
      <path className="fp-menu__floor" d="M2 17 H62" opacity="0.25" />
      <path d={d} />
    </svg>
  )
}

/**
 * The field to wake, for the three kinds whose resting value is an exact bypass.
 *
 * `saturate` returns its input at drive 0, `crushSample` skips the quantiser at sixteen bits, and
 * a fold with no drive folds nothing — so picking Drive, Crusher or Fold on a fresh slot changed
 * the sound by not one sample, and the slot read as broken. A slot that has been that kind before
 * keeps whatever it was left at; only one still sitting at the silent value is given something.
 */
const WOKEN: Record<string, { field: 'drive' | 'bitDepth' | 'crush'; silent: number; value: number }> = {
  drive: { field: 'drive', silent: 0, value: 0.4 },
  fold: { field: 'drive', silent: 0, value: 0.4 },
  crusher: { field: 'bitDepth', silent: 16, value: 8 },
}

const INSERT_MODELS: { value: InsertKind; label: string; note: string }[] = [
  { value: 'off', label: 'Off', note: 'Nothing in this slot.' },
  { value: 'drive', label: 'Drive', note: 'Pushed until it rounds off and bites.' },
  { value: 'crusher', label: 'Crusher', note: 'Fewer bits, fewer samples. Cheap on purpose.' },
  { value: 'ring', label: 'Ring', note: 'Multiplied by a tone. Bells, radios, robots.' },
  { value: 'fold', label: 'Fold', note: 'Turned back at the rails. Harmonics from nowhere.' },
  { value: 'body', label: 'Body', note: 'Resonances it rings through: a struck thing.' },
  { value: 'comb', label: 'Comb', note: 'Added to itself a moment later. A pitch, or a tail.' },
]

const BODY_PROFILES: { value: string; label: string; note: string }[] = [
  { value: 'bar', label: 'Bar', note: 'The original struck rod. Kept so older patches stay themselves.' },
  { value: 'plate', label: 'Plate', note: 'Nearby modes, a longer shimmer.' },
  { value: 'cavity', label: 'Cavity', note: 'A hollow air, the first mode loud.' },
  { value: 'membrane', label: 'Membrane', note: 'A skin: the top dies fast.' },
  { value: 'glass', label: 'Glass', note: 'Bright, slow to lose its top.' },
  { value: 'aether', label: 'Aether', note: 'Invented spacings no object rings at.' },
]

/**
 * What a master effect does, as the outline of both channels: the left above the line, the right
 * below it. A widener changes neither channel on its own and only how far apart they are, so a
 * picture of one of them would say it does nothing.
 */
function FxMark({ kind }: { kind: FxKind }) {
  const shape = fxResponse(kind)
  const points = shape.length / 2
  const at = (index: number) => (index / (points - 1)) * 60 + 2
  const top = Array.from({ length: points }, (_, index) =>
    `${index === 0 ? 'M' : 'L'}${at(index).toFixed(2)} ${(17 - (shape[index] ?? 0) * 13).toFixed(2)}`)
  const bottom = Array.from({ length: points }, (_, index) => {
    const back = points - 1 - index
    return `L${at(back).toFixed(2)} ${(17 + (shape[points + back] ?? 0) * 13).toFixed(2)}`
  })
  return (
    <svg className="fp-menu__mark" viewBox="0 0 64 34" aria-hidden="true">
      <path className="fp-menu__floor" d="M2 17 H62" opacity="0.25" />
      <path d={`${top.join(' ')} ${bottom.join(' ')} Z`} />
    </svg>
  )
}

const FX_MODELS: { value: FxKind; label: string; note: string }[] = [
  { value: 'off', label: 'Off', note: 'Nothing in this slot.' },
  { value: 'flanger', label: 'Flanger', note: 'A comb, swept. Jet engines and swoops.' },
  { value: 'chorus', label: 'Chorus', note: 'Copies that never quite agree. Thickens.' },
  { value: 'phaser', label: 'Phaser', note: 'Notches that move. Softer than a flanger.' },
  { value: 'delay', label: 'Delay', note: 'It happens again, and again after that.' },
  { value: 'reverb', label: 'Reverb', note: 'The room it happened in.' },
  { value: 'widener', label: 'Widener', note: 'Pushes the two channels apart.' },
]

/**
 * The three dials each kind puts in its row, small, large, small — the reference's own shape.
 *
 * Chosen from what `fxSample` actually reads for that kind, which they were not: the phaser was
 * given a Feed dial and no Depth, and depth is where its notches travel — the thing that makes a
 * phaser a phaser. Its feedback stays at the resting 0.3, which is a usable resonance now that it
 * is taken round with the right sign, and the flanger's stays at 0.4 for the same reason: three
 * dials is the row's shape, and a field that is fixed at a good value is better than a dial that
 * is fixed at nothing. Both remain reachable by binding a macro to them.
 */
const FX_KNOBS: Record<string, { field: string; label: string }[]> = {
  flanger: [{ field: 'rate', label: 'Rate' }, { field: 'mix', label: 'Mix' }, { field: 'depth', label: 'Depth' }],
  chorus: [{ field: 'rate', label: 'Rate' }, { field: 'mix', label: 'Mix' }, { field: 'depth', label: 'Depth' }],
  phaser: [{ field: 'rate', label: 'Rate' }, { field: 'mix', label: 'Mix' }, { field: 'depth', label: 'Depth' }],
  delay: [{ field: 'time', label: 'Time' }, { field: 'mix', label: 'Mix' }, { field: 'feedback', label: 'Feed' }],
  reverb: [{ field: 'size', label: 'Size' }, { field: 'mix', label: 'Mix' }, { field: 'damping', label: 'Damp' }],
  widener: [{ field: 'width', label: 'Spread' }, { field: 'mix', label: 'Mix' }, { field: 'rate', label: 'Rate' }],
}

/**
 * What is pointed at one control, on a right-click.
 *
 * A ring can be dragged and double-clicked, which is enough for one source and not enough for
 * three: the outermost ring is the one under the pointer whatever you meant, and there is no
 * gesture at all for "which of these is the amber one". So the control answers the question in
 * words — who is on it, how far each swings, and a way to send any of them away.
 *
 * It is portalled to the document because the plate carries a `transform: scale()`, and a fixed
 * anchor inside a transformed ancestor is not fixed to the window at all.
 */
function Routed({ at, mods, onShow, onClose }: {
  at: { x: number; y: number; label: string } | null
  mods: KnobMod[]
  onShow: (id: string) => void
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <DropdownMenu.Root open={at !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="fp-at-point" tabIndex={-1} aria-hidden style={{ left: at?.x ?? 0, top: at?.y ?? 0 }} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu fp-routed" align="start" side="bottom" sideOffset={4} collisionPadding={8} aria-label={`What moves ${at?.label ?? 'this control'}`}>
          <DropdownMenu.Label className="menu__label">{at?.label ?? ''}</DropdownMenu.Label>
          {mods.map((held) => (
            <DropdownMenu.Item key={`show-${held.id}`} className="menu__item" onSelect={() => onShow(held.id)}>
              <span className="fp-routed__dot" style={{ background: held.colour }} aria-hidden="true" />
              <span>Show {held.name}</span>
              <span className="fp-routed__depth">{held.depth.toFixed(2)}</span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="menu__sep" />
          {mods.map((held) => (
            <DropdownMenu.Item key={`clear-${held.id}`} className="menu__item fp-routed__clear" onSelect={() => held.onClear?.()}>
              <span>Take {held.name} off it</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>,
    document.body,
  )
}

/**
 * A box that opens a menu, in the plate's own box style.
 *
 * `Box` is a button and nothing else, and Radix needs a trigger it can hand its own props to, so
 * the trigger is written out here rather than wrapped around one.
 */
function BoxMenu({ x, y, w, text, label, hint, children }: {
  x: number; y: number; w: number; text: string; label: string; hint: string; children: ReactNode
}) {
  const at = useAt()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="fp-box" data-hint={hint} aria-label={label}
          style={{ ...at(x, y), width: w, height: 14.5, lineHeight: '14.5px' }}>{text}</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu fp-rows" align="start" side="top" sideOffset={6} collisionPadding={8}>{children}</DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * Shapes a row can start from.
 *
 * Sixteen bars at the floor is not a starting point, it is an empty page — and the rows anybody
 * actually wants are the same handful every time. Random is the one that is not a shape: it is
 * there because a performer is a thing you audition, and a throw of the dice is the fastest way
 * to find out what a destination sounds like when it moves.
 */
const ROW_SHAPES: { label: string; of: (at: number, total: number) => number }[] = [
  { label: 'Flat', of: () => 0 },
  { label: 'Ramp up', of: (at, total) => at / (total - 1) },
  { label: 'Ramp down', of: (at, total) => 1 - at / (total - 1) },
  { label: 'Triangle', of: (at, total) => 1 - Math.abs((2 * at) / (total - 1) - 1) },
  { label: 'Sine', of: (at, total) => (Math.sin((2 * Math.PI * at) / total) + 1) / 2 },
  { label: 'Square', of: (at, total) => (at < total / 2 ? 1 : 0) },
  { label: 'Stairs', of: (at, total) => Math.floor(at / (total / 4)) / 3 },
  { label: 'Every other', of: (at) => (at % 2 === 0 ? 1 : 0) },
  { label: 'Random', of: () => Math.round(Math.random() * 100) / 100 },
]

/** The divisions the drawing can land on, stepped through in this order. */
const GRIDS = [0, 2, 3, 4, 6, 8]

/** What each phase-modulation source is called on the plate, where a word has to fit under a dial. */
const PM_NAMES: Record<string, string> = {
  internal: 'Self', layer0: 'Osc 1', layer1: 'Osc 2', layer2: 'Noise 1', layer3: 'Noise 2',
}

/** The three slots, as the panel head and the hints name them. */
const INSERT_LETTERS = ['A', 'B', 'C'] as const

/** And the two filters, on the same idiom. */
const FILTER_LETTERS = ['A', 'B'] as const
const ROUTINGS = ['single', 'series', 'parallel']
const ROUTING_NAMES: Record<string, string> = { single: 'One filter', series: 'B after A', parallel: 'A and B at once' }

/**
 * One slot read off the board.
 *
 * Every field of every kind, because that is what the engine is handed: the picture under a dial
 * and the sound coming out of the speaker are drawn by the same function from the same record,
 * which is the only way the two cannot disagree.
 */
function slotAt(ctx: Ctx, layer: number, slot: number): InsertSlot {
  const at = (field: string) => `layers[${layer}].${INSERT_SLOTS[slot] ?? 'insertA'}.${field}`
  return {
    kind: (read(ctx, at('kind')) ?? 'off') as InsertKind,
    place: (read(ctx, at('place')) ?? 'pre') as InsertPlace,
    amount: readNum(ctx, at('amount'), 1),
    drive: readNum(ctx, at('drive'), 0),
    bitDepth: readNum(ctx, at('bitDepth'), 16),
    crush: readNum(ctx, at('crush'), 0),
    ratio: readNum(ctx, at('ratio'), 2),
    frequency: readNum(ctx, at('frequency'), 900),
    spread: readNum(ctx, at('spread'), 0.7),
    decay: readNum(ctx, at('decay'), 0.25),
    partials: readNum(ctx, at('partials'), 4),
    time: readNum(ctx, at('time'), 0.008),
    feedback: readNum(ctx, at('feedback'), 0.5),
  }
}

/**
 * The slots a layer's oscillator has already been through by the time the amplifier sees it, less
 * the two that cannot be drawn.
 *
 * The glyph is a window about five milliseconds wide. A comb's shortest delay is longer than that,
 * so inside the window it has nothing to hand back and the drawing goes flat; a body's ring starts
 * many times louder than the excitation, so the drawing leaves the box. Neither is what those two
 * do to the sound — it is what a five-millisecond look at them shows — so the glyph keeps the four
 * that shape a waveform where it stands and leaves the two that work in time to the ear.
 */
const DRAWN_INSERTS = ['drive', 'fold', 'crusher', 'ring']
const beforeAmp = (ctx: Ctx, layer: number) =>
  INSERT_SLOTS.map((_, slot) => slotAt(ctx, layer, slot))
    .filter((held) => held.place !== 'post' && DRAWN_INSERTS.includes(held.kind))

/** Where a frequency and a level fall in the box every response is drawn in. */
const responseX = (hz: number) => (Math.log2(Math.min(16000, Math.max(60, hz)) / 60) / Math.log2(16000 / 60)) * 60 + 2
const responseY = (db: number) => 31 - ((db - RESPONSE_FLOOR) / (RESPONSE_CEILING - RESPONSE_FLOOR)) * 28

/**
 * The filter's own face: the model's measured curve, slid to the corner it is tuned to.
 *
 * The measurement is taken once, at twelve hundred hertz, and these models keep their shape as
 * they are tuned — so moving the picture along the axis is a truthful account of what turning the
 * dial does, and it costs a subtraction rather than a second measurement on every frame of a drag.
 * The upright is the corner itself, which is the number the dial is actually setting.
 */
function FilterFace({ kind, cutoff }: { kind: FilterKind; cutoff: number }) {
  const curve = filterResponse(kind)
  const shift = responseX(cutoff) - responseX(1200)
  const d = [
    `M${(2 - Math.abs(shift) - 4).toFixed(2)} ${responseY(curve[0] ?? 0).toFixed(2)}`,
    ...Array.from(curve, (db, at) => `L${((at / (curve.length - 1)) * 60 + 2 + shift).toFixed(2)} ${responseY(db).toFixed(2)}`),
    `L${(62 + Math.abs(shift) + 4).toFixed(2)} ${responseY(curve[curve.length - 1] ?? 0).toFixed(2)}`,
  ].join(' ')
  return (
    <svg className="fp-menu__mark" viewBox="0 0 64 34" aria-hidden="true">
      <path className="fp-menu__floor" d={`M2 ${responseY(0).toFixed(2)} H62`} opacity="0.25" />
      <path className="fp-menu__at" d={`M${responseX(cutoff).toFixed(2)} 2 V32`} opacity="0.45" />
      <path d={d} />
    </svg>
  )
}

const FILTER_MODELS: { value: FilterKind; label: string; note: string }[] = [
  { value: 'off', label: 'Off', note: 'Straight through, nothing taken away.' },
  { value: 'lowpass', label: 'Low', note: 'Takes the top off. What most sounds want.' },
  { value: 'highpass', label: 'High', note: 'Takes the bottom out. Thins and clears.' },
  { value: 'bandpass', label: 'Band', note: 'Keeps a band and drops both sides of it.' },
  { value: 'notch', label: 'Notch', note: 'Takes out a band, leaves the rest alone.' },
  { value: 'peak', label: 'Peak', note: 'Lifts a band without touching the rest.' },
  { value: 'ladder', label: 'Ladder', note: 'Four poles. Falls twice as fast, and growls.' },
  { value: 'comb', label: 'Comb', note: 'The sound added to itself a moment later.' },
  { value: 'formant', label: 'Vowel', note: 'Three mouth resonances. Cutoff walks the vowels.' },
]

/**
 * The name of what is in a slot, and the picker that changes it.
 *
 * A list of names with a line of prose under each is a wall of text for choosing a shape. The
 * shapes are the choice, so the picker is a grid of them and nothing else; the name and the line
 * belong to whichever one the pointer or the keyboard is on, on a single strip at the foot that
 * never changes height, so the menu does not resize under the hand.
 *
 * The trigger sits in plate coordinates and scales with the plate. The picker is portalled to the
 * document, so it renders at the app's own size and stays legible on a plate scaled down.
 */
function SlotMenu({ x, y, w, label, value, options, onPick, hint, columns = 4, action }: {
  x: number; y: number; w: number; label: string; value: string
  options: { value: string; label: string; note?: string; mark?: ReactNode }[]
  onPick: (next: string) => void; hint?: string; columns?: number
  action?: { label: string; onPick: () => void }
}) {
  const at = useAt()
  const chosen = options.find((option) => option.value === value)
  const [under, setUnder] = useState<string | null>(null)
  const said = options.find((option) => option.value === under) ?? chosen

  /**
   * A grid answers the arrow keys as a grid.
   *
   * A menu is a column to Radix: down goes to the next cell written rather than the one below it,
   * and left closes the whole thing, which in a grid is the wrong answer to wanting the cell
   * before. All four keys are taken here, with Home and End for the ends.
   */
  const grid = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const cells = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const from = cells.findIndex((cell) => cell === document.activeElement)
    if (from < 0) return
    const step = event.key === 'ArrowDown' ? columns
      : event.key === 'ArrowUp' ? -columns
      : event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowLeft' ? -1
      : 0
    const to = event.key === 'Home' ? cells[0]
      : event.key === 'End' ? cells[cells.length - 1]
      : step ? cells[Math.min(cells.length - 1, Math.max(0, from + step))]
      : null
    if (!to) return
    event.preventDefault()
    event.stopPropagation()
    to.focus()
  }

  return (
    <DropdownMenu.Root onOpenChange={(open) => { if (!open) setUnder(null) }}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="fp-slot-head" aria-label={label} data-hint={hint} style={{ ...at(x, y), width: w }}>
          <span className="fp-slot-head__name">{chosen?.label ?? value}</span>
          <svg className="fp-slot-head__mark" viewBox="0 0 8 5" aria-hidden="true"><path d="M0.6 0.8 L4 4.2 L7.4 0.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu fp-picker" aria-label={label} align="start" sideOffset={6} collisionPadding={8} style={{ '--columns': columns } as CSSProperties}>
          {/* Caught on the way down: the roving focus answers the key on the cell itself, so a
              handler that waits for the event to bubble has already lost the argument. */}
          <div className="fp-picker__grid" onKeyDownCapture={grid}>
            {options.map((option) => (
              <DropdownMenu.Item key={option.value} className="fp-picker__cell" aria-label={option.label}
                data-current={option.value === value || undefined}
                onFocus={() => setUnder(option.value)}
                onPointerMove={() => setUnder(option.value)}
                onSelect={() => onPick(option.value)}>
                {option.mark}
              </DropdownMenu.Item>
            ))}
          </div>
          <p className="fp-picker__said" aria-live="polite">
            <span className="fp-picker__name">{said?.label ?? ''}</span>
            <span className="fp-picker__note">{said?.note ?? ''}</span>
          </p>
          {action ? (
            <DropdownMenu.Item className="fp-picker__action" onSelect={action.onPick}>
              {action.label}
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * A stack of choices in the box style, centred on `x`: the chosen one filled, the rest quiet.
 * Three underlined words of the same size, one a shade brighter, is not a switch a person can read.
 */
function Choices({ x, y, w, row, label, options }: {
  x: number; y: number; w: number; row: number; label: string
  options: { word: string; on: boolean; onPick: () => void; hint: string }[]
}) {
  const at = useAt()
  return (
    <span className="fp-choices" role="radiogroup" aria-label={label} style={{ ...at(x - w / 2, y), width: w }}>
      {options.map((option) => (
        <button type="button" key={option.word} className="fp-choice" role="radio" aria-checked={option.on} data-hint={option.hint} style={{ height: row }} onClick={option.onPick}>
          {option.word}
        </button>
      ))}
    </span>
  )
}

/** A positioned block, placed by its top-left corner in plate coordinates. */
function Block({ x, y, w, h, className, off, hint, children }: { x: number; y: number; w: number; h: number; className: string; off?: boolean; hint?: string; children: ReactNode }) {
  const at = useAt()
  return <div className={className} style={{ ...at(x, y), width: w, height: h }} data-off={off || undefined} data-hint={hint}>{children}</div>
}

/** A hairline, placed by its top-left corner. */
function Line({ x, y, w, h = 1, colour = 'var(--fp-hairline)' }: { x: number; y: number; w: number; h?: number; colour?: string }) {
  const at = useAt()
  return <span className="fp-line" style={{ ...at(x, y), width: w, height: h, background: colour }} aria-hidden="true" />
}

/**
 * Where a modulator goes, and the only way to take it off from its own panel.
 *
 * This is what replaced the Target select. A select could name one destination, which stopped
 * being true the moment a slot could hold four — and it was a second way of doing what dragging
 * the handle already did, with the two disagreeing about which of the four they meant. What is
 * left is a reading: the places this modulator is pointed at, how far it moves each of them, and a
 * cross to take one off. Pointing it somewhere new is the handle in the bar, by pointer or by
 * keyboard, which is one gesture rather than two.
 */
/**
 * A destination as this list says it: the layer's number and the thing, without the word "Layer".
 *
 * `LFO_TARGET_LABELS` writes them out in full for the menus, where a target stands on its own. Here
 * they are stacked four deep in a hundred pixels, and "Layer" on every line is forty pixels of the
 * same word four times over — which is what pushed the part that differs into an ellipsis.
 */
const shortTarget = (target: string): string => {
  const full = LFO_TARGET_LABELS[target] ?? target
  const said = /^Layer (\d+) (.+)$/.exec(full)
  return said ? `${said[1]} ${said[2]}` : full
}

function Routes({ ctx, x, y, w, id, name }: {
  ctx: Ctx; x: number; y: number; w: number; id: (tail: string) => string; name: string
}) {
  const at = useAt()
  const live = Array.from({ length: MOD_ROUTES }, (_, index) => routeAt(index))
    .map((route) => ({ route, target: String(read(ctx, id(route.target)) ?? 'off') }))
    .filter((one) => one.target !== 'off')
  return (
    <span className="fp-routes-of" style={{ ...at(x, y), width: w }}>
      {live.length === 0 ? (
        <span className="fp-routes-of__none" data-hint={`${name} is pointed at nothing. Drag its handle from the bar onto a knob or fader, or press Enter on the handle and Enter again on the control.`}>
          Nothing yet
        </span>
      ) : live.map(({ route, target }) => (
        <span key={route.target} className="fp-routes-of__row">
          <span className="fp-routes-of__to" title={LFO_TARGET_LABELS[target] ?? target}>{shortTarget(target)}</span>
          <span className="fp-routes-of__depth">{readNum(ctx, id(route.depth)).toFixed(2)}</span>
          <button
            type="button"
            className="fp-routes-of__off"
            aria-label={`Take ${name} off ${LFO_TARGET_LABELS[target] ?? target}`}
            data-hint={`Take ${name} off ${LFO_TARGET_LABELS[target] ?? target}. Its depth is kept, so putting it back starts where it left off.`}
            onClick={() => ctx.onChange(id(route.target), 'off')}
          >
            ×
          </button>
        </span>
      ))}
    </span>
  )
}

/** An icon placed by its centre. */
function Icon({ x, y, w, h, children, className, hint }: { x: number; y: number; w: number; h: number; children: ReactNode; className?: string; hint?: string }) {
  const at = useAt()
  return <span className={`fp-icon${className ? ` ${className}` : ''}`} style={{ ...at(x, y), width: w, height: h }} data-hint={hint} aria-hidden="true">{children}</span>
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
function Readout({ x, base, mark, value, label, edit, ctx }: {
  x: number; base: number; mark: 'note' | 'ratio' | 'none'; value: number; label?: string; edit?: Edit
  /** The gesture callbacks, so one drag is one undo step here as it is on a dial. */
  ctx?: Pick<Ctx, 'onGestureStart' | 'onGestureEnd'>
}) {
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
          <path d="M4.5 0.2h1.1v9.4h-1.1z" style={{ fill: 'var(--fp-rule)' }} /><ellipse cx="2.95" cy="9.85" rx="3" ry="2.05" transform="rotate(-28 2.95 9.85)" style={{ fill: 'var(--fp-rule)' }} />
        </svg>
      ) : null}
      {mark === 'ratio' ? (
        <svg className="fp-read__mark" viewBox="0 0 12 11" style={{ left: 0, top: -11.5, width: 12, height: 11 }}>
          <circle cx="2.6" cy="2.6" r="2.1" style={{ fill: 'var(--fp-rule)' }} /><circle cx="9.4" cy="8.4" r="2.1" style={{ fill: 'var(--fp-rule)' }} /><path d="M1.2 10.2 10.8 0.8" style={{ stroke: 'var(--fp-rule)' }} strokeWidth="1.6" strokeLinecap="round" />
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
      data-hint="Drag up and down to set it; hold Shift for fine steps; double-click to reset."
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
        // One drag is one undo step, as it is on a dial. Without this the history took a step per
        // frame of the drag, so getting back to where you started was eight presses of Undo.
        ctx?.onGestureStart?.()
      }}
      onPointerMove={(event) => { if (dragging.current) edit.set(clamp(origin.current.start + (origin.current.y - event.clientY) * edit.perPx)) }}
      onPointerUp={(event) => { if (!dragging.current) return; dragging.current = false; event.currentTarget.releasePointerCapture?.(event.pointerId); ctx?.onGestureEnd?.() }}
      onPointerCancel={() => { if (!dragging.current) return; dragging.current = false; ctx?.onGestureEnd?.() }}
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

/**
 * The wave on the face of a hero dial: a slice of the oscillator, drawn by the function that
 * renders it.
 *
 * The reference shows a wavetable here and morphs it as its position knob turns. This shows the
 * real thing instead: a fixed window of the sound, so the pitch dial it sits on changes how many
 * cycles fall in the window, Width changes the duty of a pulse, PM and the ratio bend the shape,
 * and Drive, Bits and Crush deform it — every one of them a parameter the renderer reads, drawn
 * here by the two functions the renderer reads them with. It is not a picture of a wave; it is
 * the wave. The window is the length of the walk, which at the rate the engine runs at is about
 * the four and a half milliseconds the sample-and-hold of Crush is counted in, so its steps come
 * out the size they are heard at.
 */
function wavePath(wave: Wave, pulseWidth: number, cycles: number, fmIndex: number, fmRatio: number, inserts?: InsertSlot[], table?: string, position = 0.5, dt = 0.01): string {
  const points = 220
  const rate = 44100
  const held = inserts ?? []
  const states = held.map((slot) => createInsert(slot, rate))
  const built = table === undefined ? null : wavetable(tableOf(table))
  const steps: string[] = []
  for (let at = 0; at <= points; at += 1) {
    const along = at / points
    const phase = along * cycles + (fmIndex / (Math.PI * 2)) * Math.sin(2 * Math.PI * fmRatio * along * cycles)
    const wrapped = phase - Math.floor(phase)
    // The band a table plays is chosen by the pitch it is played at, so the picture has to be
    // asked at that pitch too: drawn at the glyph's own step it would show harmonics nobody hears.
    const raw = built ? tableAt(built, warp(wrapped, pulseWidth), position, dt) : waveAt(wave, wrapped, 0, pulseWidth)
    let value = raw
    for (let slot = 0; slot < held.length; slot += 1) {
      value = insertSample(states[slot]!, held[slot]!, value, dt * rate, rate)
    }
    steps.push(`${at === 0 ? 'M' : 'L'}${(1 + along * 44).toFixed(2)} ${(11.5 - value * 9.5).toFixed(2)}`)
  }
  return steps.join(' ')
}

/** How much of the sound the glyph shows: an octave of pitch is a doubling of the cycles in it. */
const cyclesAt = (pitch: number) => Math.min(8, Math.max(0.5, pitch / 220))

function WaveGlyph({ kind, wave, pulseWidth = 0.5, pitch = 440, fmIndex = 0, fmRatio = 1, inserts, table, position = 0.5 }: {
  kind: unknown; wave: unknown; pulseWidth?: number; pitch?: number; fmIndex?: number; fmRatio?: number
  inserts?: InsertSlot[]; table?: string; position?: number
}) {
  const d = kind === 'noise'
    ? 'M1 11 L4 4 L7 16 L10 7 L13 14 L16 3 L19 13 L22 8 L25 17 L28 5 L31 12 L34 6 L37 15 L40 9 L43 11'
    : wavePath(waveOf(wave), pulseWidth, cyclesAt(pitch), fmIndex, fmRatio, inserts, kind === 'table' ? table ?? 'sweep' : undefined, position, pitch / 44100)
  return (
    <svg viewBox="0 0 46 23" className="fp-waveglyph">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The big round wave icon of the phase-modulation row: a light disc with the wave cut through it. */
function WaveDisc({ wave, pulseWidth = 0.5 }: { wave: Wave; pulseWidth?: number }) {
  // One cycle of the shape it names, at the width it is set to, cut through the disc.
  const points = 96
  const d = Array.from({ length: points + 1 }, (_, at) => {
    const along = at / points
    const value = waveAt(wave, along, 0, pulseWidth)
    return `${at === 0 ? 'M' : 'L'}${(5.5 + along * 24).toFixed(2)} ${(17.5 - value * 6.2).toFixed(2)}`
  }).join(' ')
  return (
    <svg viewBox="0 0 35 35" style={{ width: 35, height: 35 }}>
      <circle cx="17.5" cy="17.5" r="17.5" style={{ fill: 'var(--fp-icon)' }} />
      <path d={d} fill="none" style={{ stroke: 'var(--fp-icon-cut)' }} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
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
      <path d={bars.join('')} fill="none" style={{ stroke: 'var(--fp-icon)' }} strokeWidth={colour === 'metallic' ? '0.9' : '0.5'} />
    </svg>
  )
}
const MoveIcon = () => (
  <svg viewBox="0 0 17.5 14.5" style={{ width: 17.5, height: 14.5 }}>
    <path d="M8.75 1v12.5M2 7.25h13.5" style={{ stroke: 'var(--fp-dim)' }} strokeWidth="1.5" />
    <path d="M8.75 0 l2.4 3 h-4.8z M8.75 14.5 l2.4 -3 h-4.8z M1 7.25 l3 -2.4 v4.8z M16.5 7.25 l-3 -2.4 v4.8z" style={{ fill: 'var(--fp-dim)' }} />
  </svg>
)
const DinIcon = () => (
  <svg viewBox="0 0 17.5 14.5" style={{ width: 17.5, height: 14.5 }}>
    <path d="M8.75 0 a7.25 7.25 0 1 1 -0.01 0 z M6.5 13.6 h4.5 l-1 -2.2 h-2.5 z" style={{ fill: 'var(--fp-amber)' }} fillRule="evenodd" />
    <circle cx="8.75" cy="3.4" r="1.1" style={{ fill: 'var(--fp-ground)' }} /><circle cx="5" cy="4.6" r="1.1" style={{ fill: 'var(--fp-ground)' }} /><circle cx="12.5" cy="4.6" r="1.1" style={{ fill: 'var(--fp-ground)' }} /><circle cx="3.6" cy="8.4" r="1.1" style={{ fill: 'var(--fp-ground)' }} /><circle cx="13.9" cy="8.4" r="1.1" style={{ fill: 'var(--fp-ground)' }} />
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
      <path d={`M${rel(x0)} 0 V${mid - top} L${rel(centre - gap)} ${tip - top}`} fill="none" style={{ stroke: 'var(--fp-bracket)' }} strokeWidth="1" />
      <path d={`M${rel(x1)} 0 V${mid - top} L${rel(centre + gap)} ${tip - top}`} fill="none" style={{ stroke: 'var(--fp-bracket)' }} strokeWidth="1" />
    </svg>
  )
}

/* ── The plate ───────────────────────────────────────────────────────────────────────────────── */

/** Hertz as the reference's semitone readout: distance from A4, to the thousandth. */
const semitones = (hz: number) => (hz > 0 ? 12 * Math.log2(hz / 440) : 0)
const hertz = (st: number) => 440 * Math.pow(2, st / 12)

/** A modulation source of the routing bar: which slot it is, which page of panels shows it. */
/**
 * A station of the routing bar.
 *
 * Three performers, then the amplifier's own envelope, then the eight free slots. A slot's letter
 * says what it holds and its number says where it sits, which is how the reference numbers its
 * nine — E1 to E3 and then L4 to L9 is one run, not two. So the eight are numbered two to nine and
 * their letter follows whatever each is set to.
 */
type Source = { id: string; kind: 'p' | 'e' | 'l'; mod?: number; performer?: number }
const PERFORMER_SOURCES: Source[] = Array.from({ length: PERFORMER_COUNT }, (_, index) => ({ id: `P${index + 1}`, kind: 'p', performer: index }))
const AMP_SOURCE: Source = { id: 'E1', kind: 'e' }
/** Where the amplifier's envelope sits in the bar, and the first free slot right after it. */
const AMP_AT = PERFORMER_SOURCES.length
const FIRST_SLOT = AMP_AT + 1
/** A source's centre in the routing row: forty and a quarter each, and one more between trios. */
const SOURCE_AT = (index: number) => 20.125 + 40.25 * (index + Math.floor(index / 3))
/** The three slots' left edges. */
const SLOT_X = [0, 414.5, 832.5]
/** The gap before each slot's panel, which the reference's hairlines between them measure. */
const SLOT_GAP = [0, 1, 0.5]
/** The slot a modulator's property path names, or null for the amplifier's own, which stays put. */
const held = (source: Source): { path: string; id: string } | null =>
  source.performer !== undefined ? { path: `performers[${source.performer}]`, id: source.id }
  : source.mod !== undefined ? { path: `mods[${source.mod}]`, id: source.id }
  : null

function macroHint(slot: MacroSlot, index: number, patch: AudioPatch): string {
  if (slot.destinations.length === 0) {
    return `Drag this number onto any knob or fader, or press Enter and then Enter again on the control: macro ${index + 1} will turn it, and the patch exposes it.`
  }
  const dests = slot.destinations.map((dest) => macroPropertyLabel(dest.property)).join(', ')
  const parked = inactiveMacroDestinations(slot, patch)
  const park = parked.length
    ? ` ${parked.map((property) => macroPropertyLabel(property)).join(', ')} ${parked.length === 1 ? 'is' : 'are'} parked until this knob moves.`
    : ''
  return `${slot.label || `Macro ${index + 1}`} turns ${dests}.${park} Drag the number onto another control to add a destination; double-click or Delete frees it.`
}

/**
 * Memoised, because the page it sits on re-renders on every frame of playback.
 *
 * The playhead is state on the editor page, so a sound playing means sixty renders a second of
 * everything under it — and this is a hundred absolutely positioned controls with an SVG apiece.
 * None of its props change while a sound plays. Every one of them has to be handed in as the same
 * object each time for that to hold, which is why the page builds them with `useCallback` and
 * `useMemo` rather than writing them into the JSX.
 */
export const AudioFacePlate = memo(function AudioFacePlate({ parameters, values, duration, patch, onChange, onGestureStart, onGestureEnd, patterns, onPattern, curves, onCurves, rig, onRig, onMacros, onImportTable }: {
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  duration: number
  patch: AudioPatch
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  /** Each performer's twelve rows of sixteen levels, and how a row is redrawn. */
  patterns?: number[][][]
  onPattern?: (performer: number, scene: number, steps: number[]) => void
  /** The joinings, kept beside the levels: twelve rows of sixteen, one a performer. */
  curves?: number[][][]
  onCurves?: (performer: number, scene: number, curves: number[]) => void
  /** The document's rig, which the macro band shows and edits. */
  rig?: AudioRig
  onRig?: (next: AudioRig) => void
  /** A mapped macro turned: the rig and the patch it writes, in one step. */
  onMacros?: (next: AudioRig, nextPatch: AudioPatch, index?: number) => void
  onImportTable?: (layer: number) => void
}) {
  const [focus, setFocus] = useState(0)
  /** Which of a layer's three insert slots the panel is showing. Nothing is hidden, only stacked. */
  const [slot, setSlot] = useState(0)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [rename, setRename] = useState('')
  const renameFinished = useRef(false)
  const macros = macrosOf(rig, patch)
  const ctx: Ctx = {
    byId: new Map(parameters.map((parameter) => [parameter.id, parameter])),
    values, onChange, onGestureStart, onGestureEnd, focus, setFocus, macros,
  }

  const commitMacros = (table: MacroSlot[], apply = false, index?: number) => {
    if (!onRig) return
    const nextTable = apply && index !== undefined
      ? prepareMacroMove(macros, index, table[index]?.value ?? 0, patch)
      : table
    const nextRig = writeMacros(rig, nextTable, patch)
    if (apply && onMacros) onMacros(nextRig, applyMacros(patch, nextTable, nextRig, index), index)
    else onRig(nextRig)
  }
  /**
   * A macro dropped on a control takes that property; a property carries one macro at most, so
   * any macro already on it lets go. Destinations already on this macro stay.
   */
  const bindMacro = (index: number, property: string) => {
    if (!ctx.byId.get(property)) return
    commitMacros(addMacroDestination(macros, index, property, patch))
  }
  const unbindMacro = (index: number) => {
    if ((macros[index]?.destinations.length ?? 0) === 0) return
    commitMacros(removeMacro(macros, index))
  }
  const f = focus
  const L = (index: number, tail: string) => `layers[${index}].${tail}`
  const gesture = { onGestureStart, onGestureEnd }

  // The stage fits the plate to the room it has, as the plugin's window zoom does.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const plateRef = useRef<HTMLDivElement | null>(null)
  /** The room the stage gives the plate; nothing until it is measured, which is the reference's size. */
  const [room, setRoom] = useState({ w: 0, h: 0 })
  const { layout, scale } = room.w && room.h ? fitPlate(room.w, room.h) : { layout: 'wide' as Layout, scale: 1 }
  /** A folded face: one modulator at a time, the strip's slots sharing the width. */
  const folded = layout !== 'wide'
  const rows = DEAL[layout]
  const box = plateBox(layout, scale, room)

  /**
   * Assigning a modulator the reference's way: pick up its handle in the routing bar and drop it
   * on a control. While it is held, every control that could take it lights its arc in the
   * source's colour, and a small badge of its name follows the pointer. The Target field in the
   * modulator's own panel does the same job for a keyboard.
   */
  const [assigning, setAssigning] = useState<Source | { id: string; kind: 'm'; macro: number } | null>(null)
  /** The control whose hint is due: the pointer's or the focus's, whichever came last. */
  const [hinted, setHinted] = useState<HTMLElement | null>(null)
  const hintOf = (node: EventTarget | null) => ((node as HTMLElement | null)?.closest?.('[data-hint]') as HTMLElement | null) ?? null
  const hintFrom = (event: SyntheticEvent) => setHinted(hintOf(event.target))
  /** The source whose modulator is on show: with its two neighbours on the wide face, alone on the narrow. */
  /** The bar, named from what each slot currently holds. */
  const SOURCES: Source[] = [
    ...PERFORMER_SOURCES,
    AMP_SOURCE,
    ...Array.from({ length: MOD_COUNT }, (_, index): Source => {
      const envelope = read(ctx, `mods[${index}].kind`) !== 'lfo'
      return { id: `${envelope ? 'E' : 'L'}${index + 2}`, kind: envelope ? 'e' : 'l', mod: index }
    }),
  ]
  const [shown, setShown] = useState(AMP_AT)
  /** The control a right-click asked about, in window coordinates, and what it is called. */
  const [routed, setRouted] = useState<{ x: number; y: number; label: string; target: string } | null>(null)
  const askRouting = (event: React.MouseEvent<HTMLElement>) => {
    const control = (event.target as HTMLElement | null)?.closest?.('[data-target]') as HTMLElement | null
    const target = control?.getAttribute('data-target')
    if (!target || modsOf(ctx, target).length === 0) return
    event.preventDefault()
    setRouted({ x: event.clientX, y: event.clientY, label: control?.getAttribute('aria-label') ?? 'This control', target })
  }
  /** How many of a source's four routes are pointed at something, for what the bar says about it. */
  const spent = (source: Source) => {
    const slot = held(source)
    if (!slot) return 0
    return Array.from({ length: MOD_ROUTES }, (_, at) => routeAt(at))
      .filter((route) => (read(ctx, `${slot.path}.${route.target}`) ?? 'off') !== 'off').length
  }

  /** Where a source's own panel is in the bar, so the menu and the overlay can send you to it. */
  const slotOf = (id: string) => {
    const performer = /^performers\[(\d+)\]$/.exec(id)
    if (performer) return Number(performer[1])
    const mod = /^mods\[(\d+)\]$/.exec(id)
    return mod ? PERFORMER_COUNT + 1 + Number(mod[1]) : null
  }
  /** Every live routing in the patch, in the order the bar shows them. */
  const routes = SOURCES.flatMap((source, index) => {
    const id = source.performer !== undefined ? `performers[${source.performer}]` : source.mod !== undefined ? `mods[${source.mod}]` : null
    if (!id) return []
    if (read(ctx, `${id}.enabled`) === false) return []
    // One line per route: a source pointed at three things is three routings, and an overlay that
    // showed the first of them would be answering a different question from the one it asks.
    return Array.from({ length: MOD_ROUTES }, (_, at) => routeAt(at)).flatMap((route) => {
      const target = String(read(ctx, `${id}.${route.target}`) ?? 'off')
      if (target === 'off') return []
      return [{
        id: `${id}#${route.target}`, index, name: source.id, kind: source.kind,
        target, depth: readNum(ctx, `${id}.${route.depth}`),
      }]
    })
  })
  const page = Math.floor(shown / 3)
  /** Which row the performers play, held on the patch. */
  const scene = Math.min(SCENE_COUNT - 1, Math.max(0, Math.round(readNum(ctx, 'scene', 0))))
  /** The modulators on show, each with its slot of the three; the narrow face deals one, in the first. */
  const modulators = folded ? [{ source: shown, slot: 0 }] : [0, 1, 2].map((slot) => ({ source: page * 3 + slot, slot }))
  const ghostRef = useRef<HTMLSpanElement | null>(null)
  const follow = (event: { clientX: number; clientY: number }) => {
    const plate = plateRef.current?.getBoundingClientRect()
    const ghost = ghostRef.current
    if (!plate || !ghost) return
    ghost.style.left = `${(event.clientX - plate.left) / scale + 14}px`
    ghost.style.top = `${(event.clientY - plate.top) / scale - 9}px`
  }
  const pickUp = (what: Source | { id: string; kind: 'm'; macro: number }) => (event: React.PointerEvent<HTMLElement>) => {
    if (event.button && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setAssigning(what)
    follow(event)
  }

  /**
   * A source cell: one target for two gestures, told apart by whether the pointer moved.
   *
   * Under four pixels it is a click and shows the modulator's panel below; past four it is a drag
   * and the source is in the air. Both used to have a control of their own — a cross for the drag
   * and the name for the click — and the cross was seventeen pixels wide before the plate's scale
   * took a slice off it.
   */
  const from = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const takeSource = (source: Source, index: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button && event.button !== 0) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      from.current = { x: event.clientX, y: event.clientY, moved: false }
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const start = from.current
      if (!start || !held(source)) return
      if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return
      if (!start.moved) { start.moved = true; setAssigning(source) }
      follow(event)
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const start = from.current
      from.current = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      if (!start || !start.moved) { setShown(index); return }
      putDown(event)
    },
    onPointerCancel: () => { from.current = null; setAssigning(null) },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') { setAssigning(null); return }
      const slot = held(source)
      if (slot && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault()
        for (let at = 0; at < MOD_ROUTES; at += 1) onChange(`${slot.path}.${routeAt(at).target}`, 'off')
        return
      }
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      if (!slot) { setShown(index); return }
      if (assigning?.id === source.id) { setAssigning(null); return }
      const box = event.currentTarget.getBoundingClientRect()
      setAssigning(source)
      setShown(index)
      follow({ clientX: box.left, clientY: box.bottom })
    },
  })
  /**
   * The same two moves without a pointer: pick a macro up, walk to a control, drop it.
   *
   * Binding a macro is what exposes a parameter to Tune and to the SDK, and the Tune button only
   * appears once something is exposed — so with the number reachable by pointer alone, a keyboard
   * user could not build a rig at all. Enter picks up and drops, Escape puts back, Delete frees.
   * A held macro lights every control that can take it, which it already did for the pointer.
   */
  const carry = (index: number) => (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      unbindMacro(index)
      return
    }
    if (event.key === 'Escape') { setAssigning(null); return }
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    if (assigning?.kind === 'm' && assigning.macro === index) { setAssigning(null); return }
    const box = event.currentTarget.getBoundingClientRect()
    setAssigning({ id: `M${index + 1}`, kind: 'm', macro: index })
    follow({ clientX: box.left, clientY: box.bottom })
  }

  /** Enter on any control that can take what is held, while something is held, drops it there. */
  const dropCarried = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      setAssigning(null)
      setRenaming(null)
      return
    }
    if (event.key !== 'Enter') return
    if (!assigning) return
    const node = event.target as HTMLElement | null
    if (assigning.kind === 'm') {
      const property = node?.closest?.('[data-property]')?.getAttribute('data-property')
      if (!property) return
      event.preventDefault()
      bindMacro(assigning.macro, property)
      setAssigning(null)
      return
    }
    const slot = held(assigning)
    const target = node?.closest?.('[data-target]')?.getAttribute('data-target')
    if (!slot || !target) return
    event.preventDefault()
    dropSource(slot.path, target)
    setAssigning(null)
  }

  const putDown = (event: React.PointerEvent<HTMLElement>) => {
    const under = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY) : null
    if (assigning && assigning.kind === 'm') {
      const property = under?.closest?.('[data-property]')?.getAttribute('data-property')
      if (property) bindMacro(assigning.macro, property)
      setAssigning(null)
      return
    }
    const slot = assigning ? held(assigning) : null
    if (!slot) { setAssigning(null); return }
    const target = under?.closest?.('[data-target]')?.getAttribute('data-target')
    if (target) dropSource(slot.path, target)
    setAssigning(null)
  }

  /**
   * A source dropped on a control takes the first route it has free, rather than the first route.
   *
   * A modulator holds four of them, so dropping an oscillator on a cutoff and then on a pan gives
   * one oscillator moving two things — which is the whole reason a slot has four. Dropping it on
   * something it is already pointed at is a no-op rather than a second ring saying the same thing,
   * and a source with all four spent says so instead of silently replacing one of them.
   */
  const dropSource = (path: string, target: string) => {
    const routes = Array.from({ length: MOD_ROUTES }, (_, at) => routeAt(at))
    if (routes.some((route) => read(ctx, `${path}.${route.target}`) === target)) return
    // With all four spent nothing happens, rather than one of them being replaced by surprise. The
    // handle's own hint counts them, so the bar says why before the drop is attempted.
    const free = routes.find((route) => (read(ctx, `${path}.${route.target}`) ?? 'off') === 'off')
    if (!free) return
    onChange(`${path}.${free.target}`, target)
    if (read(ctx, `${path}.enabled`) === false) onChange(`${path}.enabled`, true)
  }
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect || !rect.width || !rect.height) return
      setRoom({ w: rect.width, h: rect.height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  /** An oscillator's source column: a tone, noise, or nothing at all. */
  const source = (index: number) => {
    const enabled = read(ctx, L(index, 'enabled')) !== false
    if (!enabled) return 'off'
    const kind = read(ctx, L(index, 'source.kind'))
    return kind === 'noise' ? 'noise' : kind === 'table' ? 'table' : 'tone'
  }
  const setSource = (index: number, mode: 'tone' | 'table' | 'noise' | 'off') => {
    if (mode === 'off') { onChange(L(index, 'enabled'), false); return }
    if (read(ctx, L(index, 'enabled')) === false) onChange(L(index, 'enabled'), true)
    onChange(L(index, 'source.kind'), mode)
  }
  /** Which of the layer's two filters the panel is showing, and where its fields live. */
  const [filterSlot, setFilterSlot] = useState(0)
  const F = (field: string) => `layers[${f}].${FILTER_SLOTS[filterSlot] ?? 'filterA'}.${field}`
  const filterKind = read(ctx, F('kind'))
  const routing = String(read(ctx, `layers[${f}].routing`) ?? 'single')
  const inserted = slotAt(ctx, f, slot)
  const letter = INSERT_LETTERS[slot] ?? 'A'
  const I = (field: string) => `layers[${f}].${INSERT_SLOTS[slot] ?? 'insertA'}.${field}`
  const colourName = (index: number) => {
    const colour = read(ctx, L(index, 'source.colour'))
    return colour === 'pink' ? 'Pink' : colour === 'metallic' ? 'Metal' : 'White'
  }
  const cycleColour = (index: number) => {
    const order = ['white', 'pink', 'metallic']
    const current = read(ctx, L(index, 'source.colour'))
    onChange(L(index, 'source.colour'), order[(order.indexOf(typeof current === 'string' ? current : 'white') + 1) % order.length] ?? 'white')
  }
  /**
   * What bends an oscillator's phase, and the word that says so.
   *
   * A layer cannot name itself, so the list it steps through is the whole one less its own entry.
   * The ratio beside it tunes the internal modulator and means nothing to a layer, which arrives
   * at whatever pitch it is already playing — so the ratio goes away when a layer is named, rather
   * than sitting there as a number that does nothing.
   */
  const pmName = (index: number) => {
    const current = String(read(ctx, L(index, 'source.pmFrom')) ?? 'internal')
    return PM_NAMES[current] ?? 'Self'
  }
  const cyclePm = (index: number) => {
    const options = PM_SOURCES.filter((name) => name !== `layer${index}`)
    const current = String(read(ctx, L(index, 'source.pmFrom')) ?? 'internal')
    const at = options.indexOf(current as (typeof options)[number])
    onChange(L(index, 'source.pmFrom'), options[(at + 1) % options.length] ?? 'internal')
  }
  const pmWord = (index: number, x: number) => (
    <Text x={x} y={322} u onClick={() => cyclePm(index)}
      label={`${index < 2 ? `Oscillator ${index + 1}` : `Noise ${index - 1}`} phase modulator: ${pmName(index)}`}
      hint="What bends this oscillator's phase: its own modulator, or another layer's whole output — wave, envelope, filter and all. Click to step to the next.">
      {pmName(index)}
    </Text>
  )

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
  /** The wave picker at the head of an oscillator: the four waves of the table, the chosen one lit. */
  const wavePicker = (index: number, left: number) => {
    const wave = waveOf(read(ctx, L(index, 'source.wave')))
    const widths = { sine: 25, triangle: 16, saw: 24, square: 18 }
    let x = left
    if (source(index) === 'table') {
      const tables = listedWavetables()
      return (
        <>
        <SlotMenu x={left} y={53} w={124} label={`Oscillator ${index + 1} wavetable`}
          value={String(read(ctx, L(index, 'source.table')) ?? 'sweep')}
          hint="Which wavetable this oscillator reads. The big dial walks along it."
          options={tables.map((entry) => ({ value: entry.id, label: entry.label, note: entry.note, mark: <TableMark name={entry.id} /> }))}
          onPick={(next) => onChange(L(index, 'source.table'), next)}
          action={onImportTable ? {
            label: 'Import WAV…',
            onPick: () => onImportTable(index),
          } : undefined} />
        </>
      )
    }
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
      <Text x={cx} y={148} size={11} kind="dim">Source</Text>
      <Choices x={cx} y={158} w={44} row={12.5} label={`Oscillator ${index + 1} source`} options={[
        { word: 'Tone', on: source(index) === 'tone', onPick: () => setSource(index, 'tone'), hint: 'One of four fixed shapes, at a pitch.' },
        { word: 'Table', on: source(index) === 'table', onPick: () => setSource(index, 'table'), hint: 'A wavetable: the big dial walks along its shape instead of setting a pitch.' },
        { word: 'Noise', on: source(index) === 'noise', onPick: () => setSource(index, 'noise'), hint: 'This layer makes noise instead of a tone.' },
        { word: 'Off', on: source(index) === 'off', onPick: () => setSource(index, 'off'), hint: 'This layer is silent.' },
      ]} />
      <Text x={cx} y={214} size={11} kind="dim">Voices</Text>
      <Knob ctx={ctx} x={cx} y={242.5} id={L(index, 'source.voices')} label="Voices" size="sm" />
    </>
  )

  /** The body's items, each at its measured size, for the face to deal into rows. */
  const panels: Record<Exclude<Item, 'modulators'>, ReactNode> = {
    pitch: (
    <Panel x={0} y={54} w={67} h={288} label="Pitch" tone="bare" follow={f + 1}>
      <Text x={32} y={59.5} kind="title">Pitch</Text>
      <Readout ctx={ctx} x={-18} base={96.5} mark="none" value={semitones(readNum(ctx, L(f, 'pitch.start'), 440))} label={`Layer ${f + 1} pitch`} edit={pitchEdit(L(f, 'pitch.start'))} />
      <Text x={32} y={104}>Arp Ratio</Text>
      <Knob ctx={ctx} x={32} y={138} id={L(f, 'pitch.arpeggioRatio')} label="Arp Ratio" size="sm" />
      <Text x={32} y={160}>Arp At</Text>
      <Knob ctx={ctx} x={32} y={194} id={L(f, 'pitch.arpeggioAt')} label="Arp At" size="sm" />
      <Text x={32} y={216}>Detune</Text>
      <Knob ctx={ctx} x={32} y={250} id={L(f, 'source.detune')} label="Detune" size="sm"
        idle={source(f) === 'noise' ? 'detune spreads a layer\u2019s unison copies, and a noise layer has none' : undefined} />
      <Text x={31.8} y={272}>Time</Text>
      <Knob ctx={ctx} x={31.5} y={306} id="duration" label="Time" tone="light" />
    </Panel>
    ),
    osc: (
    <Panel x={68} y={54} w={515} h={288} label="Oscillators" gap={1}>
      {/* the head */}
      {wavePicker(0, 149.5)}
      <span role="tablist" aria-label="Oscillator layer" className="fp-tabs">
        <Badge x={281} y={65} kind="hex" tab selected={f === 0} onClick={() => setFocus(0)} label="Oscillator 1" hint="Edit oscillator 1: the pitch, insert, filter and amp envelope panels follow the lit layer.">1</Badge>
        <Badge x={369.5} y={65} kind="hex" tab selected={f === 1} onClick={() => setFocus(1)} label="Oscillator 2" hint="Edit oscillator 2: the pitch, insert, filter and amp envelope panels follow the lit layer.">2</Badge>
      </span>
      <Text x={324} y={60} kind="title">Osc</Text>
      {wavePicker(1, 391.2)}
      <Line x={325} y={54} w={1} h={215.5} colour="var(--fp-hairline)" />
      {/* oscillator 1 */}
      <Readout ctx={ctx} x={72.5} base={96.5} mark="note" value={semitones(readNum(ctx, L(0, 'pitch.start'), 440))} label="Oscillator 1 pitch" edit={pitchEdit(L(0, 'pitch.start'))} />
      {sideColumn(0, 104)}
      <Knob ctx={ctx} x={204.5} y={128.4} id={source(0) === 'table' ? L(0, 'source.position') : L(0, 'pitch.start')} label="Pos1" size="hero" face={<WaveGlyph kind={read(ctx, L(0, 'source.kind'))} wave={read(ctx, L(0, 'source.wave'))} pulseWidth={readNum(ctx, L(0, 'source.pulseWidth'), 0.5)} pitch={readNum(ctx, L(0, 'pitch.start'), 440)} fmIndex={readNum(ctx, L(0, 'source.fmIndex'), 0)} fmRatio={readNum(ctx, L(0, 'source.fmRatio'), 1)} table={String(read(ctx, L(0, 'source.table')) ?? 'sweep')} position={readNum(ctx, L(0, 'source.position'), 0.5)} inserts={beforeAmp(ctx, 0)} />} />
      <Text x={166.9} y={184}>Width</Text>
      <Text x={240.7} y={184.5}>Slide</Text>
      <Knob ctx={ctx} x={166.9} y={225.5} id={L(0, 'source.pulseWidth')} label="Width" />
      <Knob ctx={ctx} x={240.7} y={226.2} id={L(0, 'pitch.slide')} label="Slide" />
      <Fader ctx={ctx} x={298} top={85.5} id={L(0, 'gain')} label="Level1" />
      {/* oscillator 2 */}
      <Fader ctx={ctx} x={352.5} top={85.5} id={L(1, 'gain')} label="Level2" />
      <Knob ctx={ctx} x={445.8} y={128.2} id={source(1) === 'table' ? L(1, 'source.position') : L(1, 'pitch.start')} label="Pos2" size="hero" face={<WaveGlyph kind={read(ctx, L(1, 'source.kind'))} wave={read(ctx, L(1, 'source.wave'))} pulseWidth={readNum(ctx, L(1, 'source.pulseWidth'), 0.5)} pitch={readNum(ctx, L(1, 'pitch.start'), 440)} fmIndex={readNum(ctx, L(1, 'source.fmIndex'), 0)} fmRatio={readNum(ctx, L(1, 'source.fmRatio'), 1)} table={String(read(ctx, L(1, 'source.table')) ?? 'sweep')} position={readNum(ctx, L(1, 'source.position'), 0.5)} inserts={beforeAmp(ctx, 1)} />} />
      <Text x={409.3} y={184}>Width</Text>
      <Text x={482} y={184.5}>Slide</Text>
      <Knob ctx={ctx} x={409.3} y={225.5} id={L(1, 'source.pulseWidth')} label="Width" />
      <Knob ctx={ctx} x={482} y={226.3} id={L(1, 'pitch.slide')} label="Slide" />
      <Readout ctx={ctx} x={518} base={96.5} mark="note" value={semitones(readNum(ctx, L(1, 'pitch.start'), 440))} label="Oscillator 2 pitch" edit={pitchEdit(L(1, 'pitch.start'))} />
      {sideColumn(1, 547.5)}
      {/* the foot, with its notched rim: phase modulation between the two */}
      <svg className="fp-osc-foot" viewBox="0 0 515 14" style={{ left: 0, top: 203, width: 515, height: 14 }} aria-hidden="true">
        <path d="M0 0.5 H61 L77 12.5 H438 L454 0.5 H515" fill="none" style={{ stroke: 'var(--fp-hairline)' }} strokeWidth="1" />
        <path d="M0 1.5 H61.5 L77.5 13.5 H437.5 L453.5 1.5 H515" fill="none" style={{ stroke: 'var(--fp-line)' }} strokeWidth="1" />
      </svg>
      {read(ctx, L(0, 'source.pmFrom')) === undefined || read(ctx, L(0, 'source.pmFrom')) === 'internal' ? (
        <Readout ctx={ctx} x={70.5} base={289} mark="ratio" value={readNum(ctx, L(0, 'source.fmRatio'), 1)} label="Oscillator 1 modulator ratio" edit={ratioEdit(L(0, 'source.fmRatio'))} />
      ) : null}
      {pmWord(0, 100)}
      <Text x={203.8} y={280} u onClick={() => cycleWave(0)} label={`Oscillator 1 wave: ${WAVE_NAMES[waveOf(read(ctx, L(0, 'source.wave')))]}`} hint="The oscillator's wave. Click to step to the next.">{WAVE_NAMES[waveOf(read(ctx, L(0, 'source.wave')))]}</Text>
      <Icon x={204.6} y={314.3} w={35} h={35}><WaveDisc wave={waveOf(read(ctx, L(0, 'source.wave')))} pulseWidth={readNum(ctx, L(0, 'source.pulseWidth'), 0.5)} /></Icon>
      <Text x={277.2} y={281}>PM1</Text>
      <Text x={325.5} y={282}>Fall</Text>
      <Text x={373.8} y={281}>PM2</Text>
      <Knob ctx={ctx} x={277.2} y={313.9} id={L(0, 'source.fmIndex')} label="PM1" size="sm" />
      <Knob ctx={ctx} x={325.5} y={314} id={L(0, 'source.fmFall')} label="Fall" size="sm" />
      <Knob ctx={ctx} x={373.8} y={313.9} id={L(1, 'source.fmIndex')} label="PM2" size="sm" />
      <Text x={447.3} y={280} u onClick={() => cycleWave(1)} label={`Oscillator 2 wave: ${WAVE_NAMES[waveOf(read(ctx, L(1, 'source.wave')))]}`} hint="The oscillator's wave. Click to step to the next.">{WAVE_NAMES[waveOf(read(ctx, L(1, 'source.wave')))]}</Text>
      <Icon x={445.9} y={314.4} w={35} h={35}><WaveDisc wave={waveOf(read(ctx, L(1, 'source.wave')))} pulseWidth={readNum(ctx, L(1, 'source.pulseWidth'), 0.5)} /></Icon>
      {read(ctx, L(1, 'source.pmFrom')) === undefined || read(ctx, L(1, 'source.pmFrom')) === 'internal' ? (
        <Readout ctx={ctx} x={512.5} base={289} mark="ratio" value={readNum(ctx, L(1, 'source.fmRatio'), 1)} label="Oscillator 2 modulator ratio" edit={ratioEdit(L(1, 'source.fmRatio'))} />
      ) : null}
      {pmWord(1, 542)}
    </Panel>
    ),
    noise: (
    <Panel x={599.5} y={54} w={95} h={288} label="Noise" tone="noise" gap={16.5}>
      <span role="tablist" aria-label="Noise layer" className="fp-tabs">
        <Badge x={604} y={65} kind="noise" tab selected={f === 2} onClick={() => setFocus(2)} label="Noise 1" hint="Edit noise 1: the pitch, insert, filter and amp envelope panels follow the lit layer.">1</Badge>
        <Badge x={673} y={65} kind="noise" tab selected={f === 3} onClick={() => setFocus(3)} label="Noise 2" hint="Edit noise 2: the pitch, insert, filter and amp envelope panels follow the lit layer.">2</Badge>
      </span>
      <Text x={639} y={59.5} kind="title">Noise</Text>
      <Fader ctx={ctx} x={615} top={87.5} id={L(2, 'gain')} label="Noise 1 level" kind="noise" />
      <Fader ctx={ctx} x={663} top={87.5} id={L(3, 'gain')} label="Noise 2 level" kind="noise" />
      <Text x={614.7} y={204} u onClick={() => cycleColour(2)} label={`Noise 1 colour: ${colourName(2)}`} hint="The noise colour: white, pink or metallic. Click to step to the next.">{colourName(2)}</Text>
      <Text x={661.8} y={204.5} u onClick={() => cycleColour(3)} label={`Noise 2 colour: ${colourName(3)}`} hint="The noise colour: white, pink or metallic. Click to step to the next.">{colourName(3)}</Text>
      <Icon x={614.8} y={239.2} w={38} h={29.5}><NoiseBurst seed={1} colour={read(ctx, L(2, 'source.colour'))} /></Icon>
      <Icon x={663.2} y={239} w={38} h={29.5}><NoiseBurst seed={2} colour={read(ctx, L(3, 'source.colour'))} /></Icon>
      <Text x={614.9} y={273}>Pitch</Text>
      <Text x={663} y={273}>Pitch</Text>
      <Knob ctx={ctx} x={614.9} y={306.7} id={L(2, 'pitch.start')} label="Noise 1 pitch" size="sm" tone="light" />
      <Knob ctx={ctx} x={663} y={306.7} id={L(3, 'pitch.start')} label="Noise 2 pitch" size="sm" tone="light" />
    </Panel>
    ),
    insert: (
    <Panel x={696.5} y={54} w={159} h={288} label="Insert" gap={2} follow={f + 1}>
      <span role="tablist" aria-label="Insert slot" className="fp-tabs">
        {INSERT_LETTERS.map((name, index) => (
          <Badge key={name} x={707.5 + index * 19} y={65} kind="circle" tab selected={slot === index} onClick={() => setSlot(index)}
            label={`Insert ${name}`} hint={`Show insert ${name}. The three run in the order A, B, C, and each says which side of the amp it stands on.`}>{name}</Badge>
        ))}
      </span>
      <Text x={806} y={59.5} kind="title">Insert</Text>
      <SlotMenu x={714} y={82} w={124} label={`Insert ${letter} kind`} value={inserted.kind} columns={4}
        hint="What this slot is. The picture beside each is that effect answering the same short burst."
        options={INSERT_MODELS.map((model) => ({ ...model, mark: <InsertMark kind={model.value} /> }))}
        onPick={(next) => {
          onChange(I('kind'), next)
          // Three of the seven rest at a value that is an exact bypass — drive 0, sixteen bits,
          // no crush — so choosing them did nothing at all and the slot looked broken. A slot that
          // has been that kind before keeps whatever it was left at; one that has not is given
          // something to be heard as. Everything else is audible where it stands.
          const wake = WOKEN[next]
          if (wake && inserted[wake.field] === wake.silent) onChange(I(wake.field), wake.value)
        }} />
      {inserted.kind === 'off' ? (<>
        {/* An empty slot is a wire, and the panel says so with the same picture the picker uses
            rather than leaving a hole where the controls of a kind would be. */}
        <Icon x={776} y={186} w={124} h={66} className="fp-face"><InsertMark kind="off" /></Icon>
        <Text x={776} y={246} kind="dim">Nothing in this slot</Text>
      </>) : (
        <>
          <Text x={776} y={116} u onClick={() => onChange(I('place'), inserted.place === 'post' ? 'pre' : 'post')}
            label={`Insert ${letter} stands ${inserted.place === 'post' ? 'after' : 'before'} the amp`}
            hint="Which side of the amp envelope this slot stands on. Before it bites the loud part of the sound; after it keeps ringing once the sound has gone.">
            {inserted.place === 'post' ? 'After the amp' : 'Before the amp'}
          </Text>
          {inserted.kind !== 'body' ? (<>
            <Text x={739.9} y={148}>Amount</Text>
            <Knob ctx={ctx} x={739.9} y={190} id={I('amount')} label="Amount" />
          </>) : null}
          {inserted.kind === 'drive' || inserted.kind === 'fold' ? (<>
            <Text x={811.4} y={148}>Drive</Text>
            <Knob ctx={ctx} x={811.4} y={190} id={I('drive')} label="Drive" />
          </>) : null}
          {inserted.kind === 'crusher' ? (<>
            <Text x={811.4} y={148}>Bits</Text>
            <Knob ctx={ctx} x={811.4} y={190} id={I('bitDepth')} label="Bits" />
            <Text x={776} y={246}>Crush</Text>
            <Knob ctx={ctx} x={776} y={288} id={I('crush')} label="Crush" />
          </>) : null}
          {inserted.kind === 'ring' ? (<>
            <Text x={811.4} y={148}>Ratio</Text>
            <Knob ctx={ctx} x={811.4} y={190} id={I('ratio')} label="Ratio" />
          </>) : null}
          {inserted.kind === 'comb' ? (<>
            <Text x={811.4} y={148}>Time</Text>
            <Knob ctx={ctx} x={811.4} y={190} id={I('time')} label="Time" />
            <Text x={776} y={246}>Feedback</Text>
            <Knob ctx={ctx} x={776} y={288} id={I('feedback')} label="Feedback" />
          </>) : null}
          {inserted.kind === 'body' ? (<>
            <Text x={811.4} y={148}>Size</Text>
            <Knob ctx={ctx} x={811.4} y={190} id={I('frequency')} label="Size" />
            <SlotMenu x={728} y={148} w={72} label="Material" columns={2}
              value={String(read(ctx, I('profile')) || 'bar')}
              hint="The resonances this body rings at. Names of intention, not a claim of physical modelling."
              options={BODY_PROFILES}
              onPick={(next) => onChange(I('profile'), next)} />
            <Text x={728} y={238}>Damping</Text>
            <Text x={776} y={238}>Character</Text>
            <Text x={824} y={238}>Mix</Text>
            <Knob ctx={ctx} x={728} y={272} id={I('decay')} label="Damping" size="sm" />
            <Knob ctx={ctx} x={776} y={272} id={I('character')} label="Character" size="sm" />
            <Knob ctx={ctx} x={824} y={272} id={I('amount')} label="Mix" size="sm" />
            <Readout ctx={ctx} x={741} base={322} mark="note" value={semitones(readNum(ctx, I('frequency'), 440))} label="Body pitch" edit={pitchEdit(I('frequency'))} />
          </>) : null}
        </>
      )}
    </Panel>
    ),
    filter: (
    <Panel x={857} y={54} w={160} h={288} label="Filter" gap={1.5} follow={f + 1}>
      <span role="tablist" aria-label="Filter slot" className="fp-tabs">
        {FILTER_LETTERS.map((name, index) => (
          <Badge key={name} x={866 + index * 19} y={65} kind="circle" tab selected={filterSlot === index}
            // Clicking B while only one filter is running is a request for two of them: the tab
            // used to open a panel of controls that changed nothing at all, which is the same
            // thing as a broken filter as far as anybody turning the knobs can tell.
            onClick={() => { setFilterSlot(index); if (index === 1 && routing === 'single') onChange(`layers[${f}].routing`, 'series') }}
            label={`Filter ${name}`} hint={index === 1 && routing === 'single'
              ? 'Show filter B, and put it after A — while the routing is One filter, B is not in the sound.'
              : `Show filter ${name}. What the two do to each other is the word under them.`}>{name}</Badge>
        ))}
      </span>
      <SlotMenu x={905} y={58} w={100} label="Filter model" columns={3}
        value={typeof filterKind === 'string' ? filterKind : 'off'}
        hint="Which filter this is. The picture beside each is its measured response."
        options={FILTER_MODELS.map((model) => ({ ...model, mark: <FilterMark kind={model.value} /> }))}
        onPick={(next) => onChange(F('kind'), next)} />
      <Text x={900.5} y={79.5}>Cutoff</Text>
      <Text x={972.4} y={80}>Reso</Text>
      <Knob ctx={ctx} x={900.5} y={122} id={F('cutoff')} label="Cutoff" />
      <Knob ctx={ctx} x={972.4} y={121.2} id={F('resonance')} label="Reso" />
      <Text x={900.5} y={167.5}>Env</Text>
      <Knob ctx={ctx} x={900.5} y={209.6} id={F('envAmount')} label="Env" />
      <Text x={972.4} y={168}>Balance</Text>
      <Knob ctx={ctx} x={972.4} y={209.6} id={`layers[${f}].filterMix`} label="Balance"
        idle={routing === 'parallel' ? undefined : 'nothing to balance until the two filters run side by side'} />
      <Text x={936.5} y={250} u onClick={() => onChange(`layers[${f}].routing`, ROUTINGS[(ROUTINGS.indexOf(routing) + 1) % ROUTINGS.length] ?? 'single')}
        label={`Filter routing: ${ROUTING_NAMES[routing] ?? 'One filter'}`}
        hint="What the two filters do to each other. One is A alone; B after A is one shape rather than two; both at once, balanced, is what makes vowels and phasing. Click to step to the next.">
        {ROUTING_NAMES[routing] ?? 'One filter'}
      </Text>
      {/* What the filter is doing, at the size the drive left behind when it moved out to a slot. */}
      <Icon x={937} y={300} w={112} h={52} className="fp-face" hint="The model's measured response, standing at the corner the cutoff is set to.">
        <FilterFace kind={typeof filterKind === 'string' ? filterKind as FilterKind : 'off'} cutoff={readNum(ctx, F('cutoff'), 8000)} />
      </Icon>
    </Panel>
    ),
    amp: (
    <Panel x={1018.5} y={54} w={70.5} h={336} label="Amp" tone="bare" gap={1.5}>
      <Text x={1053.5} y={60} kind="title">Amp</Text>
      <Text x={1053.5} y={76}>Level</Text>
      <Knob ctx={ctx} x={1053} y={112} id="master.gain" label="Level" tone="light" />
      <Text x={1053.5} y={160}>Width</Text>
      <Knob ctx={ctx} x={1053.3} y={196} id="fx.width" label="Width" tone="light" />
      <Text x={1053.5} y={244}>Limit</Text>
      <Knob ctx={ctx} x={1053.6} y={280} id="master.limiter" label="Limit" tone="light" />
      <Text x={1053.5} y={328}>Tone</Text>
      <Knob ctx={ctx} x={1053.6} y={364} id="fx.tone" label="Tone" tone="light" />
    </Panel>
    ),
    fx: (
    <Panel x={1090.5} y={54} w={159.5} h={288} label="FX" gap={1.5}>
      {FX_SLOTS.map((slot, at) => {
        const top = 54 + at * 96
        const kind = String(read(ctx, `fx.${slot}.kind`) ?? 'off')
        const sends = read(ctx, `fx.${slot}.mode`) === 'send'
        const knobs = FX_KNOBS[kind] ?? []
        return (
          <Fragment key={slot}>
            {at > 0 ? <Line x={1090.5} y={top} w={159.5} h={0.5} colour="var(--fp-rule-light)" /> : null}
            {/* The letter says which slot; whether it is lit says whether the sound goes through
                it or past it, which is the whole difference between an effect and a room. */}
            <Badge x={1100.5} y={top + 11} kind="square" selected={sends}
              onClick={() => onChange(`fx.${slot}.mode`, sends ? 'insert' : 'send')}
              label={`Effect ${slot.toUpperCase()} ${sends ? 'stands beside the sound' : 'stands in the sound'}`}
              hint="Where this effect stands. In the sound it replaces it in proportion to the mix, which is what a flanger is for; beside it, it is added and the dry is left alone, which is what a room is for.">
              {slot.toUpperCase()}
            </Badge>
            <SlotMenu x={1112} y={top + 2} w={112} label={`Effect ${slot.toUpperCase()} kind`} value={kind} columns={4}
              hint="What this effect is. The picture beside each is that effect answering the same short burst."
              options={FX_MODELS.map((model) => ({ ...model, mark: <FxMark kind={model.value} /> }))}
              onPick={(next) => onChange(`fx.${slot}.kind`, next)} />
            {knobs.length === 0 ? (
              /* An empty slot is a wire, and the row draws the wire rather than leaving a hole. */
              <Icon x={1170} y={top + 60} w={116} h={44} className="fp-face" hint="Nothing in this slot: the sound goes straight through it.">
                <FxMark kind="off" />
              </Icon>
            ) : knobs.map((knob, place) => (
              <Fragment key={knob.field}>
                <Text x={[1118, 1169.5, 1222][place] ?? 1170} y={top + 24}>{knob.label}</Text>
                <Knob ctx={ctx} x={[1117.8, 1169.9, 1222][place] ?? 1170} y={top + 62}
                  id={`fx.${slot}.${knob.field}`} label={`Effect ${slot.toUpperCase()} ${knob.label}`} size={place === 1 ? 'std' : 'sm'} />
              </Fragment>
            ))}
          </Fragment>
        )
      })}
    </Panel>
    ),
  }
  /** The routing bar: the sources, three by three; the wide face shows a trio below it, a folded face one. */
  const routingBar = (
    <div className="fp-routing" role="group" aria-label="Routing bar">
      <Origin.Provider value={{ x: 0, y: 0 }}>
        <ul className="fp-sources" role="list" aria-label="Routing">
          <span className="fp-sources__box" aria-hidden="true"
            style={folded ? { left: SOURCE_AT(shown) - 17, width: 34 } : { left: 4.125 + 161 * page, width: 116.5 }} />
          {SOURCES.map((source, index) => {
            const movable = held(source) !== null
            const using = spent(source)
            return (
              <li key={source.id} className="fp-source" data-kind={source.kind} data-live="" style={{ marginInlineStart: index % 3 === 0 && index > 0 ? 40.25 : 0 }}>
                {/*
                  * The whole cell is the handle, mark and name together, on one line.
                  *
                  * It used to be a seventeen-pixel cross above the name, and the cross was the only
                  * part that dragged: at the plate's own scale that is a target smaller than a
                  * fingernail with no hover state on it, so it read as decoration and people
                  * reached for the name underneath — which only ever opened the panel. One target,
                  * as wide as the cell, and a click and a drag are told apart by whether the
                  * pointer moved: click shows the panel below, drag assigns.
                  */}
                <span
                  className="fp-source__hold"
                  role="button"
                  tabIndex={0}
                  data-fixed={movable ? undefined : ''}
                  data-held={assigning?.id === source.id ? '' : undefined}
                  data-using={using || undefined}
                  aria-label={movable
                    ? `${source.id}, moving ${using} of four. Drag onto a control, or press Enter to pick it up`
                    : `${source.id}, the amplifier envelope, which stays put`}
                  data-hint={movable
                    ? `${source.id} is moving ${using === 0 ? 'nothing yet' : `${using} of the four things it can`}. Drag it onto a knob or fader — or press Enter, then Enter again on the control. Click to show its panel.`
                    : 'E1 is the amp envelope: it shapes the layer\u2019s level and stays put. Click to show its panel.'}
                  {...takeSource(source, index)}
                >
                  <span className="fp-source__mark" aria-hidden="true"><MoveIcon /></span>
                  <span className="fp-source__name">{source.id}</span>
                </span>
              </li>
            )
          })}
        </ul>
        {/*
         * Every routing in the patch, in one list.
         *
         * The bar says who exists and the controls say what is on them, and neither answers "what
         * is this patch actually doing" without walking the whole plate. Twelve sources and forty
         * destinations is more than anybody holds in their head.
         */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="fp-routes__open" data-hint="Every routing in this patch at once: which source moves which control, and how far.">
              {routes.length === 0 ? 'Nothing routed' : `${routes.length} routed`}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu fp-routes" align="start" side="top" sideOffset={6} collisionPadding={8} aria-label="Every routing">
              <DropdownMenu.Label className="menu__label">Every routing</DropdownMenu.Label>
              {routes.length === 0 ? (
                <p className="fp-routes__empty">Nothing is pointed at anything yet. Drag a handle from the bar onto a dial.</p>
              ) : routes.map((route) => (
                <DropdownMenu.Item key={route.id} className="menu__item" onSelect={() => setShown(route.index)}>
                  <span className="fp-routed__dot" style={{ background: SOURCE_COLOUR[route.kind] }} aria-hidden="true" />
                  <span>{route.name}</span>
                  <span className="fp-routes__to">{LFO_TARGET_LABELS[route.target] ?? route.target}</span>
                  <span className="fp-routed__depth">{route.depth.toFixed(2)}</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </Origin.Provider>
    </div>
  )
  const modulatorPanels = (
    <>
      {/* ═══ Modulators: three of nine at a time, the trio the routing bar chose; one on a folded face ═══ */}
      {modulators.filter((entry) => entry.source < AMP_AT).map(({ source, slot }) => {
        const index = source
        const o = 418.3 * slot
        const px = SLOT_X[slot] ?? 0
        const pw = slot === 0 ? 413.5 : 417.5
        const id = (tail: string) => `performers[${index}].${tail}`
        const on = read(ctx, id('enabled')) !== false
        const shape = (read(ctx, id('shape')) ?? 'step') as PerformerShape
        const bipolar = read(ctx, id('bipolar')) === true
        const rate = readNum(ctx, id('rate'), 1)
        const row = patterns?.[index]?.[scene] ?? Array.from({ length: STEP_COUNT }, () => 0)
        const join = curves?.[index]?.[scene] ?? Array.from({ length: STEP_COUNT }, () => 1)
        const grid = Math.round(readNum(ctx, id('grid'), 0))
        const Y = (local: number) => 384 + local
        const pickShape = (next: PerformerShape) => onChange(id('shape'), next)
        return (
          <Panel key={index} x={px} y={384} w={pw} h={288} label={`Performer ${index + 1}`} gap={SLOT_GAP[slot]}>
            <Text x={2.5 + o} y={Y(5.5)} align="left" kind="title">Modulator {index + 1}</Text>
            <Text x={203.3 + o} y={Y(5)} kind="title">Performer</Text>
            {/* the left column: how strong, how often, and whether at all */}
            <Text x={36.5 + o} y={Y(26)}>Level</Text>
            <Knob ctx={ctx} x={36 + o} y={Y(64)} id={id('depth')} label={`Performer ${index + 1} level`} tone="light" />
            <Text x={36.5 + o} y={Y(112)}>Rate</Text>
            <Knob ctx={ctx} x={36 + o} y={Y(150)} id={id('rate')} label={`Performer ${index + 1} rate`} />
            <Text x={36.5 + o} y={Y(186)} size={11} kind="dim">{rate.toFixed(2)} cycles</Text>
            <BoxMenu x={5 + o} y={Y(200)} w={62.5} text="Init" label={`Start performer ${index + 1} row ${scene + 1} from a shape`}
              hint="Start this row from a shape rather than from nothing, or copy it into another of the twelve.">
              <DropdownMenu.Label className="menu__label">Start from</DropdownMenu.Label>
              {ROW_SHAPES.map((made) => (
                <DropdownMenu.Item key={made.label} className="menu__item" onSelect={() => onPattern?.(index, scene, Array.from({ length: STEP_COUNT }, (_, at) => made.of(at, STEP_COUNT)))}>
                  {made.label}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="menu__sep" />
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="menu__item">Copy into…</DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className="menu" sideOffset={4}>
                    {Array.from({ length: SCENE_COUNT }, (_, other) => (
                      <DropdownMenu.Item key={other} className="menu__item" disabled={other === scene}
                        onSelect={() => { onPattern?.(index, other, [...row]); onCurves?.(index, other, [...join]) }}>
                        Row {other + 1}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </BoxMenu>
            <Box x={5 + o} y={Y(222)} w={62.5} selected={bipolar} pressed={bipolar} onClick={() => onChange(id('bipolar'), !bipolar)} label={`Performer ${index + 1} bipolar`} hint={bipolar ? 'Bipolar: half height is rest, the row swings both ways. Click for unipolar.' : 'Unipolar: the floor is rest, the row only pushes. Click for bipolar.'}>{bipolar ? 'Bi' : 'Uni'}</Box>
            <Box x={5 + o} y={Y(252)} w={62.5} selected={on} pressed={on} onClick={() => onChange(id('enabled'), !on)} label={`Performer ${index + 1} on`} hint={on ? 'This performer is running. Click to switch it off.' : 'This performer is off. Click to switch it on; dropping it on a control switches it on too.'}>On</Box>
            {/* Under the row, across its width: where this performer goes, and a cross to stop it. */}
            <Text x={98 + o} y={Y(268)} align="left" u>Moves</Text>
            <Routes ctx={ctx} x={132 + o} y={Y(262)} w={266} id={id} name={`P${index + 1}`} />
            {/* the row, and how it is read */}
            <span role="radiogroup" aria-label={`Performer ${index + 1} shape`}>
              <Text x={172 + o} y={Y(30)} u={shape === 'step'} checked={shape === 'step'} onClick={() => pickShape('step')} hint="Each step held flat until the next.">Step</Text>
              <Text x={218 + o} y={Y(30)} u={shape === 'line'} checked={shape === 'line'} onClick={() => pickShape('line')} hint="A straight line from each step to the next.">Line</Text>
              <Text x={268 + o} y={Y(30)} u={shape === 'curve'} checked={shape === 'curve'} onClick={() => pickShape('curve')} hint="Eased from each step into the next.">Curve</Text>
            </span>
            <Text x={366 + o} y={Y(30)} u onClick={() => onChange(id('grid'), GRIDS[(GRIDS.indexOf(grid) + 1) % GRIDS.length] ?? 0)}
              label={`Performer ${index + 1} grid: ${grid >= 2 ? `${grid} divisions` : 'off'}`}
              hint="What the drawing lands on. A row drawn freehand is a row of numbers nobody chose; three is a triplet feel, four a step sequence. Click to step to the next.">
              {grid >= 2 ? `Grid ${grid}` : 'Free'}
            </Text>
            <Block className="fp-pattern" x={82 + o} y={Y(44)} w={318} h={214} off={!on} hint={`Row ${scene + 1} of twelve: draw it with the pointer, from the floor to the top. The bar under the plate picks the row.`}>
              <AudioPattern steps={row} curves={join} shape={shape} bipolar={bipolar} grid={grid} width={318} height={214}
                name={`Performer ${index + 1} row ${scene + 1}`}
                onChange={(next) => onPattern?.(index, scene, next)} onCurves={(next) => onCurves?.(index, scene, next)} {...gesture} />
            </Block>
          </Panel>
        )
      })}
      {modulators.some((entry) => entry.source === AMP_AT) ? (
        <Panel x={0} y={384} w={413.5} h={288} label="Amp envelope" follow={f + 1}>
          <Text x={2.5} y={389.5} align="left" kind="title">Modulator 1</Text>
          <Text x={205.5} y={389} kind="title">Amp-Envelope</Text>
          <Text x={70.9} y={413.5}>Shape</Text>
          <Text x={120.8} y={413.5}>Pan</Text>
          <Text x={209} y={413.5}>Spread</Text>
          <Text x={257.5} y={413.5}>Sustain</Text>
          <Text x={370.5} y={413}>Env Level</Text>
          <Knob ctx={ctx} x={71.7} y={451.6} id={L(f, 'amp.curve')} label={`Layer ${f + 1} envelope shape`} size="sm" />
          <Knob ctx={ctx} x={119.6} y={450.9} id={L(f, 'pan')} label="Pan" size="sm" />
          <Knob ctx={ctx} x={208.5} y={451.7} id={L(f, 'spread')} label="Spread" size="sm" />
          <Knob ctx={ctx} x={256.4} y={450.8} id={L(f, 'amp.sustain')} label={`Layer ${f + 1} sustain`} size="sm" />
          <Knob ctx={ctx} x={369.1} y={450.8} id={L(f, 'gain')} label="Env Level" tone="light" />
          <Bracket x0={40} x1={151} top={486} mid={498.5} tip={512} width={8} />
          <Bracket x0={177.5} x1={287.5} top={486} mid={498.5} tip={512} width={11.5} />
          <Text x={96} y={508}>A</Text>
          <Text x={232.4} y={507.5}>D</Text>
          <Text x={368.6} y={507.5}>R</Text>
          <Text x={27.6} y={522}>Delay</Text>
          <Text x={164.8} y={522}>Hold</Text>
          <Knob ctx={ctx} x={27.8} y={559.1} id={L(f, 'offset')} label={`Layer ${f + 1} delay`} size="sm" />
          <Knob ctx={ctx} x={96} y={551.4} id={L(f, 'amp.attack')} label={`Layer ${f + 1} attack`} />
          <Knob ctx={ctx} x={164.6} y={559.2} id={L(f, 'amp.hold')} label={`Layer ${f + 1} hold`} size="sm" />
          <Knob ctx={ctx} x={232.6} y={552} id={L(f, 'amp.decay')} label={`Layer ${f + 1} decay`} />
          <Knob ctx={ctx} x={369.7} y={551.7} id={L(f, 'amp.release')} label={`Layer ${f + 1} release`} />
          <Line x={0} y={583.5} w={413.5} h={1} colour="var(--fp-line)" />
          <Text x={40.4} y={592} u>Gate</Text>
          <Block className="fp-plot" x={82} y={595.5} w={318} h={62} hint="The layer's level over time. Drag the handles: attack, hold, decay and sustain, release.">
            <AudioEnvelope layer={f} values={values} duration={duration} onChange={onChange} height={62} pad={1} {...gesture} />
          </Block>
        </Panel>

      ) : null}
      {modulators.filter((entry) => entry.source >= FIRST_SLOT).map(({ source, slot }) => {
        const index = source - FIRST_SLOT
        const o = 418.3 * slot
        const px = SLOT_X[slot] ?? 0
        const pw = slot === 0 ? 413.5 : 417.5
        const id = (tail: string) => `mods[${index}].${tail}`
        const envelope = read(ctx, id('kind')) !== 'lfo'
        const on = read(ctx, id('enabled')) !== false
        const shape = read(ctx, id('shape'))
        const cycles = readNum(ctx, id('rate'), 5) * duration
        const Y = (local: number) => 384 + local
        return (
          <Panel key={index} x={px} y={384} w={pw} h={288} label={`Modulator ${index + 2}`} gap={SLOT_GAP[slot]}>
            <Text x={2.5 + o} y={Y(5.5)} align="left" kind="title">Modulator {index + 2}</Text>
            {/* The one control every slot has, whatever it holds: what it is. */}
            <SlotMenu x={186 + o} y={Y(-1.5)} w={124} columns={2} label={`Modulator ${index + 2} kind`}
              value={envelope ? 'envelope' : 'lfo'}
              hint="What stands in this slot. An envelope happens once; an oscillator keeps happening."
              options={[
                { value: 'envelope', label: 'Envelope', note: 'A shape that happens once, on the sound\u2019s own clock.' },
                { value: 'lfo', label: 'Switcher LFO', note: 'A shape that keeps happening, at a rate you set.' },
              ]}
              onPick={(next) => onChange(id('kind'), next)} />
            {envelope ? (
              <>
                  <Text x={95.65 + o} y={Y(29.5)}>Shape</Text>
                  <Text x={232.45 + o} y={Y(29.5)}>Sustain</Text>
                  <Text x={370.5 + o} y={Y(29)}>Env Level</Text>
                  <Knob ctx={ctx} x={95.65 + o} y={Y(67.6)} id={id('curve')} label={`Modulator ${index + 2} shape amount`} size="sm" />
                  <Knob ctx={ctx} x={232.45 + o} y={Y(66.8)} id={id('sustain')} label={`Modulator ${index + 2} sustain`} size="sm" />
                  <Knob ctx={ctx} x={369.1 + o} y={Y(66.8)} id={id('depth')} label={`Modulator ${index + 2} level`} tone="light" dots />
                  <Text x={96 + o} y={Y(116)}>A</Text>
                  <Text x={232.4 + o} y={Y(115.5)}>D</Text>
                  <Text x={368.6 + o} y={Y(115.5)}>R</Text>
                  <Text x={27.6 + o} y={Y(126)}>Delay</Text>
                  <Text x={164.8 + o} y={Y(126)}>Hold</Text>
                  <Knob ctx={ctx} x={27.8 + o} y={Y(163.1)} id={id('delay')} label={`Modulator ${index + 2} delay`} size="sm" />
                  <Knob ctx={ctx} x={96 + o} y={Y(155.4)} id={id('attack')} label={`Modulator ${index + 2} attack`} />
                  <Knob ctx={ctx} x={164.6 + o} y={Y(163.2)} id={id('hold')} label={`Modulator ${index + 2} hold`} size="sm" />
                  <Knob ctx={ctx} x={232.6 + o} y={Y(156)} id={id('decay')} label={`Modulator ${index + 2} decay`} />
                  <Knob ctx={ctx} x={369.7 + o} y={Y(155.7)} id={id('release')} label={`Modulator ${index + 2} release`} />
                  <Line x={px} y={Y(199.5)} w={417.5} h={1} colour="var(--fp-line)" />
                  <Text x={38.4 + o} y={Y(206)} u>Moves</Text>
                  <Routes ctx={ctx} x={10 + o} y={Y(216)} w={105} id={id} name={`E${index + 2}`} />
                  <Box x={10 + o} y={Y(270)} w={62.5} selected={on} pressed={on} onClick={() => onChange(id('enabled'), !on)} label={`Modulator ${index + 2} on`} hint={on ? 'This envelope is running. Click to switch it off.' : 'This envelope is off. Click to switch it on; dropping it on a control switches it on too.'}>On</Box>
                  <Block className="fp-plot" x={124 + o} y={Y(211.5)} w={276} h={62} off={!on} hint="This envelope over time. Drag the handles to shape it.">
                    <AudioEnvelope layer={-1} prefix={`mods[${index}]`} offsetId={id('delay')} name={`envelope ${index + 2}`} values={values} duration={duration} onChange={onChange} height={62} pad={1} {...gesture} />
                  </Block>
              </>
            ) : (
              <>
                  {/* the left column: how fast, and whether at all */}
                  <Text x={36.5 + o} y={Y(104)}>Rate</Text>
                  <Knob ctx={ctx} x={36 + o} y={Y(142)} id={id('rate')} label={`Modulator ${index + 2} rate`} />
                  <Text x={36.5 + o} y={Y(178)} size={11} kind="dim">{cycles.toFixed(1)} cycles</Text>
                  <Box x={5 + o} y={Y(260)} w={62.5} selected={on} pressed={on} onClick={() => onChange(id('enabled'), !on)} label={`Modulator ${index + 2} on`} hint={on ? 'This LFO is running. Click to switch it off.' : 'This LFO is off. Click to switch it on; dropping it on a control switches it on too.'}>On</Box>
                  {/* the wheel */}
                  <Text x={193 + o} y={Y(30)}>Shape</Text>
                  <ShapeWheel x={193 + o} y={Y(152)} value={typeof shape === 'string' ? shape : 'sine'} label={`Modulator ${index + 2} shape`} onPick={(next) => onChange(id('shape'), next)} />
                  <OptionKnob ctx={ctx} x={193 + o} y={Y(152)} id={id('shape')} label={`Modulator ${index + 2} shape`} options={LFO_SHAPES} size="mid" />
                  {/* the right column: how much, and from where in the cycle */}
                  <Text x={351.5 + o} y={Y(26)}>LFO Level</Text>
                  <Knob ctx={ctx} x={351.5 + o} y={Y(64)} id={id('depth')} label={`Modulator ${index + 2} level`} tone="light" />
                  <Text x={351.5 + o} y={Y(172)}>Phase</Text>
                  <Knob ctx={ctx} x={351.5 + o} y={Y(196)} id={id('phase')} label={`Modulator ${index + 2} phase`} size="sm" />
                  <Text x={36.5 + o} y={Y(191)} u>Moves</Text>
                  <Routes ctx={ctx} x={5 + o} y={Y(203)} w={105} id={id} name={`L${index + 2}`} />
              </>
            )}
          </Panel>
        )
      })}
    </>
  )

  return (
    <div className="fp-stage" ref={stageRef} data-layout={layout} style={{ '--fp-scale': scale } as CSSProperties}>
      <div className="fp-sizer" style={{ width: box.w * scale, height: box.h * scale }}>
      <div className="fp" role="group" aria-label="Face-plate" ref={plateRef} data-layout={layout} data-assigning={assigning ? (assigning.kind === 'm' ? 'macro' : 'source') : undefined} style={{ width: box.w, height: box.h, '--assign': SOURCE_COLOUR[assigning?.kind ?? 'l'] } as CSSProperties}
        onPointerOver={hintFrom} onPointerOut={(event) => { const next = hintOf(event.relatedTarget); if (next !== hinted) setHinted(next) }}
        onPointerDown={() => setHinted(null)} onFocus={hintFrom} onBlur={() => setHinted(null)}
        onKeyDown={dropCarried}
        onContextMenu={askRouting}>
        <Hint target={hinted} />
        <Routed at={routed} mods={routed ? modsOf(ctx, routed.target) : []}
          onShow={(id) => { const slot = slotOf(id); if (slot !== null) setShown(slot); setRouted(null) }}
          onClose={() => setRouted(null)} />
        <span className="fp-ghost" ref={ghostRef} aria-hidden="true">{assigning?.id ?? ''}</span>
        {/* ═══ Macro band: sixteen on one row, wrapping only when the plate is too narrow ═══ */}
        <div className="fp-band" role="group" aria-label="Macros">
          <Origin.Provider value={{ x: 0, y: 0 }}>
            {macros.map((macro, index) => {
              const first = macro.destinations[0]
              const wired = macro.destinations.length > 0
              const mapped = macroIsMapped(macro)
              const amountParam: Num = {
                kind: 'number', id: `macro-${index + 1}`, label: macro.label || `Macro ${index + 1}`,
                group: '', min: 0, max: 1, step: 0.001, defaultValue: macro.value,
              }
              return (
                <span key={index} className="fp-macro" data-wired={wired ? '' : undefined} data-parked={macroIsParked(macro, patch) || undefined}>
                <span className="fp-macro__box">
                  <span className="fp-text fp-macro__grab" data-align="center" data-kind="digit" role="button" tabIndex={0}
                    aria-label={`Macro ${index + 1}${wired ? `, ${macro.label}, ${macro.destinations.length} destination${macro.destinations.length === 1 ? '' : 's'}` : ', free'}. Enter picks it up, Enter on a control drops it${wired ? ', Delete frees it' : ''}`}
                    data-hint={macroHint(macro, index, patch)}
                    data-held={assigning?.kind === 'm' && assigning.macro === index ? '' : undefined}
                    style={{ left: '19%', top: 19.5 - 13 * CAP }}
                    onPointerDown={pickUp({ id: `M${index + 1}`, kind: 'm', macro: index })}
                    onPointerMove={assigning?.kind === 'm' && assigning.macro === index ? follow : undefined}
                    onPointerUp={putDown} onPointerCancel={() => setAssigning(null)}
                    onKeyDown={carry(index)}
                    onDoubleClick={() => unbindMacro(index)}>
                    {index + 1}
                  </span>
                  {wired && first && !mapped
                    ? <Knob ctx={{ ...ctx, onChange: (_property, next) => commitMacros(setMacroValue(macros, index, Number(next)), true, index) }} x="63%" y={25} id={first.property} label={macro.label} size="macro" />
                    : wired && mapped
                      ? <AudioKnob param={amountParam} value={macro.value} size="macro" style={{ left: '63%', top: 25 }}
                          onChange={(next) => commitMacros(setMacroValue(macros, index, next), true, index)}
                          onGestureStart={onGestureStart} onGestureEnd={onGestureEnd} />
                      : <span className="fp-knob-empty" data-size="macro" style={{ left: '63%', top: 25 }} aria-hidden="true"><Ring /></span>}
                  {renaming === index ? (
                    <input
                      className="fp-text fp-macro__name"
                      data-align="center"
                      data-kind="macro"
                      aria-label="Macro name"
                      value={rename}
                      autoFocus
                      maxLength={40}
                      onChange={(event) => setRename(event.target.value.slice(0, 40))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          event.stopPropagation()
                          renameFinished.current = true
                          commitMacros(renameMacro(macros, index, rename))
                          setRenaming(null)
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          event.stopPropagation()
                          renameFinished.current = true
                          setRenaming(null)
                          setRename(macros[index]?.label ?? '')
                        }
                      }}
                      onBlur={() => {
                        if (!renameFinished.current) commitMacros(renameMacro(macros, index, rename))
                        setRenaming(null)
                      }}
                    />
                  ) : macro.label ? (
                    <button type="button" className="fp-text fp-macro__name" data-align="center" data-kind="macro"
                      aria-label={`Rename ${macro.label}`}
                      data-hint={macroHint(macro, index, patch)}
                      onClick={() => { renameFinished.current = false; setRenaming(index); setRename(macro.label) }}>
                      {macro.label}
                    </button>
                  ) : null}
                </span>
                </span>
              )
            })}
          </Origin.Provider>
        </div>

        {/* ═══ The body: the panels and the routing bar, in the rows the face deals, a rule between two ═══ */}
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? <span className="fp-rule" aria-hidden="true" /> : null}
            {row === 'routing' ? routingBar : (
              <div className="fp-row">
                {row.map((key) => <Fragment key={key}>{key === 'modulators' ? modulatorPanels : panels[key]}</Fragment>)}
              </div>
            )}
          </Fragment>
        ))}

        {/* ═══ The strip: the performers' twelve rows, the one they play lit, as the reference's bottom bar ═══ */}
        <div className="fp-strip" role="group" aria-label="Patterns">
          <Origin.Provider value={{ x: 0, y: 0 }}>
            <span className="fp-strip__din" style={{ flex: folded ? '0 0 40px' : '168 1 168px' }}
              data-hint="The performers' rows: twelve of them, one playing. A game can pick a different one at each trigger.">
              <Icon x={14.75} y={11.25} w={17.5} h={14.5}><DinIcon /></Icon>
              {folded ? null : <Text x={32} y={6.5} size={11} align="left" kind="dim">Performer pattern</Text>}
            </span>
          </Origin.Provider>
          {Array.from({ length: SCENE_COUNT }, (_, index) => {
            const drawn = patterns?.some((rows) => rows[index]?.some((level) => level > 0)) ?? false
            return (
              <button type="button" key={index} className="fp-slot" data-filled={drawn ? '' : undefined} data-active={scene === index || undefined} aria-pressed={scene === index}
                style={folded ? { flex: '1 1 0', marginInlineStart: 1 } : { flex: `${index === 0 ? 84 : 89.5} 1 ${index === 0 ? 84 : 89.5}px`, marginInlineStart: index === 0 ? 0 : index === 1 ? 3.5 : 1 }}
                aria-label={`Pattern ${index + 1}`} data-hint={scene === index ? `Row ${index + 1} is the one the performers play.` : drawn ? `Row ${index + 1} has something drawn on it. Click to play it.` : `Row ${index + 1} is empty. Click to play it, then draw on a performer.`} onClick={() => onChange('scene', index)}>
                {index + 1}
              </button>
            )
          })}
        </div>
      </div>
      </div>
    </div>
  )
})
