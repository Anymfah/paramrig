import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { sceneIcon } from '@/scene/iconRegistry'
import { listModifiers, type ModifierCategory, type ModifierModule } from '@/scene/modifiers'
import { Exposable } from '@/scene/SceneExpose'
import { SceneMenu, type SceneMenuEntry } from '@/scene/SceneMenu'
import { SceneEmpty } from '@/scene/SceneProperties'
import type { Modifier, SceneDocument, SceneObject } from '@/scene/types'
import { IconButton } from '@/ui/Button'
import { IconChevron, IconChevronRight, IconGrip } from '@/ui/icons'
import { ParameterField } from '@/ui/ParameterField'
import { SelectField } from '@/ui/SelectField'
import { Tooltip } from '@/ui/Tooltip'

/**
 * The Modifiers tab: the stack, in the order it runs.
 *
 * A modifier is a description rather than a change, so everything here edits the object's list and
 * nothing touches the mesh — except Apply, which is the one place a description becomes geometry
 * and is therefore handed up to the editor rather than done in the panel.
 *
 * The fields are generated from each module's declared schema, exactly as the redo panel generates
 * an operator's: a modifier that gains a parameter gains a field here without a line being written.
 * The one thing the schema cannot describe is another object — the list of what is in the scene is
 * not the modifier's to know — so a parameter named in `objectInputs` is drawn from the document
 * instead, which is also what lets its options stay right as objects are added and renamed. It is
 * for the same reason the only field here without a ◇: it points at an object rather than holding a
 * value, and there is no control that could drive it.
 */

const CATEGORY_TITLES: Record<ModifierCategory, string> = {
  modify: 'Modify',
  generate: 'Generate',
  deform: 'Deform',
}

const CATEGORY_ORDER: ModifierCategory[] = ['modify', 'generate', 'deform']

export function ModifiersPanel({
  document,
  activeObject,
  selectedObjects,
  errors,
  onUpdateObject,
  onUpdateObjects,
  onApply,
  onGestureStart,
  onGestureEnd,
  isOpen,
  onSection,
}: {
  document: SceneDocument
  activeObject: SceneObject | null
  selectedObjects: SceneObject[]
  /** What the stack refused to do, by modifier id, as the evaluated mesh reported it. */
  errors: Array<{ modifierId: string; message: string }>
  onUpdateObject: (id: string, patch: Partial<SceneObject>, label?: string) => void
  onUpdateObjects: (patches: Array<{ id: string; patch: Partial<SceneObject> }>, label?: string) => void
  /** Writes a modifier's result into the mesh and drops it from the stack, through the operator. */
  onApply: (modifierId: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}) {
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null)
  const dragging = useRef<number | null>(null)

  if (!activeObject) {
    return <div className="scene-properties__notice"><SceneEmpty>Nothing is active. Select an object to give it a modifier.</SceneEmpty></div>
  }
  if (activeObject.kind !== 'mesh') {
    return (
      <div className="scene-properties__notice">
        <SceneEmpty>{`${activeObject.name} is not a mesh, and only meshes take modifiers.`}</SceneEmpty>
      </div>
    )
  }

  const stack = activeObject.modifiers
  const write = (next: Modifier[], label: string) => onUpdateObject(activeObject.id, { modifiers: next }, label)
  const patch = (id: string, change: Partial<Modifier>, label: string) => {
    write(stack.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)), label)
  }
  const move = (from: number, to: number, label: string) => {
    if (from === to || to < 0 || to >= stack.length) return
    const next = [...stack]
    const [taken] = next.splice(from, 1)
    if (taken) next.splice(to, 0, taken)
    write(next, label)
  }

  const add = (module: ModifierModule) => {
    const modifier: Modifier = {
      id: `modifier-${crypto.randomUUID()}`,
      kind: module.kind,
      name: uniqueName(module.label, stack),
      enabled: { viewport: true, render: true, editMode: true, onCage: false },
      params: { ...module.defaults },
    }
    write([...stack, modifier], `Add ${module.label.toLowerCase()}`)
    onSection(`modifier-${modifier.id}`, true)
  }

  const addEntries: SceneMenuEntry[] = CATEGORY_ORDER.flatMap((category) => {
    const modules = listModifiers(category).sort((first, second) => first.label.localeCompare(second.label))
    if (modules.length === 0) return []
    return [
      { heading: CATEGORY_TITLES[category] },
      ...modules.map((module) => ({
        id: `add-${module.kind}`,
        label: module.label,
        icon: module.icon ?? `modifier-${module.kind}`,
        run: () => add(module),
      })),
    ]
  })

  return (
    <div className="scene-modifiers">
      <div className="scene-modifiers__add">
        <SceneMenu label="Add modifier" entries={addEntries} icon="modifier" className="scene-modifiers__add-menu" />
      </div>
      {stack.length === 0 ? (
        <SceneEmpty>No modifiers. One added here describes what the mesh becomes without changing what it is.</SceneEmpty>
      ) : (
        <ol className="scene-modifiers__list">
          {stack.map((modifier, index) => (
            <li
              key={modifier.id}
              className="scene-modifier"
              data-drop={drop?.index === index ? (drop.after ? 'after' : 'before') : undefined}
              onDragOver={(event: DragEvent<HTMLLIElement>) => {
                if (dragging.current === null) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const box = event.currentTarget.getBoundingClientRect()
                const after = event.clientY > box.top + box.height / 2
                if (drop?.index !== index || drop.after !== after) setDrop({ index, after })
              }}
              onDragLeave={(event: DragEvent<HTMLLIElement>) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrop(null)
              }}
              onDrop={(event: DragEvent<HTMLLIElement>) => {
                event.preventDefault()
                const from = dragging.current
                dragging.current = null
                setDrop(null)
                if (from === null) return
                const box = event.currentTarget.getBoundingClientRect()
                let to = index + (event.clientY > box.top + box.height / 2 ? 1 : 0)
                if (from < to) to -= 1
                move(from, to, 'Reorder modifiers')
              }}
            >
              <ModifierCard
                modifier={modifier}
                index={index}
                count={stack.length}
                document={document}
                object={activeObject}
                error={errors.find((entry) => entry.modifierId === modifier.id)?.message}
                open={isOpen(`modifier-${modifier.id}`)}
                onOpen={(open) => onSection(`modifier-${modifier.id}`, open)}
                onDragStart={(event) => {
                  dragging.current = index
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', String(index))
                }}
                onDragEnd={() => {
                  dragging.current = null
                  setDrop(null)
                }}
                onPatch={(change, label) => patch(modifier.id, change, label)}
                onMove={(to, label) => move(index, to, label)}
                onRemove={() => write(stack.filter((entry) => entry.id !== modifier.id), `Remove ${modifier.name.toLowerCase()}`)}
                onDuplicate={() => {
                  const copy: Modifier = {
                    ...modifier,
                    id: `modifier-${crypto.randomUUID()}`,
                    name: uniqueName(modifier.name, stack),
                    params: { ...modifier.params },
                  }
                  const next = [...stack]
                  next.splice(index + 1, 0, copy)
                  write(next, `Duplicate ${modifier.name.toLowerCase()}`)
                }}
                onCopyToSelected={() => {
                  const others = selectedObjects.filter((object) => object.id !== activeObject.id && object.kind === 'mesh')
                  if (others.length === 0) return
                  onUpdateObjects(others.map((object) => ({
                    id: object.id,
                    patch: {
                      modifiers: [...object.modifiers, {
                        ...modifier,
                        id: `modifier-${crypto.randomUUID()}`,
                        params: { ...modifier.params },
                      }],
                    },
                  })), `Copy ${modifier.name.toLowerCase()} to selected`)
                }}
                canCopy={selectedObjects.some((object) => object.id !== activeObject.id && object.kind === 'mesh')}
                onApply={() => onApply(modifier.id)}
                onGestureStart={onGestureStart}
                onGestureEnd={onGestureEnd}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** One modifier: its header of switches, its ⋯ menu, and the fields its module declares. */
function ModifierCard({
  modifier,
  index,
  count,
  document: scene,
  object,
  error,
  open,
  onOpen,
  onDragStart,
  onDragEnd,
  onPatch,
  onMove,
  onRemove,
  onDuplicate,
  onCopyToSelected,
  canCopy,
  onApply,
  onGestureStart,
  onGestureEnd,
}: {
  modifier: Modifier
  index: number
  count: number
  document: SceneDocument
  object: SceneObject
  error: string | undefined
  open: boolean
  onOpen: (open: boolean) => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onPatch: (change: Partial<Modifier>, label: string) => void
  onMove: (to: number, label: string) => void
  onRemove: () => void
  onDuplicate: () => void
  onCopyToSelected: () => void
  canCopy: boolean
  onApply: () => void
  onGestureStart: () => void
  onGestureEnd: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const module = getModule(modifier)
  const Glyph = sceneIcon(module?.icon ?? `modifier-${modifier.kind}`) ?? sceneIcon('modifier')
  const bodyId = `modifier-body-${modifier.id}`
  const toggle = (key: keyof Modifier['enabled'], label: string) => {
    onPatch({ enabled: { ...modifier.enabled, [key]: !modifier.enabled[key] } }, label)
  }

  const menu: SceneMenuEntry[] = [
    { id: 'apply', label: 'Apply', shortcut: '⌃A', disabled: index > 0, reason: index > 0 ? 'Apply the modifier above this one first.' : undefined, run: onApply },
    { id: 'duplicate', label: 'Duplicate', run: onDuplicate },
    { id: 'copy', label: 'Copy to selected', disabled: !canCopy, reason: 'No other mesh is selected.', run: onCopyToSelected },
    { separator: true },
    { id: 'first', label: 'Move to first', disabled: index === 0, run: () => onMove(0, 'Move modifier first') },
    { id: 'up', label: 'Move up', disabled: index === 0, run: () => onMove(index - 1, 'Move modifier up') },
    { id: 'down', label: 'Move down', disabled: index === count - 1, run: () => onMove(index + 1, 'Move modifier down') },
    { id: 'last', label: 'Move to last', disabled: index === count - 1, run: () => onMove(count - 1, 'Move modifier last') },
    { separator: true },
    { id: 'remove', label: 'Delete', shortcut: '⌃X', run: onRemove },
  ]

  return (
    <div
      className="scene-modifier__card"
      data-open={open}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'x') return
        event.preventDefault()
        onRemove()
      }}
    >
      <div
        className="scene-modifier__head"
        draggable={count > 1 && !renaming}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        {count > 1 ? <span className="scene-modifier__grip" aria-hidden="true"><IconGrip /></span> : null}
        <button
          type="button"
          className="scene-modifier__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onOpen(!open)}
        >
          <span className="scene-modifier__glyph">{Glyph ? <Glyph /> : null}</span>
          {open ? <IconChevron /> : <IconChevronRight />}
        </button>
        {renaming ? (
          <input
            className="scene-modifier__name"
            defaultValue={modifier.name}
            aria-label="Modifier name"
            autoFocus
            onBlur={(event) => {
              const name = event.target.value.trim()
              setRenaming(false)
              if (name && name !== modifier.name) onPatch({ name }, 'Rename modifier')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key !== 'Escape') return
              event.currentTarget.value = modifier.name
              event.currentTarget.blur()
            }}
          />
        ) : (
          <button type="button" className="scene-modifier__label" onDoubleClick={() => setRenaming(true)} onClick={() => onOpen(!open)}>
            {modifier.name}
          </button>
        )}
        <div className="scene-modifier__switches">
          <StackSwitch
            on={modifier.enabled.editMode}
            label={`Show ${modifier.name} in edit mode`}
            tip="Show in edit mode"
            glyph="modifier-edit-mode"
            onToggle={() => toggle('editMode', 'Modifier in edit mode')}
          />
          <StackSwitch
            on={modifier.enabled.onCage}
            label={`Edit ${modifier.name} on the result`}
            tip="Edit on the result"
            glyph="modifier-on-cage"
            onToggle={() => toggle('onCage', 'Modifier on cage')}
          />
          <StackSwitch
            on={modifier.enabled.viewport}
            label={`Show ${modifier.name} in the viewport`}
            tip="Show in the viewport"
            glyph={modifier.enabled.viewport ? 'eye-open' : 'eye-closed'}
            onToggle={() => toggle('viewport', 'Modifier in the viewport')}
          />
          <StackSwitch
            on={modifier.enabled.render}
            label={`Use ${modifier.name} when rendering`}
            tip="Use when rendering"
            glyph={modifier.enabled.render ? 'render-on' : 'render-off'}
            onToggle={() => toggle('render', 'Modifier when rendering')}
          />
          <SceneMenu label={`${modifier.name} actions`} entries={menu} variant="chevron" />
        </div>
      </div>
      {open ? (
        <div className="scene-modifier__body" id={bodyId}>
          {error ? <p className="scene-modifier__error" role="alert">{error}</p> : null}
          {!module ? (
            <SceneEmpty>{`“${modifier.kind}” is not a modifier this build has, so it is skipped.`}</SceneEmpty>
          ) : (
            module.schema.map((param) => {
              const value = modifier.params[param.id] ?? param.defaultValue
              if (module.objectInputs?.includes(param.id)) {
                return (
                  <SelectField
                    key={param.id}
                    label={param.label}
                    value={typeof value === 'string' ? value : ''}
                    options={objectOptions(scene, object)}
                    onChange={(next) => onPatch({ params: { ...modifier.params, [param.id]: next } }, `${param.label} of ${modifier.name.toLowerCase()}`)}
                  />
                )
              }
              return (
                // The bounds the popover starts from are the module's own, read back off the path.
                <Exposable key={param.id} property={`modifiers[${modifier.id}].${param.id}`} objectId={object.id}>
                  <ParameterField
                    param={param}
                    value={value}
                    onChange={(next) => onPatch(
                      { params: { ...modifier.params, [param.id]: next as Modifier['params'][string] } },
                      `${param.label} of ${modifier.name.toLowerCase()}`,
                    )}
                    onGestureStart={onGestureStart}
                    onGestureEnd={onGestureEnd}
                  />
                </Exposable>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}

/** One of the four square switches in a modifier's header. */
function StackSwitch({ on, label, tip, glyph, onToggle }: {
  on: boolean
  label: string
  tip: string
  glyph: string
  onToggle: () => void
}) {
  const Glyph = sceneIcon(glyph)
  return (
    <Tooltip content={tip}>
      <IconButton label={label} aria-pressed={on} className="scene-modifier__switch" data-on={on || undefined} onClick={onToggle}>
        {Glyph ? <Glyph /> : null}
      </IconButton>
    </Tooltip>
  )
}

function getModule(modifier: Modifier): ModifierModule | undefined {
  return listModifiers().find((module) => module.kind === modifier.kind)
}

/** The objects a modifier may read: anything but the one it is on, and never a child of it. */
function objectOptions(document: SceneDocument, object: SceneObject): Array<{ value: string; label: string }> {
  const options = document.objects
    .filter((candidate) => candidate.id !== object.id && candidate.parentId !== object.id)
    .map((candidate) => ({ value: candidate.id, label: candidate.name }))
  return [{ value: '', label: 'None' }, ...options]
}

/** “Mirror”, then “Mirror.001”, as Blender numbers a second one. */
function uniqueName(wanted: string, stack: Modifier[]): string {
  const taken = new Set(stack.map((modifier) => modifier.name))
  if (!taken.has(wanted)) return wanted
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const name = `${wanted}.${String(suffix).padStart(3, '0')}`
    if (!taken.has(name)) return name
  }
  return wanted
}
