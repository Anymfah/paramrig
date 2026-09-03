import { describe, expect, it } from 'vitest'
import { cameraFrame } from '@/scene/viewport/cameraFrame'
import type { CameraData } from '@/scene/types'

/**
 * The camera frame is arithmetic, so it is tested as arithmetic: the rectangle's shape, where a
 * shift moves it, and — the one that matters — that the widened field of view puts exactly the
 * camera's own view inside the frame and no more.
 */

function camera(patch: Partial<CameraData> = {}): CameraData {
  return {
    kind: 'camera',
    projection: 'perspective',
    focalLength: 50,
    sensor: 36,
    orthoScale: 6,
    clipStart: 0.1,
    clipEnd: 100,
    ...patch,
  }
}

/** Half the height the frustum covers at a distance of one, which is what a fov means. */
function halfHeight(fovDegrees: number): number {
  return Math.tan((fovDegrees * Math.PI) / 360)
}

describe('the camera frame', () => {
  it('fits the render’s aspect inside the region with a margin', () => {
    const frame = cameraFrame({ viewport: { width: 1200, height: 800 }, camera: camera(), output: { width: 1920, height: 1080 } })
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 5)
    expect(frame.width).toBeLessThanOrEqual(1200 * 0.9 + 0.001)
    expect(frame.height).toBeLessThanOrEqual(800 * 0.9 + 0.001)
    // Centred: the margins on the two sides are the same.
    expect(frame.x).toBeCloseTo((1200 - frame.width) / 2, 5)
    expect(frame.y).toBeCloseTo((800 - frame.height) / 2, 5)
  })

  it('is limited by the region’s height when the render is tall', () => {
    const frame = cameraFrame({ viewport: { width: 1200, height: 800 }, camera: camera(), output: { width: 1080, height: 1920 } })
    expect(frame.height).toBeCloseTo(800 * 0.9, 5)
    expect(frame.width / frame.height).toBeCloseTo(1080 / 1920, 5)
  })

  it('shows exactly the camera’s own view inside the frame', () => {
    const viewport = { width: 1200, height: 800 }
    const output = { width: 1920, height: 1080 }
    const frame = cameraFrame({ viewport, camera: camera({ focalLength: 35 }), output })
    /*
     * At a distance of one, the viewport covers `halfHeight(viewFov)` above its centre over
     * `viewport.height` pixels. The frame's own half-height in world units must therefore be that,
     * scaled by the frame's share of the region — and that must equal what a 35 mm lens sees.
     */
    const perPixel = halfHeight(frame.viewFov) / (viewport.height / 2)
    const frameHalf = perPixel * (frame.height / 2)
    const horizontal = 2 * Math.atan(36 / (2 * 35))
    const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / (output.width / output.height))
    expect(frameHalf).toBeCloseTo(Math.tan(vertical / 2), 6)
  })

  it('moves the frame by a shift without turning the camera', () => {
    const plain = cameraFrame({ viewport: { width: 1200, height: 800 }, camera: camera() })
    const shifted = cameraFrame({ viewport: { width: 1200, height: 800 }, camera: camera({ shiftX: 0.1, shiftY: 0.25 }) })
    expect(shifted.x - plain.x).toBeCloseTo(plain.width * 0.1, 5)
    // Up on screen is a smaller y, which is why a positive shift subtracts.
    expect(shifted.y - plain.y).toBeCloseTo(-plain.width * 0.25, 5)
    expect(shifted.width).toBeCloseTo(plain.width, 5)
    expect(shifted.viewFov).toBeCloseTo(plain.viewFov, 5)
  })

  it('answers a height rather than a field of view for an orthographic camera', () => {
    const frame = cameraFrame({
      viewport: { width: 1200, height: 800 },
      camera: camera({ projection: 'orthographic', orthoScale: 8 }),
      output: { width: 1000, height: 1000 },
    })
    expect(frame.viewOrthoHeight).not.toBeNull()
    // The camera sees eight units across a square frame, and the region is taller than the frame by
    // the same ratio the height is, so the viewport sees more than eight.
    expect(frame.viewOrthoHeight!).toBeCloseTo(8 * (800 / frame.height), 5)
    expect(frame.viewFov).toBe(0)
  })

  it('never divides by nothing when the region has no size yet', () => {
    const frame = cameraFrame({ viewport: { width: 0, height: 0 }, camera: camera() })
    expect(Number.isFinite(frame.width)).toBe(true)
    expect(Number.isFinite(frame.viewFov)).toBe(true)
    expect(frame.width).toBeGreaterThan(0)
  })
})
