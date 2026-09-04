import { describe, expect, it } from 'vitest'
import { BufferAttribute } from 'three'
import { activeUv, withActiveUv } from '@/scene/mesh/uv'
import { boxMesh } from '@/scene/mesh/primitives'
import { buildMeshView, meshViewIsCurrent, updateMeshPositions } from '@/scene/viewport/meshView'

/**
 * The drawn geometry against the mesh it was drawn from.
 *
 * The question this answers is the one the viewport asks on every change to the document: is what
 * is on the card still what is in the document? It has to be cheap, so it is asked by identity —
 * and identity only works if the view records what it was given every time it is given something.
 */

describe('the drawn mesh', () => {
  it('writes the map it is built with into the geometry', () => {
    const mesh = boxMesh(2)
    const view = buildMeshView(mesh)
    const uv = view.geometry.getAttribute('uv') as BufferAttribute
    expect(uv.count).toBe(view.triangleCount * 3)
    // Every corner of a cube's face is a corner of the image, so the numbers are noughts and ones.
    expect([...(uv.array as Float32Array)].every((value) => value === 0 || value === 1)).toBe(true)
    view.dispose()
  })

  it('notices a new map, and stops noticing it once it has drawn it', () => {
    const mesh = boxMesh(2)
    const view = buildMeshView(mesh)
    expect(meshViewIsCurrent(view, mesh)).toBe(true)
    const changed = withActiveUv(mesh, activeUv(mesh)!.map((value) => value * 0.5))
    expect(meshViewIsCurrent(view, changed)).toBe(false)
    updateMeshPositions(view, changed)
    /*
     * The heart of it. Before this was recorded the view said "not mine" for ever after the first
     * change, so every later edit to the document rewrote every attribute of every mesh and rebuilt
     * its bounding tree — the cost of a whole mesh for a light being moved.
     */
    expect(meshViewIsCurrent(view, changed)).toBe(true)
    const uv = view.geometry.getAttribute('uv') as BufferAttribute
    expect(Math.max(...(uv.array as Float32Array))).toBeCloseTo(0.5, 6)
    view.dispose()
  })
})
