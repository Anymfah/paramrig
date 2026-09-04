import { describe, expect, it } from 'vitest'
import { activeUv } from '@/scene/mesh/uv'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import { uvGeometry } from '@/scene/uv/geometry'
import { applyUvResults, clampToImage, uvMedian, uvTargets, uvViewBasis, UV_UNITS } from '@/scene/uv/transform'
import {
  beginTransform,
  confirmTransform,
  transformOutput,
  updateTransform,
  type TransformSession,
} from '@/scene/transform/session'

/**
 * The same session the viewport drives, driven flat.
 *
 * These are whole gestures — open, move, read the answer — because the thing worth proving is that
 * the session's world arithmetic lands where a person pointed once the camera it is given is the
 * image itself.
 */

const VIEW = { pan: [0, 512] as [number, number], zoom: 512 }

function open(points: number[], mode: 'move' | 'rotate' | 'scale' = 'move'): { session: TransformSession; geometry: ReturnType<typeof uvGeometry> } {
  const mesh = planeMesh()
  const geometry = uvGeometry(mesh, activeUv(mesh)!)
  const median = uvMedian(geometry, points)
  const session = beginTransform({
    mode,
    targets: uvTargets(geometry, points),
    pivot: 'median',
    orientation: 'global',
    view: uvViewBasis(VIEW, median),
    pointer: [256, 256],
    units: UV_UNITS,
  })
  return { session, geometry }
}

describe('moving UVs with the viewport’s own session', () => {
  it('moves a point by the pointer, in the image’s own units', () => {
    const { session, geometry } = open([0])
    // A hundred and twenty-eight pixels of a five-hundred-and-twelve-pixel image is a quarter of it.
    const moved = updateTransform(session, { cursor: [384, 128], modifiers: { shift: false, ctrl: false, alt: false } })
    const data = applyUvResults(activeUv(planeMesh())!, geometry, confirmTransform(moved))
    expect(data[0]).toBeCloseTo(0.25, 6)
    expect(data[1]).toBeCloseTo(0.25, 6)
  })

  it('says what it is doing without offering a unit a UV does not have', () => {
    const { session } = open([0])
    const moved = updateTransform(session, { cursor: [384, 256], modifiers: { shift: false, ctrl: false, alt: false } })
    expect(transformOutput(moved).header).toContain('0.25')
    expect(transformOutput(moved).header).not.toContain(' m')
  })

  it('takes X and Y as the constraints they are in the image', () => {
    const { session, geometry } = open([0])
    const constrained = updateTransform(session, {
      cursor: [384, 128],
      modifiers: { shift: false, ctrl: false, alt: false },
      key: 'y',
    })
    const data = applyUvResults(activeUv(planeMesh())!, geometry, confirmTransform(constrained))
    expect(data[0]).toBeCloseTo(0, 6)
    expect(data[1]).toBeCloseTo(0.25, 6)
  })

  it('takes a number typed instead of a distance dragged', () => {
    const { session, geometry } = open([0])
    let moved = updateTransform(session, { cursor: [300, 256], modifiers: { shift: false, ctrl: false, alt: false } })
    for (const key of ['x', '0', '.', '5']) {
      moved = updateTransform(moved, { cursor: [300, 256], modifiers: { shift: false, ctrl: false, alt: false }, key })
    }
    const data = applyUvResults(activeUv(planeMesh())!, geometry, confirmTransform(moved))
    expect(data[0]).toBeCloseTo(0.5, 6)
    expect(data[1]).toBeCloseTo(0, 6)
  })

  it('scales about the middle of what is selected', () => {
    const mesh = planeMesh()
    const geometry = uvGeometry(mesh, activeUv(mesh)!)
    const points = [0, 1, 2, 3]
    const median = uvMedian(geometry, points)
    expect(median).toEqual([0.5, 0.5])
    const session = beginTransform({
      mode: 'scale',
      targets: uvTargets(geometry, points),
      pivot: 'median',
      orientation: 'global',
      view: uvViewBasis(VIEW, median),
      // The pointer starts a quarter of the image from the middle and is dragged to half of it,
      // which doubles the distance and so the scale.
      pointer: [384, 256],
      units: UV_UNITS,
    })
    const scaled = updateTransform(session, { cursor: [512, 256], modifiers: { shift: false, ctrl: false, alt: false } })
    const data = applyUvResults(activeUv(mesh)!, geometry, confirmTransform(scaled))
    expect(data[0]).toBeCloseTo(-0.5, 6)
    expect(data[4]).toBeCloseTo(1.5, 6)
  })

  it('moves every corner sitting on a point, so a seam does not tear open', () => {
    const cube = boxMesh()
    const geometry = uvGeometry(cube, activeUv(cube)!)
    // A point of the cube's map that several corners share.
    const shared = [...geometry.pointCount].findIndex((count) => count > 1)
    expect(shared).toBeGreaterThanOrEqual(0)
    const data = applyUvResults(activeUv(cube)!, geometry, [
      { id: String(shared), transform: { position: [0.75, 0.75, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    ])
    const start = geometry.pointStart[shared]!
    for (let index = 0; index < geometry.pointCount[shared]!; index += 1) {
      const loop = geometry.pointLoops[start + index]!
      expect([data[loop * 2], data[loop * 2 + 1]]).toEqual([0.75, 0.75])
    }
  })

  it('leaves the map it was given alone', () => {
    const mesh = planeMesh()
    const geometry = uvGeometry(mesh, activeUv(mesh)!)
    const before = activeUv(mesh)!
    const after = applyUvResults(before, geometry, [
      { id: '0', transform: { position: [9, 9, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    ])
    expect(before[0]).toBe(0)
    expect(after[0]).toBe(9)
  })

  it('keeps a map inside the image when it is asked to', () => {
    expect(clampToImage([-0.5, 0.5, 1.5, 0.25])).toEqual([0, 0.5, 1, 0.25])
  })
})
