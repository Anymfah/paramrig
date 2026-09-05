import { useState } from 'react'
import { Button } from '../ui/Button'
import { NumberController } from '../ui/NumberController'

export function ScreenCapture({ image, onSave, onCancel }: { image: string; onSave: (image: string) => Promise<void>; onCancel: () => void }) {
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    <div className="web-capture-crop"><img src={image} alt="Screen capture before cropping" /><div style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${Math.min(crop.width, 100 - crop.x)}%`, height: `${Math.min(crop.height, 100 - crop.y)}%` }} /></div>
    {(['x', 'y', 'width', 'height'] as const).map(key => <NumberController key={key} param={{ kind: 'number', id: `crop-${key}`, label: key[0]!.toUpperCase() + key.slice(1), group: 'crop', min: key === 'x' || key === 'y' ? 0 : 1, max: key === 'x' || key === 'y' ? 99 : 100, step: 1, unit: '%', defaultValue: key === 'x' || key === 'y' ? 0 : 100 }} value={crop[key]} onChange={n => setCrop(c => ({ ...c, [key]: n }))} />)}
    {error ? <p role="alert">{error}</p> : null}<div className="web-actions"><Button disabled={saving} onClick={() => void save()}>Save capture</Button><Button variant="quiet" onClick={onCancel}>Discard</Button></div>
  </section>
}
