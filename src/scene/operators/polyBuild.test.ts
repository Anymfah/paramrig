import { describe, expect, it } from 'vitest'
import { edgeKey } from '@/scene/mesh/data'
import { planeMesh } from '@/scene/mesh/primitives'
import { editContext, isWellFormed, resultEdit, resultSelection } from '@/scene/operators/editHarness'
import { runOperator } from '@/scene/operators/registry'
import '@/scene/operators/polyBuild'

/*
 * Poly build is four verbs on whatever the pointer is over, so each test names what was under it
 * and what came out. The point always arrives in the mesh's own space: the viewport converts.
 */

describe('poly build', () => {
  it('pulls a face out of a border edge, wound like the one already there', () => {
    const mesh = planeMesh(2)
    const context = editContext({ mesh, selectMode: ['edge'] })
    const before = { vertices: mesh.vertexIds.length, faces: mesh.faces.length }

    const result = runOperator('mesh.polyBuild', context, { action: 'extend', kind: 'edge', slot: 0, point: [0, 3, 0] })

    const after = resultEdit(result)
    expect(after.vertexCount).toBe(before.vertices + 1)
    expect(after.faceCount).toBe(before.faces + 1)
    expect(isWellFormed(after)).toBe(true)
    // Two faces on one edge agree when they cross it in opposite directions.
    const edge = after.edgeSlot(...(after.edgeVertices(0) as [number, number]))
    const faces = after.edgeFaces(edge)
    expect(faces).toHaveLength(2)
    const directed = new Set<string>()
    for (const face of faces) {
      const loop = after.faceVertices(face)
      for (let index = 0; index < loop.length; index += 1) directed.add(`${loop[index]}>${loop[(index + 1) % loop.length]}`)
    }
    const [a, b] = after.edgeVertices(edge)
    expect(directed.has(`${a}>${b}`) && directed.has(`${b}>${a}`)).toBe(true)
    expect(resultSelection(result).faces).toHaveLength(1)
  })

  it('refuses an edge that already has faces on both sides, and says why', () => {
    const mesh = planeMesh(2)
    const context = editContext({ mesh, selectMode: ['edge'] })
    const pulled = runOperator('mesh.polyBuild', context, { action: 'extend', kind: 'edge', slot: 0, point: [0, 3, 0] })
    const twice = editContext({ mesh: pulled.document!.meshes['mesh-under-test']!, selectMode: ['edge'] })

    const result = runOperator('mesh.polyBuild', twice, { action: 'extend', kind: 'edge', slot: 0, point: [0, 5, 0] })

    expect(result.error).toBe('Poly build pulls a face out of a border edge; this one already has faces on both sides.')
    expect(result.document).toBeUndefined()
  })

  it('draws an edge out of a vertex, and a lone vertex out of nothing', () => {
    const mesh = planeMesh(2)
    const fromVertex = runOperator(
      'mesh.polyBuild',
      editContext({ mesh }),
      { action: 'extend', kind: 'vertex', slot: 0, point: [4, 0, 0] },
    )
    const drawn = resultEdit(fromVertex)
    expect(drawn.vertexCount).toBe(5)
    expect(drawn.edgeCount).toBe(5)

    const fromNothing = runOperator('mesh.polyBuild', editContext({ mesh }), { action: 'add', point: [7, 7, 0] })
    const placed = resultEdit(fromNothing)
    expect(placed.vertexCount).toBe(5)
    expect(placed.position(4)).toEqual([7, 7, 0])
    expect(resultSelection(fromNothing).vertices).toHaveLength(1)
  })

  it('takes an element away, and dissolves one into its neighbours', () => {
    const mesh = planeMesh(2)
    const removed = runOperator(
      'mesh.polyBuild',
      editContext({ mesh, selectMode: ['face'] }),
      { action: 'delete', kind: 'face', slot: 0, point: [0, 0, 0] },
    )
    expect(resultEdit(removed).faceCount).toBe(0)

    // A vertex in the middle of a subdivided plane dissolves into the fan around it.
    const grid = runOperator(
      'mesh.polyBuild',
      editContext({ mesh, selectMode: ['edge'] }),
      { action: 'extend', kind: 'edge', slot: 0, point: [0, 3, 0] },
    )
    const built = grid.document!.meshes['mesh-under-test']!
    const dissolved = runOperator(
      'mesh.polyBuild',
      editContext({ mesh: built, selectMode: ['edge'] }),
      { action: 'dissolve', kind: 'edge', slot: 0, point: [0, 0, 0] },
    )
    const after = resultEdit(dissolved)
    expect(after.faceCount).toBe(1)
    expect(isWellFormed(after)).toBe(true)
  })

  it('says what it cannot do rather than doing nothing quietly', () => {
    const context = editContext({ mesh: planeMesh(2) })
    expect(runOperator('mesh.polyBuild', context, { action: 'delete', kind: 'none', slot: -1 }).error)
      .toBe('Put the pointer over something to take away.')
    expect(runOperator('mesh.polyBuild', context, { action: 'extend', kind: 'edge', slot: 99 }).error)
      .toBe('That edge is no longer there.')
  })

  it('replays from the panel with another point', () => {
    const mesh = planeMesh(2)
    const context = editContext({ mesh, selectMode: ['edge'] })
    const first = runOperator('mesh.polyBuild', context, { action: 'extend', kind: 'edge', slot: 0, point: [0, 3, 0] })
    const again = runOperator('mesh.polyBuild', context, { action: 'extend', kind: 'edge', slot: 0, point: [0, 9, 0] })

    expect(resultEdit(first).position(4)).toEqual([0, 3, 0])
    expect(resultEdit(again).position(4)).toEqual([0, 9, 0])
    void edgeKey
  })
})
