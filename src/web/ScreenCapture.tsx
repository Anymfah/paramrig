import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '../ui/Button'
import { NumberController } from '../ui/NumberController'
import { FULL, HANDLES, MIN, move, resize, type Crop, type Handle } from './crop'

export function ScreenCapture({ image, onSave, onCancel }: { image: string; onSave: (image: string) => Promise<void>; onCancel: () => void }) {
  const [crop, setCrop] = useState<Crop>(FULL)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ handle: Handle | 'move'; from: { x: number; y: number }; crop: Crop } | null>(null)

  const at = (event: { clientX: number; clientY: number }) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return { x: 0, y: 0 }
    return { x: (event.clientX - box.left) / box.width * 100, y: (event.clientY - box.top) / box.height * 100 }
  }
  const start = (handle: Handle | 'move') => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    drag.current = { handle, from: at(event), crop }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const follow = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = drag.current
    if (!gesture) return
    const point = at(event)
    setCrop(gesture.handle === 'move'
      ? move(gesture.crop, { x: point.x - gesture.from.x, y: point.y - gesture.from.y })
      : resize(gesture.crop, gesture.handle, point))
  }
  const stop = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* the browser may have released it */ }
  }
  const nudge = (event: ReactKeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1
    const delta = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }[event.key]
    if (!delta) return
    event.preventDefault()
    setCrop(current => move(current, delta))
  }

  const save = async () => {
    setSaving(true)
    try {
      const source = new Image(); source.src = image; await source.decode()
      const x = source.width * crop.x / 100; const y = source.height * crop.y / 100
      const width = Math.max(1, source.width * Math.min(crop.width, 100 - crop.x) / 100)
      const height = Math.max(1, source.height * Math.min(crop.height, 100 - crop.y) / 100)
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(source, x, y, width, height, 0, 0, width, height)
      await onSave(canvas.toDataURL('image/png'))
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }

  return <section className="web-section"><h2>Crop capture</h2>
    <div className="web-capture-crop" ref={frame} onPointerMove={follow} onPointerUp={stop} onPointerCancel={stop}>
      <img src={image} alt="Screen capture before cropping" draggable={false} />
      <div className="web-crop-box" role="group" aria-label="Crop area" tabIndex={0} onKeyDown={nudge} onPointerDown={start('move')}
        style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${Math.min(crop.width, 100 - crop.x)}%`, height: `${Math.min(crop.height, 100 - crop.y)}%` }}>
        {HANDLES.map(handle => <button key={handle.id} type="button" className="web-crop-handle" data-handle={handle.id}
          aria-label={`${handle.label} edge`} style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%` }}
          onKeyDown={nudge} onPointerDown={start(handle.id)} />)}
      </div>
    </div>
    <details className="web-disclosure"><summary>Exact crop</summary>
      {(['x', 'y', 'width', 'height'] as const).map(key => <NumberController key={key} param={{ kind: 'number', id: `crop-${key}`, label: key[0]!.toUpperCase() + key.slice(1), group: 'crop', min: key === 'x' || key === 'y' ? 0 : MIN, max: key === 'x' || key === 'y' ? 100 - MIN : 100, step: 1, unit: '%', defaultValue: key === 'x' || key === 'y' ? 0 : 100 }} value={crop[key]} onChange={n => setCrop(c => ({ ...c, [key]: n }))} />)}
    </details>
    {error ? <p role="alert">{error}</p> : null}<div className="web-actions"><Button disabled={saving} onClick={() => void save()}>Save capture</Button><Button variant="quiet" onClick={onCancel}>Discard</Button></div>
  </section>
}
