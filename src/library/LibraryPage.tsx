import { useNavColumn } from '@/shell/useLayout'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { RigNavigation } from '@/shell/RigNavigation'
import { ShellNavResize } from '@/shell/ResizeHandle'
import { loadLibrary, listExampleRigs, parseFixture, searchRigs } from '@/rigs/registry'
import type { RigManifest } from '@/rigs/types'
import { Button } from '@/ui/Button'
import { IconCube, IconPlus, IconSearch } from '@/ui/icons'
import { StatusMessage } from '@/ui/StatusMessage'
import { Tooltip } from '@/ui/Tooltip'
import { ContourBloomMark } from '@/renderers/svg/ContourBloomPreview'
import { SurfaceMark } from '@/renderers/html/SurfaceStudiesPreview'
import { TypeMark } from '@/renderers/html/TypeSpecimenPreview'
import { PlanetMark } from '@/renderers/three/PlanetMark'
import { createSceneDocument, getSceneDocument, saveSceneDocument } from '@/scene/document'
import { importProject as importSceneProject } from '@/scene/project'
import { SceneThumb } from '@/scene/SceneThumb'
import { createVectorDocument, documentThumbnail, getVectorDocument, saveVectorDocument } from '@/vector/document'
import { resolveRigValues, rigDefaults } from '@/vector/rig'
import { getProjectHandle, listRecentProjects, type RecentProject } from '@/vector/fileHandles'
import { importProject } from '@/vector/project'

export function LibraryPage() {
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
    if (getVectorDocument(entry.id) || getSceneDocument(entry.id)) {
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
    const opened = openFileText(await (await handle.getFile()).text())
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
  }, [fixture])

  /** A project file dropped on the library opens as a document and, when it has one, its rig. */
  const openDropped = async (file: File) => {
    setRecentError(null)
    setNote(null)
    const opened = openFileText(await file.text())
    if (!opened.ok) {
      setRecentError(opened.error)
      return
    }
    if (opened.note) setNote(opened.note)
    navigate(`/r/${opened.id}`)
  }

  const { dataNav, style, compact } = useNavColumn()
  const visible = useMemo(() => searchRigs(rigs ?? [], query), [rigs, query])

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
          <h1>Your rigs</h1>
          <div className="library-titlebar__actions">
            <Tooltip content="New scene">
              <button
                type="button"
                className="icon-btn library-create"
                aria-label="New scene"
                onClick={() => {
                  const document = createSceneDocument()
                  navigate(`/r/${document.id}`)
                }}
              >
                <IconCube />
              </button>
            </Tooltip>
            <Tooltip content="New vector document">
              <button
                type="button"
                className="icon-btn icon-btn--solid library-create"
                aria-label="New vector document"
                onClick={() => {
                  const document = createVectorDocument()
                  navigate(`/r/${document.id}`)
                }}
              >
                <IconPlus />
              </button>
            </Tooltip>
          </div>
        </div>
        {import.meta.env.MODE === 'demo' && (
          <p className="status-msg" role="note">
            Public demo. Drafts and snapshots stay in this browser, with no cloud backup.{' '}
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
              {recent.map((entry) => (
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

/**
 * Reads a dropped or reopened project file with whichever editor claims it, stores it, and gives
 * back the id to open. A file that names neither format comes back with the reason.
 */
function openFileText(text: string): { ok: true; id: string; note?: string } | { ok: false; error: string } {
  const asScene = importSceneProject(text)
  if (asScene.ok) {
    saveSceneDocument(asScene.project.document)
    return { ok: true, id: asScene.project.document.id, ...(asScene.note ? { note: asScene.note } : {}) }
  }
  const asVector = importProject(text)
  if (asVector.ok) {
    saveVectorDocument(asVector.project.document)
    return { ok: true, id: asVector.project.document.id, ...(asVector.note ? { note: asVector.note } : {}) }
  }
  // The file said which editor it belongs to, so its own reader gives the better message.
  return { ok: false, error: text.includes('"paramrig.scene"') ? asScene.error : asVector.error }
}

function RigThumb({ rig }: { rig: RigManifest }) {
  const id = rig.id
  if (rig.renderer === 'scene') {
    const stored = getSceneDocument(id)
    return stored ? <SceneThumb document={stored} /> : null
  }
  if (rig.renderer === 'vector') {
    const stored = getVectorDocument(id)
    if (!stored) return null
    // A parametered document is shown the way its controls rest, which is what it looks like new.
    const document = stored.rig ? resolveRigValues(stored, rigDefaults(stored.rig)) : stored
    return (
      <svg
        className="vector-thumb"
        viewBox={`0 0 ${document.width} ${document.height}`}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: documentThumbnail(document) }}
      />
    )
  }
  if (id === 'contour-bloom' || id === 'long-name-study') return <ContourBloomMark />
  if (id === 'tidal-planet') return <PlanetMark />
  if (id === 'surface-studies') return <SurfaceMark />
  if (id === 'type-specimen') return <TypeMark />
  return null
}
