import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVectorDocument, createVectorElement } from '@/vector/document'
import { useVectorDocument } from '@/vector/useVectorDocument'

describe('useVectorDocument transactions', () => {
  let counter = 0
  beforeEach(() => {
    localStorage.clear()
    counter = 0
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `id-${counter++}`) })
  })
  afterEach(() => vi.unstubAllGlobals())

  function setup() {
    const document = createVectorDocument()
    const hook = renderHook(() => useVectorDocument(document.id))
    act(() => hook.result.current.addElement(createVectorElement('rectangle', { x: 0, y: 0, width: 100, height: 100 })))
    return hook
  }

  it('records one undo entry per pointer gesture and restores on cancel', () => {
    const hook = setup()
    const id = hook.result.current.selectedId!
    act(() => {
      hook.result.current.beginGesture()
      hook.result.current.updateElement(id, { x: 10 }, false)
      hook.result.current.updateElement(id, { x: 20 }, false)
      hook.result.current.updateElement(id, { x: 30 }, false)
      hook.result.current.endGesture()
    })
    expect(hook.result.current.selected?.x).toBe(30)
    act(() => hook.result.current.undo())
    expect(hook.result.current.selected?.x).toBe(0)
    act(() => hook.result.current.redo())
    expect(hook.result.current.selected?.x).toBe(30)
    act(() => {
      hook.result.current.beginGesture()
      hook.result.current.updateElement(id, { x: 300 }, false)
      hook.result.current.cancelGesture()
    })
    expect(hook.result.current.selected?.x).toBe(30)
    expect(hook.result.current.canUndo).toBe(true)
  })

  it('folds an Alt-drag duplicate and its move into one entry', () => {
    const hook = setup()
    const id = hook.result.current.selectedId!
    let copies: string[] = []
    act(() => {
      hook.result.current.beginGesture()
      copies = hook.result.current.duplicateElements([id], 0)
    })
    act(() => {
      hook.result.current.updateElement(copies[0]!, { x: 50 }, false)
      hook.result.current.endGesture()
    })
    expect(hook.result.current.document?.elements).toHaveLength(2)
    expect(hook.result.current.document?.elements[1]).toMatchObject({ id: copies[0], x: 50, name: 'Rectangle copy' })
    act(() => hook.result.current.undo())
    expect(hook.result.current.document?.elements).toHaveLength(1)
  })

  it('groups, ungroups and removes descendants together', () => {
    const hook = setup()
    act(() => hook.result.current.addElement(createVectorElement('ellipse', { x: 200, y: 0, width: 50, height: 50 })))
    const ids = hook.result.current.document!.elements.map((element) => element.id)
    let groupId: string | null = null
    act(() => { groupId = hook.result.current.groupSelection(ids) })
    const group = hook.result.current.document!.elements.find((element) => element.id === groupId)!
    expect(group).toMatchObject({ kind: 'group', x: 0, y: 0, width: 250, height: 100 })
    expect(hook.result.current.document!.elements.map((element) => element.id)).toEqual([...ids, groupId])
    act(() => hook.result.current.updateElement(ids[1]!, { x: 400 }))
    expect(hook.result.current.document!.elements.find((element) => element.id === groupId)?.width).toBe(450)
    act(() => hook.result.current.removeElements([groupId!]))
    expect(hook.result.current.document!.elements).toHaveLength(0)
    act(() => hook.result.current.undo())
    expect(hook.result.current.document!.elements).toHaveLength(3)
    act(() => hook.result.current.ungroup([groupId!]))
    expect(hook.result.current.document!.elements.map((element) => element.id)).toEqual(ids)
  })

  it('reorders among siblings and clears stale selection', () => {
    const hook = setup()
    act(() => hook.result.current.addElement(createVectorElement('ellipse', { x: 200, y: 0, width: 50, height: 50 })))
    const [first, second] = hook.result.current.document!.elements.map((element) => element.id)
    act(() => hook.result.current.reorderElement(first!, 1))
    expect(hook.result.current.document!.elements.map((element) => element.id)).toEqual([second, first])
    act(() => hook.result.current.setSelectedIds([first!, second!]))
    act(() => hook.result.current.removeElements([second!]))
    expect(hook.result.current.selectedIds).toEqual([first])
  })
})
