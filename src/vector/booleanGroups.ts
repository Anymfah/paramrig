import { booleanOperation, type BooleanOperation, type GeometryResult } from '@/vector/booleans'
import { createLruCache } from '@/vector/cache'
import { childrenOf } from '@/vector/tree'
import type { VectorElement } from '@/vector/types'

const CACHE_SIZE = 60
const results = createLruCache<GeometryResult | null>(CACHE_SIZE)

export const BOOLEAN_OPERATIONS: BooleanOperation[] = ['unite', 'subtract', 'intersect', 'exclude']

export function booleanLabel(operation: BooleanOperation): string {
  return operation === 'unite' ? 'Union' : operation === 'subtract' ? 'Subtract' : operation === 'intersect' ? 'Intersect' : 'Exclude'
}

/** What a boolean group is made of: its operation and the geometry of the shapes under it. */
export function booleanFingerprint(operation: BooleanOperation, children: VectorElement[]): string {
  return `${operation}|${children.map((child) => JSON.stringify([
    child.id, child.kind, child.x, child.y, child.width, child.height, child.rotation,
    child.network, child.sides, child.innerRatio, child.arcStart, child.arcSweep, child.arcRatio,
    child.cornerRadius, child.visible,
  ])).join(';')}`
}

/** The shapes a boolean group combines, bottom first, ignoring the ones switched off. */
export function booleanMembers(elements: VectorElement[], groupId: string): VectorElement[] {
  return childrenOf(elements, groupId).filter((child) => child.kind !== 'group' && child.visible)
}

/**
 * Keeps every boolean group's own geometry in step with the shapes under it. The result is cached
 * by fingerprint, so an edit somewhere else in the document costs a lookup.
 */
export function syncBooleanGroups(elements: VectorElement[]): VectorElement[] {
  if (!elements.some((element) => element.kind === 'boolean')) return elements
  let changed = false
  const next = elements.map((element) => {
    if (element.kind !== 'boolean') return element
    const operation = element.operation ?? 'unite'
    const members = booleanMembers(elements, element.id)
    if (members.length < 2) return element
    const key = booleanFingerprint(operation, members)
    let result = results.get(key)
    if (result === undefined) {
      result = booleanOperation(operation, members)
      results.set(key, result)
    }
    if (!result) return element
    if (sameGeometry(element, result)) return element
    changed = true
    return { ...element, x: result.x, y: result.y, width: result.width, height: result.height, network: result.network }
  })
  return changed ? next : elements
}

function sameGeometry(element: VectorElement, result: GeometryResult): boolean {
  return element.x === result.x && element.y === result.y && element.width === result.width && element.height === result.height
    && JSON.stringify(element.network) === JSON.stringify(result.network)
}

/** Forgets the cached results, for tests. */
export function resetBooleanCache(): void {
  results.clear()
}

/** The mask of a group: its bottom child, when that child is marked as one. */
export function maskOf(elements: VectorElement[], groupId: string): VectorElement | null {
  const children = childrenOf(elements, groupId)
  const first = children[0]
  return first?.mask ? first : null
}

/** Turns the bottom of a selection into a mask, or gives it back. */
export function maskPatch(elements: VectorElement[], ids: string[]): Array<{ id: string; patch: Partial<VectorElement> }> {
  const members = elements.filter((element) => ids.includes(element.id))
  if (members.length === 0) return []
  const parents = new Set(members.map((element) => element.parentId ?? null))
  if (parents.size !== 1) return []
  const siblings = childrenOf(elements, [...parents][0]!)
  const bottom = siblings.find((element) => members.some((member) => member.id === element.id))
  if (!bottom) return []
  return [{ id: bottom.id, patch: { mask: bottom.mask ? undefined : true } }]
}
