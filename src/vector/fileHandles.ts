/**
 * Persisted "Recent" entries. Each one keeps the metadata the library card needs and,
 * where the browser supports it, the File System Access handle that lets a later session
 * write straight back to the same file.
 */
const DB_NAME = 'paramrig.vector-files'
const DB_VERSION = 1
const STORE = 'recent'
const MAX_RECENT = 12
const MAX_THUMBNAIL = 40_000

export type RecentProject = {
  id: string
  name: string
  savedAt: string
  fileName: string | null
  width: number
  height: number
  background: string
  /** Inline SVG markup for the card preview, trimmed when a document is heavy. */
  thumbnail: string | null
  handle?: FileSystemFileHandle
}

export function supportsFileSystemAccess(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
}

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function run<Result>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<Result>): Promise<Result | null> {
  return open().then((db) => {
    if (!db) return null
    return new Promise<Result | null>((resolve) => {
      let request: IDBRequest<Result>
      try {
        request = work(db.transaction(STORE, mode).objectStore(STORE))
      } catch {
        db.close()
        resolve(null)
        return
      }
      request.onsuccess = () => {
        resolve(request.result)
        db.close()
      }
      request.onerror = () => {
        resolve(null)
        db.close()
      }
    })
  })
}

async function readAll(): Promise<RecentProject[]> {
  const all = await run<RecentProject[]>('readonly', (store) => store.getAll() as IDBRequest<RecentProject[]>)
  if (!all) return []
  return all
    .filter((entry): entry is RecentProject => !!entry && typeof entry.id === 'string' && typeof entry.name === 'string')
    .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  return (await readAll()).slice(0, MAX_RECENT)
}

export async function rememberProject(entry: RecentProject): Promise<void> {
  const trimmed: RecentProject = {
    ...entry,
    thumbnail: entry.thumbnail && entry.thumbnail.length <= MAX_THUMBNAIL ? entry.thumbnail : null,
  }
  await run('readwrite', (store) => store.put(trimmed))
  for (const stale of (await readAll()).slice(MAX_RECENT)) await forgetProject(stale.id)
}

export async function getProjectHandle(id: string): Promise<FileSystemFileHandle | null> {
  const entry = await run<RecentProject | undefined>('readonly', (store) => store.get(id) as IDBRequest<RecentProject | undefined>)
  return entry?.handle ?? null
}

export async function forgetProject(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id))
}
