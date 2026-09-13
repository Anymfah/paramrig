import { useEffect, useId, useState, type CSSProperties } from 'react'
import { DURATION_MIN, DURATION_MAX } from './model'

/**
 * The length the next sound may have, as an interval: two handles on one track, and the two
 * numbers beside them for anyone who knows the figure. Equal endpoints ask for an exact length.
 * The label sits on the same line, as the mockup draws it, so the row stays one row.
 */
export function DurationRange({ min, max, onChange, disabled = false }: { min: number; max: number; onChange: (min: number, max: number) => void; disabled?: boolean }) {
  const id = useId()
  const [low, setLow] = useState(String(min))
  const [high, setHigh] = useState(String(max))
  useEffect(() => { setLow(String(min)); setHigh(String(max)) }, [min, max])
  const commit = (which: 'min' | 'max') => {
    const draft = which === 'min' ? low : high
    const parsed = Number(draft)
    if (!draft.trim() || !Number.isFinite(parsed)) { setLow(String(min)); setHigh(String(max)); return }
    const value = Math.round(Math.max(DURATION_MIN, Math.min(DURATION_MAX, parsed)))
    if (which === 'min') { const next = Math.min(value, max); setLow(String(next)); if (next !== min) onChange(next, max) }
    else { const next = Math.max(value, min); setHigh(String(next)); if (next !== max) onChange(min, next) }
  }
  // Log across the track: the difference between 120 and 240 ms matters as much as 2 and 4 s.
  const percent = (value: number) => Math.log(value / DURATION_MIN) / Math.log(DURATION_MAX / DURATION_MIN) * 100
  const fromPercent = (value: number) => Math.round(DURATION_MIN * Math.pow(DURATION_MAX / DURATION_MIN, value / 1000))
  return (
    <div className="labs-duration" role="group" aria-labelledby={`${id}-label`} aria-disabled={disabled || undefined}>
      <span className="labs-field__title" id={`${id}-label`}>Duration</span>
      <label className="labs-duration__value"><span>Min</span><input aria-label="Minimum duration in milliseconds" inputMode="numeric" disabled={disabled} value={low} onChange={(e) => setLow(e.target.value)} onBlur={() => commit('min')} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setLow(String(min)); e.stopPropagation() } }} /><span>ms</span></label>
      <div className="labs-duration__track" style={{ '--low': `${percent(min)}%`, '--high': `${percent(max)}%` } as CSSProperties}>
        <input type="range" aria-label="Minimum duration" disabled={disabled} aria-valuemin={DURATION_MIN} aria-valuemax={max} aria-valuenow={min} aria-valuetext={`${min} milliseconds`} min={0} max={1000} step={1} value={Math.round(percent(min) * 10)} onChange={(e) => onChange(Math.min(fromPercent(Number(e.target.value)), max), max)} />
        <input type="range" aria-label="Maximum duration" disabled={disabled} aria-valuemin={min} aria-valuemax={DURATION_MAX} aria-valuenow={max} aria-valuetext={`${max} milliseconds`} min={0} max={1000} step={1} value={Math.round(percent(max) * 10)} onChange={(e) => onChange(min, Math.max(min, fromPercent(Number(e.target.value))))} />
      </div>
      <label className="labs-duration__value"><span>Max</span><input aria-label="Maximum duration in milliseconds" inputMode="numeric" disabled={disabled} value={high} onChange={(e) => setHigh(e.target.value)} onBlur={() => commit('max')} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setHigh(String(max)); e.stopPropagation() } }} /><span>ms</span></label>
    </div>
  )
}
