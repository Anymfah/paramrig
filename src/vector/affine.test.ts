import { describe, expect, it } from 'vitest'
import { boxMap, elementInLasso, flipAffine, pointInPolygon, rotationAffine, transformElementAffine } from '@/vector/affine'
import { createVectorElement } from '@/vector/document'
import type { VectorElement } from '@/vector/types'
import { nodeWorldPosition } from '@/vector/vectorPath'

describe('affine transforms', () => {
  it('bakes non-uniform scale into rotated paths exactly', () => {
    const path: VectorElement = { ...createVectorElement('path', { x: 0, y: 0, width: 100, height: 100 }, { vectorNodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }), rotation: 45 }
    const before = path.vectorNodes!.map((node) => nodeWorldPosition(path, node))
    const patch = transformElementAffine(path, boxMap({ x: -50, y: -50, width: 200, height: 200 }, { x: -50, y: -50, width: 400, height: 200 }))
    const after = { ...path, ...patch }
    expect(after.rotation).toBe(0)
    after.vectorNodes!.forEach((node, index) => {
      const point = nodeWorldPosition(after, node)
      expect(point.x).toBeCloseTo(-50 + (before[index]!.x + 50) * 2, 1)
      expect(point.y).toBeCloseTo(before[index]!.y, 1)
    })
  })

  it('keeps primitives as boxes, mapping the centre exactly', () => {
    const rect = { ...createVectorElement('rectangle', { x: 100, y: 100, width: 100, height: 50 }), rotation: 30 }
    const patch = transformElementAffine(rect, boxMap({ x: 0, y: 0, width: 400, height: 400 }, { x: 0, y: 0, width: 800, height: 400 }))
    expect(patch.x! + patch.width! / 2).toBeCloseTo(300)
    expect(patch.y! + patch.height! / 2).toBeCloseTo(125)
    expect(patch.rotation).not.toBe(30)
  })

  it('flips around a centre and rotates by 90 degrees', () => {
    const rect = createVectorElement('rectangle', { x: 0, y: 0, width: 100, height: 50 })
    const flipped = transformElementAffine(rect, flipAffine('x', { x: 100, y: 25 }))
    expect(flipped).toMatchObject({ x: 100, y: 0, width: 100, height: 50 })
    const rotated = transformElementAffine(rect, rotationAffine(90, { x: 50, y: 25 }))
    expect(rotated.rotation).toBe(90)
    expect(rotated.x! + rotated.width! / 2).toBeCloseTo(50)
    const path = createVectorElement('path', { x: 0, y: 0, width: 100, height: 100 }, { vectorNodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })
    const mirrored = { ...path, ...transformElementAffine(path, flipAffine('x', { x: 50, y: 50 })) }
    expect(nodeWorldPosition(mirrored, mirrored.vectorNodes![0]!)).toEqual({ x: 100, y: 0 })
  })

  it('tests lasso membership by corners and centre', () => {
    const triangle = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }]
    expect(pointInPolygon({ x: 50, y: 50 }, triangle)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 150 }, triangle)).toBe(false)
    expect(elementInLasso(createVectorElement('rectangle', { x: 20, y: 20, width: 40, height: 40 }), triangle)).toBe(true)
    expect(elementInLasso(createVectorElement('rectangle', { x: 300, y: 300, width: 40, height: 40 }), triangle)).toBe(false)
  })
})
