import { describe, expect, it } from 'vitest'
import { collectSnapTargets, snapBoundsDelta, snapEdge, snapPoint } from '@/vector/snapping'
import type { VectorElement } from '@/vector/types'

function shape(id: string, x: number, y: number, width = 100, height = 50): VectorElement {
  return { id, kind: 'rectangle', name: id, x, y, width, height, rotation: 0, fill: '#000000', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false }
}

describe('snapping', () => {
  const others = [shape('a', 200, 100), shape('hidden', 500, 500)]
  others[1]!.visible = false
  const page = { width: 800, height: 600 }

  it('collects edges and centres of visible elements, page bounds and guides, excluding moving ids', () => {
    const targets = collectSnapTargets([...others, shape('me', 0, 0)], ['me'], page, [{ id: 'g', axis: 'y', position: 33 }], { objects: true, guides: true })
    const xs = targets.filter((target) => target.axis === 'x').map((target) => `${target.kind}:${target.value}`)
    expect(xs).toEqual(['edge:200', 'center:250', 'edge:300', 'page:0', 'page:400', 'page:800'])
    expect(targets.some((target) => target.kind === 'guide' && target.value === 33)).toBe(true)
    const none = collectSnapTargets(others, [], page, [], { objects: false, guides: false })
    expect(none).toEqual([])
  })

  it('snaps a moving box within the threshold and reports guide lines', () => {
    const targets = collectSnapTargets(others, ['me'], null, [], { objects: true, guides: false })
    const moving = shape('me', 0, 0)
    const result = snapBoundsDelta(moving, { x: 96, y: 0 }, targets, 6)
    expect(result.dx).toBe(100)
    expect(result.dy).toBe(0)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ axis: 'x', value: 200, kind: 'edge', from: 0, to: 150 })
    expect(snapBoundsDelta(moving, { x: 80, y: 0 }, targets, 6).dx).toBe(80)
  })

  it('prefers the nearest target and snaps each axis independently', () => {
    const targets = collectSnapTargets(others, [], null, [], { objects: true, guides: false })
    const moving = shape('me', 0, 0, 100, 50)
    const result = snapBoundsDelta(moving, { x: 148, y: 74 }, targets, 6)
    expect(result.dx).toBe(150)
    expect(result.dy).toBe(75)
    expect(result.matches.map((match) => `${match.axis}:${match.value}`).sort()).toEqual(['x:200', 'y:100'])
  })

  it('falls back to whole pixels when nothing else is close', () => {
    const result = snapBoundsDelta(shape('me', 0.4, 0.2), { x: 10.3, y: 0 }, [], 6, { pixel: true })
    expect(result.dx).toBe(10.6)
    expect(result.dy).toBe(-0.2)
    const point = snapPoint({ x: 12.7, y: 3.2 }, [], 6, { pixel: true })
    expect(point.point).toEqual({ x: 13, y: 3 })
  })

  it('snaps points and edges to guides', () => {
    const targets = collectSnapTargets([], [], null, [{ id: 'v', axis: 'x', position: 120 }], { objects: false, guides: true })
    expect(snapPoint({ x: 117, y: 40 }, targets, 6).point).toEqual({ x: 120, y: 40 })
    expect(snapPoint({ x: 100, y: 40 }, targets, 6).matches).toEqual([])
    const edge = snapEdge('x', 123, targets, 6, [0, 50])
    expect(edge.value).toBe(120)
    expect(edge.matches[0]).toMatchObject({ kind: 'guide', axis: 'x' })
  })
})
