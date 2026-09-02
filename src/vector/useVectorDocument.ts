import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { reorderIndex } from '@/vector/commands'
import { countedLabel, DEFAULT_STEP_LABEL, START_LABEL, type HistoryStep } from '@/vector/history'
import { createVectorElement, getVectorDocument, MAX_VERSIONS, saveVectorDocument } from '@/vector/document'
import { selectionBounds } from '@/vector/geometry'
import {
  ancestorIds,
  descendantIds,
  groupElements,
  moveInTree,
  syncGroupBounds,
  ungroupElements,
} from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorGuide } from '@/vector/types'

/** A recorded state plus the name of the edit that led away from it. */
type HistoryEntry = { document: VectorDocument; label: string; at: number }

type VectorHistory = {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

const HISTORY_LIMIT = 100

const ORDER_LABELS = { forward: 'Bring forward', backward: 'Send backward', front: 'Bring to front', back: 'Send to back' } as const

export type DocumentPatch = Partial<Pick<VectorDocument, 'background' | 'width' | 'height' | 'guides' | 'exportPresets' | 'styles' | 'swatches' | 'recentColors'>>

function clone(document: VectorDocument): VectorDocument {
  return structuredClone(document)
}

export function useVectorDocument(documentId: string) {
  const initial = useMemo(() => getVectorDocument(documentId), [documentId])
  const [document, setDocument] = useState<VectorDocument | null>(initial)
  const [selectedIds, setSelectedIdsState] = useState<string[]>([])
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null)
  const [history, setHistory] = useState<VectorHistory>({ past: [], future: [] })
  /**
   * History is mirrored in a ref and written through a helper: recording from inside a state
   * updater would run twice under StrictMode and record every edit twice.
   */
  const historyRef = useRef<VectorHistory>(history)
  historyRef.current = history
  const gestureStart = useRef<VectorDocument | null>(null)
  const gestureLabel = useRef<string>(DEFAULT_STEP_LABEL)
  const openedAt = useRef(Date.now())
  const loadedId = useRef(documentId)
  const latest = useRef<VectorDocument | null>(initial)
  latest.current = document

  useEffect(() => {
    if (loadedId.current === documentId) return
    loadedId.current = documentId
    setDocument(getVectorDocument(documentId))
    setSelectedIdsState([])
    setEnteredGroupId(null)
    historyRef.current = { past: [], future: [] }
    setHistory(historyRef.current)
    gestureStart.current = null
    openedAt.current = Date.now()
  }, [documentId])

  useEffect(() => {
    if (!document || gestureStart.current) return
    saveVectorDocument(document)
  }, [document])

  const writeHistory = useCallback((next: VectorHistory) => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const replace = useCallback((update: (current: VectorDocument) => VectorDocument, record = true, label = DEFAULT_STEP_LABEL) => {
    const current = latest.current
    if (!current) return
    const updated = update(current)
    if (updated === current) return
    const synced = updated.elements === current.elements ? updated : { ...updated, elements: syncGroupBounds(updated.elements) }
    if (sameDocument(synced, current)) return
    const next = { ...synced, updatedAt: new Date().toISOString() }
    if (record && !gestureStart.current) {
      writeHistory({ past: [...historyRef.current.past.slice(-(HISTORY_LIMIT - 1)), { document: clone(current), label, at: Date.now() }], future: [] })
    }
    latest.current = next
    setDocument(next)
  }, [writeHistory])

  const beginGesture = useCallback((label = DEFAULT_STEP_LABEL) => {
    if (gestureStart.current || !latest.current) return
    gestureStart.current = clone(latest.current)
    gestureLabel.current = label
  }, [])

  const endGesture = useCallback((label?: string) => {
    const name = label ?? gestureLabel.current
    const start = gestureStart.current
    const current = latest.current
    gestureStart.current = null
    gestureLabel.current = DEFAULT_STEP_LABEL
    if (!current || !start || sameDocument(current, start)) return
    writeHistory({ past: [...historyRef.current.past.slice(-(HISTORY_LIMIT - 1)), { document: start, label: name, at: Date.now() }], future: [] })
    queueMicrotask(() => saveVectorDocument(current))
  }, [writeHistory])

  const cancelGesture = useCallback(() => {
    const start = gestureStart.current
    gestureStart.current = null
    gestureLabel.current = DEFAULT_STEP_LABEL
    if (!start) return
    latest.current = start
    setDocument(start)
  }, [])

  const setSelectedIds = useCallback((ids: string[]) => {
    setSelectedIdsState((current) => sameIds(current, ids) ? current : ids)
  }, [])

  const setSelectedId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), [setSelectedIds])

  const updateElement = useCallback((id: string, patch: Partial<VectorElement>, record = true, label?: string) => {
    replace((current) => ({
      ...current,
      elements: current.elements.map((element) => element.id === id ? { ...element, ...patch } : element),
    }), record, label)
  }, [replace])

  const updateElements = useCallback((updates: Array<{ id: string; patch: Partial<VectorElement> }>, record = true, label?: string) => {
    if (updates.length === 0) return
    const byId = new Map(updates.map((update) => [update.id, update.patch]))
    replace((current) => ({
      ...current,
      elements: current.elements.map((element) => {
        const patch = byId.get(element.id)
        return patch ? { ...element, ...patch } : element
      }),
    }), record, label)
  }, [replace])

  /** Arbitrary element-list edit recorded as one undo entry (or folded into an open gesture). */
  const editElements = useCallback((edit: (elements: VectorElement[]) => VectorElement[], record = true, label?: string) => {
    replace((current) => {
      const elements = edit(current.elements)
      return elements === current.elements ? current : { ...current, elements }
    }, record, label)
  }, [replace])

  /** Arbitrary document-level edit recorded as one undo entry, for changes that span both. */
  const editDocument = useCallback((edit: (current: VectorDocument) => VectorDocument, record = true, label?: string) => {
    replace(edit, record, label)
  }, [replace])

  const updateDocument = useCallback((patch: DocumentPatch, record = true, label = 'Change page') => {
    replace((current) => ({ ...current, ...patch }), record, label)
  }, [replace])

  const setGuides = useCallback((guides: VectorGuide[], record = true, label = 'Change guides') => {
    replace((current) => ({ ...current, guides }), record, label)
  }, [replace])

  const addElements = useCallback((elements: VectorElement[], select = true, label?: string) => {
    if (elements.length === 0) return
    replace((current) => ({ ...current, elements: [...current.elements, ...elements] }), true, label ?? countedLabel(`Add ${elements[0]!.kind}`, elements.length))
    if (select) setSelectedIds(elements.map((element) => element.id))
  }, [replace, setSelectedIds])

  const addElement = useCallback((element: VectorElement) => addElements([element]), [addElements])

  const removeElements = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    replace((current) => {
      const removed = new Set(ids.flatMap((id) => [id, ...descendantIds(current.elements, id)]))
      return { ...current, elements: current.elements.filter((element) => !removed.has(element.id)) }
    }, true, countedLabel('Delete', ids.length))
    setSelectedIdsState((selected) => selected.filter((id) => !ids.includes(id)))
  }, [replace])

  const removeElement = useCallback((id: string) => removeElements([id]), [removeElements])

  const renameElement = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    updateElement(id, { name: trimmed.slice(0, 120) }, true, 'Rename layer')
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
    }, true, countedLabel('Duplicate', ids.length))
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
    replace((current) => ({ ...current, name: trimmed.slice(0, 120) }), true, 'Rename document')
  }, [replace])

  const resizeDocument = useCallback((width: number, height: number) => {
    replace((current) => ({ ...current, width, height }), true, 'Resize page')
  }, [replace])

  const reorderElement = useCallback((id: string, direction: -1 | 1) => {
    replace((current) => {
      const element = current.elements.find((item) => item.id === id)
      if (!element) return current
      const index = reorderIndex(current.elements, id, direction > 0 ? 'forward' : 'backward')
      if (index === null) return current
      const moved = moveInTree(current.elements, id, { parentId: element.parentId ?? null, index })
      return moved === current.elements ? current : { ...current, elements: moved }
    }, true, direction > 0 ? 'Bring forward' : 'Send backward')
  }, [replace])

  /**
   * Ordering for a whole selection. Objects move one at a time, in the order that keeps their
   * relative stacking: to the front bottom-most first, to the back top-most first.
   */
  const orderElements = useCallback((ids: string[], mode: 'forward' | 'backward' | 'front' | 'back') => {
    if (ids.length === 0) return
    replace((current) => {
      const position = (id: string) => current.elements.findIndex((element) => element.id === id)
      const ascending = [...ids].sort((a, b) => position(a) - position(b))
      const sequence = mode === 'front' || mode === 'backward' ? ascending : [...ascending].reverse()
      let elements = current.elements
      for (const id of sequence) {
        const index = reorderIndex(elements, id, mode)
        if (index === null) continue
        const element = elements.find((item) => item.id === id)!
        elements = moveInTree(elements, id, { parentId: element.parentId ?? null, index })
      }
      return elements === current.elements ? current : { ...current, elements }
    }, true, ORDER_LABELS[mode])
  }, [replace])

  const moveElementInTree = useCallback((id: string, target: { parentId: string | null; index: number }) => {
    replace((current) => {
      const moved = moveInTree(current.elements, id, target)
      return moved === current.elements ? current : { ...current, elements: moved }
    }, true, 'Reorder')
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
    }, true, 'Group')
    return created ? group.id : group.id
  }, [replace])

  const ungroup = useCallback((ids: string[]) => {
    replace((current) => {
      let elements = current.elements
      for (const id of ids) elements = ungroupElements(elements, id)
      return elements === current.elements ? current : { ...current, elements }
    }, true, 'Ungroup')
  }, [replace])

  const saveVersion = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 80) || `Version ${(latest.current?.versions?.length ?? 0) + 1}`
    replace((current) => ({
      ...current,
      versions: [...(current.versions ?? []), { id: crypto.randomUUID(), name: trimmed, createdAt: new Date().toISOString(), elements: structuredClone(current.elements), guides: structuredClone(current.guides) }].slice(-MAX_VERSIONS),
    }), true, `Save version “${trimmed}”`)
  }, [replace])

  const restoreVersion = useCallback((id: string) => {
    replace((current) => {
      const version = current.versions?.find((item) => item.id === id)
      if (!version) return current
      return { ...current, elements: structuredClone(version.elements), guides: structuredClone(version.guides) }
    }, true, 'Restore version')
    setSelectedIdsState([])
  }, [replace])

  const deleteVersion = useCallback((id: string) => {
    replace((current) => {
      const versions = (current.versions ?? []).filter((item) => item.id !== id)
      return { ...current, versions: versions.length ? versions : undefined }
    }, true, 'Delete version')
  }, [replace])

  const undo = useCallback(() => {
    if (gestureStart.current) return
    const value = historyRef.current
    const previous = value.past.at(-1)
    const current = latest.current
    if (!previous || !current) return
    // The state we leave keeps the name of the edit that produced it, so redo reads the same.
    writeHistory({
      past: value.past.slice(0, -1),
      future: [{ document: clone(current), label: previous.label, at: previous.at }, ...value.future].slice(0, HISTORY_LIMIT),
    })
    latest.current = clone(previous.document)
    setDocument(latest.current)
  }, [writeHistory])

  const redo = useCallback(() => {
    if (gestureStart.current) return
    const value = historyRef.current
    const next = value.future[0]
    const current = latest.current
    if (!next || !current) return
    writeHistory({
      past: [...value.past, { document: clone(current), label: next.label, at: next.at }].slice(-HISTORY_LIMIT),
      future: value.future.slice(1),
    })
    latest.current = clone(next.document)
    setDocument(latest.current)
  }, [writeHistory])

  /** Sends the document to any recorded state in one move, undoing or redoing as far as needed. */
  const goToStep = useCallback((index: number) => {
    if (gestureStart.current) return
    const value = historyRef.current
    const current = latest.current
    if (!current) return
    // One array of states, each named after the edit that produced it.
    const states: HistoryEntry[] = [
      { document: value.past[0]?.document ?? current, label: START_LABEL, at: value.past[0]?.at ?? openedAt.current },
      ...value.past.map((entry, position) => ({
        document: position + 1 < value.past.length ? value.past[position + 1]!.document : current,
        label: entry.label,
        at: entry.at,
      })),
      ...value.future,
    ]
    const position = value.past.length
    const target = Math.max(0, Math.min(states.length - 1, index))
    if (target === position) return
    writeHistory({
      past: states.slice(0, target).map((entry, at) => ({ document: entry.document, label: states[at + 1]!.label, at: states[at + 1]!.at })),
      future: states.slice(target + 1),
    })
    latest.current = clone(states[target]!.document)
    setDocument(latest.current)
  }, [writeHistory])

  const historySteps: HistoryStep[] = [
    { index: 0, label: START_LABEL, at: history.past[0]?.at ?? openedAt.current },
    ...history.past.map((entry, index) => ({ index: index + 1, label: entry.label, at: entry.at })),
    ...history.future.map((entry, index) => ({ index: history.past.length + 1 + index, label: entry.label, at: entry.at })),
  ]

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
    editDocument,
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
    orderElements,
    moveElementInTree,
    groupSelection,
    ungroup,
    saveVersion,
    restoreVersion,
    deleteVersion,
    historyDepth: history.past.length,
    historySteps,
    historyIndex: history.past.length,
    goToStep,
  }
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameDocument(a: VectorDocument, b: VectorDocument): boolean {
  return JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' })
}
