/**
 * Persisted "Recent" entries. Each one keeps the metadata the library card needs and,
 * where the browser supports it, the File System Access handle that lets a later session
 * write straight back to the same file.
 *
 * One store serves every editor, so the library's Recent list is one list. The database keeps the
 * name it was created with; `projectHandleStore` takes it as a parameter so a second, separate
 * store can exist without touching this one.
 */
const DEFAULT_DB_NAME = 'paramrig.vector-files'
const DB_VERSION = 1
const STORE = 'recent'
const MAX_RECENT = 12
const MAX_THUMBNAIL = 40_000

export type RecentProject = {
  id: string
  name: string
  savedAt: string
  fileName: string | null
  /** Which editor opens it. Entries written before the scene editor carry none, and are vector. */
  kind?: 'vector' | 'scene'
  width?: number
  height?: number
  background?: string
  /** Inline SVG markup, or a small data URL, for the card preview; trimmed when a document is heavy. */
  thumbnail: string | null
  handle?: FileSystemFileHandle
}

export function supportsFileSystemAccess(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
}

export type ProjectHandleStore = {
  listRecentProjects: () => Promise<RecentProject[]>
  rememberProject: (entry: RecentProject) => Promise<void>
  getProjectHandle: (id: string) => Promise<FileSystemFileHandle | null>
  forgetProject: (id: string) => Promise<void>
}

export function projectHandleStore(dbName: string = DEFAULT_DB_NAME): ProjectHandleStore {
  function open(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null)
    return new Promise((resolve) => {
      let request: IDBOpenDBRequest
      try {
        request = indexedDB.open(dbName, DB_VERSION)
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

  const forgetProject = async (id: string): Promise<void> => {
    await run('readwrite', (store) => store.delete(id))
  }

  return {
    listRecentProjects: async () => (await readAll()).slice(0, MAX_RECENT),
    rememberProject: async (entry: RecentProject) => {
      const trimmed: RecentProject = {
        ...entry,
        thumbnail: entry.thumbnail && entry.thumbnail.length <= MAX_THUMBNAIL ? entry.thumbnail : null,
      }
      await run('readwrite', (store) => store.put(trimmed))
      for (const stale of (await readAll()).slice(MAX_RECENT)) await forgetProject(stale.id)
    },
    getProjectHandle: async (id: string) => {
      const entry = await run<RecentProject | undefined>('readonly', (store) => store.get(id) as IDBRequest<RecentProject | undefined>)
      return entry?.handle ?? null
    },
    forgetProject,
  }
}

/** The store every editor shares, so "Recent" is one list across the app. */
export const recentProjects = projectHandleStore()

export const { listRecentProjects, rememberProject, getProjectHandle, forgetProject } = recentProjects
