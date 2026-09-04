import { describe, expect, it } from 'vitest'
import { boxMesh, gridMesh, uvSphereMesh } from '@/scene/mesh/primitives'
import { loopCount } from '@/scene/mesh/uv'
import { smartProject } from '@/scene/uv/smart'

/**
 * Smart UV project.
 *
 * The one thing it must get right is where it cuts: a box has six faces looking six ways, so it
 * must come apart into six pieces however the angle is set, and a flat sheet must stay whole.
 */

describe('cutting by the angle between faces', () => {
  it('takes a box apart into its six sides', () => {
    const { islands } = smartProject(boxMesh(2))
    expect(islands).toHaveLength(6)
    expect(islands.every((island) => island.faces.length === 1)).toBe(true)
  })

  it('leaves a flat sheet whole', () => {
    const { islands } = smartProject(gridMesh({ xSubdivisions: 4, ySubdivisions: 4 }))
    expect(islands).toHaveLength(1)
  })

  it('cuts a sphere into more pieces as the angle tightens', () => {
    const mesh = uvSphereMesh({ segments: 16, rings: 8 })
    const loose = smartProject(mesh, { angleLimit: 89 }).islands.length
    const tight = smartProject(mesh, { angleLimit: 5 }).islands.length
    expect(tight).toBeGreaterThan(loose)
  })

  it('obeys a seam even where the angle would not cut', () => {
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
    const middle: number[] = []
    for (let edge = 0; edge < mesh.edges.length; edge += 1) {
      const [a, b] = mesh.edges[edge]!
      if (Math.abs(mesh.vertices[a * 3 + 1] ?? 0) < 1e-6 && Math.abs(mesh.vertices[b * 3 + 1] ?? 0) < 1e-6) middle.push(edge)
    }
    const seamed = {
      ...mesh,
      attributes: { ...mesh.attributes, edge: { ...mesh.attributes.edge, seam: mesh.edges.map((_, edge) => middle.includes(edge)) } },
    }
    expect(smartProject(seamed).islands).toHaveLength(2)
  })

  it('takes only the faces it is given', () => {
    const { islands } = smartProject(boxMesh(2), { selection: new Set([0, 1]) })
    expect(islands.flatMap((island) => island.faces).sort()).toEqual([0, 1])
  })
})

describe('the map it lays down', () => {
  it('gives every corner of the mesh a pair, selected or not', () => {
    const mesh = boxMesh(2)
    const { uv } = smartProject(mesh, { selection: new Set([0]) })
    expect(uv).toHaveLength(loopCount(mesh) * 2)
    expect(uv.every((value) => Number.isFinite(value))).toBe(true)
    // The faces nobody asked for are left at the origin for the caller to leave alone.
    expect(uv.slice(8)).toEqual(new Array<number>(loopCount(mesh) * 2 - 8).fill(0))
  })

  it('keeps a square square', () => {
    const { uv } = smartProject(boxMesh(2))
    const face = [0, 1, 2, 3].map((corner) => [uv[corner * 2]!, uv[corner * 2 + 1]!] as [number, number])
    const width = Math.hypot(face[1]![0] - face[0]![0], face[1]![1] - face[0]![1])
    const height = Math.hypot(face[3]![0] - face[0]![0], face[3]![1] - face[0]![1])
    expect(width).toBeCloseTo(height, 5)
  })

  it('lays every piece in its own box when area weighting is off', () => {
    const { uv, islands } = smartProject(boxMesh(2), { areaWeight: false })
    expect(islands).toHaveLength(6)
    const us = uv.filter((_, index) => index % 2 === 0)
    expect(Math.max(...us)).toBeCloseTo(1, 5)
  })

  it('keeps the surface’s own size when it is on, so a texel is one size everywhere', () => {
    const { uv } = smartProject(boxMesh(4), { areaWeight: true })
    const us = uv.filter((_, index) => index % 2 === 0)
    expect(Math.max(...us)).toBeCloseTo(4, 5)
  })
})
