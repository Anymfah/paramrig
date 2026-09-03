import { describe, expect, it } from 'vitest'
import { createVectorElement } from '@/vector/document'
import { boxForInk, FULL_INK, inkBox, inkCenter, inkRatio, inkSelectionBounds, isFullInk, networkBounds } from '@/vector/ink'
import { polygonNetwork } from '@/vector/shapes'
import type { VectorElement } from '@/vector/types'

const ellipse = (patch: Partial<VectorElement> = {}): VectorElement => ({
  ...createVectorElement('ellipse', { x: 100, y: 100, width: 200, height: 200 }),
  ...patch,
})

describe('what an element actually covers of its box', () => {
  it('is the whole box for the shapes that fill it', () => {
    expect(inkRatio(createVectorElement('rectangle', { x: 0, y: 0, width: 10, height: 10 }))).toEqual(FULL_INK)
    expect(inkRatio(ellipse())).toEqual(FULL_INK)
    // A ring keeps the ellipse's own extent: the hole is inside it.
    expect(inkRatio(ellipse({ arcRatio: 0.5 }))).toEqual(FULL_INK)
    expect(isFullInk(FULL_INK)).toBe(true)
  })

  it('is the slice itself once an ellipse is opened', () => {
    // A quarter from 0° to 90° is the top-right of the frame, plus the centre it closes on.
    const ratio = inkRatio(ellipse({ arcStart: 0, arcSweep: 90 }))

    expect(ratio.x).toBeCloseTo(0.5, 3)
    expect(ratio.y).toBeCloseTo(0, 3)
    expect(ratio.width).toBeCloseTo(0.5, 3)
    expect(ratio.height).toBeCloseTo(0.5, 3)
  })

  it('reaches past the ends of a curve where the curve does', () => {
    // The half from 0° to 180° is the whole top of the ellipse, edge to edge.
    const ratio = inkRatio(ellipse({ arcStart: 0, arcSweep: 180 }))

    expect(ratio.x).toBeCloseTo(0, 3)
    expect(ratio.width).toBeCloseTo(1, 3)
    expect(ratio.height).toBeCloseTo(0.5, 3)
  })

  it('leaves a network that already fills its box alone', () => {
    expect(networkBounds(polygonNetwork({ sides: 5, innerRatio: 0.45 }))).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('puts the ink box where the slice is', () => {
    expect(inkBox(ellipse({ arcStart: 0, arcSweep: 90 }))).toMatchObject({ x: 200, y: 100, width: 100, height: 100 })
  })
})

describe('resizing what is drawn rather than the frame behind it', () => {
  it('gives back the wanted box when the ink is the whole box', () => {
    const box = { x: 0, y: 0, width: 50, height: 40 }
    expect(boxForInk(ellipse(), box)).toEqual(box)
  })

  it('grows the frame so the slice lands where it was dragged', () => {
    const quarter = ellipse({ arcStart: 0, arcSweep: 90 })
    const wanted = { x: 0, y: 0, width: 300, height: 200 }

    const box = boxForInk(quarter, wanted)

    expect(box).toMatchObject({ width: 600, height: 400 })
    expect(inkBox({ ...quarter, ...box })).toMatchObject(wanted)
  })

  it('holds the ink in place through a rotation', () => {
    const quarter = ellipse({ arcStart: 0, arcSweep: 90 })
    const before = inkCenter(quarter)
    const turned = { ...quarter, rotation: 37 }
    // Re-derived from the ink it had, the frame keeps that ink where it was.
    const box = boxForInk(turned, inkSelectionBounds([quarter]))

    const after = inkCenter({ ...turned, ...box })
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('reads several elements by what they draw', () => {
    const quarter = ellipse({ arcStart: 0, arcSweep: 90 })
    const bounds = inkSelectionBounds([quarter])

    expect(bounds).toMatchObject({ x: 200, y: 100, width: 100, height: 100 })
  })
})
