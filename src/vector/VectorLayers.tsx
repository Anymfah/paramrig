import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lockup } from '@/ui/BrandMark'
import { ContextMenuRoot, ContextTarget } from '@/ui/ContextMenu'
import { ThemeToggle } from '@/ui/ThemeToggle'
import { Tooltip } from '@/ui/Tooltip'
import { updatePrefs, useWorkspace } from '@/state/workspace'
import { IconBringForward, IconCopy, IconEllipse, IconEye, IconEyeOff, IconPanelLeft, IconPanelLeftClose, IconPencil, IconRectangle, IconSendBackward, IconTrash } from '@/ui/icons'
import type { VectorDocument, VectorElement } from '@/vector/types'

type VectorLayersProps = {
  document: VectorDocument
  selectedIds: string[]
  compact: boolean
  inert: boolean
  onNavigate: () => void
  onSelect: (id: string | null) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onRemove: (id: string) => void
  onReorder: (id: string, direction: -1 | 1) => void
  onMove: (id: string, targetIndex: number) => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
}

type DropTarget = { id: string; edge: 'before' | 'after' }

export function VectorLayers({ document, selectedIds, compact, inert, onNavigate, onSelect, onUpdate, onRemove, onReorder, onMove, onRename, onDuplicate }: VectorLayersProps) {
  const { prefs } = useWorkspace()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const drop = (target: DropTarget) => {
    if (!draggingId || draggingId === target.id) return
    const display = [...document.elements].reverse().map((element) => element.id)
    const from = display.indexOf(draggingId)
    const hovered = display.indexOf(target.id)
    if (from < 0 || hovered < 0) return
    const [id] = display.splice(from, 1)
    let insertion = hovered + (target.edge === 'after' ? 1 : 0)
    if (from < insertion) insertion -= 1
    display.splice(Math.max(0, Math.min(display.length, insertion)), 0, id!)
    onMove(draggingId, document.elements.length - 1 - display.indexOf(draggingId))
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
      <div className="nav-rail__body scroll-area">
        <ContextMenuRoot>
          <div className="vector-layers__list">
            {[...document.elements].reverse().map((element, reversedIndex) => {
              const index = document.elements.length - 1 - reversedIndex
              return (
                <div
                  key={element.id}
                  className="vector-layer-drag"
                  draggable
                  data-dragging={draggingId === element.id || undefined}
                  data-drop-edge={dropTarget?.id === element.id ? dropTarget.edge : undefined}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', element.id)
                    setDraggingId(element.id)
                    onSelect(element.id)
                  }}
                  onDragOver={(event) => {
                    if (!draggingId || draggingId === element.id) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    const rect = event.currentTarget.getBoundingClientRect()
                    setDropTarget({ id: element.id, edge: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' })
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (dropTarget) drop(dropTarget)
                    setDraggingId(null)
                    setDropTarget(null)
                  }}
                  onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                >
                  <LayerRow element={element} selected={selectedIds.includes(element.id)} compact={compact} index={index} count={document.elements.length} onSelect={onSelect} onUpdate={onUpdate} onRemove={onRemove} onReorder={onReorder} onRename={onRename} onDuplicate={onDuplicate} />
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

function LayerRow({ element, selected, compact, index, count, onSelect, onUpdate, onRemove, onReorder, onRename, onDuplicate }: {
  element: VectorElement
  selected: boolean
  compact: boolean
  index: number
  count: number
  onSelect: (id: string | null) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onRemove: (id: string) => void
  onReorder: (id: string, direction: -1 | 1) => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(element.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const ShapeIcon = element.kind === 'ellipse' ? IconEllipse : IconRectangle
  const startRename = () => {
    setDraft(element.name)
    if (compact) {
      updatePrefs({ navCompact: false, navCollapsed: false })
      requestAnimationFrame(() => setEditing(true))
    } else {
      setEditing(true)
    }
  }
  const commitRename = () => { onRename(element.id, draft); setEditing(false) }

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  return (
    <ContextTarget
      className="vector-layer-context"
      label={`${element.name} actions`}
      touchActions={false}
      onOpen={() => onSelect(element.id)}
      items={[
        { label: 'Rename', icon: <IconPencil />, onSelect: () => requestAnimationFrame(startRename) },
        { label: 'Duplicate', icon: <IconCopy />, separatorBefore: false, onSelect: () => onDuplicate(element.id) },
        { label: element.visible ? 'Hide' : 'Show', icon: element.visible ? <IconEye /> : <IconEyeOff />, onSelect: () => onUpdate(element.id, { visible: !element.visible }) },
        { label: 'Move forward', icon: <IconBringForward />, disabled: index === count - 1, separatorBefore: false, onSelect: () => onReorder(element.id, 1) },
        { label: 'Move backward', icon: <IconSendBackward />, disabled: index === 0, separatorBefore: false, onSelect: () => onReorder(element.id, -1) },
        { label: 'Delete', icon: <IconTrash />, onSelect: () => onRemove(element.id) },
      ]}
    >
      <div className="vector-layer" data-selected={selected || undefined} data-hidden={!element.visible || undefined}>
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
            <button type="button" className="vector-layer__select" aria-pressed={selected} onClick={() => onSelect(element.id)} onDoubleClick={startRename}>
              <ShapeIcon />
              <span>{element.name}</span>
            </button>
          </Tooltip>
        )}
      </div>
    </ContextTarget>
  )
}
