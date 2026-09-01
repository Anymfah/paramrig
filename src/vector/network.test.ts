import { describe, expect, it } from 'vitest'
import {
  bendSegment, chains, chainToRun, components, connectNodes, defaultNetwork, deleteNodes, deleteSegments, extendNetwork,
  insertNodeOnSegment, moveHandle, moveNodes, networkFromRuns, normalizeWorld, runPathData, sanitizeNetwork, toggleNodeSmooth, worldNetwork,
} from '@/vector/network'
import type { VectorElement } from '@/vector/types'

const box = { x: 100, y: 100, width: 200, height: 100, rotation: 0 }
const rect: VectorElement = { id: 'r', kind: 'rectangle', name: 'R', ...box, fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false }

describe('vector network', () => {
  it('derives primitives and resolves world coordinates', () => {
    const world = worldNetwork(rect)
    expect(world.nodes.map((node) => node.point)).toEqual([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }])
    expect(world.segments).toHaveLength(4)
    const ellipse = worldNetwork({ ...rect, kind: 'ellipse' })
    expect(ellipse.segments.every((segment) => segment.ah && segment.bh)).toBe(true)
    const rotated = worldNetwork({ ...rect, rotation: 90 })
    expect(rotated.nodes[0]!.point.x).toBeCloseTo(250)
    expect(rotated.nodes[0]!.point.y).toBeCloseTo(50)
  })

  it('moves nodes and refits the box, preserving the others', () => {
    const world = worldNetwork(rect)
    const edit = moveNodes(rect, world, ['n3'], { x: 50, y: 50 })
    expect(edit).toMatchObject({ x: 100, y: 100, width: 250, height: 150 })
    const next = { ...rect, ...edit, kind: 'path' as const }
    expect(worldNetwork(next).nodes.find((node) => node.id === 'n3')!.point).toEqual({ x: 350, y: 250 })
    expect(worldNetwork(next).nodes.find((node) => node.id === 'n1')!.point).toEqual({ x: 100, y: 100 })
  })

  it('smooths a corner with tangent handles and mirrors handle drags', () => {
    const world = worldNetwork(rect)
    const smooth = toggleNodeSmooth(rect, world, 'n2')
    const next = { ...rect, ...smooth, kind: 'path' as const }
    const w2 = worldNetwork(next)
    const s1 = w2.segments.find((segment) => segment.id === 's1')!
    const s2 = w2.segments.find((segment) => segment.id === 's2')!
    expect(s1.bh).toBeDefined()
    expect(s2.ah).toBeDefined()
    const n2 = w2.nodes.find((node) => node.id === 'n2')!.point
    expect(s1.bh!.x - n2.x).toBeCloseTo(-(s2.ah!.x - n2.x), 3)
    expect(s1.bh!.y - n2.y).toBeCloseTo(-(s2.ah!.y - n2.y), 3)
    const dragged = moveHandle(next, w2, 's2', 'a', { x: 340, y: 160 })
    const w3 = worldNetwork({ ...next, ...dragged })
    const a = w3.segments.find((segment) => segment.id === 's2')!.ah!
    const b = w3.segments.find((segment) => segment.id === 's1')!.bh!
    const centre = w3.nodes.find((node) => node.id === 'n2')!.point
    expect(a.x - centre.x).toBeCloseTo(-(b.x - centre.x), 1)
    expect(a.y - centre.y).toBeCloseTo(-(b.y - centre.y), 1)
    const corner = toggleNodeSmooth(next, w2, 'n2')
    expect(worldNetwork({ ...next, ...corner }).segments.find((segment) => segment.id === 's1')!.bh).toBeUndefined()
  })

  it('inserts, bends, connects and deletes', () => {
    const world = worldNetwork(rect)
    const inserted = insertNodeOnSegment(rect, world, 's1', 0.25)
    const next = { ...rect, ...inserted, kind: 'path' as const }
    expect(next.network.nodes).toHaveLength(5)
    expect(next.network.segments).toHaveLength(5)
    expect(worldNetwork(next).nodes.find((node) => node.id === inserted.nodeId)!.point).toEqual({ x: 150, y: 100 })
    const bent = bendSegment(next, worldNetwork(next), 's3', 0.5, { x: 350, y: 200 })
    const bentWorld = worldNetwork({ ...next, ...bent })
    expect(bentWorld.segments.find((segment) => segment.id === 's3')!.ah).toBeDefined()
    const connected = connectNodes(next, worldNetwork(next), 'n1', 'n3')!
    expect(connected.network.segments).toHaveLength(6)
    expect(connectNodes(next, worldNetwork(next), 'n2', 'n3')).toBeNull()
    const removed = deleteNodes(next, worldNetwork(next), ['n4'])!
    expect(removed.network.nodes).toHaveLength(4)
    expect(removed.network.segments).toHaveLength(3)
    const cut = deleteSegments(next, worldNetwork(next), ['s2'])!
    expect(cut.network.segments).toHaveLength(4)
    expect(deleteNodes(next, worldNetwork(next), next.network.nodes.map((node) => node.id))).toBeNull()
  })

  it('builds chains through degree-two nodes and open ends', () => {
    const world = worldNetwork(rect)
    const ring = chains(world)
    expect(ring).toHaveLength(1)
    expect(ring[0]!.closed).toBe(true)
    expect(runPathData(chainToRun(world, ring[0]!))).toBe('M 100 100 L 300 100 L 300 200 L 100 200 L 100 100 Z')
    const extended = extendNetwork(world, 'n2', { x: 400, y: 50 })
    const open = chains(extended.network)
    expect(open.map((chain) => chain.closed).sort()).toEqual([false, true])
    expect(components(extended.network)).toHaveLength(1)
  })

  it('builds networks from runs and sanitises stored data', () => {
    const built = normalizeWorld(networkFromRuns([{ points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 }, out: { x: 120, y: 30 } }, { anchor: { x: 100, y: 100 } }], closed: false }]))
    expect(built).toMatchObject({ x: 0, y: 0, width: 120, height: 100 })
    expect(built.network.segments).toHaveLength(2)
    expect(built.network.segments[1]!.ah).toBeDefined()
    expect(sanitizeNetwork({ nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }, { id: 'lonely', x: 2, y: 2 }], segments: [{ id: 's', a: 'a', b: 'b' }, { id: 'bad', a: 'a', b: 'zz' }] })).toEqual({ nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }], segments: [{ id: 's', a: 'a', b: 'b' }] })
    expect(sanitizeNetwork({ nodes: [], segments: [] })).toBeNull()
    expect(defaultNetwork({ kind: 'rectangle' }).segments).toHaveLength(4)
  })
})
