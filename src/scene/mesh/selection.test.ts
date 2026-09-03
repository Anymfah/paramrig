import { describe, expect, it, vi } from 'vitest'
import { edgeKey, meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import {
  convertSelectMode,
  fromElements,
  growSelection,
  invertSelection,
  propagateDown,
  propagateUp,
  selectAll,
  selectBoundary,
  selectByTrait,
  selectCheckerDeselect,
  selectLinked,
  selectLoop,
  selectNone,
  selectRandom,
  selectRing,
  selectSimilar,
  shrinkSelection,
  toElements,
  type ElementSelection,
} from '@/scene/mesh/selection'
import { EMPTY_SELECTION, type MeshData, type SceneSelection, type Vec3 } from '@/scene/types'

/* ------------------------------------------------------------ the canonical meshes */

/** A box centred on the origin, `depth` along Z, so that its edges are not all the same length. */
function box(depth = 2): MeshData {
  const half = depth / 2
  const positions: Vec3[] = [
    [-1, -1, -half], [1, -1, -half], [1, 1, -half], [-1, 1, -half],
    [-1, -1, half], [1, -1, half], [1, 1, half], [-1, 1, half],
  ]
  return meshFromPolygons(positions, [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ])
}

/** A plane on XY cut into `cuts` quads each way, laid out row by row from the origin. */
function plane(cuts: number): MeshData {
  const side = cuts + 1
  const positions: Vec3[] = []
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) positions.push([column, row, 0])
  }
  const faces: number[][] = []
  for (let row = 0; row < cuts; row += 1) {
    for (let column = 0; column < cuts; column += 1) {
      const corner = row * side + column
      faces.push([corner, corner + 1, corner + side + 1, corner + side])
    }
  }
  return meshFromPolygons(positions, faces)
}

/** An open cylinder along Z, whose ring vertices have the four edges an edge loop needs. */
function cylinder(radial: number, segments: number): MeshData {
  const positions: Vec3[] = []
  for (let ring = 0; ring <= segments; ring += 1) {
    for (let step = 0; step < radial; step += 1) {
      const angle = (step / radial) * Math.PI * 2
      positions.push([Math.cos(angle), Math.sin(angle), ring - segments / 2])
    }
  }
  const faces: number[][] = []
  for (let ring = 0; ring < segments; ring += 1) {
    for (let step = 0; step < radial; step += 1) {
      const low = ring * radial + step
      const next = ring * radial + ((step + 1) % radial)
      faces.push([low, next, next + radial, low + radial])
    }
  }
  return meshFromPolygons(positions, faces)
}

/** Two quads touching at one corner and nowhere else. */
function bowTie(): MeshData {
  const positions: Vec3[] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [2, 1, 0], [2, 2, 0], [1, 2, 0],
  ]
  return meshFromPolygons(positions, [[0, 1, 2, 3], [2, 4, 5, 6]])
}

/**
 * Two boxes welded side by side with the wall between them left in place. Face 1 is that wall: it
 * is what Blender calls an interior face, and every one of its edges carries three faces.
 */
function weldedBoxes(): MeshData {
  const positions: Vec3[] = [
    [0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1],
    [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1],
    [2, 0, 0], [2, 1, 0], [2, 1, 1], [2, 0, 1],
  ]
  return meshFromPolygons(positions, [
    [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11],
    [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2],
    [4, 8, 9, 5], [7, 6, 10, 11], [4, 7, 11, 8], [5, 9, 10, 6],
  ])
}

/** A quad flanked by two triangles, for the questions about how many sides a face has. */
function quadAndTriangles(): MeshData {
  const positions: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0]]
  return meshFromPolygons(positions, [[0, 1, 2, 3], [1, 4, 2], [4, 5, 2]])
}

function elements(parts: Partial<ElementSelection> = {}): ElementSelection {
  return { vertices: new Set(), edges: new Set(), faces: new Set(), ...parts }
}

/* --------------------------------------------------------- the document's form */

describe('reading and writing a document’s selection', () => {
  it('reads ids and edge keys, and drops what is not one', () => {
    const stored: SceneSelection = {
      ...EMPTY_SELECTION,
      vertices: ['4', '5', 'north', ''],
      edges: ['4:5', 'not-an-edge', '7:7'],
      faces: ['1'],
    }

    const read = toElements(stored)

    expect([...read.vertices]).toEqual([4, 5])
    expect([...read.edges]).toEqual(['4:5'])
    expect([...read.faces]).toEqual([1])
  })

  it('writes the lists in order, so two equal selections are the same document', () => {
    const written = fromElements(elements({
      vertices: new Set([5, 4, 12]),
      edges: new Set(['5:6', '4:5']),
      faces: new Set([2, 1]),
    }))

    expect(written.vertices).toEqual(['4', '5', '12'])
    expect(written.edges).toEqual(['4:5', '5:6'])
    expect(written.faces).toEqual(['1', '2'])
    expect(written.active).toBeNull()
  })

  it('carries the active element through, and comes back to where it started', () => {
    const before = elements({ vertices: new Set([1, 2]), edges: new Set(['1:2']), faces: new Set([0]) })

    const written = fromElements(before, { kind: 'edge', id: '1:2' })
    const read = toElements({ ...EMPTY_SELECTION, ...written })

    expect(written.active).toEqual({ kind: 'edge', id: '1:2' })
    expect(read).toEqual(before)
  })
})

/* -------------------------------------------------------------------- flushing */

describe('flushing a selection between the element kinds', () => {
  it('takes a face’s edges and corners with it', () => {
    const mesh = EditMesh.from(box())

    const flushed = propagateDown(mesh, elements({ faces: new Set([1]) }))

    expect([...flushed.vertices].sort((a, b) => a - b)).toEqual([4, 5, 6, 7])
    expect(flushed.edges.size).toBe(4)
    expect(flushed.edges.has(edgeKey(4, 5))).toBe(true)
    expect(flushed.edges.has(edgeKey(4, 7))).toBe(true)
  })

  it('takes an edge’s two ends with it', () => {
    const mesh = EditMesh.from(box())

    const flushed = propagateDown(mesh, elements({ edges: new Set([edgeKey(2, 3)]) }))

    expect([...flushed.vertices].sort((a, b) => a - b)).toEqual([2, 3])
    expect(flushed.faces.size).toBe(0)
  })

  it('selects an edge once both its ends are, and a face once all its edges are', () => {
    const mesh = EditMesh.from(box())

    const flushed = propagateUp(mesh, elements({ vertices: new Set([4, 5, 6, 7]) }))

    expect(flushed.edges.size).toBe(4)
    expect([...flushed.faces]).toEqual([1])
  })

  it('leaves a face alone when one of its corners is missing', () => {
    const mesh = EditMesh.from(box())

    const flushed = propagateUp(mesh, elements({ vertices: new Set([4, 5, 6]) }))

    expect(flushed.faces.size).toBe(0)
    expect(flushed.edges.size).toBe(2)
  })

  it('keeps a face’s corners when face mode gives way to vertex mode', () => {
    const mesh = EditMesh.from(box())

    const converted = convertSelectMode(mesh, elements({ faces: new Set([1]) }), ['face'], ['vertex'])

    expect([...converted.vertices].sort((a, b) => a - b)).toEqual([4, 5, 6, 7])
    expect(converted.edges.size).toBe(0)
    expect(converted.faces.size).toBe(0)
  })

  it('keeps only the whole faces when vertex mode gives way to face mode', () => {
    const mesh = EditMesh.from(box())

    const whole = convertSelectMode(mesh, elements({ vertices: new Set([4, 5, 6, 7]) }), ['vertex'], ['face'])
    const part = convertSelectMode(mesh, elements({ vertices: new Set([4, 5, 6]) }), ['vertex'], ['face'])

    expect([...whole.faces]).toEqual([1])
    expect(part.faces.size).toBe(0)
  })

  it('ignores what the old modes were not looking at', () => {
    const mesh = EditMesh.from(box())
    const stale = elements({ vertices: new Set([0, 1, 2, 3]), faces: new Set([1]) })

    const converted = convertSelectMode(mesh, stale, ['face'], ['vertex'])

    expect([...converted.vertices].sort((a, b) => a - b)).toEqual([4, 5, 6, 7])
  })
})

/* ---------------------------------------------------------------- the basics */

describe('selecting everything and nothing', () => {
  it('takes a whole cube, and gives it all back', () => {
    const mesh = EditMesh.from(box())

    const everything = selectAll(mesh)

    expect(everything.vertices.size).toBe(8)
    expect(everything.edges.size).toBe(12)
    expect(everything.faces.size).toBe(6)
    expect(selectNone()).toEqual(elements())
  })

  it('swaps selected for unselected in one mode and leaves the others alone', () => {
    const mesh = EditMesh.from(box())
    const before = elements({ faces: new Set([0]), vertices: new Set([3]) })

    const inverted = invertSelection(mesh, before, 'face')

    expect([...inverted.faces].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect([...inverted.vertices]).toEqual([3])
  })

  it('grows across the edges that touch what is already selected', () => {
    const mesh = EditMesh.from(plane(4))

    const vertices = growSelection(mesh, elements({ vertices: new Set([12]) }), 'vertex')
    const edges = growSelection(mesh, elements({ edges: new Set([edgeKey(11, 12)]) }), 'edge')
    const faces = growSelection(mesh, elements({ faces: new Set([0]) }), 'face')

    expect([...vertices.vertices].sort((a, b) => a - b)).toEqual([7, 11, 12, 13, 17])
    expect(edges.edges.size).toBe(7)
    expect([...faces.faces].sort((a, b) => a - b)).toEqual([0, 1, 4])
  })

  it('peels one ring off a full selection on an open mesh', () => {
    const mesh = EditMesh.from(plane(4))
    const everything = selectAll(mesh)

    expect(shrinkSelection(mesh, everything, 'face').faces.size).toBe(4)
    expect(shrinkSelection(mesh, everything, 'vertex').vertices.size).toBe(9)
    expect(shrinkSelection(mesh, everything, 'edge').edges.size).toBe(24)
  })

  it('leaves a full selection on a closed mesh where it is, there being no rim to peel', () => {
    const mesh = EditMesh.from(box())
    const everything = selectAll(mesh)

    expect(shrinkSelection(mesh, everything, 'face').faces.size).toBe(6)
    expect(shrinkSelection(mesh, everything, 'vertex').vertices.size).toBe(8)
    expect(shrinkSelection(mesh, everything, 'edge').edges.size).toBe(12)
  })

  it('shrinks an empty selection to an empty selection rather than complaining', () => {
    const mesh = EditMesh.from(plane(4))

    expect(shrinkSelection(mesh, selectNone(), 'face')).toEqual(elements())
    expect(growSelection(mesh, selectNone(), 'vertex')).toEqual(elements())
  })
})

/* ------------------------------------------------------------- by topology */

describe('selecting by topology', () => {
  it('takes the part a selected corner belongs to, and stops at the water', () => {
    const first = box()
    const positions: Vec3[] = []
    for (let slot = 0; slot < 8; slot += 1) {
      positions.push([first.vertices[slot * 3]!, first.vertices[slot * 3 + 1]!, first.vertices[slot * 3 + 2]!])
    }
    const far = positions.map((point): Vec3 => [point[0] + 8, point[1], point[2]])
    const mesh = EditMesh.from(meshFromPolygons(
      [...positions, ...far],
      [...first.faces, ...first.faces.map((face) => face.map((slot) => slot + 8))],
    ))

    const linked = selectLinked(mesh, elements({ vertices: new Set([0]) }))

    expect(linked.vertices.size).toBe(8)
    expect(linked.edges.size).toBe(12)
    expect([...linked.faces].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('takes a cylinder’s loop all the way round', () => {
    const mesh = EditMesh.from(cylinder(8, 3))

    const loop = selectLoop(mesh, mesh.edgeSlot(8, 9))

    expect(loop.edges.size).toBe(8)
    expect(loop.vertices.size).toBe(8)
    expect(loop.faces.size).toBe(0)
  })

  it('takes a cube’s ring in four edges', () => {
    const mesh = EditMesh.from(box())

    const ring = selectRing(mesh, mesh.edgeSlot(0, 1))

    expect(ring.edges.size).toBe(4)
    expect(ring.vertices.size).toBe(8)
  })

  it('draws the loop round a region of faces', () => {
    const mesh = EditMesh.from(plane(4))

    const boundary = selectBoundary(mesh, elements({ faces: new Set([0]) }))

    expect(boundary.edges.size).toBe(4)
    expect([...boundary.vertices].sort((a, b) => a - b)).toEqual([0, 1, 5, 6])
  })

  it('falls back to the mesh’s own rim when no face is selected', () => {
    const mesh = EditMesh.from(plane(4))

    expect(selectBoundary(mesh, selectNone()).edges.size).toBe(16)
    expect(selectBoundary(EditMesh.from(box()), selectNone()).edges.size).toBe(0)
  })
})

/* ------------------------------------------------------------ by resemblance */

describe('selecting what resembles what is selected', () => {
  it('finds the edges of the same length', () => {
    const mesh = EditMesh.from(box(4))

    const similar = selectSimilar(mesh, elements({ edges: new Set([edgeKey(0, 4)]) }), 'edge', 'length', 0.001)

    expect(similar.edges.size).toBe(4)
    expect(similar.edges.has(edgeKey(1, 5))).toBe(true)
    expect(similar.edges.has(edgeKey(0, 1))).toBe(false)
  })

  it('finds the faces of the same area, and of the same number of sides', () => {
    const stretched = EditMesh.from(box(4))
    const mixed = EditMesh.from(quadAndTriangles())

    const byArea = selectSimilar(stretched, elements({ faces: new Set([1]) }), 'face', 'area', 0.001)
    const bySides = selectSimilar(mixed, elements({ faces: new Set([1]) }), 'face', 'sides', 0)

    expect([...byArea.faces].sort((a, b) => a - b)).toEqual([0, 1])
    expect([...bySides.faces].sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('finds the corners of the same valence', () => {
    const mesh = EditMesh.from(plane(4))

    const similar = selectSimilar(mesh, elements({ vertices: new Set([12]) }), 'vertex', 'valence', 0)

    expect(similar.vertices.size).toBe(9)
  })

  it('finds the faces that look the same way, and widens as the threshold does', () => {
    const mesh = EditMesh.from(box())
    const top = elements({ faces: new Set([1]) })

    expect([...selectSimilar(mesh, top, 'face', 'normal', 0).faces]).toEqual([1])
    expect(selectSimilar(mesh, top, 'face', 'normal', 1).faces.size).toBe(5)
    expect(selectSimilar(mesh, top, 'face', 'normal', 2).faces.size).toBe(6)
  })

  it('leaves the selection alone when the trait means nothing in this mode, or nothing is selected', () => {
    const mesh = EditMesh.from(box())
    const before = elements({ vertices: new Set([1]) })

    expect(selectSimilar(mesh, before, 'vertex', 'area', 1)).toEqual(before)
    expect(selectSimilar(mesh, selectNone(), 'edge', 'length', 1)).toEqual(elements())
  })
})

/* ------------------------------------------------------------------ by trait */

describe('selecting by trait', () => {
  it('finds nothing to complain about on a closed cube', () => {
    const mesh = EditMesh.from(box())

    expect(selectByTrait(mesh, 'non-manifold')).toEqual(elements())
    expect(selectByTrait(mesh, 'boundary')).toEqual(elements())
    expect(selectByTrait(mesh, 'loose')).toEqual(elements())
    expect(selectByTrait(mesh, 'interior')).toEqual(elements())
  })

  it('finds the edge three faces are hanging from, and the corner of a bow-tie', () => {
    const welded = EditMesh.from(weldedBoxes())
    const tie = EditMesh.from(bowTie())

    const shared = selectByTrait(welded, 'non-manifold')
    expect(shared.edges.has(edgeKey(4, 5))).toBe(true)
    expect(shared.edges.has(edgeKey(0, 1))).toBe(false)

    expect(selectByTrait(tie, 'non-manifold').vertices.has(2)).toBe(true)
  })

  it('finds the wall left between two welded boxes', () => {
    const mesh = EditMesh.from(weldedBoxes())

    expect([...selectByTrait(mesh, 'interior').faces]).toEqual([1])
    expect(selectByTrait(mesh, 'interior', { min: 3, max: 3 }).faces.size).toBe(0)
    expect([...selectByTrait(mesh, 'interior', { min: 4, max: 4 }).faces]).toEqual([1])
  })

  it('finds a corner no edge reaches, and an edge no face hangs from', () => {
    const lonely = EditMesh.from(box())
    lonely.addVertex([9, 9, 9])
    const stripped = EditMesh.from(box())
    stripped.removeFaces([0, 1, 2, 3, 4, 5])

    expect([...selectByTrait(lonely, 'loose').vertices]).toEqual([8])
    expect(selectByTrait(stripped, 'loose').edges.size).toBe(12)
  })

  it('finds the rim of an open mesh', () => {
    const mesh = EditMesh.from(plane(4))

    const rim = selectByTrait(mesh, 'boundary')

    expect(rim.edges.size).toBe(16)
    expect(rim.vertices.size).toBe(16)
  })
})

/* --------------------------------------------------------------- by pattern */

describe('selecting by pattern', () => {
  it('gives the same scatter for the same seed, and a different one for another', () => {
    const mesh = EditMesh.from(plane(4))

    const first = selectRandom(mesh, 'vertex', 0.5, 7)
    const again = selectRandom(mesh, 'vertex', 0.5, 7)
    const other = selectRandom(mesh, 'vertex', 0.5, 8)

    expect([...again.vertices]).toEqual([...first.vertices])
    expect([...other.vertices]).not.toEqual([...first.vertices])
  })

  it('never reaches for the machine’s own randomness', () => {
    const mesh = EditMesh.from(plane(4))
    const rolled = vi.spyOn(Math, 'random')

    selectRandom(mesh, 'face', 0.5, 0)

    expect(rolled).not.toHaveBeenCalled()
    rolled.mockRestore()
  })

  it('takes none of it at nought and all of it at one', () => {
    const mesh = EditMesh.from(plane(4))

    expect(selectRandom(mesh, 'vertex', 0, 3)).toEqual(elements())
    expect(selectRandom(mesh, 'face', 1, 3).faces.size).toBe(16)
    expect(selectRandom(mesh, 'edge', 4, 3).edges.size).toBe(40)
  })

  it('deselects every other face, and slides the pattern along with the offset', () => {
    const mesh = EditMesh.from(plane(4))
    const everything = selectAll(mesh)

    const even = selectCheckerDeselect(everything, 'face', 1, 1, 0)
    const odd = selectCheckerDeselect(everything, 'face', 1, 1, 1)

    expect([...even.faces]).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
    expect([...odd.faces]).toEqual([1, 3, 5, 7, 9, 11, 13, 15])
    expect(even.vertices.size).toBe(25)
  })

  it('keeps two and drops one when asked to', () => {
    const mesh = EditMesh.from(plane(4))

    const kept = selectCheckerDeselect(selectAll(mesh), 'face', 2, 1, 0)

    expect([...kept.faces]).toEqual([0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15])
  })

  it('changes nothing when there is nothing to skip', () => {
    const mesh = EditMesh.from(plane(4))
    const everything = selectAll(mesh)

    expect(selectCheckerDeselect(everything, 'face', 1, 0, 0)).toEqual(everything)
  })
})
