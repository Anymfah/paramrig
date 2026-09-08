import { useNavColumn } from '@/shell/useLayout'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getRig, listRigs } from '@/rigs/registry'
import type { RendererKind } from '@/rigs/types'
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
import { modeOf, readInspectorPrefs, withMode, writeInspectorPrefs, type VectorMode } from '@/vector/inspectorPrefs'
import { modeOf as sceneModeOf, readScenePrefs, withMode as withSceneMode, writeScenePrefs } from '@/scene/prefs'
import { modeOf as audioModeOf, readAudioPrefs, withMode as withAudioMode, writeAudioPrefs } from '@/audio/prefs'

/*
 * Both editors are deferred, and for the same reason: a workspace opens one document, so the other
 * editor is dead weight in front of the first frame. The drawing editor used to be static while the
 * scene editor was not, which is why opening a scene parsed the whole vector editor first — 57
 * modules and 13,760 lines, measured, none of them ever read.
 */
const VectorEditorPage = lazy(async () => ({ default: (await import('@/vector/VectorEditorPage')).VectorEditorPage }))
const SceneEditorPage = lazy(() => import('@/scene/SceneEditorPage').then((mod) => ({ default: mod.SceneEditorPage })))
const WebWorkspace = lazy(() => import('@/web/WebWorkspace').then(mod => ({ default: mod.WebWorkspace })))
const AudioEditorPage = lazy(() => import('@/audio/AudioEditorPage').then((mod) => ({ default: mod.AudioEditorPage })))

export function WorkspacePage() {
  const { rigId = '' } = useParams()
  const manifest = getRig(rigId)
  const { session, snapshot } = useSession(manifest?.renderer === 'web' ? undefined : manifest?.id)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')
  // Each document editor remembers Edit or Tune in its own store, under its own storage key.
  const kind = manifest?.renderer
  const readMode = useCallback((): VectorMode => {
    if (kind === 'scene') return sceneModeOf(readScenePrefs(), rigId)
    if (kind === 'audio') return audioModeOf(readAudioPrefs(), rigId)
    return modeOf(readInspectorPrefs(), rigId)
  }, [kind, rigId])
  const [mode, setModeState] = useState<VectorMode>(readMode)
  useEffect(() => {
    setModeState(readMode())
  }, [readMode])
  const setMode = useCallback((next: VectorMode) => {
    setModeState(next)
    if (kind === 'scene') writeScenePrefs(withSceneMode(readScenePrefs(), rigId, next))
    else if (kind === 'audio') writeAudioPrefs(withAudioMode(readAudioPrefs(), rigId, next))
    else writeInspectorPrefs(withMode(readInspectorPrefs(), rigId, next))
  }, [kind, rigId])
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

  // A document editor has its own history and its own ⌘Z. This page's listener is registered
  // before a lazily-loaded editor's, so without this guard it would answer first and swallow the
  // key on its way to the editor that actually owns the document.
  const editing = !!manifest
    && (manifest.renderer === 'vector' || manifest.renderer === 'scene' || manifest.renderer === 'audio')
    && (mode === 'edit' || manifest.parameters.length === 0)

  useEffect(() => {
    if (!session || editing) return
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
  }, [editing, session])

  if (!manifest) {
    return <UnknownRig />
  }

  if (manifest.renderer === 'web') return <Suspense fallback={<p className="status-msg">Opening the web workspace</p>}><WebWorkspace rigId={manifest.id} /></Suspense>

  // A drawing opens in the editor; a document that exposes controls opens the way it was left.
  if (manifest.renderer === 'vector' && (mode === 'edit' || manifest.parameters.length === 0)) {
    return (
      <Suspense fallback={<p className="status-msg">Opening the drawing editor</p>}>
        <VectorEditorPage manifest={manifest} mode={mode} onMode={setMode} />
      </Suspense>
    )
  }

  // The same rule for a scene: no controls, or last left on Edit, and it opens in the 3D editor.
  if (manifest.renderer === 'scene' && (mode === 'edit' || manifest.parameters.length === 0)) {
    return (
      <Suspense fallback={<p className="status-msg">Opening the scene editor</p>}>
        <SceneEditorPage documentId={manifest.id} mode={mode} onMode={setMode} />
      </Suspense>
    )
  }

  // And the same rule again for a patch: no controls, or last left on Edit, and it opens on the board.
  if (manifest.renderer === 'audio' && (mode === 'edit' || manifest.parameters.length === 0)) {
    return (
      <Suspense fallback={<p className="status-msg">Opening the sound editor</p>}>
        <AudioEditorPage documentId={manifest.id} mode={mode} onMode={setMode} />
      </Suspense>
    )
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
        {manifest.renderer === 'vector' || manifest.renderer === 'scene' || manifest.renderer === 'audio' ? (
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
          {/* The baseline's name and the count were a line of prose across the foot of the window.
              They belong to this control, so they are what it says when you ask it. */}
          <Tooltip content={`Compare against ${session.baselineName()} · ${session.changedSinceBaseline().length || 'no'} changed`}>
            <div className="compare-toggle" role="group" aria-label={`Compare against ${session.baselineName()}`}>
              <button type="button" aria-pressed={snapshot.compare === 'original'} onClick={() => session.setCompare('original')}>
                Reference
              </button>
              <button type="button" aria-pressed={snapshot.compare === 'current'} onClick={() => session.setCompare('current')}>
                Current
              </button>
            </div>
          </Tooltip>
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
      <div className={`preview-stage${stageModifier(manifest.renderer)}`} id="main" tabIndex={-1}>
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
          <svg className="preview-axes" viewBox="0 0 48 48" aria-hidden="true">
            <line x1="8" y1="40" x2="40" y2="40" />
            <line x1="8" y1="40" x2="8" y2="8" />
            <line x1="8" y1="40" x2="28" y2="26" />
            <text x="42" y="42">X</text>
            <text x="6" y="7">Y</text>
            <text x="30" y="24">Z</text>
          </svg>
        ) : null}

      </div>
      <p className="editor-notice" role="status" data-empty={snapshot.notice.length === 0}>{snapshot.notice}</p>
    </WorkspaceShell>
  )
}

/**
 * Which stage a renderer sits on. Three of them do not draw on paper: a scene, a three.js rig and
 * a patch all want the dark surface, and a patch wants it in Tune as much as in Edit — the light
 * canvas left its transport at about 1.6:1 against its own background.
 */
function stageModifier(renderer: RendererKind): string {
  if (renderer === 'three' || renderer === 'scene') return ' preview-stage--scene'
  if (renderer === 'audio') return ' preview-stage--audio'
  return ''
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
