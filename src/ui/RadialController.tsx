import { useId, useState, type PointerEvent } from 'react'
import type { Point, RadialLayer, RadialZone } from '@/rigs/extended-types'
import { NumberField } from './NumberField'
import { ColorField } from './ColorField'
import { SwitchField } from './SwitchField'
import { TextController } from './TextController'
import { Button, IconButton } from './Button'
import { Tooltip } from './Tooltip'
import { IconMinus, IconPlus, IconTrash } from './icons'
import { useControllerGesture, type GestureProps } from './controller-gesture'
import { radialFillPath, radialStrokePath } from './radial-curve'

const ALL = 'all'
const LAYER_COLORS = ['#d6b89c', '#c45c48', '#e7c070', '#8aa39c', '#797f8b', '#b8c5b2']

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function replaceLayer(layers: RadialLayer[], index: number, next: RadialLayer): RadialLayer[] {
  return layers.map((layer, i) => i === index ? next : layer)
}

function replacePoint(layer: RadialLayer, index: number, point: Point): RadialLayer {
  return { ...layer, points: layer.points.map((p, i) => i === index ? point : p) }
}

function insertPoint(layer: RadialLayer): RadialLayer {
  const points = layer.points
  let gap = 0
  let slot = 0
  for (let i = 0; i < points.length - 1; i++) {
    const width = points[i + 1]!.x - points[i]!.x
    if (width > gap) { gap = width; slot = i }
  }
  if (gap < 0.0001) return layer
  const mid = { x: (points[slot]!.x + points[slot + 1]!.x) / 2, y: (points[slot]!.y + points[slot + 1]!.y) / 2 }
  return { ...layer, points: [...points.slice(0, slot + 1), mid, ...points.slice(slot + 1)] }
}

export function RadialController({
  label,
  value,
  onChange,
  zones = [],
  maxLayers = 8,
  ...gesture
}: GestureProps & {
  label: string
  value: RadialLayer[]
  onChange: (value: RadialLayer[]) => void
  zones?: RadialZone[]
  maxLayers?: number
}) {
  const uid = useId().replace(/:/g, '')
  const [tab, setTab] = useState(ALL)
  const [selected, setSelected] = useState({ layer: 0, point: 0 })
  const drag = useControllerGesture(gesture)
  const layers = value
  const focused = clamp(tab === ALL ? selected.layer : Number(tab), 0, Math.max(0, layers.length - 1))
  const layer = layers[focused]
  const pointIndex = Math.min(selected.point, Math.max(0, (layer?.points.length ?? 1) - 1))
  const current = layer?.points[pointIndex]
  const visible = tab === ALL ? layers : layers.filter((_, i) => i === focused)

  const movePoint = (layerIndex: number, index: number, x: number, y: number) => {
    const next = layers[layerIndex]
    if (!next) return
    const left = next.points[index - 1]?.x ?? 0
    const right = next.points[index + 1]?.x ?? 1
    onChange(replaceLayer(layers, layerIndex, replacePoint(next, index, { x: clamp(x, left, right), y: clamp(y, 0, 1) })))
  }

  const fromPointer = (e: PointerEvent<HTMLElement>, layerIndex: number, index: number) => {
    const rect = e.currentTarget.parentElement!.getBoundingClientRect()
    movePoint(layerIndex, index, (e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height)
  }

  const addLayer = () => {
    const n = layers.length + 1
    onChange([...layers, {
      name: `Layer ${n}`,
      color: LAYER_COLORS[layers.length % LAYER_COLORS.length]!,
      enabled: true,
      points: [{ x: 0, y: 0.6 }, { x: 0.5, y: 0.4 }, { x: 1, y: 0 }],
    }])
    setTab(String(layers.length))
    setSelected({ layer: layers.length, point: 0 })
  }

  const pointsFull = !layer || layer.points.length >= 32
  const pointsMinimal = !layer || layer.points.length <= 2
  const addPoint = () => {
    if (!layer) return
    const next = insertPoint(layer)
    onChange(replaceLayer(layers, focused, next))
    setSelected({ layer: focused, point: Math.min(next.points.length - 1, pointIndex + 1) })
  }
  const removePoint = () => {
    if (!layer) return
    onChange(replaceLayer(layers, focused, { ...layer, points: layer.points.filter((_, i) => i !== pointIndex) }))
    setSelected({ layer: focused, point: Math.max(0, pointIndex - 1) })
  }
  const removeLayer = () => {
    onChange(layers.filter((_, i) => i !== focused))
    setTab(ALL)
    setSelected({ layer: 0, point: 0 })
  }
  return <div className="controller-stack" role="group" aria-labelledby={`${uid}-label`}>
    <div className="control__head"><span className="control__label" id={`${uid}-label`}>{label}</span>
      <div className="control__tools">
        <Tooltip content={pointsFull ? 'No more points on this layer' : `Add point to ${layer?.name ?? 'layer'}`}><IconButton label="Add point" disabled={pointsFull} onClick={addPoint}><IconPlus /></IconButton></Tooltip>
        <Tooltip content={pointsMinimal ? 'Keep at least two points' : `Remove point ${pointIndex + 1} of ${layer?.name ?? 'layer'}`}><IconButton label="Remove point" disabled={pointsMinimal} onClick={removePoint}><IconMinus /></IconButton></Tooltip>
      </div>
    </div>
    <div className="radial-controller__tabs" role="tablist" aria-label={`${label} layers`}>
      <button type="button" role="tab" aria-selected={tab === ALL} onClick={() => setTab(ALL)}>All</button>
      {layers.map((item, i) => (
        <button type="button" role="tab" key={`${item.name}-${i}`} aria-selected={tab === String(i)} onClick={() => { setTab(String(i)); setSelected({ layer: i, point: 0 }) }}>
          <span className="radial-controller__swatch" style={{ background: item.color }} aria-hidden="true" />
          {item.name}
        </button>
      ))}
      <Tooltip content={layers.length >= maxLayers ? 'No more layers' : 'Add layer'}><IconButton className="radial-controller__add" label="Add layer" disabled={layers.length >= maxLayers} onClick={addLayer}><IconPlus /></IconButton></Tooltip>
    </div>
    <div className="radial-controller__plot points-controller" role="group" aria-label={`${label} graph`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          {layers.map((item, i) => (
            <linearGradient id={`${uid}-fill-${i}`} key={i} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.42" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {zones.map((zone, i) => (
          <rect key={zone.label} x={zone.start * 100} y="0" width={(zone.end - zone.start) * 100} height="100" className="radial-controller__zone" opacity={i % 2 ? 0.55 : 1} />
        ))}
        {layers.map((item, i) => {
          const dim = tab !== ALL && i !== focused
          const mute = item.enabled === false
          return <g key={i} opacity={mute ? 0.22 : dim ? 0.35 : 1}>
            <path d={radialFillPath(item.points)} fill={`url(#${uid}-fill-${i})`} />
            <path d={radialStrokePath(item.points)} fill="none" stroke={item.color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </g>
        })}
      </svg>
      {visible.flatMap((item) => {
        const layerIndex = layers.indexOf(item)
        if (item.enabled === false && tab === ALL) return []
        return item.points.map((p, i) => (
          <button
            type="button"
            key={`${layerIndex}-${i}`}
            className="controller-point"
            style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%`, color: item.color }}
            aria-label={`${item.name} point ${i + 1}`}
            aria-description="Drag to move this point or use the arrow keys. Exact radius and value fields are below."
            aria-pressed={focused === layerIndex && pointIndex === i}
            onClick={() => { setSelected({ layer: layerIndex, point: i }); if (tab !== ALL) setTab(String(layerIndex)) }}
            onPointerDown={e => { setSelected({ layer: layerIndex, point: i }); drag.start(e) }}
            onPointerMove={e => { if (drag.active.current) fromPointer(e, layerIndex, i) }}
            {...drag.handlers}
            onKeyDown={e => {
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault()
                if (item.points.length <= 2) return
                onChange(replaceLayer(layers, layerIndex, { ...item, points: item.points.filter((_, n) => n !== i) }))
                setSelected({ layer: layerIndex, point: Math.max(0, i - 1) })
                return
              }
              if (!e.key.startsWith('Arrow')) return
              e.preventDefault()
              setSelected({ layer: layerIndex, point: i })
              const dx = e.key === 'ArrowLeft' ? -0.01 : e.key === 'ArrowRight' ? 0.01 : 0
              const dy = e.key === 'ArrowUp' ? 0.01 : e.key === 'ArrowDown' ? -0.01 : 0
              movePoint(layerIndex, i, p.x + dx, p.y + dy)
            }}
          />
        ))
      })}
    </div>
    {zones.length ? <div className="radial-controller__zones">
      {zones.map(zone => <span key={zone.label} style={{ left: `${zone.start * 100}%`, width: `${(zone.end - zone.start) * 100}%` }}><Tooltip content={`${zone.label} · ${Math.round(zone.start * 100)}–${Math.round(zone.end * 100)}%`} block><span className="radial-controller__zone-label" tabIndex={0}>{zone.label}</span></Tooltip></span>)}
    </div> : null}
    {current && layer ? <output className="visually-hidden" aria-live="polite">{layer.name}, radius {(current.x * 100).toFixed(1)} percent, value {(current.y * 100).toFixed(1)} percent</output> : null}
    {layer && tab !== ALL ? <>
      <SwitchField label="Enabled" checked={layer.enabled !== false} onChange={enabled => onChange(replaceLayer(layers, focused, { ...layer, enabled }))} />
      <TextController label="Layer name" value={layer.name} maxLength={32} onChange={name => onChange(replaceLayer(layers, focused, { ...layer, name: name.trim() || layer.name }))} />
      <ColorField label="Layer color" value={layer.color} onChange={color => onChange(replaceLayer(layers, focused, { ...layer, color }))} {...gesture} />
    </> : null}
    {current && layer ? <div className="controller-components">
        <NumberField key={`r-${focused}-${pointIndex}`} variant="field" label="Radius" value={current.x} min={layer.points[pointIndex - 1]?.x ?? 0} max={layer.points[pointIndex + 1]?.x ?? 1} step={0.01} onChange={x => onChange(replaceLayer(layers, focused, replacePoint(layer, pointIndex, { ...current, x })))} {...gesture} />
        <NumberField key={`v-${focused}-${pointIndex}`} variant="field" label="Value" value={current.y} min={0} max={1} step={0.01} onChange={y => onChange(replaceLayer(layers, focused, replacePoint(layer, pointIndex, { ...current, y })))} {...gesture} />
      </div> : null}
    {layer && tab !== ALL ? <div className="controller-actions">
      <Button size="sm" variant="quiet" icon={<IconTrash />} disabled={layers.length <= 1} onClick={removeLayer}>Remove {layer.name}</Button>
    </div> : null}
  </div>
}
