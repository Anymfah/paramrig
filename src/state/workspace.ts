import { useCallback, useSyncExternalStore } from 'react'
import { getRig } from '@/rigs/registry'
import type { PanelPrefs, ParameterDef } from '@/rigs/types'
import { loadDraft, loadPrefs, loadTabs, saveDraft, savePrefs, saveTabs, defaultPrefs } from '@/state/persistence'
import { RigSession } from '@/state/session'

type WorkspaceStore = {
  sessions: Map<string, RigSession>
  tabs: string[]
  prefs: PanelPrefs
  version: number
  listeners: Set<() => void>
}

const store: WorkspaceStore = {
  sessions: new Map(),
  tabs: typeof localStorage === 'undefined' ? [] : loadTabs(),
  prefs: typeof localStorage === 'undefined' ? defaultPrefs() : loadPrefs(),
  version: 0,
  listeners: new Set(),
}

function emit() {
  store.version += 1
  for (const listener of store.listeners) listener()
}

/**
 * The session for a rig. A vector document can gain and lose controls while it is open, so a
 * session whose controls no longer match the manifest is rebuilt from the draft rather than kept.
 */
export function ensureSession(rigId: string): RigSession | null {
  const manifest = getRig(rigId)
  if (!manifest) return null
  const existing = store.sessions.get(rigId)
  if (existing && sameParameters(existing.parameters, manifest.parameters)) return existing
  if (existing) saveDraft(existing.toDraft())
  const session = new RigSession(manifest, loadDraft(rigId))
  session.subscribe(() => {
    if (session.isGesturing()) return
    saveDraft(session.toDraft())
  })
  store.sessions.set(rigId, session)
  if (!store.tabs.includes(rigId)) {
    store.tabs = [...store.tabs, rigId]
    saveTabs(store.tabs)
  }
  queueMicrotask(emit)
  return session
}

function sameParameters(a: ParameterDef[], b: ParameterDef[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b)
}

export function closeTab(rigId: string) {
  const session = store.sessions.get(rigId)
  if (session) saveDraft(session.toDraft())
  store.tabs = store.tabs.filter((id) => id !== rigId)
  saveTabs(store.tabs)
  emit()
}

/** Current panel preferences, for callers that need to read them outside a render. */
export function readPrefs(): PanelPrefs {
  return store.prefs
}

export function updatePrefs(patch: Partial<PanelPrefs>) {
  store.prefs = { ...store.prefs, ...patch, version: 1 }
  savePrefs(store.prefs)
  emit()
}

export function useWorkspace() {
  const version = useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener)
      return () => store.listeners.delete(listener)
    },
    () => store.version,
    () => 0,
  )
  return { tabs: store.tabs, prefs: store.prefs, version }
}

/**
 * The session for a rig. It is asked for on every render rather than memoised on the id: a vector
 * document gains and loses controls while it is open, and the session has to follow.
 */
export function useSession(rigId: string | undefined) {
  const session = rigId ? ensureSession(rigId) : null
  const revision = useSyncExternalStore(
    useCallback((listener: () => void) => session?.subscribe(listener) ?? (() => undefined), [session]),
    () => session?.getRevision() ?? 0,
    () => 0,
  )
  return { session, snapshot: session?.getSnapshot(), revision }
}

export function usePlayhead(session: RigSession | null) {
  return useSyncExternalStore(
    (listener) => session?.subscribeClock(listener) ?? (() => undefined),
    () => session?.displayPlayhead() ?? 0,
    () => 0,
  )
}
