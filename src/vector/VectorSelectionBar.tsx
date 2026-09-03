import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { CSSProperties, ReactNode } from 'react'
import { IconButton } from '@/ui/Button'
import type { ContextMenuItem } from '@/ui/ContextMenu'
import {
  IconAlignBottom, IconAlignCenterH, IconAlignCenterV, IconAlignLeft, IconAlignRight, IconAlignTop,
  IconBringForward, IconChevron, IconDistributeH, IconDistributeV, IconEye, IconEyeOff, IconFlipH,
  IconFlipV, IconGroup, IconLock, IconMore, IconNode, IconRotate90, IconScissors, IconTrash,
  IconUngroup, IconUnlock,
} from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { VectorChip } from '@/vector/VectorChip'
import { booleanLabel, BOOLEAN_OPERATIONS } from '@/vector/booleanGroups'
import type { BooleanOperation } from '@/vector/booleans'
import type { AlignMode, DistributeAxis } from '@/vector/align'
import { SHORTCUTS, withShortcut } from '@/vector/commands'
import type { SelectionBarPlacement } from '@/vector/VectorCanvas'

/** What the bar does to the objects under it. */
export type SelectionBarActions = {
  canUngroup: boolean
  canCombine: boolean
  canDistribute: boolean
  canOutline: boolean
  canFlatten: boolean
  /** Aligning one object works against the page; several align to each other. */
  alignsToPage: boolean
  locked: boolean
  hidden: boolean
  onGroup: () => void
  onUngroup: () => void
  onAlign: (mode: AlignMode) => void
  onDistribute: (axis: DistributeAxis) => void
  onOrder: (mode: 'forward' | 'backward' | 'front' | 'back') => void
  onBoolean: (operation: BooleanOperation) => void
  onCombine: () => void
  onFlatten: () => void
  onOutline: () => void
  onFlip: (axis: 'x' | 'y') => void
  onRotate90: () => void
  onLock: () => void
  onHide: () => void
  onDelete: () => void
  /** The rest of the canvas menu, behind the ⋯. */
  more: ContextMenuItem[]
}

const ALIGNMENTS: Array<{ mode: AlignMode; label: string; shortcut: string; icon: () => ReactNode }> = [
  { mode: 'left', label: 'Align left', shortcut: '⌥A', icon: () => <IconAlignLeft /> },
  { mode: 'centerX', label: 'Align horizontal centres', shortcut: '⌥H', icon: () => <IconAlignCenterH /> },
  { mode: 'right', label: 'Align right', shortcut: '⌥D', icon: () => <IconAlignRight /> },
  { mode: 'top', label: 'Align top', shortcut: '⌥W', icon: () => <IconAlignTop /> },
  { mode: 'centerY', label: 'Align vertical centres', shortcut: '⌥V', icon: () => <IconAlignCenterV /> },
  { mode: 'bottom', label: 'Align bottom', shortcut: '⌥S', icon: () => <IconAlignBottom /> },
]

/** What it does to the nodes under it, when the node tool is out. */
export type NodeBarActions = {
  canConnect: boolean
  canShape: boolean
  canDelete: boolean
  onConnect: () => void
  onScissors: () => void
  onSmooth: () => void
  onCorner: () => void
  onDeleteNodes: () => void
}

/**
 * What you do to what you have, in one place. It parks at the bottom of the canvas rather than over
 * the selection: a bar that moves with every selection is never in the same place twice, and over a
 * shape it covers the thing it is there to act on. Its grip drags it wherever it is wanted, and the
 * canvas remembers where that was.
 */
export function VectorSelectionBar({ placement, actions, nodeActions }: {
  placement: SelectionBarPlacement
  actions: SelectionBarActions
  nodeActions: NodeBarActions
}) {
  // Handed over as custom properties, so a narrow layout can place the bar itself.
  const style = { '--bar-x': `${placement.x}px`, '--bar-y': `${placement.y}px` } as CSSProperties
  return (
    <VectorChip
      className="vector-selection-bar"
      style={style}
      role="toolbar"
      dataset={{ mode: placement.mode, dragging: placement.dragging ? 'true' : undefined }}
    >
      <Tooltip content="Drag to move this bar · double-click to put it back">
        <button
          type="button"
          className="vector-selection-bar__grip"
          aria-label="Move the actions bar"
          onPointerDown={placement.onGrip}
          onDoubleClick={placement.onReset}
        >
          <IconGrip />
        </button>
      </Tooltip>
      {placement.mode === 'nodes'
        ? <NodeButtons actions={nodeActions} />
        : <ObjectButtons actions={actions} />}
    </VectorChip>
  )
}

function IconGrip() {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
    </svg>
  )
}

function ObjectButtons({ actions }: { actions: SelectionBarActions }) {
  return (
    <>
      {actions.canUngroup ? (
        <BarButton label="Ungroup" tip={withShortcut('Ungroup', 'ungroup')} onClick={actions.onUngroup}><IconUngroup /></BarButton>
      ) : (
        <BarButton label="Group" tip={withShortcut('Group', 'group')} onClick={actions.onGroup}><IconGroup /></BarButton>
      )}

      <BarMenu label={actions.alignsToPage ? 'Align to page' : 'Align to selection'} icon={<IconAlignLeft />}>
        <div className="vector-selection-bar__grid">
          {ALIGNMENTS.map((item) => (
            <DropdownMenu.Item key={item.mode} className="menu__item vector-selection-bar__cell" aria-label={item.label} onSelect={() => actions.onAlign(item.mode)}>
              {item.icon()}
            </DropdownMenu.Item>
          ))}
        </div>
        {actions.canDistribute ? (
          <>
            <DropdownMenu.Separator className="menu__sep" />
            <DropdownMenu.Item className="menu__item" onSelect={() => actions.onDistribute('x')}>
              <IconDistributeH /><span>Distribute horizontally</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu__item" onSelect={() => actions.onDistribute('y')}>
              <IconDistributeV /><span>Distribute vertically</span>
            </DropdownMenu.Item>
          </>
        ) : null}
      </BarMenu>

      <BarMenu label="Order" icon={<IconBringForward />}>
        <MenuAction label="Bring to front" shortcut={SHORTCUTS.bringToFront} onSelect={() => actions.onOrder('front')} />
        <MenuAction label="Bring forward" shortcut={SHORTCUTS.bringForward} onSelect={() => actions.onOrder('forward')} />
        <MenuAction label="Send backward" shortcut={SHORTCUTS.sendBackward} onSelect={() => actions.onOrder('backward')} />
        <MenuAction label="Send to back" shortcut={SHORTCUTS.sendToBack} onSelect={() => actions.onOrder('back')} />
      </BarMenu>

      <BarMenu label="Paths" icon={<IconNode />} disabled={!actions.canCombine && !actions.canOutline && !actions.canFlatten}>
        {BOOLEAN_OPERATIONS.map((operation) => (
          <DropdownMenu.Item key={operation} className="menu__item" disabled={!actions.canCombine} onSelect={() => actions.onBoolean(operation)}>
            {booleanLabel(operation)}
          </DropdownMenu.Item>
        ))}
        <DropdownMenu.Separator className="menu__sep" />
        <MenuAction label="Combine paths" shortcut={SHORTCUTS.combine} disabled={!actions.canCombine} onSelect={actions.onCombine} />
        <MenuAction label="Flatten" disabled={!actions.canFlatten} onSelect={actions.onFlatten} />
        <MenuAction label="Outline stroke" disabled={!actions.canOutline} onSelect={actions.onOutline} />
      </BarMenu>

      <span className="vector-selection-bar__sep" aria-hidden="true" />
      <BarButton label="Flip horizontal" tip={withShortcut('Flip horizontal', 'flipHorizontal')} onClick={() => actions.onFlip('x')}><IconFlipH /></BarButton>
      <BarButton label="Flip vertical" tip={withShortcut('Flip vertical', 'flipVertical')} onClick={() => actions.onFlip('y')}><IconFlipV /></BarButton>
      <BarButton label="Rotate 90 degrees" tip={withShortcut('Rotate 90°', 'rotate90')} onClick={actions.onRotate90}><IconRotate90 /></BarButton>
      <span className="vector-selection-bar__sep" aria-hidden="true" />
      <BarButton label={actions.locked ? 'Unlock selection' : 'Lock selection'} tip={withShortcut(actions.locked ? 'Unlock' : 'Lock', 'lock')} pressed={actions.locked} onClick={actions.onLock}>
        {actions.locked ? <IconLock /> : <IconUnlock />}
      </BarButton>
      <BarButton label={actions.hidden ? 'Show selection' : 'Hide selection'} tip={withShortcut(actions.hidden ? 'Show' : 'Hide', 'hide')} pressed={actions.hidden} onClick={actions.onHide}>
        {actions.hidden ? <IconEyeOff /> : <IconEye />}
      </BarButton>
      <BarButton label="Delete selection" tip={withShortcut('Delete', 'delete')} onClick={actions.onDelete}><IconTrash /></BarButton>
      <span className="vector-selection-bar__sep" aria-hidden="true" />
      <BarMenu label="More actions" icon={<IconMore />} chevron={false}>
        {actions.more.map((item, index) => (
          <DropdownMenu.Item key={`${item.label}-${index}`} className="menu__item" disabled={item.disabled} onSelect={item.onSelect}>
            {item.label}
          </DropdownMenu.Item>
        ))}
      </BarMenu>
    </>
  )
}

/** One button of the bar that opens a menu rather than acting. */
function BarMenu({ label, icon, disabled, chevron = true, children }: {
  label: string
  icon: ReactNode
  disabled?: boolean
  chevron?: boolean
  children: ReactNode
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content={label}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="vector-selection-bar__more" aria-label={label} disabled={disabled}>
            {icon}
            {chevron ? <IconChevron /> : null}
          </button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu vector-selection-bar__menu" side="top" align="center" sideOffset={8} collisionPadding={8} aria-label={label}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function MenuAction({ label, shortcut, disabled, onSelect }: { label: string; shortcut?: string; disabled?: boolean; onSelect: () => void }) {
  return (
    <DropdownMenu.Item className="menu__item" disabled={disabled} onSelect={onSelect}>
      <span className="vector-selection-bar__label">{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </DropdownMenu.Item>
  )
}

function NodeButtons({ actions }: { actions: NodeBarActions }) {
  return (
    <>
      <BarButton label="Connect nodes" tip={withShortcut('Connect the two selected nodes', 'join')} disabled={!actions.canConnect} onClick={actions.onConnect}><IconNode /></BarButton>
      <BarButton label="Scissors" tip={`Cut the path · ${SHORTCUTS.scissors}`} onClick={actions.onScissors}><IconScissors /></BarButton>
      <BarButton label="Smooth nodes" tip="Give the nodes handles" disabled={!actions.canShape} onClick={actions.onSmooth}><IconSmooth /></BarButton>
      <BarButton label="Corner nodes" tip="Take the handles away" disabled={!actions.canShape} onClick={actions.onCorner}><IconCorner /></BarButton>
      <BarButton label="Delete nodes" tip={withShortcut('Delete the selected nodes', 'delete')} disabled={!actions.canDelete} onClick={actions.onDeleteNodes}><IconTrash /></BarButton>
    </>
  )
}

function BarButton({ label, tip, pressed, disabled, onClick, children }: {
  label: string
  tip: string
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip content={tip}>
      <IconButton label={label} aria-pressed={pressed} disabled={disabled} className="vector-selection-bar__button" onClick={onClick}>
        {children}
      </IconButton>
    </Tooltip>
  )
}

function IconSmooth() {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17c4 0 6-10 10-10s5 5 8 5" />
      <circle cx="13" cy="7" r="2" />
    </svg>
  )
}

function IconCorner() {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18 12 6l9 12" />
      <rect x="10" y="4" width="4" height="4" />
    </svg>
  )
}
