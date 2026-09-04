import { describe, expect, it } from 'vitest'
import { activeUv, withActiveUv } from '@/scene/mesh/uv'
import { boxMesh, gridMesh, planeMesh } from '@/scene/mesh/primitives'
import { uvGeometry } from '@/scene/uv/geometry'
import {
  applyPick,
  faceAt,
  faceSelected,
  loopsOfFace,
  loopsOfIsland,
  loopsOfPoints,
  nearestEdge,
  nearestPoint,
  pointsInBox,
  selectedPoints,
  uvIslands,
  NOTHING,
} from '@/scene/uv/select'

/**
 * Picking in the image, and what a pick means.
 *
 * The plane's map is the unit square with its corners at the corners of the image, which makes
 * every answer here one that can be read off by hand — the point at (0, 0) is corner zero, the edge
 * along the bottom is the one from it, and a click in the middle is inside the only face there is.
 */

function plane() {
  const mesh = planeMesh()
  return { mesh, geometry: uvGeometry(mesh, activeUv(mesh)!) }
}

describe('picking in the UV editor', () => {
  it('finds the point nearest a click, and nothing when the click is too far off', () => {
    const { geometry } = plane()
    expect(geometry.points[nearestPoint(geometry, [0.02, 0.02], 0.1) * 2]).toBeCloseTo(0, 6)
    expect(nearestPoint(geometry, [0.5, 0.5], 0.1)).toBe(NOTHING)
  })

  it('finds an edge by the distance to the line rather than to its ends', () => {
    const { geometry } = plane()
    // Halfway along a side, which is as far from both of its ends as a point on it can be.
    const edge = nearestEdge(geometry, [0.5, 0.01], 0.05)
    expect(edge).not.toBe(NOTHING)
    const a = geometry.edges[edge * 2]!
    const b = geometry.edges[edge * 2 + 1]!
    expect(geometry.points[a * 2 + 1]).toBeCloseTo(0, 6)
    expect(geometry.points[b * 2 + 1]).toBeCloseTo(0, 6)
    expect(nearestEdge(geometry, [0.5, 0.5], 0.05)).toBe(NOTHING)
  })

  it('finds the face a click is inside, and none outside every face', () => {
    const { geometry } = plane()
    expect(faceAt(geometry, [0.5, 0.5])).toBe(0)
    expect(faceAt(geometry, [1.5, 0.5])).toBe(NOTHING)
  })

  it('reads the islands off the map rather than off the mesh', () => {
    const cube = boxMesh()
    const geometry = uvGeometry(cube, activeUv(cube)!)
    const islands = uvIslands(geometry)
    /*
     * Every face of a cube is laid on the whole image, so the six squares sit on top of one another
     * and are joined wherever two of them put a shared vertex on the same corner of the image. What
     * the mesh calls six faces the image calls two pieces — which is the point of reading islands
     * from the map rather than from the surface.
     */
    expect(new Set(islands).size).toBe(2)
  })

  it('and finds six of them once the map has been laid apart', () => {
    const cube = boxMesh()
    const spread = activeUv(cube)!.map((value, index) => value * 0.15 + Math.floor(index / 8) * 0.16)
    const geometry = uvGeometry(withActiveUv(cube, spread), spread)
    expect(new Set(uvIslands(geometry)).size).toBe(6)
  })

  it('takes everything inside a box', () => {
    const grid = gridMesh({ xSubdivisions: 3, ySubdivisions: 3 })
    const geometry = uvGeometry(grid, activeUv(grid)!)
    const all = pointsInBox(geometry, { minU: -1, minV: -1, maxU: 2, maxV: 2 })
    expect(all.length).toBe(geometry.points.length / 2)
    const none = pointsInBox(geometry, { minU: 2, minV: 2, maxU: 3, maxV: 3 })
    expect(none).toHaveLength(0)
  })

  it('turns points into the corners they carry, which is what a selection holds', () => {
    const { geometry } = plane()
    expect(loopsOfPoints(geometry, [0])).toEqual([0])
    expect(loopsOfFace(geometry, 0)).toEqual([0, 1, 2, 3])
    expect(loopsOfIsland(geometry, uvIslands(geometry), 0).sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
  })

  it('replaces on a plain click, adds on a shift click and takes away on a toggle', () => {
    const selected = new Set([1, 2])
    expect([...applyPick(selected, [5], 'new')]).toEqual([5])
    expect([...applyPick(selected, [5], 'extend')].sort()).toEqual([1, 2, 5])
    // Everything asked for is already in, so a toggle takes it out.
    expect([...applyPick(selected, [1, 2], 'toggle')]).toEqual([])
    // Not everything is, so a toggle puts the rest in rather than taking any out.
    expect([...applyPick(selected, [2, 7], 'toggle')].sort()).toEqual([1, 2, 7])
    expect([...applyPick(selected, [], 'new')]).toEqual([])
  })

  it('calls a face selected when every corner of it is, and not before', () => {
    const { geometry } = plane()
    expect(faceSelected(geometry, new Set([0, 1, 2]), 0)).toBe(false)
    expect(faceSelected(geometry, new Set([0, 1, 2, 3]), 0)).toBe(true)
  })

  it('marks a point as selected when any corner on it is', () => {
    const cube = boxMesh()
    const geometry = uvGeometry(cube, activeUv(cube)!)
    const marks = selectedPoints(geometry, new Set([0]))
    expect(marks[geometry.loopPoint[0]!]).toBe(1)
    expect([...marks].filter(Boolean)).toHaveLength(1)
  })
})
