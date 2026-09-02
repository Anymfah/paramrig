import { describe, expect, it } from 'vitest'
import { copyAngles, IDENTITY_TRANSFORM, isIdentityTransform, numericPatches, rotatedCopyPatches, stepBetween } from '@/vector/repeat'
import { createVectorElement } from '@/vector/document'
import type { VectorElement } from '@/vector/types'

function box(x: number, y: number, width = 100, height = 50): VectorElement {
  return { ...createVectorElement('rectangle', { x, y, width, height }), id: `e${x}-${y}` }
}

describe('numeric transforms', () => {
  it('leaves everything alone when nothing is asked', () => {
    expect(isIdentityTransform(IDENTITY_TRANSFORM)).toBe(true)
    const [patch] = numericPatches([box(10, 20)], IDENTITY_TRANSFORM)

    expect(patch!.patch).toMatchObject({ x: 10, y: 20, width: 100, height: 50 })
  })

  it('moves, scales and rotates about the centre of the selection', () => {
    const [patch] = numericPatches([box(0, 0)], { ...IDENTITY_TRANSFORM, dx: 20, dy: -5, scaleX: 200, scaleY: 50 })

    expect(patch!.patch).toMatchObject({ width: 200, height: 25, x: -50 + 20, y: 12.5 - 5 })
  })

  it('turns a shape without moving its centre', () => {
    const [patch] = numericPatches([box(0, 0)], { ...IDENTITY_TRANSFORM, rotation: 90 })

    expect(patch!.patch.rotation).toBeCloseTo(90, 5)
    expect(patch!.patch.x).toBeCloseTo(0, 5)
    expect(patch!.patch.y).toBeCloseTo(0, 5)
  })

  it('flips about the centre of the whole selection, not each shape', () => {
    const patches = numericPatches([box(0, 0), box(200, 0)], { ...IDENTITY_TRANSFORM, flipX: true })

    expect(patches[0]!.patch.x).toBeCloseTo(200, 5)
    expect(patches[1]!.patch.x).toBeCloseTo(0, 5)
  })

  it('takes a pivot when one is given', () => {
    const [patch] = numericPatches([box(0, 0)], { ...IDENTITY_TRANSFORM, scaleX: 200, scaleY: 200 }, { x: 0, y: 0 })

    expect(patch!.patch).toMatchObject({ x: 0, y: 0, width: 200, height: 100 })
  })
})

describe('reading back a step', () => {
  it('is the move the user just made', () => {
    expect(stepBetween([box(0, 0)], [{ ...box(0, 0), x: 30, y: 12 }])).toMatchObject({ dx: 30, dy: 12, scaleX: 100, scaleY: 100, rotation: 0 })
  })

  it('carries the scale and the rotation too', () => {
    const after = { ...box(0, 0), width: 200, rotation: 15 }

    expect(stepBetween([box(0, 0)], [after])).toMatchObject({ scaleX: 200, scaleY: 100, rotation: 15 })
  })

  it('stays null when nothing happened, so a plain duplicate arms nothing', () => {
    expect(stepBetween([box(0, 0)], [box(0, 0)])).toBeNull()
    expect(stepBetween([], [])).toBeNull()
    expect(stepBetween([box(0, 0)], [])).toBeNull()
  })

  it('replays as the same move', () => {
    const step = stepBetween([box(0, 0)], [{ ...box(0, 0), x: 30, y: 12 }])!
    const [patch] = numericPatches([box(30, 12)], step)

    expect(patch!.patch).toMatchObject({ x: 60, y: 24 })
  })
})

describe('rotated copies', () => {
  it('spreads copies over the angle asked for', () => {
    expect(copyAngles(3, 90)).toEqual([30, 60, 90])
  })

  it('shares a full turn between the copies and the original', () => {
    expect(copyAngles(5, 360)).toEqual([60, 120, 180, 240, 300])
  })

  it('keeps the count sane', () => {
    expect(copyAngles(0, 90)).toEqual([90])
    expect(copyAngles(400, 360).length).toBe(180)
  })

  it('swings a copy around the pivot', () => {
    const [patch] = rotatedCopyPatches([box(100, -25)], 90, { x: 0, y: 0 })

    // The centre sits at (150, 0); a quarter turn puts it at (0, 150).
    expect(patch!.patch.x).toBeCloseTo(-50, 4)
    expect(patch!.patch.y).toBeCloseTo(125, 4)
    expect(patch!.patch.rotation).toBeCloseTo(90, 4)
  })
})
