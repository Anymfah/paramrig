/**
 * Which way round an island should lie before it is packed.
 *
 * A conformal flattening is only defined up to a rotation, so the square face of a cube comes out
 * of LSCM as a square standing on one of its corners just as readily as one lying on a side. Both
 * are the same map, and the difference is invisible on the model — but not in the image: a diamond
 * needs twice the room of the square it is, and packing measures the room a thing needs by its
 * bounding box. Blender lays each island on its narrowest side before packing for exactly this
 * reason, and this is that step.
 *
 * The angle is found by rotating calipers, which rests on a fact worth stating: the minimum-area
 * bounding rectangle of a set of points always has a side along an edge of its convex hull. So the
 * search is over the hull's edges rather than over every angle, and the answer is exact rather than
 * the best of a hundred guesses.
 */

/** Below this an island is a point or a line, and every angle is as good as every other. */
const NOTHING = 1e-12

/**
 * The convex hull, as point indices, counter-clockwise — Andrew's monotone chain.
 *
 * Points are given as a flat `[u, v, u, v, …]` array, which is how every UV in the editor travels.
 */
export function convexHull(points: number[]): number[] {
  const count = Math.floor(points.length / 2)
  if (count < 3) return Array.from({ length: count }, (_, index) => index)
  const order = Array.from({ length: count }, (_, index) => index).sort((a, b) => (
    points[a * 2]! - points[b * 2]! || points[a * 2 + 1]! - points[b * 2 + 1]!
  ))
  const cross = (o: number, a: number, b: number): number => (
    (points[a * 2]! - points[o * 2]!) * (points[b * 2 + 1]! - points[o * 2 + 1]!)
    - (points[a * 2 + 1]! - points[o * 2 + 1]!) * (points[b * 2]! - points[o * 2]!)
  )
  const half = (source: number[]): number[] => {
    const chain: number[] = []
    for (const index of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, index) <= 0) chain.pop()
      chain.push(index)
    }
    return chain
  }
  const lower = half(order)
  const upper = half([...order].reverse())
  // Each half ends where the other begins, so the last point of each is dropped.
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/**
 * The angle, in radians, that the island should be turned by so that it lies in its smallest box.
 *
 * Zero for anything with no area: a point, a line, or fewer than three points, none of which has a
 * narrowest side to be laid on.
 */
export function minimumAreaAngle(points: number[]): number {
  const hull = convexHull(points)
  if (hull.length < 3) return 0
  let best = 0
  let smallest = Infinity
  for (let index = 0; index < hull.length; index += 1) {
    const a = hull[index]!
    const b = hull[(index + 1) % hull.length]!
    const dx = points[b * 2]! - points[a * 2]!
    const dy = points[b * 2 + 1]! - points[a * 2 + 1]!
    const length = Math.hypot(dx, dy)
    if (length < NOTHING) continue
    const cos = dx / length
    const sin = dy / length
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of hull) {
      const u = points[point * 2]!
      const v = points[point * 2 + 1]!
      const x = u * cos + v * sin
      const y = -u * sin + v * cos
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    const area = (maxX - minX) * (maxY - minY)
    if (area < smallest - NOTHING) {
      smallest = area
      best = Math.atan2(dy, dx)
    }
  }
  return best
}
