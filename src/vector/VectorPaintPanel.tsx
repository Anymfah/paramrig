import { useRef, useState, type CSSProperties } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { Button, IconButton } from '@/ui/Button'
import { ColorField } from '@/ui/ColorField'
import { GradientField } from '@/ui/GradientField'
import { IconEye, IconEyeOff, IconMinus, IconMore } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SliderField } from '@/ui/SliderField'
import { StatusMessage } from '@/ui/StatusMessage'
import { Tooltip } from '@/ui/Tooltip'
import { dataUrlBytes, readImageFile } from '@/vector/images'
import { defaultStops, MAX_IMAGE_BYTES } from '@/vector/paints'
import { defaultMesh } from '@/vector/mesh'
import type { VectorPaint } from '@/vector/types'

type Gesture = { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }

/** Document-wide colour aids offered inside every picker. */
export type PaintPalette = {
  recent?: string[]
  /** The document's colour space, so a picker can say when a colour needs a wider screen. */
  space?: 'srgb' | 'display-p3'
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
  /** The style this paint follows, and the ways in and out of one. */
  style?: PaintStyleLink
  selectedMeshPoint?: number | null
}

/** How a paint line reaches the document's named styles. */
export type PaintStyleLink = {
  name: string | null
  canCreate: boolean
  onCreate: () => void
  onDetach: () => void
  onEdit?: () => void
}

/**
 * The paint layers of a fill or a stroke, one 32 px line each, top of the stack first. A line shows
 * what it paints and whether it is on; the whole of its detail opens in a popover anchored to it,
 * so a stack of four fills is four lines rather than four cards.
 */
export function PaintList({ label, paints, mixed = false, onChange, gesture, palette, style, selectedMeshPoint }: PaintListProps) {
  const update = (index: number, patch: Partial<VectorPaint>, record?: boolean) => {
    onChange(paints.map((paint, position) => position === index ? { ...paint, ...patch } : paint), record)
  }
  const remove = (index: number) => onChange(paints.filter((_, position) => position !== index))
  const ordered = paints.map((paint, index) => ({ paint, index })).reverse()
  return (
    <div className="vector-paints" data-mixed={mixed || undefined}>
      {style?.name ? (
        <div className="vector-row vector-row--style">
          <span className="vector-row__swatch" data-style="true" aria-hidden="true" />
          <span className="vector-row__label">{style.name}</span>
          <DropdownMenu.Root modal={false}>
            <Tooltip content={`${style.name} actions`}>
              <DropdownMenu.Trigger asChild>
                <IconButton label={`${style.name} actions`}><IconMore /></IconButton>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu" side="bottom" align="end" sideOffset={6} collisionPadding={8} aria-label={`${style.name} actions`}>
                <DropdownMenu.Item className="menu__item" data-action={`detach-${label.toLowerCase()}-style`} onSelect={style.onDetach}>Detach</DropdownMenu.Item>
                {style.onEdit ? <DropdownMenu.Item className="menu__item" onSelect={style.onEdit}>Edit style</DropdownMenu.Item> : null}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      ) : null}
      {mixed ? <p className="vector-empty">Mixed {label.toLowerCase()}s. Editing replaces them on every selected object.</p> : null}
      {paints.length === 0 && !mixed ? <p className="vector-empty">No {label.toLowerCase()}. Add one with +</p> : null}
      {ordered.map(({ paint, index }) => (
        <PaintRow
          key={paint.id}
          label={label}
          paint={paint}
          style={style}
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

function PaintRow({ label, paint, style, onChange, onRemove, gesture, palette, selectedMeshPoint }: {
  label: string
  paint: VectorPaint
  style?: PaintStyleLink
  onChange: (patch: Partial<VectorPaint>, record?: boolean) => void
  onRemove: () => void
  gesture: Gesture
  palette?: PaintPalette
  /** Which knot of a mesh fill the canvas has selected, so its colour can be edited here. */
  selectedMeshPoint?: number | null
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const typeLabel = PAINT_TYPES.find((item) => item.value === paint.type)?.label ?? 'Solid'
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
    <div className="vector-row" data-hidden={!paint.visible || undefined} data-paint={paint.type}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className="vector-row__open" aria-label={`Edit ${typeLabel.toLowerCase()} ${label.toLowerCase()}`}>
          <span className="vector-row__chip" data-paint={paint.type} style={swatchStyle(paint)} aria-hidden="true" />
          <span className="vector-row__label">{typeLabel}</span>
          <span className="vector-row__value">{paintSummary(paint)}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="popover vector-paint-popover" side="left" align="start" sideOffset={10} collisionPadding={8} aria-label={`${typeLabel} ${label.toLowerCase()}`}>
            <SelectField
              label="Type"
              value={paint.type}
              options={PAINT_TYPES.filter((item) => item.value !== 'pattern' || paint.type === 'pattern')}
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
                space={palette?.space}
                {...gesture}
              />
            ) : null}
            {paint.type === 'linear' || paint.type === 'radial' ? (
              <>
                <GradientField label="Colours" value={paint.stops ?? defaultStops('#000000')} onChange={(stops) => onChange({ stops })} {...gesture} />
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
                <p className="vector-empty">Images up to 512 KB are stored inside the document.</p>
              </>
            ) : null}
            {paint.type === 'mesh' && paint.mesh ? (
              typeof selectedMeshPoint === 'number' && paint.mesh.points[selectedMeshPoint] ? (
                <ColorField
                  label="Knot"
                  value={paint.mesh.points[selectedMeshPoint]!.color}
                  recent={palette?.recent}
                  swatches={palette?.swatches}
                  onAddSwatch={palette?.onAddSwatch}
                  onRemoveSwatch={palette?.onRemoveSwatch}
                  onPickFromCanvas={palette?.onPickFromCanvas ? () => palette.onPickFromCanvas!((hex) => onChange({ mesh: withKnot(paint.mesh!, selectedMeshPoint, hex) })) : undefined}
                  onColorUsed={palette?.onColorUsed}
                  space={palette?.space}
                  onChange={(color) => onChange({ mesh: withKnot(paint.mesh!, selectedMeshPoint, color) }, false)}
                  onGestureStart={gesture.onGestureStart}
                  onGestureEnd={gesture.onGestureEnd}
                  onGestureCancel={gesture.onGestureCancel}
                />
              ) : <p className="vector-empty">Select a knot on the canvas to change its colour. Double-click inside the shape to add a row and a column.</p>
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
                <p className="vector-empty">The pattern stamps an object of the document. Editing that object changes every fill that uses it.</p>
              </>
            ) : null}
            <SliderField label="Layer opacity" value={Math.round(paint.opacity * 100)} min={0} max={100} step={1} unit="%" onChange={(opacity) => onChange({ opacity: opacity / 100 })} {...gesture} />
            {style && !style.name && style.canCreate ? (
              <Button variant="quiet" size="sm" data-action={`create-${label.toLowerCase()}-style`} onClick={() => { style.onCreate(); setOpen(false) }}>Create style</Button>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Tooltip content={paint.visible ? 'Hide layer' : 'Show layer'}>
        <IconButton label={paint.visible ? 'Hide layer' : 'Show layer'} aria-pressed={!paint.visible} onClick={() => onChange({ visible: !paint.visible })}>{paint.visible ? <IconEye /> : <IconEyeOff />}</IconButton>
      </Tooltip>
      <Tooltip content="Remove layer">
        <IconButton label="Remove layer" onClick={onRemove}><IconMinus /></IconButton>
      </Tooltip>
    </div>
  )
}

const PAINT_TYPES = [
  { value: 'solid', label: 'Solid' },
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'mesh', label: 'Mesh' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'image', label: 'Image' },
]

/** What a line shows of the paint it stands for, without opening it. */
function paintSummary(paint: VectorPaint): string {
  if (paint.type === 'solid') return (paint.color ?? '').toUpperCase()
  if (paint.type === 'linear') return `${paint.stops?.length ?? 0} stops · ${Math.round(paint.angle ?? 0)}°`
  if (paint.type === 'radial') return `${paint.stops?.length ?? 0} stops`
  if (paint.type === 'mesh') return paint.mesh ? `${paint.mesh.rows} × ${paint.mesh.cols}` : ''
  if (paint.type === 'pattern') return paint.tile ? `${Math.round(paint.tile.width)} × ${Math.round(paint.tile.height)}` : ''
  return paint.image ? 'Picture' : 'No picture'
}

/** The chip at the head of a line: the colour, the ramp, or the picture itself. */
function swatchStyle(paint: VectorPaint): CSSProperties {
  if (paint.type === 'solid') return { background: paint.color ?? 'transparent' }
  if (paint.type === 'linear' || paint.type === 'radial') {
    const stops = (paint.stops ?? []).map((stop) => `${stop.color} ${Math.round(stop.t * 100)}%`).join(', ')
    if (!stops) return {}
    return { background: paint.type === 'linear' ? `linear-gradient(${(paint.angle ?? 0) + 90}deg, ${stops})` : `radial-gradient(circle, ${stops})` }
  }
  if (paint.type === 'image' && paint.image) return { backgroundImage: `url(${paint.image})`, backgroundSize: 'cover' }
  return {}
}
