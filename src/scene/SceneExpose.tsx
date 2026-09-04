import { useState, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { bindingFor, useSceneExpose, type SceneExposeContextValue } from '@/scene/exposeContext'
import {
  kindForSceneProperty,
  modifierParameter,
  parseSceneProperty,
  scenePropertyLabel,
  scenePropertyType,
  type SceneBinding,
} from '@/scene/rig'
import { Button, IconButton } from '@/ui/Button'
import { IconDiamond } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { Tooltip } from '@/ui/Tooltip'

/**
 * A field of the properties editor, with the ◇ that turns it into a control.
 *
 * The diamond is quiet until the row is hovered and stays lit once the field is driven, so a driven
 * field is legible at a glance and an undriven one does not shout. It is the same gesture as the
 * drawing editor's, deliberately: a person who has exposed a rectangle's width should not have to
 * learn a second way to expose a cube's subdivision.
 *
 * Everything it needs comes from one context. Without a provider — a panel in a test, a panel in
 * the Tune preview — it draws the field alone and nothing else changes.
 */
export function Exposable({ property, objectId, label, min, max, step, children }: {
  property: string
  /** The object the property belongs to; scene-wide properties leave it out. */
  objectId?: string
  /** Overrides the name the control is offered, when the property alone does not say enough. */
  label?: string
  min?: number
  max?: number
  step?: number
  children: ReactNode
}) {
  const context = useSceneExpose()
  const [dropping, setDropping] = useState(false)
  if (!context) return <>{children}</>
  const path = parseSceneProperty(property)
  if (!path) return <>{children}</>
  // A property that belongs to an object cannot be exposed without knowing which.
  if (path.scoped && !objectId) return <>{children}</>
  const target = { ...(objectId ? { objectId } : {}), property }
  const binding = bindingFor(context, target)

  return (
    <div
      className="scene-exposable"
      data-bound={binding ? true : undefined}
      data-dropping={dropping || undefined}
      onDragOver={context.onDropParameter ? (event) => {
        if (!event.dataTransfer.types.includes('application/x-paramrig-parameter')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'link'
        setDropping(true)
      } : undefined}
      onDragLeave={() => setDropping(false)}
      onDrop={context.onDropParameter ? (event) => {
        const parameterId = event.dataTransfer.getData('application/x-paramrig-parameter')
        setDropping(false)
        if (!parameterId) return
        event.preventDefault()
        context.onDropParameter?.(parameterId, target)
      } : undefined}
    >
      <div className="scene-exposable__field">{children}</div>
      {binding ? (
        <BoundMenu binding={binding} context={context} />
      ) : (
        <ExposeButton context={context} target={target} label={label} min={min} max={max} step={step} />
      )}
    </div>
  )
}

function BoundMenu({ binding, context }: { binding: SceneBinding; context: SceneExposeContextValue }) {
  const name = context.parameters.find((parameter) => parameter.id === binding.parameterId)?.label ?? binding.parameterId
  const what = scenePropertyLabel(context.document, binding)
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content={`Driven by ${name}`}>
        <DropdownMenu.Trigger asChild>
          <IconButton label={`${what} is driven by ${name}`} className="scene-expose scene-expose--bound"><IconDiamond /></IconButton>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" side="left" align="start" sideOffset={6} collisionPadding={8} aria-label="Binding">
          <DropdownMenu.Item className="menu__item" onSelect={() => context.onGoToControl(binding)}>Go to control</DropdownMenu.Item>
          <DropdownMenu.Item className="menu__item" data-action="unbind" onSelect={() => context.onUnbind(binding)}>Unbind</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const NEW_GROUP = '__new__'

/**
 * The popover that makes a control.
 *
 * Everything in it is prefilled from what is already known — the name from the object and the
 * property, the kind from the property's type, the bounds from whatever declared them (a
 * modifier's own schema knows better than any guess) — so that exposing a field is usually one
 * press of Expose rather than a form.
 */
function ExposeButton({ context, target, label, min, max, step }: {
  context: SceneExposeContextValue
  target: { objectId?: string; property: string }
  label?: string
  min?: number
  max?: number
  step?: number
}) {
  const suggested = label ? `${label}` : scenePropertyLabel(context.document, target)
  const declared = declaredRange(context, target)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(suggested)
  const [group, setGroup] = useState(context.groups[0]?.id ?? NEW_GROUP)
  const [groupLabel, setGroupLabel] = useState('Main')
  const [range, setRange] = useState({
    min: min ?? declared.min ?? 0,
    max: max ?? declared.max ?? 10,
    step: step ?? declared.step ?? 0.1,
  })
  const type = scenePropertyType(context.document, target)
  if (!type) return null
  const kind = kindForSceneProperty(type)

  const submit = () => {
    context.onExpose({
      ...target,
      label: name.trim() || suggested,
      group: group === NEW_GROUP ? (groupLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'main') : group,
      ...(group === NEW_GROUP ? { newGroupLabel: groupLabel.trim() || 'Main' } : {}),
      ...(kind === 'number' ? range : {}),
    })
    setOpen(false)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setName(suggested)
      }}
    >
      <Tooltip content="Expose as control">
        <Popover.Trigger asChild>
          <IconButton label={`Expose ${suggested} as a control`} className="scene-expose"><IconDiamond /></IconButton>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content className="popover scene-expose-popover" side="left" align="start" sideOffset={10} collisionPadding={8} aria-label="Expose as control">
          <p className="scene-expose-popover__title">Expose as control</p>
          <label className="scene-expose-popover__row">
            <span>Name</span>
            <input
              value={name}
              maxLength={80}
              spellCheck={false}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
            />
          </label>
          <div className="scene-expose-popover__row">
            <span>Kind</span>
            <span className="scene-expose-popover__kind">{kind}</span>
          </div>
          <SelectField
            label="Group"
            value={group}
            options={[...context.groups.map((item) => ({ value: item.id, label: item.label })), { value: NEW_GROUP, label: 'New group' }]}
            onChange={setGroup}
          />
          {group === NEW_GROUP ? (
            <label className="scene-expose-popover__row">
              <span>Group name</span>
              <input value={groupLabel} maxLength={60} spellCheck={false} onChange={(event) => setGroupLabel(event.target.value)} />
            </label>
          ) : null}
          {kind === 'number' ? (
            <div className="scene-expose-popover__grid">
              <NumberField label="Min" value={range.min} min={-100000} max={100000} step={0.1} variant="field" onChange={(value) => setRange((current) => ({ ...current, min: value }))} />
              <NumberField label="Max" value={range.max} min={-100000} max={100000} step={0.1} variant="field" onChange={(value) => setRange((current) => ({ ...current, max: value }))} />
              <NumberField label="Step" value={range.step} min={0} max={1000} step={0.01} variant="field" onChange={(value) => setRange((current) => ({ ...current, step: value }))} />
            </div>
          ) : null}
          <Button variant="solid" size="sm" data-action="expose" onClick={submit}>Expose</Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** What the property itself says its bounds are: a modifier's schema, or nothing. */
function declaredRange(
  context: SceneExposeContextValue,
  target: { objectId?: string; property: string },
): { min?: number; max?: number; step?: number } {
  const path = parseSceneProperty(target.property)
  if (path?.kind !== 'modifier') return {}
  const declared = modifierParameter(context.document, target.objectId, path.modifierId, path.param)
  if (declared?.kind !== 'number') return {}
  return { min: declared.min, max: declared.max, step: declared.step }
}
