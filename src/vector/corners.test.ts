import { describe, expect, it } from 'vitest'
import { cornerHandlePoint, cornerRadiusAt, cornerRadiusPatch, cornerRadii, maxCornerRadius, maxNodeRadius, nodeCorner, nodeRadiusAt, nodeRadiusHandle } from '@/vector/corners'
import type { VectorElement } from '@/vector/types'

const box = { x: 100, y: 100, width: 200, height: 120, rotation: 0 } as Pick<VectorElement, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'cornerRadius'>

describe('corner handles', () => {
  it('sits where the rounding starts, but never right on the corner', () => {
    expect(cornerHandlePoint({ ...box, cornerRadius: 40 }, 'nw', 1)).toEqual({ x: 140, y: 140 })
    expect(cornerHandlePoint({ ...box, cornerRadius: 0 }, 'nw', 1)).toEqual({ x: 110, y: 110 })
    expect(cornerHandlePoint({ ...box, cornerRadius: 40 }, 'se', 1)).toEqual({ x: 260, y: 180 })
  })

  it('keeps the same screen inset whatever the zoom', () => {
    expect(cornerHandlePoint({ ...box, cornerRadius: 0 }, 'nw', 0.5).x).toBe(120)
    expect(cornerHandlePoint({ ...box, cornerRadius: 0 }, 'nw', 4).x).toBe(102.5)
  })

  it('never crosses the middle of the box', () => {
    expect(cornerHandlePoint({ ...box, cornerRadius: 500 }, 'nw', 1)).toEqual({ x: 160, y: 160 })
    expect(maxCornerRadius(box)).toBe(60)
  })

  it('follows a rotated box', () => {
    const turned = cornerHandlePoint({ ...box, cornerRadius: 40, rotation: 90 }, 'nw', 1)

    expect(Math.hypot(turned.x - 200, turned.y - 160)).toBeCloseTo(Math.hypot(140 - 200, 140 - 160))
    expect(turned).not.toEqual({ x: 140, y: 140 })
  })
})

describe('reading a radius off a drag', () => {
  it('averages how far in the drag went on each edge', () => {
    expect(cornerRadiusAt(box, 'nw', { x: 120, y: 140 })).toBe(30)
    expect(cornerRadiusAt(box, 'se', { x: 280, y: 200 })).toBe(20)
  })

  it('clamps to the box and to zero', () => {
    expect(cornerRadiusAt(box, 'nw', { x: 90, y: 90 })).toBe(0)
    expect(cornerRadiusAt(box, 'nw', { x: 999, y: 999 })).toBe(60)
  })

  it('reads a rotated box in its own frame', () => {
    const turned = { ...box, rotation: 45 }
    const handle = cornerHandlePoint({ ...turned, cornerRadius: 30 }, 'ne', 1)

    expect(cornerRadiusAt(turned, 'ne', handle)).toBeCloseTo(30)
  })
})

describe('writing the radius back', () => {
  it('sets every corner at once by default', () => {
    expect(cornerRadiusPatch(box, 'nw', 12, false)).toEqual({ cornerRadius: 12 })
    expect(cornerRadiusPatch(box, 'nw', 0, false)).toEqual({ cornerRadius: undefined })
  })

  it('sets one corner on its own, keeping the others', () => {
    const patch = cornerRadiusPatch({ ...box, cornerRadius: 10 }, 'se', 40, true)

    expect(patch.cornerRadius).toEqual([10, 10, 40, 10])
    expect(cornerRadii({ ...box, ...patch })).toEqual([10, 10, 40, 10])
  })

  it('forgets the radius once every corner is square again', () => {
    expect(cornerRadiusPatch({ ...box, cornerRadius: [0, 0, 5, 0] }, 'se', 0, true)).toEqual({ cornerRadius: undefined })
  })
})

describe('rounding a corner of a path', () => {
  const anchor = { x: 100, y: 100 }
  const previous = { x: 0, y: 100 }
  const next = { x: 100, y: 0 }

  it('reads a right angle and how far its neighbours are', () => {
    const corner = nodeCorner(previous, anchor, next)!
    expect(corner.halfAngle).toBeCloseTo(Math.PI / 4)
    // The bisector points up and to the left, into the corner.
    expect(corner.bisector.x).toBeCloseTo(-Math.SQRT1_2)
    expect(corner.bisector.y).toBeCloseTo(-Math.SQRT1_2)
    expect(corner.reach).toBe(50)
  })

  it('says there is no corner where the path runs straight through', () => {
    expect(nodeCorner({ x: 0, y: 100 }, anchor, { x: 200, y: 100 })).toBeNull()
    expect(nodeCorner({ x: 0, y: 100 }, anchor, { x: 0, y: 100 })).toBeNull()
  })

  it('caps the radius at what the shorter edge allows', () => {
    // A right angle: tan(45°) is 1, so the cap is the reach itself.
    expect(maxNodeRadius(nodeCorner(previous, anchor, next)!)).toBeCloseTo(50)
  })

  it('puts the handle on the bisector, and keeps it grabbable at zero', () => {
    const corner = nodeCorner(previous, anchor, next)!
    const atZero = nodeRadiusHandle(anchor, corner, 0, 1)
    expect(Math.hypot(atZero.x - anchor.x, atZero.y - anchor.y)).toBeCloseTo(10)
    const at20 = nodeRadiusHandle(anchor, corner, 20, 1)
    expect(Math.hypot(at20.x - anchor.x, at20.y - anchor.y)).toBeCloseTo(20)
  })

  it('reads a radius back from where the handle was dragged to', () => {
    const corner = nodeCorner(previous, anchor, next)!
    const point = { x: anchor.x + corner.bisector.x * 30, y: anchor.y + corner.bisector.y * 30 }
    expect(nodeRadiusAt(anchor, corner, point)).toBeCloseTo(30)
    // Dragged back past the corner, or past what the edges allow.
    expect(nodeRadiusAt(anchor, corner, { x: anchor.x + 40, y: anchor.y + 40 })).toBe(0)
    expect(nodeRadiusAt(anchor, corner, { x: anchor.x + corner.bisector.x * 500, y: anchor.y + corner.bisector.y * 500 })).toBeCloseTo(50)
  })
})
