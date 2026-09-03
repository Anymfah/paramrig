import { describe, expect, it } from 'vitest'
import { meshFromPolygons, vertexPosition } from '@/scene/mesh/data'
import { EditMesh } from '@/scene/mesh/editMesh'
import { dot, subtract } from '@/scene/mesh/normals'
import { boxMesh, cylinderMesh } from '@/scene/mesh/primitives'
import {
  allEdgeKeys,
  allIds,
  editContext,
  euler,
  isClosed,
  isWellFormed,
  keyOf,
  resultEdit,
  resultMesh,
  resultSelection,
} from '@/scene/operators/editHarness'
import { runOperator } from '@/scene/operators/registry'
import '@/scene/operators/normals'
import type { MeshData, Vec3 } from '@/scene/types'

/*
 * The whole family turns on which way a face is wound and on the flags an edge carries, so the
 * assertions are of three kinds: the signed volume, which is positive only when every face of a
 * closed mesh faces out; the loop itself, read back by face id; and the attribute arrays as they
 * come out of `toData`, since a flag that does not survive that round trip is a flag the document
 * never sees.
 */

/** The volume with its sign kept: the harness’s own `meshVolume` takes the modulus, and the sign is the point here. */
function signedVolume(mesh: EditMesh): number {
  let total = 0
  for (let face = 0; face < mesh.faceCount; face += 1) {
    const loop = mesh.faceVertices(face)
    for (let index = 1; index + 1 < loop.length; index += 1) {
      const a = mesh.position(loop[0]!)
      const b = mesh.position(loop[index]!)
      const c = mesh.position(loop[index + 1]!)
      total += (
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])
      ) / 6
    }
  }
  return total
}

/** Every face normal against the offset of its centre from the mesh centre, summed. */
function outwardness(mesh: EditMesh): number {
  const centre = mesh.bounds().centre
  let total = 0
  for (let face = 0; face < mesh.faceCount; face += 1) {
    total += dot(mesh.faceNormal(face), subtract(mesh.faceCentre(face), centre))
  }
  return total
}

/** Whether every face of every connected part faces away from that part’s own centre. */
function everyFaceOutwards(mesh: EditMesh): boolean {
  for (const part of mesh.looseParts()) {
    const centre = mesh.boundsOf(part).centre
    const members = new Set(part)
    for (let face = 0; face < mesh.faceCount; face += 1) {
      const loop = mesh.faceVertices(face)
      if (!loop.every((slot) => members.has(slot))) continue
      if (dot(mesh.faceNormal(face), subtract(mesh.faceCentre(face), centre)) <= 0) return false
    }
  }
  return true
}

/** A face’s loop written by vertex id, so it can be compared across two runs. */
function loopOf(mesh: EditMesh, faceId: number): number[] {
  return mesh.faceVertices(mesh.slotOfFace(faceId)).map((slot) => mesh.vertexId(slot))
}

/** The same loop the other way round, as `flipFace` writes it: the first corner stays put. */
function turned(loop: number[]): number[] {
  return [loop[0]!, ...loop.slice(1).reverse()]
}

function withFlippedFaces(source: MeshData, faces: number[]): MeshData {
  const mesh = EditMesh.from(source)
  for (const face of faces) mesh.flipFace(face)
  return mesh.toData()
}

function withSmoothFaces(source: MeshData, smooth: boolean): MeshData {
  const mesh = EditMesh.from(source)
  for (let face = 0; face < mesh.faceCount; face += 1) mesh.setFaceSmooth(face, smooth)
  return mesh.toData()
}

function withSharpEdges(source: MeshData, sharp: boolean): MeshData {
  const mesh = EditMesh.from(source)
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) mesh.setEdgeFlag(edge, 'sharp', sharp)
  return mesh.toData()
}

/** Two cubes five metres apart in one mesh, which is what “per connected component” is about. */
function twoCubes(): MeshData {
  const box = boxMesh(2)
  const positions: Vec3[] = []
  const faces: number[][] = []
  for (const offset of [0, 5]) {
    const base = positions.length
    for (let slot = 0; slot < box.vertexIds.length; slot += 1) {
      const point = vertexPosition(box, slot)
      positions.push([point[0] + offset, point[1], point[2]])
    }
    for (const loop of box.faces) faces.push(loop.map((slot) => slot + base))
  }
  return meshFromPolygons(positions, faces)
}

function faceContext(mesh: MeshData) {
  return editContext({ mesh, faces: allIds(mesh, 'face'), selectMode: ['face'] })
}

function edgeContext(mesh: MeshData, edges = allEdgeKeys(mesh)) {
  return editContext({ mesh, edges, selectMode: ['edge'] })
}

/** The slots of the edges whose two ends are at different heights: a tube’s side edges. */
function uprightEdges(mesh: EditMesh): number[] {
  const upright: number[] = []
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    const [a, b] = mesh.edgeVertices(edge)
    if (Math.abs(mesh.position(a)[2] - mesh.position(b)[2]) > 1e-9) upright.push(edge)
  }
  return upright
}

function sharpCount(mesh: EditMesh): number {
  let total = 0
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) if (mesh.edgeFlag(edge, 'sharp')) total += 1
  return total
}

/* -------------------------------------------------------------- recalculate */

describe('mesh.normalsRecalculate', () => {
  it('winds every face of a cube outwards again when three of them were flipped', () => {
    const data = withFlippedFaces(boxMesh(2), [0, 2, 4])
    const before = EditMesh.from(data)
    expect(signedVolume(before)).toBeLessThan(8)

    const mesh = resultEdit(runOperator('mesh.normalsRecalculate', faceContext(data)))
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isClosed(mesh)).toBe(true)
    expect(isWellFormed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    expect(signedVolume(mesh)).toBeCloseTo(8, 10)
    expect(outwardness(mesh)).toBeGreaterThan(0)
    expect(everyFaceOutwards(mesh)).toBe(true)
  })

  it('leaves every vertex exactly where it was', () => {
    const data = withFlippedFaces(boxMesh(2), [0, 2, 4])
    const mesh = resultEdit(runOperator('mesh.normalsRecalculate', faceContext(data)))
    for (let slot = 0; slot < data.vertexIds.length; slot += 1) {
      const moved = mesh.position(mesh.slotOfVertex(data.vertexIds[slot]!))
      expect(moved).toEqual(vertexPosition(data, slot))
    }
    expect(resultSelection(runOperator('mesh.normalsRecalculate', faceContext(data))).faces).toEqual(allIds(data, 'face'))
  })

  it('winds them inwards instead, which is the outward answer turned round face for face', () => {
    const data = withFlippedFaces(boxMesh(2), [0, 2, 4])
    const outside = resultEdit(runOperator('mesh.normalsRecalculate', faceContext(data)))
    const inside = resultEdit(runOperator('mesh.normalsRecalculate', faceContext(data), { inside: true }))

    expect(signedVolume(inside)).toBeCloseTo(-8, 10)
    expect(isWellFormed(inside)).toBe(true)
    expect(isClosed(inside)).toBe(true)
    for (const id of allIds(data, 'face')) {
      expect(loopOf(inside, id)).toEqual(turned(loopOf(outside, id)))
    }
  })

  it('fixes two separate cubes in one mesh, each from its own geometry', () => {
    const data = withFlippedFaces(twoCubes(), [0, 2, 7, 9, 11])
    const mesh = resultEdit(runOperator('mesh.normalsRecalculate', faceContext(data)))
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([16, 24, 12])
    expect(mesh.looseParts()).toHaveLength(2)
    expect(everyFaceOutwards(mesh)).toBe(true)
    expect(signedVolume(mesh)).toBeCloseTo(16, 10)
  })

  it('replays with a different answer to the same document, which is what F9 does', () => {
    const data = withFlippedFaces(boxMesh(2), [1, 3])
    const context = faceContext(data)
    expect(signedVolume(resultEdit(runOperator('mesh.normalsRecalculate', context, { inside: false })))).toBeCloseTo(8, 10)
    expect(signedVolume(resultEdit(runOperator('mesh.normalsRecalculate', context, { inside: true })))).toBeCloseTo(-8, 10)
  })

  it('refuses when no face is selected', () => {
    const result = runOperator('mesh.normalsRecalculate', editContext({ mesh: boxMesh(2) }))
    expect(result.error).toBe('No faces are selected.')
    expect(result.document).toBeUndefined()
  })
})

/* --------------------------------------------------------------------- flip */

describe('mesh.normalsFlip', () => {
  it('turns the selected face round and leaves the other five alone', () => {
    const data = boxMesh(2)
    const before = EditMesh.from(data)
    const context = editContext({ mesh: data, faces: [data.faceIds[0]!], selectMode: ['face'] })
    const mesh = resultEdit(runOperator('mesh.normalsFlip', context))

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(loopOf(mesh, data.faceIds[0]!)).toEqual(turned(loopOf(before, data.faceIds[0]!)))
    for (const id of allIds(data, 'face').slice(1)) expect(loopOf(mesh, id)).toEqual(loopOf(before, id))
    expect(signedVolume(mesh)).toBeCloseTo(8 - 8 / 3, 10)
  })

  it('turns a whole cube inside out when every face is selected', () => {
    const mesh = resultEdit(runOperator('mesh.normalsFlip', faceContext(boxMesh(2))))
    expect(signedVolume(mesh)).toBeCloseTo(-8, 10)
    expect(isClosed(mesh)).toBe(true)
  })

  it('replays to where it started, because two flips are none', () => {
    const data = boxMesh(2)
    const once = resultMesh(runOperator('mesh.normalsFlip', faceContext(data)))
    const twice = resultEdit(runOperator('mesh.normalsFlip', faceContext(once)))
    for (const id of allIds(data, 'face')) expect(loopOf(twice, id)).toEqual(loopOf(EditMesh.from(data), id))
  })

  it('refuses when no face is selected', () => {
    expect(runOperator('mesh.normalsFlip', editContext({ mesh: boxMesh(2) })).error).toBe('No faces are selected.')
  })
})

/* ------------------------------------------------------------ set from faces */

describe('mesh.normalsSetFromFaces', () => {
  it('makes the selected faces flat and hard all the way round', () => {
    const data = withSmoothFaces(boxMesh(2), true)
    const context = editContext({ mesh: data, faces: [data.faceIds[0]!, data.faceIds[1]!], selectMode: ['face'] })
    const mesh = resultEdit(runOperator('mesh.normalsSetFromFaces', context))

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isWellFormed(mesh)).toBe(true)
    expect(mesh.faceSmooth(mesh.slotOfFace(data.faceIds[0]!))).toBe(false)
    expect(mesh.faceSmooth(mesh.slotOfFace(data.faceIds[1]!))).toBe(false)
    expect(mesh.faceSmooth(mesh.slotOfFace(data.faceIds[2]!))).toBe(true)
    // The bottom and the top of a cube share no edge, so it is four edges each.
    expect(sharpCount(mesh)).toBe(8)
  })

  it('replays over itself without adding anything', () => {
    const first = resultMesh(runOperator('mesh.normalsSetFromFaces', faceContext(withSmoothFaces(boxMesh(2), true))))
    const second = resultEdit(runOperator('mesh.normalsSetFromFaces', faceContext(first)))
    expect(sharpCount(second)).toBe(12)
    expect([second.vertexCount, second.edgeCount, second.faceCount]).toEqual([8, 12, 6])
  })

  it('refuses when no face is selected', () => {
    expect(runOperator('mesh.normalsSetFromFaces', editContext({ mesh: boxMesh(2) })).error).toBe('No faces are selected.')
  })
})

/* ----------------------------------------------------------- point to target */

describe('mesh.normalsPointToTarget', () => {
  it('turns every face of an inside-out cube away from the 3D cursor', () => {
    const data = withFlippedFaces(boxMesh(2), [0, 1, 2, 3, 4, 5])
    const context = editContext({ mesh: data, faces: allIds(data, 'face'), selectMode: ['face'], cursor: [0, 0, 0] })
    const mesh = resultEdit(runOperator('mesh.normalsPointToTarget', context))

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(signedVolume(mesh)).toBeCloseTo(8, 10)
  })

  it('points them at a target instead when one is given', () => {
    const target: Vec3 = [10, 0, 0]
    const context = faceContext(boxMesh(2))
    const mesh = resultEdit(runOperator('mesh.normalsPointToTarget', context, { from: 'target', target }))
    for (let face = 0; face < mesh.faceCount; face += 1) {
      expect(dot(mesh.faceNormal(face), subtract(mesh.faceCentre(face), target))).toBeGreaterThan(0)
    }
  })

  it('replays pointing towards the cursor rather than away from it', () => {
    const data = withFlippedFaces(boxMesh(2), [0, 1, 2, 3, 4, 5])
    const context = editContext({ mesh: data, faces: allIds(data, 'face'), selectMode: ['face'], cursor: [0, 0, 0] })
    const mesh = resultEdit(runOperator('mesh.normalsPointToTarget', context, { invert: true }))
    expect(signedVolume(mesh)).toBeCloseTo(-8, 10)
  })

  it('refuses when no face is selected', () => {
    expect(runOperator('mesh.normalsPointToTarget', editContext({ mesh: boxMesh(2) })).error).toBe('No faces are selected.')
  })
})

/* ------------------------------------------------------------------ average */

describe('mesh.normalsAverage', () => {
  it('smooths the selection and takes the sharp flags off the edges inside it', () => {
    const data = withSharpEdges(boxMesh(2), true)
    const mesh = resultEdit(runOperator('mesh.normalsAverage', faceContext(data)))
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isWellFormed(mesh)).toBe(true)
    expect(sharpCount(mesh)).toBe(0)
    for (let face = 0; face < mesh.faceCount; face += 1) expect(mesh.faceSmooth(face)).toBe(true)
  })

  it('leaves the rim of the selection sharp, because its other face was not asked about', () => {
    const data = withSharpEdges(boxMesh(2), true)
    const context = editContext({ mesh: data, faces: [data.faceIds[0]!, data.faceIds[2]!], selectMode: ['face'] })
    const mesh = resultEdit(runOperator('mesh.normalsAverage', context))
    // Two faces of a cube that meet share one edge; the other eleven keep the flag they had.
    expect(sharpCount(mesh)).toBe(11)
  })

  it('replays over itself and changes nothing the second time', () => {
    const first = resultMesh(runOperator('mesh.normalsAverage', faceContext(withSharpEdges(boxMesh(2), true))))
    const second = resultEdit(runOperator('mesh.normalsAverage', faceContext(first)))
    expect(sharpCount(second)).toBe(0)
    expect([second.vertexCount, second.edgeCount, second.faceCount]).toEqual([8, 12, 6])
  })

  it('refuses when no face is selected', () => {
    expect(runOperator('mesh.normalsAverage', editContext({ mesh: boxMesh(2) })).error).toBe('No faces are selected.')
  })
})

/* ------------------------------------------------------------------ shading */

describe('mesh.shadeSmooth and mesh.shadeFlat', () => {
  it('smooths the selected faces and leaves the rest flat', () => {
    const data = boxMesh(2)
    const context = editContext({ mesh: data, faces: [data.faceIds[1]!, data.faceIds[3]!], selectMode: ['face'] })
    const mesh = resultEdit(runOperator('mesh.shadeSmooth', context))
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
    expect(isWellFormed(mesh)).toBe(true)
    expect(mesh.faceSmooth(mesh.slotOfFace(data.faceIds[1]!))).toBe(true)
    expect(mesh.faceSmooth(mesh.slotOfFace(data.faceIds[3]!))).toBe(true)
    expect(mesh.faceSmooth(mesh.slotOfFace(data.faceIds[0]!))).toBe(false)
  })

  it('flattens them again, which is the same operator’s other half', () => {
    const smooth = resultMesh(runOperator('mesh.shadeSmooth', faceContext(boxMesh(2))))
    const mesh = resultEdit(runOperator('mesh.shadeFlat', faceContext(smooth)))
    for (let face = 0; face < mesh.faceCount; face += 1) expect(mesh.faceSmooth(face)).toBe(false)
  })

  it('refuses when no face is selected', () => {
    expect(runOperator('mesh.shadeSmooth', editContext({ mesh: boxMesh(2) })).error).toBe('No faces are selected.')
    expect(runOperator('mesh.shadeFlat', editContext({ mesh: boxMesh(2) })).error).toBe('No faces are selected.')
  })
})

/* -------------------------------------------------------------- auto smooth */

describe('mesh.autoSmooth', () => {
  it('marks the two cap rings of an eight-sided cylinder sharp at 50°, and leaves the eight side edges smooth', () => {
    const data = cylinderMesh({ vertices: 8, radius: 1, depth: 2 })
    const result = runOperator('mesh.autoSmooth', faceContext(data), { angle: 50 })
    const mesh = resultEdit(result)

    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([16, 24, 10])
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    expect(euler(mesh)).toBe(2)
    const upright = new Set(uprightEdges(mesh))
    expect(upright.size).toBe(8)
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      expect(mesh.edgeFlag(edge, 'sharp')).toBe(!upright.has(edge))
    }
    for (let face = 0; face < mesh.faceCount; face += 1) expect(mesh.faceSmooth(face)).toBe(true)
    expect(resultMesh(result).autoSmooth).toEqual({ enabled: true, angle: 50 })
  })

  it('marks the side edges of an eight-sided cylinder sharp too at 30°, because that fold is 45°', () => {
    const data = cylinderMesh({ vertices: 8, radius: 1, depth: 2 })
    const mesh = resultEdit(runOperator('mesh.autoSmooth', faceContext(data), { angle: 30 }))
    for (const edge of uprightEdges(mesh)) {
      expect((mesh.dihedral(edge) * 180) / Math.PI).toBeCloseTo(45, 6)
      expect(mesh.edgeFlag(edge, 'sharp')).toBe(true)
    }
    expect(sharpCount(mesh)).toBe(24)
  })

  it('splits only the cap rings of a sixteen-sided cylinder at 30°, where the fold is 22.5°', () => {
    const data = cylinderMesh({ vertices: 16, radius: 1, depth: 2 })
    const mesh = resultEdit(runOperator('mesh.autoSmooth', faceContext(data), { angle: 30 }))
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([32, 48, 18])
    const upright = new Set(uprightEdges(mesh))
    expect(upright.size).toBe(16)
    expect(sharpCount(mesh)).toBe(32)
    for (const edge of upright) expect(mesh.edgeFlag(edge, 'sharp')).toBe(false)
  })

  it('replays at another angle against the same document', () => {
    const context = faceContext(cylinderMesh({ vertices: 8, radius: 1, depth: 2 }))
    expect(sharpCount(resultEdit(runOperator('mesh.autoSmooth', context, { angle: 30 })))).toBe(24)
    expect(sharpCount(resultEdit(runOperator('mesh.autoSmooth', context, { angle: 50 })))).toBe(16)
    expect(sharpCount(resultEdit(runOperator('mesh.autoSmooth', context, { angle: 100 })))).toBe(0)
    expect(resultMesh(runOperator('mesh.autoSmooth', context, { angle: 100 })).autoSmooth).toEqual({ enabled: true, angle: 100 })
  })

  it('refuses when no face is selected', () => {
    expect(runOperator('mesh.autoSmooth', editContext({ mesh: boxMesh(2) })).error).toBe('No faces are selected.')
  })
})

/* --------------------------------------------------------- edge attributes */

describe('the edge attributes', () => {
  it('marks the selected edges sharp and clears them again', () => {
    const data = boxMesh(2)
    const edit = EditMesh.from(data)
    const edges = [keyOf(edit, 0, 1), keyOf(edit, 2, 3)]
    const marked = resultMesh(runOperator('mesh.markSharp', edgeContext(data, edges)))
    const mesh = EditMesh.from(marked)
    expect(sharpCount(mesh)).toBe(2)
    expect(mesh.edgeFlag(mesh.edgeSlot(0, 1), 'sharp')).toBe(true)
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])

    const cleared = resultEdit(runOperator('mesh.clearSharp', edgeContext(marked, edges)))
    expect(sharpCount(cleared)).toBe(0)
  })

  it('marks a seam that survives the round trip through toData', () => {
    const data = boxMesh(2)
    const edit = EditMesh.from(data)
    const edges = [keyOf(edit, 0, 1), keyOf(edit, 1, 2), keyOf(edit, 2, 3)]
    const marked = resultMesh(runOperator('mesh.markSeam', edgeContext(data, edges)))

    expect(marked.attributes.edge.seam?.filter(Boolean)).toHaveLength(3)
    const mesh = EditMesh.from(marked)
    expect(mesh.edgeFlag(mesh.edgeSlot(0, 1), 'seam')).toBe(true)
    expect(mesh.edgeFlag(mesh.edgeSlot(1, 2), 'seam')).toBe(true)
    expect(mesh.edgeFlag(mesh.edgeSlot(0, 3), 'seam')).toBe(false)
    expect(isWellFormed(mesh)).toBe(true)

    const cleared = resultMesh(runOperator('mesh.clearSeam', edgeContext(marked, edges)))
    expect(cleared.attributes.edge.seam?.filter(Boolean)).toHaveLength(0)
  })

  it('creases the selected edges, and the crease survives the round trip too', () => {
    const data = boxMesh(2)
    const edit = EditMesh.from(data)
    const edges = [keyOf(edit, 0, 1), keyOf(edit, 1, 2)]
    const creased = resultMesh(runOperator('mesh.setCrease', edgeContext(data, edges), { value: 0.5 }))

    expect(creased.attributes.edge.crease?.filter((value) => value > 0)).toEqual([0.5, 0.5])
    const mesh = EditMesh.from(creased)
    expect(mesh.edgeNumber(mesh.edgeSlot(0, 1), 'crease')).toBe(0.5)
    expect(mesh.edgeNumber(mesh.edgeSlot(0, 3), 'crease')).toBe(0)
    expect([mesh.vertexCount, mesh.edgeCount, mesh.faceCount]).toEqual([8, 12, 6])
  })

  it('replays the crease with another number, and holds it inside nought to one', () => {
    const data = boxMesh(2)
    const edit = EditMesh.from(data)
    const context = edgeContext(data, [keyOf(edit, 0, 1)])
    const half = EditMesh.from(resultMesh(runOperator('mesh.setCrease', context, { value: 0.25 })))
    expect(half.edgeNumber(half.edgeSlot(0, 1), 'crease')).toBe(0.25)
    const full = EditMesh.from(resultMesh(runOperator('mesh.setCrease', context, { value: 5 })))
    expect(full.edgeNumber(full.edgeSlot(0, 1), 'crease')).toBe(1)
  })

  it('sets a bevel weight on the selected edges', () => {
    const data = boxMesh(2)
    const edit = EditMesh.from(data)
    const weighted = resultMesh(runOperator('mesh.setBevelWeight', edgeContext(data, [keyOf(edit, 4, 5)]), { value: 0.75 }))
    const mesh = EditMesh.from(weighted)
    expect(mesh.edgeNumber(mesh.edgeSlot(4, 5), 'bevelWeight')).toBe(0.75)
    expect(weighted.attributes.edge.bevelWeight?.filter((value) => value > 0)).toEqual([0.75])
  })

  it('refuses every one of them when no edge is selected', () => {
    const context = editContext({ mesh: boxMesh(2) })
    for (const id of ['mesh.markSharp', 'mesh.clearSharp', 'mesh.markSeam', 'mesh.clearSeam', 'mesh.setCrease', 'mesh.setBevelWeight']) {
      expect(runOperator(id, context).error).toBe('No edges are selected.')
    }
  })
})
