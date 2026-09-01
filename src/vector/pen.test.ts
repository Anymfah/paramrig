import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVectorElement } from '@/vector/document'
import { chains, worldNetwork } from '@/vector/network'
import { penAddAnchor, penCanClose, penCommit, penConnect, penDragHandle, penFromNode, penFromPoint, penNodeAt, penRemoveLast, penStart } from '@/vector/pen'
import { computeFaces } from '@/vector/planar'
import type { VectorElement } from '@/vector/types'

describe('pen on networks', () => {
  beforeEach(() => vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'pen-id') }))
  afterEach(() => vi.unstubAllGlobals())

  it('keeps open strokes unfilled and fills closed ones by default', () => {
    const open = penAddAnchor(penAddAnchor(penStart({ x: 0, y: 0 }), { x: 100, y: 0 }), { x: 100, y: 100 })
    const openResult = penCommit(open)!
    expect('element' in openResult && openResult.element.fill).toBe('none')
    const closed = penConnect(open, open.start!)
    expect(closed.current).toBeNull()
    const closedResult = penCommit(closed)!
    expect('element' in closedResult && closedResult.element.fill).toBe('#1C1D1E')
    expect('element' in closedResult && computeFaces(worldNetwork(closedResult.element))).toHaveLength(1)
  })

  it('drags mirrored handles, removes the last anchor and detects closing', () => {
    let draft = penAddAnchor(penStart({ x: 0, y: 0 }), { x: 100, y: 0 })
    draft = penDragHandle(draft, { x: 120, y: 30 })
    expect(draft.pendingOut).toEqual({ x: 120, y: 30 })
    expect(draft.world.segments[0]!.bh).toEqual({ x: 80, y: -30 })
    draft = penAddAnchor(draft, { x: 100, y: 100 })
    expect(draft.world.segments[1]!.ah).toEqual({ x: 120, y: 30 })
    expect(penCanClose(draft, { x: 2, y: 2 }, 6)).toBe(true)
    expect(penNodeAt(draft, { x: 99, y: 99 }, 6)).toBe(draft.current)
    const removed = penRemoveLast(draft)!
    expect(removed.world.nodes).toHaveLength(2)
    expect(removed.current).toBe(draft.world.segments[0]!.b)
  })

  it('extends an existing element and fills it when it gains a region', () => {
    const base = createVectorElement('path', { x: 0, y: 0, width: 100, height: 100 }, { network: { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 1, y: 1 }], segments: [{ id: 's1', a: 'a', b: 'b' }, { id: 's2', a: 'b', b: 'c' }] } })
    expect(base.fill).toBe('none')
    let draft = penFromNode(base, 'c')
    draft = penConnect(draft, 'a')
    const result = penCommit(draft)!
    expect('patch' in result && result.patch.fill).toBe('#1C1D1E')
    const disconnected = penAddAnchor(penFromPoint(base, { x: 200, y: 200 }), { x: 300, y: 200 })
    const grown = penCommit(disconnected)!
    expect('patch' in grown && grown.patch.fill).toBeUndefined()
    const next: VectorElement = { ...base, ...('patch' in grown ? grown.patch : {}) }
    expect(chains(worldNetwork(next))).toHaveLength(2)
  })
})
