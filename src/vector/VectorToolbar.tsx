import type { ComponentType, MouseEvent as ReactMouseEvent } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { IconButton } from '@/ui/Button'
import {
  IconBucket, IconCheck, IconChevron, IconEllipse, IconFrame, IconHand, IconLasso, IconLine,
  IconMinus, IconNode, IconPen, IconPencilTool, IconPlus, IconPolygon, IconRectangle, IconRuler,
  IconScale, IconScissors, IconSelect, IconStar, IconText, IconTransformSelect, IconWidth,
  IconZoomTool,
} from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { entryOf, type ToolEntry, type ToolGroupDef } from '@/vector/toolGroups'

const TOOL_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  select: IconSelect,
  transform: IconTransformSelect,
  scale: IconScale,
  lasso: IconLasso,
  frame: IconFrame,
  rectangle: IconRectangle,
  ellipse: IconEllipse,
  line: IconLine,
  polygon: IconPolygon,
  star: IconStar,
  pen: IconPen,
  pencil: IconPencilTool,
  node: IconNode,
  scissors: IconScissors,
  width: IconWidth,
  bucket: IconBucket,
  text: IconText,
  hand: IconHand,
  zoom: IconZoomTool,
  measure: IconRuler,
}

function toolIcon(id: string): ComponentType<{ className?: string }> {
  return TOOL_ICONS[id] ?? IconSelect
}

/**
 * One slot of the toolbar: the tool of the group that was used last, and a menu holding the rest.
 * A group with a single tool is a plain button — there is nothing to choose between.
 */
export function ToolGroup({ group, entryId, activeTool, disabled, onActivate, onChoose }: {
  group: ToolGroupDef
  entryId: string
  activeTool: string | null
  /** Entry ids that cannot be picked right now, with the reason left to the tooltip. */
  disabled?: string[]
  onActivate: (entry: ToolEntry, keyboard: boolean) => void
  onChoose: (entry: ToolEntry) => void
}) {
  const current = entryOf(group, entryId)
  const CurrentIcon = toolIcon(current.id)
  const active = group.tools.some((entry) => entry.tool === activeTool)
  const isDisabled = (entry: ToolEntry) => disabled?.includes(entry.id) ?? false
  const main = (
    <Tooltip content={`${current.label} · ${current.shortcut}`}>
      <IconButton
        label={current.label}
        aria-pressed={active}
        disabled={isDisabled(current)}
        className={`vector-tool${group.tools.length > 1 ? ' vector-tool-menu__main' : ''}`}
        data-tool-group={group.id}
        onClick={(event: ReactMouseEvent<HTMLButtonElement>) => onActivate(current, event.detail === 0)}
      >
        <CurrentIcon />
      </IconButton>
    </Tooltip>
  )
  if (group.tools.length === 1) return main
  return (
    <div className="vector-tool-menu" data-active={active || undefined} data-tool-group={group.id}>
      {main}
      <DropdownMenu.Root modal={false}>
        <Tooltip content={group.label}>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="vector-tool-menu__trigger" aria-label={group.label}>
              <IconChevron />
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu vector-tool-menu__content" side="bottom" align="start" sideOffset={8} collisionPadding={8} aria-label={group.label}>
            <DropdownMenu.RadioGroup
              value={current.id}
              onValueChange={(next) => {
                const entry = group.tools.find((item) => item.id === next)
                if (entry) onChoose(entry)
              }}
            >
              {group.tools.map((entry) => {
                const Icon = toolIcon(entry.id)
                return (
                  <DropdownMenu.RadioItem key={entry.id} className="menu__item vector-tool-menu__item" value={entry.id} disabled={isDisabled(entry)}>
                    <span className="vector-tool-menu__check"><DropdownMenu.ItemIndicator><IconCheck /></DropdownMenu.ItemIndicator></span>
                    <Icon />
                    <span className="vector-tool-menu__label">{entry.label}</span>
                    <kbd>{entry.shortcut}</kbd>
                  </DropdownMenu.RadioItem>
                )
              })}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

const ZOOM_STEPS = [0.25, 0.5, 1, 2] as const

/** Zoom out, the current scale as a menu, zoom in. */
export function ZoomControl({ zoom, min, max, hasSelection, onStep, onZoomTo, onFitPage, onFitSelection }: {
  zoom: number
  min: number
  max: number
  hasSelection: boolean
  onStep: (direction: 1 | -1) => void
  onZoomTo: (scale: number) => void
  onFitPage: () => void
  onFitSelection: () => void
}) {
  return (
    <div className="vector-toolbar__zoom">
      <Tooltip content="Zoom out">
        <IconButton label="Zoom out" disabled={zoom <= min} onClick={() => onStep(-1)}><IconMinus /></IconButton>
      </Tooltip>
      <DropdownMenu.Root modal={false}>
        <Tooltip content="Zoom">
          <DropdownMenu.Trigger asChild>
            <button type="button" className="vector-zoom" aria-label={`Zoom, ${Math.round(zoom * 100)} percent`}>
              {Math.round(zoom * 100)}%
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu vector-zoom-menu" side="bottom" align="end" sideOffset={8} collisionPadding={8} aria-label="Zoom">
            {ZOOM_STEPS.map((step) => (
              <DropdownMenu.Item key={step} className="menu__item vector-zoom-menu__item" onSelect={() => onZoomTo(step)}>
                <span className="vector-zoom-menu__label">{step * 100}%</span>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="menu__sep" />
            <DropdownMenu.Item className="menu__item vector-zoom-menu__item" onSelect={onFitPage}>
              <span className="vector-zoom-menu__label">Fit page</span>
              <kbd>⇧1</kbd>
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu__item vector-zoom-menu__item" disabled={!hasSelection} onSelect={onFitSelection}>
              <span className="vector-zoom-menu__label">Fit selection</span>
              <kbd>⇧2</kbd>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Tooltip content="Zoom in">
        <IconButton label="Zoom in" disabled={zoom >= max} onClick={() => onStep(1)}><IconPlus /></IconButton>
      </Tooltip>
    </div>
  )
}
