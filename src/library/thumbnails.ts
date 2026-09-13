import { projectHandleStore } from '@/editor/fileHandles'
/** A separate disposable cache never spends the document stores' localStorage allowance. */
const store = projectHandleStore('paramrig.thumbnail-cache')
const entries = new Map<string, { stamp: string; url: string }>()
const listeners = new Set<() => void>()
let loading: Promise<void> | undefined
const notify = () => { for (const listener of listeners) listener() }
export function readThumbnail(id: string): string | undefined { return entries.get(id)?.url }
export function loadThumbnails() {
  return loading ??= store.listRecentProjects().then(items => {
    for (const item of items) if (item.thumbnail?.startsWith('data:image/') && !entries.has(item.id)) entries.set(item.id, { stamp: item.savedAt, url: item.thumbnail })
    notify()
  }).catch(() => {})
}
export function cacheThumbnail(id: string, stamp: string, url: string) {
  if (!url.startsWith('data:image/') || entries.get(id)?.stamp === stamp) return
  entries.set(id, { stamp, url }); notify()
  void store.rememberProject({ id, name: id, savedAt: stamp, fileName: null, thumbnail: url }).catch(() => {})
}
export function subscribeThumbnails(listener: () => void) { listeners.add(listener); void loadThumbnails(); return () => { listeners.delete(listener) } }
