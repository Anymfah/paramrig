import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getRig, listExampleRigs } from '@/rigs/registry'
import { RigNavigation } from '@/shell/RigNavigation'
import { ShellNavResize, useNavColumn } from '@/shell/ResizeHandle'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { useSession } from '@/state/workspace'
import { Button, IconButton } from '@/ui/Button'
import { IconRedo, IconSnapshot, IconUndo } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { ExportAction } from '@/workspace/ExportAction'
import { Inspector } from '@/workspace/Inspector'
import { RigPreview } from '@/workspace/RigPreview'
import { Timeline } from '@/workspace/Timeline'

export function WorkspacePage() {
  const { rigId = '' } = useParams()
  const manifest = getRig(rigId)
  const { session, snapshot } = useSession(manifest?.id)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')

  useEffect(() => {
    return () => {
      if (manifest?.renderer === 'three') session?.setPlaying(false)
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
      if (!meta || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      event.preventDefault()
      if (event.shiftKey) session.redo()
      else session.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])

  if (!manifest) {
    return <UnknownRig />
  }

  if (!session || !snapshot) return null

  const values = snapshot.values
  const previewValues = session.previewValues()

  return (
    <WorkspaceShell
      rigs={listExampleRigs()}
      activeId={manifest.id}
      showTimeline={Boolean(manifest.animation)}
      mobilePanel={mobilePanel}
      onMobilePanel={setMobilePanel}
      inspector={
        <Inspector
          key={manifest.id}
          session={session}
          groups={manifest.groups}
          parameters={manifest.parameters}
          values={values}
          defaults={session.defaults}
        />
      }
      timeline={<Timeline session={session} />}
    >
      <h1 className="visually-hidden">{manifest.name}</h1>
      <div className="workspace-toolbar">
        <div className="workspace-toolbar__group">
          <Tooltip content={session.canUndo() ? 'Undo' : 'Nothing to undo'}>
            <IconButton label="Undo" onClick={() => session.undo()} disabled={!session.canUndo()}>
              <IconUndo />
            </IconButton>
          </Tooltip>
          <Tooltip content={session.canRedo() ? 'Redo' : 'Nothing to redo'}>
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
      <div className={`preview-stage${manifest.renderer === 'three' ? ' preview-stage--scene' : ''}`} id="main">
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
        <div className="compare-toggle" role="group" aria-label="Compare snapshot">
          <button type="button" aria-pressed={snapshot.compare === 'original'} onClick={() => session.setCompare('original')}>
            Original
          </button>
          <button type="button" aria-pressed={snapshot.compare === 'current'} onClick={() => session.setCompare('current')}>
            Current
          </button>
        </div>
      </div>
    </WorkspaceShell>
  )
}

function UnknownRig() {
  const navigate = useNavigate()
  const { dataNav, style } = useNavColumn()
  return (
    <div
      className="shell"
      data-header="off"
      data-timeline="off"
      data-nav={dataNav}
      data-inspector="collapsed"
      style={style}
    >
      <RigNavigation rigs={listExampleRigs()} />
      <main id="main" className="library-main scroll-area">
        <h1>This rig is not in the example registry</h1>
        <p className="lede">The URL does not match a bundled example. Nothing was loaded from disk.</p>
        <Button onClick={() => navigate('/')}>Back to library</Button>
      </main>
      <ShellNavResize />
    </div>
  )
}
