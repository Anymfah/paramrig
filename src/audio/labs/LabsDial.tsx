import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { LAB_MASSES, type LabMass } from './selections'

const START = 135, SWEEP = 270
const polar = (angle: number, radius: number) => {
  const a = angle * Math.PI / 180
  return [32 + radius * Math.cos(a), 32 + radius * Math.sin(a)] as const
}
function arc(from: number, to: number, radius: number): string {
  const [x0, y0] = polar(from, radius), [x1, y1] = polar(to, radius)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * A setting of the next sound that can also be left to the generator. Auto is a real state, not a
 * position: the ring stays open and says so, and turning it from there starts in the middle.
 * Vertical drag turns it, the arrows step it, Delete or a double-click gives it back to Auto.
 */
export function LabsDial({ label, value, onChange, onBegin, disabled = false }: {
  label: string
  value: number | null
  onChange: (next: number | null, record?: boolean) => void
  /** A drag is one undo step: called once when it starts. */
  onBegin: () => void
  disabled?: boolean
}) {
  const id = useId()
  const ticks = Array.from({ length: 28 }, (_, index) => {
    const angle = START + index * SWEEP / 27
    const [x0, y0] = polar(angle, index % 3 === 0 ? 28.7 : 30)
    const [x1, y1] = polar(angle, 31.5)
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`
  }).join('')
  const drag = useRef<{ pointer: number; y: number; from: number } | null>(null)
  const percent = value === null ? null : Math.round(value * 100)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, y: event.clientY, from: value ?? 0.5 }
    onBegin()
    if (value === null) onChange(0.5, false)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current
    if (!held || held.pointer !== event.pointerId) return
    // Two hundred pixels for the whole range, a fifth of that with Shift for the last percent.
    const next = Math.round(clamp01(held.from + (held.y - event.clientY) / (event.shiftKey ? 1000 : 200)) * 100) / 100
    if (next !== value) onChange(next, false)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return
    drag.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* Already released. */ }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const base = value ?? 0.5
    let next: number | null | undefined
    if (event.key === 'Delete' || event.key === 'Backspace') next = null
    else if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = value === null ? 0.5 : base + (event.shiftKey ? 0.1 : 0.01)
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = value === null ? 0.5 : base - (event.shiftKey ? 0.1 : 0.01)
    else if (event.key === 'PageUp') next = base + 0.1
    else if (event.key === 'PageDown') next = base - 0.1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 1
    if (next === undefined) return
    event.preventDefault()
    const rounded = next === null ? null : Math.round(clamp01(next) * 100) / 100
    if (rounded !== value) onChange(rounded)
  }
  const tip = percent === null ? START : START + SWEEP * (value ?? 0)
  return (
    <div className="labs-dial" data-auto={value === null || undefined} data-disabled={disabled || undefined}>
      <span className="labs-dial__label" id={`${id}-label`}>{label}</span>
      <div className="labs-dial__ring" role="slider" tabIndex={disabled ? -1 : 0} aria-labelledby={`${id}-label`} aria-disabled={disabled || undefined}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? 'Auto' : `${percent} percent`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={() => { if (!disabled && value !== null) onChange(null) }} onKeyDown={onKeyDown}>
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <defs>
            <radialGradient id={`${id}-glass`} cx="32%" cy="20%" r="85%">
              <stop stopColor="var(--labs-dial-light)" /><stop offset=".48" stopColor="var(--labs-tile)" /><stop offset="1" stopColor="var(--labs-bg)" />
            </radialGradient>
            <linearGradient id={`${id}-bevel`} x1="0" y1="0" x2=".65" y2="1"><stop stopColor="var(--labs-metal-light)" /><stop offset=".45" stopColor="var(--labs-tile)" /><stop offset=".8" stopColor="var(--labs-bg)" /><stop offset="1" stopColor="var(--labs-metal-mid)" /></linearGradient>
            <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--labs-hot)" /><stop offset=".45" stopColor="var(--labs-glow)" /><stop offset="1" stopColor="var(--labs-glow-line)" /></linearGradient>
          </defs>
          <circle className="labs-dial__bezel" cx="32" cy="32" r="31" />
          <path className="labs-dial__ticks" d={ticks} />
          <circle className="labs-dial__rim" cx="32" cy="32" r="23" style={{ stroke: `url(#${id}-bevel)` }} />
          <circle className="labs-dial__face" cx="32" cy="32" r="21" style={{ fill: `url(#${id}-glass)` }} />
          <path className="labs-dial__reflection" d={arc(200, 300, 19)} />
          <path className="labs-dial__track" d={arc(START, START + SWEEP, 26)} />
          {percent !== null && percent > 0 ? <path className="labs-dial__arc" d={arc(START, tip, 26)} style={{ stroke: `url(#${id}-light)` }} /> : null}
          {percent !== null ? <circle className="labs-dial__tip" cx={polar(tip, 26)[0]} cy={polar(tip, 26)[1]} r="3.2" /> : null}
        </svg>
        <span className="labs-dial__value">{percent === null ? 'Auto' : <>{percent}<small>%</small></>}</span>
      </div>
    </div>
  )
}

const MASS_LABELS: Record<LabMass, string> = { light: 'Light', balanced: 'Balanced', heavy: 'Heavy' }
const MASS_ANGLE: Record<LabMass, number> = { light: -60, balanced: 0, heavy: 60 }
/**
 * Mass in three positions: a small dial that points at the one chosen, over the three words. The
 * words are the radios; the dial turns to the next position when it is pressed.
 */
export function MassSelect({ value, onChange }: { value: LabMass; onChange: (next: LabMass) => void }) {
  const id = useId()
  const next = LAB_MASSES[(LAB_MASSES.indexOf(value) + 1) % LAB_MASSES.length]!
  return (
    <div className="labs-mass">
      <span className="labs-dial__label" id={`${id}-label`}>Mass</span>
      <button type="button" className="labs-mass__dial" tabIndex={-1} aria-hidden="true" onClick={() => onChange(next)}>
        <svg viewBox="0 0 32 32">
          <defs><radialGradient id={`${id}-cap`} cx="30%" cy="15%" r="90%"><stop stopColor="var(--labs-dial-light)" /><stop offset=".65" stopColor="var(--labs-tile)" /><stop offset="1" stopColor="var(--labs-bg)" /></radialGradient></defs>
          <circle className="labs-mass__face" cx="16" cy="16" r="9" fill={`url(#${id}-cap)`} />
          <path className="labs-dial__reflection" d="M8.8 14a7.5 7.5 0 0 1 9.5-5.1" />
          <path className="labs-dial__track" d="M7.5 22.5A12 12 0 1 1 24.5 22.5" />
          {LAB_MASSES.map((mass) => <path key={mass} className="labs-mass__tick" data-on={mass === value || undefined} d="M16 2.6V5.2" style={{ transform: `rotate(${MASS_ANGLE[mass]}deg)` }} />)}
          <g style={{ transform: `rotate(${MASS_ANGLE[value]}deg)` }} className="labs-mass__needle"><path d="M16 16V8" /><circle cx="16" cy="16" r="2.4" /></g>
        </svg>
      </button>
      <div className="labs-mass__options" role="radiogroup" aria-labelledby={`${id}-label`}>
        {LAB_MASSES.map((mass) => (
          <label key={mass} className="labs-mass__opt" data-checked={mass === value || undefined}>
            <input type="radio" name={`${id}-mass`} value={mass} checked={mass === value} onChange={() => onChange(mass)} />
            <span>{MASS_LABELS[mass]}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
