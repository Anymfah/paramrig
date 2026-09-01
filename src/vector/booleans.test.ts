import { describe, expect, it } from 'vitest'
import { booleanOperation, flattenElement, outlineStroke, toPaperItem } from '@/vector/booleans'
import { createVectorElement } from '@/vector/document'
import { chains, networkFromRuns, normalizeWorld, worldNetwork } from '@/vector/network'
import { computeFaces } from '@/vector/planar'
import type { VectorElement } from '@/vector/types'

const rect = (x: number, y: number, size = 100): VectorElement => createVectorElement('rectangle', { x, y, width: size, height: size })

describe('boolean geometry', () => {
  it('unites overlapping rectangles into one outline', () => {
    const result = booleanOperation('unite', [rect(0, 0), rect(50, 50)])!
    expect(result).toMatchObject({ x: 0, y: 0, width: 150, height: 150 })
    expect(result.network!.nodes).toHaveLength(8)
    expect(chains(worldNetwork({ ...rect(0, 0), ...result, kind: 'path' }))).toHaveLength(1)
  })

  it('subtracts, intersects and excludes', () => {
    const subtract = booleanOperation('subtract', [rect(0, 0), rect(50, 50)])!
    expect(subtract.network!.nodes).toHaveLength(6)
    const intersect = booleanOperation('intersect', [rect(0, 0), rect(50, 50)])!
    expect(intersect).toMatchObject({ x: 50, y: 50, width: 50, height: 50 })
    const exclude = booleanOperation('exclude', [rect(0, 0), rect(50, 50)])!
    expect(chains(worldNetwork({ ...rect(0, 0), ...exclude, kind: 'path' }))).toHaveLength(2)
    expect(booleanOperation('unite', [rect(0, 0)])).toBeNull()
  })

  it('keeps curves when uniting ellipses and bakes rotation', () => {
    const a = createVectorElement('ellipse', { x: 0, y: 0, width: 100, height: 100 })
    const b = { ...createVectorElement('ellipse', { x: 60, y: 0, width: 100, height: 100 }), rotation: 45 }
    const result = booleanOperation('unite', [a, b])!
    expect(result.network!.segments.some((segment) => segment.ah || segment.bh)).toBe(true)
    expect(result.width).toBeGreaterThan(150)
    const item = toPaperItem(b)
    expect(item.bounds.width).toBeCloseTo(100, 0)
    item.remove()
  })

  it('flattens crossing regions into one filled outline', () => {
    const built = normalizeWorld(networkFromRuns([
      { points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }, { anchor: { x: 100, y: 100 } }, { anchor: { x: 0, y: 100 } }], closed: true },
      { points: [{ anchor: { x: 50, y: 50 } }, { anchor: { x: 150, y: 50 } }, { anchor: { x: 150, y: 150 } }, { anchor: { x: 50, y: 150 } }], closed: true },
    ]))
    const element = createVectorElement('path', built, { network: built.network })
    expect(computeFaces(worldNetwork(element))).toHaveLength(3)
    const result = flattenElement(element)!
    const flattened = { ...element, ...result }
    expect(computeFaces(worldNetwork(flattened))).toHaveLength(1)
    expect(result.network!.nodes).toHaveLength(8)
  })

  it('outlines a stroke into filled geometry', () => {
    const built = normalizeWorld(networkFromRuns([{ points: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false }]))
    const line = createVectorElement('path', built, { network: built.network, strokeWidth: 10 })
    const result = outlineStroke(line)!
    expect(result.width).toBeCloseTo(100, 0)
    expect(result.height).toBeCloseTo(10, 0)
    const inside = outlineStroke({ ...rect(0, 0), stroke: '#FFFFFF', strokeWidth: 10, strokeAlign: 'inside' })!
    expect(inside).toMatchObject({ x: 0, y: 0, width: 100, height: 100 })
    expect(chains(worldNetwork({ ...rect(0, 0), ...inside, kind: 'path' }))).toHaveLength(2)
    expect(outlineStroke({ ...rect(0, 0), strokeWidth: 0 })).toBeNull()
  })
})
