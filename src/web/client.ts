import { isBatch, isDraft, isResponse, parseManifest, record, type AgentResponse, type FeedbackBatch, type WebDraft, type WebProjectManifest } from './contracts'

export type WebServiceState = { manifest: WebProjectManifest; draft: { revision: number; document: WebDraft | null; savedAt?: string | null }; batches: FeedbackBatch[]; responses: AgentResponse[]; issues: string[]; token: string }
export async function readWebState(): Promise<WebServiceState> {
  const res = await fetch('/api/web/state', { cache: 'no-store' }); const value: unknown = await res.json().catch(() => null)
  if (!res.ok || !record(value) || !record(value.draft) || !Array.isArray(value.batches) || !Array.isArray(value.responses) || !Array.isArray(value.issues) || typeof value.token !== 'string') throw new Error(record(value) && typeof value.error === 'string' ? value.error : 'The local web service is unavailable. Start the Web profile and reconnect.')
  const manifest = parseManifest(value.manifest)
  if (value.draft.document !== null && !isDraft(value.draft.document) || !value.batches.every(isBatch) || !value.responses.every(isResponse)) throw new Error('The service returned invalid feedback data.')
  return { ...value, manifest } as WebServiceState
}
export class SyncConflict extends Error {}
export async function postWeb<T>(endpoint: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/web/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ParamRig-Token': token }, body: JSON.stringify(body) })
  const result = await res.json().catch(() => null) as (T & { error?: string }) | null
  if (!res.ok) { if (res.status === 409) throw new SyncConflict(result?.error ?? 'The saved document changed.'); throw new Error(result?.error ?? 'The project service is offline. Your draft is saved in this browser.') }
  if (result === null) throw new Error('The service returned an unreadable response. Reconnect to continue.')
  return result
}
export type Recovery = { document: WebDraft; diskRevision: number; savedAt: string }
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const request = indexedDB.open('paramrig.web-recovery', 1); request.onupgradeneeded = () => request.result.createObjectStore('drafts'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result) })
}
export async function recovery(id: string, value?: Recovery): Promise<Recovery | null> {
  const db = await database()
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', value ? 'readwrite' : 'readonly')
    const req = value ? tx.objectStore('drafts').put(value, id) : tx.objectStore('drafts').get(id)
    let result: Recovery | null = null
    req.onsuccess = () => { const found = req.result as Recovery | undefined; result = !value && found && isDraft(found.document) ? found : null }
    tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
  }) } finally { db.close() }
}
