import { serializeVectorDocument } from '@/vector/document'
import { sanitizeVectorDocument } from '@/vector/document'
import { importSvg } from '@/vector/svgImport'
import type { VectorDocument, VectorElement } from '@/vector/types'

const MARKER = 'paramrig-vector:'

export type ClipboardPayload = { elements: VectorElement[]; source: 'internal' | 'svg' }

/** Writes the selection as an internal JSON payload plus standalone SVG markup. */
export function writeClipboardPayload(data: DataTransfer | null, elements: VectorElement[], document: VectorDocument): void {
  if (!data) return
  const svg = serializeVectorDocument({ ...document, elements })
  data.setData('text/plain', `${MARKER}${JSON.stringify({ elements })}\n${svg}`)
  data.setData('image/svg+xml', svg)
}

/** Reads elements from the internal payload, or from any pasted SVG markup. */
export function readClipboardPayload(data: DataTransfer | null): ClipboardPayload | null {
  if (!data) return null
  const text = data.getData('text/plain') ?? ''
  if (text.startsWith(MARKER)) {
    const json = text.slice(MARKER.length, text.indexOf('\n<svg') > 0 ? text.indexOf('\n<svg') : undefined)
    try {
      const parsed = JSON.parse(json) as { elements?: unknown }
      const sanitized = sanitizeVectorDocument({ version: 1, id: 'clipboard', name: 'clipboard', width: 1, height: 1, elements: Array.isArray(parsed.elements) ? parsed.elements : [] })
      if (sanitized && sanitized.elements.length) return { elements: sanitized.elements, source: 'internal' }
    } catch {
      /* fall through to SVG */
    }
  }
  const svg = data.getData('image/svg+xml') || (text.includes('<svg') ? text.slice(text.indexOf('<svg')) : '')
  if (svg) {
    const elements = importSvg(svg, { currentColor: '#D4E7E1' })
    if (elements.length) return { elements, source: 'svg' }
  }
  return null
}
