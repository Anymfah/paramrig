import type { RigManifest } from '@/rigs/types'
import { sanitizeGuides } from '@/vector/guides'
import { buildTree, descendantIds, sanitizeParents, type TreeNode } from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorElementKind, VectorExportPreset } from '@/vector/types'
import { sanitizeNetwork } from '@/vector/network'
import { DEFAULT_TEXT, MAX_TEXT_LENGTH, TEXT_FACES } from '@/vector/text'
import { sanitizePaints } from '@/vector/paints'
import { sanitizeAdjustments, sanitizeBlendMode, sanitizeEffects } from '@/vector/effects'
import { sanitizeCrop } from '@/vector/crop'
import { sanitizeStrokeProfile } from '@/vector/strokeProfile'
import { BOOLEAN_OPERATIONS, syncBooleanGroups } from '@/vector/booleanGroups'
import { arcProperties, isFullEllipse, MAX_SIDES, MIN_SIDES, polygonProperties } from '@/vector/shapes'
import { MAX_RECENT_COLORS, MAX_SWATCHES, pruneStyleLinks, sanitizeColorList, sanitizeStyles } from '@/vector/styles'
import { defsToSvg, layersToSvg, renderModel } from '@/vector/render'
import { backdropBlur } from '@/vector/filters'
import { selectionBounds } from '@/vector/geometry'

const STORAGE_KEY = 'paramrig.vector-documents.v1'
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 600
const DEFAULT_BACKGROUND = '#151516'
export const DEFAULT_SHAPE_FILL = '#1C1D1E'
const DEFAULT_PATH_STROKE = '#D4E7E1'
export const DEFAULT_TEXT_FILL = '#D4E7E1'
export const DEFAULT_FRAME_FILL = '#E9EEED'
export const MAX_DOCUMENT_SIZE = 10000

function readAll(): Record<string, VectorDocument> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, document]) => {
        const valid = sanitizeVectorDocument(document)
        return valid && valid.id === id ? [[id, valid]] : []
      }),
    )
  } catch {
    return {}
  }
}

/** Outcome of a browser-storage write, so callers can tell the user when a draft did not land. */
export type StorageResult = { ok: true } | { ok: false; reason: 'quota' | 'unavailable' }

function writeAll(documents: Record<string, VectorDocument>): StorageResult {
  if (typeof localStorage === 'undefined') return { ok: false, reason: 'unavailable' }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documents))
    return { ok: true }
  } catch (error) {
    /* Editing remains available in memory when storage is full or blocked. */
    return { ok: false, reason: isQuotaError(error) ? 'quota' : 'unavailable' }
  }
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, code } = error as { name?: unknown; code?: unknown }
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014
}

export const STORAGE_FULL_MESSAGE = 'Browser storage is full. Save this project to a file to keep your changes.'
export const STORAGE_BLOCKED_MESSAGE = 'Browser storage is unavailable. Save this project to a file to keep your changes.'

export function storageMessage(result: StorageResult): string | null {
  if (result.ok) return null
  return result.reason === 'quota' ? STORAGE_FULL_MESSAGE : STORAGE_BLOCKED_MESSAGE
}

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
  saveVectorDocument(document)
  return document
}

export function listVectorDocuments(): VectorDocument[] {
  return Object.values(readAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getVectorDocument(id: string): VectorDocument | null {
  return readAll()[id] ?? null
}

export function saveVectorDocument(document: VectorDocument): StorageResult {
  const documents = readAll()
  documents[document.id] = sanitizeVectorDocument(document) ?? document
  return writeAll(documents)
}

export function vectorManifest(document: VectorDocument): RigManifest {
  const count = document.elements.filter((element) => element.kind !== 'group').length
  return {
    id: document.id,
    name: document.name,
    summary: `Vector · ${count} ${count === 1 ? 'layer' : 'layers'}`,
    description: '',
    renderer: 'vector',
    rendererLabel: 'Vector',
    collection: 'project',
    title: 'Projects/Vector',
    sourceFile: 'Local document',
    tags: ['vector', 'svg', 'project'],
    groups: [],
    parameters: [],
  }
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
  }
}

export function serializeVectorDocument(document: VectorDocument): string {
  return serializeVectorMarkup(document.elements, { x: 0, y: 0, width: document.width, height: document.height })
}

/** SVG for a subset of a document over an arbitrary box, with an optional painted background. */
export function serializeVectorMarkup(
  elements: VectorElement[],
  viewBox: { x: number; y: number; width: number; height: number },
  background?: string,
): string {
  const defs: string[] = []
  const lines = serializeNodes(buildTree(elements), 1, defs, elements)
  const body = lines.join('\n')
  // A baked backdrop repeats the defs of what it copies; the same string twice is the same def.
  const unique = [...new Set(defs)]
  const defsMarkup = unique.length ? `  <defs>${unique.join('')}</defs>\n` : ''
  const width = round(viewBox.width)
  const height = round(viewBox.height)
  const paint = background
    ? `  <rect x="${round(viewBox.x)}" y="${round(viewBox.y)}" width="${width}" height="${height}" fill="${escapeXml(background)}"/>\n`
    : ''
  // A profiled stroke has no SVG equivalent: it leaves as the shape it sweeps, and the file says so.
  const flattened = elements.some((element) => element.strokeProfile)
    ? '  <!-- Variable-width strokes are flattened to filled paths: SVG has no equivalent. -->\n'
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(viewBox.x)} ${round(viewBox.y)} ${width} ${height}" width="${width}" height="${height}">\n${flattened}${defsMarkup}${paint}${body}${body ? '\n' : ''}</svg>\n`
}

/** Markup for one element's paint layers plus the defs it needs; used by exports and thumbnails. */
export function elementMarkup(element: VectorElement, prefix: string): { defs: string; body: string } {
  const model = renderModel(element, prefix)
  return { defs: defsToSvg(model.defs), body: layersToSvg(model, element.id) }
}

/**
 * Inline SVG markup for a document preview: the same serialisation the export uses, without the
 * `<svg>` wrapper. Sharing the one path is what keeps a thumbnail honest — frames clip, masks cut,
 * effects paint and a frosted pane frosts, instead of a flat pile of leaves that shows none of it.
 */
export function documentThumbnail(document: Pick<VectorDocument, 'id' | 'elements'>): string {
  const defs: string[] = []
  const body = serializeNodes(buildTree(document.elements), 0, defs, document.elements).join('')
  const unique = [...new Set(defs)]
  return `${unique.length ? `<defs>${unique.join('')}</defs>` : ''}${body}`
}

function serializeNodes(nodes: TreeNode[], depth: number, defs: string[], scene: VectorElement[]): string[] {
  const indent = '  '.repeat(depth)
  return nodes.flatMap((node) => {
    const element = node.element
    if (!element.visible) return []
    const backdrop = backdropMarkup(scene, element, depth, defs)
    if (element.kind === 'frame') {
      const model = renderModel(element, 'svg')
      const background = defsToSvg(model.defs)
      if (background) defs.push(background)
      const children = serializeNodes(node.children, depth + 1, defs, scene)
      const opacity = element.opacity === 1 ? '' : ` opacity="${element.opacity}"`
      const body = layersToSvg(model, element.id)
      if (element.clipContent && children.length) {
        const clipId = `frame-clip-${element.id}`
        defs.push(`<clipPath id="${escapeXml(clipId)}"><path d="${model.d}" transform="${model.transform}"/></clipPath>`)
        return [
          ...backdrop,
          `${indent}<g id="${escapeXml(element.id)}"${opacity}>`,
          ...(body ? [`${indent}  ${body}`] : []),
          `${indent}  <g clip-path="url(#${escapeXml(clipId)})">`,
          ...children,
          `${indent}  </g>`,
          `${indent}</g>`,
        ]
      }
      return [...backdrop, `${indent}<g id="${escapeXml(element.id)}"${opacity}${effectAttributes(element)}>`, ...(body ? [`${indent}  ${body}`] : []), ...children, `${indent}</g>`]
    }
    if (element.kind === 'group') {
      const maskNode = node.children[0]?.element.mask ? node.children[0]! : null
      const children = serializeNodes(maskNode ? node.children.slice(1) : node.children, depth + 1, defs, scene)
      if (children.length === 0) return []
      const opacity = element.opacity === 1 ? '' : ` opacity="${element.opacity}"`
      if (maskNode) {
        const model = renderModel(maskNode.element, 'svg')
        const clipId = `mask-${element.id}`
        defs.push(`<clipPath id="${escapeXml(clipId)}"><path d="${model.fillD || model.d}" transform="${model.transform}" clip-rule="evenodd"/></clipPath>`)
        return [
          ...backdrop,
          `${indent}<g id="${escapeXml(element.id)}"${opacity} clip-path="url(#${escapeXml(clipId)})">`,
          ...children,
          `${indent}</g>`,
        ]
      }
      return [...backdrop, `${indent}<g id="${escapeXml(element.id)}"${opacity}>`, ...children, `${indent}</g>`]
    }
    if (element.kind === 'boolean') {
      // The combined shape is what the file carries; its members are not exported.
      const markup = elementMarkup(element, 'svg')
      if (markup.defs) defs.push(markup.defs)
      if (!markup.body) return []
      const opacity = element.opacity === 1 ? '' : ` opacity="${element.opacity}"`
      return [...backdrop, `${indent}<g id="${escapeXml(element.id)}"${opacity}${effectAttributes(element)}>${markup.body}</g>`]
    }
    // Only a plain box or a whole ellipse takes the short export path.
    const sliced = element.kind === 'ellipse' && !isFullEllipse(arcProperties(element))
    const simple = !element.effects?.length && !element.blendMode && !element.strokeProfile && element.kind !== 'text' && element.kind !== 'image' && element.kind !== 'polygon' && !sliced && !element.network && !element.fills && !element.strokes && !element.strokeAlign && !element.strokeCap && !element.strokeJoin && !element.strokeDash
      && !element.strokeArrowStart && !element.strokeArrowEnd && !element.strokeSides && !element.cornerRadius
    const transform = `rotate(${element.rotation} ${round(element.x + element.width / 2)} ${round(element.y + element.height / 2)})`
    if (simple) {
      const common = [
        `fill="${escapeXml(element.fill)}"`,
        `stroke="${escapeXml(element.stroke)}"`,
        `stroke-width="${element.strokeWidth}"`,
        `opacity="${element.opacity}"`,
        `transform="${transform}"`,
      ].join(' ')
      if (element.kind === 'ellipse') {
        return [...backdrop, `${indent}<ellipse id="${escapeXml(element.id)}" cx="${round(element.x + element.width / 2)}" cy="${round(element.y + element.height / 2)}" rx="${round(element.width / 2)}" ry="${round(element.height / 2)}" ${common}/>`]
      }
      return [...backdrop, `${indent}<rect id="${escapeXml(element.id)}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" ${common}/>`]
    }
    const markup = elementMarkup(element, 'svg')
    if (markup.defs) defs.push(markup.defs)
    if (!markup.body) return []
    const opacity = element.opacity === 1 ? '' : ` opacity="${element.opacity}"`
    return [...backdrop, `${indent}<g id="${escapeXml(element.id)}"${opacity}${effectAttributes(element)}>${markup.body}</g>`]
  })
}

/**
 * A background blur has nothing to sample in SVG: the format has no backdrop. At export it is
 * baked instead — everything painted under the element is copied, blurred as a whole and clipped
 * to the element's own shape, then dropped in just below it. The copies lose their own background
 * blurs, so a stack of frosted panes flattens rather than multiplying the file.
 */
function backdropMarkup(scene: VectorElement[], element: VectorElement, depth: number, defs: string[]): string[] {
  const blur = backdropBlur(element)
  if (!blur || !element.visible) return []
  const index = scene.findIndex((item) => item.id === element.id)
  if (index <= 0) return []
  const own = new Set([element.id, ...descendantIds(scene, element.id)])
  const below = scene.slice(0, index).filter((item) => item.visible && !own.has(item.id))
  if (below.length === 0) return []
  const kept = new Set(below.map((item) => item.id))
  // The copies are renamed, so the file never carries the same id — or the same def — twice.
  const copyId = (id: string) => `bd-${element.id}-${id}`
  const copies = below.map((item) => {
    const effects = item.effects?.filter((effect) => effect.kind !== 'backgroundBlur')
    const parentId = item.parentId && kept.has(item.parentId) ? copyId(item.parentId) : undefined
    return { ...item, id: copyId(item.id), ...(effects?.length ? { effects } : { effects: undefined }), parentId }
  })
  const model = renderModel(element, 'svg')
  const clipId = `backdrop-clip-${element.id}`
  const filterId = `backdrop-blur-${element.id}`
  // The region reaches past the shape by three sigma so the blur inside it samples what it should.
  const box = selectionBounds([element])
  const margin = blur * 3
  defs.push(`<clipPath id="${escapeXml(clipId)}"><path d="${model.fillD || model.d}" transform="${model.transform}" clip-rule="evenodd"/></clipPath>`)
  defs.push(`<filter id="${escapeXml(filterId)}" filterUnits="userSpaceOnUse" x="${round(box.x - margin)}" y="${round(box.y - margin)}" width="${round(box.width + margin * 2)}" height="${round(box.height + margin * 2)}"><feGaussianBlur stdDeviation="${round(blur / 2)}"/></filter>`)
  const indent = '  '.repeat(depth)
  return [
    `${indent}<g clip-path="url(#${escapeXml(clipId)})" filter="url(#${escapeXml(filterId)})" aria-hidden="true">`,
    ...serializeNodes(buildTree(copies), depth + 1, defs, copies),
    `${indent}</g>`,
  ]
}

/** The filter and blend attributes an element's effects put on its wrapper. */
function effectAttributes(element: VectorElement, prefix = 'svg'): string {
  const model = renderModel(element, prefix)
  const blend = model.blend ? ` style="mix-blend-mode:${model.blend}"` : ''
  return `${model.filter ? ` filter="${escapeXml(model.filter)}"` : ''}${blend}`
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

export function sanitizeVectorDocument(value: unknown): VectorDocument | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VectorDocument>
  if (source.version !== 1 || typeof source.id !== 'string' || typeof source.name !== 'string') return null
  if (!finiteIn(source.width, 1, MAX_DOCUMENT_SIZE) || !finiteIn(source.height, 1, MAX_DOCUMENT_SIZE)) return null
  if (!Array.isArray(source.elements)) return null
  const seen = new Set<string>()
  const elements = source.elements.flatMap((element) => {
    const valid = sanitizeElement(element)
    if (!valid || seen.has(valid.id)) return []
    seen.add(valid.id)
    return [valid]
  })
  const styles = sanitizeStyles(source.styles)
  return {
    version: 1,
    id: source.id,
    name: source.name.slice(0, 120) || 'Untitled',
    background: typeof source.background === 'string' && /^#[0-9a-f]{6}$/i.test(source.background) ? source.background.toUpperCase() : DEFAULT_BACKGROUND,
    width: source.width,
    height: source.height,
    elements: syncBooleanGroups(pruneStyleLinks(sanitizeParents(elements), styles ?? [])),
    guides: sanitizeGuides(source.guides),
    ...(Array.isArray(source.versions) && source.versions.length ? { versions: sanitizeVersions(source.versions) } : {}),
    ...(source.exportPresets ? { exportPresets: sanitizeExportPresets(source.exportPresets) } : {}),
    ...(styles ? { styles } : {}),
    ...(sanitizeColorList(source.swatches, MAX_SWATCHES) ? { swatches: sanitizeColorList(source.swatches, MAX_SWATCHES) } : {}),
    ...(sanitizeColorList(source.recentColors, MAX_RECENT_COLORS) ? { recentColors: sanitizeColorList(source.recentColors, MAX_RECENT_COLORS) } : {}),
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
    const format = source.format === 'png' ? 'png' : 'svg'
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

function sanitizeElement(value: unknown): VectorElement | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<VectorElement>
  const KINDS: VectorElementKind[] = ['rectangle', 'ellipse', 'path', 'group', 'text', 'frame', 'image', 'polygon', 'boolean']
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
    ...(effects ? { effects } : {}),
    ...(blendMode ? { blendMode } : {}),
    ...(source.kind === 'image' && adjustments ? { adjustments } : {}),
    ...(typeof source.effectStyleId === 'string' && source.effectStyleId ? { effectStyleId: source.effectStyleId } : {}),
    ...(typeof source.fillStyleId === 'string' && source.fillStyleId ? { fillStyleId: source.fillStyleId } : {}),
    ...(typeof source.strokeStyleId === 'string' && source.strokeStyleId ? { strokeStyleId: source.strokeStyleId } : {}),
    ...(source.kind === 'text' ? sanitizeTextProperties(source) : {}),
    ...(source.kind === 'frame' ? { clipContent: source.clipContent !== false } : {}),
    ...(source.kind === 'image' ? sanitizeImageProperties(source) : {}),
    ...(source.kind === 'polygon' && !source.network ? polygonProperties(source) : {}),
    ...(source.kind === 'boolean' ? { operation: BOOLEAN_OPERATIONS.includes(source.operation as never) ? source.operation : 'unite' } : {}),
    ...(source.mask === true ? { mask: true as const } : {}),
    ...(source.kind === 'ellipse' && !source.network ? sanitizeArc(source) : {}),
  }
}

function sanitizeTextProperties(source: Partial<VectorElement>): Partial<VectorElement> {
  const known = TEXT_FACES.some((face) => face.value === source.fontFamily)
  const number = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  return {
    text: (source.text ?? '').slice(0, MAX_TEXT_LENGTH),
    fontFamily: known ? source.fontFamily! : DEFAULT_TEXT.fontFamily,
    fontSize: number(source.fontSize, 1, 2000, DEFAULT_TEXT.fontSize),
    fontWeight: number(source.fontWeight, 100, 900, DEFAULT_TEXT.fontWeight),
    lineHeight: number(source.lineHeight, 0.5, 6, DEFAULT_TEXT.lineHeight),
    letterSpacing: number(source.letterSpacing, -200, 200, DEFAULT_TEXT.letterSpacing),
    textAlign: source.textAlign === 'center' || source.textAlign === 'right' ? source.textAlign : DEFAULT_TEXT.textAlign,
    textSizing: source.textSizing === 'fixed' ? 'fixed' : DEFAULT_TEXT.textSizing,
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

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
