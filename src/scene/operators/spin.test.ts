import { describe, expect, it } from 'vitest'
import { setVertexPosition, vertexPosition } from '@/scene/mesh/data'
import { circleMesh, gridMesh, planeMesh } from '@/scene/mesh/primitives'
import {
  allEdgeKeys,
  allIds,
  editContext,
  euler,
  isClosed,
  isWellFormed,
  resultEdit,
  type EditFixture,
} from '@/scene/operators/editHarness'
import { runOperator } from '@/scene/operators/registry'
import '@/scene/operators/spin'
import type { MeshData } from '@/scene/types'

/**
 * The sweeps and the three ways of nudging vertices.
 *
 * The spin profile is a four-vertex circle with no face in it — Blender's usual starting point for
 * a lathe — lying in the XY plane and turned about the X axis two metres away from it, so that the
 * profile and the axis are coplanar and a whole turn makes a torus rather than a knot.
 */

/** The open four-vertex profile, with every vertex and edge of it selected. */
function profile(): EditFixture {
  const mesh = circleMesh({ vertices: 4, radius: 0.5 })
  return {
    mesh,
    vertices: allIds(mesh, 'vertex'),
    edges: allEdgeKeys(mesh),
    selectMode: ['edge'],
  }
}

/** A three-by-three grid with its middle vertex pulled a metre up: something for a smooth to flatten. */
function spike(): MeshData {
  const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
  setVertexPosition(mesh, 4, [0, 0, 1])
  return mesh
}

function spikeFixture(): EditFixture {
  const mesh = spike()
  return { mesh, vertices: [4], selectMode: ['vertex'] }
}

describe('mesh.spin', () => {
  it('closes a four-vertex profile into a torus over a whole turn in eight steps', () => {
    const result = runOperator('mesh.spin', editContext(profile()), {
      steps: 8, angle: 360, axis: [1, 0, 0], centre: [0, 2, 0],
    })
    const mesh = resultEdit(result)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(true)
    // Eight rings of four, each ring bridged to the next by four quads, and the eighth bridged back
    // onto the first: 32 vertices, 32 profile edges plus 32 along the sweep, 32 quads.
    expect(mesh.vertexCount).toBe(32)
    expect(mesh.edgeCount).toBe(64)
    expect(mesh.faceCount).toBe(32)
    expect(euler(mesh)).toBe(0)
    for (let face = 0; face < mesh.faceCount; face += 1) expect(mesh.faceVertices(face)).toHaveLength(4)
  })

  it('leaves half a turn open at both ends', () => {
    const result = runOperator('mesh.spin', editContext(profile()), {
      steps: 8, angle: 180, axis: [1, 0, 0], centre: [0, 2, 0],
    })
    const mesh = resultEdit(result)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(false)
    // Nine rings this time, because the last one does not come home.
    expect(mesh.vertexCount).toBe(36)
    expect(mesh.edgeCount).toBe(68)
    expect(mesh.faceCount).toBe(32)
    expect(mesh.boundaryEdges()).toHaveLength(8)
  })

  it('puts the last ring exactly where the angle says', () => {
    const result = runOperator('mesh.spin', editContext(profile()), {
      steps: 2, angle: 180, axis: [1, 0, 0], centre: [0, 2, 0],
    })
    const mesh = resultEdit(result)
    // Turning (0.5, 0, 0) half a turn about the line y = 2, z = 0 lands it at (0.5, 4, 0).
    const turned = mesh.position(mesh.vertexCount - 4)
    expect(turned[0]).toBeCloseTo(0.5, 10)
    expect(turned[1]).toBeCloseTo(4, 10)
    expect(turned[2]).toBeCloseTo(0, 10)
  })

  it('replays with different steps, which is what the redo panel does', () => {
    const context = editContext(profile())
    const four = resultEdit(runOperator('mesh.spin', context, {
      steps: 4, angle: 360, axis: [1, 0, 0], centre: [0, 2, 0],
    }))
    expect(four.faceCount).toBe(16)
    expect(four.vertexCount).toBe(16)
    const sixteen = resultEdit(runOperator('mesh.spin', context, {
      steps: 16, angle: 360, axis: [1, 0, 0], centre: [0, 2, 0],
    }))
    expect(sixteen.faceCount).toBe(64)
    expect(sixteen.vertexCount).toBe(64)
  })

  it('lays down copies rather than a surface when duplicates is on', () => {
    const mesh = planeMesh(1)
    const context = editContext({ mesh, faces: allIds(mesh, 'face'), selectMode: ['face'] })
    const result = runOperator('mesh.spin', context, {
      steps: 4, angle: 360, axis: [0, 0, 1], centre: [3, 0, 0], duplicates: true,
    })
    const spun = resultEdit(result)
    expect(isWellFormed(spun)).toBe(true)
    // Three copies, not four: the fourth would land back on the original.
    expect(spun.faceCount).toBe(4)
    expect(spun.vertexCount).toBe(16)
    expect(spun.looseParts()).toHaveLength(4)
  })

  it('refuses a spin of no angle at all', () => {
    expect(runOperator('mesh.spin', editContext(profile()), { angle: 0 }).error)
      .toBe('A spin of no angle has nothing to sweep.')
  })

  it('refuses an axis of nothing', () => {
    expect(runOperator('mesh.spin', editContext(profile()), { axis: [0, 0, 0] }).error)
      .toBe('Give the spin an axis to turn about.')
  })

  it('says what is missing when nothing is selected', () => {
    expect(runOperator('mesh.spin', editContext({ mesh: circleMesh({ vertices: 4 }) })).error)
      .toBe('Nothing is selected.')
  })
})

describe('mesh.screw', () => {
  it('climbs by the selection’s reach along the axis, once a turn', () => {
    const result = runOperator('mesh.screw', editContext(profile()), {
      steps: 8, turns: 2, axis: [1, 0, 0], centre: [0, 2, 0],
    })
    const mesh = resultEdit(result)
    expect(isWellFormed(mesh)).toBe(true)
    expect(isClosed(mesh)).toBe(false)
    // Sixteen steps over two turns: seventeen rings of four, and sixty-four quads between them.
    expect(mesh.vertexCount).toBe(68)
    expect(mesh.edgeCount).toBe(132)
    expect(mesh.faceCount).toBe(64)
    expect(euler(mesh)).toBe(0)
  })

  it('brings the profile home two turns later, one metre of climb per turn', () => {
    const result = runOperator('mesh.screw', editContext(profile()), {
      steps: 8, turns: 2, axis: [1, 0, 0], centre: [0, 2, 0],
    })
    const mesh = resultEdit(result)
    // The profile reaches from x = −0.5 to x = 0.5, so a turn climbs one metre and two climb two.
    const last = mesh.position(mesh.vertexCount - 4)
    const first = mesh.position(0)
    expect(last[0] - first[0]).toBeCloseTo(2, 6)
    expect(last[1]).toBeCloseTo(first[1], 6)
    expect(last[2]).toBeCloseTo(first[2], 6)
  })

  it('replays with another number of turns', () => {
    const context = editContext(profile())
    const once = resultEdit(runOperator('mesh.screw', context, {
      steps: 8, turns: 1, axis: [1, 0, 0], centre: [0, 2, 0],
    }))
    expect(once.faceCount).toBe(32)
    expect(once.vertexCount).toBe(36)
    const thrice = resultEdit(runOperator('mesh.screw', context, {
      steps: 8, turns: 3, axis: [1, 0, 0], centre: [0, 2, 0],
    }))
    expect(thrice.faceCount).toBe(96)
    expect(thrice.vertexCount).toBe(100)
  })

  it('refuses without an axis', () => {
    expect(runOperator('mesh.screw', editContext(profile()), { axis: [0, 0, 0] }).error)
      .toBe('Give the spin an axis to turn about.')
  })
})

describe('mesh.smoothVertices', () => {
  it('pulls a spike down to the average of its neighbours', () => {
    const result = runOperator('mesh.smoothVertices', editContext(spikeFixture()), { factor: 1, repeat: 1 })
    const mesh = resultEdit(result)
    expect(isWellFormed(mesh)).toBe(true)
    expect(mesh.vertexCount).toBe(9)
    expect(mesh.edgeCount).toBe(12)
    expect(mesh.faceCount).toBe(4)
    expect(mesh.position(mesh.slotOfVertex(4))[2]).toBeCloseTo(0, 10)
  })

  it('moves it half the way at half the strength, and a quarter of the way twice over', () => {
    const context = editContext(spikeFixture())
    const once = resultEdit(runOperator('mesh.smoothVertices', context, { factor: 0.5, repeat: 1 }))
    expect(once.position(once.slotOfVertex(4))[2]).toBeCloseTo(0.5, 10)
    const twice = resultEdit(runOperator('mesh.smoothVertices', context, { factor: 0.5, repeat: 2 }))
    expect(twice.position(twice.slotOfVertex(4))[2]).toBeCloseTo(0.25, 10)
  })

  it('leaves the axes it is told to leave alone', () => {
    const result = runOperator('mesh.smoothVertices', editContext(spikeFixture()), { factor: 1, axisZ: false })
    const mesh = resultEdit(result)
    expect(mesh.position(mesh.slotOfVertex(4))[2]).toBeCloseTo(1, 10)
  })

  it('refuses when every axis is switched off', () => {
    const result = runOperator('mesh.smoothVertices', editContext(spikeFixture()), {
      axisX: false, axisY: false, axisZ: false,
    })
    expect(result.error).toBe('Leave at least one axis on, or nothing can move.')
  })
})

describe('mesh.laplacianSmooth', () => {
  it('flattens the spike by lambda when volume is not preserved', () => {
    const result = runOperator('mesh.laplacianSmooth', editContext(spikeFixture()), {
      lambda: 0.5, repeat: 1, preserveVolume: false,
    })
    const mesh = resultEdit(result)
    expect(isWellFormed(mesh)).toBe(true)
    expect(mesh.faceCount).toBe(4)
    expect(mesh.position(mesh.slotOfVertex(4))[2]).toBeCloseTo(0.5, 10)
  })

  it('pushes back out again when volume is preserved', () => {
    const result = runOperator('mesh.laplacianSmooth', editContext(spikeFixture()), {
      lambda: 0.5, repeat: 1, preserveVolume: true,
    })
    const mesh = resultEdit(result)
    // Taubin's second pass has the opposite sign and a slightly larger size, so the vertex comes
    // back part of the way: 0.5 + 0.5 ⁄ (2 − 0.1), which is a shade over three quarters of a metre.
    expect(mesh.position(mesh.slotOfVertex(4))[2]).toBeCloseTo(0.5 + 0.5 / (2 - 0.1), 10)
  })

  it('refuses a lambda of nothing', () => {
    expect(runOperator('mesh.laplacianSmooth', editContext(spikeFixture()), { lambda: 0 }).error)
      .toBe('A lambda of zero moves nothing.')
  })
})

describe('mesh.randomize', () => {
  function scattered(seed: number): number[] {
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    return [...resultEdit(runOperator('mesh.randomize', context, { amount: 0.25, seed })).toData().vertices]
  }

  it('gives the same mesh twice for the same seed, and another one for another seed', () => {
    expect(scattered(7)).toEqual(scattered(7))
    expect(scattered(7)).not.toEqual(scattered(8))
  })

  it('moves every vertex, by no more than the amount, and changes nothing else', () => {
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const result = resultEdit(runOperator('mesh.randomize', context, { amount: 0.25, seed: 3 }))
    expect(isWellFormed(result)).toBe(true)
    expect(result.vertexCount).toBe(9)
    expect(result.edgeCount).toBe(12)
    expect(result.faceCount).toBe(4)
    for (let slot = 0; slot < result.vertexCount; slot += 1) {
      const before = vertexPosition(mesh, slot)
      const after = result.position(slot)
      const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])
      expect(moved).toBeGreaterThan(0)
      expect(moved).toBeLessThanOrEqual(0.25 + 1e-9)
    }
  })

  it('sends every vertex the same way when it is told to follow the normals', () => {
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    const result = resultEdit(runOperator('mesh.randomize', context, {
      amount: 0.25, uniform: 1, normal: 1, seed: 2,
    }))
    for (let slot = 0; slot < result.vertexCount; slot += 1) {
      expect(Math.abs(result.position(slot)[2])).toBeCloseTo(0.25, 10)
    }
  })

  it('refuses an amount of nothing', () => {
    const mesh = gridMesh({ xSubdivisions: 3, ySubdivisions: 3, size: 2 })
    const context = editContext({ mesh, vertices: allIds(mesh, 'vertex') })
    expect(runOperator('mesh.randomize', context, { amount: 0 }).error).toBe('An amount of zero moves nothing.')
  })
})
