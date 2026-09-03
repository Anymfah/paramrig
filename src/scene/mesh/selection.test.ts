import { describe, expect, it, vi } from 'vitest'
import { edgeKey, meshFromPolygons } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import {
  convertSelectMode,
  fromElements,
  withElements,
  growSelection,
  invertSelection,
  nextActive,
  previousActive,
  propagateDown,
  propagateUp,
  selectAll,
  selectBoundary,
  selectByTrait,
  selectCheckerDeselect,
  selectLinked,
  selectLinkedFrom,
  selectLoop,
  selectLoopInnerRegion,
  selectMirror,
  selectNone,
  selectRandom,
  selectRing,
  selectShortestPath,
  selectSideOfActive,
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

/**
 * Two quads sharing an edge, the second wound the same way round it as the first — which is to say
 * one of them faces the wrong way. It is the smallest mesh with a non contiguous edge.
 */
function flippedQuads(): MeshData {
  const positions: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0]]
  return meshFromPolygons(positions, [[0, 1, 2, 3], [1, 2, 5, 4]])
}

function elements(parts: Partial<ElementSelection> = {}): ElementSelection {
  return { vertices: new Set(), edges: new Set(), faces: new Set(), ...parts }
}

/** Whether a run of vertex ids is one unbroken chain, walked from one named end to the other. */
function isChain(mesh: EditMesh, ids: number[], from: number, to: number): boolean {
  const run = new Set(ids)
  const seen = new Set<number>([from])
  let current = from
  for (;;) {
    const slot = mesh.slotOfVertex(current)
    if (slot < 0) return false
    const onward = mesh.vertexEdges(slot)
      .map((edge) => {
        const [a, b] = mesh.edgeVertices(edge)
        return mesh.vertexId(mesh.vertexId(a) === current ? b : a)
      })
      .filter((id) => run.has(id) && !seen.has(id))
    if (onward.length === 0) break
    current = onward[0]!
    seen.add(current)
  }
  return current === to && seen.size === ids.length
}

/* --------------------------------------------------------- the document's form */

describe('reading and writing a document’s selection', () => {
  it('reads ids and edge keys, and drops what is not one', () => {
    const stored: SceneSelection = {
      ...EMPTY_SELECTION,
      activeObjectId: 'cube',
      editObjectIds: ['cube'],
      elements: { cube: { vertices: ['4', '5', 'north', ''], edges: ['4:5', 'not-an-edge', '7:7'], faces: ['1'] } },
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
  })

  it('carries the active element through, and comes back to where it started', () => {
    const before = elements({ vertices: new Set([1, 2]), edges: new Set(['1:2']), faces: new Set([0]) })
    const active = { kind: 'edge' as const, objectId: 'cube', id: '1:2' }

    const written = withElements({ ...EMPTY_SELECTION, activeObjectId: 'cube' }, 'cube', before, active)
    const read = toElements(written)

    expect(written.active).toEqual(active)
    expect(written.elementHistory).toEqual([active])
    expect(read).toEqual(before)
  })

  it('promotes the previous pick when the active element is deselected', () => {
    const first = { kind: 'vertex' as const, objectId: 'cube', id: '1' }
    const second = { kind: 'vertex' as const, objectId: 'cube', id: '2' }
    const base = { ...EMPTY_SELECTION, activeObjectId: 'cube' }

    const one = withElements(base, 'cube', elements({ vertices: new Set([1]) }), first)
    const two = withElements(one, 'cube', elements({ vertices: new Set([1, 2]) }), second)
    const back = withElements(two, 'cube', elements({ vertices: new Set([1]) }))

    expect(two.active).toEqual(second)
    expect(back.active).toEqual(first)
    expect(back.elementHistory).toEqual([first])
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

/* --------------------------------------------------------------- by a path */

describe('selecting the path between two elements', () => {
  it('runs along a grid’s row from one corner to the next', () => {
    const mesh = EditMesh.from(plane(4))

    const path = selectShortestPath(mesh, selectNone(), { kind: 'vertex', id: 0 }, { kind: 'vertex', id: 4 })

    expect([...path.vertices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })

  it('crosses a grid corner to opposite corner in nine corners, unbroken', () => {
    const mesh = EditMesh.from(plane(4))

    const path = selectShortestPath(mesh, selectNone(), { kind: 'vertex', id: 0 }, { kind: 'vertex', id: 24 })
    const run = [...path.vertices]

    expect(run.length).toBe(9)
    expect(run).toContain(0)
    expect(run).toContain(24)
    expect(isChain(mesh, run, 0, 24)).toBe(true)
  })

  it('crosses the faces of the same grid, along a row and then corner to corner', () => {
    const mesh = EditMesh.from(plane(4))

    const row = selectShortestPath(mesh, selectNone(), { kind: 'face', id: 0 }, { kind: 'face', id: 3 })
    const across = selectShortestPath(mesh, selectNone(), { kind: 'face', id: 0 }, { kind: 'face', id: 15 })

    expect([...row.faces].sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
    expect(across.faces.size).toBe(7)
    expect(across.faces.has(0)).toBe(true)
    expect(across.faces.has(15)).toBe(true)
  })

  it('runs from one edge to another by the cheapest pairing of their ends', () => {
    const mesh = EditMesh.from(plane(4))

    const path = selectShortestPath(
      mesh,
      selectNone(),
      { kind: 'edge', id: edgeKey(0, 1) },
      { kind: 'edge', id: edgeKey(3, 4) },
    )

    expect([...path.edges].sort()).toEqual([edgeKey(0, 1), edgeKey(1, 2), edgeKey(2, 3), edgeKey(3, 4)])
    expect([...path.vertices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })

  it('fills the whole block between the two ends when the region is asked for', () => {
    const mesh = EditMesh.from(plane(4))

    const corners = selectShortestPath(
      mesh,
      selectNone(),
      { kind: 'vertex', id: 0 },
      { kind: 'vertex', id: 24 },
      { fillRegion: true },
    )
    const faces = selectShortestPath(
      mesh,
      selectNone(),
      { kind: 'face', id: 0 },
      { kind: 'face', id: 15 },
      { fillRegion: true },
    )

    expect(corners.vertices.size).toBe(25)
    expect(faces.faces.size).toBe(16)
  })

  it('adds to what was selected, and leaves it alone when the two ends are of different kinds', () => {
    const mesh = EditMesh.from(plane(4))
    const before = elements({ vertices: new Set([20]) })

    const added = selectShortestPath(mesh, before, { kind: 'vertex', id: 0 }, { kind: 'vertex', id: 4 })
    const mismatched = selectShortestPath(mesh, before, { kind: 'vertex', id: 0 }, { kind: 'face', id: 0 })

    expect([...added.vertices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 20])
    expect(mismatched).toEqual(before)
  })
})

/* ------------------------------------------------------- linked from a pick */

describe('selecting what is linked to a pick', () => {
  it('takes the whole cylinder, and stops at a ring of seams', () => {
    const mesh = EditMesh.from(cylinder(8, 3))
    for (let step = 0; step < 8; step += 1) {
      mesh.setEdgeFlag(mesh.edgeSlot(8 + step, 8 + ((step + 1) % 8)), 'seam', true)
    }

    const whole = selectLinkedFrom(mesh, selectNone(), { kind: 'face', id: 0 })
    const stopped = selectLinkedFrom(mesh, selectNone(), { kind: 'face', id: 0 }, { seam: true })

    expect(whole.faces.size).toBe(24)
    expect([...stopped.faces].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(stopped.vertices.size).toBe(16)
  })

  it('stops at sharp edges as readily, from a corner rather than a face', () => {
    const mesh = EditMesh.from(cylinder(8, 3))
    for (let step = 0; step < 8; step += 1) {
      mesh.setEdgeFlag(mesh.edgeSlot(8 + step, 8 + ((step + 1) % 8)), 'sharp', true)
    }

    const stopped = selectLinkedFrom(mesh, selectNone(), { kind: 'vertex', id: 0 }, { sharp: true })

    expect(stopped.faces.size).toBe(8)
  })

  it('stops where the material changes', () => {
    const mesh = EditMesh.from(cylinder(8, 3))
    for (let face = 16; face < 24; face += 1) mesh.setFaceMaterial(face, 1)

    const stopped = selectLinkedFrom(mesh, selectNone(), { kind: 'face', id: 0 }, { material: true })

    expect(stopped.faces.size).toBe(16)
  })

  it('keeps what was selected before the pick', () => {
    const mesh = EditMesh.from(plane(4))

    const linked = selectLinkedFrom(mesh, elements({ faces: new Set([15]) }), { kind: 'vertex', id: 0 })

    expect(linked.faces.size).toBe(16)
    expect(linked.vertices.size).toBe(25)
  })
})

/* ------------------------------------------------------- the region of a loop */

describe('selecting the region a loop of edges encloses', () => {
  it('takes the one face a ring of four edges shuts in', () => {
    const mesh = EditMesh.from(plane(4))
    const loop = elements({
      edges: new Set([edgeKey(6, 7), edgeKey(7, 12), edgeKey(11, 12), edgeKey(6, 11)]),
    })

    const inner = selectLoopInnerRegion(mesh, loop)

    expect([...inner.faces]).toEqual([5])
    expect([...inner.vertices].sort((a, b) => a - b)).toEqual([6, 7, 11, 12])
  })

  it('takes the smaller side of a loop that goes round a closed mesh', () => {
    const mesh = EditMesh.from(box())
    const loop = elements({
      edges: new Set([edgeKey(4, 5), edgeKey(5, 6), edgeKey(6, 7), edgeKey(4, 7)]),
    })

    expect([...selectLoopInnerRegion(mesh, loop).faces]).toEqual([1])
  })

  it('leaves the selection alone when nothing is walled off', () => {
    const mesh = EditMesh.from(plane(4))
    const single = elements({ edges: new Set([edgeKey(6, 7)]) })

    expect(selectLoopInnerRegion(mesh, single)).toEqual(single)
    expect(selectLoopInnerRegion(mesh, selectNone())).toEqual(elements())
  })
})

/* ------------------------------------------------------------ one side and the other */

describe('selecting one side of the active element', () => {
  it('takes the far side of a cube, the near side, and the corners level with it', () => {
    const mesh = EditMesh.from(box())
    const active = { kind: 'vertex' as const, id: 0 }

    const positive = selectSideOfActive(mesh, selectNone(), active, 0, 'positive', false)
    const negative = selectSideOfActive(mesh, selectNone(), active, 0, 'negative', false)
    const aligned = selectSideOfActive(mesh, selectNone(), active, 0, 'aligned', false)

    expect([...positive.vertices].sort((a, b) => a - b)).toEqual([1, 2, 5, 6])
    expect(positive.edges.size).toBe(4)
    expect([...positive.faces]).toEqual([3])
    expect(negative).toEqual(elements())
    expect([...aligned.vertices].sort((a, b) => a - b)).toEqual([0, 3, 4, 7])
    expect([...aligned.faces]).toEqual([5])
  })

  it('measures from a face’s centre as readily as from a corner', () => {
    const mesh = EditMesh.from(box())

    const level = selectSideOfActive(mesh, selectNone(), { kind: 'face', id: 3 }, 0, 'aligned', false)

    expect([...level.vertices].sort((a, b) => a - b)).toEqual([1, 2, 5, 6])
  })

  it('keeps what was selected when it is asked to extend', () => {
    const mesh = EditMesh.from(box())
    const before = elements({ vertices: new Set([0]) })

    const extended = selectSideOfActive(mesh, before, { kind: 'vertex', id: 0 }, 0, 'positive', true)

    expect([...extended.vertices].sort((a, b) => a - b)).toEqual([0, 1, 2, 5, 6])
  })
})

/* ------------------------------------------------------------------ the mirror */

describe('selecting the mirror of what is selected', () => {
  it('finds a corner’s opposite number across a cube’s middle, on either axis', () => {
    const mesh = EditMesh.from(box())
    const corner = elements({ vertices: new Set([0]) })

    const across = selectMirror(mesh, corner, 0, 0.001, false)
    const kept = selectMirror(mesh, corner, 0, 0.001, true)
    const depth = selectMirror(mesh, corner, 2, 0.001, false)

    expect([...across.vertices]).toEqual([1])
    expect([...kept.vertices].sort((a, b) => a - b)).toEqual([0, 1])
    expect([...depth.vertices]).toEqual([4])
  })

  it('finds the edge and the face on the other side too', () => {
    const mesh = EditMesh.from(box())
    const before = elements({ edges: new Set([edgeKey(0, 3)]), faces: new Set([5]) })

    const mirrored = selectMirror(mesh, before, 0, 0.001, false)

    expect([...mirrored.edges]).toEqual([edgeKey(1, 2)])
    expect([...mirrored.faces]).toEqual([3])
  })

  it('finds nothing where the mesh has no other half', () => {
    const mesh = EditMesh.from(plane(4))

    expect(selectMirror(mesh, elements({ vertices: new Set([1]) }), 0, 0.001, false)).toEqual(elements())
  })
})

/* ------------------------------------------------------------------ face step */

describe('growing and shrinking across a face’s corners', () => {
  it('reaches a quad’s far corner with face step, and only along the edges without', () => {
    const mesh = EditMesh.from(plane(4))
    const one = elements({ vertices: new Set([12]) })

    expect([...growSelection(mesh, one, 'vertex').vertices].sort((a, b) => a - b)).toEqual([7, 11, 12, 13, 17])
    expect([...growSelection(mesh, one, 'vertex', { faceStep: true }).vertices].sort((a, b) => a - b))
      .toEqual([6, 7, 8, 11, 12, 13, 16, 17, 18])
  })

  it('takes in the eight faces round a face rather than the four', () => {
    const mesh = EditMesh.from(plane(4))
    const one = elements({ faces: new Set([5]) })

    expect([...growSelection(mesh, one, 'face').faces].sort((a, b) => a - b)).toEqual([1, 4, 5, 6, 9])
    expect([...growSelection(mesh, one, 'face', { faceStep: true }).faces].sort((a, b) => a - b))
      .toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10])
  })

  it('takes the edges of an edge’s own faces rather than the edges at its ends', () => {
    const mesh = EditMesh.from(plane(4))
    const one = elements({ edges: new Set([edgeKey(11, 12)]) })

    const stepped = growSelection(mesh, one, 'edge', { faceStep: true })

    expect(stepped.edges.size).toBe(7)
    expect(stepped.edges.has(edgeKey(6, 7))).toBe(true)
    expect(stepped.edges.has(edgeKey(10, 11))).toBe(false)
  })

  it('drops a face whose corner neighbours are not all selected', () => {
    const mesh = EditMesh.from(plane(4))
    const cross = elements({ faces: new Set([1, 4, 5, 6, 9]) })

    expect([...shrinkSelection(mesh, cross, 'face').faces]).toEqual([5])
    expect(shrinkSelection(mesh, cross, 'face', { faceStep: true }).faces.size).toBe(0)
  })
})

/* -------------------------------------------------- resemblance, the newer traits */

describe('selecting what resembles what is selected, by the newer traits', () => {
  it('finds the faces of the same perimeter', () => {
    const mesh = EditMesh.from(box(4))

    const similar = selectSimilar(mesh, elements({ faces: new Set([1]) }), 'face', 'perimeter', 0.001)

    expect([...similar.faces].sort((a, b) => a - b)).toEqual([0, 1])
  })

  it('finds the faces drawn with the same material', () => {
    const mesh = EditMesh.from(box())
    mesh.setFaceMaterial(0, 1)
    mesh.setFaceMaterial(2, 1)

    const similar = selectSimilar(mesh, elements({ faces: new Set([0]) }), 'face', 'material', 0)

    expect([...similar.faces].sort((a, b) => a - b)).toEqual([0, 2])
  })

  it('finds the edges running the same way, whichever end they run from', () => {
    const mesh = EditMesh.from(box())

    const similar = selectSimilar(mesh, elements({ edges: new Set([edgeKey(0, 1)]) }), 'edge', 'direction', 0)

    expect(similar.edges.size).toBe(4)
    expect(similar.edges.has(edgeKey(3, 2))).toBe(true)
    expect(similar.edges.has(edgeKey(0, 3))).toBe(false)
  })

  it('finds the edges marked the same way, and creased by the same amount', () => {
    const mesh = EditMesh.from(box())
    mesh.setEdgeFlag(mesh.edgeSlot(0, 1), 'seam', true)
    mesh.setEdgeFlag(mesh.edgeSlot(1, 2), 'seam', true)
    mesh.setEdgeFlag(mesh.edgeSlot(0, 3), 'sharp', true)
    mesh.setEdgeNumber(mesh.edgeSlot(4, 5), 'crease', 0.5)

    const seams = selectSimilar(mesh, elements({ edges: new Set([edgeKey(0, 1)]) }), 'edge', 'seam', 0)
    const sharp = selectSimilar(mesh, elements({ edges: new Set([edgeKey(0, 3)]) }), 'edge', 'sharp', 0)
    const creased = selectSimilar(mesh, elements({ edges: new Set([edgeKey(4, 5)]) }), 'edge', 'crease', 0.01)

    expect([...seams.edges].sort()).toEqual([edgeKey(0, 1), edgeKey(1, 2)])
    expect([...sharp.edges]).toEqual([edgeKey(0, 3)])
    expect([...creased.edges]).toEqual([edgeKey(4, 5)])
  })

  it('still leaves the selection alone when the trait means nothing in this mode', () => {
    const mesh = EditMesh.from(box())
    const before = elements({ edges: new Set([edgeKey(0, 1)]) })

    expect(selectSimilar(mesh, before, 'edge', 'area', 1)).toEqual(before)
    expect(selectSimilar(mesh, elements({ faces: new Set([0]) }), 'face', 'length', 1))
      .toEqual(elements({ faces: new Set([0]) }))
  })
})

/* ---------------------------------------------------- by trait, the newer ones */

describe('selecting by the newer traits', () => {
  it('finds a cylinder’s sharp columns by angle, and none of them at a wider angle', () => {
    const mesh = EditMesh.from(cylinder(8, 3))

    const sharp = selectByTrait(mesh, 'sharp', { angle: 0.7 })
    const wider = selectByTrait(mesh, 'sharp', { angle: 0.9 })

    expect(sharp.edges.size).toBe(24)
    expect(sharp.edges.has(edgeKey(0, 8))).toBe(true)
    expect(sharp.edges.has(edgeKey(8, 9))).toBe(false)
    expect(wider.edges.size).toBe(0)
  })

  it('finds the faces with a given number of sides, and compares either way round', () => {
    const mesh = EditMesh.from(quadAndTriangles())

    expect([...selectByTrait(mesh, 'faces-by-sides', { sides: 4 }).faces]).toEqual([0])
    expect([...selectByTrait(mesh, 'faces-by-sides', { sides: 3 }).faces].sort((a, b) => a - b)).toEqual([1, 2])
    expect([...selectByTrait(mesh, 'faces-by-sides', { sides: 3, comparison: 'greater' }).faces]).toEqual([0])
    expect([...selectByTrait(mesh, 'faces-by-sides', { sides: 4, comparison: 'less' }).faces].sort((a, b) => a - b))
      .toEqual([1, 2])
  })

  it('looks only for the kind of trouble it is asked about', () => {
    const welded = EditMesh.from(weldedBoxes())
    const open = EditMesh.from(plane(4))

    const shared = selectByTrait(welded, 'non-manifold', {
      wire: false, boundary: false, nonContiguous: false, vertices: false,
    })
    const rim = selectByTrait(open, 'non-manifold', {
      wire: false, multipleFaces: false, nonContiguous: false, vertices: false,
    })
    const quiet = selectByTrait(open, 'non-manifold', {
      wire: false, boundary: false, multipleFaces: false, nonContiguous: false, vertices: false,
    })

    expect(shared.edges.size).toBe(4)
    expect(rim.edges.size).toBe(16)
    expect(quiet).toEqual(elements())
  })

  it('finds the edge where two faces disagree about which way is out', () => {
    const mesh = EditMesh.from(flippedQuads())

    const flipped = selectByTrait(mesh, 'non-manifold', {
      wire: false, boundary: false, multipleFaces: false, vertices: false,
    })

    expect([...flipped.edges]).toEqual([edgeKey(1, 2)])
  })
})

/* ----------------------------------------------------------- the pick history */

describe('walking the pick history', () => {
  const picks = ['0', '1', '2'].map((id) => ({ kind: 'vertex' as const, objectId: 'cube', id }))

  function picked(history: typeof picks, selected: string[], active: (typeof picks)[number]): SceneSelection {
    return {
      ...EMPTY_SELECTION,
      activeObjectId: 'cube',
      editObjectIds: ['cube'],
      elements: { cube: { vertices: selected, edges: [], faces: [] } },
      active,
      elementHistory: history,
    }
  }

  it('steps back through the picks and forward again, leaving the history where it was', () => {
    const mesh = EditMesh.from(box())
    const selection = picked(picks, ['0', '1', '2'], picks[2]!)

    const back = previousActive(mesh, selection)
    const further = previousActive(mesh, back)
    const forward = nextActive(mesh, further)

    expect(back.active).toEqual(picks[1])
    expect(further.active).toEqual(picks[0])
    expect(forward.active).toEqual(picks[1])
    expect(further.elementHistory).toEqual(picks)
  })

  it('stays where it is at either end of the history', () => {
    const mesh = EditMesh.from(box())

    expect(nextActive(mesh, picked(picks, ['0', '1', '2'], picks[2]!)).active).toEqual(picks[2])
    expect(previousActive(mesh, picked(picks, ['0', '1', '2'], picks[0]!)).active).toEqual(picks[0])
  })

  it('skips a pick the mesh no longer holds, and selects the one it lands on', () => {
    const mesh = EditMesh.from(box())
    const gone = { kind: 'vertex' as const, objectId: 'cube', id: '99' }
    const history = [picks[0]!, gone, picks[2]!]

    const back = previousActive(mesh, picked(history, ['2'], picks[2]!))

    expect(back.active).toEqual(picks[0])
    expect(back.elements?.cube?.vertices).toEqual(['0', '2'])
  })
})
