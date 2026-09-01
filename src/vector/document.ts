import type { RigManifest } from '@/rigs/types'
import { sanitizeGuides } from '@/vector/guides'
import { buildTree, sanitizeParents, type TreeNode } from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorElementKind, VectorNode } from '@/vector/types'
import { isClosedPath, vectorPathData } from '@/vector/vectorPath'

const STORAGE_KEY = 'paramrig.vector-documents.v1'
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 600
const DEFAULT_BACKGROUND = '#151516'
const DEFAULT_SHAPE_FILL = '#1C1D1E'
const DEFAULT_PATH_STROKE = '#D4E7E1'
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

function writeAll(documents: Record<string, VectorDocument>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documents))
  } catch {
    /* Editing remains available in memory when storage is unavailable. */
  }
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

export function saveVectorDocument(document: VectorDocument): void {
  const documents = readAll()
  documents[document.id] = sanitizeVectorDocument(document) ?? document
  writeAll(documents)
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

export type CreateElementOptions = Partial<Pick<VectorElement, 'name' | 'fill' | 'stroke' | 'strokeWidth' | 'vectorNodes' | 'closed'>>

export function createVectorElement(
  kind: VectorElementKind,
  bounds: { x: number; y: number; width: number; height: number },
  options: CreateElementOptions = {},
): VectorElement {
  const isPath = kind === 'path'
  const isGroup = kind === 'group'
  const element: VectorElement = {
    id: crypto.randomUUID(),
    kind,
    name: options.name ?? defaultName(kind),
    x: round(bounds.x),
    y: round(bounds.y),
    width: Math.max(1, round(bounds.width)),
    height: Math.max(1, round(bounds.height)),
    rotation: 0,
    fill: options.fill ?? (isPath || isGroup ? 'none' : DEFAULT_SHAPE_FILL),
    stroke: options.stroke ?? (isPath ? DEFAULT_PATH_STROKE : isGroup ? 'none' : DEFAULT_SHAPE_FILL),
    strokeWidth: options.strokeWidth ?? (isPath ? 2 : 0),
    opacity: 1,
    visible: true,
    locked: false,
  }
  if (options.vectorNodes) element.vectorNodes = options.vectorNodes
  if (isPath && options.closed === false) element.closed = false
  return element
}

function defaultName(kind: VectorElementKind): string {
  switch (kind) {
    case 'rectangle': return 'Rectangle'
    case 'ellipse': return 'Ellipse'
    case 'path': return 'Path'
    case 'group': return 'Group'
  }
}

export function serializeVectorDocument(document: VectorDocument): string {
  const lines = serializeNodes(buildTree(document.elements), 1)
  const body = lines.join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${document.width} ${document.height}" width="${document.width}" height="${document.height}">\n${body}${body ? '\n' : ''}</svg>\n`
}

function serializeNodes(nodes: TreeNode[], depth: number): string[] {
  const indent = '  '.repeat(depth)
  return nodes.flatMap((node) => {
    const element = node.element
    if (!element.visible) return []
    if (element.kind === 'group') {
      const children = serializeNodes(node.children, depth + 1)
      if (children.length === 0) return []
      const opacity = element.opacity === 1 ? '' : ` opacity="${element.opacity}"`
      return [`${indent}<g id="${escapeXml(element.id)}"${opacity}>`, ...children, `${indent}</g>`]
    }
    const common = [
      `fill="${escapeXml(element.fill)}"`,
      `stroke="${escapeXml(element.stroke)}"`,
      `stroke-width="${element.strokeWidth}"`,
      `opacity="${element.opacity}"`,
      `transform="rotate(${element.rotation} ${round(element.x + element.width / 2)} ${round(element.y + element.height / 2)})"`,
    ].join(' ')
    if (element.vectorNodes) {
      return [`${indent}<path id="${escapeXml(element.id)}" d="${vectorPathData(element)}" ${common}/>`]
    }
    if (element.kind === 'ellipse') {
      return [`${indent}<ellipse id="${escapeXml(element.id)}" cx="${round(element.x + element.width / 2)}" cy="${round(element.y + element.height / 2)}" rx="${round(element.width / 2)}" ry="${round(element.height / 2)}" ${common}/>`]
    }
    return [`${indent}<rect id="${escapeXml(element.id)}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" ${common}/>`]
  })
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
  return {
    version: 1,
    id: source.id,
    name: source.name.slice(0, 120) || 'Untitled',
    background: typeof source.background === 'string' && /^#[0-9a-f]{6}$/i.test(source.background) ? source.background.toUpperCase() : DEFAULT_BACKGROUND,
    width: source.width,
    height: source.height,
    elements: sanitizeParents(elements),
    guides: sanitizeGuides(source.guides),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date(0).toISOString(),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date(0).toISOString(),
  }
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
  if (source.kind !== 'rectangle' && source.kind !== 'ellipse' && source.kind !== 'path' && source.kind !== 'group') return null
  if (typeof source.id !== 'string' || !source.id || typeof source.name !== 'string') return null
  if (![source.x, source.y, source.width, source.height, source.rotation, source.strokeWidth, source.opacity].every(Number.isFinite)) return null
  const fill = sanitizePaint(source.fill)
  const stroke = sanitizePaint(source.stroke)
  if (!fill || !stroke) return null
  const vectorNodes = source.kind === 'group' ? null : sanitizeNodes(source.vectorNodes)
  if (source.kind === 'path' && !vectorNodes) return null
  const closed = source.kind === 'path' && source.closed === false ? false : undefined
  if (closed === false && vectorNodes && vectorNodes.length < 2) return null
  if (closed !== false && vectorNodes && vectorNodes.length < 3) return null
  return {
    id: source.id,
    kind: source.kind,
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
    ...(vectorNodes ? { vectorNodes } : {}),
    ...(closed === false ? { closed } : {}),
    ...(typeof source.parentId === 'string' && source.parentId ? { parentId: source.parentId } : {}),
  }
}

function sanitizeNodes(value: unknown): VectorNode[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 256) return null
  const point = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return null
    const source = candidate as { x?: unknown; y?: unknown }
    return finiteIn(source.x, -100, 100) && finiteIn(source.y, -100, 100) ? { x: source.x, y: source.y } : null
  }
  const nodes = value.map((candidate) => {
    const anchor = point(candidate)
    if (!anchor) return null
    const source = candidate as { in?: unknown; out?: unknown }
    const input = source.in === undefined ? undefined : point(source.in)
    const output = source.out === undefined ? undefined : point(source.out)
    if (source.in !== undefined && !input || source.out !== undefined && !output) return null
    return { ...anchor, ...(input ? { in: input } : {}), ...(output ? { out: output } : {}) }
  })
  return nodes.every(Boolean) ? nodes as VectorNode[] : null
}

export { isClosedPath }

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
