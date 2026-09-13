import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useParams } from 'react-router-dom'
import { hasModule, loadModule, requiredModule } from './registry'
import { projectIndexRevision, subscribeProjectIndex } from '@/library/projectIndex'
import { cacheThumbnail } from '@/library/thumbnails'
import { DomainContext } from './context'
import { MODULE_LABELS, type DomainModule, type ModuleId } from './types'
import { RendererErrorBoundary } from '@/workspace/RendererErrorBoundary'
const WorkspacePage = lazy(() => import('@/workspace/WorkspacePage').then(module => ({ default: module.WorkspacePage })))

export function ModuleRoute({ module: explicit, page = 'workspace' }: { module?: ModuleId; page?: 'workspace' | 'landing' | 'documentation' }) {
  const { rigId = '' } = useParams()
  const revision = useSyncExternalStore(subscribeProjectIndex, projectIndexRevision, () => 0)
  const id = explicit ?? requiredModule(rigId)
  const [request, setRequest] = useState(0)
  const [loaded, setLoaded] = useState<DomainModule | null>(null)
  const [error, setError] = useState('')
  const retry = () => setRequest(value => value + 1)
  useEffect(() => {
    let cancelled = false
    setLoaded(null); setError('')
    if (id && hasModule(id)) void loadModule(id).then(module => { if (!cancelled) setLoaded(module) }, error => {
      if (!cancelled) setError(error instanceof Error ? error.message : 'This tool could not be loaded.')
    })
    return () => { cancelled = true }
  }, [id, request])
  useEffect(() => () => loaded?.dispose?.(), [loaded])
  useEffect(() => {
    if (!loaded?.thumbnail || !rigId) return
    const timer = window.setTimeout(() => {
      try { const image = loaded.thumbnail?.(rigId); if (image) cacheThumbnail(rigId, image.stamp, image.url) }
      catch { /* The document stays usable even when a disposable preview fails. */ }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [loaded, rigId, revision])
  if (!id) return <RouteMessage title="This document could not be found" detail="Check the link or reopen its project file. Your saved documents are unchanged."/>
  if (!hasModule(id)) return <RouteMessage title={`${MODULE_LABELS[id]} is required`} detail="This distribution does not include that tool. The document is still stored in this browser.">
    <a className="btn btn--ghost" href={`https://app.paramrig.com/${id === 'scene' ? '3d' : id}`}>Open the complete application</a>
  </RouteMessage>
  if (error) return <RouteMessage title={`Could not open ${MODULE_LABELS[id]}`} detail={error}><button type="button" className="btn" onClick={retry}>Try again</button></RouteMessage>
  if (!loaded || loaded.id !== id) return <p className="status-msg" role="status">Opening {MODULE_LABELS[id]}</p>
  const Page = page === 'landing' ? loaded.Landing : page === 'documentation' ? loaded.Documentation : WorkspacePage
  return <DomainContext.Provider value={loaded}><RendererErrorBoundary key={`${id}:${rigId}:${request}`} fallback={
    <RouteMessage title="This tool could not open the document" detail="Your stored document has not been removed. Retry loading it or return to the library."><button type="button" className="btn" onClick={retry}>Try again</button></RouteMessage>
  }><Suspense fallback={<p className="status-msg" role="status">Opening {MODULE_LABELS[id]}</p>}>{Page ? <Page/> : <RouteMessage title="This page is unavailable"/>}</Suspense></RendererErrorBoundary></DomainContext.Provider>
}
function RouteMessage({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return <main id="main" className="library-main scroll-area"><h1>{title}</h1>{detail ? <p className="lede">{detail}</p> : null}{children}<Link className="btn btn--ghost" to="/">Back to library</Link></main>
}
