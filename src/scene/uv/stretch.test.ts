import { describe, expect, it } from 'vitest'
import { meshFromPolygons } from '@/scene/mesh/data'
import { boxMesh, gridMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import { activeUv, loopStarts } from '@/scene/mesh/uv'
import { faceStretch, meshStretch, minimizeStretch } from '@/scene/uv/stretch'
import type { MeshData } from '@/scene/types'

/**
 * Stretch: measuring what a map does to the surface, and relaxing it.
 *
 * What is worth holding is not the arithmetic of an area but four properties. A map that fits reads
 * as nought and goes on reading as nought however it is turned or scaled, because neither measure
 * has an opinion about where a map sits or how big it is. Each measure sees the distortion it is
 * named after and not the other one. Relaxing lowers the numbers on a map that has been spoilt and
 * leaves a map that already fits where it was. And nothing anywhere returns a number that is not a
 * number, however degenerate the face it was handed.
 */

/** A map made straight from the mesh's own XY, optionally spoilt on the way through. */
function xyUvs(mesh: MeshData, warp: (x: number, y: number) => [number, number] = (x, y) => [x, y]): number[] {
  const data: number[] = []
  for (const face of mesh.faces) {
    for (const slot of face) {
      const [u, v] = warp(mesh.vertices[slot * 3]!, mesh.vertices[slot * 3 + 1]!)
      data.push(u, v)
    }
  }
  return data
}

/** The same, applied to the corners of the faces a test picks out. */
function warpFaces(mesh: MeshData, uv: number[], pick: (face: number) => boolean, warp: (u: number, v: number) => [number, number]): number[] {
  const data = uv.slice()
  const starts = loopStarts(mesh)
  for (let face = 0; face < mesh.faces.length; face += 1) {
    if (!pick(face)) continue
    for (let corner = 0; corner < mesh.faces[face]!.length; corner += 1) {
      const loop = starts[face]! + corner
      const [u, v] = warp(data[loop * 2]!, data[loop * 2 + 1]!)
      data[loop * 2] = u
      data[loop * 2 + 1] = v
    }
  }
  return data
}

function centroidX(mesh: MeshData, face: number): number {
  const slots = mesh.faces[face]!
  return slots.reduce((total, slot) => total + mesh.vertices[slot * 3]!, 0) / slots.length
}

const grid = (): MeshData => gridMesh({ xSubdivisions: 5, ySubdivisions: 5, size: 2 })

describe('a map that fits the surface it is on', () => {
  it('reads as no stretch at all, by either measure, on a flat grid wearing its own XY', () => {
    const mesh = grid()
    const uv = xyUvs(mesh)
    for (const kind of ['angle', 'area'] as const) {
      const perFace = faceStretch(mesh, uv, kind)
      expect(perFace, kind).toHaveLength(mesh.faces.length)
      for (const value of perFace) expect(value, kind).toBeCloseTo(0, 9)
      expect(meshStretch(mesh, uv, kind), kind).toBeCloseTo(0, 9)
    }
  })

  it('reads as nought for a box born with a whole square of the image on every face', () => {
    const mesh = boxMesh(2)
    const uv = activeUv(mesh)!
    expect(faceStretch(mesh, uv, 'area')).toEqual(mesh.faces.map(() => 0))
    for (const value of faceStretch(mesh, uv, 'angle')) expect(value).toBeCloseTo(0, 9)
  })

  it('goes on reading as nought when the whole map is turned or mirrored, both being isometries', () => {
    const mesh = grid()
    const turned = xyUvs(mesh, (x, y) => [(x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2])
    const mirrored = xyUvs(mesh, (x, y) => [-x, y])
    for (const uv of [turned, mirrored]) {
      expect(meshStretch(mesh, uv, 'angle')).toBeCloseTo(0, 9)
      expect(meshStretch(mesh, uv, 'area')).toBeCloseTo(0, 9)
    }
  })

  it('goes on reading as nought when the whole map is scaled, because both measures are shares', () => {
    const mesh = grid()
    const larger = xyUvs(mesh, (x, y) => [x * 7 + 3, y * 7 - 2])
    expect(meshStretch(mesh, larger, 'angle')).toBeCloseTo(0, 9)
    expect(meshStretch(mesh, larger, 'area')).toBeCloseTo(0, 9)
  })
})

describe('a map with one axis doubled', () => {
  /*
   * On a grid the faces are square and axis-aligned, so doubling u turns each into a rectangle and
   * neither measure has anything to say: the corners are still right angles and every face's share
   * of the image has doubled equally. Turning the map forty-five degrees first is what makes the
   * doubling a shear rather than a scale, and that is the case worth measuring.
   */
  const mesh = grid()
  const turned = xyUvs(mesh, (x, y) => [(x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2])
  const doubled = warpFaces(mesh, turned, () => true, (u, v) => [u * 2, v])

  it('shears the corners the map used to keep, which the angle measure reads', () => {
    /*
     * A square standing on a corner has vertices at (1, 0), (0, 1), (-1, 0), (0, -1); doubling u
     * takes the right-hand corner's ninety degrees to 2·atan(1/2) = 53.13° and the top corner's to
     * 126.87°. Every corner is 36.87° out, and 36.87 over 180 is what the measure reports.
     */
    expect(meshStretch(mesh, turned, 'angle')).toBeCloseTo(0, 9)
    expect(meshStretch(mesh, doubled, 'angle')).toBeCloseTo(36.87 / 180, 3)
  })

  it('leaves every face the share of the image it had, so the area measure reads nothing', () => {
    for (const value of faceStretch(mesh, doubled, 'area')) expect(value).toBeCloseTo(0, 9)
  })

  it('is read by the area measure as soon as it is done to half the map instead of all of it', () => {
    const half = warpFaces(mesh, xyUvs(mesh), (face) => centroidX(mesh, face) < 0, (u, v) => [u * 2, v])
    const perFace = faceStretch(mesh, half, 'area')
    /*
     * Eight faces of sixteen are twice the size they were, so the image is worth twenty-four of the
     * old faces: a doubled face has 2/24 of it against the 1/16 it wants, and an untouched one 1/24.
     */
    for (let face = 0; face < mesh.faces.length; face += 1) {
      const expected = centroidX(mesh, face) < 0 ? 1 - 12 / 16 : 1 - 16 / 24
      expect(perFace[face], `face ${face}`).toBeCloseTo(expected, 9)
    }
  })
})

describe('the whole map in one number', () => {
  it('is nought for a map that fits and larger for one that has been spoilt', () => {
    const mesh = grid()
    const fitting = xyUvs(mesh)
    const spoilt = xyUvs(mesh, (x, y) => [Math.sign(x) * x * x + 0.4 * y, y])
    for (const kind of ['angle', 'area'] as const) {
      expect(meshStretch(mesh, fitting, kind), kind).toBeCloseTo(0, 9)
      expect(meshStretch(mesh, spoilt, kind), kind).toBeGreaterThan(0.1)
    }
  })

  it('weights a face by the surface it covers, so spoiling a small face costs little', () => {
    // One square metre beside sixteen, with only the small one's corners sheared.
    const mesh = meshFromPolygons(
      [
        [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
        [2, 0, 0], [6, 0, 0], [6, 4, 0], [2, 4, 0],
      ],
      [[0, 1, 2, 3], [4, 5, 6, 7]],
    )
    const uv = warpFaces(mesh, xyUvs(mesh), (face) => face === 0, (u, v) => [u + 0.5 * v, v])
    const perFace = faceStretch(mesh, uv, 'angle')
    expect(perFace[0]!).toBeGreaterThan(0.05)
    expect(perFace[1]!).toBeCloseTo(0, 9)
    expect(meshStretch(mesh, uv, 'angle')).toBeCloseTo(perFace[0]! / 17, 9)
  })

  it('has nothing to report about a mesh with no faces', () => {
    const empty = meshFromPolygons([[0, 0, 0], [1, 0, 0]], [])
    expect(faceStretch(empty, [], 'area')).toEqual([])
    expect(meshStretch(empty, [], 'angle')).toBe(0)
  })
})

describe('relaxing a map', () => {
  it('leaves a map that already fits exactly where it was', () => {
    const mesh = grid()
    const uv = xyUvs(mesh)
    const relaxed = minimizeStretch(mesh, uv, { iterations: 40 })
    for (let index = 0; index < uv.length; index += 1) expect(relaxed[index]!).toBeCloseTo(uv[index]!, 9)
  })

  it('lowers both measures on a map that has been squashed and sheared', () => {
    const mesh = grid()
    /*
     * The worst case in this file: squaring u bunches the columns towards the middle and the shear
     * tips them over. It measures 0.1211 for angle and 0.4167 for area; ten passes bring those to
     * 0.0217 and 0.0879, and forty to 0.0019 and 0.0142.
     */
    const spoilt = xyUvs(mesh, (x, y) => [Math.sign(x) * x * x + 0.4 * y, y])
    const relaxed = minimizeStretch(mesh, spoilt)
    const settled = minimizeStretch(mesh, spoilt, { iterations: 40 })
    for (const kind of ['angle', 'area'] as const) {
      const before = meshStretch(mesh, spoilt, kind)
      const after = meshStretch(mesh, relaxed, kind)
      expect(after, kind).toBeLessThan(before / 3)
      expect(meshStretch(mesh, settled, kind), kind).toBeLessThan(after)
    }
  })

  it('does not touch the map it was given, and answers the same way every time', () => {
    const mesh = grid()
    const spoilt = xyUvs(mesh, (x, y) => [Math.sign(x) * x * x + 0.4 * y, y])
    const untouched = spoilt.slice()
    const once = minimizeStretch(mesh, spoilt, { iterations: 7, step: 0.4 })
    const twice = minimizeStretch(mesh, spoilt, { iterations: 7, step: 0.4 })
    expect(spoilt).toEqual(untouched)
    expect(once).toEqual(twice)
  })

  it('never moves a pinned corner, not by a millionth', () => {
    const mesh = grid()
    const spoilt = xyUvs(mesh, (x, y) => [Math.sign(x) * x * x + 0.4 * y, y])
    const starts = loopStarts(mesh)
    const pinned = new Set<number>()
    for (const face of [0, 3, 9]) {
      for (let corner = 0; corner < mesh.faces[face]!.length; corner += 1) pinned.add(starts[face]! + corner)
    }
    const relaxed = minimizeStretch(mesh, spoilt, { iterations: 60, pinned })
    for (const loop of pinned) {
      expect(relaxed[loop * 2], `loop ${loop} u`).toBe(spoilt[loop * 2])
      expect(relaxed[loop * 2 + 1], `loop ${loop} v`).toBe(spoilt[loop * 2 + 1])
    }
    // And the pins held something down rather than the whole map standing still.
    expect(relaxed).not.toEqual(spoilt)
  })

  it('keeps corners that shared a UV sharing it, so a seam is neither closed nor opened', () => {
    const mesh = grid()
    const seamed = warpFaces(mesh, xyUvs(mesh), (face) => centroidX(mesh, face) > 0, (u, v) => [u + 10, v])
    const relaxed = minimizeStretch(mesh, seamed, { iterations: 20 })
    const starts = loopStarts(mesh)
    const byVertex = new Map<number, number[]>()
    for (let face = 0; face < mesh.faces.length; face += 1) {
      mesh.faces[face]!.forEach((slot, corner) => {
        const loops = byVertex.get(slot) ?? []
        loops.push(starts[face]! + corner)
        byVertex.set(slot, loops)
      })
    }
    let shared = 0
    for (const loops of byVertex.values()) {
      for (const a of loops) {
        for (const b of loops) {
          if (a >= b) continue
          if (seamed[a * 2] !== seamed[b * 2] || seamed[a * 2 + 1] !== seamed[b * 2 + 1]) continue
          shared += 1
          expect(relaxed[a * 2]).toBe(relaxed[b * 2])
          expect(relaxed[a * 2 + 1]).toBe(relaxed[b * 2 + 1])
        }
      }
    }
    expect(shared).toBeGreaterThan(0)
    // The seam is still a seam: the two sides of the cut are still ten apart.
    const left = mesh.faces.findIndex((_, face) => centroidX(mesh, face) < 0)
    const right = mesh.faces.findIndex((_, face) => centroidX(mesh, face) > 0)
    expect(Math.abs(relaxed[starts[right]! * 2]! - relaxed[starts[left]! * 2]!)).toBeGreaterThan(1)
  })

  it('stays a real number on a sphere, which no map flattens, and still gives it a fairer share', () => {
    const sphere = uvSphereMesh({ segments: 8, rings: 4 })
    const uv = xyUvs(sphere)
    const relaxed = minimizeStretch(sphere, uv, { iterations: 30 })
    expect(relaxed.every((value) => Number.isFinite(value))).toBe(true)
    expect(meshStretch(sphere, relaxed, 'area')).toBeLessThan(meshStretch(sphere, uv, 'area'))
  })
})

describe('a face that has collapsed', () => {
  /** Three quads in a row, the last one with two of its corners in the same place. */
  function strip(): MeshData {
    return meshFromPolygons(
      [
        [0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 0, 0],
        [0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0],
      ],
      [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6]],
    )
  }

  it('is measured without ever returning a number that is not a number', () => {
    const mesh = strip()
    const uv = xyUvs(mesh)
    for (const kind of ['angle', 'area'] as const) {
      for (const value of faceStretch(mesh, uv, kind)) {
        expect(Number.isFinite(value), kind).toBe(true)
        expect(value, kind).toBeGreaterThanOrEqual(0)
        expect(value, kind).toBeLessThanOrEqual(1)
      }
      expect(Number.isFinite(meshStretch(mesh, uv, kind)), kind).toBe(true)
    }
  })

  it('is relaxed without ever returning a number that is not a number', () => {
    const mesh = strip()
    const relaxed = minimizeStretch(mesh, xyUvs(mesh, (x, y) => [x * x, y]), { iterations: 20 })
    expect(relaxed).toHaveLength(mesh.faces.length * 4 * 2)
    expect(relaxed.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('reads as the worst there is when it is the map that has collapsed, not the mesh', () => {
    const mesh = strip()
    const uv = warpFaces(mesh, xyUvs(mesh), (face) => face === 0, () => [1, 1])
    expect(faceStretch(mesh, uv, 'area')[0]!).toBe(1)
    expect(faceStretch(mesh, uv, 'angle')[0]!).toBe(1)
  })

  it('reads as the worst there is when the whole map has no area at all', () => {
    const mesh = grid()
    const flat = xyUvs(mesh, () => [0, 0])
    expect(faceStretch(mesh, flat, 'area')).toEqual(mesh.faces.map(() => 1))
    expect(meshStretch(mesh, flat, 'area')).toBe(1)
    expect(Number.isFinite(meshStretch(mesh, flat, 'angle'))).toBe(true)
  })
})
