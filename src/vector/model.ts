import { sanitizeGuides } from '@/vector/guides'
import { sanitizeParents } from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorElementKind, VectorExportPreset } from '@/vector/types'
import { sanitizeNetwork } from '@/vector/network'
import { DEFAULT_TEXT, MAX_TEXT_LENGTH, sanitizeFontFeatures, TEXT_FACES } from '@/vector/text'
import { sanitizePaints } from '@/vector/paints'
import { sanitizeAdjustments, sanitizeBlendMode, sanitizeEffects } from '@/vector/effects'
import { sanitizeCrop } from '@/vector/crop'
import { sanitizeStrokeProfile } from '@/vector/strokeProfile'
import { sanitizeBrushes, sanitizeBrushSettings } from '@/vector/brushes'
import { sanitizeTextPath, syncTextPaths } from '@/vector/textPath'
import { sanitizeFonts } from '@/vector/fonts'
import { sanitizeVariations } from '@/vector/fontCapabilities'
import { sanitizeColorSpace } from '@/vector/colorSpace'
import { OVERRIDE_KEYS, syncInstances } from '@/vector/instances'
import { BOOLEAN_OPERATIONS } from './booleanTypes'
import { arcProperties, isFullEllipse, MAX_SIDES, MIN_SIDES, polygonProperties } from '@/vector/shapes'
import { MAX_RECENT_COLORS, MAX_SWATCHES, pruneStyleLinks, sanitizeColorList, sanitizeStyles } from '@/vector/styles'
import { sanitizeRig } from '@/vector/rig'

const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 600
const DEFAULT_BACKGROUND = '#151516'
export const DEFAULT_SHAPE_FILL = '#1C1D1E'
const DEFAULT_PATH_STROKE = '#D4E7E1'
export const DEFAULT_TEXT_FILL = '#D4E7E1'
export const DEFAULT_FRAME_FILL = '#E9EEED'
export const MAX_DOCUMENT_SIZE = 10000

export function createVectorDocument(): VectorDocument {
  const now = new Date().toISOString()
  const document: VectorDocument = {
    version: 1,
    id: `vector-${crypto.randomUUID()}`,
    name: 'Untitled',
    background: DEFAULT_BACKGROUND,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    elements: [],
    guides: [],
    createdAt: now,
    updatedAt: now,
  }
  return document
}

export type CreateElementOptions = Partial<Pick<VectorElement,
  'name' | 'fill' | 'stroke' | 'strokeWidth' | 'network' | 'regionsOff' | 'clipContent'
  | 'text' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'textAlign' | 'textSizing'
  | 'image' | 'imageWidth' | 'imageHeight' | 'imageRendering'
  | 'sides' | 'innerRatio' | 'arcStart' | 'arcSweep' | 'arcRatio'>>

export function createVectorElement(
  kind: VectorElementKind,
  bounds: { x: number; y: number; width: number; height: number },
  options: CreateElementOptions = {},
): VectorElement {
  const isPath = kind === 'path'
  const isGroup = kind === 'group'
  const isText = kind === 'text'
  const isFrame = kind === 'frame'
  const isImage = kind === 'image'
  const isPolygon = kind === 'polygon'
  const element: VectorElement = {
    id: crypto.randomUUID(),
    kind,
    name: options.name ?? defaultName(kind),
    x: round(bounds.x),
    y: round(bounds.y),
    width: Math.max(1, round(bounds.width)),
    height: Math.max(1, round(bounds.height)),
    rotation: 0,
    fill: options.fill ?? (isText ? DEFAULT_TEXT_FILL : isFrame ? DEFAULT_FRAME_FILL : isPath || isGroup || isImage ? 'none' : DEFAULT_SHAPE_FILL),
    stroke: options.stroke ?? (isPath ? DEFAULT_PATH_STROKE : isGroup || isText || isFrame || isImage ? 'none' : DEFAULT_SHAPE_FILL),
    strokeWidth: options.strokeWidth ?? (isPath ? 2 : 0),
    opacity: 1,
    visible: true,
    locked: false,
  }
  if (options.network) element.network = options.network
  if (options.regionsOff?.length) element.regionsOff = options.regionsOff
  if (isPolygon) {
    element.sides = Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(options.sides ?? 5)))
    if (options.innerRatio) element.innerRatio = Math.min(1, Math.max(0, options.innerRatio))
  }
  if (kind === 'ellipse' && (options.arcStart !== undefined || options.arcSweep !== undefined || options.arcRatio !== undefined)) {
    Object.assign(element, sanitizeArc(options))
  }
  if (isFrame) element.clipContent = options.clipContent ?? true
  if (isImage && options.image) {
    element.image = options.image
    if (options.imageWidth) element.imageWidth = options.imageWidth
    if (options.imageHeight) element.imageHeight = options.imageHeight
    if (options.imageRendering) element.imageRendering = options.imageRendering
  }
  if (isText) {
    element.text = options.text ?? DEFAULT_TEXT.text
    element.fontFamily = options.fontFamily ?? DEFAULT_TEXT.fontFamily
    element.fontSize = options.fontSize ?? DEFAULT_TEXT.fontSize
    element.fontWeight = options.fontWeight ?? DEFAULT_TEXT.fontWeight
    element.lineHeight = options.lineHeight ?? DEFAULT_TEXT.lineHeight
    element.letterSpacing = options.letterSpacing ?? DEFAULT_TEXT.letterSpacing
    element.textAlign = options.textAlign ?? DEFAULT_TEXT.textAlign
    element.textSizing = options.textSizing ?? DEFAULT_TEXT.textSizing
  }
  return element
}

function defaultName(kind: VectorElementKind): string {
  switch (kind) {
    case 'rectangle': return 'Rectangle'
    case 'ellipse': return 'Ellipse'
    case 'path': return 'Path'
    case 'group': return 'Group'
    case 'text': return 'Text'
    case 'frame': return 'Frame'
    case 'image': return 'Image'
    case 'polygon': return 'Polygon'
    case 'boolean': return 'Boolean'
    case 'component': return 'Component'
    case 'instance': return 'Instance'
  }
}

function sanitizeOverrides(value: unknown): { overrides?: Record<string, Partial<VectorElement>> } {
  if (!value || typeof value !== 'object') return {}
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, override]) => {
    if (!override || typeof override !== 'object') return []
    const source = override as Partial<VectorElement>
    const patch: Partial<VectorElement> = {}
    for (const property of OVERRIDE_KEYS) {
      if (source[property] === undefined) continue
      Object.assign(patch, { [property]: structuredClone(source[property]) })
    }
    return Object.keys(patch).length ? [[key, patch] as const] : []
  })
  return entries.length ? { overrides: Object.fromEntries(entries) } : {}
}

function sanitizeStrokeSides(value: unknown): VectorElement['strokeSides'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const sides = { top: source.top !== false, right: source.right !== false, bottom: source.bottom !== false, left: source.left !== false }
  return sides.top && sides.right && sides.bottom && sides.left ? undefined : sides
}

function sanitizeCornerRadius(value: unknown): VectorElement['cornerRadius'] | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.min(10000, value) : undefined
  if (Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    const radii = value.map((item) => Math.max(0, Math.min(10000, item as number))) as [number, number, number, number]
    return radii.some(Boolean) ? radii : undefined
  }
  return undefined
}

export function sanitizeVectorDocument(value: unknown, evaluateBooleans: (elements: VectorElement[]) => VectorElement[] = elements => elements): VectorDocument | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VectorDocument>
  if (source.version !== 1 || typeof source.id !== 'string' || typeof source.name !== 'string') return null
  if (!finiteIn(source.width, 1, MAX_DOCUMENT_SIZE) || !finiteIn(source.height, 1, MAX_DOCUMENT_SIZE)) return null
  if (!Array.isArray(source.elements)) return null
  const fonts = sanitizeFonts(source.fonts)
  // A text may name a font the document brought with it, not only the ones the app ships.
  const families = new Set((fonts ?? []).map((font) => font.family))
  const seen = new Set<string>()
  const elements = source.elements.flatMap((element) => {
    const valid = sanitizeElement(element, families)
    if (!valid || seen.has(valid.id)) return []
    seen.add(valid.id)
    return [valid]
  })
  const styles = sanitizeStyles(source.styles)
  const tree = syncInstances(syncTextPaths(evaluateBooleans(pruneStyleLinks(sanitizeParents(elements), styles ?? []))))
  const rig = sanitizeRig(source.rig, new Set(tree.map((element) => element.id)))
  return {
    version: 1,
    id: source.id,
    name: source.name.slice(0, 120) || 'Untitled',
    background: source.background === 'none' ? 'none' : typeof source.background === 'string' && /^#[0-9a-f]{6}$/i.test(source.background) ? source.background.toUpperCase() : DEFAULT_BACKGROUND,
    width: source.width,
    height: source.height,
    elements: tree,
    guides: sanitizeGuides(source.guides),
    ...(Array.isArray(source.versions) && source.versions.length ? { versions: sanitizeVersions(source.versions) } : {}),
    ...(source.exportPresets ? { exportPresets: sanitizeExportPresets(source.exportPresets) } : {}),
    ...(styles ? { styles } : {}),
    ...(sanitizeBrushes(source.brushes) ? { brushes: sanitizeBrushes(source.brushes) } : {}),
    ...(fonts ? { fonts } : {}),
    ...(sanitizeColorSpace(source.colorSpace) ? { colorSpace: sanitizeColorSpace(source.colorSpace) } : {}),
    ...(sanitizeColorList(source.swatches, MAX_SWATCHES) ? { swatches: sanitizeColorList(source.swatches, MAX_SWATCHES) } : {}),
    ...(sanitizeColorList(source.recentColors, MAX_RECENT_COLORS) ? { recentColors: sanitizeColorList(source.recentColors, MAX_RECENT_COLORS) } : {}),
    ...(rig ? { rig } : {}),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date(0).toISOString(),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date(0).toISOString(),
  }
}

export const MAX_EXPORT_PRESETS = 12

export function sanitizeExportPresets(value: unknown): VectorExportPreset[] | undefined {
  if (!Array.isArray(value)) return undefined
  const presets = value.slice(0, MAX_EXPORT_PRESETS).flatMap((candidate): VectorExportPreset[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const source = candidate as Partial<VectorExportPreset>
    if (typeof source.id !== 'string' || !source.id || typeof source.name !== 'string' || !source.name.trim()) return []
    const target = source.target === 'frame' || source.target === 'selection' ? source.target : 'document'
    const format = source.format === 'png' ? 'png' : source.format === 'pdf' ? 'pdf' : 'svg'
    const scale = source.scale === 1 || source.scale === 2 || source.scale === 3 ? source.scale : 1
    return [{ id: source.id, name: source.name.trim().slice(0, 60), target, format, scale, transparent: source.transparent === true }]
  })
  return presets.length ? presets : undefined
}

export const MAX_VERSIONS = 20

function sanitizeVersions(value: unknown[]): VectorDocument['versions'] {
  const versions = value.slice(-MAX_VERSIONS).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const source = candidate as Partial<NonNullable<VectorDocument['versions']>[number]>
    if (typeof source.id !== 'string' || typeof source.name !== 'string' || !Array.isArray(source.elements)) return []
    const seen = new Set<string>()
    const elements = source.elements.flatMap((element) => {
      const valid = sanitizeElement(element)
      if (!valid || seen.has(valid.id)) return []
      seen.add(valid.id)
      return [valid]
    })
    return [{ id: source.id, name: source.name.slice(0, 80), createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date(0).toISOString(), elements: sanitizeParents(elements), guides: sanitizeGuides(source.guides) }]
  })
  return versions.length ? versions : undefined
}

/** Hex colour normalised to upper case, or `'none'`; anything else is rejected. */
export function sanitizePaint(value: unknown): string | null {
  if (value === 'none') return 'none'
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase()
  return null
}

function sanitizeElement(value: unknown, families: Set<string> = new Set()): VectorElement | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VectorElement>
  const KINDS: VectorElementKind[] = ['rectangle', 'ellipse', 'path', 'group', 'text', 'frame', 'image', 'polygon', 'boolean', 'component', 'instance']
  if (!source.kind || !KINDS.includes(source.kind)) return null
  const kind: VectorElementKind = source.kind
  if (source.kind === 'text' && typeof source.text !== 'string') return null
  if (source.kind === 'image' && (typeof source.image !== 'string' || !source.image.startsWith('data:image/'))) return null
  if (typeof source.id !== 'string' || !source.id || typeof source.name !== 'string') return null
  if (![source.x, source.y, source.width, source.height, source.rotation, source.strokeWidth, source.opacity].every(Number.isFinite)) return null
  const fill = sanitizePaint(source.fill)
  const stroke = sanitizePaint(source.stroke)
  if (!fill || !stroke) return null
  const fills = sanitizePaints(source.fills)
  const strokes = sanitizePaints(source.strokes)
  const strokeSides = source.kind === 'rectangle' && !source.network ? sanitizeStrokeSides(source.strokeSides) : undefined
  const cornerRadius = source.kind === 'rectangle' && !source.network ? sanitizeCornerRadius(source.cornerRadius) : undefined
  const network = source.kind === 'group' || source.kind === 'text' || source.kind === 'frame' || source.kind === 'image' ? null : sanitizeNetwork(source.network)
  if (source.kind === 'path' && !network) return null
  const strokeProfile = sanitizeStrokeProfile(source.strokeProfile)
  const brush = sanitizeBrushSettings(source.brush)
  const effects = sanitizeEffects(source.effects)
  const blendMode = sanitizeBlendMode(source.blendMode)
  const adjustments = sanitizeAdjustments(source.adjustments)
  const regionsOff = Array.isArray(source.regionsOff) ? source.regionsOff.filter((key): key is string => typeof key === 'string').slice(0, 256) : []
  return {
    id: source.id,
    kind,
    name: source.name.slice(0, 120),
    x: source.x!,
    y: source.y!,
    width: Math.max(1, source.width!),
    height: Math.max(1, source.height!),
    rotation: source.kind === 'group' ? 0 : source.rotation!,
    fill,
    stroke,
    strokeWidth: Math.max(0, source.strokeWidth!),
    opacity: Math.min(1, Math.max(0, source.opacity!)),
    visible: source.visible !== false,
    locked: source.locked === true,
    ...(network ? { network } : {}),
    ...(regionsOff.length ? { regionsOff } : {}),
    ...(fills ? { fills } : {}),
    ...(strokes ? { strokes } : {}),
    ...(source.strokeAlign === 'inside' || source.strokeAlign === 'outside' ? { strokeAlign: source.strokeAlign } : {}),
    ...(source.strokeCap === 'round' || source.strokeCap === 'square' ? { strokeCap: source.strokeCap } : {}),
    ...(source.strokeJoin === 'round' || source.strokeJoin === 'bevel' ? { strokeJoin: source.strokeJoin } : {}),
    ...(Array.isArray(source.strokeDash) && source.strokeDash.length === 2 && source.strokeDash.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0) && source.strokeDash[0]! > 0 ? { strokeDash: [source.strokeDash[0]!, source.strokeDash[1]!] as [number, number] } : {}),
    ...(isArrowhead(source.strokeArrowStart) ? { strokeArrowStart: source.strokeArrowStart } : {}),
    ...(isArrowhead(source.strokeArrowEnd) ? { strokeArrowEnd: source.strokeArrowEnd } : {}),
    ...(strokeSides ? { strokeSides } : {}),
    ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    ...(typeof source.cornerSmoothing === 'number' && Number.isFinite(source.cornerSmoothing) && source.cornerSmoothing > 0 ? { cornerSmoothing: Math.min(1, source.cornerSmoothing) } : {}),
    ...(typeof source.parentId === 'string' && source.parentId ? { parentId: source.parentId } : {}),
    ...(strokeProfile ? { strokeProfile } : {}),
    ...(brush ? { brush } : {}),
    ...(effects ? { effects } : {}),
    ...(blendMode ? { blendMode } : {}),
    ...(source.kind === 'image' && adjustments ? { adjustments } : {}),
    ...(typeof source.effectStyleId === 'string' && source.effectStyleId ? { effectStyleId: source.effectStyleId } : {}),
    ...(typeof source.fillStyleId === 'string' && source.fillStyleId ? { fillStyleId: source.fillStyleId } : {}),
    ...(typeof source.strokeStyleId === 'string' && source.strokeStyleId ? { strokeStyleId: source.strokeStyleId } : {}),
    ...(source.kind === 'text' ? sanitizeTextProperties(source, families) : {}),
    ...(source.kind === 'frame' ? { clipContent: source.clipContent !== false } : {}),
    ...(source.kind === 'image' ? sanitizeImageProperties(source) : {}),
    ...(source.kind === 'polygon' && !source.network ? polygonProperties(source) : {}),
    ...(source.kind === 'boolean' ? { operation: BOOLEAN_OPERATIONS.includes(source.operation as never) ? source.operation : 'unite' } : {}),
    ...(source.mask === true ? { mask: true as const } : {}),
    ...(source.kind === 'instance' && typeof source.componentId === 'string' && source.componentId ? { componentId: source.componentId } : {}),
    ...(source.kind === 'instance' ? sanitizeOverrides(source.overrides) : {}),
    ...(source.kind === 'ellipse' && !source.network ? sanitizeArc(source) : {}),
  }
}

function sanitizeTextProperties(source: Partial<VectorElement>, families: Set<string>): Partial<VectorElement> {
  const known = TEXT_FACES.some((face) => face.value === source.fontFamily) || (!!source.fontFamily && families.has(source.fontFamily))
  const number = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  return {
    text: (source.text ?? '').slice(0, MAX_TEXT_LENGTH),
    fontFamily: known ? source.fontFamily! : DEFAULT_TEXT.fontFamily,
    fontSize: number(source.fontSize, 1, 2000, DEFAULT_TEXT.fontSize),
    fontWeight: number(source.fontWeight, 100, 900, DEFAULT_TEXT.fontWeight),
    ...(sanitizeVariations(source.fontVariations) ? { fontVariations: sanitizeVariations(source.fontVariations) } : {}),
    lineHeight: number(source.lineHeight, 0.5, 6, DEFAULT_TEXT.lineHeight),
    letterSpacing: number(source.letterSpacing, -200, 200, DEFAULT_TEXT.letterSpacing),
    textAlign: source.textAlign === 'center' || source.textAlign === 'right' ? source.textAlign : DEFAULT_TEXT.textAlign,
    textSizing: source.textSizing === 'fixed' ? 'fixed' : DEFAULT_TEXT.textSizing,
    ...(sanitizeTextPath(source.textPath) ? { textPath: sanitizeTextPath(source.textPath) } : {}),
    ...(sanitizeFontFeatures(source.fontFeatures) ? { fontFeatures: sanitizeFontFeatures(source.fontFeatures) } : {}),
  }
}

/** Arc settings are only meaningful while the ellipse is still a primitive. */
function sanitizeArc(source: Partial<VectorElement>): Partial<VectorElement> {
  const arc = arcProperties(source)
  if (isFullEllipse(arc)) return {}
  return { arcStart: round(arc.start), arcSweep: round(arc.sweep), arcRatio: round(arc.ratio) }
}

function sanitizeImageProperties(source: Partial<VectorElement>): Partial<VectorElement> {
  const size = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(20000, Math.round(value)) : undefined
  const crop = sanitizeCrop(source.crop)
  return {
    image: source.image,
    ...(source.imageRendering === 'pixelated' ? { imageRendering: 'pixelated' as const } : {}),
    ...(crop ? { crop } : {}),
    ...(size(source.imageWidth) ? { imageWidth: size(source.imageWidth) } : {}),
    ...(size(source.imageHeight) ? { imageHeight: size(source.imageHeight) } : {}),
  }
}

function isArrowhead(value: unknown): value is Exclude<VectorElement['strokeArrowStart'], undefined | 'none'> {
  return value === 'arrow' || value === 'triangle' || value === 'circle' || value === 'square' || value === 'bar'
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
