import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getVectorDocument, saveVectorDocument } from '@/vector/document'
import type { VectorDocument, VectorElement } from '@/vector/types'

type VectorHistory = {
  past: VectorDocument[]
  future: VectorDocument[]
}

function clone(document: VectorDocument): VectorDocument {
  return structuredClone(document)
}

export function useVectorDocument(documentId: string) {
  const initial = useMemo(() => getVectorDocument(documentId), [documentId])
  const [document, setDocument] = useState<VectorDocument | null>(initial)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [history, setHistory] = useState<VectorHistory>({ past: [], future: [] })
  const gestureStart = useRef<VectorDocument | null>(null)

  useEffect(() => {
    setDocument(getVectorDocument(documentId))
    setSelectedIds([])
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
      if (sameDocument(updated, current)) return current
      const next = { ...updated, updatedAt: new Date().toISOString() }
      if (record && !gestureStart.current) {
        setHistory((value) => ({ past: [...value.past.slice(-99), clone(current)], future: [] }))
      }
      return next
    })
  }, [])

  const beginGesture = useCallback(() => {
    setDocument((current) => {
      if (current && !gestureStart.current) gestureStart.current = clone(current)
      return current
    })
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

  const updateElement = useCallback((id: string, patch: Partial<VectorElement>, record = true) => {
    replace((current) => ({
      ...current,
      elements: current.elements.map((element) => element.id === id ? { ...element, ...patch } : element),
    }), record)
  }, [replace])

  const updateElements = useCallback((updates: Array<{ id: string; patch: Partial<VectorElement> }>, record = true) => {
    const byId = new Map(updates.map((update) => [update.id, update.patch]))
    replace((current) => ({
      ...current,
      elements: current.elements.map((element) => {
        const patch = byId.get(element.id)
        return patch ? { ...element, ...patch } : element
      }),
    }), record)
  }, [replace])

  const updateDocument = useCallback((patch: Partial<Pick<VectorDocument, 'background'>>, record = true) => {
    replace((current) => ({ ...current, ...patch }), record)
  }, [replace])

  const setSelectedId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), [])

  const addElement = useCallback((element: VectorElement) => {
    replace((current) => ({ ...current, elements: [...current.elements, element] }))
    setSelectedIds([element.id])
  }, [replace])

  const removeElement = useCallback((id: string) => {
    replace((current) => ({ ...current, elements: current.elements.filter((element) => element.id !== id) }))
    setSelectedIds((selected) => selected.filter((selectedId) => selectedId !== id))
  }, [replace])

  const removeElements = useCallback((ids: string[]) => {
    const removed = new Set(ids)
    replace((current) => ({ ...current, elements: current.elements.filter((element) => !removed.has(element.id)) }))
    setSelectedIds((selected) => selected.filter((id) => !removed.has(id)))
  }, [replace])

  const renameElement = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    updateElement(id, { name: trimmed.slice(0, 120) })
  }, [updateElement])

  const duplicateElement = useCallback((id: string) => {
    const duplicateId = crypto.randomUUID()
    replace((current) => {
      const index = current.elements.findIndex((element) => element.id === id)
      if (index < 0) return current
      const source = current.elements[index]!
      const baseName = source.name.replace(/ copy(?: \d+)?$/i, '')
      const names = new Set(current.elements.map((element) => element.name))
      let copyName = `${baseName} copy`
      let suffix = 2
      while (names.has(copyName)) copyName = `${baseName} copy ${suffix++}`
      const duplicate: VectorElement = {
        ...structuredClone(source),
        id: duplicateId,
        name: copyName.slice(0, 120),
        x: source.x + 12,
        y: source.y + 12,
      }
      const elements = [...current.elements]
      elements.splice(index + 1, 0, duplicate)
      return { ...current, elements }
    })
    setSelectedIds([duplicateId])
  }, [replace])

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
      const index = current.elements.findIndex((element) => element.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.elements.length) return current
      const elements = [...current.elements]
      const [element] = elements.splice(index, 1)
      elements.splice(target, 0, element!)
      return { ...current, elements }
    })
  }, [replace])

  const moveElement = useCallback((id: string, targetIndex: number) => {
    replace((current) => {
      const index = current.elements.findIndex((element) => element.id === id)
      if (index < 0) return current
      const target = Math.min(current.elements.length - 1, Math.max(0, targetIndex))
      if (target === index) return current
      const elements = [...current.elements]
      const [element] = elements.splice(index, 1)
      elements.splice(target, 0, element!)
      return { ...current, elements }
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

  const selectedId = selectedIds.at(-1) ?? null
  const selected = document?.elements.find((element) => element.id === selectedId) ?? null
  const selectedElements = document?.elements.filter((element) => selectedIds.includes(element.id)) ?? []

  return {
    document,
    selected,
    selectedId,
    selectedIds,
    selectedElements,
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
    updateDocument,
    addElement,
    removeElement,
    removeElements,
    renameElement,
    duplicateElement,
    rename,
    resizeDocument,
    reorderElement,
    moveElement,
  }
}

function sameDocument(a: VectorDocument, b: VectorDocument): boolean {
  return JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' })
}
