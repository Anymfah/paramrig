import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isDraft, type FeedbackBatch, type WebDraft, type WebProjectManifest } from './contracts'
import { postWeb, readWebState, recovery, SyncConflict, type Recovery, type WebServiceState } from './client'
import { rememberWebProject } from './projects'
import { WebSession } from './session'

export function useWebDocument(manifest: WebProjectManifest) {
  const [session] = useState(() => new WebSession(manifest))
  const revision = useSyncExternalStore(session.subscribe, session.getRevision, session.getRevision)
  const [service, setService] = useState<WebServiceState | null>(null)
  const [syncStatus, setSyncStatus] = useState('Connecting to project files')
  const [error, setError] = useState<string | null>(null)
  const [recovered, setRecovered] = useState<Recovery | null>(null)
  const state = useRef({ loaded: false, canRecover: false, disposed: false, saving: false, blocked: false, diskRevision: 0, saved: '', token: '', timer: 0, service: null as WebServiceState | null })
  const [retry, setRetry] = useState(0)

  const save = useCallback(async () => {
    const s = state.current
    if (s.saving || s.disposed || s.blocked || session.isGesturing || !s.canRecover) return
    const json = JSON.stringify(session.document)
    try { await recovery(manifest.id, { document: session.document, diskRevision: s.diskRevision, savedAt: new Date().toISOString() }) } catch { setError('Browser recovery is unavailable. Keep the local service connected to save your work.') }
    if (!s.loaded || s.blocked || json === s.saved || !s.token) return
    s.saving = true; setSyncStatus('Saving feedback')
    try {
      const result = await postWeb<{ revision: number; document: WebDraft }>('draft', s.token, { expectedRevision: s.diskRevision, document: JSON.parse(json) })
      s.diskRevision = result.revision; s.saved = json; setSyncStatus('Saved to project'); setError(null)
      await recovery(manifest.id, { document: session.document, diskRevision: s.diskRevision, savedAt: new Date().toISOString() })
    } catch (e) {
      if (e instanceof SyncConflict) s.blocked = true
      setSyncStatus(e instanceof SyncConflict ? 'Save conflict' : 'Saved in browser · project offline')
      setError(e instanceof Error ? e.message : 'The project could not be saved.')
    } finally { s.saving = false }
  }, [manifest.id, session])

  useEffect(() => {
    const s = state.current; s.disposed = false
    const changed = () => { window.clearTimeout(s.timer); s.timer = window.setTimeout(() => void save(), 350) }
    const unsubscribe = session.subscribe(changed)
    // Retry pending changes after a failed request, or after a change during an in-flight write.
    const interval = window.setInterval(() => { if (JSON.stringify(session.document) !== s.saved) void save() }, 2000)
    return () => { s.disposed = true; window.clearInterval(interval); window.clearTimeout(s.timer); unsubscribe() }
  }, [save, session])

  useEffect(() => {
    let cancelled = false
    const s = state.current
    const load = async () => {
      try {
        const next = await readWebState()
        if (cancelled) return
        if (next.manifest.id !== manifest.id) throw new Error('The local service is connected to a different project. Reconnect its project folder to continue.')
        const local = !s.loaded ? await recovery(manifest.id).catch(() => null) : null
        if (cancelled) return
        s.token = next.token; s.service = next; setService(next); rememberWebProject(next.manifest)
        if (!s.loaded) {
          s.diskRevision = next.draft.revision
          if (next.draft.document) session.recover(next.draft.document)
          s.saved = JSON.stringify(session.document); s.loaded = true; s.canRecover = true
          if (local && JSON.stringify(local.document) !== s.saved) { s.blocked = true; setRecovered(local); setSyncStatus('Browser recovery available'); setError(null) }
          else { setSyncStatus('Saved to project'); setError(null) }
        } else if (!s.saving && next.draft.revision > s.diskRevision) {
          s.blocked = true; setSyncStatus('Project changed elsewhere'); setError('The project draft changed outside this window. Choose which draft to keep.'); setRecovered({ document: session.document, diskRevision: s.diskRevision, savedAt: new Date().toISOString() })
        }
        if (next.issues.length) setError(next.issues.join(' '))
      } catch (e) {
        if (cancelled) return
        setSyncStatus('Project offline'); setError(e instanceof Error ? e.message : 'Connection failed.')
        if (!s.loaded) {
          const local = await recovery(manifest.id).catch(() => null)
          if (!cancelled) { s.canRecover = true; if (local) { session.recover(local.document); setSyncStatus('Recovered in browser · project offline') } }
        }
      }
    }
    void load()
    const events = new EventSource('/api/web/events')
    events.addEventListener('change', load)
    events.onopen = () => { if (s.loaded || s.canRecover) void load() }
    events.onerror = () => { if (!cancelled) setSyncStatus('Project connection interrupted') }
    return () => { cancelled = true; events.close() }
  }, [manifest.id, retry, session])

  const chooseRecovery = async (useBrowser: boolean) => {
    const current = await readWebState()
    if (current.manifest.id !== manifest.id) throw new Error('Reconnect this project first.')
    const s = state.current
    s.diskRevision = current.draft.revision; s.token = current.token; s.blocked = false
    const document = useBrowser ? recovered?.document : current.draft.document
    if (document && isDraft(document)) session.recover(document)
    s.saved = useBrowser ? '' : JSON.stringify(session.document)
    setRecovered(null); setError(null); await save()
  }
  const publish = async (batch: FeedbackBatch) => {
    if (state.current.blocked) throw new Error('Resolve the save conflict before validating feedback.')
    await postWeb('batches', state.current.token, batch)
    session.markPublished(batch); await save()
    setRetry(n => n + 1)
  }
  const upload = async (id: string, dataUrl: string) => postWeb<{ file: string }>('captures', state.current.token, { id, dataUrl })
  return { session, revision, service, syncStatus, error, setError, recovered, chooseRecovery, publish, upload, reconnect: () => setRetry(n => n + 1), save }
}
