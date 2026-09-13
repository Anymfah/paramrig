import { canvasMeasure, layoutText, textProperties, TEXT_FACES, type Measure } from '@/vector/text'
import { fillsOf } from '@/vector/paints'
import type { VectorDocument, VectorElement } from '@/vector/types'

export type BrandIssue = { kind: 'overflow' | 'contrast' | 'font'; elementId: string; page: string; message: string }
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}
/** WCAG sRGB contrast. Call only for opaque six-digit colours. */
export function brandContrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
function solid(element: VectorElement): string | null {
  const paints = fillsOf(element).filter(paint => paint.visible && paint.opacity > 0)
  const paint = paints.at(-1)
  return element.opacity === 1 && paints.length === 1 && paint?.type === 'solid' && paint.opacity === 1 && /^#[\da-f]{6}$/i.test(paint.color ?? '') ? paint.color! : null
}
function contains(outer: VectorElement, inner: VectorElement, height: number): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + height
}

/** Advisory, not a conformance audit: fixed text boxes and opaque, flat backgrounds only. */
export function checkBrand(document: VectorDocument, measure: Measure = canvasMeasure): { issues: BrandIssue[]; uncheckedContrast: number } {
  const issues: BrandIssue[] = []
  let uncheckedContrast = 0
  const seenFonts = new Set<string>()
  document.elements.forEach((element, index) => {
    if (element.kind !== 'text' || !element.visible || !element.text?.trim()) return
    const frame = document.elements.find(item => item.id === element.parentId)
    if (frame && !frame.visible) return
    const page = frame?.name ?? document.name
    const properties = textProperties(element)
    const layout = layoutText(properties, element.width, measure)
    const textBottom = (layout.lines.at(-1)?.y ?? 0) + properties.fontSize * 0.2
    if (textBottom > element.height + 1 || layout.width > element.width + 1) issues.push({ kind: 'overflow', elementId: element.id, page,
      message: `“${element.text.slice(0, 42).replaceAll('\n', ' ')}” exceeds its text box. Shorten the text, reduce its size or line height, or widen the box.` })
    // Sanitized documents store children before their frame. Paint the frame as
    // the base, then consider earlier siblings; do not mistake storage order for hierarchy.
    const background = document.elements.slice(0, index).reverse().find(item => item.parentId === element.parentId && item.visible && ['rectangle', 'frame'].includes(item.kind) && contains(item, element, Math.min(textBottom, element.height)))
      ?? (frame?.kind === 'frame' ? frame : undefined)
    const foreground = solid(element), ground = background ? solid(background) : /^#[\da-f]{6}$/i.test(document.background) ? document.background : null
    if (foreground && ground && !element.rotation && !background?.rotation) {
      const ratio = brandContrast(foreground, ground)
      const minimum = properties.fontSize >= 24 || (properties.fontSize >= 18.667 && properties.fontWeight >= 700) ? 3 : 4.5
      if (ratio < minimum) issues.push({ kind: 'contrast', elementId: element.id, page,
        message: `“${element.text.slice(0, 34).replaceAll('\n', ' ')}”: ${ratio.toFixed(2)}:1 contrast; aim for ${minimum}:1. Adjust the text or background colour.` })
    } else uncheckedContrast++
    if (!seenFonts.has(properties.fontFamily)) {
      seenFonts.add(properties.fontFamily)
      const shipped = TEXT_FACES.find(face => face.value === properties.fontFamily)?.webFont
      const carried = document.fonts?.find(font => font.family === properties.fontFamily)
      if (!shipped && (!carried || carried.source === 'system')) issues.push({ kind: 'font', elementId: element.id, page,
        message: `${properties.fontFamily} is a system font. SVG recipients need it installed; import its file for a portable export.` })
      if (carried?.source === 'google') issues.push({ kind: 'font', elementId: element.id, page,
        message: `${properties.fontFamily} loads on demand. SVG needs a successful font download; use SVG/PNG rather than PDF outlines.` })
    }
  })
  return { issues, uncheckedContrast }
}
