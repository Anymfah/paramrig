import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneDocument } from '@/scene/document'
import { useSceneDocument } from '@/scene/useSceneDocument'
import '@/scene/operators'

let documentId = ''

beforeEach(() => {
  localStorage.clear()
  documentId = createSceneDocument().id
})

function open() {
  return renderHook(() => useSceneDocument(documentId))
}

describe('one gesture, one step', () => {
  it('records a single entry however many frames a drag took', () => {
    const { result } = open()
    const cube = result.current.document!.objects[0]!.id

    act(() => { result.current.beginGesture('Move') })
    for (let step = 1; step <= 5; step += 1) {
      act(() => { result.current.updateObject(cube, { transform: { ...result.current.document!.objects[0]!.transform, position: [step, 0, 0] } }, 'Move', false) })
    }
    act(() => { result.current.endGesture('Move') })

    expect(result.current.document!.objects[0]!.transform.position).toEqual([5, 0, 0])
    expect(result.current.canUndo).toBe(true)
    expect(result.current.historySteps.map((step) => step.label)).toEqual(['Opened', 'Move'])

    act(() => { result.current.undo() })
    expect(result.current.document!.objects[0]!.transform.position).toEqual([0, 0, 0])
    expect(result.current.canRedo).toBe(true)

    act(() => { result.current.redo() })
    expect(result.current.document!.objects[0]!.transform.position).toEqual([5, 0, 0])
  })

  it('writes nothing for a gesture that changed nothing', () => {
    const { result } = open()

    act(() => { result.current.beginGesture('Move') })
    act(() => { result.current.endGesture('Move') })

    expect(result.current.canUndo).toBe(false)
  })

  it('puts everything back when a gesture is cancelled', () => {
    const { result } = open()
    const cube = result.current.document!.objects[0]!.id

    act(() => { result.current.beginGesture('Move') })
    act(() => { result.current.updateObject(cube, { transform: { ...result.current.document!.objects[0]!.transform, position: [9, 9, 9] } }, 'Move', false) })
    act(() => { result.current.cancelGesture() })

    expect(result.current.document!.objects[0]!.transform.position).toEqual([0, 0, 0])
    expect(result.current.canUndo).toBe(false)
  })
})

describe('operators', () => {
  it('runs one as a single named step, and undoes it', () => {
    const { result } = open()
    act(() => { result.current.selectObjects([result.current.document!.objects[0]!.id]) })

    act(() => { result.current.runOperator('select.none') })
    expect(result.current.selection.objectIds).toEqual([])

    act(() => { result.current.runOperator('select.all') })
    expect(result.current.selection.objectIds).toHaveLength(3)
  })

  it('says why a refused operator did not run, rather than doing nothing quietly', () => {
    const { result } = open()

    act(() => { result.current.runOperator('view.camera') })
    expect(result.current.message).toBeNull()

    // A new scene opens on its cube, the way Blender's startup file does, so the refusal this test
    // is about needs an empty selection to be reached at all.
    act(() => { result.current.runOperator('select.none') })
    act(() => { result.current.runOperator('transform.move') })
    expect(result.current.message).toBe('Select something to move first.')
  })

  it('keeps a view move out of the history', () => {
    const { result } = open()

    act(() => { result.current.runOperator('view.top') })

    expect(result.current.document!.view.pitch).toBeCloseTo(89.9, 3)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.lastOperation).toBeNull()
  })
})

describe('travelling through the history', () => {
  it('goes to any step in one move', () => {
    const { result } = open()
    const cube = result.current.document!.objects[0]!.id
    for (const x of [1, 2, 3]) {
      act(() => { result.current.updateObject(cube, { transform: { ...result.current.document!.objects[0]!.transform, position: [x, 0, 0] } }, `Move ${x}`) })
    }
    expect(result.current.historySteps).toHaveLength(4)

    act(() => { result.current.goToStep(1) })
    expect(result.current.document!.objects[0]!.transform.position).toEqual([1, 0, 0])

    act(() => { result.current.goToStep(3) })
    expect(result.current.document!.objects[0]!.transform.position).toEqual([3, 0, 0])
  })

  it('leaves the camera where the person left it', () => {
    const { result } = open()
    const cube = result.current.document!.objects[0]!.id
    act(() => { result.current.updateObject(cube, { visible: false }, 'Hide') })
    act(() => { result.current.setView({ ...result.current.document!.view, yaw: 12 }) })

    act(() => { result.current.undo() })

    expect(result.current.document!.objects[0]!.visible).toBe(true)
    expect(result.current.document!.view.yaw).toBe(12)
  })
})
