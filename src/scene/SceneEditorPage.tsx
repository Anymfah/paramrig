import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { StatusMessage } from '@/ui/StatusMessage'
import { LiveRegion } from '@/editor/LiveRegion'
import { getSceneDocument, sceneCounts } from '@/scene/document'
import { resolveKey } from '@/scene/keymap'
import { DEFAULT_PREFERENCES, readScenePrefs, type SceneMode } from '@/scene/prefs'
import { SceneStage, type SceneStageHandle } from '@/scene/SceneStage'
import { SceneStatusBar } from '@/scene/SceneStatusBar'
import { useSceneDocument } from '@/scene/useSceneDocument'
import type { SceneViewport, SceneViewportOptions } from '@/scene/viewport/SceneViewport'
import '@/scene/operators'

/**
 * The 3D editor: the outliner on the left, the viewport in the middle, the properties on the right.
 *
 * The page owns the document and the keyboard; the viewport owns the canvas and everything that
 * happens at pointer rate. Nothing that changes sixty times a second is state here.
 */
export function SceneEditorPage({ documentId, mode, onMode, createViewport, viewportOptions }: {
  documentId: string
  mode: SceneMode
  onMode: (mode: SceneMode) => void
  /** A test hands over a viewport double; the editor makes a real one. */
  createViewport?: (container: HTMLElement, options: SceneViewportOptions) => SceneViewport
  viewportOptions?: SceneViewportOptions
}) {
  const editor = useSceneDocument(documentId)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')
  const [preferences, setPreferences] = useState(() => readScenePrefs().preferences ?? DEFAULT_PREFERENCES)
  const [announcement, setAnnouncement] = useState('')
  const stage = useRef<SceneStageHandle | null>(null)
  const exists = useMemo(() => getSceneDocument(documentId) !== null, [documentId])

  useEffect(() => {
    setPreferences(readScenePrefs().preferences ?? DEFAULT_PREFERENCES)
  }, [])

  const { document, selection, selectObjects, setView, undo, redo } = editor
  const runOperator = editor.runOperator

  /** Framing has to know how wide the viewport is, and the page is the only one that does. */
  const viewportAspect = useCallback(() => {
    const size = stage.current?.viewport?.pixelSize
    return size ? Math.max(0.1, size.width) / Math.max(0.1, size.height) : undefined
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || !document) return
    const target = event.target
    const typing = target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    const binding = resolveKey(event, {
      mode: document.view.mode,
      selectMode: document.view.selectMode,
      preferences,
      typing,
    })
    if (!binding) return
    const action = binding.action

    if (action.kind === 'operator') {
      event.preventDefault()
      const aspect = viewportAspect()
      runOperator(action.id, { ...(action.params as Record<string, never> | undefined), ...(aspect ? { aspect } : {}) })
      setAnnouncement(binding.label)
      return
    }

    // The handful of things that change the editor rather than the document.
    switch (action.id) {
      case 'undo':
        event.preventDefault()
        undo()
        setAnnouncement('Undo')
        return
      case 'redo':
        event.preventDefault()
        redo()
        setAnnouncement('Redo')
        return
      default:
        return
    }
  }, [document, preferences, redo, runOperator, undo, viewportAspect])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  if (!document) {
    return (
      <main id="main" className="library-main scroll-area">
        <StatusMessage tone="error">
          {exists ? 'That scene could not be read.' : 'That scene is not in this browser.'}
        </StatusMessage>
      </main>
    )
  }

  void mode
  void onMode

  const counts = sceneCounts(document)

  return (
    <WorkspaceShell
      rigs={listRigs()}
      activeId={document.id}
      mainLabel="Viewport"
      navLabel="Objects"
      mobilePanel={mobilePanel}
      onMobilePanel={setMobilePanel}
      inspector={<div className="scene-properties" />}
    >
      <h1 className="visually-hidden">{document.name}</h1>
      <div
        className="scene-stage"
        id="main"
        tabIndex={-1}
        data-scene-theme={preferences.theme === 'blender-classic' ? 'blender-classic' : undefined}
      >
        <SceneStage
          document={document}
          selection={selection}
          preferences={preferences}
          onView={setView}
          onSelect={(ids, active) => selectObjects(ids, active)}
          onReady={(handle) => { stage.current = handle }}
          createViewport={createViewport}
          options={viewportOptions}
        />
        <SceneStatusBar document={document} selection={selection} counts={counts} message={editor.message} />
      </div>
      <LiveRegion name="scene" message={announcement} />
    </WorkspaceShell>
  )
}
