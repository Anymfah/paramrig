import { describe, expect, it } from 'vitest'
import {
  angleDelta,
  applyMatrix3,
  applyMatrixAbout,
  axisScaleMatrix,
  closestPointOnLine,
  decomposeMatrix,
  eulerFromQuaternion,
  matrixFromTransform,
  multiplyMatrix3,
  multiplyQuaternions,
  quaternionFromAxisAngle,
  quaternionFromEuler,
  rayPlanePoint,
  rotatePointAround,
  rotationMatrix3,
  scaleRatio,
  screenAngle,
  screenAxisAmounts,
  transformAxes,
  transposeMatrix3,
  unwrapAngle,
  viewPlaneDelta,
  type ViewBasis,
} from '@/scene/transform/math'
import type { EulerOrder, Transform, Vec3 } from '@/scene/types'

/** Blender's front view: looking along +Y, X across the screen and Z up it. */
const FRONT_VIEW: ViewBasis = {
  right: [1, 0, 0],
  up: [0, 0, 1],
  forward: [0, 1, 0],
  unitsPerPixel: 0.01,
  pivotScreen: [400, 300],
}

const ORDERS: EulerOrder[] = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX']

function closeTo(actual: Vec3, expected: Vec3, digits = 6): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits)
  expect(actual[1]).toBeCloseTo(expected[1], digits)
  expect(actual[2]).toBeCloseTo(expected[2], digits)
}

describe('a ray against a plane', () => {
  it('lands on the plane it is aimed at', () => {
    const hit = rayPlanePoint([0, 0, 10], [0, 0, -1], [0, 0, 0], [0, 0, 1])

    expect(hit).not.toBeNull()
    closeTo(hit as Vec3, [0, 0, 0])
  })

  it('refuses a plane it runs alongside', () => {
    expect(rayPlanePoint([0, 0, 10], [1, 0, 0], [0, 0, 0], [0, 0, 1])).toBeNull()
  })
})

describe('a line against a ray', () => {
  it('finds the point on the line the ray passes nearest', () => {
    const point = closestPointOnLine([0, 0, 0], [1, 0, 0], [3, 5, 0], [0, -1, 0])

    expect(point).not.toBeNull()
    closeTo(point as Vec3, [3, 0, 0])
  })

  it('refuses a ray that runs parallel to the line', () => {
    expect(closestPointOnLine([0, 0, 0], [1, 0, 0], [0, 4, 0], [1, 0, 0])).toBeNull()
  })
})

describe('an angle swept on screen', () => {
  it('grows clockwise, because the screen counts y downwards', () => {
    expect(screenAngle([400, 300], [500, 300])).toBeCloseTo(0, 6)
    expect(screenAngle([400, 300], [400, 400])).toBeCloseTo(90, 6)
  })

  it('carries on past half a turn instead of folding back', () => {
    expect(unwrapAngle(170, -170)).toBeCloseTo(190, 6)
    expect(angleDelta(170, -170)).toBeCloseTo(20, 6)
    expect(angleDelta(-170, 170)).toBeCloseTo(-20, 6)
  })

  it('adds up over a whole turn when it is accumulated a step at a time', () => {
    let total = 0
    for (let step = 0; step < 36; step += 1) {
      total += angleDelta(step * 10, (step + 1) * 10)
    }
    expect(total).toBeCloseTo(360, 6)
  })
})

describe('the cursor across the view', () => {
  it('turns pixels into world units along the camera basis', () => {
    closeTo(viewPlaneDelta([100, 0], FRONT_VIEW), [1, 0, 0])
    // Screen y grows downwards, so moving the cursor up is a move along the camera's up axis.
    closeTo(viewPlaneDelta([0, -100], FRONT_VIEW), [0, 0, 1])
  })

  it('moves further along an axis the camera sees edge-on, so the object keeps up with the cursor', () => {
    const diagonal: Vec3 = [Math.SQRT1_2, Math.SQRT1_2, 0]
    const [amount] = screenAxisAmounts([diagonal], [100, 0], FRONT_VIEW)

    // The axis is half as long on screen as in the world, so a pixel of travel is worth more of it.
    expect(amount).toBeCloseTo(Math.SQRT2, 6)
  })

  it('gives an axis pointing straight at the camera nothing to do', () => {
    expect(screenAxisAmounts([[0, 1, 0]], [100, 0], FRONT_VIEW)[0]).toBeCloseTo(0, 6)
  })

  it('splits the travel between the two axes of a plane', () => {
    const amounts = screenAxisAmounts([[1, 0, 0], [0, 0, 1]], [100, -50], FRONT_VIEW)

    expect(amounts[0]).toBeCloseTo(1, 6)
    expect(amounts[1]).toBeCloseTo(0.5, 6)
  })

  it('measures a scale as the ratio of the two distances to the pivot', () => {
    expect(scaleRatio([400, 300], [500, 300], [600, 300])).toBeCloseTo(2, 6)
    expect(scaleRatio([400, 300], [400, 300], [600, 300])).toBe(1)
  })
})

describe('Euler angles read back from a quaternion', () => {
  it('reads the second solution for every rotation order', () => {
    for (const order of ORDERS) {
      const source: Vec3 = [37, -64, 128]
      const quaternion = quaternionFromEuler(source, order)
      const read = eulerFromQuaternion(quaternion, order, source)

      closeTo(read, source, 4)
    }
  })

  it('does not jump at half a turn', () => {
    let previous: Vec3 = [0, 0, 170]
    for (const angle of [175, 179, 181, 185, 190]) {
      const read = eulerFromQuaternion(quaternionFromAxisAngle([0, 0, 1], angle), 'XYZ', previous)
      expect(read[2]).toBeCloseTo(angle, 4)
      previous = read
    }
  })

  it('takes the canonical reading when there is nothing to be continuous with', () => {
    const read = eulerFromQuaternion(quaternionFromAxisAngle([0, 0, 1], 190), 'XYZ')

    expect(read[2]).toBeCloseTo(-170, 4)
  })

  it('composes one rotation onto another', () => {
    const composed = multiplyQuaternions(
      quaternionFromAxisAngle([0, 0, 1], 90),
      quaternionFromAxisAngle([0, 0, 1], 45),
    )

    expect(eulerFromQuaternion(composed, 'XYZ', [0, 0, 0])[2]).toBeCloseTo(135, 4)
  })

  it('turns a point about a pivot', () => {
    closeTo(rotatePointAround([2, 0, 0], [1, 0, 0], quaternionFromAxisAngle([0, 0, 1], 90)), [1, 1, 0])
  })
})

describe('matrices', () => {
  const rotated: Transform = { position: [1, 2, 3], rotation: [0, 0, 90], scale: [2, 2, 2] }

  it('takes a transform apart into the numbers it was built from', () => {
    const decomposed = decomposeMatrix(matrixFromTransform(rotated), 'XYZ', [0, 0, 90])

    closeTo(decomposed.position, [1, 2, 3])
    closeTo(decomposed.rotation, [0, 0, 90], 4)
    closeTo(decomposed.scale, [2, 2, 2], 6)
  })

  it('reads a rotated transform own axes off it', () => {
    const axes = transformAxes(rotated)

    closeTo(axes.x, [0, 1, 0])
    closeTo(axes.y, [-1, 0, 0])
    closeTo(axes.z, [0, 0, 1])
  })

  it('stretches along the axes it is given and leaves the others alone', () => {
    const matrix = axisScaleMatrix([[0, 0, 1]], [3])

    closeTo(applyMatrix3(matrix, [1, 1, 1]), [1, 1, 3])
  })

  it('undoes a rotation with its own transpose', () => {
    const rotation = rotationMatrix3(rotated)
    const round = multiplyMatrix3(transposeMatrix3(rotation), rotation)

    closeTo(applyMatrix3(round, [1, 2, 3]), [1, 2, 3])
  })

  it('applies a stretch about a pivot rather than about the origin', () => {
    const target: Transform = { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    const result = applyMatrixAbout(target, [1, 0, 0], axisScaleMatrix([[1, 0, 0]], [3]))

    closeTo(result.position, [4, 0, 0])
    closeTo(result.scale, [3, 1, 1], 6)
  })
})
