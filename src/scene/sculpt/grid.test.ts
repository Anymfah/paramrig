import { describe, expect, it } from 'vitest'
import { cellSizeFor, PointGrid } from '@/scene/sculpt/grid'

/**
 * The grid answers one question, and the only way it can be wrong is by missing a point that is in
 * range or returning one that is not. Both are checked against the answer worked out the slow way.
 */

/** A cloud of points, laid out by a repeatable arithmetic rather than by chance. */
function cloud(count: number): Float32Array {
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = Math.sin(index * 1.7) * 3
    positions[index * 3 + 1] = Math.cos(index * 2.3) * 3
    positions[index * 3 + 2] = Math.sin(index * 0.9) * 3
  }
  return positions
}

/** The same question, asked of every point. */
function slowly(positions: Float32Array, point: [number, number, number], radius: number): number[] {
  const found: number[] = []
  for (let index = 0; index < positions.length / 3; index += 1) {
    const dx = positions[index * 3]! - point[0]
    const dy = positions[index * 3 + 1]! - point[1]
    const dz = positions[index * 3 + 2]! - point[2]
    if (Math.hypot(dx, dy, dz) <= radius) found.push(index)
  }
  return found
}

describe('the sculpt grid', () => {
  it('finds exactly what a pass over every point finds', () => {
    const positions = cloud(2000)
    const grid = new PointGrid(positions, cellSizeFor(0.5))
    for (const point of [[0, 0, 0], [1.5, -2, 0.5], [3, 3, 3], [-9, 0, 0]] as Array<[number, number, number]>) {
      for (const radius of [0.2, 0.5, 1.5]) {
        expect(grid.near(positions, point, radius).sort((a, b) => a - b), `${point} ${radius}`)
          .toEqual(slowly(positions, point, radius))
      }
    }
  })

  it('still finds a point that has been sculpted out of its bucket', () => {
    const positions = cloud(200)
    const grid = new PointGrid(positions, cellSizeFor(0.5))
    // Moved by half a cell, which is what a stroke does between rebuilds.
    positions[0] = positions[0]! + cellSizeFor(0.5) * 0.5
    expect(grid.near(positions, [positions[0]!, positions[1]!, positions[2]!], 0.01)).toContain(0)
  })

  it('answers an empty region with nothing rather than with everything', () => {
    const positions = cloud(100)
    const grid = new PointGrid(positions, cellSizeFor(0.5))
    expect(grid.near(positions, [100, 100, 100], 1)).toHaveLength(0)
    expect(grid.vertexCount).toBe(100)
  })

  it('sizes a bucket against the brush rather than against the mesh', () => {
    expect(cellSizeFor(1)).toBe(0.5)
    expect(cellSizeFor(0)).toBeGreaterThan(0)
  })
})
