import { useEffect, useState } from 'react'
import { Button } from '@/ui/Button'
import { renamePreview } from '@/vector/commands'
import { VectorModal } from '@/vector/VectorModal'
import type { VectorElement } from '@/vector/types'

/** Renames a whole selection from one pattern, with the resulting names shown before committing. */
export function VectorRenameDialog({ elements, open, onClose, onRename }: {
  elements: VectorElement[]
  open: boolean
  onClose: () => void
  onRename: (names: string[]) => void
}) {
  const [pattern, setPattern] = useState('Layer $n')
  const [start, setStart] = useState('1')

  useEffect(() => {
    if (open) return
    setPattern('Layer $n')
    setStart('1')
  }, [open])

  const first = Number.parseInt(start, 10)
  const names = renamePreview(pattern, elements, Number.isFinite(first) ? first : 1)
  const apply = () => {
    onRename(names)
    onClose()
  }

  return (
    <VectorModal label="Rename layers" open={open} onClose={onClose}>
      <div className="vector-rename">
        <h2 className="vector-rename__title">Rename {elements.length} {elements.length === 1 ? 'layer' : 'layers'}</h2>
        <label className="vector-rename__field">
          <span>Pattern</span>
          <input
            className="vector-palette__input"
            value={pattern}
            spellCheck={false}
            onChange={(event) => setPattern(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') apply() }}
          />
        </label>
        <label className="vector-rename__field vector-rename__field--narrow">
          <span>Start at</span>
          <input
            className="vector-palette__input"
            value={start}
            inputMode="numeric"
            spellCheck={false}
            onChange={(event) => setStart(event.target.value.replace(/[^0-9-]/g, ''))}
            onKeyDown={(event) => { if (event.key === 'Enter') apply() }}
          />
        </label>
        <p className="vector-rename__hint">$n is the position, $name the current name, $kind the kind of object.</p>
        <ul className="vector-rename__preview">
          {names.slice(0, 12).map((name, index) => (
            <li key={index}>
              <span className="vector-rename__from">{elements[index]!.name}</span>
              <span className="vector-rename__arrow" aria-hidden="true">→</span>
              <span className="vector-rename__to">{name}</span>
            </li>
          ))}
          {names.length > 12 ? <li className="vector-rename__more">and {names.length - 12} more</li> : null}
        </ul>
        <div className="vector-rename__actions">
          <Button variant="quiet" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="solid" size="sm" data-action="rename-apply" onClick={apply}>Rename</Button>
        </div>
      </div>
    </VectorModal>
  )
}
