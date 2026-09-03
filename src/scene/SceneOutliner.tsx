import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { collectionAncestors, descendantObjectIds, objectById } from '@/scene/document'
import {
  IconEyeClosed,
  IconEyeOpen,
  IconRenderOff,
  IconRenderOn,
  IconSelectableOff,
  IconSelectableOn,
} from '@/scene/icons'
import { sceneIcon } from '@/scene/iconRegistry'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import type { Collection, SceneDocument, SceneObject, SceneSelection } from '@/scene/types'
import { updatePrefs, useWorkspace } from '@/state/workspace'
import { Lockup } from '@/ui/BrandMark'
import { ContextMenuRoot, ContextTarget, type ContextMenuItem } from '@/ui/ContextMenu'
import { ThemeToggle } from '@/ui/ThemeToggle'
import { Tooltip } from '@/ui/Tooltip'
import {
  IconChevron,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFolderLayer,
  IconGroup,
  IconPanelLeft,
  IconPanelLeftClose,
  IconPencil,
  IconSearch,
  IconTrash,
} from '@/ui/icons'

/**
 * Blender's outliner: the document's tree, in the shell's left rail.
 *
 * It is the second way to reach everything the viewport can reach — pick an object, rename it,
 * hide it, move it into another collection — so every gesture here has a keyboard equivalent and
 * a selection made in either place is the same selection. The component draws what it is handed
 * and calls back; it never edits the document, which is what lets it be rendered in a test with
 * three lines of setup.
 */

/** Which properties tab a data row opens. */
type PropertiesTab = 'object' | 'modifiers' | 'material' | 'data'

export type SceneOutlinerProps = {
  document: SceneDocument
  selection: SceneSelection
  compact: boolean
  inert: boolean
  onNavigate: () => void
  onSelect: (ids: string[], active: string | null) => void
  onRename: (id: string, name: string) => void
  onRenameCollection: (id: string, name: string) => void
  /** Re-parent, or move to another collection; `keepTransform` comes from ⇧ during the drag. */
  onReparent: (
    id: string,
    target: { parentId?: string | null; collectionId?: string; index?: number },
    keepTransform: boolean,
  ) => void
  onUpdateObject: (id: string, patch: Partial<SceneObject>) => void
  onUpdateCollection: (id: string, patch: Partial<Collection>) => void
  onRunOperator: (id: string, params?: Record<string, unknown>) => void
  onOpenTab: (tab: PropertiesTab) => void
}

/* ------------------------------------------------------------------- rows */

type RowBase = {
  /** Unique across the whole tree, and stable while the document is: the key, and the map key. */
  id: string
  parentRowId: string | null
  depth: number
  label: string
  /** A name `sceneIcon` knows, or one it does not, in which case the row shows no icon. */
  icon: string
  foldable: boolean
}

type OutlinerRow = RowBase & (
  | { kind: 'collection'; collection: Collection }
  | { kind: 'object'; object: SceneObject }
  | { kind: 'data'; objectId: string; tab: PropertiesTab }
)

type DropEdge = 'before' | 'after' | 'into'
type DropTarget = { rowId: string; edge: DropEdge }

/** Below this a press is a click, and a click never moves anything. */
const DRAG_THRESHOLD_PX = 3
/** How close to the top or bottom of the list a drag has to come before the list scrolls itself. */
const EDGE_SCROLL_PX = 24
const EDGE_SCROLL_MAX_PX = 12

function objectIconName(object: SceneObject): string {
  if (object.data.kind === 'light') return `light-${object.data.light}`
  return object.kind
}

/**
 * The whole tree, flattened depth first, every row carrying the row above it that owns it.
 *
 * Flattening once and folding afterwards is what makes the rest cheap: the keyboard walk, the
 * filter and the drop hit test are all one pass over an array, and a row's ancestors are a walk up
 * `parentRowId` rather than a second traversal of the document.
 */
function buildRows(document: SceneDocument): OutlinerRow[] {
  const rows: OutlinerRow[] = []
  const objectsById = new Map(document.objects.map((object) => [object.id, object]))
  const seenCollections = new Set<string>()
  const seenObjects = new Set<string>()
  const root = document.collections[0] ?? null

  const dataRowsFor = (object: SceneObject, parentRowId: string, depth: number): OutlinerRow[] => {
    const data: OutlinerRow[] = []
    if (object.data.kind === 'mesh' && document.meshes[object.data.meshId]) {
      data.push({ kind: 'data', id: `${parentRowId}/mesh`, parentRowId, depth, label: 'Mesh', icon: 'tab-data', objectId: object.id, tab: 'data', foldable: false })
    }
    for (const modifier of object.modifiers) {
      data.push({ kind: 'data', id: `${parentRowId}/modifier/${modifier.id}`, parentRowId, depth, label: modifier.name, icon: `modifier-${modifier.kind}`, objectId: object.id, tab: 'modifiers', foldable: false })
    }
    object.materialSlots.forEach((materialId, index) => {
      const material = document.materials.find((candidate) => candidate.id === materialId)
      data.push({ kind: 'data', id: `${parentRowId}/material/${index}`, parentRowId, depth, label: material?.name ?? 'Material', icon: 'tab-material', objectId: object.id, tab: 'material', foldable: false })
    })
    return data
  }

  const pushObject = (object: SceneObject, parentRowId: string | null, depth: number) => {
    // A document with a parent loop would otherwise recurse for ever; the loop is drawn once.
    if (seenObjects.has(object.id)) return
    seenObjects.add(object.id)
    const id = `object:${object.id}`
    const data = dataRowsFor(object, id, depth + 1)
    const children = document.objects.filter((candidate) => candidate.parentId === object.id)
    rows.push({ kind: 'object', id, parentRowId, depth, label: object.name, icon: objectIconName(object), object, foldable: data.length > 0 || children.length > 0 })
    rows.push(...data)
    for (const child of children) pushObject(child, id, depth + 1)
  }

  const childCollections = (collection: Collection): Collection[] =>
    document.collections.filter((candidate, index) => {
      if (index === 0) return false
      // A collection with no parent belongs to the scene collection, the way Blender's do.
      return (candidate.parentId ?? root?.id) === collection.id
    })

  const pushCollection = (collection: Collection, parentRowId: string | null, depth: number) => {
    if (seenCollections.has(collection.id)) return
    seenCollections.add(collection.id)
    const id = `collection:${collection.id}`
    const children = childCollections(collection)
    // A child object hangs from its parent, not from its collection, even across collections.
    const objects = document.objects.filter((object) =>
      object.collectionId === collection.id && (!object.parentId || !objectsById.has(object.parentId)))
    rows.push({ kind: 'collection', id, parentRowId, depth, label: collection.name, icon: parentRowId === null ? 'scene-collection' : 'collection', collection, foldable: children.length > 0 || objects.length > 0 })
    for (const child of children) pushCollection(child, id, depth + 1)
    for (const object of objects) pushObject(object, id, depth + 1)
  }

  if (root) pushCollection(root, null, 0)

  // Whatever the walk could not reach — a collection in a loop, an object whose collection is gone
  // — is listed under the root anyway: an outliner that quietly omits part of the document is
  // worse than one that shows a row out of place.
  const orphanParent = root ? `collection:${root.id}` : null
  const orphanDepth = root ? 1 : 0
  for (const collection of document.collections) {
    if (!seenCollections.has(collection.id)) pushCollection(collection, orphanParent, orphanDepth)
  }
  for (const object of document.objects) {
    if (!seenObjects.has(object.id)) pushObject(object, orphanParent, orphanDepth)
  }
  return rows
}

/** The rows kept by a search: everything that matches, and everything above it. */
function filterRows(rows: OutlinerRow[], query: string): OutlinerRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  const byId = new Map(rows.map((row) => [row.id, row]))
  const keep = new Set<string>()
  for (const row of rows) {
    if (!row.label.toLowerCase().includes(needle)) continue
    keep.add(row.id)
    let parentId = row.parentRowId
    while (parentId && !keep.has(parentId)) {
      keep.add(parentId)
      parentId = byId.get(parentId)?.parentRowId ?? null
    }
  }
  return rows.filter((row) => keep.has(row.id))
}

function edgeSpeed(distance: number): number {
  return Math.min(EDGE_SCROLL_MAX_PX, Math.max(2, (EDGE_SCROLL_PX - distance) / 2))
}

/* -------------------------------------------------------------- the panel */

export function SceneOutliner({
  document,
  selection,
  compact,
  inert,
  onNavigate,
  onSelect,
  onRename,
  onRenameCollection,
  onReparent,
  onUpdateObject,
  onUpdateCollection,
  onRunOperator,
  onOpenTab,
}: SceneOutlinerProps) {
  const { prefs } = useWorkspace()
  const [query, setQuery] = useState('')
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ rowId: string; draft: string } | null>(null)
  const [dragRowId, setDragRowId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [keepTransform, setKeepTransform] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowElements = useRef(new Map<string, HTMLDivElement>())
  // The rename in flight, so that the blur which follows Enter or Escape cannot commit it twice.
  const editingRef = useRef<{ rowId: string; draft: string } | null>(null)
  const dragRef = useRef<{ rowId: string; pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const droppedRef = useRef(false)
  const revealedRef = useRef<string | null>(null)
  const scrollSpeed = useRef(0)
  const scrollFrame = useRef(0)

  const allRows = useMemo(() => buildRows(document), [document])
  const rowsById = useMemo(() => new Map(allRows.map((row) => [row.id, row])), [allRows])

  const isOpen = useCallback(
    (row: OutlinerRow) => openRows[row.id] ?? row.kind === 'collection',
    [openRows],
  )

  // A rail of icons has no room for the field, so its text is kept but not applied.
  const searching = !compact && query.trim().length > 0
  const rows = useMemo(() => {
    // A search shows its results wherever they are: folding is the reader's choice, not a filter.
    if (searching) return filterRows(allRows, query)
    const folded = new Set<string>()
    const visible: OutlinerRow[] = []
    for (const row of allRows) {
      if (row.parentRowId && folded.has(row.parentRowId)) {
        folded.add(row.id)
        continue
      }
      visible.push(row)
      if (row.foldable && !(openRows[row.id] ?? row.kind === 'collection')) folded.add(row.id)
    }
    return visible
  }, [allRows, openRows, query, searching])

  const focusRowId = focusedRowId && rows.some((row) => row.id === focusedRowId)
    ? focusedRowId
    : rows[0]?.id ?? null

  const setRowOpen = (rowId: string, open: boolean) =>
    setOpenRows((current) => ({ ...current, [rowId]: open }))

  const focusRow = (rowId: string) => {
    setFocusedRowId(rowId)
    rowElements.current.get(rowId)?.focus()
  }

  /*
   * A selection made in the viewport has to be visible here, so the active object's ancestors are
   * unfolded first and the row is scrolled to only once they are, which is why the effect reads
   * the fold state and runs again when it changes.
   */
  useEffect(() => {
    const activeId = selection.activeObjectId
    if (!activeId) {
      revealedRef.current = null
      return
    }
    if (revealedRef.current === activeId) return
    const row = rowsById.get(`object:${activeId}`)
    if (!row) return
    const ancestors: string[] = []
    let parentId = row.parentRowId
    while (parentId) {
      ancestors.push(parentId)
      parentId = rowsById.get(parentId)?.parentRowId ?? null
    }
    const shut = ancestors.filter((rowId) => {
      const ancestor = rowsById.get(rowId)
      return ancestor ? !(openRows[rowId] ?? ancestor.kind === 'collection') : false
    })
    if (shut.length > 0) {
      setOpenRows((current) => ({ ...current, ...Object.fromEntries(shut.map((rowId) => [rowId, true])) }))
      return
    }
    revealedRef.current = activeId
    rowElements.current.get(row.id)?.scrollIntoView?.({ block: 'nearest' })
  }, [selection.activeObjectId, openRows, rowsById])

  /* ------------------------------------------------------------ selection */

  const selectedIds = selection.objectIds

  const selectObject = (object: SceneObject, modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (modifiers.shiftKey) {
      const order = rows.flatMap((row) => (row.kind === 'object' ? [row.object.id] : []))
      const anchor = selection.activeObjectId ?? selectedIds[selectedIds.length - 1] ?? null
      const from = anchor ? order.indexOf(anchor) : -1
      const to = order.indexOf(object.id)
      if (from < 0 || to < 0) {
        onSelect([object.id], object.id)
        return
      }
      const range = from < to ? order.slice(from, to + 1) : order.slice(to, from + 1)
      onSelect([...new Set([...selectedIds, ...range])], object.id)
      return
    }
    if (modifiers.metaKey || modifiers.ctrlKey) {
      if (selectedIds.includes(object.id)) {
        const next = selectedIds.filter((id) => id !== object.id)
        onSelect(next, next[next.length - 1] ?? null)
      } else {
        onSelect([...selectedIds, object.id], object.id)
      }
      return
    }
    onSelect([object.id], object.id)
  }

  const activateRow = (row: OutlinerRow, modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    setFocusedRowId(row.id)
    if (row.kind === 'object') {
      selectObject(row.object, modifiers)
      return
    }
    if (row.kind === 'data') {
      // A data row is read only, but it says which object it belongs to and where to edit it.
      const owner = objectById(document, row.objectId)
      if (owner) onSelect([owner.id], owner.id)
      onOpenTab(row.tab)
    }
  }

  /* ------------------------------------------------------------- renaming */

  const editingRowId = editing?.rowId ?? null
  useEffect(() => {
    if (!editingRowId) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editingRowId])

  const setRename = (next: { rowId: string; draft: string } | null) => {
    editingRef.current = next
    setEditing(next)
  }

  const startRename = (row: OutlinerRow) => {
    if (row.kind === 'data') return
    // There is no room for a field in a rail of icons, so renaming opens the rail first.
    if (compact) updatePrefs({ navCompact: false, navCollapsed: false })
    setRename({ rowId: row.id, draft: row.label })
  }

  const finishRename = (commit: boolean) => {
    const current = editingRef.current
    setRename(null)
    if (!commit || !current) return
    const row = rowsById.get(current.rowId)
    const name = current.draft.trim()
    if (!row || !name || name === row.label) return
    if (row.kind === 'object') onRename(row.object.id, name)
    else if (row.kind === 'collection') onRenameCollection(row.collection.id, name)
  }

  /* --------------------------------------------------------------- drag */

  const startAutoScroll = useCallback(() => {
    if (scrollFrame.current !== 0) return
    const step = () => {
      const box = scrollRef.current
      if (!box || scrollSpeed.current === 0) {
        scrollFrame.current = 0
        return
      }
      box.scrollTop += scrollSpeed.current
      scrollFrame.current = requestAnimationFrame(step)
    }
    scrollFrame.current = requestAnimationFrame(step)
  }, [])

  const stopAutoScroll = useCallback(() => {
    scrollSpeed.current = 0
    if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = 0
  }, [])

  useEffect(() => stopAutoScroll, [stopAutoScroll])

  const runAutoScroll = (clientY: number) => {
    const box = scrollRef.current
    const rect = box?.getBoundingClientRect()
    // Without a measured box — a headless run, a rail that is not laid out — there is no edge.
    if (!box || !rect || rect.height <= 0) return
    const above = clientY - rect.top
    const below = rect.bottom - clientY
    scrollSpeed.current = above < EDGE_SCROLL_PX ? -edgeSpeed(above) : below < EDGE_SCROLL_PX ? edgeSpeed(below) : 0
    if (scrollSpeed.current !== 0) startAutoScroll()
  }

  const canDrop = (dragged: OutlinerRow, target: OutlinerRow): boolean => {
    if (dragged.kind === 'collection') {
      if (target.kind !== 'collection') return false
      if (document.collections[0]?.id === dragged.collection.id) return false
      if (target.collection.id === dragged.collection.id) return false
      return !collectionAncestors(document, target.collection.id).includes(dragged.collection.id)
    }
    if (dragged.kind !== 'object') return false
    if (target.kind === 'collection') return true
    if (target.kind !== 'object') return false
    return !descendantObjectIds(document, dragged.object.id).includes(target.object.id)
  }

  const dropTargetAt = (clientY: number, draggedRowId: string): DropTarget | null => {
    const dragged = rowsById.get(draggedRowId)
    if (!dragged) return null
    for (const row of rows) {
      if (row.kind === 'data') continue
      const rect = rowElements.current.get(row.id)?.getBoundingClientRect()
      if (!rect || rect.height <= 0 || clientY < rect.top || clientY >= rect.bottom) continue
      if (row.id === draggedRowId || !canDrop(dragged, row)) return null
      const ratio = (clientY - rect.top) / rect.height
      // A collection takes what is dropped on it whole: there is no order to sit before or after.
      const edge: DropEdge = row.kind === 'collection'
        ? 'into'
        : ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'into'
      return { rowId: row.id, edge }
    }
    return null
  }

  const applyDrop = (draggedRowId: string, target: DropTarget, keep: boolean) => {
    const dragged = rowsById.get(draggedRowId)
    const row = rowsById.get(target.rowId)
    if (!dragged || !row) return
    if (dragged.kind === 'collection') {
      // A collection moves through the operator that owns the tree's invariants — the scene
      // collection stays at the top, and nothing may be nested inside itself.
      if (row.kind === 'collection') {
        onRunOperator('collection.nest', { collectionId: dragged.collection.id, intoId: row.collection.id })
      }
      return
    }
    if (dragged.kind !== 'object') return
    if (row.kind === 'collection') {
      // The drop promised the object would sit in that collection, so it leaves its parent behind.
      onReparent(dragged.object.id, { collectionId: row.collection.id, parentId: null }, keep)
      return
    }
    if (row.kind !== 'object') return
    if (target.edge === 'into') {
      onReparent(dragged.object.id, { parentId: row.object.id }, keep)
      return
    }
    const parentId = row.object.parentId ?? null
    const siblings = document.objects.filter((candidate) =>
      candidate.id !== dragged.object.id
      && (candidate.parentId ?? null) === parentId
      && (parentId !== null || candidate.collectionId === row.object.collectionId))
    const position = siblings.findIndex((candidate) => candidate.id === row.object.id)
    const index = Math.max(0, target.edge === 'before' ? position : position + 1)
    onReparent(dragged.object.id, { parentId, collectionId: row.object.collectionId, index }, keep)
  }

  const onRowPointerDown = (event: ReactPointerEvent<HTMLDivElement>, row: OutlinerRow) => {
    droppedRef.current = false
    if (event.button !== 0 || row.kind === 'data') return
    // The toggles and the rename field own their own presses; a drag starts on the row itself.
    if (event.target instanceof Element && event.target.closest('button, input')) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { rowId: row.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }
  }

  const onRowPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return
      drag.moved = true
      setDragRowId(drag.rowId)
    }
    setKeepTransform(event.shiftKey)
    const next = dropTargetAt(event.clientY, drag.rowId)
    setDrop((current) => (current && next && current.rowId === next.rowId && current.edge === next.edge ? current : next))
    runAutoScroll(event.clientY)
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    stopAutoScroll()
    const target = drop
    setDragRowId(null)
    setDrop(null)
    setKeepTransform(false)
    if (!drag.moved) return
    // The press travelled: the click the browser sends next belongs to the drag, not to a selection.
    droppedRef.current = true
    if (commit && target) applyDrop(drag.rowId, target, event.shiftKey)
  }

  /* -------------------------------------------------------------- menus */

  /**
   * A menu entry with the chord the keymap gives its operator. A chord spelled the same as the
   * entry — Delete on Delete — is left off: it reads as a stutter, not as a shortcut.
   */
  const withShortcut = (label: string, operatorId: string) => {
    const binding = bindingFor(operatorId)
    const chord = binding ? shortcutLabel(binding) : ''
    return chord && chord !== label ? `${label} · ${chord}` : label
  }

  const itemsForRow = (row: OutlinerRow | null): ContextMenuItem[] => {
    const subject = row?.kind === 'data' ? rowsById.get(`object:${row.objectId}`) ?? null : row
    if (!subject) return []
    // The new collection lands under the row it was asked for, which is what pointing at one means.
    const parentId = subject.kind === 'collection' ? subject.collection.id
      : subject.kind === 'object' ? subject.object.collectionId
        : ''
    const newCollection: ContextMenuItem = {
      label: 'New collection',
      icon: <IconFolderLayer />,
      onSelect: () => onRunOperator('collection.new', { parentId }),
    }
    if (subject.kind === 'collection') {
      const collection = subject.collection
      const inside = document.objects.filter((object) => object.collectionId === collection.id)
      const isRoot = document.collections[0]?.id === collection.id
      return [
        {
          label: 'Select objects',
          icon: <IconGroup />,
          disabled: inside.length === 0,
          onSelect: () => onSelect(inside.map((object) => object.id), inside[inside.length - 1]?.id ?? null),
        },
        { label: withShortcut('Rename', 'object.rename'), icon: <IconPencil />, onSelect: () => requestAnimationFrame(() => startRename(subject)) },
        {
          label: collection.hidden ? 'Show' : 'Hide',
          icon: collection.hidden ? <IconEye /> : <IconEyeOff />,
          separatorBefore: false,
          onSelect: () => onUpdateCollection(collection.id, { hidden: !collection.hidden }),
        },
        newCollection,
        {
          label: 'Delete collection',
          icon: <IconTrash />,
          separatorBefore: false,
          disabled: isRoot,
          onSelect: () => onRunOperator('collection.delete', { collectionId: collection.id }),
        },
      ]
    }
    if (subject.kind !== 'object') return []
    const object = subject.object
    return [
      {
        label: 'Select hierarchy',
        icon: <IconGroup />,
        onSelect: () => onSelect([object.id, ...descendantObjectIds(document, object.id)], object.id),
      },
      { label: withShortcut('Duplicate', 'object.duplicate'), icon: <IconCopy />, separatorBefore: false, onSelect: () => onRunOperator('object.duplicate') },
      { label: withShortcut('Delete', 'object.delete'), icon: <IconTrash />, onSelect: () => onRunOperator('object.delete') },
      { label: 'Delete hierarchy', icon: <IconTrash />, separatorBefore: false, onSelect: () => onRunOperator('object.delete', { hierarchy: true }) },
      { label: withShortcut('Rename', 'object.rename'), icon: <IconPencil />, onSelect: () => requestAnimationFrame(() => startRename(subject)) },
      {
        // The keymap has an id for hiding, and only a "reveal everything" one for the way back, so
        // showing this one object again goes through the patch the eye already writes.
        label: object.visible ? withShortcut('Hide', 'object.hide') : 'Show',
        icon: object.visible ? <IconEyeOff /> : <IconEye />,
        separatorBefore: false,
        onSelect: () => (object.visible ? onRunOperator('object.hide') : onUpdateObject(object.id, { visible: true })),
      },
      newCollection,
      { label: withShortcut('Move to collection', 'object.moveToCollection'), icon: <IconFolderLayer />, separatorBefore: false, onSelect: () => onRunOperator('object.moveToCollection') },
    ]
  }

  const rowFromEventTarget = (target: EventTarget | null): OutlinerRow | null => {
    if (!(target instanceof Element)) return null
    const id = target.closest('[data-row-id]')?.getAttribute('data-row-id')
    return id ? rowsById.get(id) ?? null : null
  }

  /* ------------------------------------------------------------ keyboard */

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, row: OutlinerRow) => {
    const index = rows.findIndex((candidate) => candidate.id === row.id)
    const moveTo = (next: number) => {
      const target = rows[Math.min(rows.length - 1, Math.max(0, next))]
      if (!target) return
      event.preventDefault()
      focusRow(target.id)
    }
    switch (event.key) {
      case 'ArrowDown':
        moveTo(index + 1)
        return
      case 'ArrowUp':
        moveTo(index - 1)
        return
      case 'Home':
        moveTo(0)
        return
      case 'End':
        moveTo(rows.length - 1)
        return
      case 'ArrowRight':
        if (row.foldable && !isOpen(row)) {
          event.preventDefault()
          setRowOpen(row.id, true)
        } else {
          moveTo(index + 1)
        }
        return
      case 'ArrowLeft':
        if (row.foldable && isOpen(row)) {
          event.preventDefault()
          setRowOpen(row.id, false)
        } else if (row.parentRowId) {
          event.preventDefault()
          focusRow(row.parentRowId)
        }
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        activateRow(row, event)
        return
      case 'F2':
        event.preventDefault()
        startRename(row)
        return
      default:
    }
  }

  /* -------------------------------------------------------------- render */

  const dragged = dragRowId ? rowsById.get(dragRowId) ?? null : null
  const dropRow = drop ? rowsById.get(drop.rowId) ?? null : null
  const dropHint = dragged && dropRow && drop
    ? `${drop.edge === 'into' && dropRow.kind === 'object' ? `Parent ${dragged.label} to` : `Move ${dragged.label} ${drop.edge}`} ${dropRow.label}${keepTransform ? ' · keeping its transform' : ''}`
    : ''

  return (
    <nav className="nav-rail scene-outliner" aria-label="Outliner" data-compact={compact || undefined} inert={inert}>
      <div className="nav-rail__head">
        <Tooltip content="ParamRig" side="right" disabled={!compact}>
          <Link to="/" className="nav-brand" aria-label="ParamRig home" onClick={onNavigate}>
            <Lockup />
          </Link>
        </Tooltip>
        <div className="nav-rail__tools">
          <Tooltip content={compact ? 'Expand the outliner' : 'Collapse the outliner'} side={compact ? 'right' : 'top'}>
            <button
              type="button"
              className="icon-btn icon-btn--ghost nav-rail__compact"
              aria-pressed={prefs.navCompact}
              aria-label={compact ? 'Expand the outliner' : 'Collapse the outliner'}
              onClick={() => updatePrefs({ navCompact: !prefs.navCompact, navCollapsed: false })}
            >
              {compact ? <IconPanelLeft /> : <IconPanelLeftClose />}
            </button>
          </Tooltip>
        </div>
      </div>
      {compact ? null : (
        <label className="search-field scene-outliner__search">
          <IconSearch />
          <span className="visually-hidden">Filter the outliner</span>
          <input
            value={query}
            placeholder="Filter"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              setQuery('')
            }}
          />
        </label>
      )}
      <div className="nav-rail__body scroll-area" ref={scrollRef}>
        <ContextMenuRoot>
          <ContextTarget
            label="Outliner actions"
            touchActions={false}
            items={(event) => {
              const row = rowFromEventTarget(event.target)
              if (row) {
                setFocusedRowId(row.id)
                if (row.kind === 'object' && !selectedIds.includes(row.object.id)) {
                  onSelect([row.object.id], row.object.id)
                }
              }
              return itemsForRow(row)
            }}
          >
            <div className="scene-outliner__tree" role="tree" aria-label="Scene contents">
              {rows.map((row) => {
                const selected = row.kind === 'object' && selectedIds.includes(row.object.id)
                const active = row.kind === 'object' && selection.activeObjectId === row.object.id
                const expanded = row.foldable ? (searching ? true : isOpen(row)) : undefined
                const Icon = sceneIcon(row.icon)
                const renaming = editing?.rowId === row.id
                return (
                  <div
                    key={row.id}
                    ref={(element) => {
                      if (element) rowElements.current.set(row.id, element)
                      else rowElements.current.delete(row.id)
                    }}
                    className="scene-outliner__row"
                    role="treeitem"
                    aria-label={row.label}
                    aria-level={row.depth + 1}
                    aria-expanded={expanded}
                    aria-selected={row.kind === 'object' ? selected : undefined}
                    tabIndex={row.id === focusRowId ? 0 : -1}
                    data-row-id={row.id}
                    data-kind={row.kind}
                    data-selected={selected || undefined}
                    data-active={active || undefined}
                    data-hidden={(row.kind === 'object' && !row.object.visible) || (row.kind === 'collection' && (row.collection.hidden || row.collection.excluded)) || undefined}
                    data-dragging={dragRowId === row.id || undefined}
                    data-drop-edge={drop?.rowId === row.id ? drop.edge : undefined}
                    style={{ '--depth': row.depth } as CSSProperties}
                    onClick={(event) => {
                      if (droppedRef.current) {
                        droppedRef.current = false
                        return
                      }
                      if (event.target instanceof Element && event.target.closest('button, input')) return
                      activateRow(row, event)
                    }}
                    onDoubleClick={() => startRename(row)}
                    onKeyDown={(event) => onRowKeyDown(event, row)}
                    onFocus={() => setFocusedRowId(row.id)}
                    onPointerDown={(event) => onRowPointerDown(event, row)}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={(event) => endDrag(event, true)}
                    onPointerCancel={(event) => endDrag(event, false)}
                  >
                    {row.foldable ? (
                      <button
                        type="button"
                        className="scene-outliner__chevron"
                        tabIndex={row.id === focusRowId ? 0 : -1}
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.label}`}
                        onClick={() => setRowOpen(row.id, !isOpen(row))}
                      >
                        <IconChevron />
                      </button>
                    ) : (
                      <span className="scene-outliner__chevron scene-outliner__chevron--spacer" aria-hidden="true" />
                    )}
                    {renaming && editing ? (
                      <span className="scene-outliner__edit">
                        {Icon ? <Icon className="scene-outliner__icon" /> : null}
                        <input
                          ref={inputRef}
                          aria-label={`Rename ${row.label}`}
                          value={editing.draft}
                          maxLength={120}
                          onChange={(event) => setRename({ rowId: row.id, draft: event.currentTarget.value })}
                          onBlur={() => finishRename(true)}
                          onKeyDown={(event) => {
                            event.stopPropagation()
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              finishRename(true)
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              finishRename(false)
                            }
                          }}
                        />
                      </span>
                    ) : (
                      <Tooltip content={row.label} side="right" disabled={!compact}>
                        <span className="scene-outliner__label">
                          {Icon ? <Icon className="scene-outliner__icon" /> : null}
                          <span>{row.label}</span>
                        </span>
                      </Tooltip>
                    )}
                    {compact ? null : (
                      <span className="scene-outliner__toggles">
                        {row.kind === 'object' ? (
                          <>
                            <RowToggle
                              label={row.object.visible ? `Hide ${row.label}` : `Show ${row.label}`}
                              pressed={!row.object.visible}
                              tabIndex={row.id === focusRowId ? 0 : -1}
                              onToggle={() => onUpdateObject(row.object.id, { visible: !row.object.visible })}
                            >
                              {row.object.visible ? <IconEyeOpen /> : <IconEyeClosed />}
                            </RowToggle>
                            <RowToggle
                              label={row.object.selectable ? `Make ${row.label} unselectable` : `Make ${row.label} selectable`}
                              pressed={!row.object.selectable}
                              tabIndex={row.id === focusRowId ? 0 : -1}
                              onToggle={() => onUpdateObject(row.object.id, { selectable: !row.object.selectable })}
                            >
                              {row.object.selectable ? <IconSelectableOn /> : <IconSelectableOff />}
                            </RowToggle>
                            <RowToggle
                              label={row.object.renderable ? `Leave ${row.label} out of renders` : `Put ${row.label} back in renders`}
                              pressed={!row.object.renderable}
                              tabIndex={row.id === focusRowId ? 0 : -1}
                              onToggle={() => onUpdateObject(row.object.id, { renderable: !row.object.renderable })}
                            >
                              {row.object.renderable ? <IconRenderOn /> : <IconRenderOff />}
                            </RowToggle>
                          </>
                        ) : null}
                        {row.kind === 'collection' ? (
                          <>
                            <button
                              type="button"
                              className="scene-outliner__toggle scene-outliner__exclude"
                              role="checkbox"
                              aria-checked={!row.collection.excluded}
                              aria-label={`Include ${row.label} in the view`}
                              tabIndex={row.id === focusRowId ? 0 : -1}
                              onClick={() => onUpdateCollection(row.collection.id, { excluded: !row.collection.excluded })}
                            >
                              <span className="scene-outliner__box" aria-hidden="true" />
                            </button>
                            <RowToggle
                              label={row.collection.hidden ? `Show ${row.label}` : `Hide ${row.label}`}
                              pressed={Boolean(row.collection.hidden)}
                              tabIndex={row.id === focusRowId ? 0 : -1}
                              onToggle={() => onUpdateCollection(row.collection.id, { hidden: !row.collection.hidden })}
                            >
                              {row.collection.hidden ? <IconEyeClosed /> : <IconEyeOpen />}
                            </RowToggle>
                            <RowToggle
                              label={row.collection.selectable === false ? `Make ${row.label} selectable` : `Make ${row.label} unselectable`}
                              pressed={row.collection.selectable === false}
                              tabIndex={row.id === focusRowId ? 0 : -1}
                              onToggle={() => onUpdateCollection(row.collection.id, { selectable: row.collection.selectable === false })}
                            >
                              {row.collection.selectable === false ? <IconSelectableOff /> : <IconSelectableOn />}
                            </RowToggle>
                          </>
                        ) : null}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </ContextTarget>
        </ContextMenuRoot>
        {searching && rows.length === 0 ? (
          <p className="scene-outliner__empty">Nothing here matches “{query.trim()}”.</p>
        ) : null}
        {!searching && document.objects.length === 0 ? (
          <p className="scene-outliner__empty">This scene is empty. Add something with ⇧A in the viewport.</p>
        ) : null}
      </div>
      <div className="nav-rail__foot">
        <p className="scene-outliner__drop-hint" role="status">{dropHint}</p>
        <ThemeToggle compact={compact} />
      </div>
    </nav>
  )
}

/** One of the three switches at the end of a row: pressed means the thing is turned off. */
function RowToggle({ label, pressed, tabIndex, onToggle, children }: {
  label: string
  pressed: boolean
  tabIndex: number
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className="scene-outliner__toggle"
        aria-label={label}
        aria-pressed={pressed}
        data-active={pressed || undefined}
        tabIndex={tabIndex}
        onClick={onToggle}
      >
        {children}
      </button>
    </Tooltip>
  )
}
