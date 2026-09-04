import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { sceneIcon } from '@/scene/iconRegistry'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import type { EditorMode } from '@/scene/types'
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

/**
 * A button on the bar, and whatever else shares it.
 *
 * `tools` is a list of ids rather than of `SceneTool`s because sculpt mode's bar is made of brushes
 * rather than of tools, and the bar's behaviour — the icons, the grouping, the press-and-hold that
 * shows the rest — is the same for both. What the ids mean is the caller's business.
 */
type ToolGroup = {
  id: string
  label: string
  tools: string[]
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
function toolLabel(tool: string): string {
  const words = tool.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The tools both modes share: selecting, the cursor, the three transforms, notes and rulers. */
const COMMON_GROUPS: ToolGroup[] = [
  { id: 'select', label: 'Select', tools: ['select-box', 'select-circle', 'select-lasso'], shortcut: chord('tool.cycleSelect') },
  { id: 'cursor', label: 'Cursor', tools: ['cursor'], shortcut: null },
  { id: 'move', label: 'Move', tools: ['move'], shortcut: chord('transform.move') },
  { id: 'rotate', label: 'Rotate', tools: ['rotate'], shortcut: chord('transform.rotate') },
  { id: 'scale', label: 'Scale', tools: ['scale'], shortcut: chord('transform.scale') },
  { id: 'transform', label: 'Transform', tools: ['transform'], shortcut: null },
  { id: 'annotate', label: 'Annotate', tools: ['annotate'], shortcut: null },
  { id: 'measure', label: 'Measure', tools: ['measure'], shortcut: null },
]

/**
 * Edit mode's own, in Blender's order. Each is the interactive half of the operator of the same
 * name — pressing E and picking the extrude tool run exactly the same thing, which is why the
 * F9 panel after either says the same words.
 */
const EDIT_GROUPS: ToolGroup[] = [
  { id: 'extrude', label: 'Extrude region', tools: ['extrude'], shortcut: chord('mesh.extrudeRegion') },
  { id: 'inset', label: 'Inset faces', tools: ['inset'], shortcut: chord('mesh.inset') },
  { id: 'bevel', label: 'Bevel', tools: ['bevel'], shortcut: chord('mesh.bevelEdges') },
  { id: 'loop-cut', label: 'Loop cut', tools: ['loop-cut'], shortcut: chord('mesh.loopCut') },
  { id: 'knife', label: 'Knife', tools: ['knife', 'bisect'], shortcut: chord('tool.knife') },
  { id: 'poly-build', label: 'Poly build', tools: ['poly-build'], shortcut: null },
  { id: 'spin', label: 'Spin', tools: ['spin'], shortcut: null },
  { id: 'smooth', label: 'Smooth', tools: ['smooth'], shortcut: null },
  { id: 'edge-slide', label: 'Edge slide', tools: ['edge-slide'], shortcut: chord('mesh.edgeSlide') },
  { id: 'shrink-fatten', label: 'Shrink or fatten', tools: ['shrink-fatten'], shortcut: chord('mesh.shrinkFatten') },
  { id: 'shear', label: 'Shear', tools: ['shear'], shortcut: chord('mesh.shear') },
  { id: 'rip', label: 'Rip region', tools: ['rip'], shortcut: chord('mesh.rip') },
]

/**
 * Sculpt mode's brushes, grouped by what they do to a surface, in Blender's order.
 *
 * Nineteen buttons down the side of a viewport is a wall, and Blender's own sculpt bar is exactly
 * that wall. Grouping them the way the select tools are grouped keeps the bar one icon wide and
 * puts the members one press away, with their names on them.
 */
const SCULPT_GROUPS: ToolGroup[] = [
  { id: 'draw', label: 'Draw', tools: ['draw', 'draw-sharp'], shortcut: null },
  { id: 'clay', label: 'Clay', tools: ['clay', 'clay-strips'], shortcut: null },
  { id: 'inflate', label: 'Inflate', tools: ['inflate', 'blob'], shortcut: null },
  { id: 'crease', label: 'Crease', tools: ['crease', 'pinch'], shortcut: null },
  { id: 'smooth', label: 'Smooth', tools: ['smooth'], shortcut: null },
  { id: 'flatten', label: 'Flatten', tools: ['flatten', 'fill', 'scrape'], shortcut: null },
  { id: 'grab', label: 'Grab', tools: ['grab', 'elastic', 'snake-hook', 'thumb', 'nudge'], shortcut: null },
  { id: 'rotate', label: 'Rotate', tools: ['rotate'], shortcut: null },
  { id: 'mask', label: 'Mask', tools: ['mask'], shortcut: chord('sculpt.mask') },
]

function groupsFor(mode: EditorMode, editData: 'mesh' | 'curve' | 'text' = 'mesh'): ToolGroup[] {
  if (mode === 'sculpt') return SCULPT_GROUPS
  if (mode !== 'edit') return COMMON_GROUPS
  /*
   * The edit tools are a mesh's: a knife, a loop cut and an inset all cut faces, and a curve has
   * none. A curve keeps the tools that move things about, and a text object keeps them too — it is
   * edited with the keyboard, and offering it a bevel tool would be offering it nothing.
   */
  return editData === 'mesh' ? [...COMMON_GROUPS, ...EDIT_GROUPS] : COMMON_GROUPS
}

export function SceneToolbar({ open, tool, mode, editData, onTool, onClose }: {
  open: boolean
  /** The tool in object and edit mode, and the brush in sculpt mode. */
  tool: string
  mode: EditorMode
  /** What is open for editing, so the bar offers the tools that apply to it. */
  editData?: 'mesh' | 'curve' | 'text'
  onTool: (tool: string) => void
  onClose: () => void
}) {
  if (!open) return null
  return <ToolbarStrip tool={tool} mode={mode} editData={editData} onTool={onTool} onClose={onClose} />
}

/**
 * The strip itself is a separate component so that its roving tabindex is set up the moment the bar
 * opens: the hook reads the element once, on mount, and a bar that only returned null would never
 * hand it one.
 */
function ToolbarStrip({ tool, mode, editData, onTool, onClose }: {
  tool: string
  mode: EditorMode
  editData?: 'mesh' | 'curve' | 'text'
  onTool: (tool: string) => void
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
      aria-label={mode === 'sculpt' ? 'Sculpt mode brushes' : mode === 'edit' ? 'Edit mode tools' : 'Object mode tools'}
      data-mode={mode}
      ref={bar}
      style={sizes}
    >
      {groupsFor(mode, editData).map((group) => (
        <ToolGroupButton key={group.id} group={group} tool={tool} onTool={onTool} prefix={mode === 'sculpt' ? 'sculpt-' : ''} />
      ))}
      <Tooltip content={binding ? `Close toolbar · ${shortcutLabel(binding)}` : 'Close toolbar'} side="right">
        <IconButton label="Close toolbar" className="scene-toolbar__close" onClick={onClose}>
          <IconClose />
        </IconButton>
      </Tooltip>
    </div>
  )
}

function ToolGroupButton({ group, tool, onTool, prefix }: {
  group: ToolGroup
  tool: string
  onTool: (tool: string) => void
  /** What the icon registry calls these ids: sculpt's brushes are prefixed, the tools are not. */
  prefix: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const hold = useRef<number | undefined>(undefined)
  /** The hold has already opened the menu, so the click that ends it must not also pick a tool. */
  const held = useRef(false)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  // The member of the group the button shows: whichever is active, else the one last chosen.
  const [chosen, setChosen] = useState<string>(group.tools[0]!)
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

  const choose = (next: string) => {
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

  const Icon = sceneIcon(`${prefix}${current}`)
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
                const EntryIcon = sceneIcon(`${prefix}${entry}`)
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
