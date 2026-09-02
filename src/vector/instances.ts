import { selectionBounds } from '@/vector/geometry'
import { scaleElementsToBounds } from '@/vector/transform'
import { childrenOf, descendantIds } from '@/vector/tree'
import type { VectorElement } from '@/vector/types'

/** What an instance is allowed to change about a copied child. Everything else follows the master. */
export const OVERRIDE_KEYS = ['fill', 'fills', 'stroke', 'strokes', 'strokeWidth', 'text', 'visible', 'effects', 'blendMode'] as const

export type Override = Partial<Pick<VectorElement, (typeof OVERRIDE_KEYS)[number]>>

const PREFIX = 'inst'

/** The id a copied child carries: derived, so the same child keeps the same id across syncs. */
export function instanceChildId(instanceId: string, childId: string): string {
  return `${PREFIX}:${instanceId}:${childId}`
}

export function isInstanceChild(id: string): boolean {
  return id.startsWith(`${PREFIX}:`)
}

/** The child of the master an instance's copy came from. */
export function masterChildId(instanceId: string, id: string): string | null {
  const head = `${PREFIX}:${instanceId}:`
  return id.startsWith(head) ? id.slice(head.length) : null
}

/** The master's own subtree, in the order it is painted. */
export function componentSubtree(elements: VectorElement[], componentId: string): VectorElement[] {
  const wanted = new Set(descendantIds(elements, componentId))
  return elements.filter((element) => wanted.has(element.id))
}

/** The difference between a copy and what the master says it should be, limited to what may differ. */
export function overrideBetween(expected: VectorElement, actual: VectorElement): Override | null {
  const override: Override = {}
  let changed = false
  for (const key of OVERRIDE_KEYS) {
    if (JSON.stringify(expected[key]) === JSON.stringify(actual[key])) continue
    Object.assign(override, { [key]: structuredClone(actual[key]) })
    changed = true
  }
  return changed ? override : null
}

/**
 * Rebuilds every instance from its master.
 *
 * An instance carries no children of its own in the file: they are copied from the master on every
 * edit, placed by mapping the master's box onto the instance's, and given ids derived from both,
 * so a copy keeps its identity between syncs. Anything the user changed on a copy is read back as
 * an override before the copies are rebuilt — which is what makes editing inside an instance work
 * without a special path: the edit lands on the copy, and the next sync turns it into an override.
 *
 * An instance whose master is gone keeps the copies it has, detached, rather than emptying itself.
 */
export function syncInstances(elements: VectorElement[]): VectorElement[] {
  const instances = elements.filter((element) => element.kind === 'instance' && element.componentId)
  if (instances.length === 0) return elements
  let next = elements
  let changed = false
  for (const instance of instances) {
    const master = next.find((element) => element.id === instance.componentId && element.kind === 'component')
    if (!master) {
      const detached = detachInstance(next, instance.id)
      if (detached !== next) { next = detached; changed = true }
      continue
    }
    const rebuilt = rebuild(next, instance, master)
    if (rebuilt !== next) { next = rebuilt; changed = true }
  }
  return changed ? next : elements
}

function rebuild(elements: VectorElement[], instance: VectorElement, master: VectorElement): VectorElement[] {
  const source = componentSubtree(elements, master.id)
  const existing = elements.filter((element) => masterChildId(instance.id, element.id) !== null)
  const masterBounds = selectionBounds([master])
  const instanceBounds = { x: instance.x, y: instance.y, width: instance.width, height: instance.height }
  const placed = scaleElementsToBounds(source, masterBounds, instanceBounds)
  const byId = new Map(placed.map((patch) => [patch.id, patch.patch]))
  const overrides = instance.overrides ?? {}
  const children = source.map((child): VectorElement => applyOverride({
    ...structuredClone(child),
    ...byId.get(child.id),
    id: instanceChildId(instance.id, child.id),
    parentId: child.parentId === master.id ? instance.id : instanceChildId(instance.id, child.parentId!),
  }, overrides[child.id]))

  const same = existing.length === children.length
    && children.every((child, index) => JSON.stringify(child) === JSON.stringify(existing[index]))
  if (same) return elements

  const without = elements.filter((element) => masterChildId(instance.id, element.id) === null)
  const at = without.findIndex((element) => element.id === instance.id)
  if (at < 0) return elements
  return [...without.slice(0, at), ...children, instance, ...without.slice(at + 1)]
}

/**
 * An edit aimed at one of an instance's copies, turned into an override on the instance.
 *
 * This is where an edit inside an instance is caught: at the moment it is made, rather than by
 * comparing copies to the master afterwards — which cannot tell "the user painted this copy" from
 * "the master changed underneath it".
 */
export function overrideUpdate(
  elements: VectorElement[],
  childId: string,
  patch: Partial<VectorElement>,
): { id: string; patch: Partial<VectorElement> } | null {
  const instance = owningInstance(elements, childId)
  if (!instance) return null
  const key = masterChildId(instance.id, childId)
  if (!key) return null
  const override: Override = {}
  for (const property of OVERRIDE_KEYS) {
    if (patch[property] === undefined) continue
    Object.assign(override, { [property]: structuredClone(patch[property]) })
  }
  // Anything else — moving a copy, resizing it — is not something an instance can remember.
  if (Object.keys(override).length === 0) return { id: instance.id, patch: {} }
  return {
    id: instance.id,
    patch: { overrides: { ...(instance.overrides ?? {}), [key]: { ...(instance.overrides?.[key] ?? {}), ...override } } },
  }
}

function applyOverride(element: VectorElement, override: Override | undefined): VectorElement {
  if (!override) return element
  const patch: Override = {}
  for (const key of OVERRIDE_KEYS) {
    if (override[key] === undefined) continue
    Object.assign(patch, { [key]: structuredClone(override[key]) })
  }
  return { ...element, ...patch }
}

/** Turns an instance into a plain group: the copies stay, with ids of their own, and stop following. */
export function detachInstance(elements: VectorElement[], instanceId: string): VectorElement[] {
  const instance = elements.find((element) => element.id === instanceId)
  if (!instance || instance.kind !== 'instance') return elements
  const renamed = new Map<string, string>()
  for (const element of elements) {
    const key = masterChildId(instanceId, element.id)
    if (key) renamed.set(element.id, `${instanceId}-${key}`)
  }
  return elements.map((element) => {
    if (element.id === instanceId) {
      const { componentId: _componentId, overrides: _overrides, ...rest } = element
      return { ...rest, kind: 'group' as const }
    }
    if (!renamed.has(element.id)) return element
    return {
      ...element,
      id: renamed.get(element.id)!,
      ...(element.parentId && renamed.has(element.parentId) ? { parentId: renamed.get(element.parentId)! } : {}),
    }
  })
}

/** Forgets every override on an instance, so it goes back to what its master says. */
export function resetOverrides(elements: VectorElement[], instanceId: string): VectorElement[] {
  return elements.map((element) => element.id === instanceId && element.kind === 'instance'
    ? { ...element, overrides: undefined }
    : element)
}

/** A component made out of what is selected: the objects move inside it, and it keeps their box. */
export function componentFrom(elements: VectorElement[], ids: string[], id: string, name: string): { elements: VectorElement[]; componentId: string } | null {
  const members = elements.filter((element) => ids.includes(element.id))
  if (members.length === 0) return null
  const bounds = selectionBounds(members)
  const component: VectorElement = {
    id,
    kind: 'component',
    name,
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    rotation: 0,
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    opacity: 1,
    visible: true,
    locked: false,
    ...(members[0]?.parentId ? { parentId: members[0].parentId } : {}),
  }
  const last = Math.max(...members.map((member) => elements.findIndex((element) => element.id === member.id)))
  const next = elements.map((element) => ids.includes(element.id) ? { ...element, parentId: id } : element)
  return { elements: [...next.slice(0, last + 1), component, ...next.slice(last + 1)], componentId: id }
}

/** An instance of a component, dropped at a point, at the master's own size. */
export function instanceOf(master: VectorElement, id: string, at: { x: number; y: number }): VectorElement {
  return {
    id,
    kind: 'instance',
    componentId: master.id,
    name: master.name,
    x: Math.round(at.x - master.width / 2),
    y: Math.round(at.y - master.height / 2),
    width: master.width,
    height: master.height,
    rotation: 0,
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    opacity: 1,
    visible: true,
    locked: false,
  }
}

/** Every component in the document, for the assets list. */
export function componentsOf(elements: VectorElement[]): VectorElement[] {
  return elements.filter((element) => element.kind === 'component')
}

/** How many instances follow a component. */
export function instanceCount(elements: VectorElement[], componentId: string): number {
  return elements.filter((element) => element.kind === 'instance' && element.componentId === componentId).length
}

/** The instance an element belongs to, if it is one of its copies. */
export function owningInstance(elements: VectorElement[], id: string): VectorElement | null {
  if (!isInstanceChild(id)) return null
  const parts = id.split(':')
  const instanceId = parts[1]
  return elements.find((element) => element.id === instanceId && element.kind === 'instance') ?? null
}

export { childrenOf }
