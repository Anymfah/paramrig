import { IconButton } from '@/ui/Button'
import { ColorField } from '@/ui/ColorField'
import { IconBringForward, IconDiamond, IconEye, IconEyeOff, IconMinus, IconReset, IconSendBackward } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { BarField } from '@/ui/BarField'
import { Tooltip } from '@/ui/Tooltip'
import { ADJUSTMENT_KEYS, BLEND_MODES, createEffect, effectLabel, EFFECT_KINDS } from '@/vector/effects'
import { Exposable } from '@/vector/VectorExpose'
import { useDriven } from '@/vector/exposeContext'
import type { PaintPalette } from '@/vector/VectorPaintPanel'
import type { VectorBlendMode, VectorEffect, VectorEffectKind, VectorElement, VectorImageAdjustments } from '@/vector/types'
import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'

type Gesture = { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }

const MAX_EFFECTS = 8

const BLEND_LABELS: Record<VectorBlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten',
  colorDodge: 'Color dodge', colorBurn: 'Color burn', hardLight: 'Hard light', softLight: 'Soft light',
  difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
}

const ADJUSTMENT_LABELS: Record<keyof VectorImageAdjustments, string> = {
  exposure: 'Exposure', contrast: 'Contrast', saturation: 'Saturation',
  temperature: 'Temperature', highlights: 'Highlights', shadows: 'Shadows',
}

export const MAX_EFFECTS_PER_ELEMENT = MAX_EFFECTS

/** Shadows and blurs on the selection, one 32 px line each, top of the stack first. */
export function EffectList({ effects, mixed, onChange, gesture, palette }: {
  effects: VectorEffect[]
  mixed?: boolean
  onChange: (effects: VectorEffect[], record?: boolean) => void
  gesture: Gesture
  palette?: PaintPalette
}) {
  const update = (index: number, patch: Partial<VectorEffect>, record?: boolean) => {
    onChange(effects.map((effect, position) => position === index ? { ...effect, ...patch } : effect), record)
  }
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= effects.length) return
    const next = [...effects]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    onChange(next)
  }
  const ordered = effects.map((effect, index) => ({ effect, index })).reverse()
  return (
    <>
      {mixed ? <p className="vector-empty">Mixed effects. Editing replaces them on every selected object.</p> : null}
      {effects.length === 0 && !mixed ? <p className="vector-empty">No effects. Add one with +</p> : null}
      {ordered.map(({ effect, index }) => (
        <EffectRow
          key={effect.id}
          effect={effect}
          index={index}
          first={index === effects.length - 1}
          last={index === 0}
          onChange={(patch, record) => update(index, patch, record)}
          onRemove={() => onChange(effects.filter((_, position) => position !== index))}
          onMove={(direction) => move(index, direction)}
          gesture={gesture}
          palette={palette}
        />
      ))}
    </>
  )
}

function EffectRow({ effect, index, first, last, onChange, onRemove, onMove, gesture, palette }: {
  effect: VectorEffect
  /** Where this effect sits in the stack, which is how a binding names it. */
  index: number
  first: boolean
  last: boolean
  onChange: (patch: Partial<VectorEffect>, record?: boolean) => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
  gesture: Gesture
  palette?: PaintPalette
}) {
  const [open, setOpen] = useState(false)
  const shadow = effect.kind === 'dropShadow' || effect.kind === 'innerShadow'
  const path = (field: string) => `effects[${index}].${field}`
  const driven = useDriven(...['dx', 'dy', 'blur', 'spread', 'color', 'opacity'].map(path))
  const name = effectLabel(effect.kind)
  const changeKind = (kind: VectorEffectKind) => {
    if (kind === effect.kind) return
    onChange({ ...createEffect(kind, effect.id), visible: effect.visible, blur: effect.blur })
  }
  return (
    <div className="vector-row" data-hidden={!effect.visible || undefined} data-effect={effect.kind} data-driven={driven || undefined}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className="vector-row__open" aria-label={`Edit the ${name.toLowerCase()}${driven ? ', driven by a control' : ''}`}>
          <span className="vector-row__chip" data-effect={effect.kind} style={shadow ? { background: effect.color ?? '#000000' } : undefined} aria-hidden="true" />
          <span className="vector-row__label">{name}</span>
          <span className="vector-row__value">{shadow ? `${Math.round(effect.dx ?? 0)}, ${Math.round(effect.dy ?? 0)} · ${Math.round(effect.blur)}px` : `${Math.round(effect.blur)}px`}</span>
          {driven ? <IconDiamond className="vector-row__driven" /> : null}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="popover vector-paint-popover" side="left" align="start" sideOffset={10} collisionPadding={8} aria-label={name}>
            <SelectField
              label="Effect"
              value={effect.kind}
              options={EFFECT_KINDS.map((kind) => ({ value: kind, label: effectLabel(kind) }))}
              onChange={(value) => changeKind(value as VectorEffectKind)}
            />
            {shadow ? (
              <>
                <Exposable property={path('dx')} label={`Shadow ${index + 1} X`} min={-2000} max={2000}>
                  <NumberField label="X" value={effect.dx ?? 0} min={-2000} max={2000} step={1} unit="px" variant="field" onChange={(dx) => onChange({ dx })} {...gesture} />
                </Exposable>
                <Exposable property={path('dy')} label={`Shadow ${index + 1} Y`} min={-2000} max={2000}>
                  <NumberField label="Y" value={effect.dy ?? 0} min={-2000} max={2000} step={1} unit="px" variant="field" onChange={(dy) => onChange({ dy })} {...gesture} />
                </Exposable>
                <Exposable property={path('blur')} label={`Shadow ${index + 1} blur`} min={0} max={200}>
                  <NumberField label="Blur" value={effect.blur} min={0} max={200} step={1} unit="px" variant="field" onChange={(blur) => onChange({ blur })} {...gesture} />
                </Exposable>
                <Exposable property={path('spread')} label={`Shadow ${index + 1} spread`} min={-200} max={200}>
                  <NumberField label="Spread" value={effect.spread ?? 0} min={-200} max={200} step={1} unit="px" variant="field" onChange={(spread) => onChange({ spread })} {...gesture} />
                </Exposable>
              </>
            ) : (
              <Exposable property={path('blur')} label={`${name} radius`} min={0} max={200}>
                <BarField label="Blur" value={effect.blur} min={0} max={200} step={1} unit="px" onChange={(blur) => onChange({ blur })} {...gesture} />
              </Exposable>
            )}
            {shadow ? (
              <>
                <Exposable property={path('color')} label={`Shadow ${index + 1} colour`}>
                <ColorField
                  label="Shadow"
                  value={effect.color ?? '#000000'}
                  recent={palette?.recent}
                  swatches={palette?.swatches}
                  onAddSwatch={palette?.onAddSwatch}
                  onRemoveSwatch={palette?.onRemoveSwatch}
                  onPickFromCanvas={palette?.onPickFromCanvas ? () => palette.onPickFromCanvas!((hex) => onChange({ color: hex })) : undefined}
                  onColorUsed={palette?.onColorUsed}
                  onChange={(color) => onChange({ color }, false)}
                  onGestureStart={gesture.onGestureStart}
                  onGestureEnd={gesture.onGestureEnd}
                  onGestureCancel={gesture.onGestureCancel}
                />
                </Exposable>
                <Exposable property={path('opacity')} label={`Shadow ${index + 1} opacity`} min={0} max={1} step={0.01}>
                  <BarField label="Shadow opacity" value={Math.round((effect.opacity ?? 1) * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => onChange({ opacity: value / 100 })} {...gesture} />
                </Exposable>
              </>
            ) : null}
            <div className="vector-popover__actions">
              <Tooltip content="Move this effect down">
                <IconButton label={`Move the ${name.toLowerCase()} down`} disabled={first} onClick={() => onMove(-1)}><IconSendBackward /></IconButton>
              </Tooltip>
              <Tooltip content="Move this effect up">
                <IconButton label={`Move the ${name.toLowerCase()} up`} disabled={last} onClick={() => onMove(1)}><IconBringForward /></IconButton>
              </Tooltip>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Tooltip content={effect.visible ? 'Hide this effect' : 'Show this effect'}>
        <IconButton label={effect.visible ? `Hide the ${name.toLowerCase()}` : `Show the ${name.toLowerCase()}`} aria-pressed={!effect.visible} onClick={() => onChange({ visible: !effect.visible })}>
          {effect.visible ? <IconEye /> : <IconEyeOff />}
        </IconButton>
      </Tooltip>
      <Tooltip content="Remove this effect">
        <IconButton label={`Remove the ${name.toLowerCase()}`} onClick={onRemove}><IconMinus /></IconButton>
      </Tooltip>
    </div>
  )
}

/** How the selection mixes with what is under it. */
export function BlendMode({ mode, onChange }: { mode: VectorBlendMode; onChange: (mode: VectorBlendMode) => void }) {
  return (
    <SelectField
      label="Mode"
      value={mode}
      options={BLEND_MODES.map((value) => ({ value, label: BLEND_LABELS[value] }))}
      onChange={(value) => onChange(value as VectorBlendMode)}
    />
  )
}

/** Picture corrections, each resting at zero. */
export function AdjustmentsPanel({ element, onChange, gesture }: {
  element: VectorElement
  onChange: (adjustments: VectorImageAdjustments | undefined, record?: boolean) => void
  gesture: Gesture
}) {
  const adjustments = element.adjustments ?? {}
  const set = (key: keyof VectorImageAdjustments, value: number) => {
    const next = { ...adjustments, [key]: value }
    const cleaned = Object.fromEntries(Object.entries(next).filter(([, amount]) => Math.abs(amount as number) > 0.001)) as VectorImageAdjustments
    onChange(Object.keys(cleaned).length ? cleaned : undefined)
  }
  const touched = ADJUSTMENT_KEYS.some((key) => Math.abs(adjustments[key] ?? 0) > 0.001)
  return (
    <>
      <div className="vector-row vector-row--action">
        <span className="vector-row__label">Adjustments</span>
        <Tooltip content="Back to the picture as it came">
          <IconButton label="Reset the adjustments" disabled={!touched} onClick={() => onChange(undefined)}><IconReset /></IconButton>
        </Tooltip>
      </div>
      {ADJUSTMENT_KEYS.map((key) => (
        <BarField
          key={key}
          label={ADJUSTMENT_LABELS[key]}
          value={Math.round((adjustments[key] ?? 0) * 100)}
          min={-100}
          max={100}
          step={1}
          unit="%"
          onChange={(value) => set(key, value / 100)}
          {...gesture}
        />
      ))}
    </>
  )
}
