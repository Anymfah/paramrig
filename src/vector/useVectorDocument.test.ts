import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVectorDocument, createVectorElement, saveVectorDocument } from '@/vector/document'
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

  describe('the transform ⌘D repeats', () => {
    it('offsets the first copy and repeats the move on the next one', () => {
      const hook = setup()
      const original = hook.result.current.selectedId!

      act(() => hook.result.current.duplicateSelection())
      const first = hook.result.current.selectedId!
      const copy = () => hook.result.current.document!.elements.find((element) => element.id === first)!

      expect(copy()).toMatchObject({ x: 12, y: 12 })

      // Moving the copy is what arms the repeat.
      act(() => hook.result.current.updateElements([{ id: first, patch: { x: 112, y: 12 } }]))
      act(() => hook.result.current.duplicateSelection())
      const second = hook.result.current.document!.elements.find((element) => element.id === hook.result.current.selectedId!)!

      expect(second).toMatchObject({ x: 212, y: 12 })
      expect(hook.result.current.document!.elements.map((element) => element.id)).toContain(original)

      // And again, from the copy of the copy.
      act(() => hook.result.current.duplicateSelection())
      expect(hook.result.current.document!.elements.find((element) => element.id === hook.result.current.selectedId!)).toMatchObject({ x: 312, y: 12 })
    })

    it('forgets the transform after any other edit', () => {
      const hook = setup()
      act(() => hook.result.current.duplicateSelection())
      const first = hook.result.current.selectedId!
      act(() => hook.result.current.updateElements([{ id: first, patch: { x: 112, y: 12 } }]))

      // Something else entirely happens in between.
      act(() => hook.result.current.updateElement(first, { opacity: 0.5 }))
      act(() => hook.result.current.duplicateSelection())

      expect(hook.result.current.document!.elements.find((element) => element.id === hook.result.current.selectedId!)).toMatchObject({ x: 124, y: 24 })
    })

    it('gives up the repeat when the selection moves elsewhere', () => {
      const hook = setup()
      act(() => hook.result.current.addElement(createVectorElement('ellipse', { x: 300, y: 300, width: 40, height: 40 })))
      const other = hook.result.current.selectedId!
      act(() => hook.result.current.setSelectedIds([hook.result.current.document!.elements[0]!.id]))
      act(() => hook.result.current.duplicateSelection())
      const first = hook.result.current.selectedId!
      act(() => hook.result.current.updateElements([{ id: first, patch: { x: 112, y: 12 } }]))

      act(() => hook.result.current.setSelectedIds([other]))
      act(() => hook.result.current.duplicateSelection())

      expect(hook.result.current.document!.elements.find((element) => element.id === hook.result.current.selectedId!)).toMatchObject({ x: 312, y: 312 })
    })
  })

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
      copies = hook.result.current.duplicateElements([id], 0).ids
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

describe('ordering a selection', () => {
  const seed = (count: number) => {
    localStorage.clear()
    const document = createVectorDocument()
    document.elements = Array.from({ length: count }, (_, index) => ({
      ...createVectorElement('rectangle', { x: index * 10, y: 0, width: 10, height: 10 }),
      id: String.fromCharCode(97 + index),
      name: String.fromCharCode(97 + index),
    }))
    saveVectorDocument(document)
    return document.id
  }

  const order = (result: { current: { document: { elements: Array<{ id: string }> } | null } }) =>
    (result.current.document?.elements ?? []).map((element) => element.id)

  it('moves a selection one step without shuffling it', () => {
    const id = seed(4)
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.orderElements(['a', 'b'], 'forward'))

    expect(order(result)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('brings a selection to the front, keeping its own order', () => {
    const id = seed(4)
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.orderElements(['a', 'c'], 'front'))

    expect(order(result)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('sends a selection to the back, keeping its own order', () => {
    const id = seed(4)
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.orderElements(['b', 'd'], 'back'))

    expect(order(result)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('leaves the stack alone when it is already at the end', () => {
    const id = seed(3)
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.orderElements(['c'], 'forward'))
    act(() => result.current.orderElements(['a'], 'back'))

    expect(order(result)).toEqual(['a', 'b', 'c'])
    expect(result.current.canUndo).toBe(false)
  })

  it('records one undo step for the whole move', () => {
    const id = seed(4)
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.orderElements(['a', 'b'], 'front'))
    act(() => result.current.undo())

    expect(order(result)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('labelled history', () => {
  const seed = () => {
    localStorage.clear()
    const document = createVectorDocument()
    document.elements = ['a', 'b', 'c'].map((id) => ({ ...createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }), id, name: id }))
    saveVectorDocument(document)
    return document.id
  }
  const labels = (result: { current: { historySteps: Array<{ label: string }> } }) => result.current.historySteps.map((step) => step.label)

  it('names each step after the edit that made it', () => {
    const id = seed()
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.updateElement('a', { x: 40 }, true, 'Move'))
    act(() => result.current.updateElement('a', { fill: '#123456' }, true, 'Change fill'))

    expect(labels(result)).toEqual(['Opened', 'Move', 'Change fill'])
    expect(result.current.historyIndex).toBe(2)
  })

  it('takes the label of a gesture from where it began', () => {
    const id = seed()
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.beginGesture('Move 3 objects'))
    act(() => result.current.updateElements([{ id: 'a', patch: { x: 5 } }], false))
    act(() => result.current.endGesture())

    expect(labels(result)).toEqual(['Opened', 'Move 3 objects'])
  })

  it('keeps the names of steps that have been undone, so redo reads the same', () => {
    const id = seed()
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.updateElement('a', { x: 40 }, true, 'Move'))
    act(() => result.current.updateElement('a', { fill: '#123456' }, true, 'Change fill'))
    act(() => result.current.undo())

    expect(labels(result)).toEqual(['Opened', 'Move', 'Change fill'])
    expect(result.current.historyIndex).toBe(1)
  })

  it('jumps straight back to any step and forward again', () => {
    const id = seed()
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.updateElement('a', { x: 40 }, true, 'Move'))
    act(() => result.current.updateElement('a', { x: 80 }, true, 'Move again'))
    act(() => result.current.updateElement('a', { x: 120 }, true, 'Move once more'))
    act(() => result.current.goToStep(1))

    expect(result.current.document?.elements.find((element) => element.id === 'a')?.x).toBe(40)
    expect(result.current.historyIndex).toBe(1)
    expect(labels(result)).toEqual(['Opened', 'Move', 'Move again', 'Move once more'])

    act(() => result.current.goToStep(3))

    expect(result.current.document?.elements.find((element) => element.id === 'a')?.x).toBe(120)
    expect(result.current.historyIndex).toBe(3)
  })

  it('jumps all the way back to the state the document opened in', () => {
    const id = seed()
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.updateElement('a', { x: 40 }, true, 'Move'))
    act(() => result.current.removeElements(['b']))
    act(() => result.current.goToStep(0))

    expect(result.current.document?.elements.map((element) => element.id)).toEqual(['a', 'b', 'c'])
    expect(result.current.document?.elements.find((element) => element.id === 'a')?.x).toBe(0)
  })

  it('does nothing when asked for the step it is already on', () => {
    const id = seed()
    const { result } = renderHook(() => useVectorDocument(id))

    act(() => result.current.updateElement('a', { x: 40 }, true, 'Move'))
    const before = result.current.document

    act(() => result.current.goToStep(1))

    expect(result.current.document).toBe(before)
  })
})
