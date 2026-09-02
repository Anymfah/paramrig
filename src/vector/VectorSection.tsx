import { useId, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { IconButton } from '@/ui/Button'
import { IconChevron, IconMore, IconPlus } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { useSectionState } from '@/vector/useSectionState'

export type SectionMenuItem = { label: string; disabled?: boolean; onSelect: () => void }

/**
 * The one section header of the inspector: a chevron, a title, whatever counts, a `+` when the
 * section is a list, and a ⋯ for the actions that are used once in a while. Everything the
 * inspector shows sits under one of these, so no panel invents its own heading.
 */
export function VectorSection({ id, title, meta, addLabel, onAdd, addDisabled, menu, actions, defaultOpen = true, children }: {
  id: string
  title: string
  /** What the section counts, shown quietly next to the title. */
  meta?: ReactNode
  addLabel?: string
  onAdd?: () => void
  addDisabled?: boolean
  menu?: SectionMenuItem[]
  /** Controls that belong in the header itself, such as the align row of Position. */
  actions?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useSectionState(id, defaultOpen)
  const panelId = useId()
  return (
    <section className="vector-section" data-open={open} data-section={id} aria-label={title}>
      <div className="vector-section__head">
        <button
          type="button"
          className="vector-section__title"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <IconChevron />
          <span>{title}</span>
        </button>
        {meta ? <span className="vector-section__meta">{meta}</span> : null}
        {actions ? <div className="vector-section__actions">{actions}</div> : null}
        {onAdd ? (
          <Tooltip content={addLabel ?? `Add to ${title.toLowerCase()}`}>
            <IconButton label={addLabel ?? `Add to ${title.toLowerCase()}`} disabled={addDisabled} onClick={onAdd}><IconPlus /></IconButton>
          </Tooltip>
        ) : null}
        {menu && menu.length > 0 ? (
          <DropdownMenu.Root modal={false}>
            <Tooltip content={`${title} actions`}>
              <DropdownMenu.Trigger asChild>
                <IconButton label={`${title} actions`}><IconMore /></IconButton>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu vector-section__menu" side="bottom" align="end" sideOffset={6} collisionPadding={8} aria-label={`${title} actions`}>
                {menu.map((item) => (
                  <DropdownMenu.Item key={item.label} className="menu__item" disabled={item.disabled} onSelect={item.onSelect}>
                    {item.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : null}
      </div>
      <div className="vector-section__panel" id={panelId} inert={!open} aria-hidden={!open}>
        <div className="vector-section__body">{children}</div>
      </div>
    </section>
  )
}

/** One 32 px line of a list: a swatch or icon, a label, a control or two, and the way out. */
export function VectorRow({ className, children, ...dataset }: { className?: string; children: ReactNode } & Record<string, unknown>) {
  const attributes = Object.fromEntries(Object.entries(dataset).filter(([key]) => key.startsWith('data-') || key === 'role'))
  return <div className={`vector-row ${className ?? ''}`.trim()} {...attributes}>{children}</div>
}

/** What a section says when it holds nothing yet: what it is for, and the way to start. */
export function VectorEmpty({ children }: { children: ReactNode }) {
  return <p className="vector-empty">{children}</p>
}
