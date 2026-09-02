import { useNavColumn } from '@/shell/useLayout'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getRig, listRigs } from '@/rigs/registry'
import { RigNavigation } from '@/shell/RigNavigation'
import { ShellNavResize } from '@/shell/ResizeHandle'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { useSession } from '@/state/workspace'
import { Button, IconButton } from '@/ui/Button'
import { IconRedo, IconSnapshot, IconUndo } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { ExportAction } from '@/workspace/ExportAction'
import { Inspector } from '@/workspace/Inspector'
import { RigPreview } from '@/workspace/RigPreview'
import { Timeline } from '@/workspace/Timeline'
import { VectorEditorPage } from '@/vector/VectorEditorPage'
import { modeOf, readInspectorPrefs, withMode, writeInspectorPrefs, type VectorMode } from '@/vector/inspectorPrefs'

export function WorkspacePage() {
  const { rigId = '' } = useParams()
  const manifest = getRig(rigId)
  const { session, snapshot } = useSession(manifest?.id)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')
  const [mode, setModeState] = useState<VectorMode>(() => modeOf(readInspectorPrefs(), rigId))
  useEffect(() => { setModeState(modeOf(readInspectorPrefs(), rigId)) }, [rigId])
  const setMode = useCallback((next: VectorMode) => {
    setModeState(next)
    writeInspectorPrefs(withMode(readInspectorPrefs(), rigId, next))
  }, [rigId])
  useEffect(() => { setMobilePanel('main') }, [rigId])

  useEffect(() => {
    return () => {
      session?.setPlaying(false)
    }
  }, [session, manifest?.renderer])

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) session?.setPlaying(false)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [session])

  useEffect(() => {
    if (!session) return
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (event.defaultPrevented || !meta || !['z', 'y'].includes(event.key.toLowerCase())) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      event.preventDefault()
      if (event.shiftKey || event.key.toLowerCase() === 'y') session.redo()
      else session.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])

  if (!manifest) {
    return <UnknownRig />
  }

  // A drawing opens in the editor; a document that exposes controls opens the way it was left.
  if (manifest.renderer === 'vector' && (mode === 'edit' || manifest.parameters.length === 0)) {
    return <VectorEditorPage manifest={manifest} mode={mode} onMode={setMode} />
  }

  if (!session || !snapshot) return null

  const values = snapshot.values
  const previewValues = session.previewValues()

  return (
    <WorkspaceShell
      rigs={listRigs()}
      activeId={manifest.id}
      showTimeline={Boolean(manifest.animation) || snapshot.tracks.length > 0}
      mobilePanel={mobilePanel}
      onMobilePanel={setMobilePanel}
      inspector={
        <Inspector
          key={manifest.id}
          session={session}
          categories={manifest.inspectorCategories}
          groups={manifest.groups}
          parameters={manifest.parameters}
          values={values}
          defaults={session.defaults}
        />
      }
      timeline={<Timeline key={manifest.id} session={session} />}
    >
      <h1 className="visually-hidden">{manifest.name}</h1>
      <div className="workspace-toolbar">
        {manifest.renderer === 'vector' ? (
          <div className="workspace-toolbar__group">
            <Button variant="quiet" size="sm" onClick={() => setMode('edit')}>Edit</Button>
          </div>
        ) : null}
        <div className="workspace-toolbar__group">
          <Tooltip content={session.canUndo() ? `Undo: ${session.undoLabel()} (⌘Z / Ctrl+Z)` : 'Nothing to undo'}>
            <IconButton label="Undo" onClick={() => session.undo()} disabled={!session.canUndo()}>
              <IconUndo />
            </IconButton>
          </Tooltip>
          <Tooltip content={session.canRedo() ? `Redo: ${session.redoLabel()} (⌘⇧Z / Ctrl+Shift+Z)` : 'Nothing to redo'}>
            <IconButton label="Redo" onClick={() => session.redo()} disabled={!session.canRedo()}>
              <IconRedo />
            </IconButton>
          </Tooltip>
        </div>
        <div className="workspace-toolbar__group">
          <Tooltip content="Snapshot">
            <IconButton
              label="Snapshot"
              onClick={() => session.captureSnapshot(`Snapshot ${snapshot.snapshots.length + 1}`)}
            >
              <IconSnapshot />
            </IconButton>
          </Tooltip>
          <ExportAction session={session} />
        </div>
      </div>
      <div className={`preview-stage${manifest.renderer === 'three' ? ' preview-stage--scene' : ''}`} id="main" tabIndex={-1}>
        <RigPreview
          rigId={manifest.id}
          renderer={manifest.renderer}
          values={previewValues}
          name={manifest.name}
          session={session}
        />
        <div className="preview-meta">
          <span className="preview-meta__name">
            {manifest.renderer === 'three' ? (
              <>
                <strong>{manifest.name}</strong>
                <span>{manifest.summary.replace(/^3D · /, '')}</span>
              </>
            ) : (
              manifest.name
            )}
          </span>
          {manifest.renderer === 'svg' ? <span className="preview-meta__end">800 × 600</span> : null}
          {manifest.renderer === 'html' ? <span className="preview-meta__end">{manifest.summary}</span> : null}
        </div>
        {manifest.renderer === 'three' ? (
          <svg className="scene-axes" viewBox="0 0 48 48" aria-hidden="true">
            <line x1="8" y1="40" x2="40" y2="40" />
            <line x1="8" y1="40" x2="8" y2="8" />
            <line x1="8" y1="40" x2="28" y2="26" />
            <text x="42" y="42">X</text>
            <text x="6" y="7">Y</text>
            <text x="30" y="24">Z</text>
          </svg>
        ) : null}

      </div>
      <div className="workspace-status">
        <div className="compare-toggle" role="group" aria-label={`Compare against ${session.baselineName()}`}>
          <button type="button" aria-pressed={snapshot.compare === 'original'} onClick={() => session.setCompare('original')}>
            Reference
          </button>
          <button type="button" aria-pressed={snapshot.compare === 'current'} onClick={() => session.setCompare('current')}>
            Current
          </button>
        </div>
        <span className="workspace-status__baseline">Reference: {session.baselineName()}</span>
        <span className="workspace-status__changes">{session.changedSinceBaseline().length ? `${session.changedSinceBaseline().length} changed` : 'Matches reference'}</span>
        <span className="workspace-status__notice" role="status">{snapshot.notice}</span>
      </div>
    </WorkspaceShell>
  )
}

function UnknownRig() {
  const navigate = useNavigate()
  const { dataNav, style, compact } = useNavColumn()
  return (
    <div
      className="shell"
      data-header="off"
      data-timeline="off"
      data-nav={dataNav}
      data-inspector="collapsed"
      style={style}
    >
      <RigNavigation rigs={listRigs()} compact={compact} />
      <main id="main" className="library-main scroll-area">
        <h1>This rig is not in the example registry</h1>
        <p className="lede">The URL does not match a bundled example. Nothing was loaded from disk.</p>
        <Button onClick={() => navigate('/')}>Back to library</Button>
      </main>
      <ShellNavResize />
    </div>
  )
}
