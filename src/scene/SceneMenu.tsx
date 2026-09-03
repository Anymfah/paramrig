import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { sceneIcon } from '@/scene/iconRegistry'
import { IconCheck, IconChevron } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

/**
 * A dropdown built out of commands, filtered by typing.
 *
 * Blender 4 filters every open menu as the letters arrive, and it is the fastest way to reach
 * anything in an editor with several hundred operators: the eye finds "Frame selected" in the View
 * menu, and the hand finds it by typing "fr". The list is therefore not a list of buttons but a
 * list of *commands*, which is what lets one component serve the header menus, the right-click menu
 * at the pointer, and the view-state choosers, without any of them being written twice.
 *
 * It is hand-rolled rather than built on Radix's `DropdownMenu` for one reason: Radix's typeahead
 * jumps the highlight to a matching entry, and this one has to hide the entries that do not match.
 * The rest — the portal, the placement, the outside click, the focus that goes back where it came
 * from — is the small price of that, and the panel still wears the `menu` classes so it cannot
 * drift away from every other menu in the application.
 */

/**
 * What an entry has to carry. `SceneCommand` from `@/scene/commands` satisfies it, which is the
 * point: the header hands `menuEntries` straight in. It is declared structurally rather than
 * imported so that a menu of view-state choices — a pivot point is not an operator — can be built
 * out of the same component without inventing a command for it.
 */
export type SceneMenuCommand = {
  id: string
  label: string
  shortcut?: string
  /** A name in `@/scene/iconRegistry`. */
  icon?: string
  disabled?: boolean
  /** Why it cannot run, shown in the entry's tooltip rather than left to guess at. */
  reason?: string
  /** Set on an entry that stands for a setting: it draws a mark and reads as one. */
  checked?: boolean
  /** How that mark reads. Defaults to a one-of choice, which is what most of these menus are. */
  choice?: 'radio' | 'check'
  run: () => void
}

export type SceneMenuEntry = SceneMenuCommand | { separator: true }

/** How the trigger draws: a named menu, an icon that shows the current choice, or a lone chevron. */
export type SceneMenuVariant = 'text' | 'icon' | 'chevron'

const EDGE_PADDING = 8

function isCommand(entry: SceneMenuEntry): entry is SceneMenuCommand {
  return !('separator' in entry)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/**
 * The entries a query leaves, best match first.
 *
 * A label that starts with what was typed comes before one that merely contains it, and a shortcut
 * match comes last: typing "e" in the Mesh menu should offer Extrude before it offers anything
 * bound to E. Separators are dropped while filtering, because the groups they divide no longer
 * exist once the list has been cut down.
 */
function filterEntries(entries: SceneMenuEntry[], query: string): SceneMenuEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return entries
  const scored: Array<{ entry: SceneMenuCommand; score: number }> = []
  for (const entry of entries) {
    if (!isCommand(entry)) continue
    const label = entry.label.toLowerCase()
    if (label.startsWith(needle)) scored.push({ entry, score: 0 })
    else if (label.includes(needle)) scored.push({ entry, score: 1 })
    else if ((entry.shortcut ?? '').toLowerCase().includes(needle)) scored.push({ entry, score: 2 })
  }
  return scored.sort((a, b) => a.score - b.score).map((match) => match.entry)
}

function MenuItem({ command, highlighted, onHighlight, onRun }: {
  command: SceneMenuCommand
  highlighted: boolean
  onHighlight: () => void
  onRun: (command: SceneMenuCommand) => void
}) {
  const Icon = sceneIcon(command.icon)
  const choice = command.choice ?? (command.checked === undefined ? undefined : 'radio')
  const role = choice === 'check' ? 'menuitemcheckbox' : choice === 'radio' ? 'menuitemradio' : 'menuitem'
  // Disabled through aria rather than the attribute: a greyed entry has to stay reachable, or the
  // reason it is greyed can only be read with a mouse.
  const item = (
    <button
      type="button"
      role={role}
      className="menu__item scene-menu__item"
      data-scene-menu-item=""
      tabIndex={-1}
      aria-disabled={command.disabled || undefined}
      aria-checked={choice ? Boolean(command.checked) : undefined}
      data-highlighted={highlighted || undefined}
      data-disabled={command.disabled || undefined}
      onPointerEnter={onHighlight}
      onClick={() => onRun(command)}
    >
      {choice ? <span className="scene-menu__mark">{command.checked ? <IconCheck /> : null}</span> : null}
      {Icon ? <Icon className="scene-menu__glyph" /> : null}
      <span className="scene-menu__label">{command.label}</span>
      {/* The space is deliberate. A flex container drops a white-space-only child, so nothing is
          drawn, but the name a screen reader reads becomes "All A" rather than "AllA". */}
      {command.shortcut ? <>{' '}<kbd className="scene-menu__key">{command.shortcut}</kbd></> : null}
    </button>
  )
  if (!command.disabled || !command.reason) return item
  return <Tooltip content={command.reason} side="right" instant block>{item}</Tooltip>
}

export function SceneMenu({
  label,
  entries,
  at,
  open,
  onOpenChange,
  icon,
  shortcut,
  variant = 'text',
  className,
}: {
  label: string
  entries: SceneMenuEntry[]
  /** Opens at the pointer instead of under a button, for the right-click menu. */
  at?: { x: number; y: number }
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** A name in `@/scene/iconRegistry`, drawn in the trigger. */
  icon?: string
  /** The chord the tooltip carries. */
  shortcut?: string
  variant?: SceneMenuVariant
  className?: string
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnRef = useRef<HTMLElement | null>(null)
  const isOpen = open ?? ownOpen
  const pointX = at?.x
  const pointY = at?.y

  useEffect(() => setMounted(true), [])

  const shown = useMemo(() => filterEntries(entries, query), [entries, query])
  const commands = useMemo(() => shown.filter(isCommand), [shown])
  const order = useMemo(() => new Map(commands.map((command, position) => [command, position])), [commands])

  const setOpen = useCallback((next: boolean) => {
    if (next && document.activeElement instanceof HTMLElement) returnRef.current = document.activeElement
    if (open === undefined) setOwnOpen(next)
    onOpenChange?.(next)
    if (next) return
    // Escape and a chosen entry both leave the keyboard where it was, never on the document body.
    const back = triggerRef.current ?? returnRef.current
    if (back?.isConnected) back.focus()
  }, [onOpenChange, open])

  // Cleared on the way out rather than on the way in, so that the opening frame starts from a
  // clean state. A reset that ran after opening would undo the placement the layout effect had
  // just worked out, and the panel would be measured, positioned and then hidden again.
  useEffect(() => {
    if (isOpen) return
    setQuery('')
    setIndex(0)
    setPlacement(null)
  }, [isOpen])

  // Placed after the panel has a size, so a menu near the right edge folds back instead of
  // hanging off it. Until then it is transparent rather than hidden: a hidden element cannot
  // take the focus, and the focus arrives on the same frame.
  useLayoutEffect(() => {
    if (!isOpen) return
    const panel = panelRef.current
    if (!panel) return
    const size = panel.getBoundingClientRect()
    const viewWidth = document.documentElement.clientWidth || window.innerWidth
    const viewHeight = document.documentElement.clientHeight || window.innerHeight
    const anchor = triggerRef.current?.getBoundingClientRect()
    const x = pointX ?? anchor?.left ?? 0
    const y = pointY ?? (anchor ? anchor.bottom + 4 : 0)
    setPlacement({
      left: clamp(x, EDGE_PADDING, Math.max(EDGE_PADDING, viewWidth - size.width - EDGE_PADDING)),
      top: clamp(y, EDGE_PADDING, Math.max(EDGE_PADDING, viewHeight - size.height - EDGE_PADDING)),
    })
  }, [isOpen, mounted, pointX, pointY, query, commands.length])

  useEffect(() => {
    if (!isOpen) return
    const items = panelRef.current?.querySelectorAll<HTMLElement>('[data-scene-menu-item]')
    if (!items || items.length === 0) {
      panelRef.current?.focus()
      return
    }
    items[Math.min(index, items.length - 1)]?.focus()
  }, [isOpen, mounted, index, query, commands.length])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [isOpen, setOpen])

  const run = useCallback((command: SceneMenuCommand) => {
    if (command.disabled) return
    setOpen(false)
    command.run()
  }, [setOpen])

  const step = useCallback((delta: number) => {
    setIndex((current) => (commands.length === 0 ? 0 : (current + delta + commands.length) % commands.length))
  }, [commands.length])

  const runHighlighted = () => {
    const command = commands[index]
    if (command) run(command)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Stopped here so the viewport's own Escape does not also fire and cancel a session.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    // Taken here rather than left to the focused entry's own activation: preventing the default
    // cancels the click that would otherwise follow, so an entry cannot run twice.
    if (event.key === 'Enter') { event.preventDefault(); runHighlighted(); return }
    if (event.key === ' ') {
      event.preventDefault()
      // A space reaches the filter once there is one; on an empty query it still runs the entry,
      // the way a space on a focused button does everywhere else.
      if (query) { setQuery((current) => `${current} `); setIndex(0) } else runHighlighted()
      return
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); step(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); step(-1); return }
    if (event.key === 'Home') { event.preventDefault(); setIndex(0); return }
    if (event.key === 'End') { event.preventDefault(); setIndex(Math.max(0, commands.length - 1)); return }
    if (event.key === 'Backspace') { event.preventDefault(); setQuery((current) => current.slice(0, -1)); setIndex(0); return }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      setQuery((current) => current + event.key)
      setIndex(0)
    }
  }

  const tooltip = shortcut ? `${label} · ${shortcut}` : label

  const trigger = at ? null : (
    <Tooltip content={tooltip}>
      <button
        type="button"
        ref={triggerRef}
        className={`scene-menu__trigger scene-menu__trigger--${variant}${className ? ` ${className}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={variant === 'text' ? undefined : label}
        data-open={isOpen || undefined}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' || isOpen) return
          event.preventDefault()
          setOpen(true)
        }}
      >
        <TriggerGlyph icon={icon} />
        {variant === 'text' ? <span className="scene-menu__name">{label}</span> : null}
        {variant === 'text' || variant === 'chevron' ? <IconChevron className="scene-menu__chevron" /> : null}
      </button>
    </Tooltip>
  )

  const panel = (
    <div
      ref={panelRef}
      className="menu scene-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-placed={placement ? '' : undefined}
      style={{ top: placement?.top ?? 0, left: placement?.left ?? 0 }}
      onKeyDown={onKeyDown}
    >
      {query ? (
        <p className="scene-menu__filter">
          <span className="scene-menu__filter-name">Filter</span>
          <span className="scene-menu__filter-text">{query}</span>
        </p>
      ) : null}
      {commands.length === 0 ? (
        <p className="scene-menu__empty">
          {query ? 'Nothing here matches that.' : 'Nothing in this menu yet.'}
        </p>
      ) : null}
      {shown.map((entry, position) => (
        isCommand(entry)
          ? (
            <MenuItem
              key={entry.id}
              command={entry}
              highlighted={order.get(entry) === index}
              onHighlight={() => setIndex(order.get(entry) ?? 0)}
              onRun={run}
            />
          )
          : <div key={`separator-${position}`} className="menu__sep" role="separator" />
      ))}
    </div>
  )

  return (
    <>
      {trigger}
      {mounted && isOpen ? createPortal(panel, document.body) : null}
    </>
  )
}

/** The trigger's icon, when it names one. Written apart so the trigger stays one expression. */
function TriggerGlyph({ icon }: { icon?: string }) {
  const Glyph = sceneIcon(icon)
  return Glyph ? <Glyph className="scene-menu__glyph" /> : null
}
