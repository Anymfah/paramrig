/**
 * The two rules a cable obeys, taken from Prismorphic's `nodeGraphConnections.ts`.
 *
 * An input takes one cable, so a second replaces the first rather than joining it — otherwise a
 * socket would have two answers and the compiler would have to choose. And a graph is acyclic,
 * because a node that feeds itself has no value: the cycle is found before the edge is made rather
 * than after, so the refusal can say what it refused.
 *
 * It is copied rather than imported: the vendored engine is the scene's, and this belongs to the
 * generic editor, which has never heard of a shader.
 */

export type ConnectionEdge = {
  id: string
  fromNode: string
  fromPort: string
  toNode: string
  toPort: string
}

export type ReplaceResult<T extends ConnectionEdge> =
  | { ok: true; changed: boolean; edges: T[] }
  | { ok: false; reason: 'self' | 'cycle'; edges: T[] }

/** Whether joining these two would close a loop: is `fromNode` already downstream of `toNode`? */
export function createsCycle(edges: readonly ConnectionEdge[], fromNode: string, toNode: string): boolean {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = adjacency.get(edge.fromNode)
    if (targets) targets.push(edge.toNode)
    else adjacency.set(edge.fromNode, [edge.toNode])
  }
  const pending = [toNode]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    if (current === fromNode) return true
    visited.add(current)
    pending.push(...(adjacency.get(current) ?? []))
  }
  return false
}

/** The edges with this one in them, the cable it displaces taken out — or a refusal with the reason. */
export function replaceNodeInputConnection<T extends ConnectionEdge>(edges: readonly T[], next: T): ReplaceResult<T> {
  if (next.fromNode === next.toNode) return { ok: false, reason: 'self', edges: [...edges] }
  const existing = edges.find((edge) => edge.toNode === next.toNode && edge.toPort === next.toPort)
  if (existing?.id === next.id) return { ok: true, changed: false, edges: [...edges] }
  const remaining = edges.filter((edge) => !(edge.toNode === next.toNode && edge.toPort === next.toPort))
  if (createsCycle(remaining, next.fromNode, next.toNode)) return { ok: false, reason: 'cycle', edges: [...edges] }
  return { ok: true, changed: true, edges: [...remaining, next] }
}
