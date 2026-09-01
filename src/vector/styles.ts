import { sanitizePaints, summaryColor } from '@/vector/paints'
import type { VectorElement, VectorPaint, VectorStyle, VectorStyleKind } from '@/vector/types'

export const MAX_STYLES = 60
export const MAX_SWATCHES = 24
export const MAX_RECENT_COLORS = 12

/** Element properties a stroke style carries beyond its paints. */
const STROKE_KEYS = ['strokeWidth', 'strokeAlign', 'strokeCap', 'strokeJoin', 'strokeDash'] as const

export function styleIdKey(kind: VectorStyleKind): 'fillStyleId' | 'strokeStyleId' {
  return kind === 'fill' ? 'fillStyleId' : 'strokeStyleId'
}

/** Builds a style from what an element currently paints. */
export function styleFromElement(element: VectorElement, kind: VectorStyleKind, name: string, id: string): VectorStyle {
  const paints = kind === 'fill'
    ? (element.fills ?? (element.fill === 'none' ? [] : [{ id: `${id}-0`, type: 'solid' as const, color: element.fill, opacity: 1, visible: true }]))
    : (element.strokes ?? (element.stroke === 'none' ? [] : [{ id: `${id}-0`, type: 'solid' as const, color: element.stroke, opacity: 1, visible: true }]))
  const style: VectorStyle = { id, kind, name: name.trim().slice(0, 60) || 'Style', paints: structuredClone(paints) }
  if (kind === 'stroke') {
    for (const key of STROKE_KEYS) {
      const value = element[key]
      if (value !== undefined) Object.assign(style, { [key]: structuredClone(value) })
    }
  }
  return style
}

/** Patch that paints an element with a style and records the link. */
export function applyStylePatch(style: VectorStyle): Partial<VectorElement> {
  const paints = structuredClone(style.paints)
  const summary = summaryColor(paints)
  if (style.kind === 'fill') {
    return { fill: summary, fills: paints.length ? paints : [], fillStyleId: style.id }
  }
  const patch: Partial<VectorElement> = { stroke: summary, strokes: paints.length ? paints : [], strokeStyleId: style.id }
  for (const key of STROKE_KEYS) Object.assign(patch, { [key]: style[key] })
  return patch
}

/** Patch that keeps the look but cuts the link. */
export function detachStylePatch(kind: VectorStyleKind): Partial<VectorElement> {
  return { [styleIdKey(kind)]: undefined }
}

/** Every element linked to a style, repainted from it. */
export function syncStylePatches(elements: VectorElement[], style: VectorStyle): Array<{ id: string; patch: Partial<VectorElement> }> {
  const key = styleIdKey(style.kind)
  return elements
    .filter((element) => element[key] === style.id)
    .map((element) => ({ id: element.id, patch: applyStylePatch(style) }))
}

/** The style an element's paint edit should write back to, if any. */
export function linkedStyle(styles: VectorStyle[], element: VectorElement, kind: VectorStyleKind): VectorStyle | null {
  const id = element[styleIdKey(kind)]
  return id ? styles.find((style) => style.id === id && style.kind === kind) ?? null : null
}

export function styleUsage(elements: VectorElement[], style: VectorStyle): number {
  const key = styleIdKey(style.kind)
  return elements.filter((element) => element[key] === style.id).length
}

/** Drops links to styles the document no longer holds. */
export function pruneStyleLinks(elements: VectorElement[], styles: VectorStyle[]): VectorElement[] {
  const fills = new Set(styles.filter((style) => style.kind === 'fill').map((style) => style.id))
  const strokes = new Set(styles.filter((style) => style.kind === 'stroke').map((style) => style.id))
  let changed = false
  const next = elements.map((element) => {
    const dropFill = element.fillStyleId && !fills.has(element.fillStyleId)
    const dropStroke = element.strokeStyleId && !strokes.has(element.strokeStyleId)
    if (!dropFill && !dropStroke) return element
    changed = true
    const copy = { ...element }
    if (dropFill) delete copy.fillStyleId
    if (dropStroke) delete copy.strokeStyleId
    return copy
  })
  return changed ? next : elements
}

/** Recently used colours, most recent first, without repeats. */
export function pushRecentColor(list: string[] | undefined, hex: string): string[] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return list ?? []
  const upper = hex.toUpperCase()
  return [upper, ...(list ?? []).filter((item) => item.toUpperCase() !== upper)].slice(0, MAX_RECENT_COLORS)
}

/** Document swatches: adding an existing one is a no-op, and the row is capped. */
export function toggleSwatch(list: string[] | undefined, hex: string, remove = false): string[] {
  const current = list ?? []
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return current
  const upper = hex.toUpperCase()
  if (remove) return current.filter((item) => item.toUpperCase() !== upper)
  if (current.some((item) => item.toUpperCase() === upper)) return current
  return [...current, upper].slice(0, MAX_SWATCHES)
}

export function sanitizeColorList(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const colors = value.flatMap((item) => {
    if (typeof item !== 'string' || !/^#[0-9a-f]{6}$/i.test(item)) return []
    const upper = item.toUpperCase()
    if (seen.has(upper)) return []
    seen.add(upper)
    return [upper]
  }).slice(0, max)
  return colors.length ? colors : undefined
}

export function sanitizeStyles(value: unknown): VectorStyle[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const styles = value.slice(0, MAX_STYLES).flatMap((candidate): VectorStyle[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const source = candidate as Partial<VectorStyle>
    if (typeof source.id !== 'string' || !source.id || seen.has(source.id)) return []
    if (typeof source.name !== 'string' || !source.name.trim()) return []
    const kind: VectorStyleKind = source.kind === 'stroke' ? 'stroke' : 'fill'
    const paints = sanitizePaints(source.paints) as VectorPaint[] | undefined
    if (!paints) return []
    seen.add(source.id)
    const style: VectorStyle = { id: source.id, kind, name: source.name.trim().slice(0, 60), paints }
    if (kind === 'stroke') {
      if (typeof source.strokeWidth === 'number' && Number.isFinite(source.strokeWidth)) style.strokeWidth = Math.max(0, source.strokeWidth)
      if (source.strokeAlign === 'inside' || source.strokeAlign === 'outside' || source.strokeAlign === 'center') style.strokeAlign = source.strokeAlign
      if (source.strokeCap === 'round' || source.strokeCap === 'square' || source.strokeCap === 'butt') style.strokeCap = source.strokeCap
      if (source.strokeJoin === 'round' || source.strokeJoin === 'bevel' || source.strokeJoin === 'miter') style.strokeJoin = source.strokeJoin
      if (Array.isArray(source.strokeDash) && source.strokeDash.length === 2 && source.strokeDash.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0)) {
        style.strokeDash = [source.strokeDash[0]!, source.strokeDash[1]!]
      }
    }
    return [style]
  })
  return styles.length ? styles : undefined
}
