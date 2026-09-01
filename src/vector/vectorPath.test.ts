import { describe, expect, it } from 'vitest'
import { defaultVectorNodes, elementFromWorldNodes, minimumNodeCount, moveVectorNode, nodeIndicesInBounds, nodeWorldPosition, pathEndpoints, transformVectorNodes, vectorPathData } from '@/vector/vectorPath'
import type { VectorElement } from '@/vector/types'

const rectangle: VectorElement = {
  id: 'shape', kind: 'rectangle', name: 'Rectangle', x: 100, y: 80, width: 200, height: 100,
  rotation: 0, fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false,
}

describe('vector paths', () => {
  it('creates editable rectangle and ellipse networks', () => {
    expect(defaultVectorNodes(rectangle)).toHaveLength(4)
    expect(vectorPathData(rectangle)).toBe('M 100 80 L 300 80 L 300 180 L 100 180 L 100 80 Z')
    const ellipse = { ...rectangle, kind: 'ellipse' as const }
    expect(vectorPathData(ellipse)).toContain('C ')
  })

  it('moves an anchor and normalizes the new bounds', () => {
    const result = moveVectorNode(rectangle, defaultVectorNodes(rectangle), 0, 'anchor', { x: 50, y: 40 }, true)
    expect(result).toMatchObject({ x: 50, y: 40, width: 250, height: 140 })
    expect(result.vectorNodes[0]).toMatchObject({ x: 0, y: 0 })
    expect(result.vectorNodes[2]).toMatchObject({ x: 1, y: 1 })
  })

  it('mirrors bezier handles unless they are explicitly split', () => {
    const ellipse = { ...rectangle, kind: 'ellipse' as const }
    const nodes = defaultVectorNodes(ellipse)
    const result = moveVectorNode(ellipse, nodes, 0, 'out', { x: 280, y: 80 }, true)
    const node = result.vectorNodes[0]!
    expect(node.in?.x).toBeCloseTo(-node.out!.x, 3)
    expect(node.in?.y).toBeCloseTo(-node.out!.y, 3)
  })

  it('selects anchors inside a marquee without selecting the whole shape', () => {
    expect(nodeIndicesInBounds(rectangle, defaultVectorNodes(rectangle), {
      x: 90, y: 70, width: 220, height: 20,
    })).toEqual([0, 1])
  })

  it('moves only the selected anchors as a group', () => {
    const result = transformVectorNodes(rectangle, defaultVectorNodes(rectangle), [0, 1], 'move', 'x', { x: 0, y: 0 }, { x: 50, y: 90 })
    const next = { ...rectangle, ...result }
    expect(nodeWorldPosition(next, result.vectorNodes[0]!)).toEqual({ x: 150, y: 80 })
    expect(nodeWorldPosition(next, result.vectorNodes[1]!)).toEqual({ x: 350, y: 80 })
    expect(nodeWorldPosition(next, result.vectorNodes[2]!)).toEqual({ x: 300, y: 180 })
    expect(nodeWorldPosition(next, result.vectorNodes[3]!)).toEqual({ x: 100, y: 180 })
  })

  it('scales selected anchors around their common centroid', () => {
    const result = transformVectorNodes(rectangle, defaultVectorNodes(rectangle), [0, 1], 'scale', null, { x: 300, y: 80 }, { x: 400, y: 80 })
    const next = { ...rectangle, ...result }
    expect(nodeWorldPosition(next, result.vectorNodes[0]!)).toEqual({ x: 0, y: 80 })
    expect(nodeWorldPosition(next, result.vectorNodes[1]!)).toEqual({ x: 400, y: 80 })
    expect(nodeWorldPosition(next, result.vectorNodes[2]!)).toEqual({ x: 300, y: 180 })
    expect(nodeWorldPosition(next, result.vectorNodes[3]!)).toEqual({ x: 100, y: 180 })
  })

  it('rotates selected anchors around their common centroid', () => {
    const result = transformVectorNodes(rectangle, defaultVectorNodes(rectangle), [0, 1], 'rotate', null, { x: 300, y: 80 }, { x: 200, y: 180 })
    const next = { ...rectangle, ...result }
    expect(nodeWorldPosition(next, result.vectorNodes[0]!).x).toBeCloseTo(200)
    expect(nodeWorldPosition(next, result.vectorNodes[0]!).y).toBeCloseTo(-20)
    expect(nodeWorldPosition(next, result.vectorNodes[1]!).x).toBeCloseTo(200)
    expect(nodeWorldPosition(next, result.vectorNodes[1]!).y).toBeCloseTo(180)
  })
})

describe('open paths', () => {
  const open: VectorElement = {
    id: 'open', kind: 'path', name: 'Path', x: 0, y: 0, width: 100, height: 100, rotation: 0,
    fill: 'none', stroke: '#FFFFFF', strokeWidth: 2, opacity: 1, visible: true, locked: false, closed: false,
    vectorNodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
  }

  it('omits the closing segment and Z', () => {
    expect(vectorPathData(open)).toBe('M 0 0 L 100 0 L 100 100')
    expect(vectorPathData({ ...open, closed: true })).toBe('M 0 0 L 100 0 L 100 100 L 0 0 Z')
    expect(minimumNodeCount(open)).toBe(2)
    expect(minimumNodeCount({ closed: true })).toBe(3)
  })

  it('exposes both endpoints in world space', () => {
    expect(pathEndpoints(open)).toEqual({ start: { x: 0, y: 0 }, end: { x: 100, y: 100 } })
    expect(pathEndpoints({ ...open, closed: true })).toBeNull()
  })

  it('builds a box from world nodes', () => {
    const built = elementFromWorldNodes([{ anchor: { x: 20, y: 30 } }, { anchor: { x: 120, y: 30 }, out: { x: 140, y: 60 } }])
    expect(built).toMatchObject({ x: 20, y: 30, width: 120, height: 30 })
    expect(built.vectorNodes[1]).toEqual({ x: 0.8333, y: 0, out: { x: 0.1667, y: 1 } })
  })
})
