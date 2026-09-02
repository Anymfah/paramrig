import type { VectorFontFeatures, VectorElement, VectorTextAlign, VectorTextSizing } from '@/vector/types'

/** Families offered in the inspector. Only the one shipped with the app can be outlined. */
export type TextFace = {
  value: string
  label: string
  /** CSS font stack used for measuring, on the canvas and in exports. */
  stack: string
  /** A font file the app ships, so "Outline text" can read its glyphs. */
  outlineUrl?: string
}

export const TEXT_FACES: TextFace[] = [
  { value: 'Public Sans', label: 'Public Sans', stack: "'Public Sans', 'Public Sans Fallback', ui-sans-serif, sans-serif", outlineUrl: '/fonts/PublicSans.ttf' },
  { value: 'Helvetica', label: 'Helvetica / Arial', stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { value: 'Verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { value: 'Trebuchet MS', label: 'Trebuchet', stack: "'Trebuchet MS', Tahoma, sans-serif" },
  { value: 'Georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { value: 'Times New Roman', label: 'Times', stack: "'Times New Roman', Times, serif" },
  { value: 'Courier New', label: 'Courier', stack: "'Courier New', Courier, monospace" },
  { value: 'Menlo', label: 'Menlo / Consolas', stack: "Menlo, Consolas, 'Liberation Mono', monospace" },
]

export const TEXT_WEIGHTS = [300, 400, 500, 600, 700] as const

export const DEFAULT_TEXT = {
  text: 'Text',
  fontFamily: 'Public Sans',
  fontSize: 32,
  fontWeight: 400,
  lineHeight: 1.3,
  letterSpacing: 0,
  textAlign: 'left' as VectorTextAlign,
  textSizing: 'auto' as VectorTextSizing,
}

export const MAX_TEXT_LENGTH = 4000

/** Ascent as a fraction of the font size, close enough for every face offered here. */
export const ASCENT = 0.8

export type TextProperties = {
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  textAlign: VectorTextAlign
  textSizing: VectorTextSizing
}

/** Resolved text properties of an element, defaults filled in. */
export function textProperties(element: Partial<VectorElement>): TextProperties {
  return {
    text: typeof element.text === 'string' ? element.text : DEFAULT_TEXT.text,
    fontFamily: element.fontFamily ?? DEFAULT_TEXT.fontFamily,
    fontSize: element.fontSize && element.fontSize > 0 ? element.fontSize : DEFAULT_TEXT.fontSize,
    fontWeight: element.fontWeight ?? DEFAULT_TEXT.fontWeight,
    lineHeight: element.lineHeight && element.lineHeight > 0 ? element.lineHeight : DEFAULT_TEXT.lineHeight,
    letterSpacing: element.letterSpacing ?? DEFAULT_TEXT.letterSpacing,
    textAlign: element.textAlign ?? DEFAULT_TEXT.textAlign,
    textSizing: element.textSizing ?? DEFAULT_TEXT.textSizing,
  }
}

export function faceOf(family: string): TextFace {
  return TEXT_FACES.find((face) => face.value === family) ?? TEXT_FACES[0]!
}

export function fontStack(family: string): string {
  return faceOf(family).stack
}

export function canOutline(family: string): boolean {
  return !!faceOf(family).outlineUrl
}

/** Measures one line's advance width in pixels for the given properties. */
export type Measure = (line: string, properties: TextProperties) => number

export type TextLine = { text: string; x: number; y: number; width: number }

export type TextLayout = {
  lines: TextLine[]
  /** Widest line, ignoring the element box. */
  width: number
  /** Total height of every line advance. */
  height: number
  lineAdvance: number
  anchor: 'start' | 'middle' | 'end'
}

/**
 * Lays text out in the element's box: hard line breaks always, plus greedy word wrapping when the
 * box has a fixed width. Line positions are relative to the box's top-left corner, `y` on the
 * baseline.
 */
export function layoutText(properties: TextProperties, boxWidth: number, measure: Measure): TextLayout {
  const lineAdvance = properties.fontSize * properties.lineHeight
  const paragraphs = properties.text.split('\n')
  const wrapped = properties.textSizing === 'fixed'
    ? paragraphs.flatMap((paragraph) => wrapParagraph(paragraph, properties, Math.max(1, boxWidth), measure))
    : paragraphs
  const anchor = properties.textAlign === 'center' ? 'middle' : properties.textAlign === 'right' ? 'end' : 'start'
  const widths = wrapped.map((line) => measure(line, properties))
  const width = widths.length ? Math.max(...widths) : 0
  const box = properties.textSizing === 'fixed' ? Math.max(1, boxWidth) : width
  const lines = wrapped.map((line, index) => ({
    text: line,
    width: widths[index]!,
    x: anchor === 'start' ? 0 : anchor === 'middle' ? box / 2 : box,
    // The baseline sits under half the leading plus the ascent, as browsers place it.
    y: lineAdvance * index + (lineAdvance - properties.fontSize) / 2 + properties.fontSize * ASCENT,
  }))
  return { lines, width, height: lineAdvance * Math.max(1, wrapped.length), lineAdvance, anchor }
}

function wrapParagraph(paragraph: string, properties: TextProperties, boxWidth: number, measure: Measure): string[] {
  if (!paragraph) return ['']
  const words = paragraph.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current && measure(`${current} ${word}`, properties) > boxWidth) {
      lines.push(current)
      current = ''
    }
    if (!current && measure(word, properties) > boxWidth) {
      // A word no line can hold is split rather than left hanging outside the box.
      const pieces = breakWord(word, properties, boxWidth, measure)
      lines.push(...pieces.slice(0, -1))
      current = pieces[pieces.length - 1]!
      continue
    }
    current = current ? `${current} ${word}` : word
  }
  lines.push(current)
  return lines
}

/** Splits one word across lines, always keeping at least one character so it makes progress. */
function breakWord(word: string, properties: TextProperties, boxWidth: number, measure: Measure): string[] {
  const pieces: string[] = []
  let current = ''
  for (const character of word) {
    const candidate = `${current}${character}`
    if (current && measure(candidate, properties) > boxWidth) {
      pieces.push(current)
      current = character
    } else {
      current = candidate
    }
  }
  pieces.push(current)
  return pieces
}

/** Box an auto-sized text element should take for its content. */
export function autoTextBounds(properties: TextProperties, measure: Measure): { width: number; height: number } {
  const layout = layoutText({ ...properties, textSizing: 'auto' }, 0, measure)
  return { width: Math.max(1, Math.ceil(layout.width)), height: Math.max(1, Math.ceil(layout.height)) }
}

/** A property change plus the box the text needs afterwards: auto follows the content, fixed grows down. */
export function resizeTextPatch(element: Partial<VectorElement>, patch: Partial<VectorElement>, measure: Measure): Partial<VectorElement> {
  const properties = textProperties({ ...element, ...patch })
  if (properties.textSizing === 'auto') {
    const box = autoTextBounds(properties, measure)
    return { ...patch, width: box.width, height: box.height }
  }
  const width = Math.max(1, patch.width ?? element.width ?? 1)
  return { ...patch, height: Math.max(1, Math.ceil(layoutText(properties, width, measure).height)) }
}

const APPROXIMATE_RATIOS: Record<string, number> = {
  'Courier New': 0.6,
  Menlo: 0.6,
  Georgia: 0.52,
  'Times New Roman': 0.48,
  Verdana: 0.58,
}

/**
 * Advance width without a canvas: an average-ratio estimate, used in tests and on the server.
 * Real rendering uses `canvasMeasure`.
 */
export function approximateMeasure(line: string, properties: TextProperties): number {
  const ratio = APPROXIMATE_RATIOS[properties.fontFamily] ?? 0.53
  const weightBoost = 1 + Math.max(0, properties.fontWeight - 400) / 4000
  return line.length * (properties.fontSize * ratio * weightBoost + properties.letterSpacing)
}

let context: CanvasRenderingContext2D | null | undefined

/** Advance width measured by the browser, falling back to the estimate when there is no canvas. */
export function canvasMeasure(line: string, properties: TextProperties): number {
  if (context === undefined) {
    context = typeof globalThis.document === 'undefined' ? null : globalThis.document.createElement('canvas').getContext('2d')
  }
  if (!context || typeof context.measureText !== 'function') return approximateMeasure(line, properties)
  context.font = `${properties.fontWeight} ${properties.fontSize}px ${fontStack(properties.fontFamily)}`
  // A stubbed 2D context (jsdom, thumbnail capture) answers with nothing; fall back to the estimate.
  const width = (context.measureText(line) as TextMetrics | undefined)?.width
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
    return line.length === 0 ? 0 : approximateMeasure(line, properties)
  }
  return width + properties.letterSpacing * Math.max(0, line.length - 1)
}

/** Forgets the cached measuring context, for tests. */
export function resetMeasureCache(): void {
  context = undefined
}

const FEATURE_TAGS = ['liga', 'kern', 'smcp', 'tnum'] as const

export function sanitizeFontFeatures(value: unknown): VectorFontFeatures | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const entries = FEATURE_TAGS
    .filter((tag) => typeof source[tag] === 'boolean')
    // Kerning on and the rest off is the default; storing it would say nothing.
    .filter((tag) => source[tag] !== (tag === 'kern'))
    .map((tag) => [tag, source[tag] as boolean] as const)
  return entries.length ? Object.fromEntries(entries) as VectorFontFeatures : undefined
}

/** The `font-feature-settings` value for a text, or null when it asks for nothing unusual. */
export function fontFeatureSettings(features: VectorFontFeatures | undefined): string | null {
  if (!features) return null
  const parts = FEATURE_TAGS
    .filter((tag) => features[tag] !== undefined)
    .map((tag) => `"${tag}" ${features[tag] ? 1 : 0}`)
  return parts.length ? parts.join(', ') : null
}
