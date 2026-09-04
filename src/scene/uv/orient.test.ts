import { describe, expect, it } from 'vitest'
import { convexHull, minimumAreaAngle } from '@/scene/uv/orient'

/**
 * The case this exists for is the cube: LSCM hands back a square standing on its corner, and a
 * square on its corner needs twice the room in the image of the square it is.
 *
 * Everything here is asked the same way — turn the points by the angle that comes back, and measure
 * the box they then sit in — because that is exactly what the packer does with the answer, and the
 * angle on its own has several right values for the same shape.
 */

function rotate(points: number[], angle: number): number[] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const turned: number[] = []
  for (let index = 0; index < points.length; index += 2) {
    const u = points[index]!
    const v = points[index + 1]!
    turned.push(u * cos - v * sin, u * sin + v * cos)
  }
  return turned
}

/** The area of the box a set of points sits in, once it has been laid the way the angle says. */
function laidArea(points: number[]): number {
  const laid = rotate(points, -minimumAreaAngle(points))
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (let index = 0; index < laid.length; index += 2) {
    minU = Math.min(minU, laid[index]!)
    maxU = Math.max(maxU, laid[index]!)
    minV = Math.min(minV, laid[index + 1]!)
    maxV = Math.max(maxV, laid[index + 1]!)
  }
  return (maxU - minU) * (maxV - minV)
}

/** A square of `side`, turned by `angle` about its middle. */
function square(angle: number, side = 1): number[] {
  return rotate([-side / 2, -side / 2, side / 2, -side / 2, side / 2, side / 2, -side / 2, side / 2], angle)
}

describe('laying an island on its narrowest side', () => {
  it('finds the hull of a square with a point inside it', () => {
    const hull = convexHull([0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5])
    expect(hull).toHaveLength(4)
    expect(hull).not.toContain(4)
  })

  it('drops the points along an edge, which are not corners', () => {
    expect(convexHull([0, 0, 0.5, 0, 1, 0, 1, 1, 0, 1])).toHaveLength(4)
  })

  it('turns a diamond back into the square it is, which halves the room it needs', () => {
    const diamond = square(Math.PI / 4)
    // Standing on its corner the square needs a box of two; laid flat it needs a box of one.
    expect(laidArea(diamond)).toBeCloseTo(1, 9)
  })

  it('leaves a square that is already square where it is', () => {
    expect(laidArea(square(0))).toBeCloseTo(1, 9)
    expect(minimumAreaAngle(square(0)) % (Math.PI / 2)).toBeCloseTo(0, 9)
  })

  it('finds the smallest box of a rectangle whatever angle it came at', () => {
    for (const angle of [0.1, 0.7, 1.9, -2.2]) {
      expect(laidArea(rotate([-2, -0.25, 2, -0.25, 2, 0.25, -2, 0.25], angle))).toBeCloseTo(2, 9)
    }
  })

  it('finds the smallest box of a triangle, which is not the one its longest side gives', () => {
    // A thin triangle: the minimum box lies along the long side, area a half of base times height.
    expect(laidArea([0, 0, 4, 0, 3, 1])).toBeCloseTo(4, 9)
  })

  it('answers zero for anything with no shape to lay', () => {
    expect(minimumAreaAngle([])).toBe(0)
    expect(minimumAreaAngle([0, 0, 1, 1])).toBe(0)
    expect(minimumAreaAngle([0, 0, 1, 1, 2, 2, 3, 3])).toBe(0)
  })
})
