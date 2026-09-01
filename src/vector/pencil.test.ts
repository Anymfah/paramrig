import { describe, expect, it } from 'vitest'
import { fitSmoothNodes, pencilNodes, simplifyPolyline, thinPolyline } from '@/vector/pencil'

describe('pencil', () => {
  it('simplifies collinear points and keeps corners', () => {
    const line = Array.from({ length: 11 }, (_, index) => ({ x: index * 10, y: index % 2 ? 0.3 : 0 }))
    expect(simplifyPolyline(line, 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    const corner = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }]
    expect(simplifyPolyline(corner, 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
  })

  it('thins dense samples but keeps the last one', () => {
    const dense = Array.from({ length: 21 }, (_, index) => ({ x: index * 0.5, y: 0 }))
    const thinned = thinPolyline(dense, 2)
    expect(thinned[0]).toEqual({ x: 0, y: 0 })
    expect(thinned[thinned.length - 1]).toEqual({ x: 10, y: 0 })
    expect(thinned.length).toBeLessThan(dense.length)
  })

  it('fits smooth nodes with tangents along the curve and corners where it bends sharply', () => {
    const arc = Array.from({ length: 9 }, (_, index) => { const angle = Math.PI * index / 8; return { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 } })
    const nodes = fitSmoothNodes(arc)
    expect(nodes[0]!.out).toBeDefined()
    expect(nodes[0]!.in).toBeUndefined()
    expect(nodes[4]!.in).toBeDefined()
    expect(nodes[4]!.out).toBeDefined()
    expect(nodes[8]!.in).toBeDefined()
    const tangent = { x: nodes[4]!.out!.x - nodes[4]!.anchor.x, y: nodes[4]!.out!.y - nodes[4]!.anchor.y }
    expect(Math.abs(tangent.y)).toBeLessThan(1e-6)
    const bent = fitSmoothNodes([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    expect(bent[1]!.in).toBeUndefined()
  })

  it('runs the full pipeline', () => {
    const wobble = Array.from({ length: 200 }, (_, index) => ({ x: index, y: Math.sin(index / 20) * 30 + (index % 3) * 0.2 }))
    const nodes = pencilNodes(wobble, 1)
    expect(nodes.length).toBeGreaterThan(3)
    expect(nodes.length).toBeLessThan(40)
    expect(nodes[0]!.anchor).toEqual({ x: 0, y: 0 })
  })
})
