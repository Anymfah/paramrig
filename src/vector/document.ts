import { syncBooleanGroups } from './booleanGroups'
export * from './serialization'
import { readStore, writeDocument, storageMessage, type StorageResult } from '@/editor/storage'
import type { RigManifest } from '@/rigs/types'
import type { VectorDocument } from '@/vector/types'
import { BUNDLED_DOCUMENTS } from '@/rigs/examples/aperture-mark'
import { createVectorDocument as createDocument, sanitizeVectorDocument as sanitizeDocument } from '@paramrig/vector'
export * from '@paramrig/vector/model'
export { STORAGE_BLOCKED_MESSAGE, STORAGE_FULL_MESSAGE, storageMessage, type StorageResult } from '@/editor/storage'

const STORAGE_KEY = 'paramrig.vector-documents.v1'

function readAll(): Record<string, VectorDocument> {
  return readStore(STORAGE_KEY, sanitizeVectorDocument)
}



export function createVectorDocument(): VectorDocument {
  const document = createDocument()
  const saved = saveVectorDocument(document)
  if (!saved.ok) throw new Error(storageMessage(saved) ?? "The document could not be saved.")
  return document
}

/**
 * Every document this browser can open: the ones it has stored, plus the ones that ship with the
 * app and have not been edited yet. A bundled document becomes an ordinary stored one the moment
 * it is changed.
 */
export function listVectorDocuments(): VectorDocument[] {
  const stored = readAll()
  const bundled = BUNDLED_DOCUMENTS.filter((document) => !stored[document.id]).flatMap((document) => {
    const valid = sanitizeVectorDocument(document)
    return valid ? [valid] : []
  })
  return [...Object.values(stored), ...bundled].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getVectorDocument(id: string): VectorDocument | null {
  const stored = readAll()[id]
  if (stored) return stored
  const bundled = BUNDLED_DOCUMENTS.find((document) => document.id === id)
  return bundled ? sanitizeVectorDocument(bundled) : null
}

/**
 * Whether a document is one of the app's own examples rather than one of this browser's.
 *
 * The storage check is the whole of it, and `listVectorDocuments` above has always read the same
 * way: an example that has been changed is this browser's document now, and saying otherwise made
 * the library file it under Examples while its `sourceFile` claimed a file that no longer describes
 * it. The scene documents have answered this question this way from the start.
 */
export function isBundledDocument(id: string): boolean {
  return BUNDLED_DOCUMENTS.some((document) => document.id === id) && !readAll()[id]
}

/** Whether a document is a bundled one that nothing has altered, down to the last number. */
function unchangedBundle(document: VectorDocument): boolean {
  const shipped = BUNDLED_DOCUMENTS.find((entry) => entry.id === document.id)
  return !!shipped && JSON.stringify(sanitizeVectorDocument(shipped) ?? shipped) === JSON.stringify(document)
}

export function saveVectorDocument(document: VectorDocument): StorageResult {
  const documents = readAll()
  /*
   * Opening a bundled example is not editing it. The editor saves whatever it loads, so without
   * this a drawing the app ships would be copied into storage by being looked at — and would then
   * be listed as a project of this browser's rather than as the example it still is.
   */
  if (!documents[document.id] && unchangedBundle(document)) return { ok: true }
  documents[document.id] = sanitizeVectorDocument(document) ?? document
  return writeDocument(STORAGE_KEY, document.id, documents[document.id])
}

/**
 * The document as the rest of the workbench sees it. A document that exposes controls carries them
 * here, so a `RigSession` built from this manifest works the way it does for every other rig.
 */
export function vectorManifest(document: VectorDocument): RigManifest {
  const count = document.elements.filter((element) => element.kind !== 'group').length
  const rig = document.rig
  const controls = rig?.parameters.length ?? 0
  const bundled = isBundledDocument(document.id)
  return {
    id: document.id,
    name: document.name,
    summary: controls > 0
      ? `Vector · ${controls} ${controls === 1 ? 'control' : 'controls'}`
      : `Vector · ${count} ${count === 1 ? 'layer' : 'layers'}`,
    description: '',
    renderer: 'vector',
    rendererLabel: 'Vector',
    collection: bundled ? 'examples' : 'project',
    title: bundled ? 'Examples/Vector' : 'Projects/Vector',
    sourceFile: bundled ? `src/rigs/examples/${document.id.replace(/^(?:vector-)?example-/, '')}.ts` : 'Local document',
    tags: ['vector', 'svg', bundled ? 'example' : 'project', ...(controls > 0 ? ['rig'] : [])],
    groups: rig?.groups ?? [],
    parameters: rig?.parameters ?? [],
    ...(rig?.inspectorCategories ? { inspectorCategories: rig.inspectorCategories } : {}),
  }
}


export function sanitizeVectorDocument(value: unknown): VectorDocument | null { return sanitizeDocument(value, syncBooleanGroups) }
