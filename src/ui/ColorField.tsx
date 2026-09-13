import * as Popover from '@radix-ui/react-popover'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { hexToRgb, hsvToHex, rgbToHsv } from '@/ui/color'
import { IconButton } from '@/ui/Button'
import { FieldReset } from '@/ui/FieldReset'
import { IconNone, IconPipette, IconPlus, IconScreenPick } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { cmykLabel, outOfSrgbGamut } from '@/color/space'

type ColorFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  /** Adds a "None" toggle; `value` may then be `'none'`. */
  allowNone?: boolean
  /** Shown instead of the value when several selected items disagree. */
  mixed?: boolean
  /** Colour restored by the None toggle when this field has never held a hex value. */
  restoreValue?: string
  /** Colour rows shown in the picker: the last ones used, and the ones pinned to the document. */
  recent?: string[]
  swatches?: string[]
  onAddSwatch?: (hex: string) => void
  onRemoveSwatch?: (hex: string) => void
  /** Samples a colour from the drawing itself, alongside the system eyedropper. */
  onPickFromCanvas?: () => void
  /** The document's colour space, for the gamut mark and the print read-out. */
  space?: 'srgb' | 'display-p3'
  /** Called with a colour the user settled on, so callers can keep a "recent" row. */
  onColorUsed?: (hex: string) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onGestureCancel?: () => void
  /** A mark shows once the colour leaves this value, and puts it back on click. */
  defaultValue?: string
  /** Bump to open the picker from outside, for instance on a double-clicked stop. */
  openSignal?: number
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }

export function ColorField({
  label,
  value,
  onChange,
  allowNone = false,
  mixed = false,
  restoreValue,
  recent,
  swatches,
  onAddSwatch,
  onRemoveSwatch,
  onPickFromCanvas,
  space,
  onColorUsed,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
  defaultValue,
  openSignal,
}: ColorFieldProps) {
  const id = useId()
  const none = value === 'none'
  const lastHex = useRef<string | null>(none ? null : value)
  if (!none && hexToRgb(value)) lastHex.current = value
  const restore = lastHex.current ?? (restoreValue && hexToRgb(restoreValue) ? restoreValue : '#808080')
  const rgb = hexToRgb(none ? restore : value) ?? { r: 28, g: 32, b: 28 }
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  const [draft, setDraft] = useState(displayValue(value, mixed))
  const [open, setOpen] = useState(false)
  const [canPick, setCanPick] = useState(false)
  useEffect(() => {
    setDraft(displayValue(value, mixed))
  }, [value, mixed])
  useEffect(() => {
    setCanPick(typeof window !== 'undefined' && 'EyeDropper' in window)
  }, [])
  useEffect(() => {
    if (openSignal) setOpen(true)
  }, [openSignal])
  const modified = defaultValue !== undefined && !mixed && value.toLowerCase() !== defaultValue.toLowerCase()
  const hueFill = hsv.h / 360

  const hueGradient = useMemo(
    () =>
      [0, 60, 120, 180, 240, 300, 360]
        .map((h) => hsvToHex(h, 1, 1))
        .join(','),
    [],
  )

  const commitHex = (raw: string) => {
    const trimmed = raw.trim()
    if (allowNone && (trimmed === '' || /^none$/i.test(trimmed))) {
      if (!none) onChange('none')
      setDraft('None')
      return
    }
    const next = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
    if (!hexToRgb(next)) {
      setDraft(displayValue(value, mixed))
      return
    }
    const hex = next.toUpperCase()
    if (hex !== value) onChange(hex)
    setDraft(hex)
    onColorUsed?.(hex)
  }

  const pickFromScreen = async () => {
    const Ctor = (window as Window & { EyeDropper?: EyeDropperCtor }).EyeDropper
    if (!Ctor) return
    onGestureStart?.()
    try {
      const result = await new Ctor().open()
      const hex = result.sRGBHex.toUpperCase()
      onChange(hex)
      setDraft(hex)
      onColorUsed?.(hex)
      onGestureEnd?.()
    } catch {
      onGestureCancel?.()
    }
  }

  const nudgeSV = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const fine = event.shiftKey ? 0.01 : 0.04
    let s = hsv.s
    let v = hsv.v
    if (event.key === 'ArrowLeft') s -= fine
    else if (event.key === 'ArrowRight') s += fine
    else if (event.key === 'ArrowDown') v -= fine
    else if (event.key === 'ArrowUp') v += fine
    else return
    event.preventDefault()
    if (!event.repeat) onGestureStart?.()
    onChange(hsvToHex(hsv.h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, v))))
  }

  const hexId = `${id}-hex`

  return (
    <div className="control control--color control--field">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <div className="color-field">
          <Popover.Trigger className="color-swatch" aria-label={`${label} color ${mixed ? 'mixed' : none ? 'none' : value}`} data-none={none || undefined} data-mixed={mixed || undefined}>
            <span className="color-swatch__chip" style={{ background: none || mixed ? undefined : value }} />
          </Popover.Trigger>
          <label className="color-field__label" htmlFor={hexId}>
            {label}
          </label>
          {modified ? <FieldReset label={label} defaultLabel={defaultValue!.toUpperCase()} onReset={() => onChange(defaultValue!)} /> : null}
          <input
            id={hexId}
            className="color-field__hex"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commitHex(draft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitHex(draft)
              if (event.key === 'Escape') setDraft(displayValue(value, mixed))
            }}
          />
          {allowNone ? (
            <Tooltip content={none ? 'Restore color' : 'No color'}>
              <IconButton label={none ? `Restore ${label} color` : `Remove ${label} color`} aria-pressed={none} onClick={() => onChange(none ? restore : 'none')}>
                <IconNone />
              </IconButton>
            </Tooltip>
          ) : null}
          {onPickFromCanvas ? (
            <Tooltip content="Pick from the drawing">
              <IconButton label={`Pick ${label} from the drawing`} onClick={() => { setOpen(false); onPickFromCanvas() }}>
                <IconPipette />
              </IconButton>
            </Tooltip>
          ) : null}
          {canPick ? (
            <Tooltip content="Pick from the screen">
              <IconButton label={`Pick ${label} from screen`} onClick={() => void pickFromScreen()}>
                <IconScreenPick />
              </IconButton>
            </Tooltip>
          ) : null}
        </div>
        <Popover.Portal>
          <Popover.Content className="popover color-popover paramrig-control-portal" sideOffset={8} align="end" aria-label={`${label} picker`}>
            <div
              className="sv-plane"
              style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hsv.h, 1, 1)})` }}
              role="slider"
              tabIndex={0}
              aria-label={`${label} saturation and brightness`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(hsv.s * 100)}
              aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                onGestureStart?.()
                pickSV(event, hsv.h, onChange)
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                pickSV(event, hsv.h, onChange)
              }}
              onPointerUp={() => { onGestureEnd?.(); if (!none) onColorUsed?.(value) }}
              onPointerCancel={onGestureCancel}
              onKeyDown={nudgeSV}
              onKeyUp={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  onGestureEnd?.()
                }
              }}
            >
              <span className="sv-plane__thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
            </div>
            <input
              className="slider slider--hue"
              type="range"
              min={0}
              max={360}
              step={1}
              value={hsv.h}
              aria-label={`${label} hue`}
              style={{ '--p': String(hueFill), '--hue-ramp': hueGradient } as CSSProperties}
              onPointerDown={onGestureStart}
              onPointerUp={() => { onGestureEnd?.(); if (!none) onColorUsed?.(value) }}
              onPointerCancel={onGestureCancel}
              onChange={(event) => onChange(hsvToHex(Number(event.target.value), hsv.s, hsv.v))}
            />
            {swatches || onAddSwatch ? (
              <SwatchRow
                title="Document"
                colors={swatches ?? []}
                empty="No colour pinned yet."
                onPick={(hex) => { onChange(hex); setDraft(hex); onColorUsed?.(hex) }}
                onAdd={onAddSwatch && !none ? () => onAddSwatch(value.toUpperCase()) : undefined}
                onRemove={onRemoveSwatch}
              />
            ) : null}
            <div className="color-popover__readout">
              <span>CMYK</span>
              <span className="color-popover__cmyk">{cmykLabel(none ? restore : value)}</span>
              <span className="color-popover__note">indicative, no profile</span>
            </div>
            {outOfSrgbGamut(none ? restore : value, space) ? (
              <p className="color-popover__gamut">Outside sRGB: this colour needs a Display P3 screen to show as it is.</p>
            ) : null}
            {recent && recent.length > 0 ? (
              <SwatchRow title="Recent" colors={recent} onPick={(hex) => { onChange(hex); setDraft(hex); onColorUsed?.(hex) }} />
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}

function SwatchRow({ title, colors, empty, onPick, onAdd, onRemove }: {
  title: string
  colors: string[]
  empty?: string
  onPick: (hex: string) => void
  onAdd?: () => void
  onRemove?: (hex: string) => void
}) {
  return (
    <div className="swatch-row">
      <div className="swatch-row__head">
        <span className="swatch-row__title">{title}</span>
        {onAdd ? (
          <Tooltip content="Pin the current colour">
            <IconButton label={`Pin the current colour to ${title.toLowerCase()}`} onClick={onAdd}><IconPlus /></IconButton>
          </Tooltip>
        ) : null}
      </div>
      {colors.length === 0 ? <p className="swatch-row__empty">{empty}</p> : (
        <ul className="swatch-row__list">
          {colors.map((hex) => (
            <li key={hex}>
              <button
                type="button"
                className="swatch-row__chip"
                style={{ background: hex }}
                aria-label={hex}
                title={undefined}
                onClick={() => onPick(hex)}
                onContextMenu={onRemove ? (event) => { event.preventDefault(); onRemove(hex) } : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function pickSV(
  event: ReactPointerEvent<HTMLDivElement>,
  hue: number,
  onChange: (value: string) => void,
) {
  const rect = event.currentTarget.getBoundingClientRect()
  const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  const v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  onChange(hsvToHex(hue, s, v))
}

function displayValue(value: string, mixed: boolean): string {
  if (mixed) return 'Mixed'
  return value === 'none' ? 'None' : value
}
