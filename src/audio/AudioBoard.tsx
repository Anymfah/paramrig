import { useId, useState } from 'react'
import type { ParameterDef, ParamValue } from '@/rigs/types'
import { IconChevron, IconSliders } from '@/ui/icons'
import { ParameterField } from '@/ui/ParameterField'
import { BOARD_CATEGORIES, boardGroups } from '@/audio/board'

/**
 * The whole board, in the inspector's own clothes.
 *
 * There is no `RigSession` behind this one: Edit mode writes to the patch, not to a set of rig
 * values, and the editor owns its history the way the other two document editors own theirs. What
 * it does share is every control — the same `ParameterField` the inspector uses, so a frequency
 * here behaves exactly like a frequency anywhere else in the workbench.
 */
export function AudioBoard({ parameters, values, onChange, onGestureStart, onGestureEnd }: {
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  onChange: (property: string, value: ParamValue) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const [category, setCategory] = useState(BOARD_CATEGORIES[0]?.id ?? '')
  const groups = boardGroups()

  return (
    <aside className="inspector" aria-label="Sound board">
      <div className="inspector__head">
        <strong>Sound</strong>
        <IconSliders />
      </div>
      <div className="inspector__categories" role="tablist" aria-label="Sound sections">
        {BOARD_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`audio-category-${item.id}`}
            aria-selected={category === item.id}
            aria-controls="audio-board-panel"
            tabIndex={category === item.id ? 0 : -1}
            onClick={() => setCategory(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="inspector__body scroll-area" id="audio-board-panel" role="tabpanel" aria-labelledby={`audio-category-${category}`} tabIndex={0}>
        {groups.filter((group) => group.tab === category).map((group) => (
          <BoardSection
            key={group.id}
            label={group.label}
            defaultOpen={group.defaultOpen}
            parameters={parameters.filter((parameter) => parameter.group === group.id)}
            values={values}
            onChange={onChange}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
          />
        ))}
      </div>
      <p className="inspector__hint" aria-live="polite">Shift + drag for fine adjustment. Esc restores the previous value.</p>
    </aside>
  )
}

function BoardSection({ label, parameters, values, onChange, defaultOpen, onGestureStart, onGestureEnd }: {
  label: string
  parameters: ParameterDef[]
  values: Record<string, ParamValue>
  onChange: (property: string, value: ParamValue) => void
  defaultOpen?: boolean
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen ?? true)
  const sectionId = useId()
  if (parameters.length === 0) return null
  return (
    <section className="section" data-open={open}>
      <div className="section__head">
        <button type="button" className="section__title" aria-expanded={open} aria-controls={sectionId} onClick={() => setOpen((value) => !value)}>
          {label}
          <IconChevron />
        </button>
      </div>
      <div className="section__panel" id={sectionId} inert={!open} aria-hidden={!open}>
        <div>
          {parameters.map((parameter) => (
            <ParameterField
              key={parameter.id}
              param={parameter}
              value={values[parameter.id] ?? parameter.defaultValue}
              onChange={(next) => onChange(parameter.id, next)}
              onGestureStart={onGestureStart}
              onGestureEnd={onGestureEnd}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
