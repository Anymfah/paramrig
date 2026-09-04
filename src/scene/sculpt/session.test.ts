import { describe, expect, it } from 'vitest'
import { gridMesh } from '@/scene/mesh/primitives'
import { DEFAULT_SCULPT, SculptSession, type SculptSettings } from '@/scene/sculpt/session'
import type { MeshData, Vec3 } from '@/scene/types'

/**
 * The brushes, each on a flat grid.
 *
 * A grid in the XY plane with its normals pointing at +Z is the shape that makes every brush
 * readable: whatever a brush does, it does it from a known flat surface, so "it pushed the middle
 * up" and "it left the rim alone" are both one number away. That is the pair every case here
 * checks, because between them they are what a brush *is*: it acts inside its radius and nowhere
 * else, and it acts most where the pointer is.
 */

/** A grid two units across, lying flat, with a vertex on the origin. */
function flat(divisions = 12): MeshData {
  return gridMesh({ xSubdivisions: divisions, ySubdivisions: divisions, size: 2 })
}

function settings(over: Partial<SculptSettings> = {}): SculptSettings {
  return { ...DEFAULT_SCULPT, radius: 0.5, strength: 1, ...over }
}

/** The vertex nearest a place, which is what "the middle" and "the rim" mean here. */
function nearest(session: SculptSession, point: Vec3): number {
  let best = 0
  let distance = Infinity
  for (let index = 0; index < session.vertexCount; index += 1) {
    const dx = session.positions[index * 3]! - point[0]
    const dy = session.positions[index * 3 + 1]! - point[1]
    const dz = session.positions[index * 3 + 2]! - point[2]
    const found = dx * dx + dy * dy + dz * dz
    if (found < distance) {
      distance = found
      best = index
    }
  }
  return best
}

function heightOf(session: SculptSession, index: number): number {
  return session.positions[index * 3 + 2]!
}

/** One dab in the middle of the grid, pushing along +Z. */
function dabIt(session: SculptSession, options: Partial<SculptSettings> = {}, times = 1): void {
  session.beginStroke()
  for (let step = 0; step < times; step += 1) {
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, settings(options))
  }
}

describe('the sculpt session', () => {
  it('takes the mesh apart into typed arrays and puts it back unchanged', () => {
    const mesh = flat(4)
    const session = new SculptSession(mesh)
    expect(session.vertexCount).toBe(mesh.vertexIds.length)
    const back = session.toMeshData()
    expect(back.vertices).toEqual(mesh.vertices)
    expect(back.faces).toBe(mesh.faces)
  })

  it('works out the normals of a flat grid, which all point one way', () => {
    const session = new SculptSession(flat(4))
    for (let index = 0; index < session.vertexCount; index += 1) {
      expect(Math.abs(session.normals[index * 3 + 2]!), `vertex ${index}`).toBeCloseTo(1, 6)
    }
  })

  it('draw lifts the middle and leaves everything past the radius alone', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    const far = nearest(session, [0.95, 0.95, 0])
    dabIt(session)
    expect(heightOf(session, middle)).toBeGreaterThan(0.01)
    expect(heightOf(session, far)).toBe(0)
  })

  it('and holding control digs instead', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    dabIt(session, { invert: true })
    expect(heightOf(session, middle)).toBeLessThan(-0.01)
  })

  it('falls off from the middle: nearer is further moved', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    const halfway = nearest(session, [0.25, 0, 0])
    dabIt(session)
    expect(heightOf(session, middle)).toBeGreaterThan(heightOf(session, halfway))
    expect(heightOf(session, halfway)).toBeGreaterThan(0)
  })

  it('a stroke of many dabs goes deeper than one', () => {
    const once = new SculptSession(flat())
    const middle = nearest(once, [0, 0, 0])
    dabIt(once)
    const many = new SculptSession(flat())
    dabIt(many, {}, 5)
    expect(heightOf(many, middle)).toBeGreaterThan(heightOf(once, middle) * 2)
  })

  it('inflate pushes along each vertex’s own normal', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    dabIt(session, { brush: 'inflate' })
    expect(heightOf(session, middle)).toBeGreaterThan(0)
  })

  it('smooth takes a bump back down without moving the rim', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    dabIt(session, {}, 4)
    const bump = heightOf(session, middle)
    dabIt(session, { brush: 'smooth', strength: 1 }, 6)
    expect(heightOf(session, middle)).toBeLessThan(bump)
    expect(heightOf(session, nearest(session, [0.95, 0.95, 0]))).toBe(0)
  })

  it('flatten levels a bump towards the surface around it', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    dabIt(session, {}, 4)
    const bump = heightOf(session, middle)
    dabIt(session, { brush: 'flatten', strength: 1 }, 4)
    expect(heightOf(session, middle)).toBeLessThan(bump)
  })

  it('scrape cuts what is above the plane and fill lifts what is below it', () => {
    const scraped = new SculptSession(flat())
    const middle = nearest(scraped, [0, 0, 0])
    dabIt(scraped, {}, 4)
    const bump = heightOf(scraped, middle)
    dabIt(scraped, { brush: 'scrape', strength: 1 }, 4)
    expect(heightOf(scraped, middle)).toBeLessThan(bump)

    const filled = new SculptSession(flat())
    dabIt(filled, { invert: true }, 4)
    const dent = heightOf(filled, middle)
    dabIt(filled, { brush: 'fill', strength: 1 }, 4)
    expect(heightOf(filled, middle)).toBeGreaterThan(dent)
  })

  it('grab drags the surface with the pointer rather than piling it up', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    const before = session.positions[middle * 3]!
    session.beginStroke()
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, settings({ brush: 'grab' }))
    session.apply({ point: [0.2, 0, 0], normal: [0, 0, 1] }, settings({ brush: 'grab' }))
    const after = session.positions[middle * 3]!
    expect(after - before).toBeGreaterThan(0.05)
    /*
     * The same dab again does not drag it further, which is the whole difference between grab and
     * the brushes that paint: grab measures from where the stroke found the surface, so holding
     * still holds the surface still.
     */
    session.apply({ point: [0.2, 0, 0], normal: [0, 0, 1] }, settings({ brush: 'grab' }))
    expect(session.positions[middle * 3]!).toBeCloseTo(after, 6)
  })

  it('pinch draws the surface in towards the pointer', () => {
    const session = new SculptSession(flat())
    const side = nearest(session, [0.3, 0, 0])
    const before = session.positions[side * 3]!
    dabIt(session, { brush: 'pinch' }, 3)
    expect(session.positions[side * 3]!).toBeLessThan(before)
  })

  it('the mask brush writes the mask and nothing else', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    dabIt(session, { brush: 'mask' }, 4)
    expect(session.mask[middle]).toBeGreaterThan(0)
    expect(heightOf(session, middle)).toBe(0)
    expect(session.toMeshData().attributes.vertex.mask).toHaveLength(session.vertexCount)
  })

  it('and a masked vertex does not move', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    dabIt(session, { brush: 'mask' }, 20)
    expect(session.mask[middle]).toBeCloseTo(1, 3)
    dabIt(session, {}, 4)
    expect(heightOf(session, middle)).toBeCloseTo(0, 6)
    // And its unmasked neighbours still move, so the mask is a mask and not a freeze.
    expect(heightOf(session, nearest(session, [0.4, 0, 0]))).toBeGreaterThan(0)
  })

  it('symmetry sculpts the mirror of every dab', () => {
    const session = new SculptSession(flat())
    const left = nearest(session, [-0.6, 0, 0])
    session.beginStroke()
    session.apply({ point: [0.6, 0, 0], normal: [0, 0, 1] }, settings({ symmetry: { x: true, y: false, z: false } }))
    expect(heightOf(session, left)).toBeGreaterThan(0.01)
    expect(heightOf(session, left)).toBeCloseTo(heightOf(session, nearest(session, [0.6, 0, 0])), 6)
  })

  it('front faces only leaves the vertices facing away alone', () => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    session.beginStroke()
    // Looking from behind: the grid's normals point at the viewer's back, so nothing is touched.
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1], view: [0, 0, 1] }, settings({ frontFacesOnly: true }))
    expect(heightOf(session, middle)).toBe(0)
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1], view: [0, 0, -1] }, settings({ frontFacesOnly: true }))
    expect(heightOf(session, middle)).toBeGreaterThan(0)
  })

  it('a stroke is one entry, holding only what moved', () => {
    const session = new SculptSession(flat())
    dabIt(session, {}, 3)
    const stroke = session.endStroke()!
    expect(stroke).not.toBeNull()
    expect(stroke.indices.length).toBeGreaterThan(0)
    expect(stroke.indices.length).toBeLessThan(session.vertexCount)
    expect(stroke.before).toHaveLength(stroke.indices.length * 3)
    for (let index = 0; index < stroke.indices.length; index += 1) {
      expect(stroke.before[index * 3 + 2]).toBe(0)
      expect(stroke.after[index * 3 + 2]).toBeGreaterThan(0)
    }
  })

  it('a stroke that moved nothing is not an entry at all', () => {
    const session = new SculptSession(flat())
    session.beginStroke()
    session.apply({ point: [9, 9, 9], normal: [0, 0, 1] }, settings())
    expect(session.endStroke()).toBeNull()
  })

  /*
   * Every brush, on one property: it does something where the pointer is and nothing past its
   * radius. It is a weak claim about each of them and a strong one about the family — a brush that
   * silently did nothing, or one that moved the whole mesh, is the failure this catches, and the
   * ones with a shape worth arguing about have a case of their own above.
   */
  const EVERY_BRUSH: SculptSettings['brush'][] = [
    'draw', 'draw-sharp', 'clay', 'clay-strips', 'inflate', 'blob', 'crease', 'smooth',
    'flatten', 'fill', 'scrape', 'pinch', 'grab', 'elastic', 'snake-hook', 'thumb', 'nudge', 'rotate',
  ]

  it.each(EVERY_BRUSH)('%s moves the surface under the pointer and nothing outside its radius', (brush) => {
    const session = new SculptSession(flat())
    const middle = nearest(session, [0, 0, 0])
    const far = nearest(session, [0.95, 0.95, 0])
    const start: Vec3 = [
      session.positions[far * 3]!, session.positions[far * 3 + 1]!, session.positions[far * 3 + 2]!,
    ]
    /*
     * A bump first, so the brushes that level a surface have something to level — and a dent for
     * Fill, which by definition only lifts what is below the surface around it and would rightly
     * do nothing to a bump.
     */
    dabIt(session, { invert: brush === 'fill' }, 3)
    const before: Vec3 = [
      session.positions[middle * 3]!, session.positions[middle * 3 + 1]!, session.positions[middle * 3 + 2]!,
    ]
    session.beginStroke()
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, settings({ brush }))
    session.apply({ point: [0.1, 0.05, 0], normal: [0, 0, 1] }, settings({ brush }))
    const after: Vec3 = [
      session.positions[middle * 3]!, session.positions[middle * 3 + 1]!, session.positions[middle * 3 + 2]!,
    ]
    expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]), brush).toBeGreaterThan(1e-4)
    expect([
      session.positions[far * 3]!, session.positions[far * 3 + 1]!, session.positions[far * 3 + 2]!,
    ], brush).toEqual(start)
  })

  /*
   * The number the plan asks for, measured where nothing else can get in the way.
   *
   * Two hundred thousand vertices is more than a document can be saved with — the browser's local
   * storage is five megabytes — so this is the one place the figure can be had honestly: the
   * session on its own, one dab, no canvas and no store. What it proves is that the grid is doing
   * its job, because a dab that walked every vertex would take a hundred times as long.
   */
  it('a dab on two hundred thousand vertices takes a fraction of a frame', () => {
    const session = new SculptSession(flat(448))
    expect(session.vertexCount).toBeGreaterThan(200000)
    session.beginStroke()
    // Warmed first: the first dab of a session pays for the grid, which is built once.
    session.apply({ point: [0, 0, 0], normal: [0, 0, 1] }, settings({ radius: 0.2 }))
    const started = performance.now()
    for (let step = 0; step < 10; step += 1) {
      session.apply({ point: [step * 0.01, 0, 0], normal: [0, 0, 1] }, settings({ radius: 0.2 }))
    }
    const each = (performance.now() - started) / 10
    console.log(`MEASURE one dab on ${session.vertexCount.toLocaleString()} vertices: ${each.toFixed(2)} ms`)
    expect(each).toBeLessThan(16)
  })

  it('a pressure of nothing still leaves a mark, and a full press leaves more', () => {
    const light = new SculptSession(flat())
    const middle = nearest(light, [0, 0, 0])
    light.beginStroke()
    light.apply({ point: [0, 0, 0], normal: [0, 0, 1], pressure: 0.1 }, settings())
    const heavy = new SculptSession(flat())
    heavy.beginStroke()
    heavy.apply({ point: [0, 0, 0], normal: [0, 0, 1], pressure: 1 }, settings())
    expect(heightOf(light, middle)).toBeGreaterThan(0)
    expect(heightOf(heavy, middle)).toBeGreaterThan(heightOf(light, middle))
  })
})
