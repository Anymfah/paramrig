import type { EditorCommand } from '@/editor/commands'
import type { Affine } from '@/vector/affine'
import type { Bounds } from '@/vector/geometry'
import { childrenOf, siblingIndex } from '@/vector/tree'
import type { VectorElement } from '@/vector/types'

/** Everything a command needs to show itself: the palette, the context menu and tooltips share it. */
export type VectorCommand = EditorCommand

export { filterCommands } from '@/editor/commands'

/** Shortcut labels, in one place so a tooltip and the palette can never disagree. */
export const SHORTCUTS = {
  undo: '⌘Z',
  redo: '⇧⌘Z',
  duplicate: '⌘D',
  transform: '⌘⇧T',
  selectAll: '⌘A',
  group: '⌘G',
  createComponent: '⌥⌘K',
  detachInstance: '⌥⌘B',
  ungroup: '⇧⌘G',
  delete: '⌫',
  copy: '⌘C',
  cut: '⌘X',
  paste: '⌘V',
  copyProperties: '⌥⌘C',
  pasteProperties: '⌥⌘V',
  pasteToReplace: '⇧⌘R',
  bringForward: '⌘]',
  sendBackward: '⌘[',
  bringToFront: '⌥⌘]',
  sendToBack: '⌥⌘[',
  nextSibling: 'Tab',
  previousSibling: '⇧Tab',
  enter: '↵',
  leave: '⇧↵',
  lock: '⇧⌘L',
  hide: '⇧⌘H',
  flipHorizontal: '⇧H',
  flipVertical: '⇧V',
  rotate90: '⌥R',
  combine: '⌘E',
  join: '⌘J',
  save: '⌘S',
  saveAs: '⇧⌘S',
  open: '⌘O',
  palette: '⌘/',
  panels: '⌘\\',
  fullscreen: '⇧⌘F',
  mask: '⌃⌘M',
  scissors: 'C',
  scale: 'K',
  opacity: '1 … 0',
  line: 'L',
  polygon: '⌥P',
  zoomReset: '⇧0',
  zoomFit: '⇧1',
  zoomSelection: '⇧2',
} as const

export type ShortcutId = keyof typeof SHORTCUTS

/** `Rename · ⌘R` style label for a tooltip. */
export function withShortcut(label: string, id: ShortcutId): string {
  return `${label} · ${SHORTCUTS[id]}`
}

const DIGIT_WINDOW_MS = 700

export type OpacityBuffer = { digits: string; at: number }

/**
 * Figma's opacity typing: one digit is tenths (5 → 50 %, 0 → 100 %), a second digit within a
 * moment makes it exact (4 then 7 → 47 %). Returns the opacity to apply and the new buffer.
 */
export function opacityFromDigit(buffer: OpacityBuffer | null, digit: string, now: number): { opacity: number; buffer: OpacityBuffer } {
  const fresh = !buffer || now - buffer.at > DIGIT_WINDOW_MS || buffer.digits.length >= 2
  if (fresh) {
    const value = digit === '0' ? 100 : Number(digit) * 10
    return { opacity: value / 100, buffer: { digits: digit, at: now } }
  }
  const combined = `${buffer.digits}${digit}`
  const value = Number(combined)
  return { opacity: (value === 0 ? 100 : value) / 100, buffer: { digits: combined, at: now } }
}

/** The sibling Tab moves to, wrapping around the end of the list. */
export function nextSiblingId(elements: VectorElement[], currentId: string | null, parentId: string | null, direction: 1 | -1): string | null {
  const siblings = childrenOf(elements, parentId).filter((element) => element.visible && !element.locked)
  if (siblings.length === 0) return null
  if (!currentId) return (direction > 0 ? siblings[0] : siblings[siblings.length - 1])!.id
  const index = siblings.findIndex((element) => element.id === currentId)
  if (index < 0) return (direction > 0 ? siblings[0] : siblings[siblings.length - 1])!.id
  return siblings[(index + direction + siblings.length) % siblings.length]!.id
}

/**
 * Where `moveInTree` should drop an element for each ordering command. Indices are positions in
 * the list *without* the moved element, which is what `moveInTree` expects.
 */
export function reorderIndex(elements: VectorElement[], id: string, mode: 'forward' | 'backward' | 'front' | 'back'): number | null {
  const element = elements.find((item) => item.id === id)
  if (!element) return null
  const siblings = childrenOf(elements, element.parentId ?? null)
  const index = siblingIndex(elements, id)
  if (index < 0) return null
  if (mode === 'front') return index === siblings.length - 1 ? null : siblings.length
  if (mode === 'back') return index === 0 ? null : 0
  const target = index + (mode === 'forward' ? 1 : -1)
  if (target < 0 || target >= siblings.length) return null
  return target
}

export const APPEARANCE_KEYS = [
  'fill', 'fills', 'stroke', 'strokes', 'strokeWidth', 'strokeAlign', 'strokeCap', 'strokeJoin',
  'strokeDash', 'strokeArrowStart', 'strokeArrowEnd', 'strokeSides', 'cornerRadius', 'cornerSmoothing', 'opacity',
  'strokeProfile', 'brush',
  'effects', 'blendMode', 'adjustments',
] as const

export type Appearance = Partial<Pick<VectorElement, (typeof APPEARANCE_KEYS)[number]>>

/** The look of an element, without its geometry or its identity. */
export function appearanceOf(element: VectorElement): Appearance {
  const appearance: Appearance = {}
  for (const key of APPEARANCE_KEYS) {
    const value = element[key]
    if (value !== undefined) Object.assign(appearance, { [key]: structuredClone(value) })
  }
  return appearance
}

/** Patch that gives an element a copied look, clearing the properties the source did not carry. */
export function appearancePatch(appearance: Appearance): Partial<VectorElement> {
  const patch: Partial<VectorElement> = {}
  for (const key of APPEARANCE_KEYS) Object.assign(patch, { [key]: appearance[key] })
  return patch
}

export type MatchKey = 'fill' | 'stroke' | 'strokeWidth'

/** Ids of every visible, unlocked object that shares a property with the reference. */
export function matchingIds(elements: VectorElement[], reference: VectorElement, key: MatchKey): string[] {
  return elements
    .filter((element) => element.kind !== 'group' && element.visible && !element.locked && sameProperty(element, reference, key))
    .map((element) => element.id)
}

function sameProperty(element: VectorElement, reference: VectorElement, key: MatchKey): boolean {
  if (key === 'strokeWidth') return element.strokeWidth === reference.strokeWidth
  if (key === 'fill') return element.fill === reference.fill && JSON.stringify(element.fills) === JSON.stringify(reference.fills)
  return element.stroke === reference.stroke && JSON.stringify(element.strokes) === JSON.stringify(reference.strokes)
}

/**
 * Maps one box onto another for "paste to replace": the content is scaled to fit inside the box
 * it replaces, uniformly so it keeps its shape, and centred on it.
 */
export function fitBoxMap(source: Bounds, target: Bounds): Affine {
  const scale = Math.min(target.width / Math.max(1e-6, source.width), target.height / Math.max(1e-6, source.height))
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  return {
    a: factor,
    b: 0,
    c: 0,
    d: factor,
    e: targetCenter.x - sourceCenter.x * factor,
    f: targetCenter.y - sourceCenter.y * factor,
  }
}

export const RENAME_TOKENS = { index: '$n', name: '$name', kind: '$kind' }

/**
 * One name from a batch pattern: `$n` is the position (from `start`), `$name` the current name,
 * `$kind` the object kind. An empty pattern leaves the name alone.
 */
export function renameWithPattern(pattern: string, element: Pick<VectorElement, 'name' | 'kind'>, index: number): string {
  const trimmed = pattern.trim()
  if (!trimmed) return element.name
  // Longer tokens first, or `$n` would eat the start of `$name`.
  return trimmed
    .replaceAll(RENAME_TOKENS.name, element.name)
    .replaceAll(RENAME_TOKENS.kind, element.kind)
    .replaceAll(RENAME_TOKENS.index, String(index))
    .slice(0, 120)
}

/** Preview of a batch rename, in the order the names will be applied. */
export function renamePreview(pattern: string, elements: Array<Pick<VectorElement, 'name' | 'kind'>>, start = 1): string[] {
  return elements.map((element, offset) => renameWithPattern(pattern, element, start + offset))
}
