import { useRef, useState, type ReactNode } from 'react'
import { Button, IconButton } from '@/ui/Button'
import { ColorField } from '@/ui/ColorField'
import { GradientField } from '@/ui/GradientField'
import { IconEye, IconEyeOff, IconMinus, IconPlus } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SliderField } from '@/ui/SliderField'
import { StatusMessage } from '@/ui/StatusMessage'
import { Tooltip } from '@/ui/Tooltip'
import { dataUrlBytes, readImageFile } from '@/vector/images'
import { defaultStops, MAX_IMAGE_BYTES, MAX_PAINTS, solidPaint } from '@/vector/paints'
import { defaultMesh } from '@/vector/mesh'
import type { VectorPaint } from '@/vector/types'

type Gesture = { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }

/** Document-wide colour aids offered inside every picker. */
export type PaintPalette = {
  recent?: string[]
  swatches?: string[]
  onAddSwatch?: (hex: string) => void
  onRemoveSwatch?: (hex: string) => void
  /** Starts a pick on the canvas; the colour comes back through the callback. */
  onPickFromCanvas?: (apply: (hex: string) => void) => void
  onColorUsed?: (hex: string) => void
}

type PaintListProps = {
  label: 'Fill' | 'Stroke'
  paints: VectorPaint[]
  mixed?: boolean
  onChange: (paints: VectorPaint[], record?: boolean) => void
  gesture: Gesture
  palette?: PaintPalette
  /** Extra controls shown next to the layer title, used for style links. */
  header?: ReactNode
  selectedMeshPoint?: number | null
}

/** Stacked paint layers for a fill or stroke, bottom first in the model, top first on screen. */
export function PaintList({ label, paints, mixed = false, onChange, gesture, palette, header, selectedMeshPoint }: PaintListProps) {
  const update = (index: number, patch: Partial<VectorPaint>, record?: boolean) => {
    onChange(paints.map((paint, position) => position === index ? { ...paint, ...patch } : paint), record)
  }
  const add = () => {
    if (paints.length >= MAX_PAINTS) return
    const last = paints[paints.length - 1]
    const color = last?.type === 'solid' && last.color ? last.color : label === 'Fill' ? '#D4E7E1' : '#8CBDA8'
    onChange([...paints, solidPaint(color)])
  }
  const remove = (index: number) => onChange(paints.filter((_, position) => position !== index))
  const ordered = paints.map((paint, index) => ({ paint, index })).reverse()
  return (
    <div className="vector-paints" data-mixed={mixed || undefined}>
      <div className="vector-panel__row">
        <span className="vector-panel__subtitle">{label}{paints.length > 1 ? ` · ${paints.length} layers` : ''}</span>
        <Tooltip content={`Add ${label.toLowerCase()} layer`}>
          <IconButton label={`Add ${label.toLowerCase()} layer`} disabled={paints.length >= MAX_PAINTS} onClick={add}><IconPlus /></IconButton>
        </Tooltip>
      </div>
      {header}
      {mixed ? <p className="vector-panel__hint">Mixed {label.toLowerCase()}s. Editing replaces them on every selected object.</p> : null}
      {paints.length === 0 ? <p className="vector-panel__hint">No {label.toLowerCase()}.</p> : null}
      {ordered.map(({ paint, index }) => (
        <PaintRow
          key={paint.id}
          label={label}
          paint={paint}
          removable
          onChange={(patch, record) => update(index, patch, record)}
          onRemove={() => remove(index)}
          gesture={gesture}
          palette={palette}
          selectedMeshPoint={selectedMeshPoint}
        />
      ))}
    </div>
  )
}

/** One knot repainted, the rest of the mesh untouched. */
function withKnot(mesh: NonNullable<VectorPaint['mesh']>, index: number, color: string) {
  return { ...mesh, points: mesh.points.map((point, position) => position === index ? { ...point, color } : point) }
}

function PaintRow({ label, paint, removable, onChange, onRemove, gesture, palette, selectedMeshPoint }: {
  label: string
  paint: VectorPaint
  removable: boolean
  onChange: (patch: Partial<VectorPaint>, record?: boolean) => void
  onRemove: () => void
  gesture: Gesture
  palette?: PaintPalette
  /** Which mesh knot the canvas has selected, so its colour can be edited here. */
  selectedMeshPoint?: number | null
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const typeLabel = paint.type === 'solid' ? 'Solid' : paint.type === 'linear' ? 'Linear' : paint.type === 'radial' ? 'Radial' : paint.type === 'pattern' ? 'Pattern' : paint.type === 'mesh' ? 'Mesh' : 'Image'
  const changeType = (type: VectorPaint['type']) => {
    if (type === paint.type) return
    const base = paint.type === 'solid' && paint.color ? paint.color : paint.stops?.[0]?.color ?? '#D4E7E1'
    if (type === 'solid') onChange({ type, color: base, stops: undefined, image: undefined, angle: undefined, mesh: undefined })
    else if (type === 'mesh') onChange({ type, mesh: paint.mesh ?? defaultMesh(), color: undefined, stops: undefined, image: undefined })
    else if (type === 'image') {
      onChange({ type, imageMode: paint.imageMode ?? 'fill', color: undefined, stops: undefined })
      requestAnimationFrame(() => fileInput.current?.click())
    } else onChange({ type, stops: paint.stops ?? defaultStops(base), angle: paint.angle ?? 0, color: undefined, image: undefined })
  }
  const pickImage = (file: File | undefined) => {
    if (!file) return
    setImageError(null)
    void readImageFile(file).then((image) => {
      if (!image) {
        setImageError('That image could not be read.')
        return
      }
      if (dataUrlBytes(image) > MAX_IMAGE_BYTES) {
        setImageError('That image is too large to store, even compressed. Use a smaller one.')
        return
      }
      onChange({ image })
    })
  }
  return (
    <div className="vector-paint" data-hidden={!paint.visible || undefined}>
      <div className="vector-paint__head">
        <span className="vector-panel__subtitle">{typeLabel} {label.toLowerCase()}</span>
        <div className="vector-paint__tools">
          <Tooltip content={paint.visible ? `Hide ${typeLabel.toLowerCase()} layer` : `Show ${typeLabel.toLowerCase()} layer`}>
            <IconButton label={paint.visible ? 'Hide layer' : 'Show layer'} aria-pressed={!paint.visible} onClick={() => onChange({ visible: !paint.visible })}>{paint.visible ? <IconEye /> : <IconEyeOff />}</IconButton>
          </Tooltip>
          {removable ? (
            <Tooltip content="Remove layer">
              <IconButton label="Remove layer" onClick={onRemove}><IconMinus /></IconButton>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <SelectField
        label={`${label} type`}
        value={paint.type}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Radial' },
          { value: 'image', label: 'Image' },
          { value: 'mesh', label: 'Mesh' },
          ...(paint.type === 'pattern' ? [{ value: 'pattern', label: 'Pattern' }] : []),
        ]}
        onChange={(value) => changeType(value as VectorPaint['type'])}
      />
      {paint.type === 'solid' ? (
        <ColorField
          label={label}
          value={paint.color ?? '#000000'}
          onChange={(color) => onChange({ color })}
          recent={palette?.recent}
          swatches={palette?.swatches}
          onAddSwatch={palette?.onAddSwatch}
          onRemoveSwatch={palette?.onRemoveSwatch}
          onPickFromCanvas={palette?.onPickFromCanvas ? () => palette.onPickFromCanvas!((color) => onChange({ color })) : undefined}
          onColorUsed={palette?.onColorUsed}
          {...gesture}
        />
      ) : null}
      {paint.type === 'linear' || paint.type === 'radial' ? (
        <>
          <GradientField label={`${label} gradient`} value={paint.stops ?? defaultStops('#000000')} onChange={(stops) => onChange({ stops })} {...gesture} />
          {paint.type === 'linear' ? (
            <NumberField label="Angle" value={paint.angle ?? 0} min={0} max={360} step={1} unit="°" variant="field" onChange={(angle) => onChange({ angle })} {...gesture} />
          ) : null}
        </>
      ) : null}
      {paint.type === 'image' ? (
        <>
          <div className="vector-paint__image">
            {paint.image ? <img src={paint.image} alt="" className="vector-paint__preview" /> : <span className="vector-paint__preview vector-paint__preview--empty" aria-hidden="true" />}
            <Button variant="quiet" size="sm" onClick={() => fileInput.current?.click()}>{paint.image ? 'Replace image' : 'Choose image'}</Button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="visually-hidden" tabIndex={-1} onChange={(event) => { pickImage(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
          </div>
          {imageError ? <StatusMessage tone="error">{imageError}</StatusMessage> : null}
          <SelectField
            label="Mode"
            value={paint.imageMode ?? 'fill'}
            options={[{ value: 'fill', label: 'Fill' }, { value: 'fit', label: 'Fit' }, { value: 'tile', label: 'Tile' }]}
            onChange={(value) => onChange({ imageMode: value as VectorPaint['imageMode'] })}
          />
          <p className="vector-panel__hint">Images up to 512 KB are stored inside the document.</p>
        </>
      ) : null}
      {paint.type === 'mesh' && paint.mesh ? (
        <>
          <p className="vector-panel__hint">Drag the knots on the canvas. Double-click inside the shape to add a row and a column.</p>
          {typeof selectedMeshPoint === 'number' && paint.mesh.points[selectedMeshPoint] ? (
            <ColorField
              label="Knot"
              value={paint.mesh.points[selectedMeshPoint]!.color}
              recent={palette?.recent}
              swatches={palette?.swatches}
              onAddSwatch={palette?.onAddSwatch}
              onRemoveSwatch={palette?.onRemoveSwatch}
              onPickFromCanvas={palette?.onPickFromCanvas ? () => palette.onPickFromCanvas!((hex) => onChange({ mesh: withKnot(paint.mesh!, selectedMeshPoint, hex) })) : undefined}
              onColorUsed={palette?.onColorUsed}
              onChange={(color) => onChange({ mesh: withKnot(paint.mesh!, selectedMeshPoint, color) }, false)}
              onGestureStart={gesture.onGestureStart}
              onGestureEnd={gesture.onGestureEnd}
              onGestureCancel={gesture.onGestureCancel}
            />
          ) : <p className="vector-panel__hint">Select a knot on the canvas to change its colour.</p>}
        </>
      ) : null}
      {paint.type === 'pattern' && paint.tile ? (
        <>
          <SelectField
            label="Repeat"
            value={paint.patternMode ?? 'grid'}
            options={[{ value: 'grid', label: 'Grid' }, { value: 'brick', label: 'Brick' }, { value: 'hex', label: 'Hex' }]}
            onChange={(value) => onChange({ patternMode: value as VectorPaint['patternMode'] })}
          />
          <div className="vector-field-grid">
            <NumberField label="Tile W" value={paint.tile.width} min={1} max={10000} step={1} unit="px" variant="field" onChange={(width) => onChange({ tile: { ...paint.tile!, width } })} {...gesture} />
            <NumberField label="Tile H" value={paint.tile.height} min={1} max={10000} step={1} unit="px" variant="field" onChange={(height) => onChange({ tile: { ...paint.tile!, height } })} {...gesture} />
          </div>
          <div className="vector-field-grid">
            <NumberField label="Spacing" value={paint.spacing ?? 0} min={-1000} max={1000} step={1} unit="px" variant="field" onChange={(spacing) => onChange({ spacing })} {...gesture} />
            <NumberField label="Angle" value={paint.angle ?? 0} min={0} max={360} step={1} unit="°" variant="field" onChange={(angle) => onChange({ angle })} {...gesture} />
          </div>
          <SliderField label="Scale" value={Math.round((paint.scale ?? 1) * 100)} min={5} max={400} step={1} unit="%" onChange={(value) => onChange({ scale: value / 100 })} {...gesture} />
          <p className="vector-panel__hint">The pattern stamps an object of the document. Editing that object changes every fill that uses it.</p>
        </>
      ) : null}
      <SliderField label="Layer opacity" value={Math.round(paint.opacity * 100)} min={0} max={100} step={1} unit="%" onChange={(opacity) => onChange({ opacity: opacity / 100 })} {...gesture} />
    </div>
  )
}
