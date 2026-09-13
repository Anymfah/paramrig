import type { ModuleId, ProjectMetadata } from '@/modules/types'

export const PROJECT_INDEX_KEY = 'paramrig.project-index.v1'
export const DOCUMENT_STORE_KEYS = {
  audio: 'paramrig.audio-documents.v1', vector: 'paramrig.vector-documents.v1',
  scene: 'paramrig.scene-documents.v1', web: 'paramrig.web-projects.v1',
} as const
const byKey = new Map<string, ModuleId>(Object.entries(DOCUMENT_STORE_KEYS).map(([module, key]) => [key, module as ModuleId]))
const labels = { audio: 'Sound', vector: 'Vector', scene: '3D', web: 'Web' }
type Index = { version: 1; fingerprints: Partial<Record<ModuleId, string>>; entries: ProjectMetadata[] }
const empty = (): Index => ({ version: 1, fingerprints: {}, entries: [] })
let current: Index | undefined
let revision = 0
const listeners = new Set<() => void>()
let listening = false

const text = (value: unknown, fallback = '', max = 300) => typeof value === 'string' ? value.slice(0, max) : fallback
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
/** Metadata only. No validation, evaluation, resource read or document rewrite happens here. */
export function projectMetadata(module: ModuleId, key: string, value: unknown): ProjectMetadata {
  const document = object(value) ?? {}
  const name = text(document.name, key, 160)
  const label = labels[module]
  return { id: module === 'web' ? `web-${key}` : key, module, name,
    summary: `${label} · ${module === 'web' ? 'Connected project' : 'Local document'}`,
    description: `${name} — ${label} document`, renderer: module, rendererLabel: label,
    collection: 'project', title: `Projects/${label}`, sourceFile: module === 'web' ? '.paramrig/manifest.json' : `${name}.paramrig.json`,
    tags: [module], updatedAt: text(document.updatedAt, text(document.createdAt)) }
}
function metadataFromStore(module: ModuleId, raw: string): ProjectMetadata[] {
  const parsed: unknown = JSON.parse(raw)
  if (module === 'web') return Array.isArray(parsed) ? parsed.flatMap(value => {
    const entry = object(value); const id = entry && text(entry.id)
    return id ? [projectMetadata(module, id, entry)] : []
  }) : []
  const documents = object(parsed)
  return documents ? Object.entries(documents).map(([key, value]) => projectMetadata(module, key, value)) : []
}
function fingerprint(raw: string): string {
  let a = 2166136261, b = 0x9e3779b9
  for (let i = 0; i < raw.length; i++) { const value = raw.charCodeAt(i); a = Math.imul(a ^ value, 16777619); b = Math.imul(b ^ value, 0x85ebca6b) }
  return `${raw.length}:${a >>> 0}:${b >>> 0}`
}
function readSavedIndex(): Index {
  try {
    const value = object(JSON.parse(localStorage.getItem(PROJECT_INDEX_KEY) ?? 'null'))
    if (value?.version !== 1 || !Array.isArray(value.entries) || !object(value.fingerprints)) return empty()
    // A corrupt index is discarded; the original stores are never touched.
    if (!value.entries.every(item => object(item) && typeof item.id === 'string' && typeof item.name === 'string' && Object.hasOwn(DOCUMENT_STORE_KEYS, item.module) && ['summary', 'description', 'renderer', 'rendererLabel', 'collection', 'title', 'sourceFile'].every(key => typeof item[key] === 'string') && Array.isArray(item.tags) && item.tags.every((tag: unknown) => typeof tag === 'string'))) return empty()
    return value as unknown as Index
  } catch { return empty() }
}
function publish(index: Index) {
  current = index
  try { localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(index)) } catch { /* The reconstructible index cannot invalidate a successful document save. */ }
  revision++
  for (const listener of listeners) listener()
}

/** Check every source at startup or after another tab changes it. Unreadable stores stay untouched. */
export function rebuildProjectIndex(): ProjectMetadata[] {
  const index = current ?? readSavedIndex()
  const next: Index = { version: 1, entries: [...index.entries], fingerprints: { ...index.fingerprints } }
  let changed = !current
  for (const [module, key] of Object.entries(DOCUMENT_STORE_KEYS) as Array<[ModuleId, string]>) {
    try {
      const raw = localStorage.getItem(key) ?? (module === 'web' ? '[]' : '{}')
      const mark = fingerprint(raw)
      if (next.fingerprints[module] === mark) continue
      const entries = metadataFromStore(module, raw)
      next.entries = [...next.entries.filter(entry => entry.module !== module), ...entries]
      next.fingerprints[module] = mark; changed = true
    } catch { /* Keep any known metadata available while its source cannot be read. */ }
  }
  if (changed) publish(next)
  else current = next
  return next.entries
}
export function readProjectIndex(): ProjectMetadata[] { return current?.entries ?? rebuildProjectIndex() }
export function findProjectMetadata(id: string) { return readProjectIndex().find(entry => entry.id === id) }
export function projectIndexRevision() { return revision }

/** Called after a source write succeeds. Already serialised bytes keep the source fingerprint exact. */
export function indexSuccessfulWrite(key: string, raw: string): void {
  const module = byKey.get(key)
  if (!module) return
  try {
    if (!current) rebuildProjectIndex()
    const index = current!
    publish({ version: 1, entries: [...index.entries.filter(entry => entry.module !== module), ...metadataFromStore(module, raw)], fingerprints: { ...index.fingerprints, [module]: fingerprint(raw) } })
  } catch { /* Indexing is strictly secondary to persistence. */ }
}
function onStorage(event: StorageEvent) { if (event.key === null || event.key && byKey.has(event.key)) rebuildProjectIndex() }
export function subscribeProjectIndex(listener: () => void): () => void {
  listeners.add(listener)
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage); listening = true
    // A different tab may have saved while this tab was on a page with no index subscribers.
    rebuildProjectIndex()
  }
  return () => { listeners.delete(listener); if (!listeners.size && listening) { window.removeEventListener('storage', onStorage); listening = false } }
}
export function resetProjectIndexCache(): void { current = undefined; revision++ }
