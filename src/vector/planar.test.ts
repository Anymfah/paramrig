import { describe, expect, it } from 'vitest'
import { chains, extendNetwork, networkFromRuns, runPathData, worldNetwork, type AbsNetwork } from '@/vector/network'
import { computeFaces, faceContainsPoint, loopToRun, networkFingerprint } from '@/vector/planar'
import type { VectorElement } from '@/vector/types'

const rect: VectorElement = { id: 'r', kind: 'rectangle', name: 'R', x: 0, y: 0, width: 100, height: 100, rotation: 0, fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false }

function square(): AbsNetwork {
  return worldNetwork(rect)
}

describe('planar faces', () => {
  it('finds the single face of a square and none for an open chain', () => {
    const faces = computeFaces(square())
    expect(faces).toHaveLength(1)
    expect(faces[0]!.area).toBeCloseTo(10000)
    expect(runPathData(loopToRun(square(), faces[0]!.outer))).toBe('M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z')
    const open = networkFromRuns([{ points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: 50 } }, { anchor: { x: 100, y: 0 } }], closed: false }])
    expect(computeFaces(open)).toEqual([])
  })

  it('splits a square into two regions with a connecting segment', () => {
    const world = square()
    const n1 = world.nodes[0]!.id
    const n3 = world.nodes[2]!.id
    const network = { ...world, segments: [...world.segments, { id: 'diag', a: n1, b: n3 }] }
    const faces = computeFaces(network)
    expect(faces).toHaveLength(2)
    expect(faces.map((face) => Math.round(face.area))).toEqual([5000, 5000])
    expect(faceContainsPoint(network, faces[0]!, { x: 80, y: 20 }) !== faceContainsPoint(network, faces[1]!, { x: 80, y: 20 })).toBe(true)
  })

  it('creates regions from crossing segments without a node at the crossing', () => {
    const world = square()
    const left = extendNetwork(world, null, { x: -20, y: 50 })
    const right = extendNetwork(left.network, left.nodeId, { x: 120, y: 50 })
    const faces = computeFaces(right.network)
    expect(faces).toHaveLength(2)
    expect(faces.map((face) => Math.round(face.area)).sort()).toEqual([5000, 5000])
    const keys = faces.map((face) => face.key)
    expect(new Set(keys).size).toBe(2)
  })

  it('treats a nested loop as a hole of the surrounding face', () => {
    const outer = square()
    const inner = worldNetwork({ ...rect, x: 25, y: 25, width: 50, height: 50 })
    const network: AbsNetwork = { nodes: [...outer.nodes, ...inner.nodes.map((node) => ({ ...node, id: `i${node.id}` }))], segments: [...outer.segments, ...inner.segments.map((segment) => ({ ...segment, id: `i${segment.id}`, a: `i${segment.a}`, b: `i${segment.b}` }))] }
    const faces = computeFaces(network)
    expect(faces).toHaveLength(2)
    const big = faces.find((face) => face.area > 9000)!
    expect(big.holes).toHaveLength(1)
    expect(faceContainsPoint(network, big, { x: 50, y: 50 })).toBe(false)
    expect(faceContainsPoint(network, big, { x: 10, y: 10 })).toBe(true)
  })

  it('handles a pentagram: five points and a centre region', () => {
    const points = Array.from({ length: 5 }, (_, index) => { const angle = -Math.PI / 2 + (index * 4 * Math.PI) / 5; return { anchor: { x: 100 + Math.cos(angle) * 100, y: 100 + Math.sin(angle) * 100 } } })
    const network = networkFromRuns([{ points, closed: true }])
    const faces = computeFaces(network)
    expect(faces).toHaveLength(6)
    expect(chains(network)).toHaveLength(1)
  })

  it('keeps curves on face loops', () => {
    const ellipse = worldNetwork({ ...rect, kind: 'ellipse' })
    const faces = computeFaces(ellipse)
    expect(faces).toHaveLength(1)
    expect(faces[0]!.area).toBeCloseTo(Math.PI * 2500, -2)
    expect(runPathData(loopToRun(ellipse, faces[0]!.outer))).toContain('C')
  })
})

describe('face caching', () => {
  it('gives equal networks the same fingerprint and a different one once a node moves', () => {
    const world = square()
    const moved = { ...world, nodes: world.nodes.map((node, index) => index === 0 ? { ...node, point: { x: 5, y: 5 } } : node) }

    expect(networkFingerprint(world)).toBe(networkFingerprint(square()))
    expect(networkFingerprint(moved)).not.toBe(networkFingerprint(world))
  })

  it('reuses the arrangement of an unchanged network', () => {
    const first = computeFaces(square())
    const second = computeFaces(square())

    expect(second).toBe(first)
  })

  it('re-arranges once the geometry changes', () => {
    const world = square()
    const wider = { ...world, nodes: world.nodes.map((node) => ({ ...node, point: { x: node.point.x * 2, y: node.point.y } })) }

    const faces = computeFaces(wider)

    expect(faces).toHaveLength(1)
    expect(faces[0]!.area).toBeCloseTo(20000)
  })

  it('still finds a crossing between two tight curves after adaptive sampling', () => {
    const curves = networkFromRuns([
      { points: [{ anchor: { x: 0, y: 0 }, out: { x: 120, y: 0 } }, { anchor: { x: 0, y: 100 }, in: { x: 120, y: 100 } }], closed: false },
      { points: [{ anchor: { x: 100, y: 0 }, out: { x: -20, y: 0 } }, { anchor: { x: 100, y: 100 }, in: { x: -20, y: 100 } }], closed: false },
    ])

    const faces = computeFaces(curves)

    expect(faces.length).toBeGreaterThan(0)
  })
})
