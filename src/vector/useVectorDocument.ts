import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createVectorElement, getVectorDocument, saveVectorDocument } from '@/vector/document'
import { selectionBounds } from '@/vector/geometry'
import {
  ancestorIds,
  descendantIds,
  groupElements,
  moveInTree,
  siblingIndex,
  syncGroupBounds,
  ungroupElements,
} from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorGuide } from '@/vector/types'

type VectorHistory = {
  past: VectorDocument[]
  future: VectorDocument[]
}

export type DocumentPatch = Partial<Pick<VectorDocument, 'background' | 'width' | 'height' | 'guides'>>

function clone(document: VectorDocument): VectorDocument {
  return structuredClone(document)
}

export function useVectorDocument(documentId: string) {
  const initial = useMemo(() => getVectorDocument(documentId), [documentId])
  const [document, setDocument] = useState<VectorDocument | null>(initial)
  const [selectedIds, setSelectedIdsState] = useState<string[]>([])
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null)
  const [history, setHistory] = useState<VectorHistory>({ past: [], future: [] })
  const gestureStart = useRef<VectorDocument | null>(null)
  const latest = useRef<VectorDocument | null>(initial)
  latest.current = document

  useEffect(() => {
    setDocument(getVectorDocument(documentId))
    setSelectedIdsState([])
    setEnteredGroupId(null)
    setHistory({ past: [], future: [] })
    gestureStart.current = null
  }, [documentId])

  useEffect(() => {
    if (!document || gestureStart.current) return
    saveVectorDocument(document)
  }, [document])

  const replace = useCallback((update: (current: VectorDocument) => VectorDocument, record = true) => {
    setDocument((current) => {
      if (!current) return current
      const updated = update(current)
      if (updated === current) return current
      const synced = updated.elements === current.elements ? updated : { ...updated, elements: syncGroupBounds(updated.elements) }
      if (sameDocument(synced, current)) return current
      const next = { ...synced, updatedAt: new Date().toISOString() }
      if (record && !gestureStart.current) {
        setHistory((value) => ({ past: [...value.past.slice(-99), clone(current)], future: [] }))
      }
      return next
    })
  }, [])

  const beginGesture = useCallback(() => {
    if (gestureStart.current || !latest.current) return
    gestureStart.current = clone(latest.current)
  }, [])

  const endGesture = useCallback(() => {
    setDocument((current) => {
      const start = gestureStart.current
      gestureStart.current = null
      if (current && start && !sameDocument(current, start)) {
        setHistory((value) => ({ past: [...value.past.slice(-99), start], future: [] }))
        queueMicrotask(() => saveVectorDocument(current))
      }
      return current
    })
  }, [])

  const cancelGesture = useCallback(() => {
    const start = gestureStart.current
    gestureStart.current = null
    if (start) setDocument(start)
  }, [])

  const setSelectedIds = useCallback((ids: string[]) => {
    setSelectedIdsState((current) => sameIds(current, ids) ? current : ids)
  }, [])

  const setSelectedId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), [setSelectedIds])

  const updateElement = useCallback((id: string, patch: Partial<VectorElement>, record = true) => {
    replace((current) => ({
      ...current,
      elements: current.elements.map((element) => element.id === id ? { ...element, ...patch } : element),
    }), record)
  }, [replace])

  const updateElements = useCallback((updates: Array<{ id: string; patch: Partial<VectorElement> }>, record = true) => {
    if (updates.length === 0) return
    const byId = new Map(updates.map((update) => [update.id, update.patch]))
    replace((current) => ({
      ...current,
      elements: current.elements.map((element) => {
        const patch = byId.get(element.id)
        return patch ? { ...element, ...patch } : element
      }),
    }), record)
  }, [replace])

  /** Arbitrary element-list edit recorded as one undo entry (or folded into an open gesture). */
  const editElements = useCallback((edit: (elements: VectorElement[]) => VectorElement[], record = true) => {
    replace((current) => {
      const elements = edit(current.elements)
      return elements === current.elements ? current : { ...current, elements }
    }, record)
  }, [replace])

  const updateDocument = useCallback((patch: DocumentPatch, record = true) => {
    replace((current) => ({ ...current, ...patch }), record)
  }, [replace])

  const setGuides = useCallback((guides: VectorGuide[], record = true) => {
    replace((current) => ({ ...current, guides }), record)
  }, [replace])

  const addElements = useCallback((elements: VectorElement[], select = true) => {
    if (elements.length === 0) return
    replace((current) => ({ ...current, elements: [...current.elements, ...elements] }))
    if (select) setSelectedIds(elements.map((element) => element.id))
  }, [replace, setSelectedIds])

  const addElement = useCallback((element: VectorElement) => addElements([element]), [addElements])

  const removeElements = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    replace((current) => {
      const removed = new Set(ids.flatMap((id) => [id, ...descendantIds(current.elements, id)]))
      return { ...current, elements: current.elements.filter((element) => !removed.has(element.id)) }
    })
    setSelectedIdsState((selected) => selected.filter((id) => !ids.includes(id)))
  }, [replace])

  const removeElement = useCallback((id: string) => removeElements([id]), [removeElements])

  const renameElement = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    updateElement(id, { name: trimmed.slice(0, 120) })
  }, [updateElement])

  /**
   * Copies elements (with their descendants) right above the originals and returns the new ids
   * of the requested elements. Inside a gesture the copy joins the gesture's single undo entry.
   */
  const duplicateElements = useCallback((ids: string[], offset = 12): { ids: string[]; idMap: Record<string, string> } => {
    const idMap = new Map<string, string>()
    const base = latest.current
    const requested = ids.map((id) => {
      const copy = crypto.randomUUID()
      idMap.set(id, copy)
      return copy
    })
    if (base) {
      for (const source of base.elements.filter((element) => ids.includes(element.id))) {
        for (const id of descendantIds(base.elements, source.id)) if (!idMap.has(id)) idMap.set(id, crypto.randomUUID())
      }
    }
    replace((current) => {
      const sources = current.elements.filter((element) => ids.includes(element.id))
      if (sources.length === 0) return current
      const names = new Set(current.elements.map((element) => element.name))
      const blockIds = new Set(sources.flatMap((element) => [element.id, ...descendantIds(current.elements, element.id)]))
      for (const id of blockIds) if (!idMap.has(id)) idMap.set(id, crypto.randomUUID())
      const block = current.elements.filter((element) => blockIds.has(element.id)).map((element) => {
        const requestedCopy = ids.includes(element.id)
        const duplicate: VectorElement = {
          ...structuredClone(element),
          id: idMap.get(element.id)!,
          ...(element.parentId && idMap.has(element.parentId) ? { parentId: idMap.get(element.parentId)! } : {}),
          ...(element.kind !== 'group' ? { x: element.x + offset, y: element.y + offset } : {}),
        }
        if (requestedCopy) {
          const baseName = element.name.replace(/ copy(?: \d+)?$/i, '')
          let copyName = `${baseName} copy`
          let suffix = 2
          while (names.has(copyName)) copyName = `${baseName} copy ${suffix++}`
          names.add(copyName)
          duplicate.name = copyName.slice(0, 120)
        }
        return duplicate
      })
      const topIndex = Math.max(...[...blockIds].map((id) => current.elements.findIndex((element) => element.id === id)))
      const elements = [...current.elements]
      elements.splice(topIndex + 1, 0, ...block)
      return { ...current, elements }
    })
    return { ids: requested, idMap: Object.fromEntries(idMap) }
  }, [replace])

  const duplicateElement = useCallback((id: string) => {
    const [copy] = duplicateElements([id]).ids
    if (copy) setSelectedIds([copy])
  }, [duplicateElements, setSelectedIds])

  const duplicateSelection = useCallback(() => {
    const copies = duplicateElements(selectedIds).ids
    if (copies.length) setSelectedIds(copies)
  }, [duplicateElements, selectedIds, setSelectedIds])

  const rename = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    replace((current) => ({ ...current, name: trimmed.slice(0, 120) }))
  }, [replace])

  const resizeDocument = useCallback((width: number, height: number) => {
    replace((current) => ({ ...current, width, height }))
  }, [replace])

  const reorderElement = useCallback((id: string, direction: -1 | 1) => {
    replace((current) => {
      const element = current.elements.find((item) => item.id === id)
      if (!element) return current
      const index = siblingIndex(current.elements, id)
      const target = index + direction
      const siblings = current.elements.filter((item) => (item.parentId ?? null) === (element.parentId ?? null))
      if (target < 0 || target >= siblings.length) return current
      const insertion = direction > 0 ? target + 1 : target
      const moved = moveInTree(current.elements, id, { parentId: element.parentId ?? null, index: insertion })
      return moved === current.elements ? current : { ...current, elements: moved }
    })
  }, [replace])

  const moveElementInTree = useCallback((id: string, target: { parentId: string | null; index: number }) => {
    replace((current) => {
      const moved = moveInTree(current.elements, id, target)
      return moved === current.elements ? current : { ...current, elements: moved }
    })
  }, [replace])

  const groupSelection = useCallback((ids: string[]): string | null => {
    if (ids.length === 0) return null
    const group = createVectorElement('group', { x: 0, y: 0, width: 1, height: 1 })
    let created = false
    replace((current) => {
      const members = current.elements.filter((element) => ids.includes(element.id))
      if (members.length === 0) return current
      created = true
      return { ...current, elements: groupElements(current.elements, members.map((element) => element.id), group) }
    })
    return created ? group.id : group.id
  }, [replace])

  const ungroup = useCallback((ids: string[]) => {
    replace((current) => {
      let elements = current.elements
      for (const id of ids) elements = ungroupElements(elements, id)
      return elements === current.elements ? current : { ...current, elements }
    })
  }, [replace])

  const undo = useCallback(() => {
    if (gestureStart.current) return
    setHistory((value) => {
      const previous = value.past.at(-1)
      if (!previous) return value
      setDocument((current) => current ? clone(previous) : current)
      return {
        past: value.past.slice(0, -1),
        future: document ? [clone(document), ...value.future].slice(0, 100) : value.future,
      }
    })
  }, [document])

  const redo = useCallback(() => {
    if (gestureStart.current) return
    setHistory((value) => {
      const next = value.future[0]
      if (!next) return value
      setDocument((current) => current ? clone(next) : current)
      return {
        past: document ? [...value.past, clone(document)].slice(-100) : value.past,
        future: value.future.slice(1),
      }
    })
  }, [document])

  const elements = document?.elements ?? []
  const validSelectedIds = selectedIds.filter((id) => elements.some((element) => element.id === id))
  const selectedId = validSelectedIds.at(-1) ?? null
  const selected = elements.find((element) => element.id === selectedId) ?? null
  const selectedElements = elements.filter((element) => validSelectedIds.includes(element.id))
  const selectedBounds = selectedElements.length ? selectionBounds(selectedElements) : null
  const enteredGroup = enteredGroupId && elements.find((element) => element.id === enteredGroupId && element.kind === 'group') ? enteredGroupId : null

  useEffect(() => {
    if (!document) return
    const ids = selectedIds.filter((id) => document.elements.some((element) => element.id === id))
    if (ids.length !== selectedIds.length) setSelectedIdsState(ids)
    if (!enteredGroupId) return
    const exists = document.elements.some((element) => element.id === enteredGroupId && element.kind === 'group')
    const outside = ids.some((id) => id !== enteredGroupId && !ancestorIds(document.elements, id).includes(enteredGroupId))
    if (!exists || outside) setEnteredGroupId(null)
  }, [document, selectedIds, enteredGroupId])

  return {
    document,
    selected,
    selectedId,
    selectedIds: validSelectedIds,
    selectedElements,
    selectedBounds,
    enteredGroupId: enteredGroup,
    setEnteredGroupId,
    setSelectedId,
    setSelectedIds,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    beginGesture,
    endGesture,
    cancelGesture,
    updateElement,
    updateElements,
    editElements,
    updateDocument,
    setGuides,
    addElement,
    addElements,
    removeElement,
    removeElements,
    renameElement,
    duplicateElement,
    duplicateElements,
    duplicateSelection,
    rename,
    resizeDocument,
    reorderElement,
    moveElementInTree,
    groupSelection,
    ungroup,
  }
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameDocument(a: VectorDocument, b: VectorDocument): boolean {
  return JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' })
}
