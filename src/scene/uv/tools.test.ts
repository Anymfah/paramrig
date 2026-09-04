import { describe, expect, it } from 'vitest'
import { activeUv, withActiveUv } from '@/scene/mesh/uv'
import { validateMeshData } from '@/scene/mesh/data'
import { gridMesh, planeMesh } from '@/scene/mesh/primitives'
import { uvGeometry } from '@/scene/uv/geometry'
import {
  alignUvs,
  clampUvsToImage,
  mirrorUvs,
  snapUvsToPixels,
  stitchUvs,
  straightenUvs,
  weldUvs,
} from '@/scene/uv/tools'
import type { MeshData } from '@/scene/types'

/**
 * The UV menu's tools, each on the smallest shape that shows what it does.
 *
 * They all take corners and give back a map, so every case here is: put a map on a plane, say which
 * corners are selected, and read the map that comes back. The plane's four corners are its four
 * corners of the image, so every expected number can be worked out by hand.
 */

const ALL = [0, 1, 2, 3]

/** Two quads sharing an edge: the smallest mesh that can have a seam through it. */
function twoQuads(): MeshData {
  return validateMeshData({
    vertices: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0],
    vertexIds: [0, 1, 2, 3, 4, 5],
    nextVertexId: 6,
    edges: [],
    faces: [[0, 1, 2, 3], [1, 4, 5, 2]],
    faceIds: [0, 1],
    nextFaceId: 2,
    attributes: { face: { smooth: [false, false], material: [0, 0] }, edge: {}, vertex: {}, loop: {} },
  })!
}

/** A plane whose map is the four corners given, in loop order. */
function plane(uv: number[] = [0, 0, 1, 0, 1, 1, 0, 1]) {
  return withActiveUv(planeMesh(), uv)
}

describe('the UV tools', () => {
  it('welds every selected corner onto their average', () => {
    const mesh = plane()
    const next = weldUvs(mesh, activeUv(mesh)!, ALL)
    expect(next).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
  })

  it('leaves a single corner alone, having nothing to weld it to', () => {
    const mesh = plane()
    expect(weldUvs(mesh, activeUv(mesh)!, [0])).toEqual(activeUv(mesh))
  })

  it('aligns to a line, and picks the shorter way when it is asked to choose', () => {
    // Wider than it is tall, so the heights are what get levelled.
    const wide = plane([0, 0, 1, 0.2, 1, 0.3, 0, 0.1])
    expect(alignUvs(wide, activeUv(wide)!, ALL, 'auto').filter((_, index) => index % 2 === 1))
      .toEqual([0.15, 0.15, 0.15, 0.15])
    const mesh = plane()
    expect(alignUvs(mesh, activeUv(mesh)!, ALL, 'u').filter((_, index) => index % 2 === 0))
      .toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('straightens a nearly straight row onto the line through it', () => {
    const mesh = gridMesh({ xSubdivisions: 4, ySubdivisions: 1 })
    const uv = activeUv(mesh)!.map((value, index) => (index % 2 === 1 ? value + (index % 7) * 0.01 : value))
    const geometry = uvGeometry(mesh, uv)
    const bottom: number[] = []
    for (let loop = 0; loop < geometry.loops; loop += 1) {
      const point = geometry.loopPoint[loop]!
      if ((geometry.points[point * 2 + 1] ?? 1) < 0.2) bottom.push(loop)
    }
    const next = straightenUvs(mesh, uv, bottom)
    const after = uvGeometry(mesh, next)
    const places = [...new Set(bottom.map((loop) => after.loopPoint[loop]!))]
      .map((point) => [after.points[point * 2]!, after.points[point * 2 + 1]!] as [number, number])
      .sort((a, b) => a[0] - b[0])
    /*
     * On one line, which is not the same as at one height: the line that fits a row best is rarely
     * exactly horizontal, and a straighten that levelled them instead would be an align.
     */
    const [first, second] = [places[0]!, places[places.length - 1]!]
    for (const place of places) {
      const cross = (second[0] - first[0]) * (place[1] - first[1]) - (second[1] - first[1]) * (place[0] - first[0])
      expect(Math.abs(cross)).toBeLessThan(1e-9)
    }
    // And it is not simply the same line they were already on.
    expect(places.some((place, index) => Math.abs(place[1] - (uvGeometry(mesh, uv).points[index * 2 + 1] ?? 0)) > 1e-6)).toBe(true)
  })

  it('mirrors about the middle of what is selected, not about the middle of the image', () => {
    const mesh = plane([0, 0, 0.4, 0, 0.4, 0.4, 0, 0.4])
    const next = mirrorUvs(mesh, activeUv(mesh)!, ALL, 'u')
    expect(next.filter((_, index) => index % 2 === 0)).toEqual([0.4, 0, 0, 0.4])
  })

  it('snaps to the texels of an image of a given size', () => {
    const mesh = plane([0.13, 0.77, 0.5, 0.5, 0.999, 0.001, 0.26, 0.26])
    const next = snapUvsToPixels(mesh, activeUv(mesh)!, ALL, 4)
    expect(next).toEqual([0.25, 0.75, 0.5, 0.5, 1, 0, 0.25, 0.25])
  })

  it('stitches a selected island onto the one it was cut from', () => {
    /*
     * Two quads sharing an edge, laid side by side in the image and then pulled apart. The two
     * corners they share say where the second one belongs, and both say the same thing, so the
     * stitch is exact.
     */
    const uv = [
      0, 0, 1, 0, 1, 1, 0, 1,
      1.5, 0.3, 2.5, 0.3, 2.5, 1.3, 1.5, 1.3,
    ]
    const mesh = withActiveUv(twoQuads(), uv)
    const next = stitchUvs(mesh, uv, [4, 5, 6, 7])
    expect(next.slice(0, 8)).toEqual(uv.slice(0, 8))
    // Rounded through zero as well as to six places: a negative zero is the same place as a zero.
    expect(next.slice(8).map((value) => Number(value.toFixed(6)) + 0))
      .toEqual([1, 0, 2, 0, 2, 1, 1, 1])
  })

  it('leaves an island with nothing to stitch to where it is', () => {
    const mesh = plane()
    expect(stitchUvs(mesh, activeUv(mesh)!, ALL)).toEqual(activeUv(mesh))
  })

  it('brings a map inside the image', () => {
    expect(clampUvsToImage([-0.2, 1.4, 0.5, 0.5])).toEqual([0, 1, 0.5, 0.5])
  })
})
