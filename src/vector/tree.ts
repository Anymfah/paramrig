import { selectionBounds } from '@/vector/geometry'
import type { VectorElement } from '@/vector/types'

export type TreeNode = { element: VectorElement; children: TreeNode[]; depth: number }

/** Kinds that hold children through `parentId`: groups, which hug their content, and frames, which keep their own box. */
export function isContainer(element: Pick<VectorElement, 'kind'>): boolean {
  return element.kind === 'group' || element.kind === 'frame' || element.kind === 'boolean' || element.kind === 'component' || element.kind === 'instance'
}

export type LayerRow = {
  element: VectorElement
  depth: number
  parentId: string | null
  hasChildren: boolean
  collapsed: boolean
}

/** Nested view of the flat list. Siblings keep array (paint) order. */
export function buildTree(elements: VectorElement[], parentId: string | null = null, depth = 0): TreeNode[] {
  return elements
    .filter((element) => (element.parentId ?? null) === parentId)
    .map((element) => ({
      element,
      depth,
      children: isContainer(element) ? buildTree(elements, element.id, depth + 1) : [],
    }))
}

export function childrenOf(elements: VectorElement[], parentId: string | null): VectorElement[] {
  return elements.filter((element) => (element.parentId ?? null) === parentId)
}

export function descendantIds(elements: VectorElement[], id: string): string[] {
  const result: string[] = []
  const stack = [id]
  while (stack.length) {
    const current = stack.pop()!
    for (const element of elements) {
      if (element.parentId === current) {
        result.push(element.id)
        if (isContainer(element)) stack.push(element.id)
      }
    }
  }
  return result
}

export function ancestorIds(elements: VectorElement[], id: string): string[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const result: string[] = []
  let current = byId.get(id)?.parentId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    result.push(current)
    current = byId.get(current)?.parentId
  }
  return result
}

/**
 * Elements a selection actually acts on: a group expands to its descendants, a frame expands to
 * its descendants and stays in the set itself because it has a box and a background of its own.
 */
export function leafElements(elements: VectorElement[], ids: string[]): VectorElement[] {
  const wanted = new Set<string>()
  for (const id of ids) {
    const element = elements.find((item) => item.id === id)
    if (!element) continue
    if (element.kind === 'boolean') {
      // A boolean group paints its own combined shape; its members are the recipe, not the result.
      wanted.add(id)
    } else if (isContainer(element)) {
      if (element.kind === 'frame') wanted.add(id)
      for (const descendant of descendantIds(elements, id)) wanted.add(descendant)
    } else {
      wanted.add(id)
    }
  }
  return elements.filter((element) => wanted.has(element.id) && element.kind !== 'group')
}

/**
 * Elements a move or a transform should actually write to. A boolean group's own box is derived
 * from its members, so a transform has to reach the members instead of the group.
 */
export function transformLeaves(elements: VectorElement[], ids: string[]): VectorElement[] {
  const wanted = new Set<string>()
  const visit = (id: string) => {
    const element = elements.find((item) => item.id === id)
    if (!element) return
    if (element.kind === 'boolean' || element.kind === 'group') {
      for (const child of childrenOf(elements, id)) visit(child.id)
      return
    }
    // An instance is placed by its own box: its copies are rebuilt from it, not moved with it.
    if (element.kind === 'instance') {
      wanted.add(id)
      return
    }
    if (element.kind === 'frame') {
      wanted.add(id)
      for (const child of childrenOf(elements, id)) visit(child.id)
      return
    }
    wanted.add(id)
  }
  for (const id of ids) visit(id)
  return elements.filter((element) => wanted.has(element.id))
}

/**
 * Which element a click on `hitId` selects: the outermost ancestor below the entered group,
 * or the leaf itself when `deepest` is set.
 */
export function resolveSelection(elements: VectorElement[], hitId: string, enteredGroupId: string | null, deepest = false): string {
  if (deepest) return hitId
  const chain = [hitId, ...ancestorIds(elements, hitId)]
  if (enteredGroupId) {
    const index = chain.indexOf(enteredGroupId)
    if (index > 0) return chain[index - 1]!
    if (index === 0) return hitId
  }
  return chain[chain.length - 1]!
}

/** Drops parent references that point to missing elements, non-groups, or form a cycle, then restores contiguity. */
export function sanitizeParents(elements: VectorElement[]): VectorElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const cleaned = elements.map((element) => {
    if (!element.parentId) return stripParent(element)
    const parent = byId.get(element.parentId)
    if (!parent || !isContainer(parent) || parent.id === element.id) return stripParent(element)
    const seen = new Set<string>([element.id])
    let cursor: VectorElement | undefined = parent
    while (cursor) {
      if (seen.has(cursor.id)) return stripParent(element)
      seen.add(cursor.id)
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
    return element
  })
  // A group with nothing in it is meaningless; an empty frame is a perfectly good artboard.
  const withoutEmptyGroups = cleaned.filter((element) => element.kind !== 'group' || cleaned.some((child) => child.parentId === element.id))
  const stillValid = withoutEmptyGroups.length === cleaned.length ? withoutEmptyGroups : sanitizeParents(withoutEmptyGroups)
  return syncGroupBounds(flattenTree(buildTree(stillValid)))
}

function stripParent(element: VectorElement): VectorElement {
  if (!element.parentId) return element
  const { parentId: _parentId, ...rest } = element
  return rest
}

/** Serialises a tree back to the flat list, children before their group. */
export function flattenTree(nodes: TreeNode[]): VectorElement[] {
  return nodes.flatMap((node) => [...flattenTree(node.children), node.element])
}

/** Recomputes every group's cached box from its leaves. Groups never rotate. */
export function syncGroupBounds(elements: VectorElement[]): VectorElement[] {
  if (!elements.some((element) => element.kind === 'group')) return elements
  const next = [...elements]
  const compute = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.element.kind !== 'group') continue
      compute(node.children)
      const leaves = leafElements(next, [node.element.id])
      const bounds = leaves.length ? selectionBounds(leaves) : { x: node.element.x, y: node.element.y, width: 1, height: 1 }
      const index = next.findIndex((element) => element.id === node.element.id)
      const current = next[index]!
      if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height || current.rotation !== 0) {
        next[index] = { ...current, x: round(bounds.x), y: round(bounds.y), width: Math.max(1, round(bounds.width)), height: Math.max(1, round(bounds.height)), rotation: 0 }
      }
    }
  }
  compute(buildTree(next))
  return next
}

/** Rows for the layers panel: top of the stack first, groups expanded unless collapsed. */
export function flattenForLayers(elements: VectorElement[], collapsed: ReadonlySet<string>): LayerRow[] {
  const rows: LayerRow[] = []
  const visit = (nodes: TreeNode[], parentId: string | null) => {
    for (const node of [...nodes].reverse()) {
      const isCollapsed = collapsed.has(node.element.id)
      rows.push({ element: node.element, depth: node.depth, parentId, hasChildren: node.children.length > 0, collapsed: isCollapsed })
      if (!isCollapsed) visit(node.children, node.element.id)
    }
  }
  visit(buildTree(elements), null)
  return rows
}

/** Wraps `ids` in `group`, inserted where the topmost member sat under the common parent. */
export function groupElements(elements: VectorElement[], ids: string[], group: VectorElement): VectorElement[] {
  const members = elements.filter((element) => ids.includes(element.id))
  if (members.length === 0) return elements
  const parentIds = new Set(members.map((element) => element.parentId ?? null))
  const parentId = parentIds.size === 1 ? [...parentIds][0]! : commonParent(elements, members)
  const memberIds = new Set(members.map((element) => element.id))
  const moved = new Set([...memberIds, ...members.flatMap((element) => descendantIds(elements, element.id))])
  const topIndex = Math.max(...members.map((element) => elements.findIndex((item) => item.id === element.id)))
  // The caller decides what kind of container this is: a plain group, or a boolean one.
  const grouped: VectorElement = { ...group, rotation: 0, ...(parentId ? { parentId } : {}) }
  const block = elements.filter((element) => moved.has(element.id)).map((element) => memberIds.has(element.id) ? { ...element, parentId: grouped.id } : element)
  const rest = elements.filter((element) => !moved.has(element.id))
  const insertAt = rest.findIndex((element) => elements.indexOf(element) > topIndex)
  const at = insertAt < 0 ? rest.length : insertAt
  const result = [...rest.slice(0, at), ...block, grouped, ...rest.slice(at)]
  return syncGroupBounds(result)
}

function commonParent(elements: VectorElement[], members: VectorElement[]): string | null {
  const chains = members.map((element) => ancestorIds(elements, element.id))
  const first = chains[0] ?? []
  for (const candidate of first) {
    if (chains.every((chain) => chain.includes(candidate))) return candidate
  }
  return null
}

/** Removes a group, lifting its children to the group's parent at the group's position. */
export function ungroupElements(elements: VectorElement[], groupId: string): VectorElement[] {
  const group = elements.find((element) => element.id === groupId)
  if (!group || group.kind !== 'group') return elements
  const lifted = elements
    .filter((element) => element.id !== groupId)
    .map((element) => element.parentId === groupId ? (group.parentId ? { ...element, parentId: group.parentId } : stripParent(element)) : element)
  return syncGroupBounds(lifted)
}

/** Ids of the group's direct children, in paint order. */
export function directChildIds(elements: VectorElement[], groupId: string): string[] {
  return elements.filter((element) => element.parentId === groupId).map((element) => element.id)
}

/**
 * Moves an element (with its descendants) under `parentId` at sibling `index` (paint order, 0 = back).
 * Returns the input when the target is the element itself or one of its descendants.
 */
export function moveInTree(elements: VectorElement[], id: string, target: { parentId: string | null; index: number }): VectorElement[] {
  const element = elements.find((item) => item.id === id)
  if (!element) return elements
  if (target.parentId === id || (target.parentId && descendantIds(elements, id).includes(target.parentId))) return elements
  const parent = target.parentId ? elements.find((item) => item.id === target.parentId) : null
  if (target.parentId && (!parent || !isContainer(parent))) return elements
  const movedIds = new Set([id, ...descendantIds(elements, id)])
  const block = elements.filter((item) => movedIds.has(item.id)).map((item) => item.id === id
    ? (target.parentId ? { ...item, parentId: target.parentId } : stripParent(item))
    : item)
  const rest = elements.filter((item) => !movedIds.has(item.id))
  const siblings = rest.filter((item) => (item.parentId ?? null) === target.parentId)
  const clamped = Math.max(0, Math.min(siblings.length, target.index))
  let at: number
  if (clamped >= siblings.length) {
    const lastSibling = siblings[siblings.length - 1]
    at = lastSibling ? rest.indexOf(lastSibling) + 1 : (target.parentId ? rest.findIndex((item) => item.id === target.parentId) : 0)
    if (!lastSibling && !target.parentId) at = 0
  } else {
    const sibling = siblings[clamped]!
    const siblingBlock = new Set([sibling.id, ...descendantIds(rest, sibling.id)])
    at = rest.findIndex((item) => siblingBlock.has(item.id))
  }
  const result = [...rest.slice(0, at), ...block, ...rest.slice(at)]
  return syncGroupBounds(result)
}

/** Position of an element among its siblings (paint order). */
export function siblingIndex(elements: VectorElement[], id: string): number {
  const element = elements.find((item) => item.id === id)
  if (!element) return -1
  return childrenOf(elements, element.parentId ?? null).findIndex((item) => item.id === id)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
