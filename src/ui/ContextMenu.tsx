import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useState,
  useRef,
  type MouseEvent,
  type ReactNode,
  type CSSProperties,
} from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'

export type ContextMenuItem = {
  label: string
  icon?: ReactNode
  disabled?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

type MenuEvent = Pick<MouseEvent, 'clientX' | 'clientY' | 'preventDefault' | 'stopPropagation' | 'currentTarget' | 'target'> & { keyboard?: boolean }
type OpenMenu = (event: MenuEvent, items: ContextMenuItem[], controller?: ReactNode, label?: string) => void

const ContextMenuContext = createContext<OpenMenu | null>(null)

export function ContextMenuRoot({ children }: { children: ReactNode }) {
  const returnFocus = useRef<HTMLElement | null>(null)
  const fallbackFocus = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ContextMenuItem[]>([])
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const [controller, setController] = useState<ReactNode>(null)
  const [label, setLabel] = useState('Timeline controls')

  const openMenu = useCallback<OpenMenu>((event, next, panel, panelLabel) => {
    fallbackFocus.current = event.currentTarget.closest<HTMLElement>('[tabindex]')
    const element = event.target instanceof Element ? event.target : event.currentTarget
    returnFocus.current = element instanceof Element ? element.closest<HTMLElement>('button,input,[tabindex]') ?? event.currentTarget.querySelector<HTMLElement>('button,input,[tabindex]') ?? event.currentTarget.closest<HTMLElement>('[tabindex]') : null
    event.preventDefault()
    event.stopPropagation()
    setPoint({ x: event.clientX, y: event.clientY })
    setItems(next)
    setController(panel ?? null)
    setLabel(panelLabel ?? 'Timeline controls')
    setOpen(true)
  }, [])

  return (
    <ContextMenuContext.Provider value={openMenu}>
      {children}
      {controller ? <Popover.Root modal open={open} onOpenChange={setOpen}>
        <Popover.Anchor asChild><span className="context-menu-anchor" style={{ left: point.x, top: point.y }} /></Popover.Anchor>
        <Popover.Portal><Popover.Content className="popover context-controller" aria-label={label} side="bottom" align="start" sideOffset={8} collisionPadding={8}
          onCloseAutoFocus={event => { event.preventDefault(); (returnFocus.current?.isConnected ? returnFocus.current : fallbackFocus.current)?.focus() }}
          onKeyDown={event => event.stopPropagation()}>
          {controller}
          <div className="context-controller__actions">
            {items.map((item, index) => <Fragment key={item.label}>
              {index > 0 && item.separatorBefore !== false ? <div className="menu__sep" role="separator" /> : null}
              <button type="button" className="menu__item" disabled={item.disabled} onClick={() => { item.onSelect(); setOpen(false) }}>{item.icon}{item.label}</button>
            </Fragment>)}
          </div>
        </Popover.Content></Popover.Portal>
      </Popover.Root> : <DropdownMenu.Root
        modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setItems([])
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="context-menu-anchor"
            tabIndex={-1}
            aria-hidden
            style={{ left: point.x, top: point.y }}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="menu"
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            onCloseAutoFocus={(event) => { event.preventDefault(); (returnFocus.current?.isConnected ? returnFocus.current : fallbackFocus.current)?.focus() }}
          >
            {items.map((item, index) => (
              <Fragment key={item.label}>
                {index > 0 && item.separatorBefore !== false ? <DropdownMenu.Separator className="menu__sep" /> : null}
                <DropdownMenu.Item
                  className="menu__item"
                  disabled={item.disabled}
                  onSelect={() => {
                    if (item.disabled) return
                    item.onSelect()
                  }}
                >
                  {item.icon}
                  {item.label}
                </DropdownMenu.Item>
              </Fragment>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>}
    </ContextMenuContext.Provider>
  )
}

export function ContextTarget({ items, children, label = 'Control actions', className = '', style, onOpen, touchActions = true, controller }: {
  items: ContextMenuItem[] | ((event: MenuEvent) => ContextMenuItem[])
  children: ReactNode
  label?: string
  className?: string
  style?: CSSProperties
  onOpen?: () => void
  touchActions?: boolean
  controller?: ReactNode | ((event: MenuEvent) => ReactNode)
}) {
  const openMenu = useContext(ContextMenuContext)
  if (!openMenu) return children
  const open = (event: MenuEvent) => { onOpen?.(); openMenu(event, typeof items === 'function' ? items(event) : items, typeof controller === 'function' ? controller(event) : controller, label) }
  return (
    <div className={`context-target ${className}`} style={style} onContextMenu={open} onKeyDown={event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
      const rect = (event.target as HTMLElement).getBoundingClientRect()
      open({ keyboard: true, clientX: rect.left, clientY: rect.bottom, target: event.target, currentTarget: event.currentTarget,
        preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() })
    }}>
      {children}
      {touchActions ? <button type="button" className="context-touch-trigger" aria-label={label} aria-haspopup={controller ? 'dialog' : 'menu'} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        open({ clientX: rect.left, clientY: rect.bottom, target: event.target, currentTarget: event.currentTarget,
          preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() })
      }}>•••</button> : null}
    </div>
  )
}
