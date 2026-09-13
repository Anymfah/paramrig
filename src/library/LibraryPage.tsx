import { useNavColumn } from '@/shell/useLayout'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { RigNavigation } from '@/shell/RigNavigation'
import { ShellNavResize } from '@/shell/ResizeHandle'
import { listRigs, loadLibrary, listExampleRigs, parseFixture, searchRigs } from '@/rigs/registry'
import type { RigManifest } from '@/rigs/types'
import { Button } from '@/ui/Button'
import { IconCube, IconPlus, IconSearch, IconWave } from '@/ui/icons'
import { StatusMessage } from '@/ui/StatusMessage'
import { Tooltip } from '@/ui/Tooltip'
import { getProjectHandle, listRecentProjects, type RecentProject } from '@/editor/fileHandles'
import { findProjectMetadata, projectIndexRevision, subscribeProjectIndex } from './projectIndex'
import { hasModule, loadModule, requiredModule, catalog } from '@/modules/registry'
import { MODULE_LABELS, type ModuleId } from '@/modules/types'
import { ModuleRoute } from '@/modules/ModuleRoute'
import { openFileText } from '@/modules/openFile'
import { readThumbnail, subscribeThumbnails } from './thumbnails'

export function LibraryPage({ module: selected }: { module?: ModuleId }) {
  const revision = useSyncExternalStore(subscribeProjectIndex, projectIndexRevision, () => 0)
  const [opening, setOpening] = useState(false)
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const fixture = parseFixture(params.toString())
  const [rigs, setRigs] = useState<RigManifest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main'>('main')
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [recentError, setRecentError] = useState<string | null>(null)
  const navigate = useNavigate()
  const [dropping, setDropping] = useState(false)
  /** What a dropped file asked for and did not get: controls or bindings the app could not read. */
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listRecentProjects().then((entries) => {
      if (!cancelled) setRecent(entries)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const openRecent = async (entry: RecentProject) => {
    setRecentError(null)
    if (findProjectMetadata(entry.id)) {
      navigate(`/r/${entry.id}`)
      return
    }
    const handle = await getProjectHandle(entry.id)
    if (!handle) {
      setRecentError(`“${entry.name}” is no longer in this browser and has no linked file.`)
      return
    }
    const permission = await handle.requestPermission?.({ mode: 'read' })
    if (permission && permission !== 'granted') {
      setRecentError(`Reading “${entry.fileName ?? entry.name}” was not allowed.`)
      return
    }
    const opened = await openFileText(await (await handle.getFile()).text())
    if (!opened.ok) {
      setRecentError(opened.error)
      return
    }
    navigate(`/r/${opened.id}`)
  }

  useEffect(() => {
    let cancelled = false
    setError(null)
    setRigs(null)
    loadLibrary(fixture)
      .then((result) => {
        if (cancelled) return
        setRigs(result.rigs)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setRigs([])
        setError(err instanceof Error ? err.message : 'The library could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [fixture, revision])

  /** A project file dropped on the library opens as a document and, when it has one, its rig. */
  const openDropped = async (file: File) => {
    setRecentError(null)
    setNote(null)
    const opened = await openFileText(await file.text())
    if (!opened.ok) {
      setRecentError(opened.error)
      return
    }
    if (opened.note) {
      /*
       * Opening the document would take the message with it, and a file that arrived incomplete is
       * exactly the file whose reader needs telling. So it stops here, listed and ready to open,
       * with what it lost said out loud.
       */
      setNote(`${opened.note} The rest opened as “${opened.name}”, which is now in the library.`)
      setRigs(listRigs())
      return
    }
    navigate(`/r/${opened.id}`)
  }

  const { dataNav, style, compact } = useNavColumn()
  const visible = useMemo(() => searchRigs((rigs ?? []).filter(rig => !selected || requiredModule(rig.id) === selected), query), [rigs, query, selected])
  const create = async (id: ModuleId) => {
    if (opening) return
    setOpening(true); setRecentError(null)
    try { const domain = await loadModule(id); const document = domain.create?.(); if (document) navigate(`/r/${document.id}`) }
    catch (error) { setRecentError(error instanceof Error ? error.message : 'The tool could not be loaded.') }
    finally { setOpening(false) }
  }
  if (selected && !hasModule(selected)) return <ModuleRoute module={selected} page="landing"/>
  const show = (id: ModuleId) => hasModule(id) && (!selected || selected === id)

  return (
    <div
      className="shell"
      data-header="off"
      data-timeline="off"
      data-inspector="collapsed"
      data-mobile-panel={mobilePanel}
      data-nav={dataNav}
      data-dropping={dropping || undefined}
      style={style}
      onDragOver={(event) => {
        if (![...event.dataTransfer.items].some((item) => item.kind === 'file')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDropping(false) }}
      onDrop={(event) => {
        const file = [...event.dataTransfer.files][0]
        if (!file) return
        event.preventDefault()
        setDropping(false)
        void openDropped(file)
      }}
    >
      <RigNavigation rigs={fixture === 'loading' ? listExampleRigs() : (rigs ?? [])} activeId={undefined} compact={compact} onNavigate={() => setMobilePanel('main')} />
      <main id="main" className="library-main scroll-area">
        <div className="library-titlebar">
          <h1>{selected ? MODULE_LABELS[selected] : 'Your rigs'}</h1>
          <div className="library-titlebar__actions">
            {show('web') ? <Link className="btn btn--ghost" to="/web">Web</Link> : null}
            {show('audio') ? <Tooltip content="New sound">
              <button
                type="button"
                className="icon-btn library-create"
                aria-label="New sound"
                disabled={opening}
                onClick={() => void create('audio')}
              >
                <IconWave />
              </button>
            </Tooltip> : null}
            {show('scene') ? <Tooltip content="New scene">
              <button
                type="button"
                className="icon-btn library-create"
                aria-label="New scene"
                disabled={opening}
                onClick={() => void create('scene')}
              >
                <IconCube />
              </button>
            </Tooltip> : null}
            {show('vector') ? <Tooltip content="New vector document">
              <button
                type="button"
                className="icon-btn icon-btn--solid library-create"
                aria-label="New vector document"
                disabled={opening}
                onClick={() => void create('vector')}
              >
                <IconPlus />
              </button>
            </Tooltip> : null}
          </div>
        </div>
        {import.meta.env.MODE === 'app' && (
          <p className="status-msg" role="note">
            Everything you make here stays in this browser. There is no account and no cloud backup yet.{' '}
            <a href="https://paramrig.com/docs/persistence/">About local data</a>
          </p>
        )}
        {recentError && recent.length === 0 ? <StatusMessage tone="error">{recentError}</StatusMessage> : null}
        {note ? <StatusMessage>{note}</StatusMessage> : null}
        {recent.length > 0 ? (
          <section className="library-recent" aria-label="Recent projects">
            <h2 className="library-recent__title">Recent</h2>
            {recentError ? <StatusMessage tone="error">{recentError}</StatusMessage> : null}
            <ul className="library-recent__list">
              {recent.filter(entry => !selected || requiredModule(entry.id) === selected).map((entry) => (
                <li key={entry.id}>
                  <button type="button" className="library-recent__item" onClick={() => void openRecent(entry)}>
                    <span className="library-recent__preview" style={entry.background ? { background: entry.background } : undefined}>
                      <RecentThumb entry={entry} />
                    </span>
                    <span className="library-recent__text">
                      <span className="library-recent__name">{entry.name}</span>
                      <span className="library-recent__meta">{formatRecentDate(entry.savedAt)}{entry.fileName ? ` · ${entry.fileName}` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <label className="search-field">
          <IconSearch />
          <span className="visually-hidden">Find a rig</span>
          <input
            value={query}
            placeholder="Find a rig"
            onChange={(event) => {
              const next = new URLSearchParams(params)
              if (event.target.value) next.set('q', event.target.value)
              else next.delete('q')
              setParams(next, { replace: true })
            }}
          />
        </label>
        {error ? (
          <div className="error-state">
            <StatusMessage tone="error">{error}</StatusMessage>
            <Button onClick={() => setParams({})}>Reload examples</Button>
          </div>
        ) : rigs === null ? (
          <div className="loading-state" aria-busy="true">
            <p className="status-msg">Loading example rigs</p>
            <div className="rig-grid" aria-hidden="true">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <h2>{query ? 'No rigs match that search' : 'No example rigs in this view'}</h2>
            <p className="lede">
              {query
                ? `No example rig matches “${query}”. Clear the search to see the bundled examples.`
                : 'This empty list is a local fixture. Example rigs ship with the app; they are not discovered from disk.'}
            </p>
            {query ? (
              <Button variant="ghost" onClick={() => setParams({})}>
                Clear search
              </Button>
            ) : <Button variant="ghost" onClick={() => setParams({})}>Show examples</Button>}
          </div>
        ) : (
          <div className="rig-grid">
            {visible.map((rig) => (
              <Link key={rig.id} to={`/r/${rig.id}`} className="rig-card">
                <div className="rig-card__preview">
                  <RigThumb rig={rig} />
                </div>
                <div>
                  <h2>{rig.name}</h2>
                  <p>{rig.summary}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <div className="mobile-dock">
        <button type="button" aria-pressed={mobilePanel === 'nav'} onClick={() => setMobilePanel('nav')}>Library</button>
        <button type="button" aria-pressed={mobilePanel === 'main'} onClick={() => setMobilePanel('main')}>Rigs</button>
      </div>
      <ShellNavResize />
    </div>
  )
}

/**
 * A recent entry's picture. A vector document keeps its preview as SVG markup and the size to draw
 * it at; a scene keeps a whole picture as a data URL, because a scene has no page to draw against.
 */
function RecentThumb({ entry }: { entry: RecentProject }) {
  if (!entry.thumbnail) return null
  if (entry.kind === 'scene' || entry.thumbnail.startsWith('data:')) {
    return <img className="library-recent__image" src={entry.thumbnail} alt="" />
  }
  return (
    <svg
      viewBox={`0 0 ${entry.width ?? 800} ${entry.height ?? 600}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: entry.thumbnail }}
    />
  )
}

function formatRecentDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton--preview" />
      <div className="skeleton skeleton--line" />
      <div className="skeleton skeleton--line skeleton--short" />
    </div>
  )
}

function RigThumb({ rig }: { rig: RigManifest }) {
  const cached = useSyncExternalStore(subscribeThumbnails, () => readThumbnail(rig.id), () => undefined)
  const url = cached ?? catalog.find(item => item.id === rig.id)?.thumbnail
  if (url) return <img className="library-recent__image" src={url} alt="" loading="lazy"/>
  const Icon = rig.renderer === 'audio' ? IconWave : rig.renderer === 'scene' || rig.renderer === 'three' ? IconCube : IconPlus
  return <span className="rig-card__placeholder" aria-hidden="true"><Icon/></span>
}
