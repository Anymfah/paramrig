import * as Popover from '@radix-ui/react-popover'
import { useEffect, useId, useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { hexToRgb, hsvToHex, rgbToHsv } from '@/ui/color'
import { IconButton } from '@/ui/Button'
import { IconPipette } from '@/ui/icons'

type ColorFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onGestureCancel?: () => void
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }

export function ColorField({
  label,
  value,
  onChange,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: ColorFieldProps) {
  const id = useId()
  const rgb = hexToRgb(value) ?? { r: 28, g: 32, b: 28 }
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  const [draft, setDraft] = useState(value)
  const [canPick, setCanPick] = useState(false)
  useEffect(() => {
    setDraft(value)
  }, [value])
  useEffect(() => {
    setCanPick(typeof window !== 'undefined' && 'EyeDropper' in window)
  }, [])
  const hueFill = hsv.h / 360

  const hueGradient = useMemo(
    () =>
      [0, 60, 120, 180, 240, 300, 360]
        .map((h) => hsvToHex(h, 1, 1))
        .join(','),
    [],
  )

  const commitHex = (raw: string) => {
    const next = raw.startsWith('#') ? raw : `#${raw}`
    if (!hexToRgb(next)) {
      setDraft(value)
      return
    }
    const hex = next.toUpperCase()
    if (hex !== value) onChange(hex)
    setDraft(hex)
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
      <Popover.Root>
        <div className="color-field">
          <Popover.Trigger className="color-swatch" aria-label={`${label} color ${value}`}>
            <span className="color-swatch__chip" style={{ background: value }} />
          </Popover.Trigger>
          <label className="color-field__label" htmlFor={hexId}>
            {label}
          </label>
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
              if (event.key === 'Escape') setDraft(value)
            }}
          />
          {canPick ? (
            <IconButton label={`Pick ${label} from screen`} onClick={() => void pickFromScreen()}>
              <IconPipette />
            </IconButton>
          ) : null}
        </div>
        <Popover.Portal>
          <Popover.Content className="popover color-popover" sideOffset={8} align="end" aria-label={`${label} picker`}>
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
              onPointerUp={onGestureEnd}
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
              onPointerUp={onGestureEnd}
              onPointerCancel={onGestureCancel}
              onChange={(event) => onChange(hsvToHex(Number(event.target.value), hsv.s, hsv.v))}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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
