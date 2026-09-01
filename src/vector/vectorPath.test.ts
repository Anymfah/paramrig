import { describe, expect, it } from 'vitest'
import { defaultVectorNodes, moveVectorNode, nodeIndicesInBounds, nodeWorldPosition, transformVectorNodes, vectorPathData } from '@/vector/vectorPath'
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
