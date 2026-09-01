import { describe, expect, it } from 'vitest'
import { networkFromRuns, worldNetwork } from '@/vector/network'
import { computeFaces } from '@/vector/planar'
import {
  alignPoints,
  constrainToAngle,
  distributePoints,
  faceNodeIds,
  handleFromPolar,
  handlePolar,
  moveNodesTo,
} from '@/vector/nodeEdit'
import type { VectorElement } from '@/vector/types'

const points = () => [{ x: 0, y: 0 }, { x: 40, y: 10 }, { x: 10, y: 50 }]

describe('aligning nodes', () => {
  it('lines them up on each edge and centre of their own box', () => {
    expect(alignPoints(points(), 'left').map((p) => p.x)).toEqual([0, 0, 0])
    expect(alignPoints(points(), 'right').map((p) => p.x)).toEqual([40, 40, 40])
    expect(alignPoints(points(), 'centerX').map((p) => p.x)).toEqual([20, 20, 20])
    expect(alignPoints(points(), 'top').map((p) => p.y)).toEqual([0, 0, 0])
    expect(alignPoints(points(), 'bottom').map((p) => p.y)).toEqual([50, 50, 50])
    expect(alignPoints(points(), 'centerY').map((p) => p.y)).toEqual([25, 25, 25])
  })

  it('leaves the other axis alone', () => {
    expect(alignPoints(points(), 'left').map((p) => p.y)).toEqual([0, 10, 50])
  })

  it('needs two points to mean anything', () => {
    const single = [{ x: 5, y: 5 }]

    expect(alignPoints(single, 'left')).toEqual(single)
  })
})

describe('distributing nodes', () => {
  it('spaces the middle ones evenly and keeps the ends', () => {
    const spread = distributePoints([{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 10, y: 0 }, { x: 30, y: 0 }], 'x')

    expect(spread.map((p) => p.x).sort((a, b) => a - b)).toEqual([0, 30, 60, 90])
    expect(spread[0]!.x).toBe(0)
    expect(spread[1]!.x).toBe(90)
  })

  it('works on the other axis and needs three points', () => {
    expect(distributePoints([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 10 }], 'y').map((p) => p.y)).toEqual([0, 100, 50])
    expect(distributePoints([{ x: 0, y: 0 }, { x: 0, y: 10 }], 'y').map((p) => p.y)).toEqual([0, 10])
  })
})

describe('moving nodes to new places', () => {
  const network = networkFromRuns([{
    points: [
      { anchor: { x: 0, y: 0 }, out: { x: 20, y: 0 } },
      { anchor: { x: 100, y: 0 }, in: { x: 80, y: 0 } },
    ],
    closed: false,
  }])

  it('carries each node handles along with it', () => {
    const [first, second] = network.nodes

    const moved = moveNodesTo(network, new Map([[first!.id, { x: 0, y: 30 }]]))

    expect(moved.nodes.find((node) => node.id === first!.id)!.point).toEqual({ x: 0, y: 30 })
    expect(moved.segments[0]!.ah).toEqual({ x: 20, y: 30 })
    expect(moved.segments[0]!.bh).toEqual({ x: 80, y: 0 })
    expect(moved.nodes.find((node) => node.id === second!.id)!.point).toEqual({ x: 100, y: 0 })
  })

  it('returns the same network when nothing actually moves', () => {
    const same = moveNodesTo(network, new Map([[network.nodes[0]!.id, { x: 0, y: 0 }]]))

    expect(same).toBe(network)
  })
})

describe('angle constraint', () => {
  it('snaps to the nearest fifteen degrees, keeping the distance', () => {
    const snapped = constrainToAngle({ x: 0, y: 0 }, { x: 100, y: 20 })

    expect(Math.hypot(snapped.x, snapped.y)).toBeCloseTo(Math.hypot(100, 20))
    expect((Math.atan2(snapped.y, snapped.x) * 180) / Math.PI).toBeCloseTo(15)
  })

  it('takes any step and leaves a zero-length drag alone', () => {
    const at45 = constrainToAngle({ x: 0, y: 0 }, { x: 100, y: 84 }, 45)

    expect(at45.x).toBeCloseTo(at45.y)
    expect(constrainToAngle({ x: 0, y: 0 }, { x: 100, y: 30 }, 45)).toMatchObject({ y: 0 })
    expect(constrainToAngle({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 })
  })
})

describe('handles in polar form', () => {
  it('reads a handle as a length and an angle with y up', () => {
    expect(handlePolar({ x: 0, y: 0 }, { x: 30, y: 0 })).toEqual({ length: 30, angle: 0 })
    expect(handlePolar({ x: 0, y: 0 }, { x: 0, y: -30 })).toMatchObject({ length: 30, angle: 90 })
    expect(handlePolar({ x: 0, y: 0 }, { x: -30, y: 0 })).toMatchObject({ length: 30, angle: 180 })
    expect(handlePolar({ x: 0, y: 0 }, { x: 0, y: 30 })).toMatchObject({ length: 30, angle: 270 })
  })

  it('round-trips through the point form', () => {
    const node = { x: 10, y: 20 }
    const handle = { x: 34, y: 3 }
    const polar = handlePolar(node, handle)

    const back = handleFromPolar(node, polar.length, polar.angle)

    expect(back.x).toBeCloseTo(handle.x)
    expect(back.y).toBeCloseTo(handle.y)
  })
})

describe('nodes around a face', () => {
  it('collects the nodes on a face outline', () => {
    const rect: VectorElement = { id: 'r', kind: 'rectangle', name: 'R', x: 0, y: 0, width: 100, height: 100, rotation: 0, fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false }
    const world = worldNetwork(rect)

    const face = computeFaces(world)[0]!

    expect(faceNodeIds(face).sort()).toEqual(world.nodes.map((node) => node.id).sort())
  })
})
