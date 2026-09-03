import { describe, expect, it } from 'vitest'
import {
  AXIS_VIEWS,
  boxRadius,
  cameraBasis,
  cameraDirection,
  cameraPosition,
  clampPitch,
  damp,
  dampAngle,
  fovFromFocalLength,
  frameBox,
  isAxisView,
  orthoHeight,
  unionBox,
  wrapYaw,
  zoomDistance,
  zoomToPoint,
} from '@/scene/viewport/view'

const close = (value: number, expected: number, tolerance = 1e-6) => expect(Math.abs(value - expected)).toBeLessThan(tolerance)

describe('where the camera is', () => {
  it('puts the front view on the minus-Y side, looking towards plus Y', () => {
    const position = cameraPosition({ target: [0, 0, 0], yaw: 0, pitch: 0, distance: 10 })

    expect(position.map((value) => Math.round(value) + 0)).toEqual([0, -10, 0])
    expect(cameraDirection(0, 0).map((value) => Math.round(value) + 0)).toEqual([0, 1, 0])
  })

  it('puts the right view on the plus-X side, the way the numeric pad does', () => {
    expect(cameraPosition({ target: [0, 0, 0], yaw: 90, pitch: 0, distance: 4 }).map((value) => Math.round(value) + 0)).toEqual([4, 0, 0])
  })

  it('puts the top view above, looking down', () => {
    // The top view stops a hundredth of a degree short of the pole, which leans it by a centimetre
    // over five metres — invisible, and the price of an up vector that has an answer.
    const position = cameraPosition({ target: [1, 2, 3], yaw: 0, pitch: AXIS_VIEWS.top.pitch, distance: 5 })

    close(position[0], 1, 1e-6)
    close(position[1], 2, 0.02)
    close(position[2], 8, 1e-3)
  })

  it('keeps the horizon level: the right vector never leaves the ground plane', () => {
    for (const pitch of [-80, -20, 0, 35, 80]) {
      const basis = cameraBasis(37, pitch)
      close(basis.right[2], 0)
      close(basis.up[0] * basis.forward[0] + basis.up[1] * basis.forward[1] + basis.up[2] * basis.forward[2], 0, 1e-9)
      expect(basis.up[2]).toBeGreaterThan(0)
    }
  })

  it('never reaches the pole, where the up vector has no answer', () => {
    expect(clampPitch(90)).toBeLessThan(90)
    expect(clampPitch(-1000)).toBeGreaterThan(-90)
  })

  it('wraps a yaw that has been turned round many times', () => {
    expect(wrapYaw(370)).toBe(10)
    expect(wrapYaw(-190)).toBe(170)
    expect(wrapYaw(180)).toBe(180)
  })
})

describe('recognising an axis view', () => {
  it('names the six of them, and nothing in between', () => {
    expect(isAxisView(0, 0)).toBe('front')
    expect(isAxisView(180, 0)).toBe('back')
    expect(isAxisView(90, 0)).toBe('right')
    expect(isAxisView(-90, 0)).toBe('left')
    expect(isAxisView(0, 89.99)).toBe('top')
    expect(isAxisView(46, 27)).toBeNull()
  })

  it('ignores the yaw looking straight down, where it is only a roll', () => {
    expect(isAxisView(137, 89.99)).toBe('top')
  })
})

describe('framing', () => {
  it('backs off far enough that the box takes about seventy per cent of the view', () => {
    const box = { min: [-1, -1, -1] as [number, number, number], max: [1, 1, 1] as [number, number, number] }
    const framed = frameBox(box, { fovDegrees: 40, aspect: 16 / 9 })

    expect(framed.target).toEqual([0, 0, 0])
    // The sphere around the box has radius sqrt(3); at 70 % of a 40° cone that is about 6.8 units.
    close(framed.distance, boxRadius(box) / (Math.tan((40 * Math.PI) / 180 / 2) * 0.7), 1e-6)
  })

  it('uses the narrower angle on a tall, narrow viewport', () => {
    const box = { min: [-1, -1, -1] as [number, number, number], max: [1, 1, 1] as [number, number, number] }
    const wide = frameBox(box, { fovDegrees: 40, aspect: 2 })
    const narrow = frameBox(box, { fovDegrees: 40, aspect: 0.4 })

    expect(narrow.distance).toBeGreaterThan(wide.distance)
  })

  it('joins two boxes into the one that holds both', () => {
    const joined = unionBox({ min: [0, 0, 0], max: [1, 1, 1] }, { min: [-2, 0, 0], max: [0, 3, 0] })!

    expect(joined.min).toEqual([-2, 0, 0])
    expect(joined.max).toEqual([1, 3, 1])
  })
})

describe('zooming', () => {
  it('changes the distance by a proportion, so it never crawls and never jumps through', () => {
    const near = zoomDistance(1, 100)
    const far = zoomDistance(100, 100)

    close(near / 1, far / 100, 1e-9)
    expect(zoomDistance(1, -1e9)).toBeGreaterThan(0)
    expect(zoomDistance(1, 1e9)).toBeLessThanOrEqual(1e6)
  })

  it('keeps the point under the pointer under the pointer', () => {
    // Halving the distance halves the gap between the target and the point it is zooming towards.
    expect(zoomToPoint([0, 0, 0], [10, 0, 0], 10, 5)).toEqual([5, 0, 0])
    expect(zoomToPoint([0, 0, 0], [10, 0, 0], 10, 10)).toEqual([0, 0, 0])
  })
})

describe('the lens', () => {
  it('reads a focal length the way a camera does, and back again', () => {
    close(fovFromFocalLength(50), (2 * Math.atan(18 / 50) * 180) / Math.PI, 1e-9)
    close(orthoHeight(10, 90), 10, 1e-9)
  })
})

describe('damping', () => {
  it('arrives, and takes the short way round an angle', () => {
    let value = 0
    for (let step = 0; step < 200; step += 1) value = damp(value, 10, 120, 16)
    close(value, 10, 1e-3)

    // From 170° to -170° is 20° the short way, not 340° the long way.
    expect(dampAngle(170, -170, 120, 16)).toBeGreaterThan(170)
  })
})
