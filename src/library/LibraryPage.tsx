import { useNavColumn } from '@/shell/useLayout'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { RigNavigation } from '@/shell/RigNavigation'
import { ShellNavResize } from '@/shell/ResizeHandle'
import { loadLibrary, listExampleRigs, parseFixture, searchRigs } from '@/rigs/registry'
import type { RigManifest } from '@/rigs/types'
import { Button } from '@/ui/Button'
import { IconPlus, IconSearch } from '@/ui/icons'
import { StatusMessage } from '@/ui/StatusMessage'
import { Tooltip } from '@/ui/Tooltip'
import { ContourBloomMark } from '@/renderers/svg/ContourBloomPreview'
import { SurfaceMark } from '@/renderers/html/SurfaceStudiesPreview'
import { TypeMark } from '@/renderers/html/TypeSpecimenPreview'
import { PlanetMark } from '@/renderers/three/PlanetMark'
import { createVectorDocument, getVectorDocument } from '@/vector/document'
import { vectorPathData } from '@/vector/vectorPath'

export function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const fixture = parseFixture(params.toString())
  const [rigs, setRigs] = useState<RigManifest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main'>('main')
  const navigate = useNavigate()

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
      style={style}
    >
      <RigNavigation rigs={fixture === 'loading' ? listExampleRigs() : (rigs ?? [])} activeId={undefined} compact={compact} onNavigate={() => setMobilePanel('main')} />
      <main id="main" className="library-main scroll-area">
        <div className="library-titlebar">
          <h1>Your rigs</h1>
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
        {import.meta.env.MODE === 'demo' && (
          <p className="status-msg" role="note">
            Public demo. Drafts and snapshots stay in this browser, with no cloud backup.{' '}
            <a href="https://paramrig.com/docs/persistence/">About local data</a>
          </p>
        )}
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
  const id = rig.id
  if (rig.renderer === 'vector') {
    const document = getVectorDocument(id)
    return document ? (
      <svg className="vector-thumb" viewBox={`0 0 ${document.width} ${document.height}`} aria-hidden="true">
        {document.elements.filter((element) => element.visible && element.kind !== 'group').map((element) => {
          const transform = `rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`
          if (element.vectorNodes) return <path key={element.id} d={vectorPathData(element)} fill={element.fill} stroke={element.stroke} strokeWidth={element.strokeWidth} opacity={element.opacity} transform={transform} />
          return element.kind === 'ellipse'
            ? <ellipse key={element.id} cx={element.x + element.width / 2} cy={element.y + element.height / 2} rx={element.width / 2} ry={element.height / 2} fill={element.fill} stroke={element.stroke} strokeWidth={element.strokeWidth} opacity={element.opacity} transform={transform} />
            : <rect key={element.id} x={element.x} y={element.y} width={element.width} height={element.height} fill={element.fill} stroke={element.stroke} strokeWidth={element.strokeWidth} opacity={element.opacity} transform={transform} />
        })}
      </svg>
    ) : null
  }
  if (id === 'contour-bloom' || id === 'long-name-study') return <ContourBloomMark />
  if (id === 'tidal-planet') return <PlanetMark />
  if (id === 'surface-studies') return <SurfaceMark />
  if (id === 'type-specimen') return <TypeMark />
  return null
}
