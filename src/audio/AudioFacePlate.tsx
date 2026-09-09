import { useState, type CSSProperties, type ReactNode } from 'react'
import type { ParameterDef, ParamValue } from '@/rigs/types'
import { AudioKnob } from '@/audio/AudioKnob'
import { AudioFader } from '@/audio/AudioFader'
import { AudioEnvelope } from '@/audio/AudioEnvelope'
import { AudioLfoShape } from '@/audio/AudioLfoShape'
import { ParameterField } from '@/ui/ParameterField'
import { LAYER_COLOURS } from '@/audio/profiles'
import { LAYER_COUNT } from '@/audio/fields'
import { AudioRouting } from '@/audio/AudioDrawer'

/**
 * The face-plate, measured off the reference rather than remembered from it.
 *
 * On a 2000-pixel capture the panels are 110 · 820 · 185 · 255 · 260 · 115 · 255 wide — Pitch,
 * the two oscillators sharing one panel with a phase-modulation row along its foot, Noise, Comb,
 * Filter, Amp, FX — and the row takes forty per cent of the window. Above it a row of sixteen
 * numbered macro dials; below it the routing bar and then the modulator panels, of which the amp
 * envelope is the first. Every earlier version adapted this to ParamRig's model and read as a form
 * with knobs on it. This one keeps the geometry and wires ParamRig's parameters into the slots
 * that mean the same thing.
 *
 * Two oscillators and two noise slots are the four layers, which is where the reference puts its
 * four sources too. Comb and Filter act on the layer chosen at their head, because this engine
 * filters per layer where the reference filters the sum, and a selector is more honest than
 * pretending otherwise.
 */

type Num = Extract<ParameterDef, { kind: 'number' }>

/**
 * What every control on the plate needs, handed down as one object.
 *
 * The controls were closures inside the render at first, which reads well and is wrong: a
 * component defined inside another's render is a new component type on every render, so React
 * unmounts and remounts every knob on every value change. On an instrument that means a drag
 * dies the moment it moves the value it is dragging. Hoisted, they are stable, and the render
 * passes them this instead.
 */
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

/** The shape a source makes, as the reference draws it on the face of its oscillator dial. */
function WaveGlyph({ kind, wave }: { kind: unknown; wave: unknown }) {
  const d = kind === 'noise'
    ? 'M2 10 L5 4 L8 15 L11 7 L14 13 L17 3 L20 12 L23 8 L26 16 L29 5 L32 11 L35 6 L38 10'
    : wave === 'triangle' ? 'M2 10 L11 2 L29 18 L38 10'
    : wave === 'saw' ? 'M2 10 L2 2 L20 18 L20 2 L38 18 L38 10'
    : wave === 'square' ? 'M2 10 L2 2 L20 2 L20 18 L38 18 L38 10'
    : 'M2 10 C8 -2 14 -2 20 10 S32 22 38 10'
  return (
    <svg viewBox="0 0 40 20" className="fp-waveglyph">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Knob({ ctx, id, label, size = 'md', tone, face }: { ctx: Ctx; id: string; label: string; size?: 'lg' | 'md' | 'sm' | 'xs'; tone?: 'light'; face?: ReactNode }) {
  const parameter = num(ctx, id)
  if (!parameter) return <span className="fp-knob-gap" data-size={size} />
  const current = read(ctx, id)
  return (
    <span className="fp-knob" data-tone={tone}>
      <AudioKnob
        param={{ ...parameter, label }}
        value={typeof current === 'number' ? current : parameter.min}
        size={size === 'xs' ? 'sm' : size}
        face={face}
        onChange={(next) => ctx.onChange(id, next)}
        onGestureStart={ctx.onGestureStart}
        onGestureEnd={ctx.onGestureEnd}
      />
    </span>
  )
}
function Fader({ ctx, id, badge }: { ctx: Ctx; id: string; badge?: string }) {
  const parameter = num(ctx, id)
  if (!parameter) return null
  const current = read(ctx, id)
  return (
    <span className="fp-fader">
      {badge ? <span className="fp-badge fp-badge--red">{badge}</span> : null}
      <AudioFader
        param={{ ...parameter, label: '' }}
        value={typeof current === 'number' ? current : parameter.min}
        onChange={(next) => ctx.onChange(id, next)}
        onGestureStart={ctx.onGestureStart}
        onGestureEnd={ctx.onGestureEnd}
      />
    </span>
  )
}
function Choice({ ctx, id, options, vertical }: { ctx: Ctx; id: string; options: { value: string; label: string }[]; vertical?: boolean }) {
  const current = read(ctx, id)
  return (
    <span className="fp-choice" data-vertical={vertical || undefined} role="radiogroup">
      {options.map((option) => (
        <button type="button" key={option.value} role="radio" aria-checked={current === option.value} className="fp-choice__item" onClick={() => ctx.onChange(id, option.value)}>
          {option.label}
        </button>
      ))}
    </span>
  )
}
function Toggle({ ctx, id, label }: { ctx: Ctx; id: string; label: string }) {
  const on = read(ctx, id) !== false
  return <button type="button" className="fp-toggle" aria-pressed={on} onClick={() => ctx.onChange(id, !on)}>{label}</button>
}
function Readout({ ctx, id, digits = 3, unit }: { ctx: Ctx; id: string; digits?: number; unit?: string }) {
  const current = read(ctx, id)
  return (
    <span className="fp-readout-block">
      <output className="fp-readout fp-readout--main">
        {typeof current === 'number' ? current.toFixed(digits) : '0.000'}{unit ? <small>{unit}</small> : null}
      </output>
      <output className="fp-readout">0.00</output>
      <output className="fp-readout">0.00</output>
    </span>
  )
}
function Pick({ ctx, name }: { ctx: Ctx; name: string }) {
  return (
    <span className="fp-tabs" role="tablist" aria-label={`${name} layer`}>
      {Array.from({ length: LAYER_COUNT }, (_, index) => (
        <button type="button" key={index} role="tab" aria-selected={ctx.focus === index} className="fp-tabs__tab"
          style={{ '--section': LAYER_COLOURS[index] } as CSSProperties} onClick={() => ctx.setFocus(index)}>
          {index + 1}
        </button>
      ))}
    </span>
  )
}
function Title({ children, tabs }: { children: ReactNode; tabs?: ReactNode }) {
  return <h2 className="fp-panel__title">{children}{tabs}</h2>
}

/** The sixteen macros, and which of them are wired. Unwired ones are drawn dim, as the reference draws its own. */
const MACROS: { label: string; id?: string }[] = [
  { label: 'Pos1', id: 'layers[0].pitch.start' },
  { label: 'Level1', id: 'layers[0].gain' },
  { label: 'Pos2', id: 'layers[1].pitch.start' },
  { label: 'Level2', id: 'layers[1].gain' },
  { label: 'Cutoff', id: 'layers[0].filter.cutoff' },
  { label: 'Reso', id: 'layers[0].filter.resonance' },
  { label: 'Attack', id: 'layers[0].amp.attack' },
  { label: 'Release', id: 'layers[0].amp.release' },
  { label: '' }, { label: '' }, { label: '' }, { label: '' }, { label: '' }, { label: '' }, { label: '' }, { label: '' },
]

export function AudioFacePlate({ parameters, values, duration, onChange, onGestureStart, onGestureEnd }: {
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  duration: number
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const [focus, setFocus] = useState(0)
  const ctx: Ctx = {
    byId: new Map(parameters.map((parameter) => [parameter.id, parameter])),
    values, onChange, onGestureStart, onGestureEnd, focus, setFocus,
  }
  const value = (id: string) => read(ctx, id)
  const gesture = { onGestureStart, onGestureEnd }
  const L = (index: number, tail: string) => `layers[${index}].${tail}`
  const f = focus
  const waves = [{ value: 'sine', label: 'Sin' }, { value: 'triangle', label: 'Tri' }, { value: 'saw', label: 'Saw' }, { value: 'square', label: 'SQ' }]

  return (
    <div className="fp" role="group" aria-label="Face-plate">
      {/* ═══════════ Macro row ═══════════ */}
      <div className="fp-macros" role="group" aria-label="Macros">
        <span className="fp-macros__left">
          <span className="fp-label">PB</span><span className="fp-mini-fader" aria-hidden="true" />
          <span className="fp-label">M</span><span className="fp-mini-fader" aria-hidden="true" />
          <span className="fp-label">AT</span><span className="fp-mini-dot" aria-hidden="true" />
        </span>
        {MACROS.map((macro, index) => (
          <span className="fp-macro" key={index} data-wired={macro.id ? '' : undefined}>
            <span className="fp-macro__number">{index + 1}</span>
            {macro.id ? <Knob ctx={ctx} id={macro.id} label={macro.label} size="xs" /> : <span className="fp-knob-gap fp-knob-gap--drawn" data-size="xs" />}
          </span>
        ))}
      </div>

      {/* ═══════════ Main row ═══════════ */}
      <div className="fp-main">
        {/* Pitch */}
        <section className="fp-panel fp-panel--pitch" aria-label="Pitch">
          <Title>Pitch</Title>
          <Readout ctx={ctx} id="duration" unit="s" />
          <button type="button" className="fp-toggle fp-toggle--wide" aria-pressed={false}>Glide</button>
          <span className="fp-panel__foot"><span className="fp-label">Time</span><Knob ctx={ctx} id="duration" label="" size="md" tone="light" /></span>
        </section>

        {/* Oscillators, one panel */}
        <section className="fp-panel fp-panel--osc" aria-label="Oscillators">
          <div className="fp-osc-pair">
            {[0, 1].map((index) => (
              <div className="fp-osc" key={index} data-side={index === 0 ? 'left' : 'right'} style={{ '--section': LAYER_COLOURS[index] } as CSSProperties}>
                <Title>
                  {index === 0 ? <>Sin-Tri-Saw-SQ <span className="fp-badge">1</span> Wavetable</> : <><span className="fp-badge">2</span> SQ-Sin-Saw</>}
                  <Toggle ctx={ctx} id={L(index, 'enabled')} label="On" />
                </Title>
                <div className="fp-osc__body">
                  {index === 0 ? (
                    <div className="fp-osc__side">
                      <Readout ctx={ctx} id={L(index, 'pitch.start')} digits={0} />
                      <span className="fp-label fp-label--u">ART</span>
                      <Choice ctx={ctx} id={L(index, 'source.kind')} vertical options={[{ value: 'tone', label: 'Hard' }, { value: 'noise', label: 'Neutral' }]} />
                    </div>
                  ) : null}
                  <div className="fp-osc__mid">
                    <span className="fp-osc__hero">
                      <Knob ctx={ctx} id={L(index, 'pitch.start')} label="" size="lg" face={<WaveGlyph kind={value(L(index, 'source.kind'))} wave={value(L(index, 'source.wave'))} />} />
                      <span className="fp-badge fp-badge--red fp-badge--onknob">{index === 0 ? 1 : 3}</span>
                    </span>
                    <span className="fp-row">
                      <Knob ctx={ctx} id={L(index, index === 0 ? 'source.pulseWidth' : 'source.detune')} label={index === 0 ? 'Width' : '2nd Lev'} size="md" />
                      <Knob ctx={ctx} id={L(index, index === 0 ? 'pitch.slide' : 'source.fmRatio')} label={index === 0 ? 'Pitch' : 'Ratio'} size="md" />
                    </span>
                  </div>
                  <div className="fp-osc__side fp-osc__side--fader">
                    <Fader ctx={ctx} id={L(index, 'gain')} badge={index === 0 ? '2' : '4'} />
                    <Choice ctx={ctx} id={L(index, 'source.wave')} vertical options={[{ value: 'sine', label: 'PM1' }, { value: 'triangle', label: 'Aux' }, { value: 'saw', label: 'PM2' }]} />
                  </div>
                  {index === 1 ? (
                    <div className="fp-osc__side">
                      <Readout ctx={ctx} id={L(index, 'pitch.start')} digits={0} />
                      <span className="fp-label fp-label--u">Hardsync</span>
                      <Choice ctx={ctx} id={L(index, 'source.kind')} vertical options={[{ value: 'tone', label: 'Hard' }, { value: 'noise', label: 'Neutral' }]} />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="fp-osc__foot">
            <span className="fp-readout-block fp-readout-block--inline"><output className="fp-readout fp-readout--main">1.000</output></span>
            <span className="fp-wave"><Choice ctx={ctx} id={L(0, 'source.wave')} options={waves} /></span>
            <Knob ctx={ctx} id={L(0, 'source.fmIndex')} label="PM1" size="sm" />
            <Knob ctx={ctx} id={L(0, 'source.fmFall')} label="Aux" size="sm" />
            <Knob ctx={ctx} id={L(1, 'source.fmIndex')} label="PM2" size="sm" />
            <span className="fp-wave"><Choice ctx={ctx} id={L(1, 'source.wave')} options={waves} /></span>
            <span className="fp-readout-block fp-readout-block--inline"><output className="fp-readout fp-readout--main">1.000</output></span>
          </div>
        </section>

        {/* Noise */}
        <section className="fp-panel fp-panel--noise" aria-label="Noise">
          <Title><span className="fp-badge">1</span> Noise <span className="fp-badge">2</span></Title>
          <div className="fp-noise">
            {[2, 3].map((index) => (
              <div className="fp-noise__slot" key={index} style={{ '--section': LAYER_COLOURS[index] } as CSSProperties}>
                <Fader ctx={ctx} id={L(index, 'gain')} />
                <Choice ctx={ctx} id={L(index, 'source.colour')} options={[{ value: 'white', label: 'White' }, { value: 'pink', label: 'Pink' }]} />
                <span className="fp-noise__glyph" aria-hidden="true" />
                <Knob ctx={ctx} id={L(index, 'pitch.start')} label="Pitch" size="sm" />
                <Toggle ctx={ctx} id={L(index, 'enabled')} label="On" />
              </div>
            ))}
          </div>
        </section>

        {/* Comb */}
        <section className="fp-panel fp-panel--comb" aria-label="Comb" style={{ '--section': LAYER_COLOURS[f] } as CSSProperties}>
          <Title tabs={<Pick ctx={ctx} name="Comb" />}><span className="fp-badge">F</span> Comb</Title>
          <div className="fp-comb">
            <div className="fp-comb__left">
              <span className="fp-label fp-label--u">Exciter</span>
              <span className="fp-comb__glyph" aria-hidden="true" />
            </div>
            <Readout ctx={ctx} id={L(f, 'resonator.frequency')} digits={0} />
          </div>
          <button type="button" className="fp-toggle fp-toggle--wide" aria-pressed={value(L(f, 'resonator.amount')) !== 0}>FBW</button>
          <span className="fp-center"><Knob ctx={ctx} id={L(f, 'resonator.amount')} label="FB" size="md" /></span>
          <span className="fp-row fp-row--foot">
            <Knob ctx={ctx} id={L(f, 'resonator.frequency')} label="AP Freq" size="md" />
            <Knob ctx={ctx} id={L(f, 'resonator.decay')} label="LP Freq" size="md" />
          </span>
        </section>

        {/* Filter */}
        <section className="fp-panel fp-panel--filter" aria-label="Filter" style={{ '--section': LAYER_COLOURS[f] } as CSSProperties}>
          <Title tabs={<Pick ctx={ctx} name="Filter" />}>
            <Choice ctx={ctx} id={L(f, 'filter.kind')} options={[{ value: 'lowpass', label: 'A Fold' }, { value: 'highpass', label: 'B ANM' }, { value: 'bandpass', label: 'C RM' }, { value: 'off', label: 'Off' }]} />
          </Title>
          <span className="fp-row"><Knob ctx={ctx} id={L(f, 'filter.cutoff')} label="Pitch" size="md" /><Knob ctx={ctx} id={L(f, 'filter.resonance')} label="Mix" size="md" /></span>
          <span className="fp-row"><Knob ctx={ctx} id={L(f, 'filter.envAmount')} label="FB" size="md" /><Knob ctx={ctx} id={L(f, 'shaper.drive')} label="Smear" size="md" /></span>
          <span className="fp-row fp-row--foot"><Knob ctx={ctx} id={L(f, 'shaper.bitDepth')} label="Amount" size="sm" /><span className="fp-toggle fp-toggle--static">Fast</span><Knob ctx={ctx} id={L(f, 'shaper.crush')} label="Rate" size="sm" /></span>
        </section>

        {/* Amp */}
        <section className="fp-panel fp-panel--amp" aria-label="Amp">
          <Title>Amp</Title>
          <span className="fp-stack fp-stack--spread">
            <Knob ctx={ctx} id="master.gain" label="Level" size="md" tone="light" />
            <Knob ctx={ctx} id="fx.width" label="Pan" size="md" tone="light" />
            <Knob ctx={ctx} id="master.limiter" label="FB" size="md" tone="light" />
          </span>
        </section>

        {/* FX */}
        <section className="fp-panel fp-panel--fx" aria-label="FX">
          <Title><span className="fp-badge">X</span> QCho <span className="fp-badge">Y</span> Verb <span className="fp-badge">Z</span> EQ</Title>
          <span className="fp-row"><Knob ctx={ctx} id="fx.flangerRate" label="Freq" size="sm" /><Knob ctx={ctx} id="fx.flangerMix" label="Hi Gain" size="md" /></span>
          <span className="fp-row"><Knob ctx={ctx} id="fx.delayTime" label="Freq" size="sm" /><Knob ctx={ctx} id="fx.delayMix" label="Mid Gain" size="md" /><Knob ctx={ctx} id="fx.delayFeedback" label="Q" size="sm" /></span>
          <span className="fp-row fp-row--foot"><Knob ctx={ctx} id="fx.reverbMix" label="Low Gain" size="md" /><Knob ctx={ctx} id="fx.tone" label="Tone" size="sm" /></span>
        </section>
      </div>

      {/* ═══════════ Routing bar, between the voice and what moves it ═══════════ */}
      <div className="fp-routing">
        <span className="fp-routing__mode"><span className="fp-label">Voice</span><span className="fp-label">Routing</span></span>
        <AudioRouting values={values} />
      </div>

      {/* ═══════════ Modulators: the amp envelope is the first of them ═══════════ */}
      <div className="fp-mods">
        <section className="fp-mod" aria-label="Amp envelope" style={{ '--section': LAYER_COLOURS[f] } as CSSProperties}>
          <h2 className="fp-mod__title">Modulator 1 <span className="fp-mod__name">Amp-Envelope</span><Pick ctx={ctx} name="Envelope" /></h2>
          <div className="fp-mod__knobs">
            <Knob ctx={ctx} id={L(f, 'amp.curve')} label="Shape" size="sm" />
            <Knob ctx={ctx} id={L(f, 'amp.attack')} label="A" size="md" />
            <Knob ctx={ctx} id={L(f, 'amp.hold')} label="Hold" size="sm" />
            <Knob ctx={ctx} id={L(f, 'amp.decay')} label="D" size="md" />
            <Knob ctx={ctx} id={L(f, 'amp.sustain')} label="Sustain" size="sm" />
            <Knob ctx={ctx} id={L(f, 'amp.release')} label="R" size="md" />
            <Knob ctx={ctx} id={L(f, 'gain')} label="Env Level" size="md" tone="light" />
          </div>
          <div className="fp-mod__display">
            <span className="fp-label fp-label--u">Gate</span>
            <AudioEnvelope layer={f} values={values} duration={duration} onChange={onChange} {...gesture} />
          </div>
        </section>
        {[0, 1].map((index) => {
          const id = (tail: string) => `lfos[${index}].${tail}`
          const target = ctx.byId.get(id('target'))
          return (
            <section className="fp-mod" key={index} aria-label={`LFO ${index + 1}`} data-off={value(id('enabled')) === false || undefined}>
              <h2 className="fp-mod__title">
                Modulator {index + 2} <span className="fp-mod__name">Switcher LFO</span>
                <Toggle ctx={ctx} id={id('enabled')} label="On" />
              </h2>
              <div className="fp-mod__knobs">
                <Knob ctx={ctx} id={id('rate')} label="Rate" size="md" />
                <span className="fp-mod__shape">
                  <span className="fp-label">Shape</span>
                  <Choice ctx={ctx} id={id('shape')} options={[{ value: 'sine', label: '∿' }, { value: 'triangle', label: '⋀' }, { value: 'square', label: '⊓' }, { value: 'saw', label: '⋰' }, { value: 'noise', label: '?' }]} />
                </span>
                <Knob ctx={ctx} id={id('phase')} label="Delay" size="sm" />
                <Knob ctx={ctx} id={id('depth')} label="LFO Level" size="md" tone="light" />
              </div>
              <div className="fp-mod__display">
                <span className="fp-mod__target">
                  {target ? (
                    <ParameterField param={target} value={value(id('target')) ?? target.defaultValue} onChange={(next) => onChange(id('target'), next)} {...gesture} />
                  ) : null}
                </span>
                <AudioLfoShape index={index} values={values} duration={duration} />
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
