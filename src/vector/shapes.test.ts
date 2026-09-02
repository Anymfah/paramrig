import { describe, expect, it } from 'vitest'
import { localNetwork } from '@/vector/network'
import { computeFaces, holeFaceKeys } from '@/vector/planar'
import type { VectorElement } from '@/vector/types'
import {
  anglePoint,
  arcNetwork,
  arcProperties,
  isFullEllipse,
  lineNetwork,
  polygonNetwork,
  polygonProperties,
  DEFAULT_SIDES,
  MAX_SIDES,
  MIN_SIDES,
  shapeHudLabel,
  shapePatch,
  shapePoint,
} from '@/vector/shapes'

const box = { x: 0, y: 0, width: 200, height: 200 }
const world = (network: ReturnType<typeof polygonNetwork>) => localNetwork(box, network)
const area = (network: ReturnType<typeof polygonNetwork>) => {
  const faces = computeFaces(world(network))
  return faces.reduce((sum, face) => sum + face.area, 0)
}

describe('polygon properties', () => {
  it('fills in and clamps what it is given', () => {
    expect(polygonProperties({})).toEqual({ sides: DEFAULT_SIDES, innerRatio: 0 })
    expect(polygonProperties({ sides: 2 })).toMatchObject({ sides: 3 })
    expect(polygonProperties({ sides: 900 })).toMatchObject({ sides: MAX_SIDES })
    expect(polygonProperties({ sides: 6.4, innerRatio: 2 })).toEqual({ sides: 6, innerRatio: 1 })
    expect(polygonProperties({ sides: Number.NaN })).toMatchObject({ sides: DEFAULT_SIDES })
  })
})

describe('polygon geometry', () => {
  it('puts one node per side, starting at the top', () => {
    const network = polygonNetwork({ sides: 5, innerRatio: 0 })

    expect(network.nodes).toHaveLength(5)
    expect(network.segments).toHaveLength(5)
    expect(network.nodes[0]).toMatchObject({ x: 0.5, y: 0 })
    expect(network.nodes.every((node) => node.x >= -1e-9 && node.x <= 1 + 1e-9 && node.y >= -1e-9 && node.y <= 1 + 1e-9)).toBe(true)
  })

  it('doubles the nodes for a star and tucks the inner ones in', () => {
    const star = polygonNetwork({ sides: 5, innerRatio: 0.5 })

    expect(star.nodes).toHaveLength(10)
    const radii = star.nodes.map((node) => Math.hypot(node.x - 0.5, node.y - 0.5))
    expect(Math.max(...radii)).toBeCloseTo(0.5)
    expect(Math.min(...radii)).toBeCloseTo(0.25)
  })

  it('grows towards the ellipse as the sides pile up', () => {
    const triangle = area(polygonNetwork({ sides: 3, innerRatio: 0 }))
    const square = area(polygonNetwork({ sides: 4, innerRatio: 0 }))
    const many = area(polygonNetwork({ sides: 60, innerRatio: 0 }))

    expect(triangle).toBeLessThan(square)
    expect(square).toBeCloseTo(20000, -2)
    expect(many).toBeGreaterThan(square)
    expect(many).toBeLessThan(Math.PI * 100 * 100 + 1)
  })

  it('makes a star smaller than the polygon it came from', () => {
    expect(area(polygonNetwork({ sides: 5, innerRatio: 0.4 }))).toBeLessThan(area(polygonNetwork({ sides: 5, innerRatio: 0 })))
  })
})

describe('arc properties', () => {
  it('defaults to the whole ellipse and clamps the rest', () => {
    expect(arcProperties({})).toEqual({ start: 0, sweep: 360, ratio: 0 })
    expect(arcProperties({ arcStart: 400, arcSweep: 900, arcRatio: 5 })).toEqual({ start: 40, sweep: 360, ratio: 0.99 })
    expect(arcProperties({ arcStart: -90 })).toMatchObject({ start: 270 })
  })

  it('knows a full ellipse from a slice', () => {
    expect(isFullEllipse({ start: 0, sweep: 360, ratio: 0 })).toBe(true)
    expect(isFullEllipse({ start: 0, sweep: 360, ratio: 0.4 })).toBe(false)
    expect(isFullEllipse({ start: 0, sweep: 180, ratio: 0 })).toBe(false)
  })

  it('reads an angle as zero on the right and ninety at the top', () => {
    expect(anglePoint(0)).toEqual({ x: 1, y: 0.5 })
    expect(anglePoint(90).y).toBeCloseTo(0)
    expect(anglePoint(180).x).toBeCloseTo(0)
    expect(anglePoint(270).y).toBeCloseTo(1)
  })
})

describe('arc geometry', () => {
  it('closes a half sector through the centre', () => {
    const network = arcNetwork({ start: 0, sweep: 180, ratio: 0 })

    expect(network.nodes.some((node) => node.x === 0.5 && node.y === 0.5)).toBe(true)
    // The cubic approximation of an arc runs a hair inside the true circle.
    expect(area(network) / ((Math.PI * 100 * 100) / 2)).toBeCloseTo(1, 3)
  })

  it('carves a quarter out of the ellipse', () => {
    expect(area(arcNetwork({ start: 0, sweep: 90, ratio: 0 })) / ((Math.PI * 100 * 100) / 4)).toBeCloseTo(1, 3)
  })

  it('leaves a hole in a ring segment', () => {
    const ring = arcNetwork({ start: 0, sweep: 180, ratio: 0.5 })

    expect(area(ring) / ((Math.PI * (100 * 100 - 50 * 50)) / 2)).toBeCloseTo(1, 3)
    expect(ring.nodes.some((node) => node.x === 0.5 && node.y === 0.5)).toBe(false)
  })

  it('makes a full ring out of two separate loops', () => {
    const ring = arcNetwork({ start: 0, sweep: 360, ratio: 0.5 })

    // Both loops are faces of the arrangement; the inner one is a hole, which the renderer leaves out.
    expect(area(ring) / (Math.PI * (100 * 100 + 50 * 50))).toBeCloseTo(1, 3)
    expect(holeFaceKeys(computeFaces(world(ring)))).toHaveLength(1)
  })

  it('sweeps backwards as happily as forwards', () => {
    expect(area(arcNetwork({ start: 90, sweep: -90, ratio: 0 })) / ((Math.PI * 100 * 100) / 4)).toBeCloseTo(1, 3)
  })
})

describe('the line a drag makes', () => {
  it('runs from one corner of the box to the other', () => {
    const network = lineNetwork()

    expect(network.nodes.map((node) => [node.x, node.y])).toEqual([[0, 0], [1, 1]])
    expect(network.segments).toHaveLength(1)
  })
})

describe('what a shape handle does', () => {
  const polygon: VectorElement = {
    id: 'p', kind: 'polygon', name: 'P', x: 0, y: 0, width: 200, height: 200, rotation: 0,
    fill: '#111111', stroke: 'none', strokeWidth: 0, opacity: 1, visible: true, locked: false, sides: 5,
  }
  const ellipse: VectorElement = { ...polygon, id: 'e', kind: 'ellipse', sides: undefined }

  it('counts sides off the horizontal distance dragged', () => {
    expect(shapePatch(polygon, 'polygon-sides', { x: 42, y: 0 }, { x: 0, y: 0 }, 1)).toEqual({ sides: 8 })
    expect(shapePatch(polygon, 'polygon-sides', { x: -42, y: 0 }, { x: 0, y: 0 }, 1)).toEqual({ sides: 3 })
    expect(shapePatch(polygon, 'polygon-sides', { x: -999, y: 0 }, { x: 0, y: 0 }, 1)).toEqual({ sides: MIN_SIDES })
    expect(shapePatch(polygon, 'polygon-sides', { x: 999, y: 0 }, { x: 0, y: 0 }, 1)).toEqual({ sides: MAX_SIDES })
  })

  it('counts sides in screen pixels, so the zoom does not change the feel', () => {
    expect(shapePatch(polygon, 'polygon-sides', { x: 84, y: 0 }, { x: 0, y: 0 }, 0.5)).toEqual({ sides: 8 })
  })

  it('reads the star ratio off the distance to the centre', () => {
    expect(shapePatch(polygon, 'polygon-ratio', { x: 100, y: 50 }, { x: 0, y: 0 }, 1).innerRatio).toBeCloseTo(0.5)
    expect(shapePatch(polygon, 'polygon-ratio', { x: 100, y: 100 }, { x: 0, y: 0 }, 1).innerRatio).toBe(0)
  })

  it('opens an arc from the whole ellipse by dragging its end', () => {
    const patch = shapePatch(ellipse, 'arc-end', { x: 100, y: 0 }, { x: 200, y: 100 }, 1)

    expect(patch).toMatchObject({ arcStart: 0, arcRatio: 0 })
    expect(patch.arcSweep).toBeCloseTo(90)
  })

  it('moves the start and keeps the far end where it was', () => {
    const quarter: VectorElement = { ...ellipse, arcStart: 0, arcSweep: 90 }

    const patch = shapePatch(quarter, 'arc-start', { x: 0, y: 100 }, { x: 200, y: 100 }, 1)

    expect(patch.arcStart).toBeCloseTo(180)
    expect(patch.arcSweep).toBeCloseTo(270)
  })

  it('takes the ring radius from the pointer and keeps the slice', () => {
    const quarter: VectorElement = { ...ellipse, arcStart: 0, arcSweep: 90 }

    const patch = shapePatch(quarter, 'arc-ratio', { x: 150, y: 100 }, { x: 0, y: 0 }, 1)

    expect(patch).toMatchObject({ arcStart: 0, arcSweep: 90 })
    expect(patch.arcRatio).toBeCloseTo(0.5)
  })

  it('reads a rotated element in its own frame', () => {
    const turned: VectorElement = { ...ellipse, rotation: 37 }

    // Where the handle is drawn and what dragging it back reads must agree, rotation and all.
    for (const angle of [30, 120, 250]) {
      const world = shapePoint(turned, anglePoint(angle))
      expect(shapePatch(turned, 'arc-end', world, { x: 0, y: 0 }, 1).arcSweep).toBeCloseTo(angle)
    }
  })

  it('says what the drag is doing', () => {
    expect(shapeHudLabel(polygon, 'polygon-sides', { x: 42, y: 0 }, { x: 0, y: 0 }, 1)).toBe('8 sides')
    expect(shapeHudLabel(polygon, 'polygon-ratio', { x: 100, y: 50 }, { x: 0, y: 0 }, 1)).toBe('50%')
    expect(shapeHudLabel(ellipse, 'arc-end', { x: 100, y: 0 }, { x: 200, y: 100 }, 1)).toBe('0° · 90°')
  })

  it('places a handle in world space, rotation included', () => {
    expect(shapePoint(polygon, anglePoint(90))).toEqual({ x: 100, y: 0 })

    const turned = shapePoint({ ...polygon, rotation: 90 }, anglePoint(90))

    // A quarter turn takes the top of the box onto one of its sides, still at the same distance.
    expect(Math.hypot(turned.x - 100, turned.y - 100)).toBeCloseTo(100)
    expect(turned.y).toBeCloseTo(100)
  })
})
