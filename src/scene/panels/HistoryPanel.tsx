import { useState } from 'react'
import { historyRows, type HistoryStep } from '@/editor/history'
import { SceneSection } from '@/scene/SceneProperties'
import type { SceneVersion } from '@/scene/types'
import { Button, IconButton } from '@/ui/Button'
import { IconTrash } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

/**
 * The History tab: every state the scene can be sent back to, newest first, with the named
 * versions dropped in where they were saved.
 *
 * Undo is a list rather than a count because a modelling session is long and a person remembers
 * what they did, not how many times they did it. Clicking a step travels to it, which is the same
 * move as undoing or redoing until you get there.
 */
export function HistoryPanel({
  steps,
  index,
  onGoTo,
  versions,
  onRestoreVersion,
  onDeleteVersion,
  onSaveVersion,
  isOpen,
  onSection,
}: {
  steps: HistoryStep[]
  index: number
  onGoTo: (index: number) => void
  versions: SceneVersion[]
  onRestoreVersion: (id: string) => void
  onDeleteVersion: (id: string) => void
  onSaveVersion: (name: string) => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}) {
  const [name, setName] = useState('')
  const depth = steps.length

  return (
    <SceneSection
      id="history"
      title="History"
      meta={depth === 0 ? 'Nothing to undo' : `${depth} ${depth === 1 ? 'step' : 'steps'}`}
      isOpen={isOpen}
      onSection={onSection}
    >
      <form
        className="scene-version-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSaveVersion(name)
          setName('')
        }}
      >
        <input
          className="scene-version-form__input"
          aria-label="Version name"
          placeholder="Version name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Tooltip content="Keep a named copy of every object, mesh and material">
          <Button variant="quiet" size="sm" type="submit">Save version</Button>
        </Tooltip>
      </form>
      <ol className="scene-history" aria-label="History steps">
        {historyRows(steps, index, versions).map((row) => (
          row.kind === 'step' ? (
            <li key={`step-${row.index}`}>
              <button
                type="button"
                className="scene-history__step"
                data-current={row.current || undefined}
                data-undone={row.undone || undefined}
                data-step={row.index}
                aria-current={row.current || undefined}
                onClick={() => onGoTo(row.index)}
              >
                <span className="scene-history__dot" aria-hidden="true" />
                <span className="scene-history__label">{row.label}</span>
                <span className="scene-history__time">{formatStepTime(row.at)}</span>
              </button>
            </li>
          ) : (
            <li key={`version-${row.id}`} className="scene-history__version">
              <span className="scene-history__dot scene-history__dot--version" aria-hidden="true" />
              <span className="scene-history__label">{row.label}</span>
              <Button variant="quiet" size="sm" onClick={() => onRestoreVersion(row.id)}>Restore</Button>
              <Tooltip content="Delete version">
                <IconButton label={`Delete version ${row.label}`} onClick={() => onDeleteVersion(row.id)}><IconTrash /></IconButton>
              </Tooltip>
            </li>
          )
        ))}
      </ol>
    </SceneSection>
  )
}

/** A step's time of day; a step that carries no time — a restored document — shows nothing. */
function formatStepTime(at: number): string {
  const date = new Date(at)
  if (at === 0 || Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
