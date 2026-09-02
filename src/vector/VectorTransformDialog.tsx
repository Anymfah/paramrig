import { useEffect, useState } from 'react'
import { Button } from '@/ui/Button'
import { VectorModal } from '@/vector/VectorModal'
import { isIdentityTransform, type NumericTransform } from '@/vector/repeat'

/**
 * Numeric transform of the selection: one move, one scale, one turn, two flips, applied together
 * as a single undo entry. The dialog reopens on the values it was last used with.
 */
export function VectorTransformDialog({ count, open, initial, onClose, onApply }: {
  count: number
  open: boolean
  initial: NumericTransform
  onClose: () => void
  onApply: (transform: NumericTransform) => void
}) {
  const [draft, setDraft] = useState<Fields>(() => toFields(initial))

  useEffect(() => {
    if (open) setDraft(toFields(initial))
  }, [open, initial])

  const transform = fromFields(draft)
  const apply = () => {
    if (!isIdentityTransform(transform)) onApply(transform)
    onClose()
  }

  return (
    <VectorModal label="Transform" open={open} onClose={onClose}>
      <div className="vector-transform">
        <h2 className="vector-transform__title">Transform {count} {count === 1 ? 'object' : 'objects'}</h2>
        <div className="vector-transform__grid">
          <NumberField label="Move X" value={draft.dx} onChange={(dx) => setDraft({ ...draft, dx })} onEnter={apply} />
          <NumberField label="Move Y" value={draft.dy} onChange={(dy) => setDraft({ ...draft, dy })} onEnter={apply} />
          <NumberField label="Scale X %" value={draft.scaleX} onChange={(scaleX) => setDraft({ ...draft, scaleX })} onEnter={apply} />
          <NumberField label="Scale Y %" value={draft.scaleY} onChange={(scaleY) => setDraft({ ...draft, scaleY })} onEnter={apply} />
          <NumberField label="Rotate °" value={draft.rotation} onChange={(rotation) => setDraft({ ...draft, rotation })} onEnter={apply} />
        </div>
        <div className="vector-transform__flips">
          <Toggle label="Flip horizontally" pressed={draft.flipX} onChange={(flipX) => setDraft({ ...draft, flipX })} />
          <Toggle label="Flip vertically" pressed={draft.flipY} onChange={(flipY) => setDraft({ ...draft, flipY })} />
        </div>
        <div className="vector-transform__actions">
          <Button variant="quiet" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="solid" size="sm" data-action="transform-apply" onClick={apply}>Apply</Button>
        </div>
      </div>
    </VectorModal>
  )
}

/** Copies of the selection swung around the pivot, spread over a total angle. */
export function VectorRotateCopiesDialog({ count, open, onClose, onApply }: {
  count: number
  open: boolean
  onClose: () => void
  onApply: (copies: number, angle: number) => void
}) {
  const [copies, setCopies] = useState('5')
  const [angle, setAngle] = useState('360')

  useEffect(() => {
    if (!open) return
    setCopies('5')
    setAngle('360')
  }, [open])

  const apply = () => {
    const total = Number.parseFloat(angle)
    const many = Number.parseInt(copies, 10)
    if (Number.isFinite(total) && Number.isFinite(many) && many > 0) onApply(many, total)
    onClose()
  }

  return (
    <VectorModal label="Rotate copies" open={open} onClose={onClose}>
      <div className="vector-transform">
        <h2 className="vector-transform__title">Rotate {count} {count === 1 ? 'object' : 'objects'} in copies</h2>
        <div className="vector-transform__grid">
          <NumberField label="Copies" value={copies} onChange={setCopies} onEnter={apply} />
          <NumberField label="Total angle °" value={angle} onChange={setAngle} onEnter={apply} />
        </div>
        <p className="vector-transform__hint">The copies turn around the pivot, or around the centre of the selection when no pivot is set.</p>
        <div className="vector-transform__actions">
          <Button variant="quiet" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="solid" size="sm" data-action="rotate-copies-apply" onClick={apply}>Create copies</Button>
        </div>
      </div>
    </VectorModal>
  )
}

type Fields = { dx: string; dy: string; scaleX: string; scaleY: string; rotation: string; flipX: boolean; flipY: boolean }

function toFields(transform: NumericTransform): Fields {
  return {
    dx: String(transform.dx),
    dy: String(transform.dy),
    scaleX: String(transform.scaleX),
    scaleY: String(transform.scaleY),
    rotation: String(transform.rotation),
    flipX: transform.flipX,
    flipY: transform.flipY,
  }
}

function fromFields(fields: Fields): NumericTransform {
  return {
    dx: number(fields.dx, 0),
    dy: number(fields.dy, 0),
    scaleX: number(fields.scaleX, 100),
    scaleY: number(fields.scaleY, 100),
    rotation: number(fields.rotation, 0),
    flipX: fields.flipX,
    flipY: fields.flipY,
  }
}

function number(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : fallback
}

function NumberField({ label, value, onChange, onEnter }: { label: string; value: string; onChange: (value: string) => void; onEnter: () => void }) {
  return (
    <label className="vector-transform__field">
      <span>{label}</span>
      <input
        className="vector-palette__input"
        value={value}
        inputMode="decimal"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9.-]/g, ''))}
        onKeyDown={(event) => { if (event.key === 'Enter') onEnter() }}
      />
    </label>
  )
}

function Toggle({ label, pressed, onChange }: { label: string; pressed: boolean; onChange: (value: boolean) => void }) {
  return (
    <Button variant={pressed ? 'solid' : 'quiet'} size="sm" aria-pressed={pressed} onClick={() => onChange(!pressed)}>{label}</Button>
  )
}
