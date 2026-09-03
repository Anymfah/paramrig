import type { EditMesh } from '@/scene/mesh/editMesh'
import { chosenOf, numberOf, registerModifier } from '@/scene/modifiers/types'
import { weldVertices, withinDistance, type WeldCluster } from '@/scene/operators/merge'
import { numberParam, selectParam } from '@/scene/operators/types'

/**
 * Weld: every vertex that lands within a distance of another becomes one vertex.
 *
 * The rewiring is `weldVertices` from `operators/merge.ts` — the same weld the Merge menu runs, so
 * a seam closed by the modifier and a seam closed by hand leave the same mesh, with the same faces
 * dropped and the same edge flags carried across. Only the choosing is done here.
 *
 * The two modes choose differently, and that is the whole of the difference between them. “All”
 * asks the question of the whole mesh through the grid search in `merge.ts`: any two vertices near
 * enough weld, whether or not the mesh already joined them, which is what closes the seam a mirror
 * or an array leaves behind. “Connected” only ever welds along an edge, so a short edge collapses
 * and two sheets lying on top of each other are left alone — the safe one to leave switched on
 * while a shape is still being pushed about.
 *
 * A survivor keeps its own position rather than moving to the middle of its group, because a weld
 * meant to close a seam should never move the seam.
 */

const NO_VERTICES = 'Weld needs vertices; this mesh has none.'

/** Blender’s own default: a millimetre, small enough to close a seam and not a shape. */
const DEFAULT_DISTANCE = 0.001

const MODES = ['all', 'connected'] as const

type WeldParams = {
  distance: number
  mode: string
}

/**
 * The groups an edge short enough to disappear ties together, as welds.
 *
 * Connected mode is a union along the edges rather than through space: two vertices weld only when
 * the mesh already joins them, so a run of short edges collapses to one vertex and a doubled corner
 * that nothing joins survives.
 */
function alongEdges(mesh: EditMesh, distance: number): WeldCluster[] {
  const parent = new Int32Array(mesh.vertexCount)
  for (let slot = 0; slot < parent.length; slot += 1) parent[slot] = slot
  const find = (slot: number): number => {
    let root = slot
    while (parent[root]! !== root) root = parent[root]!
    let walk = slot
    while (parent[walk]! !== walk) {
      const next = parent[walk]!
      parent[walk] = root
      walk = next
    }
    return root
  }
  for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
    if (mesh.edgeLength(edge) > distance) continue
    const [a, b] = mesh.edgeVertices(edge)
    if (a < 0 || b < 0) continue
    const rootA = find(a)
    const rootB = find(b)
    // The lowest slot wins, so the survivor of a run is the one the mesh had first.
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB)
  }
  const groups = new Map<number, number[]>()
  for (let slot = 0; slot < parent.length; slot += 1) {
    const root = find(slot)
    const group = groups.get(root)
    if (group) group.push(slot)
    else groups.set(root, [slot])
  }
  const clusters: WeldCluster[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const keep = group[0]!
    clusters.push({ keep, drop: group.filter((slot) => slot !== keep) })
  }
  return clusters
}

registerModifier<WeldParams>({
  kind: 'weld',
  label: 'Weld',
  category: 'generate',
  description: 'Merge every vertex that lands within the distance of another into one.',
  defaults: { distance: DEFAULT_DISTANCE, mode: 'all' },
  schema: [
    numberParam('distance', 'Distance', { min: 0, max: 10, step: 0.0001, defaultValue: DEFAULT_DISTANCE, unit: 'm' }),
    selectParam('mode', 'Mode', [
      { value: 'all', label: 'All' },
      { value: 'connected', label: 'Connected' },
    ], 'all'),
  ],
  apply: (mesh, params) => {
    if (mesh.vertexCount === 0) return NO_VERTICES
    const distance = numberOf(params.distance, DEFAULT_DISTANCE, 0, 1e6)
    const mode = chosenOf(params.mode, MODES, 'all')

    let clusters: WeldCluster[]
    if (mode === 'connected') clusters = alongEdges(mesh, distance)
    else {
      const everyone = new Set<number>()
      for (let slot = 0; slot < mesh.vertexCount; slot += 1) everyone.add(slot)
      clusters = withinDistance(mesh, everyone, distance, false)
    }
    // Nothing near enough is not a mistake: a weld left on a clean mesh is meant to be a no-op.
    if (clusters.length === 0) return undefined
    weldVertices(mesh, clusters)
    return undefined
  },
})
