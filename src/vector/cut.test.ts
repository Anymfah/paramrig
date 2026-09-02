import { describe, expect, it } from 'vitest'
import { cutNode, cutSegment, scaleStylePatch, uniformFactor } from '@/vector/cut'
import { chains, networkFromRuns, worldNetwork } from '@/vector/network'
import type { VectorElement } from '@/vector/types'

const box = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }

function square(): VectorElement {
  return {
    id: 's', kind: 'rectangle', name: 'S', x: 0, y: 0, width: 100, height: 100, rotation: 0,
    fill: '#111111', stroke: 'none', strokeWidth: 2, opacity: 1, visible: true, locked: false,
  }
}

describe('cutting a segment', () => {
  it('leaves two loose ends on the same spot', () => {
    const world = worldNetwork(square())
    const before = world.nodes.length

    const cut = cutSegment(box, world, world.segments[0]!.id, 0.5)

    expect(cut.network.nodes).toHaveLength(before + 2)
    expect(cut.network.segments).toHaveLength(world.segments.length + 1)
    const points = cut.network.nodes.map((node) => `${Math.round(node.x * 1000)},${Math.round(node.y * 1000)}`)
    expect(new Set(points).size).toBe(points.length - 1)
  })

  it('opens a closed path into a single chain', () => {
    const world = worldNetwork(square())

    const cut = cutSegment(box, world, world.segments[0]!.id, 0.4)
    const opened = worldNetwork({ ...square(), network: cut.network }, cut.network)

    expect(chains(opened).filter((chain) => chain.closed)).toHaveLength(0)
  })

  it('keeps a curve curved on both sides of the cut', () => {
    const curve = networkFromRuns([{ points: [
      { anchor: { x: 0, y: 0 }, out: { x: 30, y: -40 } },
      { anchor: { x: 100, y: 0 }, in: { x: 70, y: -40 } },
    ], closed: false }])

    const cut = cutSegment(box, curve, curve.segments[0]!.id, 0.5)

    expect(cut.network.segments.every((segment) => segment.ah && segment.bh)).toBe(true)
  })

  it('says nothing about a segment it cannot find', () => {
    const world = worldNetwork(square())

    expect(cutSegment(box, world, 'nope', 0.5).network.segments).toHaveLength(world.segments.length)
  })
})

describe('cutting a node', () => {
  it('gives every branch its own end', () => {
    const world = worldNetwork(square())
    const corner = world.nodes[0]!.id

    const cut = cutNode(box, world, corner)

    expect(cut.network.nodes).toHaveLength(world.nodes.length + 1)
    expect(cut.network.segments).toHaveLength(world.segments.length)
    expect(cut.network.segments.some((segment) => segment.a === corner || segment.b === corner)).toBe(false)
  })

  it('leaves a node with a single branch alone', () => {
    const open = networkFromRuns([{ points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false }])

    expect(cutNode(box, open, open.nodes[0]!.id).network.nodes).toHaveLength(2)
  })
})

describe('scaling the look with the box', () => {
  it('scales the weights a shape carries', () => {
    const element: VectorElement = { ...square(), strokeWidth: 4, strokeDash: [6, 3], cornerRadius: 10 }

    expect(scaleStylePatch(element, 2)).toEqual({ strokeWidth: 8, strokeDash: [12, 6], cornerRadius: 20 })
  })

  it('scales each corner of a four-corner radius', () => {
    const element: VectorElement = { ...square(), strokeWidth: 0, cornerRadius: [2, 4, 6, 8] }

    expect(scaleStylePatch(element, 0.5).cornerRadius).toEqual([1, 2, 3, 4])
  })

  it('scales the type of a text', () => {
    const text: VectorElement = { ...square(), kind: 'text', text: 'Hi', fontSize: 20, letterSpacing: 2, strokeWidth: 0 }

    expect(scaleStylePatch(text, 1.5)).toMatchObject({ fontSize: 30, letterSpacing: 3 })
  })

  it('scales the rounding of a node', () => {
    const element: VectorElement = { ...square(), strokeWidth: 0, network: { nodes: [{ id: 'a', x: 0, y: 0, radius: 4 }, { id: 'b', x: 1, y: 1 }], segments: [{ id: 's', a: 'a', b: 'b' }] } }

    expect(scaleStylePatch(element, 3).network?.nodes[0]).toMatchObject({ radius: 12 })
    expect(scaleStylePatch(element, 3).network?.nodes[1]).not.toHaveProperty('radius')
  })

  it('does nothing at all when the factor is one or nonsense', () => {
    expect(scaleStylePatch(square(), 1)).toEqual({})
    expect(scaleStylePatch(square(), 0)).toEqual({})
    expect(scaleStylePatch(square(), Number.NaN)).toEqual({})
  })

  it('reads a two-axis resize as one factor', () => {
    expect(uniformFactor({ width: 100, height: 100 }, { width: 200, height: 200 })).toBe(2)
    expect(uniformFactor({ width: 100, height: 100 }, { width: 400, height: 100 })).toBe(2)
    expect(uniformFactor({ width: 100, height: 100 }, { width: 100, height: 100 })).toBe(1)
  })
})
