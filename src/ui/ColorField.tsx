import * as Popover from '@radix-ui/react-popover'
import { useEffect, useId, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { hexToRgb, hsvToHex, rgbToHsv } from '@/ui/color'
import { IconReset } from '@/ui/icons'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'

type ColorFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
  onReset?: () => void
  resetDisabled?: boolean
}

export function ColorField({ label, value, onChange, onGestureStart, onGestureEnd, onReset, resetDisabled }: ColorFieldProps) {
  const id = useId()
  const rgb = hexToRgb(value) ?? { r: 28, g: 32, b: 28 }
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
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
    onChange(next.toUpperCase())
    setDraft(next.toUpperCase())
  }

  return (
    <div className="field">
      <div className="field__head">
        <span className="field__label" id={id}>
          {label}
        </span>
        {onReset ? (
          <Tooltip content={resetDisabled ? 'Already at the default' : 'Reset this control'}>
            <IconButton label={`Reset ${label}`} onClick={onReset} disabled={resetDisabled}>
              <IconReset />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      <Popover.Root>
        <div className="color-field">
          <Popover.Trigger className="color-swatch" aria-labelledby={id} aria-label={`${label} color ${value}`}>
            <span className="color-swatch__chip" style={{ background: value }} />
          </Popover.Trigger>
          <input
            className="number-field__input color-field__hex"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            aria-label={`${label} hex`}
            onFocus={onGestureStart}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              commitHex(draft)
              onGestureEnd?.()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitHex(draft)
              if (event.key === 'Escape') setDraft(value)
            }}
          />
        </div>
        <Popover.Portal>
          <Popover.Content className="popover color-popover" sideOffset={8} align="end" aria-label={`${label} picker`}>
            <div
              className="sv-plane"
              style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hsv.h, 1, 1)})` }}
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
              onChange={(event) => onChange(hsvToHex(Number(event.target.value), hsv.s, hsv.v))}
            />
            <p className="field__hint">Hex entry stays available if the plane is hard to use.</p>
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
