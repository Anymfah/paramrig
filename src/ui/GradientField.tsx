import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { GradientStop } from '@/rigs/types'
import { ColorField } from '@/ui/ColorField'
import { NumberField } from '@/ui/NumberField'
import { IconButton } from '@/ui/Button'
import { IconPlus, IconMinus, IconFlipH, IconDistributeH } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import {
  DROP_STOP_PX,
  insertGradientStop,
  MAX_GRADIENT_STOPS,
  nearestStopIndex,
  removeGradientStop,
} from '@/ui/gradient-ops'

type GradientFieldProps = {
  label: string
  value: GradientStop[]
  onChange: (value: GradientStop[]) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onGestureCancel?: () => void
}

type DragState = {
  index: number
  stops: GradientStop[]
  left: number
  width: number
  top: number
  height: number
  pointerId: number
  dropping: boolean
}

export function GradientField({ label, value, onChange, onGestureStart, onGestureEnd, onGestureCancel }: GradientFieldProps) {
  const [selected, setSelected] = useState(0)
  const [droppingIndex, setDroppingIndex] = useState<number | null>(null)
  const [openPicker, setOpenPicker] = useState(0)
  const index = Math.min(selected, value.length - 1)
  const current = value[index]
  const bar = useRef<HTMLDivElement>(null)
  const pendingClick = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef<DragState | null>(null)
  const callbacks = useRef({ onChange, onGestureEnd, onGestureCancel, value })
  useEffect(() => { callbacks.current = { onChange, onGestureEnd, onGestureCancel, value } }, [onChange, onGestureEnd, onGestureCancel, value])
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragging.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const min = drag.index ? drag.stops[drag.index - 1]!.t + 0.01 : 0
      const max = drag.index < drag.stops.length - 1 ? drag.stops[drag.index + 1]!.t - 0.01 : 1
      const t = Math.min(max, Math.max(min, Math.round((event.clientX - drag.left) / drag.width * 100) / 100))
      const midY = drag.top + drag.height / 2
      drag.dropping = drag.stops.length > 2 && Math.abs(event.clientY - midY) > DROP_STOP_PX
      setDroppingIndex(drag.dropping ? drag.index : null)
      callbacks.current.onChange(drag.stops.map((stop, i) => i === drag.index ? { ...stop, t } : stop))
    }
    const end = (event: PointerEvent) => {
      if (!dragging.current || event.pointerId !== dragging.current.pointerId) return
      const drag = dragging.current
      dragging.current = null
      setDroppingIndex(null)
      if (drag.dropping) {
        callbacks.current.onChange(removeGradientStop(callbacks.current.value, drag.index))
        setSelected(Math.max(0, drag.index - 1))
      }
      callbacks.current.onGestureEnd?.()
    }
    const cancel = () => {
      if (!dragging.current) return
      dragging.current = null
      setDroppingIndex(null)
      callbacks.current.onGestureCancel?.()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', escape)
      cancel()
    }
  }, [])
  if (!current) return null
  const minimum = index > 0 ? Math.round(value[index-1]!.t * 100) + 1 : 0
  const maximum = index < value.length-1 ? Math.round(value[index+1]!.t * 100) - 1 : 100
  const position = (at: number) => onChange(value.map((stop,i) => i === index ? { ...stop, t: Math.min(maximum, Math.max(minimum, at))/100 } : stop))
  const css = `linear-gradient(90deg, ${value.map(stop => `${stop.color} ${stop.t * 100}%`).join(', ')})`
  const add = (at?: number) => {
    const next = at === undefined
      ? (() => {
          let gap = 0
          for (let i = 1; i < value.length - 1; i++) if (value[i+1]!.t-value[i]!.t > value[gap+1]!.t-value[gap]!.t) gap = i
          return insertGradientStop(value, (value[gap]!.t + value[gap+1]!.t)/2)
        })()
      : insertGradientStop(value, at)
    if (!next) {
      if (at !== undefined) setSelected(nearestStopIndex(value, at))
      return
    }
    onGestureStart?.()
    onChange(next)
    onGestureEnd?.()
    const added = next.findIndex((stop) => !value.some((old) => old.t === stop.t && old.color === stop.color))
    setSelected(added >= 0 ? added : nearestStopIndex(next, at ?? 0.5))
  }
  return (
    <div className="control control--gradient">
      <div className="control__head"><span className="control__label">{label}</span>
        <div className="control__tools">
          <Tooltip content="Reverse the stops"><IconButton label={`Reverse ${label}`} onClick={() => { onGestureStart?.(); onChange([...value].map((stop) => ({ ...stop, t: Math.round((1 - stop.t) * 100) / 100 })).reverse()); onGestureEnd?.(); setSelected(value.length - 1 - index) }}><IconFlipH /></IconButton></Tooltip>
          <Tooltip content={value.length < 3 ? 'Two stops already sit at the ends' : 'Space the stops evenly'}><IconButton label={`Distribute ${label} stops`} disabled={value.length < 3} onClick={() => { onGestureStart?.(); onChange(value.map((stop, i) => ({ ...stop, t: Math.round(i / (value.length - 1) * 100) / 100 }))); onGestureEnd?.() }}><IconDistributeH /></IconButton></Tooltip>
          <Tooltip content="Add color stop"><IconButton label={`Add ${label} stop`} disabled={value.length >= MAX_GRADIENT_STOPS} onClick={() => add()}><IconPlus /></IconButton></Tooltip>
          <Tooltip content={value.length <= 2 ? 'Keep at least two color stops' : 'Remove selected color stop'}><IconButton label={`Remove ${label} stop`} disabled={value.length <= 2} onClick={() => { onChange(removeGradientStop(value, index)); setSelected(Math.max(0,index-1)) }}><IconMinus /></IconButton></Tooltip>
        </div>
      </div>
      <div
        className="gradient-bar"
        ref={bar}
        role="group"
        aria-label={`${label} color stops`}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('.gradient-handle')) return
          pendingClick.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={(event) => {
          const pending = pendingClick.current
          pendingClick.current = null
          if (!pending || !bar.current) return
          if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 4) return
          const rect = bar.current.getBoundingClientRect()
          if (!rect.width) return
          add(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)))
        }}
      >
        <span className="gradient-bar__ramp" style={{ background: css }} aria-hidden="true" />
        {value.map((stop,i) => (
          <button key={i} type="button" className="gradient-handle" style={{ left: `${stop.t * 100}%`, '--stop-color': stop.color } as CSSProperties}
            aria-label={`Select stop ${i+1} at ${Math.round(stop.t*100)} percent`} aria-description="Drag horizontally to move this stop. Drag away from the ramp to remove it, double-click to pick its color, or use the arrow keys for precise changes." aria-pressed={index===i}
            data-dropping={droppingIndex === i ? '' : undefined}
            onClick={() => setSelected(i)}
            onDoubleClick={() => { setSelected(i); setOpenPicker((n) => n + 1) }}
            onPointerDown={event => {
              if (event.button !== 0 || !bar.current) return
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.focus()
              const rect = bar.current.getBoundingClientRect()
              if (!rect.width) return
              setSelected(i)
              pendingClick.current = null
              event.currentTarget.setPointerCapture(event.pointerId)
              dragging.current = { index: i, stops: value, left: rect.left, width: rect.width, top: rect.top, height: rect.height, pointerId: event.pointerId, dropping: false }
              onGestureStart?.()
            }}
            onKeyDown={event => {
              if (event.key==='ArrowLeft' || event.key==='ArrowRight') { event.preventDefault(); setSelected(i); const min=i ? value[i-1]!.t+0.01 : 0; const max=i<value.length-1 ? value[i+1]!.t-0.01 : 1; onChange(value.map((item,n)=> n===i ? {...item,t:Math.min(max,Math.max(min,item.t+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?0.1:0.01)))} : item)) }
            }} />
        ))}
      </div>
      <div className="gradient-stop-editor">
        <ColorField label={`Stop ${index+1}`} value={current.color} openSignal={openPicker} onChange={color=>onChange(value.map((stop,i)=>i===index?{...stop,color}:stop))} onGestureStart={onGestureStart} onGestureEnd={onGestureEnd} onGestureCancel={onGestureCancel} />
        <NumberField variant="field" label="Position" value={Math.round(current.t*100)} min={minimum} max={maximum} step={1} unit="%" onChange={position} onGestureStart={onGestureStart} onGestureEnd={onGestureEnd} onGestureCancel={onGestureCancel} />
      </div>
    </div>
  )
}
