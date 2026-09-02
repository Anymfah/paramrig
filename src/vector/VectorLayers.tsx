import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { Lockup } from '@/ui/BrandMark'
import { ContextMenuRoot, ContextTarget, type ContextMenuItem } from '@/ui/ContextMenu'
import { ThemeToggle } from '@/ui/ThemeToggle'
import { Tooltip } from '@/ui/Tooltip'
import { updatePrefs, useWorkspace } from '@/state/workspace'
import { IconBringForward, IconChevron, IconCopy, IconEllipse, IconEye, IconEyeOff, IconFolderLayer, IconFrame, IconGroup, IconLock, IconMask, IconPanelLeft, IconPanelLeftClose, IconPath, IconPencil, IconRectangle, IconSendBackward, IconText, IconTrash, IconUngroup, IconUnlock } from '@/ui/icons'
import { SHORTCUTS } from '@/vector/commands'
import { componentThumbnail } from '@/vector/document'
import { componentsOf, instanceCount } from '@/vector/instances'
import { childrenOf, flattenForLayers, isContainer, siblingIndex, type LayerRow } from '@/vector/tree'
import type { VectorDocument, VectorElement } from '@/vector/types'

type VectorLayersProps = {
  document: VectorDocument
  selectedIds: string[]
  enteredGroupId: string | null
  compact: boolean
  inert: boolean
  onNavigate: () => void
  onSelect: (id: string, mode: 'replace' | 'toggle' | 'range') => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onUpdateElements: (updates: Array<{ id: string; patch: Partial<VectorElement> }>, record?: boolean) => void
  onRemove: (ids: string[]) => void
  onReorder: (id: string, direction: -1 | 1) => void
  onMoveInTree: (id: string, target: { parentId: string | null; index: number }) => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onGroup: (ids: string[]) => void
  onUngroup: (ids: string[]) => void
  /** Opens the batch rename dialog; absent when a single layer is all that can be renamed. */
  onRenameMany?: (ids: string[]) => void
  /** Drops an instance of a component in the middle of the view. */
  onPlaceComponent?: (componentId: string) => void
}

type DropTarget = { id: string; edge: 'before' | 'after' | 'inside' }

export function VectorLayers({ document, selectedIds, enteredGroupId, compact, inert, onNavigate, onSelect, onUpdate, onUpdateElements, onRemove, onReorder, onMoveInTree, onRename, onDuplicate, onGroup, onUngroup, onRenameMany, onPlaceComponent }: VectorLayersProps) {
  const { prefs } = useWorkspace()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [tab, setTab] = useState<'layers' | 'assets'>('layers')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Selecting inside a group reveals it.
    if (!enteredGroupId || !collapsed.has(enteredGroupId)) return
    setCollapsed((current) => {
      const next = new Set(current)
      next.delete(enteredGroupId)
      return next
    })
  }, [enteredGroupId, collapsed])

  const rows = flattenForLayers(document.elements, collapsed)
  const components = componentsOf(document.elements)

  const toggleCollapsed = (id: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const drop = (target: DropTarget) => {
    if (!draggingId || draggingId === target.id) return
    const dragged = document.elements.find((element) => element.id === draggingId)
    const hovered = document.elements.find((element) => element.id === target.id)
    if (!dragged || !hovered) return
    if (target.edge === 'inside') {
      if (!isContainer(hovered)) return
      onMoveInTree(draggingId, { parentId: hovered.id, index: childrenOf(document.elements, hovered.id).length })
      return
    }
    const parentId = hovered.parentId ?? null
    const siblings = childrenOf(document.elements, parentId).filter((element) => element.id !== draggingId)
    const position = siblings.findIndex((element) => element.id === hovered.id)
    if (position < 0) return
    // Rows list the top of the stack first: "before" a row means above it in paint order.
    onMoveInTree(draggingId, { parentId, index: target.edge === 'before' ? position + 1 : position })
  }

  const focusRow = (offset: number, event: ReactKeyboardEvent<HTMLElement>) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.vector-layer__select') ?? [])]
    const index = buttons.indexOf(event.currentTarget as HTMLButtonElement)
    const next = buttons[index + offset]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  return (
    <nav className="nav-rail vector-layers" aria-label="Layers" data-compact={compact || undefined} inert={inert}>
      <div className="nav-rail__head">
        <Tooltip content="ParamRig" side="right" disabled={!compact}>
          <Link to="/" className="nav-brand" aria-label="ParamRig home" onClick={onNavigate}>
            <Lockup />
          </Link>
        </Tooltip>
        <div className="nav-rail__tools">
          <Tooltip content={compact ? 'Expand layers' : 'Collapse layers'} side={compact ? 'right' : 'top'}>
            <button type="button" className="icon-btn icon-btn--ghost nav-rail__compact" aria-pressed={prefs.navCompact} aria-label={compact ? 'Expand layers' : 'Collapse layers'} onClick={() => updatePrefs({ navCompact: !prefs.navCompact, navCollapsed: false })}>
              {compact ? <IconPanelLeft /> : <IconPanelLeftClose />}
            </button>
          </Tooltip>
        </div>
      </div>
      {components.length > 0 ? (
        <div className="vector-layers__tabs" role="tablist" aria-label="Layers or assets">
          {(['layers', 'assets'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              className="vector-layers__tab"
              aria-selected={tab === value}
              data-active={tab === value || undefined}
              onClick={() => setTab(value)}
            >
              {value === 'layers' ? 'Layers' : `Assets · ${components.length}`}
            </button>
          ))}
        </div>
      ) : null}
      {tab === 'assets' && components.length > 0 ? (
        <div className="nav-rail__body scroll-area">
          <ul className="vector-assets" role="list" aria-label="Components">
            {components.map((component) => (
              <li key={component.id}>
                <button
                  type="button"
                  className="vector-assets__item"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-paramrig-component', component.id)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => onPlaceComponent?.(component.id)}
                >
                  <span className="vector-assets__thumb" aria-hidden="true">
                    <svg viewBox={`${component.x} ${component.y} ${Math.max(1, component.width)} ${Math.max(1, component.height)}`} dangerouslySetInnerHTML={{ __html: componentThumbnail(document.elements, component.id) }} />
                  </span>
                  <span className="vector-assets__name">{component.name}</span>
                  <span className="vector-assets__count">{instanceCount(document.elements, component.id)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="vector-layers__empty">Click one to place it, or drag it onto the canvas.</p>
        </div>
      ) : null}
      <div className="nav-rail__body scroll-area" hidden={tab === 'assets' && components.length > 0}>
        <ContextMenuRoot>
          <div className="vector-layers__list" ref={listRef} role="list" aria-label="Layer stack">
            {rows.length === 0 ? <p className="vector-layers__empty">No layers yet. Draw with the pen, rectangle or ellipse tools.</p> : null}
            {rows.map((row) => {
              const element = row.element
              const inSelection = selectedIds.includes(element.id)
              const groupCandidates = inSelection ? selectedIds : [element.id]
              const siblingCount = childrenOf(document.elements, element.parentId ?? null).length
              const index = siblingIndex(document.elements, element.id)
              const items: ContextMenuItem[] = [
                { label: 'Rename', icon: <IconPencil />, onSelect: () => requestAnimationFrame(() => rowRename.current[element.id]?.()) },
                ...(onRenameMany && inSelection && selectedIds.length > 1
                  ? [{ label: `Rename ${selectedIds.length} layers…`, icon: <IconPencil />, separatorBefore: false, onSelect: () => onRenameMany(selectedIds) }]
                  : []),
                { label: 'Duplicate', icon: <IconCopy />, separatorBefore: false, onSelect: () => onDuplicate(element.id) },
                { label: `Group · ${SHORTCUTS.group}`, icon: <IconGroup />, onSelect: () => onGroup(groupCandidates) },
                ...(element.kind === 'group' ? [{ label: `Ungroup · ${SHORTCUTS.ungroup}`, icon: <IconUngroup />, separatorBefore: false, onSelect: () => onUngroup([element.id]) }] : []),
                { label: `${element.locked ? 'Unlock' : 'Lock'} · ${SHORTCUTS.lock}`, icon: element.locked ? <IconUnlock /> : <IconLock />, onSelect: () => onUpdate(element.id, { locked: !element.locked }) },
                { label: `${element.visible ? 'Hide' : 'Show'} · ${SHORTCUTS.hide}`, icon: element.visible ? <IconEyeOff /> : <IconEye />, separatorBefore: false, onSelect: () => onUpdate(element.id, { visible: !element.visible }) },
                { label: `Bring forward · ${SHORTCUTS.bringForward}`, icon: <IconBringForward />, disabled: index === siblingCount - 1, onSelect: () => onReorder(element.id, 1) },
                { label: `Send backward · ${SHORTCUTS.sendBackward}`, icon: <IconSendBackward />, disabled: index === 0, separatorBefore: false, onSelect: () => onReorder(element.id, -1) },
                { label: `Delete · ${SHORTCUTS.delete}`, icon: <IconTrash />, onSelect: () => onRemove(inSelection ? selectedIds : [element.id]) },
              ]
              return (
                <div
                  key={element.id}
                  className="vector-layer-drag"
                  role="listitem"
                  draggable
                  data-dragging={draggingId === element.id || undefined}
                  data-drop-edge={dropTarget?.id === element.id ? dropTarget.edge : undefined}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', element.id)
                    setDraggingId(element.id)
                    if (!inSelection) onSelect(element.id, 'replace')
                  }}
                  onDragOver={(event) => {
                    if (!draggingId || draggingId === element.id) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = (event.clientY - rect.top) / rect.height
                    const edge: DropTarget['edge'] = isContainer(element) && ratio > 0.3 && ratio < 0.7 ? 'inside' : ratio < 0.5 ? 'before' : 'after'
                    setDropTarget((current) => current?.id === element.id && current.edge === edge ? current : { id: element.id, edge })
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                    setDropTarget((current) => current?.id === element.id ? null : current)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (dropTarget) drop(dropTarget)
                    setDraggingId(null)
                    setDropTarget(null)
                  }}
                  onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                >
                  <LayerRowView
                    row={row}
                    selected={inSelection}
                    entered={element.id === enteredGroupId}
                    compact={compact}
                    items={items}
                    onSelect={onSelect}
                    onUpdate={onUpdate}
                    onUpdateElements={onUpdateElements}
                    onRename={onRename}
                    onToggleCollapsed={toggleCollapsed}
                    onFocusRow={focusRow}
                    onRemove={onRemove}
                    selectedIds={selectedIds}
                    registerRename={(fn) => { rowRename.current[element.id] = fn }}
                  />
                </div>
              )
            })}
          </div>
        </ContextMenuRoot>
      </div>
      <div className="nav-rail__foot">
        <ThemeToggle compact={compact} />
      </div>
    </nav>
  )
}

const rowRename = { current: {} as Record<string, () => void> }

function LayerRowView({ row, selected, entered, compact, items, selectedIds, onSelect, onUpdate, onUpdateElements, onRename, onToggleCollapsed, onFocusRow, onRemove, registerRename }: {
  row: LayerRow
  selected: boolean
  entered: boolean
  compact: boolean
  items: ContextMenuItem[]
  selectedIds: string[]
  onSelect: (id: string, mode: 'replace' | 'toggle' | 'range') => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onUpdateElements: (updates: Array<{ id: string; patch: Partial<VectorElement> }>, record?: boolean) => void
  onRename: (id: string, name: string) => void
  onToggleCollapsed: (id: string) => void
  onFocusRow: (offset: number, event: ReactKeyboardEvent<HTMLElement>) => void
  onRemove: (ids: string[]) => void
  registerRename: (fn: () => void) => void
}) {
  const element = row.element
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(element.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const ShapeIcon = element.mask ? IconMask : element.kind === 'group' ? IconFolderLayer : element.kind === 'frame' ? IconFrame : element.kind === 'text' ? IconText : element.kind === 'path' || element.network ? IconPath : element.kind === 'ellipse' ? IconEllipse : IconRectangle
  const startRename = () => {
    setDraft(element.name)
    if (compact) {
      updatePrefs({ navCompact: false, navCollapsed: false })
      requestAnimationFrame(() => setEditing(true))
    } else {
      setEditing(true)
    }
  }
  registerRename(startRename)
  const commitRename = () => { onRename(element.id, draft); setEditing(false) }

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const select = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey) onSelect(element.id, 'range')
    else if (event.metaKey || event.ctrlKey) onSelect(element.id, 'toggle')
    else onSelect(element.id, 'replace')
  }

  const toggleLocked = () => {
    const targets = selected ? selectedIds : [element.id]
    const locked = !element.locked
    if (targets.length === 1) onUpdate(element.id, { locked })
    else onUpdateElements(targets.map((id) => ({ id, patch: { locked } })))
  }
  const toggleVisible = () => {
    const targets = selected ? selectedIds : [element.id]
    const visible = !element.visible
    if (targets.length === 1) onUpdate(element.id, { visible })
    else onUpdateElements(targets.map((id) => ({ id, patch: { visible } })))
  }

  return (
    <ContextTarget
      className="vector-layer-context"
      label={`${element.name} actions`}
      touchActions={false}
      onOpen={() => { if (!selected) onSelect(element.id, 'replace') }}
      items={items}
    >
      <div
        className="vector-layer"
        data-selected={selected || undefined}
        data-entered={entered || undefined}
        data-hidden={!element.visible || undefined}
        data-locked={element.locked || undefined}
        data-depth={row.depth}
        data-group={isContainer(element) || undefined}
        style={{ '--depth': row.depth } as CSSProperties}
      >
        {row.hasChildren || isContainer(element) ? (
          <button
            type="button"
            className="vector-layer__disclosure"
            aria-label={row.collapsed ? `Expand ${element.name}` : `Collapse ${element.name}`}
            aria-expanded={!row.collapsed}
            onClick={() => onToggleCollapsed(element.id)}
          >
            <IconChevron />
          </button>
        ) : <span className="vector-layer__disclosure vector-layer__disclosure--spacer" aria-hidden="true" />}
        {editing ? (
          <div className="vector-layer__edit">
            <ShapeIcon />
            <input aria-label={`Rename ${element.name}`} value={draft} maxLength={120} draggable={false} ref={inputRef} onDragStart={(event) => event.stopPropagation()} onChange={(event) => setDraft(event.currentTarget.value)} onBlur={commitRename} onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') { event.preventDefault(); setDraft(element.name); setEditing(false) }
            }} />
          </div>
        ) : (
          <Tooltip content={element.name} side="right" disabled={!compact}>
            <button
              type="button"
              className="vector-layer__select"
              aria-pressed={selected}
              onClick={select}
              onDoubleClick={startRename}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') onFocusRow(1, event)
                else if (event.key === 'ArrowUp') onFocusRow(-1, event)
                else if (event.key === 'ArrowLeft' && isContainer(element) && !row.collapsed) { event.preventDefault(); onToggleCollapsed(element.id) }
                else if (event.key === 'ArrowRight' && isContainer(element) && row.collapsed) { event.preventDefault(); onToggleCollapsed(element.id) }
                else if (event.key === 'F2' || event.key === 'Enter') { event.preventDefault(); startRename() }
                else if ((event.key === 'Backspace' || event.key === 'Delete')) { event.preventDefault(); onRemove(selected ? selectedIds : [element.id]) }
              }}
            >
              <ShapeIcon />
              <span>{element.name}</span>
            </button>
          </Tooltip>
        )}
        {!compact ? (
          <div className="vector-layer__actions">
            <Tooltip content={element.locked ? 'Unlock' : 'Lock'}>
              <button type="button" className="vector-layer__action" aria-label={element.locked ? `Unlock ${element.name}` : `Lock ${element.name}`} aria-pressed={element.locked} data-active={element.locked || undefined} onClick={toggleLocked}>
                {element.locked ? <IconLock /> : <IconUnlock />}
              </button>
            </Tooltip>
            <Tooltip content={element.visible ? 'Hide' : 'Show'}>
              <button type="button" className="vector-layer__action" aria-label={element.visible ? `Hide ${element.name}` : `Show ${element.name}`} aria-pressed={!element.visible} data-active={!element.visible || undefined} onClick={toggleVisible}>
                {element.visible ? <IconEye /> : <IconEyeOff />}
              </button>
            </Tooltip>
          </div>
        ) : null}
      </div>
    </ContextTarget>
  )
}
