import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { Tooltip } from '@/ui/Tooltip'
import type { LabSpectrum } from './analysis'
import { markShape, type Mark, type MarkKind } from './marks'
import { projectRelief, RELIEF_GAMMA, type ReliefLayout } from './reliefLayout'

export type GripHandlers = {
  begin: () => void
  change: (control: number, value: number) => void
  end: () => void
  cancel: () => void
  hear: () => void
  step: (control: number, value: number) => void
}
export type MarkLit = Partial<Record<MarkKind, number>>
const REST_MS = 320
const TRAVEL = 200
const round2 = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100

type Held = { kind: MarkKind; control: number; pointer: number; y: number; value: number; fine: boolean; last: number; begun: boolean; target: HTMLElement }
type Edit = { kind: MarkKind; control: number; original: number; text: string }

/** Stable handles along the front edge. Only the selected handle lights its part of the relief;
 * perspective never changes sensitivity, and a click alone never edits or detaches a kept sound. */
export function ReliefGrips({ spectrum, layout, marks, handlers, drawn, onHeld, onLit }: {
  spectrum: LabSpectrum
  layout: ReliefLayout
  marks: Mark[]
  handlers: GripHandlers
  drawn: boolean
  onHeld?: (held: MarkKind | null) => void
  onLit?: (lit: MarkLit) => void
}) {
  const [heldKind, setHeldKind] = useState<MarkKind | null>(null)
  const [hover, setHover] = useState<MarkKind | null>(null)
  const [focused, setFocused] = useState<MarkKind | null>(null)
  const [editing, setEditing] = useState<Edit | null>(null)
  const holding = useRef<Held | null>(null)
  const pointerFocus = useRef(false)
  const latest = useRef({ handlers, onHeld })
  latest.current = { handlers, onHeld }
  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const heard = useRef<number | null>(null)
  const inputs = useRef<Partial<Record<MarkKind, HTMLInputElement | null>>>({})
  const handles = useRef<Partial<Record<MarkKind, HTMLDivElement | null>>>({})
  const editingRef = useRef<Edit | null>(null)
  editingRef.current = editing
  const shapes = useMemo(() => marks.map((mark) => {
    const { rows, columns, values } = spectrum
    let column = Math.round((mark.time >= 0 ? mark.time : 0.55) * (columns - 1))
    let row = Math.round(Math.max(0, mark.row) * (rows - 1))
    const at = (r: number, c: number) => values[r * columns + c] ?? 0
    if (mark.row < 0) for (let r = 0; r < rows; r++) { if (at(r, column) > at(row, column)) row = r }
    if (mark.kind === 'bite') for (let c = 0; c < columns; c++) { if (at(row, c) > at(row, column)) column = c }
    return { mark, line: markShape(mark, spectrum, layout), anchor: projectRelief(layout, column / Math.max(1, columns - 1), row / Math.max(1, rows - 1), Math.pow(at(row, column), RELIEF_GAMMA)) }
  }), [marks, spectrum, layout])
  const active = heldKind ?? editing?.kind ?? hover ?? focused
  const lit = useMemo<MarkLit>(() => Object.fromEntries(marks.map((mark) => [mark.kind,
    active === mark.kind ? heldKind ? 1 : 0.6 : 0])), [marks, active, heldKind])
  useEffect(() => { onLit?.(lit) }, [lit, onLit])
  const editingKind = editing?.kind
  useEffect(() => {
    if (editingKind) { inputs.current[editingKind]?.focus(); inputs.current[editingKind]?.select() }
  }, [editingKind]) // Keep the selection while the value is typed.
  useEffect(() => () => clearTimeout(rest.current), [])

  const release = (cancel: boolean) => {
    const current = holding.current
    if (!current) return
    holding.current = null
    clearTimeout(rest.current)
    setHeldKind(null)
    latest.current.onHeld?.(null)
    try { current.target.releasePointerCapture(current.pointer) } catch { /* The browser may already have released it. */ }
    if (current.begun) {
      if (cancel) latest.current.handlers.cancel()
      else latest.current.handlers.end()
    }
  }
  const releaseRef = useRef(release)
  releaseRef.current = release
  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !holding.current) return
      event.preventDefault(); event.stopPropagation()
      releaseRef.current(true)
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [])

  const down = (mark: Mark, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || holding.current || editing) return
    event.preventDefault()
    pointerFocus.current = true
    event.currentTarget.focus({ preventScroll: true })
    pointerFocus.current = false
    setFocused(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    heard.current = mark.value
    holding.current = { kind: mark.kind, control: mark.control, pointer: event.pointerId, y: event.clientY, value: mark.value, fine: event.shiftKey, last: mark.value, begun: false, target: event.currentTarget }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = holding.current
    if (!current || current.pointer !== event.pointerId) return
    if (!current.begun) {
      if (Math.abs(event.clientY - current.y) < 3) return
      current.begun = true
      // Preserve the picture and this DOM handle before begin() detaches a reserved sound.
      latest.current.onHeld?.(current.kind)
      setHeldKind(current.kind)
      latest.current.handlers.begin()
    }
    if (event.shiftKey !== current.fine) {
      current.value = current.last; current.y = event.clientY; current.fine = event.shiftKey
    }
    const value = round2(current.value + (current.y - event.clientY) / TRAVEL * (current.fine ? 0.25 : 1))
    if (value === current.last) return
    current.last = value
    latest.current.handlers.change(current.control, value)
    clearTimeout(rest.current)
    rest.current = setTimeout(() => {
      if (holding.current && heard.current !== value) { heard.current = value; latest.current.handlers.hear() }
    }, REST_MS)
  }
  const startEdit = (mark: Mark) => {
    release(false)
    setEditing({ kind: mark.kind, control: mark.control, original: mark.value, text: String(Math.round(mark.value * 100)) })
  }
  const finishEdit = (commit: boolean, restoreFocus: boolean) => {
    const edit = editingRef.current
    if (!edit) return
    const number = Number(edit.text.trim().replace(',', '.'))
    const valid = edit.text.trim() !== '' && Number.isFinite(number) && number >= 0 && number <= 100
    // Blank or invalid input cannot silently replace the sound's value with zero.
    if (commit && !valid && restoreFocus) return
    editingRef.current = null
    setEditing(null)
    if (commit && valid && round2(number / 100) !== edit.original) handlers.step(edit.control, round2(number / 100))
    if (restoreFocus) handles.current[edit.kind]?.focus({ preventScroll: true })
    if (!commit) setFocused(null)
  }
  const keyDown = (mark: Mark, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { setFocused(null); setHover(null); return }
    setFocused(mark.kind)
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startEdit(mark); return }
    if (holding.current) return
    const step = event.shiftKey ? 0.1 : 0.01
    const next = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? mark.value + step
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? mark.value - step
        : event.key === 'PageUp' ? mark.value + 0.1 : event.key === 'PageDown' ? mark.value - 0.1
          : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null
    if (next === null) return
    event.preventDefault()
    if (round2(next) !== mark.value) handlers.step(mark.control, round2(next))
  }

  const inset = layout.w < 560 ? 8 : 48
  const span = layout.w - inset * 2
  const gap = layout.w < 560 ? 6 : 24
  const handleWidth = (span - gap * (marks.length - 1)) / marks.length
  return <>
    <svg className="labs-marks" width={layout.w} height={layout.h} viewBox={`0 0 ${layout.w} ${layout.h}`} data-held={heldKind ?? undefined} aria-hidden="true">
      {shapes.map(({ mark, line, anchor }, i) => {
        if (active !== mark.kind || !line.points.length) return null
        const x = inset + handleWidth * (i + 0.5) + gap * i, y = layout.h - 52
        return <g key={mark.kind} className="labs-grip-link">
          {!drawn && (mark.kind === 'bite' || mark.kind === 'space') ? <polyline className="labs-grip-link__trace" points={line.points.map((p) => `${p.x},${p.y}`).join(' ')} /> : null}
          <path d={`M${x},${y} C${x},${y - 28} ${anchor.x},${anchor.y + 28} ${anchor.x},${anchor.y}`} />
          <circle cx={anchor.x} cy={anchor.y} r={5} />
          <circle className="labs-grip-link__core" cx={anchor.x} cy={anchor.y} r={1.8} />
        </g>
      })}
    </svg>
    <div className="labs-grips" role="group" aria-label="Wave controls" style={{ insetInline: inset, gap, gridTemplateColumns: `repeat(${marks.length}, minmax(0, 1fr))` }}>
      {marks.map((mark) => {
        const edit = editing?.kind === mark.kind ? editing : null
        const invalid = !!edit && (edit.text.trim() === '' || !Number.isFinite(Number(edit.text.replace(',', '.'))) || Number(edit.text.replace(',', '.')) < 0 || Number(edit.text.replace(',', '.')) > 100)
        return <div key={mark.kind} className="labs-grip-slot" data-active={active === mark.kind || undefined} data-held={heldKind === mark.kind || undefined}
          onPointerEnter={() => setHover(mark.kind)} onPointerLeave={() => setHover(null)}>
          <Tooltip content="Drag up or down · Shift for fine adjustment · Double-click or Enter to type" disabled={!!heldKind || !!editing}>
            <div ref={(node) => { handles.current[mark.kind] = node }} className="labs-grip" role="slider" tabIndex={edit ? -1 : 0} aria-label={mark.label}
              aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mark.value * 100)} aria-valuetext={`${Math.round(mark.value * 100)} percent`}
              style={{ '--grip-value': `${mark.value * 100}%` } as CSSProperties}
              onPointerDown={(event) => down(mark, event)} onPointerMove={move}
              onPointerUp={(event) => { if (event.pointerId === holding.current?.pointer) release(false) }}
              onPointerCancel={() => release(true)} onLostPointerCapture={() => release(true)}
              onDoubleClick={() => startEdit(mark)} onKeyDown={(event) => keyDown(mark, event)}
              onFocus={() => { if (!pointerFocus.current) setFocused(mark.kind) }} onBlur={() => setFocused((was) => was === mark.kind ? null : was)}>
              <span className="labs-grip__name">{mark.label}</span>
              <span className="labs-grip__value">{Math.round(mark.value * 100)}<small>%</small></span>
              <ChevronsUpDown aria-hidden="true" />
            </div>
          </Tooltip>
          {edit ? <label className="labs-grip-edit" data-invalid={invalid || undefined}>
            <span>{mark.label}</span>
            <input ref={(node) => { inputs.current[mark.kind] = node }} aria-label={`${mark.label} percent`} aria-invalid={invalid || undefined}
              inputMode="decimal" value={edit.text} onChange={(event) => setEditing({ ...edit, text: event.target.value })}
              onBlur={() => finishEdit(true, false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finishEdit(event.key === 'Enter', true) }
              }} />
            <span>%</span>
            {invalid ? <span className="labs-grip-edit__error" role="status">Enter 0–100</span> : null}
          </label> : null}
        </div>
      })}
    </div>
  </>
}
