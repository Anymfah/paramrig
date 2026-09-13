import { indexSuccessfulWrite } from '@/library/projectIndex'
/** Outcome of a browser-storage write, so callers can tell the user when a draft did not land. */
export type StorageResult = { ok: true } | { ok: false; reason: 'quota' | 'unavailable' }

export const STORAGE_FULL_MESSAGE = 'Browser storage is full. Save this project to a file to keep your changes.'
export const STORAGE_BLOCKED_MESSAGE = 'Browser storage is unavailable. Save this project to a file to keep your changes.'

export function storageMessage(result: StorageResult): string | null {
  if (result.ok) return null
  return result.reason === 'quota' ? STORAGE_FULL_MESSAGE : STORAGE_BLOCKED_MESSAGE
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, code } = error as { name?: unknown; code?: unknown }
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014
}

/** Every document under one storage key, dropping the ones that no longer read back. */
export function readStore<Doc extends { id: string }>(key: string, sanitize: (value: unknown) => Doc | null): Record<string, Doc> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, document]) => {
        const valid = sanitize(document)
        return valid && valid.id === id ? [[id, valid]] : []
      }),
    )
  } catch {
    return {}
  }
}

export function writeStore<Doc>(key: string, documents: Record<string, Doc>): StorageResult {
  if (typeof localStorage === 'undefined') return { ok: false, reason: 'unavailable' }
  try {
    const raw = JSON.stringify(documents)
    localStorage.setItem(key, raw)
    indexSuccessfulWrite(key, raw)
    return { ok: true }
  } catch (error) {
    /* Editing remains available in memory when storage is full or blocked. */
    return { ok: false, reason: isQuotaError(error) ? 'quota' : 'unavailable' }
  }
}

/** Change one document without sanitising or discarding any of its stored neighbours. */
export function writeDocument<Doc>(key: string, id: string, document: Doc | undefined): StorageResult {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ok: false, reason: 'unavailable' }
    const next = { ...stored } as Record<string, unknown>
    if (document === undefined) delete next[id]
    else Object.defineProperty(next, id, { value: document, enumerable: true, configurable: true, writable: true })
    return writeStore(key, next)
  } catch (error) {
    return { ok: false, reason: isQuotaError(error) ? 'quota' : 'unavailable' }
  }
}
