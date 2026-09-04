import { describe, expect, it } from 'vitest'
import { gridMesh } from '@/scene/mesh/primitives'
import { lscmUnwrap } from '@/scene/uv/lscm'
import { islandsFromSeams } from '@/scene/uv/islands'
import { meshCounts } from '@/scene/mesh/data'

/**
 * What unwrapping a mesh nobody would call small actually costs.
 *
 * The plan asks for a figure on twenty thousand faces, and the honest place to take it is here
 * rather than in the browser: the solver is arithmetic with no browser in it, and a number measured
 * through a page tells you about the page. The check guards the order of magnitude — a machine's
 * own speed moves it — and the line above says what it really cost, every time.
 */

describe('the cost of unwrapping', () => {
  it('flattens a twenty-thousand-face mesh in the order of a second', () => {
    // 141 × 141 quads: 19,600 faces, which is the size the plan names.
    const mesh = gridMesh({ xSubdivisions: 141, ySubdivisions: 141, size: 4 })
    const counts = meshCounts(mesh)
    expect(counts.faces).toBeGreaterThan(19_000)

    // No seams: one island, which is the hardest single solve the mesh can offer.
    const islands = islandsFromSeams(mesh)
    const started = performance.now()
    const uv = lscmUnwrap(mesh, islands[0]!)
    const took = performance.now() - started
    console.log(`MEASURE unwrap of ${counts.faces.toLocaleString()} faces: ${took.toFixed(0)} ms, ${islands.length} island${islands.length === 1 ? '' : 's'}`)
    expect(uv).not.toBeNull()
    expect(took).toBeLessThan(8000)
  })
})
