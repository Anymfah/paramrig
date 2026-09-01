import { describe, expect, it } from 'vitest'
import { boxMap, elementInLasso, flipAffine, pointInPolygon, rotationAffine, transformElementAffine } from '@/vector/affine'
import { createVectorElement } from '@/vector/document'
import { networkFromRuns, normalizeWorld, worldNetwork } from '@/vector/network'
import type { VectorElement } from '@/vector/types'

function triangle(rotation = 0): VectorElement {
  const built = normalizeWorld(networkFromRuns([{ points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }, { anchor: { x: 100, y: 100 } }], closed: true }]))
  return { ...createVectorElement('path', built, { network: built.network }), rotation }
}

describe('affine transforms', () => {
  it('bakes non-uniform scale into rotated paths exactly', () => {
    const path = triangle(45)
    const before = worldNetwork(path).nodes.map((node) => node.point)
    const patch = transformElementAffine(path, boxMap({ x: -50, y: -50, width: 200, height: 200 }, { x: -50, y: -50, width: 400, height: 200 }))
    const after = { ...path, ...patch }
    expect(after.rotation).toBe(0)
    worldNetwork(after).nodes.forEach((node, index) => {
      expect(node.point.x).toBeCloseTo(-50 + (before[index]!.x + 50) * 2, 1)
      expect(node.point.y).toBeCloseTo(before[index]!.y, 1)
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
    expect(flipped).toMatchObject({ x: 100, y: 0, width: 100, height: 50, rotation: 0 })
    const tilted = transformElementAffine({ ...rect, rotation: 30 }, flipAffine('x', { x: 50, y: 25 }))
    expect(tilted.rotation).toBeCloseTo(-30)
    const rotated = transformElementAffine(rect, rotationAffine(90, { x: 50, y: 25 }))
    expect(rotated.rotation).toBe(90)
    expect(rotated.x! + rotated.width! / 2).toBeCloseTo(50)
    const path = triangle()
    const mirrored = { ...path, ...transformElementAffine(path, flipAffine('x', { x: 50, y: 50 })) }
    expect(worldNetwork(mirrored).nodes[0]!.point).toEqual({ x: 100, y: 0 })
  })

  it('tests lasso membership by corners and centre', () => {
    const shape = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }]
    expect(pointInPolygon({ x: 50, y: 50 }, shape)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 150 }, shape)).toBe(false)
    expect(elementInLasso(createVectorElement('rectangle', { x: 20, y: 20, width: 40, height: 40 }), shape)).toBe(true)
    expect(elementInLasso(createVectorElement('rectangle', { x: 300, y: 300, width: 40, height: 40 }), shape)).toBe(false)
  })
})

describe('text under an affine', () => {
  const text = (): VectorElement => ({
    id: 't', kind: 'text', name: 'Text', x: 0, y: 0, width: 100, height: 40, rotation: 0,
    fill: '#FFFFFF', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false,
    text: 'Hi', fontSize: 20, letterSpacing: 2,
  })

  it('scales the letters with the box', () => {
    const patch = transformElementAffine(text(), { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })

    expect(patch).toMatchObject({ width: 200, height: 80, fontSize: 40, letterSpacing: 4 })
  })

  it('leaves the letters alone when the box only moves or turns', () => {
    const moved = transformElementAffine(text(), { a: 1, b: 0, c: 0, d: 1, e: 30, f: 10 })
    const turned = transformElementAffine(text(), rotationAffine(90, { x: 50, y: 20 }))

    expect(moved.fontSize).toBeUndefined()
    expect(turned.fontSize).toBeUndefined()
    expect(turned.rotation).toBe(90)
  })

  it('keeps a mirrored text readable rather than shrinking it', () => {
    const patch = transformElementAffine(text(), flipAffine('x', { x: 50, y: 20 }))

    expect(patch.fontSize).toBeUndefined()
    expect(patch).toMatchObject({ width: 100, height: 40 })
  })
})
