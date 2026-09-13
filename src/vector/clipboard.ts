import { serializeVectorDocument } from '@/vector/serialization'
import { sanitizeVectorDocument } from '@/vector/model'
import { importSvg } from '@/vector/svgImport'
import { DEFAULT_RIG_GROUP, parseBindableProperty, sanitizeRig, type VectorBinding } from '@/vector/rig'
import type { VectorDocument, VectorElement } from '@/vector/types'

const MARKER = 'paramrig-vector:'

export type ClipboardPayload = { elements: VectorElement[]; bindings: VectorBinding[]; source: 'internal' | 'svg' }

/** Writes the selection as an internal JSON payload plus standalone SVG markup. */
export function writeClipboardPayload(data: DataTransfer | null, elements: VectorElement[], document: VectorDocument): void {
  if (!data) return
  const svg = serializeVectorDocument({ ...document, elements })
  const ids = new Set(elements.map((element) => element.id))
  const bindings = (document.rig?.bindings ?? []).filter((binding) => ids.has(binding.elementId))
  data.setData('text/plain', `${MARKER}${JSON.stringify({ elements, bindings })}\n${svg}`)
  data.setData('image/svg+xml', svg)
}

/**
 * The bindings a paste keeps: the ones whose control the target document already has, rewritten
 * onto the new copies. A copy into a document that never heard of the control comes in as plain
 * geometry, which is what it is there.
 */
export function pastedBindings(bindings: VectorBinding[], idMap: Record<string, string>, parameterIds: Set<string>): VectorBinding[] {
  return bindings.flatMap((binding) => {
    const elementId = idMap[binding.elementId]
    if (!elementId || !parameterIds.has(binding.parameterId)) return []
    return [{ ...binding, id: crypto.randomUUID(), elementId }]
  })
}

/** Reads elements from the internal payload, or from any pasted SVG markup. */
export function readClipboardPayload(data: DataTransfer | null): ClipboardPayload | null {
  if (!data) return null
  const text = data.getData('text/plain') ?? ''
  if (text.startsWith(MARKER)) {
    const json = text.slice(MARKER.length, text.indexOf('\n<svg') > 0 ? text.indexOf('\n<svg') : undefined)
    try {
      const parsed = JSON.parse(json) as { elements?: unknown; bindings?: unknown }
      const sanitized = sanitizeVectorDocument({ version: 1, id: 'clipboard', name: 'clipboard', width: 1, height: 1, elements: Array.isArray(parsed.elements) ? parsed.elements : [] })
      if (sanitized && sanitized.elements.length) {
        const rig = sanitizeRig({ groups: [DEFAULT_RIG_GROUP], parameters: [], bindings: parsed.bindings }, new Set(sanitized.elements.map((element) => element.id)))
        // Sanitising drops a binding whose control is unknown here; the raw list is what travels.
        const bindings = Array.isArray(parsed.bindings) ? (rig?.bindings.length ? rig.bindings : rawBindings(parsed.bindings, sanitized.elements.map((element) => element.id))) : []
        return { elements: sanitized.elements, bindings, source: 'internal' }
      }
    } catch {
      /* fall through to SVG */
    }
  }
  const svg = data.getData('image/svg+xml') || (text.includes('<svg') ? text.slice(text.indexOf('<svg')) : '')
  if (svg) {
    const elements = importSvg(svg, { currentColor: '#D4E7E1' })
    if (elements.length) return { elements, bindings: [], source: 'svg' }
  }
  return null
}

/** The bindings of a copied block, kept as written so the paste can match them to its own rig. */
function rawBindings(value: unknown[], elementIds: string[]): VectorBinding[] {
  const known = new Set(elementIds)
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Partial<VectorBinding>
    if (typeof entry.elementId !== 'string' || typeof entry.parameterId !== 'string' || typeof entry.property !== 'string') return []
    if (!known.has(entry.elementId) || !parseBindableProperty(entry.property)) return []
    return [{ id: typeof entry.id === 'string' ? entry.id : crypto.randomUUID(), elementId: entry.elementId, parameterId: entry.parameterId, property: entry.property, ...(entry.transform ? { transform: entry.transform } : {}) }]
  })
}
