import { describe, expect, it } from 'vitest'
import { bezierCircleData, pathData } from '@/scene/curve/data'
import { bevelSides, curveMesh, nestContours, solidFromContours } from '@/scene/curve/geometry'
import { sampleSpline } from '@/scene/curve/spline'
import { meshCounts } from '@/scene/mesh/data'
import type { CurveData, Vec3 } from '@/scene/types'

/** Every edge used by exactly two faces: what "closed" means for a surface. */
function openEdges(mesh: { faces: number[][] }): number {
  const counts = new Map<string, number>()
  for (const face of mesh.faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index]!
      const b = face[(index + 1) % face.length]!
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.values()].filter((count) => count !== 2).length
}

function ring(radius: number, count = 8, offset: Vec3 = [0, 0, 0]): Vec3[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2
    return [offset[0] + Math.cos(angle) * radius, offset[1] + Math.sin(angle) * radius, offset[2]] as Vec3
  })
}

describe('curveMesh', () => {
  it('gives a curve with nothing on it a polyline and no faces', () => {
    const data: CurveData = { ...pathData(), fill: 'none' }
    const mesh = curveMesh(data)
    expect(mesh.faces).toHaveLength(0)
    expect(mesh.edges).toHaveLength(4)
    expect(meshCounts(mesh).vertices).toBe(5)
  })

  it('closes the ring of a cyclic polyline', () => {
    const data: CurveData = { ...bezierCircleData(), fill: 'none', resolution: 4 }
    const mesh = curveMesh(data)
    expect(mesh.faces).toHaveLength(0)
    expect(mesh.edges).toHaveLength(16)
  })

  it('fills a closed 2D curve into one flat surface', () => {
    const data: CurveData = { ...bezierCircleData(), resolution: 4, fill: 'front' }
    const mesh = curveMesh(data)
    // Sixteen points around, triangulated by ear clipping: fourteen triangles, all facing +Z.
    expect(mesh.faces).toHaveLength(14)
    expect(meshCounts(mesh).vertices).toBe(16)
  })

  it('extrudes a filled circle into a closed solid', () => {
    const data: CurveData = { ...bezierCircleData(), resolution: 4, fill: 'both', extrude: 0.5 }
    const mesh = curveMesh(data)
    // Two caps of fourteen triangles and a wall of sixteen quads, with nothing left open.
    expect(mesh.faces).toHaveLength(14 + 14 + 16)
    expect(openEdges(mesh)).toBe(0)
  })

  it('leaves an extruded curve open when only one side is filled', () => {
    const data: CurveData = { ...bezierCircleData(), resolution: 4, fill: 'front', extrude: 0.5 }
    const mesh = curveMesh(data)
    expect(mesh.faces).toHaveLength(14 + 16)
    expect(openEdges(mesh)).toBe(16)
  })

  it('sweeps a bevel into a closed tube around a ring', () => {
    const data: CurveData = { ...bezierCircleData(), resolution: 4, bevelDepth: 0.1, bevelResolution: 1 }
    const mesh = curveMesh(data)
    const sides = bevelSides(1)
    expect(sides).toBe(8)
    // Sixteen rings of eight, joined all the way round: a torus, with no edge left open.
    expect(meshCounts(mesh).vertices).toBe(16 * sides)
    expect(mesh.faces).toHaveLength(16 * sides)
    expect(openEdges(mesh)).toBe(0)
  })

  it('caps the ends of an open bevelled curve when it is set to fill', () => {
    const data: CurveData = { ...pathData(), fill: 'both', bevelDepth: 0.1, bevelResolution: 0 }
    const mesh = curveMesh(data)
    const sides = bevelSides(0)
    expect(mesh.faces).toHaveLength(4 * sides + 2)
    expect(openEdges(mesh)).toBe(0)
  })

  it('holds the bevel radius it was given', () => {
    const data: CurveData = { ...pathData(), bevelDepth: 0.25, bevelResolution: 2 }
    const mesh = curveMesh(data)
    const radii: number[] = []
    for (let index = 0; index < mesh.vertexIds.length; index += 1) {
      const y = mesh.vertices[index * 3 + 1]!
      const z = mesh.vertices[index * 3 + 2]!
      radii.push(Math.hypot(y, z))
    }
    for (const radius of radii) expect(radius).toBeCloseTo(0.25, 6)
  })

  it('flattens a 2D curve onto its own plane and leaves a 3D one in space', () => {
    const lifted: CurveData = {
      ...pathData(),
      dimensions: '2D',
      splines: [{
        id: 's',
        kind: 'poly',
        cyclic: false,
        points: [
          { co: [0, 0, 0], left: [0, 0, 0], right: [0, 0, 0], leftType: 'vector', rightType: 'vector' },
          { co: [1, 0, 2], left: [1, 0, 2], right: [1, 0, 2], leftType: 'vector', rightType: 'vector' },
        ],
      }],
    }
    expect(curveMesh(lifted).vertices[5]).toBe(0)
    expect(curveMesh({ ...lifted, dimensions: '3D' }).vertices[5]).toBe(2)
  })

  it('thins the sweep where a taper object says to', () => {
    const taper: CurveData = {
      ...pathData(),
      splines: [{
        id: 't',
        kind: 'poly',
        cyclic: false,
        points: [
          { co: [0, 1, 0], left: [0, 1, 0], right: [0, 1, 0], leftType: 'vector', rightType: 'vector' },
          { co: [1, 0.2, 0], left: [1, 0.2, 0], right: [1, 0.2, 0], leftType: 'vector', rightType: 'vector' },
        ],
      }],
    }
    const mesh = curveMesh({ ...pathData(), bevelDepth: 0.5, bevelResolution: 0 }, sampleSpline(taper.splines[0]!, 12))
    const sides = bevelSides(0)
    const first = Math.hypot(mesh.vertices[1]!, mesh.vertices[2]!)
    const last = Math.hypot(mesh.vertices[(4 * sides) * 3 + 1]!, mesh.vertices[(4 * sides) * 3 + 2]!)
    expect(first).toBeCloseTo(0.5, 6)
    expect(last).toBeLessThan(0.15)
  })
})

describe('nestContours', () => {
  it('makes a ring inside a ring into a hole', () => {
    const shapes = nestContours([ring(2), ring(1)])
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.holes).toHaveLength(1)
    // An outline winds counter-clockwise and its hole the other way, which is what the fill needs.
    expect(shapes[0]!.outer[0]).toBeDefined()
  })

  it('keeps two rings side by side as two shapes', () => {
    const shapes = nestContours([ring(1, 8, [-3, 0, 0]), ring(1, 8, [3, 0, 0])])
    expect(shapes).toHaveLength(2)
    expect(shapes.every((shape) => shape.holes.length === 0)).toBe(true)
  })

  it('reads a ring inside a hole as an island of its own', () => {
    const shapes = nestContours([ring(4), ring(3), ring(1)])
    expect(shapes).toHaveLength(2)
    expect(shapes[0]!.holes).toHaveLength(1)
    expect(shapes[1]!.holes).toHaveLength(0)
  })
})

describe('solidFromContours', () => {
  it('builds a closed shell around a shape with a hole', () => {
    const shapes = nestContours([ring(2, 6), ring(1, 6)])
    const mesh = solidFromContours(shapes, { extrude: 0.5, fill: 'both' })
    expect(openEdges(mesh)).toBe(0)
    // Twelve points on two levels: the walls are twelve quads, and each cap is triangulated.
    expect(meshCounts(mesh).vertices).toBe(24)
  })

  it('rounds the edge of an extruded shape when a bevel is asked for', () => {
    const flat = solidFromContours(nestContours([ring(1, 8)]), { extrude: 0.5, fill: 'both' })
    const rounded = solidFromContours(nestContours([ring(1, 8)]), { extrude: 0.5, fill: 'both', bevelDepth: 0.1, bevelResolution: 1 })
    expect(rounded.faces.length).toBeGreaterThan(flat.faces.length)
    expect(openEdges(rounded)).toBe(0)
    // The bevel grows the shape outwards and lengthways, exactly as Blender's does.
    const highest = Math.max(...Array.from({ length: rounded.vertexIds.length }, (_, index) => rounded.vertices[index * 3 + 2]!))
    expect(highest).toBeCloseTo(0.6, 6)
  })
})
