import { serializeVectorMarkup } from '@/vector/document'
import { boundsWithEffects } from '@/vector/effects'
import { fontFaceRule } from '@/vector/fonts'
import { fontData } from '@/vector/fontLoader'
import type { Bounds } from '@/vector/geometry'
import { inkSelectionBounds } from '@/vector/ink'
import { descendantIds } from '@/vector/tree'
import type { VectorColorSpace, VectorDocument, VectorElement, VectorFont } from '@/vector/types'

export type ExportTargetKind = 'document' | 'frame' | 'selection'

export type ExportSettings = {
  target: ExportTargetKind
  format: 'svg' | 'png' | 'pdf'
  scale: 1 | 2 | 3
  transparent: boolean
}

export const DEFAULT_EXPORT: ExportSettings = { target: 'document', format: 'svg', scale: 2, transparent: false }
export const EXPORT_SCALES = [1, 2, 3] as const
export const MAX_RASTER_SIDE = 8192

export type ExportSelection = { frameId: string | null; selectedIds: string[] }

/** The elements an export covers, with the roots detached so they serialise at the top level. */
export function exportElements(document: VectorDocument, target: ExportTargetKind, selection: ExportSelection): VectorElement[] {
  if (target === 'document') return document.elements
  const roots = target === 'frame'
    ? (selection.frameId ? [selection.frameId] : [])
    : selection.selectedIds
  if (roots.length === 0) return []
  const wanted = new Set(roots.flatMap((id) => [id, ...descendantIds(document.elements, id)]))
  const rootSet = new Set(roots)
  return document.elements
    .filter((element) => wanted.has(element.id))
    .map((element) => {
      if (!rootSet.has(element.id) || !element.parentId) return element
      const { parentId: _parentId, ...rest } = element
      return rest
    })
}

/** The box an export is framed by: the page, the frame's own box, or the selection's bounds. */
export function exportBounds(document: VectorDocument, target: ExportTargetKind, selection: ExportSelection): Bounds | null {
  if (target === 'document') return { x: 0, y: 0, width: document.width, height: document.height }
  if (target === 'frame') {
    const frame = document.elements.find((element) => element.id === selection.frameId && element.kind === 'frame')
    return frame ? inkSelectionBounds([frame]) : null
  }
  const elements = document.elements.filter((element) => selection.selectedIds.includes(element.id))
  if (elements.length === 0) return null
  const bounds = inkSelectionBounds(elements)
  if (bounds.width <= 0 || bounds.height <= 0) return null
  // A shadow or a blur paints outside the box; the export box grows so nothing is cut off.
  return boundsWithEffects(bounds, elements)
}

/** Self-contained SVG for an export, image fills already inline in the paint model. */
export function exportMarkup(document: VectorDocument, settings: ExportSettings, selection: ExportSelection): string | null {
  const bounds = exportBounds(document, settings.target, selection)
  if (!bounds) return null
  const elements = exportElements(document, settings.target, selection)
  return serializeVectorMarkup(elements, bounds, settings.transparent ? undefined : document.background, document.colorSpace)
}

export function exportFileName(document: VectorDocument, settings: ExportSettings, frameName?: string): string {
  const base = settings.target === 'frame' && frameName ? frameName : document.name
  const suffix = settings.format === 'png' && settings.scale !== 1 ? `@${settings.scale}x` : ''
  return `${slug(base)}${suffix}.${settings.format}`
}

/** Pixel size of a raster export, clamped so a huge frame cannot ask for an impossible canvas. */
export function rasterSize(bounds: Bounds, scale: number): { width: number; height: number } {
  const ratio = Math.min(1, MAX_RASTER_SIDE / Math.max(bounds.width * scale, bounds.height * scale, 1))
  return {
    width: Math.max(1, Math.round(bounds.width * scale * ratio)),
    height: Math.max(1, Math.round(bounds.height * scale * ratio)),
  }
}

/**
 * Inlines the faces the markup actually uses, so text keeps its shape once the SVG is rasterised
 * or reopened somewhere that has never heard of the font. The shipped face comes from the app; a
 * document font comes from its own bytes, or from Google, fetched once and cached for the session.
 */
export async function embedFonts(markup: string, fonts: VectorFont[] = []): Promise<string> {
  if (!markup.includes('<text ')) return markup
  const rules: string[] = []
  if (markup.includes('Public Sans')) {
    try {
      const response = await fetch('/fonts/PublicSans.woff2')
      if (response.ok) rules.push(fontFaceRule('Public Sans', toBase64(await response.arrayBuffer()), 'woff2', [100, 900]))
    } catch {
      // The shipped face is unreachable; the file falls back to whatever the reader has.
    }
  }
  for (const font of fonts) {
    if (!markup.includes(`'${font.family}'`) && !markup.includes(font.family)) continue
    const data = await fontData(font, font.weights[0] ?? 400)
    if (data) rules.push(fontFaceRule(font.family, data, font.format ?? 'woff2', font.weights))
  }
  if (rules.length === 0) return markup
  return markup.replace(/(<svg[^>]*>)/, `$1\n  <style>${rules.join('')}</style>`)
}

/** Draws an SVG string into a canvas and returns the PNG bytes. */
export async function rasterize(markup: string, bounds: Bounds, scale: number, type: 'image/png' | 'image/jpeg' = 'image/png', space?: VectorColorSpace): Promise<Blob | null> {
  if (typeof globalThis.document === 'undefined' || typeof Image === 'undefined') return null
  const size = rasterSize(bounds, scale)
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => resolve(null)
    element.src = source
  })
  if (!image) return null
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  // A wide-gamut document rasterises into a wide-gamut canvas where the browser has one.
  const context = space === 'display-p3'
    ? (canvas.getContext('2d', { colorSpace: 'display-p3' }) ?? canvas.getContext('2d'))
    : canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, size.width, size.height)
  if (type === 'image/jpeg') {
    // A JPEG goes into a PDF as it is; it needs an opaque ground under it first.
    const flat = globalThis.document.createElement('canvas')
    flat.width = size.width
    flat.height = size.height
    const ground = flat.getContext('2d')
    if (!ground) return null
    ground.fillStyle = '#ffffff'
    ground.fillRect(0, 0, size.width, size.height)
    ground.drawImage(canvas, 0, 0)
    return new Promise<Blob | null>((resolve) => flat.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92))
  }
  return new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
  return btoa(binary)
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
}
