import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { penAddAnchor, penCanClose, penClose, penCommit, penDragHandle, penFromElement, penPreviewData, penRemoveLast, penStart } from '@/vector/pen'
import type { VectorElement } from '@/vector/types'
import { nodeWorldPosition, vectorPathData } from '@/vector/vectorPath'

describe('pen tool', () => {
  beforeEach(() => vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'pen-id') }))
  afterEach(() => vi.unstubAllGlobals())

  it('places corner anchors and previews a rubber band', () => {
    const draft = penAddAnchor(penStart({ x: 10, y: 10 }), { x: 110, y: 10 })
    expect(penPreviewData(draft, { x: 110, y: 60 })).toBe('M 10 10 L 110 10 L 110 60')
    expect(penRemoveLast(draft)?.nodes).toHaveLength(1)
    expect(penRemoveLast(penStart({ x: 0, y: 0 }))).toBeNull()
  })

  it('drags a mirrored handle pair, and Alt keeps the incoming handle', () => {
    const draft = penDragHandle(penAddAnchor(penStart({ x: 0, y: 0 }), { x: 100, y: 0 }), 1, { x: 120, y: 30 })
    expect(draft.nodes[1]).toEqual({ anchor: { x: 100, y: 0 }, in: { x: 80, y: -30 }, out: { x: 120, y: 30 } })
    const cusp = penDragHandle(draft, 1, { x: 100, y: 40 }, true)
    expect(cusp.nodes[1]!.in).toEqual({ x: 80, y: -30 })
    expect(cusp.nodes[1]!.out).toEqual({ x: 100, y: 40 })
    expect(penPreviewData(draft)).toBe('M 0 0 C 0 0 80 -30 100 0')
  })

  it('closes on the first anchor only with three or more nodes', () => {
    const two = penAddAnchor(penStart({ x: 0, y: 0 }), { x: 100, y: 0 })
    expect(penCanClose(two, { x: 1, y: 1 }, 6)).toBe(false)
    const three = penAddAnchor(two, { x: 100, y: 100 })
    expect(penCanClose(three, { x: 3, y: 3 }, 6)).toBe(true)
    expect(penCanClose(three, { x: 30, y: 3 }, 6)).toBe(false)
    const commit = penCommit(penClose(three), { stroke: '#FF0000' })
    expect(commit && 'element' in commit ? commit.element : null).toMatchObject({ kind: 'path', x: 0, y: 0, width: 100, height: 100, stroke: '#FF0000', fill: 'none' })
  })

  it('commits an open path with its box and rejects a lone anchor', () => {
    const draft = penAddAnchor(penStart({ x: 20, y: 30 }), { x: 120, y: 80 })
    const commit = penCommit(draft)
    expect(commit && 'element' in commit ? commit.element : null).toMatchObject({ x: 20, y: 30, width: 100, height: 50, closed: false })
    expect(vectorPathData((commit as { element: VectorElement }).element)).toBe('M 20 30 L 120 80')
    expect(penCommit(penStart({ x: 0, y: 0 }))).toBeNull()
  })

  it('continues an existing open path from either end', () => {
    const element: VectorElement = {
      id: 'open', kind: 'path', name: 'Path', x: 0, y: 0, width: 100, height: 100, rotation: 0,
      fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, opacity: 1, visible: true, locked: false, closed: false,
      vectorNodes: [{ x: 0, y: 0, out: { x: 0.2, y: 0 } }, { x: 1, y: 1 }],
    }
    const fromEnd = penFromElement(element, 'end')!
    expect(fromEnd.nodes.map((node) => node.anchor)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 100 }])
    const fromStart = penFromElement(element, 'start')!
    expect(fromStart.nodes.map((node) => node.anchor)).toEqual([{ x: 100, y: 100 }, { x: 0, y: 0 }])
    expect(fromStart.nodes[1]!.in).toEqual({ x: 20, y: 0 })
    const commit = penCommit(penAddAnchor(fromStart, { x: -50, y: 0 }))
    expect(commit && 'patch' in commit ? commit : null).toMatchObject({ id: 'open', patch: { x: -50, y: 0, width: 150, height: 100, closed: false } })
    const next = { ...element, ...(commit as { patch: Partial<VectorElement> }).patch }
    expect(nodeWorldPosition(next, next.vectorNodes![2]!)).toEqual({ x: -50, y: 0 })
    expect(penFromElement({ ...element, closed: true }, 'end')).toBeNull()
  })
})
