import { useState } from 'react'
import type { ParameterDef } from '@/rigs/types'
import { scenePropertyLabel, type SceneRig } from '@/scene/rig'
import { SceneEmpty, SceneSection } from '@/scene/SceneProperties'
import type { SceneDocument } from '@/scene/types'
import type { SceneMode } from '@/scene/prefs'
import { Inspector } from '@/workspace/Inspector'
import type { RigSession } from '@/state/session'
import { SceneMenu, type SceneMenuEntry } from '@/scene/SceneMenu'
import { Button } from '@/ui/Button'

/**
 * The Controls tab: the rig a scene carries, and the switch between building it and using it.
 *
 * The controls themselves are the workbench's own inspector, unchanged — the same component that
 * shows them when the document is opened from the library, reading the same session, writing to the
 * same persisted values. Anything else would be a second inspector to keep in step with the first.
 *
 * What this adds around it is the part that belongs to the editor: the Edit / Tune switch, a way to
 * add a control that drives nothing yet, and a menu per control for the things a rig's author does
 * — rename it, move it to another group, see what it drives, delete it.
 */
export function ControlsPanel({
  document: scene,
  session,
  mode,
  onMode,
  onAddControl,
  onRenameControl,
  onMoveControl,
  onRemoveControl,
  onGoToBinding,
  isOpen,
  onSection,
}: {
  document: SceneDocument
  /** The workbench's session for this document, or null while it has no controls at all. */
  session: RigSession | null
  mode: SceneMode
  onMode: (mode: SceneMode) => void
  onAddControl: () => void
  onRenameControl: (parameterId: string, label: string) => void
  onMoveControl: (parameterId: string, group: string) => void
  onRemoveControl: (parameterId: string) => void
  /** Selects the object a binding writes to, and opens the tab its field lives in. */
  onGoToBinding: (parameterId: string) => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}) {
  const rig = scene.rig
  const [renaming, setRenaming] = useState<string | null>(null)

  if (!rig || rig.parameters.length === 0) {
    return (
      <div className="scene-properties__notice">
        <SceneEmpty>
          No controls yet. Press the ◇ beside any field to expose it, or add one here and bind it
          afterwards.
        </SceneEmpty>
        <div className="scene-buttons">
          <button type="button" className="scene-button" onClick={onAddControl}>Add control</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <SceneSection id="controls-mode" title="Controls" meta={mode === 'tune' ? 'Tune' : 'Edit'} isOpen={isOpen} onSection={onSection}>
        <div className="scene-controls__mode" role="group" aria-label="Editing mode">
          <Button
            variant={mode === 'edit' ? 'solid' : 'quiet'}
            size="sm"
            aria-pressed={mode === 'edit'}
            onClick={() => onMode('edit')}
          >
            Edit
          </Button>
          <Button
            variant={mode === 'tune' ? 'solid' : 'quiet'}
            size="sm"
            aria-pressed={mode === 'tune'}
            onClick={() => onMode('tune')}
          >
            Tune
          </Button>
        </div>
        <SceneEmpty>
          {mode === 'tune'
            ? 'Tune shows the scene as its controls say, with the tools out of the way.'
            : 'Edit builds the rig: expose a field with ◇, then set what it may do here.'}
        </SceneEmpty>
        <div className="scene-buttons">
          <button type="button" className="scene-button" onClick={onAddControl}>Add control</button>
        </div>
      </SceneSection>

      <SceneSection id="controls-list" title="Bindings" meta={String(rig.bindings.length)} isOpen={isOpen} onSection={onSection}>
        <ul className="scene-controls__list">
          {rig.parameters.map((parameter) => (
            <li key={parameter.id} className="scene-controls__row">
              {renaming === parameter.id ? (
                <input
                  className="scene-controls__name"
                  defaultValue={parameter.label}
                  aria-label={`Rename ${parameter.label}`}
                  autoFocus
                  onBlur={(event) => {
                    const label = event.target.value.trim()
                    setRenaming(null)
                    if (label && label !== parameter.label) onRenameControl(parameter.id, label)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key !== 'Escape') return
                    event.currentTarget.value = parameter.label
                    event.currentTarget.blur()
                  }}
                />
              ) : (
                <span
                  className="scene-controls__name"
                  draggable
                  onDragStart={(event) => {
                    // Dropped on a field, this control binds to it: the gesture the panels listen for.
                    event.dataTransfer.effectAllowed = 'link'
                    event.dataTransfer.setData('application/x-paramrig-parameter', parameter.id)
                    event.dataTransfer.setData('text/plain', parameter.label)
                  }}
                >
                  {parameter.label}
                </span>
              )}
              <span className="scene-controls__drives">{drives(scene, rig, parameter.id)}</span>
              <SceneMenu
                label={`${parameter.label} actions`}
                variant="chevron"
                entries={menuFor({
                  parameter,
                  rig,
                  onRename: () => setRenaming(parameter.id),
                  onMove: onMoveControl,
                  onRemove: onRemoveControl,
                  onGoTo: onGoToBinding,
                })}
              />
            </li>
          ))}
        </ul>
      </SceneSection>

      {session ? (
        <div className="scene-controls__inspector">
          <Inspector
            session={session}
            groups={rig.groups}
            parameters={rig.parameters}
            values={session.getSnapshot().values}
            defaults={session.defaults}
            {...(rig.inspectorCategories ? { categories: rig.inspectorCategories } : {})}
          />
        </div>
      ) : null}
    </>
  )
}

/** What a control drives, in as many words as a row has room for. */
function drives(scene: SceneDocument, rig: SceneRig, parameterId: string): string {
  const bindings = rig.bindings.filter((binding) => binding.parameterId === parameterId)
  if (bindings.length === 0) return 'Nothing yet'
  if (bindings.length === 1) return scenePropertyLabel(scene, bindings[0]!)
  return `${bindings.length} properties`
}

function menuFor({ parameter, rig, onRename, onMove, onRemove, onGoTo }: {
  parameter: ParameterDef
  rig: SceneRig
  onRename: () => void
  onMove: (parameterId: string, group: string) => void
  onRemove: (parameterId: string) => void
  onGoTo: (parameterId: string) => void
}): SceneMenuEntry[] {
  const others = rig.groups.filter((group) => group.id !== parameter.group)
  const bound = rig.bindings.some((binding) => binding.parameterId === parameter.id)
  return [
    { id: 'rename', label: 'Rename', run: onRename },
    {
      id: 'go',
      label: 'Go to what it drives',
      disabled: !bound,
      reason: 'This control drives nothing yet.',
      run: () => onGoTo(parameter.id),
    },
    ...(others.length > 0
      ? [
        { separator: true } as SceneMenuEntry,
        { heading: 'Move to group' } as SceneMenuEntry,
        ...others.map((group) => ({
          id: `move-${group.id}`,
          label: group.label,
          run: () => onMove(parameter.id, group.id),
        })),
      ]
      : []),
    { separator: true },
    { id: 'delete', label: 'Delete', run: () => onRemove(parameter.id) },
  ]
}
