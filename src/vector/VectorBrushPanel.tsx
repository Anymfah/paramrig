import { Button, IconButton } from '@/ui/Button'
import { IconMinus } from '@/ui/icons'
import { SelectField } from '@/ui/SelectField'
import { BarField } from '@/ui/BarField'
import { Tooltip } from '@/ui/Tooltip'
import { brushesOf, DEFAULT_BRUSH_SETTINGS, findBrush, stampPath } from '@/vector/brushes'
import type { VectorBrush, VectorBrushSettings, VectorElement } from '@/vector/types'

type Gesture = { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }

/** Which brush a stroke is stamped with, how densely, how scattered and how tapered. */
export function BrushPanel({ element, brushes, onChange, onDefine, canDefine, gesture }: {
  element: VectorElement
  brushes: VectorBrush[]
  onChange: (brush: VectorBrushSettings | undefined, record?: boolean) => void
  onDefine: () => void
  canDefine: boolean
  gesture: Gesture
}) {
  const available = brushesOf({ brushes })
  const settings = element.brush
  const pick = (id: string) => {
    if (!id) {
      onChange(undefined)
      return
    }
    const brush = findBrush({ brushes }, id)
    if (!brush) return
    // The shape rides along with the settings, so the object still draws itself elsewhere.
    const custom = brushes.some((item) => item.id === id)
    onChange({ ...(settings ?? DEFAULT_BRUSH_SETTINGS), id, ...(custom ? { network: brush.network } : { network: undefined }) })
  }
  const current = findBrush({ brushes }, settings?.id)
  return (
    <div className="vector-fold__panel" aria-label="Brush">
      <div className="vector-panel__row">
        <span className="vector-row__label">Brush</span>
        {settings ? (
          <Tooltip content="Back to a plain stroke">
            <IconButton label="Remove the brush" data-action="clear-brush" onClick={() => onChange(undefined)}><IconMinus /></IconButton>
          </Tooltip>
        ) : null}
      </div>
      <SelectField
        label="Shape"
        value={settings?.id ?? ''}
        options={[{ value: '', label: 'None' }, ...available.map((brush) => ({ value: brush.id, label: brush.name }))]}
        onChange={pick}
      />
      {current ? <BrushPreview brush={current} settings={settings ?? DEFAULT_BRUSH_SETTINGS} /> : null}
      {settings ? (
        <>
          <BarField label="Spacing" value={Math.round(settings.spacing * 100)} min={5} max={400} step={5} unit="%" onChange={(value) => onChange({ ...settings, spacing: value / 100 }, false)} {...gesture} />
          <BarField label="Jitter" value={Math.round(settings.jitter * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => onChange({ ...settings, jitter: value / 100 }, false)} {...gesture} />
          <BarField label="Taper" value={Math.round(settings.taper * 200)} min={0} max={100} step={1} unit="%" onChange={(value) => onChange({ ...settings, taper: value / 200 }, false)} {...gesture} />
        </>
      ) : null}
      <div className="vector-brush__actions">
        <Tooltip content={canDefine ? 'Turn the selected shape into a brush' : 'Select a single path to make a brush from it'}>
          <span>
            <Button variant="quiet" size="sm" data-action="define-brush" disabled={!canDefine} onClick={onDefine}>Define brush from selection</Button>
          </span>
        </Tooltip>
      </div>
    </div>
  )
}

/** A stroke drawn with the brush as it stands, so the settings can be read at a glance. */
function BrushPreview({ brush, settings }: { brush: VectorBrush; settings: VectorBrushSettings }) {
  const width = 12
  const stamps: string[] = []
  const count = Math.max(2, Math.round(1 / Math.max(0.05, settings.spacing)) * 4)
  for (let index = 0; index <= count; index += 1) {
    const t = index / count
    const taper = settings.taper > 0 ? Math.min(1, Math.min(t, 1 - t) / Math.min(0.5, settings.taper)) : 1
    const size = width * taper
    if (size <= 0.2) continue
    const wobble = settings.jitter * width * 0.5 * (Math.sin(index * 12.9898) * 43758.5453 % 1 - 0.5) * 2
    stamps.push(stampPath(brush.network, { x: 10 + t * 180, y: 16 + wobble }, size, 0))
  }
  return (
    <svg className="vector-brush__preview" viewBox="0 0 200 32" role="img" aria-label={`${brush.name} preview`}>
      <path d={stamps.join(' ')} fillRule="evenodd" />
    </svg>
  )
}
