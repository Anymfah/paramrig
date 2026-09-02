import { createContext, useContext, useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Button, IconButton } from '@/ui/Button'
import { IconDiamond } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { Tooltip } from '@/ui/Tooltip'
import type { ParameterDef, ParamGroup } from '@/rigs/types'
import { kindForProperty, parseBindableProperty, propertyLabel, type VectorBinding } from '@/vector/rig'

/** What is asked for when a field is turned into a control. */
export type ExposeRequest = {
  elementId: string
  property: string
  label: string
  group: string
  newGroupLabel?: string
  min?: number
  max?: number
  step?: number
}

type ExposeContextValue = {
  /** The object whose fields are on screen; null when several are selected. */
  elementId: string | null
  /** The name of that object, used to prefill a control's label. */
  elementName: string
  groups: ParamGroup[]
  /** The controls the document declares, so a bound field can name the one driving it. */
  parameters: ParameterDef[]
  bindings: VectorBinding[]
  onExpose: (request: ExposeRequest) => void
  onUnbind: (binding: VectorBinding) => void
  onGoToControl: (binding: VectorBinding) => void
  /** A control dragged from the Controls tab and dropped on a field. */
  onDropParameter?: (parameterId: string, elementId: string, property: string) => void
}

const ExposeContext = createContext<ExposeContextValue | null>(null)

export function ExposeProvider({ value, children }: { value: ExposeContextValue | null; children: ReactNode }) {
  return <ExposeContext.Provider value={value}>{children}</ExposeContext.Provider>
}

/**
 * A field of the Design tab, with the ◇ that turns it into a control. The diamond is quiet until
 * the line is hovered, and stays lit once the field is driven — so a driven field is legible at a
 * glance, and an undriven one does not shout.
 */
export function Exposable({ property, label, min, max, step, children }: {
  property: string
  /** Overrides the name the control is offered, when the property alone does not say enough. */
  label?: string
  min?: number
  max?: number
  step?: number
  children: ReactNode
}) {
  const context = useContext(ExposeContext)
  const [dropping, setDropping] = useState(false)
  if (!context || !context.elementId) return <>{children}</>
  const elementId = context.elementId
  const binding = context.bindings.find((item) => item.elementId === elementId && item.property === property) ?? null
  return (
    <div
      className="vector-exposable"
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
        context.onDropParameter?.(parameterId, elementId, property)
      } : undefined}
    >
      <div className="vector-exposable__field">{children}</div>
      {binding ? (
        <BoundMenu binding={binding} context={context} />
      ) : (
        <ExposeButton context={context} property={property} label={label} min={min} max={max} step={step} />
      )}
    </div>
  )
}

function BoundMenu({ binding, context }: { binding: VectorBinding; context: ExposeContextValue }) {
  const name = context.parameters.find((parameter) => parameter.id === binding.parameterId)?.label ?? binding.parameterId
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content={`Driven by ${name}`}>
        <DropdownMenu.Trigger asChild>
          <IconButton label={`${propertyLabel(binding.property)} is driven by ${name}`} className="vector-expose vector-expose--bound"><IconDiamond /></IconButton>
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

function ExposeButton({ context, property, label, min, max, step }: {
  context: ExposeContextValue
  property: string
  label?: string
  min?: number
  max?: number
  step?: number
}) {
  const [open, setOpen] = useState(false)
  const path = parseBindableProperty(property)
  const suggested = `${context.elementName} · ${label ?? propertyLabel(property)}`
  const [name, setName] = useState(suggested)
  const [group, setGroup] = useState(context.groups[0]?.id ?? NEW_GROUP)
  const [groupLabel, setGroupLabel] = useState('Main')
  const [range, setRange] = useState({ min: min ?? 0, max: max ?? 100, step: step ?? 1 })
  if (!path) return null
  const kind = kindForProperty(path.type)
  const submit = () => {
    context.onExpose({
      elementId: context.elementId!,
      property,
      label: name.trim() || suggested,
      group: group === NEW_GROUP ? groupLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'main' : group,
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
          <IconButton label={`Expose ${label ?? propertyLabel(property)} as a control`} className="vector-expose"><IconDiamond /></IconButton>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content className="popover vector-expose-popover" side="left" align="start" sideOffset={10} collisionPadding={8} aria-label="Expose as control">
          <p className="vector-expose-popover__title">Expose as control</p>
          <label className="vector-expose-popover__row">
            <span>Name</span>
            <input value={name} maxLength={80} spellCheck={false} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} />
          </label>
          <div className="vector-expose-popover__row">
            <span>Kind</span>
            <span className="vector-expose-popover__kind">{kind}</span>
          </div>
          <SelectField
            label="Group"
            value={group}
            options={[...context.groups.map((item) => ({ value: item.id, label: item.label })), { value: NEW_GROUP, label: 'New group' }]}
            onChange={setGroup}
          />
          {group === NEW_GROUP ? (
            <label className="vector-expose-popover__row">
              <span>Group name</span>
              <input value={groupLabel} maxLength={60} spellCheck={false} onChange={(event) => setGroupLabel(event.target.value)} />
            </label>
          ) : null}
          {kind === 'number' ? (
            <div className="vector-field-grid">
              <NumberField label="Min" value={range.min} min={-100000} max={100000} step={1} variant="field" onChange={(value) => setRange((current) => ({ ...current, min: value }))} />
              <NumberField label="Max" value={range.max} min={-100000} max={100000} step={1} variant="field" onChange={(value) => setRange((current) => ({ ...current, max: value }))} />
              <NumberField label="Step" value={range.step} min={0} max={1000} step={0.1} variant="field" onChange={(value) => setRange((current) => ({ ...current, step: value }))} />
            </div>
          ) : null}
          <Button variant="solid" size="sm" data-action="expose" onClick={submit}>Expose</Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
