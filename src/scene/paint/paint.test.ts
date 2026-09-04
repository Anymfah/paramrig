import { describe, expect, it } from 'vitest'
import { CHANNELS, colourDomain, cornerColours, domainSize } from '@/scene/paint/attribute'
import { blendChannel, blendColour } from '@/scene/paint/brush'
import { PaintSession, paintSettings, rgbOf, DEFAULT_PAINT_STATE } from '@/scene/paint/session'
import { gridMesh, planeMesh } from '@/scene/mesh/primitives'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * Painting: the blend modes, the domains, and a dab landing where it was aimed.
 *
 * The one thing worth asserting hardest is the falloff — a dab at the middle of a grid should be
 * full strength there and nothing at all at its rim — because that is the difference between a
 * brush and a flood fill, and it is invisible in any check that only asks "did the colour change".
 */

function colourAt(session: PaintSession, index: number): [number, number, number] {
  return [session.colours[index * CHANNELS]!, session.colours[index * CHANNELS + 1]!, session.colours[index * CHANNELS + 2]!]
}

/** The mesh's colour at one vertex, read back through the corner domain. */
function readVertex(mesh: MeshData, slot: number): [number, number, number] {
  const corners = cornerColours(mesh)
  let at = 0
  for (const face of mesh.faces) {
    for (const corner of face) {
      if (corner === slot) return [corners[at * CHANNELS]!, corners[at * CHANNELS + 1]!, corners[at * CHANNELS + 2]!]
      at += 1
    }
  }
  return [1, 1, 1]
}

describe('the blend modes', () => {
  it('does what Blender’s names say', () => {
    expect(blendChannel('mix', 0, 1, 1)).toBe(1)
    expect(blendChannel('mix', 0, 1, 0.5)).toBe(0.5)
    expect(blendChannel('add', 0.5, 0.25, 1)).toBe(0.75)
    expect(blendChannel('multiply', 0.5, 0.5, 1)).toBe(0.25)
    expect(blendChannel('lighten', 0.2, 0.8, 1)).toBe(0.8)
    expect(blendChannel('lighten', 0.8, 0.2, 1)).toBe(0.8)
    expect(blendChannel('darken', 0.8, 0.2, 1)).toBeCloseTo(0.2, 9)
  })

  it('never leaves the range, however much is added', () => {
    expect(blendChannel('add', 0.9, 0.9, 1)).toBe(1)
    expect(blendColour('add', [1, 1, 1], [1, 1, 1], 1)).toEqual([1, 1, 1])
  })

  it('does nothing at all at nought', () => {
    expect(blendColour('mix', [0.2, 0.3, 0.4], [1, 0, 0], 0)).toEqual([0.2, 0.3, 0.4])
  })
})

describe('reading a colour', () => {
  it('reads white from a mesh that carries none', () => {
    const mesh = planeMesh(2)
    expect(colourDomain(mesh)).toBeNull()
    expect([...cornerColours(mesh)]).toEqual(new Array(12).fill(1))
  })

  it('counts a value a corner rather than a vertex', () => {
    // Three by three vertices, four quads: nine values on the vertex domain and sixteen corners.
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
    expect(domainSize(mesh, 'vertex')).toBe(9)
    expect(domainSize(mesh, 'corner')).toBe(16)
  })

  it('spreads a vertex colour onto every corner that uses it', () => {
    const mesh = planeMesh(2)
    mesh.attributes.vertex.color = [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0]
    expect(colourDomain(mesh)).toBe('vertex')
    const corners = cornerColours(mesh)
    expect([corners[0], corners[1], corners[2]]).toEqual([1, 0, 0])
    expect([corners[3], corners[4], corners[5]]).toEqual([0, 1, 0])
  })
})

describe('a dab', () => {
  /** A grid a metre across, so a brush of a quarter metre covers a knowable part of it. */
  const grid = () => gridMesh({ xSubdivisions: 21, ySubdivisions: 21, size: 2 })

  it('paints hardest at the middle and not at all outside its radius', () => {
    const mesh = grid()
    const session = new PaintSession(mesh, 'vertex')
    session.beginStroke()
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, paintSettings({ ...DEFAULT_PAINT_STATE, colour: '#ff0000' }, 0.3))
    expect(colourAt(session, nearest(mesh, [0, 0, 0]))).toEqual([1, 0, 0])
    // A corner of the grid is a metre and a half from the middle, well outside a 0.3 m brush.
    expect(colourAt(session, nearest(mesh, [1, 1, 0]))).toEqual([1, 1, 1])
  })

  it('fades between the two, so the edge of a stroke is soft', () => {
    const mesh = grid()
    const session = new PaintSession(mesh, 'vertex')
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, paintSettings({ ...DEFAULT_PAINT_STATE, colour: '#000000' }, 0.4))
    const found: number[] = []
    for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
      const distance = Math.hypot(mesh.vertices[slot * 3]!, mesh.vertices[slot * 3 + 1]!)
      if (distance > 0.15 && distance < 0.3) found.push(colourAt(session, slot)[0])
    }
    expect(found.length).toBeGreaterThan(4)
    for (const value of found) {
      expect(value).toBeGreaterThan(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('writes every corner of a vertex on the corner domain', () => {
    const mesh = gridMesh({ xSubdivisions: 5, ySubdivisions: 5, size: 2 })
    const session = new PaintSession(mesh, 'corner')
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, paintSettings({ ...DEFAULT_PAINT_STATE, colour: '#0000ff' }, 2))
    const painted = session.toMeshData()
    expect(painted.attributes.loop.color).toHaveLength(domainSize(mesh, 'corner') * CHANNELS)
    expect(painted.attributes.vertex.color).toBeUndefined()
    expect(readVertex(painted, 0)[2]).toBeGreaterThan(0.5)
  })

  it('mirrors the dab when symmetry is on', () => {
    const mesh = grid()
    const session = new PaintSession(mesh, 'vertex')
    const settings = paintSettings({ ...DEFAULT_PAINT_STATE, colour: '#00ff00', symmetry: { x: true, y: false, z: false } }, 0.2)
    session.apply({ point: [0.6, 0, 0], normal: [0, 0, 1] }, settings)
    const left = nearest(mesh, [-0.6, 0, 0])
    const right = nearest(mesh, [0.6, 0, 0])
    expect(colourAt(session, left)[1]).toBeCloseTo(colourAt(session, right)[1], 5)
    expect(colourAt(session, right)[0]).toBeLessThan(0.5)
  })

  it('smooths towards the neighbours rather than towards a colour', () => {
    const mesh = grid()
    const session = new PaintSession(mesh, 'vertex')
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, paintSettings({ ...DEFAULT_PAINT_STATE, colour: '#000000' }, 0.2))
    const before = colourAt(session, nearest(mesh, [0, 0, 0]))[0]
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, paintSettings({ ...DEFAULT_PAINT_STATE, brush: 'blur' }, 0.4))
    const after = colourAt(session, nearest(mesh, [0, 0, 0]))[0]
    expect(after).toBeGreaterThan(before)
    expect(after).toBeLessThan(1)
  })

  it('says whether a stroke changed anything', () => {
    const session = new PaintSession(grid(), 'vertex')
    session.beginStroke()
    expect(session.endStroke()).toBe(false)
    session.beginStroke()
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, paintSettings(DEFAULT_PAINT_STATE, 0.3))
    expect(session.endStroke()).toBe(true)
  })
})

describe('fill', () => {
  it('sets every value at once', () => {
    const mesh = gridMesh({ xSubdivisions: 5, ySubdivisions: 5, size: 2 })
    const session = new PaintSession(mesh, 'vertex')
    session.fill([0, 0, 0])
    const painted = session.toMeshData()
    expect(painted.attributes.vertex.color?.every((value) => value === 0)).toBe(true)
  })
})

describe('rgbOf', () => {
  it('reads a hex colour, and paints white when it cannot', () => {
    expect(rgbOf('#ff8000')).toEqual([1, 128 / 255, 0])
    expect(rgbOf('nonsense')).toEqual([1, 1, 1])
  })
})

/** The vertex nearest a point, for a test that knows where it aimed but not at which slot. */
function nearest(mesh: MeshData, point: Vec3): number {
  let best = 0
  let bestDistance = Infinity
  for (let slot = 0; slot < mesh.vertexIds.length; slot += 1) {
    const distance = Math.hypot(
      mesh.vertices[slot * 3]! - point[0],
      mesh.vertices[slot * 3 + 1]! - point[1],
      mesh.vertices[slot * 3 + 2]! - point[2],
    )
    if (distance < bestDistance) {
      bestDistance = distance
      best = slot
    }
  }
  return best
}
