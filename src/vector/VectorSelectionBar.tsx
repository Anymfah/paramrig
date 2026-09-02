import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { IconButton } from '@/ui/Button'
import type { ContextMenuItem } from '@/ui/ContextMenu'
import {
  IconChevron, IconEye, IconEyeOff, IconFlipH, IconFlipV, IconGroup, IconLock, IconMore, IconNode,
  IconRotate90, IconScissors, IconTrash, IconUngroup, IconUnlock,
} from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { VectorChip } from '@/vector/VectorChip'
import { booleanLabel, BOOLEAN_OPERATIONS } from '@/vector/booleanGroups'
import type { BooleanOperation } from '@/vector/booleans'
import { SHORTCUTS, withShortcut } from '@/vector/commands'
import type { SelectionAnchor } from '@/vector/selectionAnchor'

/** What the bar does to the objects under it. */
export type SelectionBarActions = {
  canUngroup: boolean
  canCombine: boolean
  locked: boolean
  hidden: boolean
  onGroup: () => void
  onUngroup: () => void
  onBoolean: (operation: BooleanOperation) => void
  onFlip: (axis: 'x' | 'y') => void
  onRotate90: () => void
  onLock: () => void
  onHide: () => void
  onDelete: () => void
  /** The rest of the canvas menu, behind the ⋯. */
  more: ContextMenuItem[]
}

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

const BAR_OFFSET = 12

/**
 * The chip that follows the selection: what you do to what you have, within reach of it, instead of
 * across the window in a toolbar. It carries the same actions as the canvas menu, in the order they
 * are used, and hands the rare ones to a ⋯.
 */
export function VectorSelectionBar({ anchor, actions, nodeActions }: {
  anchor: SelectionAnchor
  actions: SelectionBarActions
  nodeActions: NodeBarActions
}) {
  const style = {
    left: anchor.x,
    top: anchor.placement === 'above' ? anchor.y - BAR_OFFSET : anchor.y + BAR_OFFSET,
  }
  return (
    <VectorChip
      className="vector-selection-bar"
      style={style}
      role="toolbar"
      dataset={{ placement: anchor.placement, mode: anchor.mode }}
    >
      {anchor.mode === 'nodes'
        ? <NodeButtons actions={nodeActions} />
        : <ObjectButtons actions={actions} />}
    </VectorChip>
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
      <DropdownMenu.Root modal={false}>
        <Tooltip content="Combine shapes">
          <DropdownMenu.Trigger asChild>
            <button type="button" className="vector-selection-bar__more" aria-label="Combine shapes" disabled={!actions.canCombine}>
              <IconNode />
              <IconChevron />
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu vector-selection-bar__menu" side="bottom" align="center" sideOffset={8} collisionPadding={8} aria-label="Combine shapes">
            {BOOLEAN_OPERATIONS.map((operation) => (
              <DropdownMenu.Item key={operation} className="menu__item" onSelect={() => actions.onBoolean(operation)}>
                {booleanLabel(operation)}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <BarButton label="Flip horizontal" tip={withShortcut('Flip horizontal', 'flipHorizontal')} onClick={() => actions.onFlip('x')}><IconFlipH /></BarButton>
      <BarButton label="Flip vertical" tip={withShortcut('Flip vertical', 'flipVertical')} onClick={() => actions.onFlip('y')}><IconFlipV /></BarButton>
      <BarButton label="Rotate 90 degrees" tip={withShortcut('Rotate 90°', 'rotate90')} onClick={actions.onRotate90}><IconRotate90 /></BarButton>
      <BarButton label={actions.locked ? 'Unlock selection' : 'Lock selection'} tip={withShortcut(actions.locked ? 'Unlock' : 'Lock', 'lock')} pressed={actions.locked} onClick={actions.onLock}>
        {actions.locked ? <IconLock /> : <IconUnlock />}
      </BarButton>
      <BarButton label={actions.hidden ? 'Show selection' : 'Hide selection'} tip={withShortcut(actions.hidden ? 'Show' : 'Hide', 'hide')} pressed={actions.hidden} onClick={actions.onHide}>
        {actions.hidden ? <IconEyeOff /> : <IconEye />}
      </BarButton>
      <BarButton label="Delete selection" tip={withShortcut('Delete', 'delete')} onClick={actions.onDelete}><IconTrash /></BarButton>
      <DropdownMenu.Root modal={false}>
        <Tooltip content="More actions">
          <DropdownMenu.Trigger asChild>
            <button type="button" className="vector-selection-bar__more" aria-label="More actions"><IconMore /></button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu vector-selection-bar__menu" side="bottom" align="end" sideOffset={8} collisionPadding={8} aria-label="More actions">
            {actions.more.map((item, index) => (
              <DropdownMenu.Item key={`${item.label}-${index}`} className="menu__item" disabled={item.disabled} onSelect={item.onSelect}>
                {item.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
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
