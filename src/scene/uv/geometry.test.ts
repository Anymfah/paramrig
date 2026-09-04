import { describe, expect, it } from 'vitest'
import { activeUv, withActiveUv } from '@/scene/mesh/uv'
import { boxMesh, planeMesh } from '@/scene/mesh/primitives'
import { uvGeometry } from '@/scene/uv/geometry'

/**
 * The merge is the whole of this module, and the cube is the case that proves it.
 *
 * A cube's six faces each take the whole image, so every one of its twenty-four corners sits on one
 * of four places — and no two corners of one *vertex* ever land on the same one. Twenty-four points
 * for eight vertices is therefore the right answer, and eight would be the wrong one: it would mean
 * the six faces had been welded into a shape that cannot be laid flat.
 */

describe('the UV geometry', () => {
  it('merges the corners of a vertex that sit on one spot, and only those', () => {
    const plane = planeMesh()
    const geometry = uvGeometry(plane, activeUv(plane)!)
    expect(geometry.loops).toBe(4)
    expect(geometry.points.length / 2).toBe(4)
    expect(geometry.edges.length / 2).toBe(4)
  })

  it('keeps a cube apart: six squares, drawn one on top of another', () => {
    const cube = boxMesh()
    const geometry = uvGeometry(cube, activeUv(cube)!)
    expect(geometry.loops).toBe(24)
    // Six squares, four sides each, and no two faces agreeing about a side: nothing is deduplicated.
    expect(geometry.edges.length / 2).toBe(24)
    /*
     * Twenty points from twenty-four corners, which is the merge doing exactly its job. Each of the
     * cube's eight vertices has three corners, and at four of them two of those three happen to be
     * put on the same corner of the image by their faces — so those two are one point and move
     * together, as they do in Blender.
     */
    expect(geometry.points.length / 2).toBe(20)
    for (let point = 0; point < geometry.points.length / 2; point += 1) {
      const start = geometry.pointStart[point]!
      const vertices = new Set<number>()
      for (let index = 0; index < geometry.pointCount[point]!; index += 1) {
        const loop = geometry.pointLoops[start + index]!
        const face = geometry.loopFace[loop]!
        vertices.add(cube.faces[face]![loop - geometry.faceStart[face]!]!)
      }
      // Never across vertices: two corners of two different vertices are never one point, however
      // near they land, or dragging a seam shut would weld the mesh itself.
      expect(vertices.size).toBe(1)
    }
  })

  it('welds two faces that agree about where their shared corners are', () => {
    const mesh = planeMesh()
    // Two triangles of one square, laid out as one square in the image.
    const both = withActiveUv({
      ...mesh,
      faces: [[0, 1, 2], [0, 2, 3]],
      faceIds: [0, 1],
      attributes: { ...mesh.attributes, face: { smooth: [false, false], material: [0, 0] } },
    }, [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
    const geometry = uvGeometry(both, activeUv(both)!)
    expect(geometry.loops).toBe(6)
    expect(geometry.points.length / 2).toBe(4)
    // Four sides and the diagonal, with the diagonal drawn once rather than twice.
    expect(geometry.edges.length / 2).toBe(5)
  })

  it('says which corners a point carries, so moving one moves them all', () => {
    const mesh = planeMesh()
    const geometry = uvGeometry(mesh, activeUv(mesh)!)
    for (let point = 0; point < geometry.points.length / 2; point += 1) {
      const start = geometry.pointStart[point]!
      const count = geometry.pointCount[point]!
      expect(count).toBeGreaterThan(0)
      for (let index = 0; index < count; index += 1) {
        expect(geometry.loopPoint[geometry.pointLoops[start + index]!]).toBe(point)
      }
    }
  })

  it('measures the box the map fits in', () => {
    const mesh = withActiveUv(planeMesh(), [0.25, 0.25, 0.75, 0.25, 0.75, 1.5, 0.25, 1.5])
    const geometry = uvGeometry(mesh, activeUv(mesh)!)
    expect(geometry.bounds).toEqual({ minU: 0.25, minV: 0.25, maxU: 0.75, maxV: 1.5 })
  })

  it('answers for a mesh with no faces rather than throwing', () => {
    const empty = { ...planeMesh(), faces: [], faceIds: [], attributes: { ...planeMesh().attributes, face: { smooth: [], material: [] } } }
    const geometry = uvGeometry(empty, [])
    expect(geometry.loops).toBe(0)
    expect(geometry.bounds).toBeNull()
    expect(geometry.edges).toHaveLength(0)
  })

  it('reads a short map as zeroes rather than as undefined', () => {
    const mesh = planeMesh()
    const geometry = uvGeometry(mesh, [0.5, 0.5])
    // The first corner reads its pair; the other three read nothing, which is the origin.
    expect([...geometry.points]).toEqual([0.5, 0.5, 0, 0, 0, 0, 0, 0])
    expect(geometry.loops).toBe(4)
  })
})
