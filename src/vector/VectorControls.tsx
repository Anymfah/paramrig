import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Button, IconButton } from '@/ui/Button'
import { IconMore, IconPlus } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import type { ParameterDef, ParamGroup } from '@/rigs/types'
import type { RigSession } from '@/state/session'
import { Inspector } from '@/workspace/Inspector'
import { VectorEmpty, VectorSection } from '@/vector/VectorSection'
import type { VectorBinding } from '@/vector/rig'
import type { VectorMode } from '@/vector/inspectorPrefs'
import { useState } from 'react'

/**
 * The document's own controls, in the editor. The panel underneath is the workbench's inspector,
 * unchanged — a parametered drawing is a rig like any other, so it gets the same knobs, the same
 * expressions and the same reset marks.
 */
export function VectorControls({ session, groups, parameters, bindings, mode, onMode, onAdd, onRename, onMove, onDelete }: {
  session: RigSession | null
  groups: ParamGroup[]
  parameters: ParameterDef[]
  bindings: VectorBinding[]
  mode: VectorMode
  onMode: (mode: VectorMode) => void
  onAdd: () => void
  onRename: (parameterId: string, label: string) => void
  onMove: (parameterId: string, group: string) => void
  onDelete: (parameterId: string) => void
}) {
  return (
    <div className="vector-controls">
      <div className="vector-controls__head">
        <div className="vector-controls__mode" role="group" aria-label="Edit or tune">
          {(['edit', 'tune'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              data-active={mode === value || undefined}
              onClick={() => onMode(value)}
            >
              {value === 'edit' ? 'Edit' : 'Tune'}
            </button>
          ))}
        </div>
        <Tooltip content="Add a control with nothing behind it">
          <IconButton label="Add control" data-action="add-control" onClick={onAdd}><IconPlus /></IconButton>
        </Tooltip>
      </div>
      {parameters.length === 0 || !session ? (
        <div className="vector-controls__empty">
          <VectorEmpty>No controls yet. Expose a property with ◇</VectorEmpty>
          <Button variant="quiet" size="sm" data-action="add-control" onClick={onAdd}>Add control</Button>
        </div>
      ) : (
        <>
          <Inspector
            key={session.rigId}
            session={session}
            groups={groups}
            parameters={parameters}
            values={session.getSnapshot().values}
            defaults={session.defaults}
          />
          <VectorSection id="control-bindings" title="Bindings" meta={`${bindings.length}`} defaultOpen={false}>
            <ul className="vector-controls__list" aria-label="Controls and what they drive">
              {parameters.map((parameter) => (
                <ControlRow
                  key={parameter.id}
                  parameter={parameter}
                  groups={groups}
                  bound={bindings.filter((binding) => binding.parameterId === parameter.id).length}
                  onRename={onRename}
                  onMove={onMove}
                  onDelete={onDelete}
                />
              ))}
            </ul>
            <p className="vector-empty">Drag a control onto a field of the Design tab to point it there too.</p>
          </VectorSection>
        </>
      )}
    </div>
  )
}

/**
 * One control in the list. It can be dragged onto a field of the Design tab, which is the quick way
 * to point an existing control at a second property.
 */
function ControlRow({ parameter, groups, bound, onRename, onMove, onDelete }: {
  parameter: ParameterDef
  groups: ParamGroup[]
  bound: number
  onRename: (parameterId: string, label: string) => void
  onMove: (parameterId: string, group: string) => void
  onDelete: (parameterId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  return (
    <li
      className="vector-row"
      data-control={parameter.id}
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-paramrig-parameter', parameter.id)
        event.dataTransfer.effectAllowed = 'link'
      }}
    >
      {editing ? (
        <input
          className="vector-asset__input"
          autoFocus
          defaultValue={parameter.label}
          aria-label={`${parameter.label} name`}
          spellCheck={false}
          maxLength={80}
          onBlur={(event) => { onRename(parameter.id, event.currentTarget.value); setEditing(false) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') { event.currentTarget.value = parameter.label; event.currentTarget.blur() }
          }}
        />
      ) : (
        <>
          <span className="vector-row__label">{parameter.label}</span>
          <span className="vector-row__value">{bound === 0 ? 'No binding' : `${bound} bound`}</span>
        </>
      )}
      <DropdownMenu.Root modal={false}>
        <Tooltip content={`${parameter.label} actions`}>
          <DropdownMenu.Trigger asChild>
            <IconButton label={`${parameter.label} actions`}><IconMore /></IconButton>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" side="left" align="start" sideOffset={6} collisionPadding={8} aria-label={`${parameter.label} actions`}>
            <DropdownMenu.Item className="menu__item" onSelect={() => setEditing(true)}>Rename</DropdownMenu.Item>
            {groups.filter((group) => group.id !== parameter.group).map((group) => (
              <DropdownMenu.Item key={group.id} className="menu__item" onSelect={() => onMove(parameter.id, group.id)}>
                Move to {group.label}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Item className="menu__item" data-action="delete-control" onSelect={() => onDelete(parameter.id)}>Delete</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  )
}
