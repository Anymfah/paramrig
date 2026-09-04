/**
 * A grid of buckets over a mesh's vertices, for the one question a brush asks: which vertices are
 * within this radius of this point?
 *
 * Every dab of every stroke asks it, sixty times a second, of a mesh that may hold two hundred
 * thousand vertices — so the answer cannot be a pass over all of them. A uniform grid is the right
 * shape here rather than a tree: the query radius is the brush's, which changes rarely, and the
 * points move by a fraction of a cell during a stroke, so the buckets stay usable without being
 * rebuilt while the hand is moving.
 *
 * The grid holds *slots*, not positions. A vertex that has been sculpted away from its bucket is
 * still found, because the search widens by one cell in every direction — a brush that moved a
 * vertex further than a whole cell in one stroke has changed the shape enough to want a rebuild,
 * and the session asks for one when the stroke ends.
 */

export class PointGrid {
  private readonly cell: number
  private readonly buckets = new Map<number, number[]>()
  /** The positions the grid was built from; kept so a rebuild can be asked for by comparison. */
  private readonly count: number

  constructor(positions: Float32Array, cell: number) {
    this.cell = Math.max(1e-4, cell)
    this.count = positions.length / 3
    for (let index = 0; index < this.count; index += 1) {
      const key = this.keyOf(positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!)
      const bucket = this.buckets.get(key)
      if (bucket) bucket.push(index)
      else this.buckets.set(key, [index])
    }
  }

  /** How wide one bucket is, which is what a caller compares a brush radius against. */
  get cellSize(): number {
    return this.cell
  }

  get vertexCount(): number {
    return this.count
  }

  /**
   * Every vertex within `radius` of the point, by slot.
   *
   * The distance is checked here rather than left to the caller: the buckets are cubes and the
   * brush is a sphere, so a caller that trusted the buckets would sculpt the corners of a cube.
   */
  near(positions: Float32Array, point: [number, number, number], radius: number, out: number[] = []): number[] {
    out.length = 0
    const reach = Math.max(0, radius)
    const squared = reach * reach
    const low = [
      Math.floor((point[0] - reach) / this.cell) - 1,
      Math.floor((point[1] - reach) / this.cell) - 1,
      Math.floor((point[2] - reach) / this.cell) - 1,
    ]
    const high = [
      Math.floor((point[0] + reach) / this.cell) + 1,
      Math.floor((point[1] + reach) / this.cell) + 1,
      Math.floor((point[2] + reach) / this.cell) + 1,
    ]
    for (let x = low[0]!; x <= high[0]!; x += 1) {
      for (let y = low[1]!; y <= high[1]!; y += 1) {
        for (let z = low[2]!; z <= high[2]!; z += 1) {
          const bucket = this.buckets.get(hash(x, y, z))
          if (!bucket) continue
          for (const index of bucket) {
            const dx = positions[index * 3]! - point[0]
            const dy = positions[index * 3 + 1]! - point[1]
            const dz = positions[index * 3 + 2]! - point[2]
            if (dx * dx + dy * dy + dz * dz <= squared) out.push(index)
          }
        }
      }
    }
    return out
  }

  private keyOf(x: number, y: number, z: number): number {
    return hash(Math.floor(x / this.cell), Math.floor(y / this.cell), Math.floor(z / this.cell))
  }
}

/**
 * How far from the origin a cell may be before it is folded back: 2^16 cells each way.
 *
 * At a cell of a quarter of a unit that is a mesh sixteen thousand units across, which is far past
 * anything a person sculpts. A point beyond it folds into a cell it does not belong to and is
 * rejected by the distance check like any other stranger.
 */
const LIMIT = 65535
const SPAN = 131072

/**
 * Three cell coordinates as one number, exactly.
 *
 * A hash of the three would be shorter and would collide, and a collision here is not a few extra
 * distance checks: two cells sharing a bucket means a vertex is returned twice for a query that
 * spans both, and a brush would move it twice in one dab. Packing them instead is exact, and stays
 * inside the 53 bits a double counts with.
 */
function hash(x: number, y: number, z: number): number {
  const fold = (value: number): number => Math.min(LIMIT, Math.max(-LIMIT, value)) + LIMIT
  return (fold(x) * SPAN + fold(y)) * SPAN + fold(z)
}

/** How wide a bucket should be for a brush of this radius: a bucket that holds a few vertices. */
export function cellSizeFor(radius: number): number {
  return Math.max(1e-4, radius / 2)
}
