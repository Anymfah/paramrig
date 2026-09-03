import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { sceneIcon } from '@/scene/iconRegistry'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import type { EditorMode, SceneTool } from '@/scene/types'
import { IconButton } from '@/ui/Button'
import { HIT_TARGET_COARSE_PX, HIT_TARGET_PX } from '@/ui/hit-target'
import { IconClose } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { useRovingFocus } from '@/ui/useRovingFocus'

/**
 * The T bar: the tools, as a strip of icons over the left of the viewport.
 *
 * It floats rather than taking a column of the layout, because a bar that pushed the viewport
 * aside would move the model out from under the pointer every time it opened. Tools that do the
 * same job under different gestures — box, circle and lasso — share one button and a sub-menu on
 * press-and-hold, the way Blender's tool groups do, so the strip stays one icon wide.
 */

type ToolGroup = {
  id: string
  label: string
  tools: SceneTool[]
  /** The chord the tooltip prints, or null for a tool the keymap gives no key. */
  shortcut: string | null
}

/** How long a press has to last before it means "show me the rest of this group". */
const LONG_PRESS_MS = 400
const MENU_GAP = 8
/**
 * What the sub-menu is assumed to be until it has been laid out. Measuring it would mean opening it
 * first and moving it afterwards, and a menu that jumps once it is on screen reads worse than one
 * placed a few pixels off.
 */
const MENU_WIDTH = 176

function chord(actionId: string): string | null {
  const binding = bindingFor(actionId)
  return binding ? shortcutLabel(binding) : null
}

/** A tool's name, derived from its id so the bar and the sidebar cannot drift apart. */
function toolLabel(tool: SceneTool): string {
  const words = tool.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The tools both modes share. Edit mode's own — extrude, inset, bevel, loop cut, knife — arrive
 * with the mesh prompt and join this list then.
 */
const GROUPS: ToolGroup[] = [
  { id: 'select', label: 'Select', tools: ['select-box', 'select-circle', 'select-lasso'], shortcut: chord('tool.cycleSelect') },
  { id: 'cursor', label: 'Cursor', tools: ['cursor'], shortcut: null },
  { id: 'move', label: 'Move', tools: ['move'], shortcut: chord('transform.move') },
  { id: 'rotate', label: 'Rotate', tools: ['rotate'], shortcut: chord('transform.rotate') },
  { id: 'scale', label: 'Scale', tools: ['scale'], shortcut: chord('transform.scale') },
  { id: 'transform', label: 'Transform', tools: ['transform'], shortcut: null },
  { id: 'annotate', label: 'Annotate', tools: ['annotate'], shortcut: null },
  { id: 'measure', label: 'Measure', tools: ['measure'], shortcut: null },
]

export function SceneToolbar({ open, tool, mode, onTool, onClose }: {
  open: boolean
  tool: SceneTool
  mode: EditorMode
  onTool: (tool: SceneTool) => void
  onClose: () => void
}) {
  if (!open) return null
  return <ToolbarStrip tool={tool} mode={mode} onTool={onTool} onClose={onClose} />
}

/**
 * The strip itself is a separate component so that its roving tabindex is set up the moment the bar
 * opens: the hook reads the element once, on mount, and a bar that only returned null would never
 * hand it one.
 */
function ToolbarStrip({ tool, mode, onTool, onClose }: {
  tool: SceneTool
  mode: EditorMode
  onTool: (tool: SceneTool) => void
  onClose: () => void
}) {
  const bar = useRef<HTMLDivElement>(null)
  useRovingFocus(bar)
  const binding = bindingFor('panel.toolbar')
  // The two hit sizes travel as custom properties so the stylesheet and `hit-target.ts` cannot
  // disagree about how big a tool is under a fine and under a coarse pointer.
  const sizes = {
    '--scene-tool-size': `${HIT_TARGET_PX}px`,
    '--scene-tool-size-coarse': `${HIT_TARGET_COARSE_PX}px`,
  } as CSSProperties

  return (
    <div
      className="scene-toolbar"
      role="toolbar"
      aria-label={mode === 'edit' ? 'Edit mode tools' : 'Object mode tools'}
      data-mode={mode}
      ref={bar}
      style={sizes}
    >
      {GROUPS.map((group) => (
        <ToolGroupButton key={group.id} group={group} tool={tool} onTool={onTool} />
      ))}
      <Tooltip content={binding ? `Close toolbar · ${shortcutLabel(binding)}` : 'Close toolbar'} side="right">
        <IconButton label="Close toolbar" className="scene-toolbar__close" onClick={onClose}>
          <IconClose />
        </IconButton>
      </Tooltip>
    </div>
  )
}

function ToolGroupButton({ group, tool, onTool }: {
  group: ToolGroup
  tool: SceneTool
  onTool: (tool: SceneTool) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const hold = useRef<number | undefined>(undefined)
  /** The hold has already opened the menu, so the click that ends it must not also pick a tool. */
  const held = useRef(false)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  // The member of the group the button shows: whichever is active, else the one last chosen.
  const [chosen, setChosen] = useState<SceneTool>(group.tools[0]!)
  const active = group.tools.includes(tool)
  const current = active ? tool : chosen
  const several = group.tools.length > 1

  const buttonOf = () => root.current?.querySelector<HTMLButtonElement>('button') ?? null

  const cancelHold = () => {
    if (hold.current === undefined) return
    window.clearTimeout(hold.current)
    hold.current = undefined
  }

  const openMenu = () => {
    const rect = buttonOf()?.getBoundingClientRect()
    if (rect) {
      const right = rect.right + MENU_GAP
      const fits = right + MENU_WIDTH <= window.innerWidth
      setAt({ top: rect.top, left: fits ? right : Math.max(MENU_GAP, rect.left - MENU_GAP - MENU_WIDTH) })
    }
    setOpen(true)
  }

  const closeMenu = (restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) buttonOf()?.focus()
  }

  const choose = (next: SceneTool) => {
    setChosen(next)
    onTool(next)
    closeMenu(true)
  }

  // A bar that unmounts mid-press must not open a menu into a component that is gone.
  useEffect(() => () => {
    if (hold.current !== undefined) window.clearTimeout(hold.current)
  }, [])

  useEffect(() => {
    if (!open) return
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    const checked = menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    ;(checked ?? items?.[0])?.focus()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menu.current?.contains(target) || root.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
      return
    }
    if (event.key === 'Tab') {
      closeMenu(false)
      return
    }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    if (items.length === 0) return
    const index = items.findIndex((item) => item === document.activeElement)
    event.preventDefault()
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  const Icon = sceneIcon(current)
  const tip = [toolLabel(current), group.shortcut, several ? 'hold for more' : null].filter(Boolean).join(' · ')

  return (
    <div className="scene-toolbar__group" ref={root} data-active={active || undefined}>
      <Tooltip content={tip} side="right">
        <IconButton
          label={toolLabel(current)}
          className="scene-toolbar__tool"
          aria-pressed={active}
          aria-haspopup={several ? 'menu' : undefined}
          aria-expanded={several ? open : undefined}
          onPointerDown={(event) => {
            if (event.button !== 0 || !several) return
            held.current = false
            cancelHold()
            hold.current = window.setTimeout(() => {
              held.current = true
              openMenu()
            }, LONG_PRESS_MS)
          }}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
          onKeyDown={(event) => {
            if (!several || event.key !== 'ArrowDown') return
            event.preventDefault()
            openMenu()
          }}
          onClick={() => {
            if (held.current) {
              held.current = false
              return
            }
            onTool(current)
          }}
        >
          {Icon ? <Icon /> : null}
          {several ? <span className="scene-toolbar__more" aria-hidden="true" /> : null}
        </IconButton>
      </Tooltip>
      {open
        ? createPortal(
            <div
              className="menu scene-toolbar__menu"
              role="menu"
              aria-label={`${group.label} tools`}
              ref={menu}
              style={{ top: at.top, left: at.left }}
              onKeyDown={onMenuKeyDown}
            >
              {group.tools.map((entry) => {
                const EntryIcon = sceneIcon(entry)
                return (
                  <button
                    key={entry}
                    type="button"
                    role="menuitemradio"
                    aria-checked={entry === current}
                    className="menu__item"
                    onClick={() => choose(entry)}
                  >
                    {EntryIcon ? <EntryIcon /> : null}
                    <span className="scene-toolbar__menu-label">{toolLabel(entry)}</span>
                    {group.shortcut ? <kbd>{group.shortcut}</kbd> : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
