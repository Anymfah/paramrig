import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getSceneDocument } from '@/scene/document'
import { DEFAULT_PREFERENCES } from '@/scene/prefs'
import { resolveSceneValues } from '@/scene/rig'
import { SceneViewportHost } from '@/scene/SceneViewportHost'
import { ViewNavigator } from '@/scene/viewport/navigation'
import type { SceneViewport, SceneViewportOptions } from '@/scene/viewport/SceneViewport'
import type { SceneSelection, ViewState } from '@/scene/types'
import type { ParamValue } from '@/rigs/types'
import type { RigSession } from '@/state/session'
import { StatusMessage } from '@/ui/StatusMessage'

/**
 * A scene in Tune mode: the same viewport, with the controls driving it and nothing to edit.
 *
 * Two things make this more than a second editor. It is the *same* viewport — the host keeps one
 * per document, so switching between Edit and Tune moves a canvas rather than building a second
 * WebGL context — and it reads the session twice over: the slow way, through `previewValues()` on
 * every revision, and the fast way, through the clock, so a control being animated moves in the
 * frame after it changes rather than in the frame after React notices.
 *
 * What is missing is deliberate: no selection, no gizmos, no tools. Tuning a rig is looking at it
 * and turning its controls; anything else belongs in the editor, one button away.
 */

const NOTHING_SELECTED: SceneSelection = { objectIds: [], activeObjectId: null }

export function SceneRigPreview({ documentId, session, values, name, createViewport }: {
  documentId: string
  /** The workbench's session for this rig; the preview reads it and never writes to it. */
  session: RigSession | null
  /** What the inspector says the controls are, for the moments there is no session to ask. */
  values: Record<string, ParamValue>
  name: string
  /** A test hands over a double, as the editor page does; the workbench uses the real one. */
  createViewport?: (container: HTMLElement, options: SceneViewportOptions) => SceneViewport
}) {
  const viewport = useRef<SceneViewport | null>(null)
  const navigator = useRef<ViewNavigator | null>(null)
  const frame = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  /** The view the preview is looking from: the document's, then whatever the pointer does to it. */
  const [view, setView] = useState<ViewState | null>(null)

  // Every edit of a control: the values are re-read and the document resolved again.
  const revision = useSyncExternalStore(
    useCallback((listener: () => void) => session?.subscribe(listener) ?? (() => undefined), [session]),
    () => session?.getRevision() ?? 0,
    () => 0,
  )
  // And every tick of the clock, so an animated control moves without an edit behind it.
  const beat = useSyncExternalStore(
    useCallback((listener: () => void) => session?.subscribeClock(listener) ?? (() => undefined), [session]),
    () => (session?.isPlaying() ? session.playheadTime() : 0),
    () => 0,
  )

  const document = useMemo(() => getSceneDocument(documentId), [documentId])
  const shown = useMemo(
    () => {
      void revision
      void beat
      return document ? resolveSceneValues(document, session?.previewValues() ?? values) : null
    },
    // The revision and the beat are the reasons to look again; the values are what is looked at.
    [document, session, values, revision, beat],
  )

  // A frame per change, asked for directly: the viewport draws on demand rather than on a loop.
  useEffect(() => {
    if (ready) viewport.current?.invalidate()
  }, [shown, ready])

  /*
   * Navigation, and only navigation.
   *
   * Tuning a rig means looking at it from where you like while you turn its controls, so the view
   * is the preview's own: orbit, pan, zoom and framing all work, and none of them touch the
   * document. The same navigator the editor uses does the arithmetic, so the two feel identical.
   */
  /*
   * The navigator damps towards where a drag is heading rather than snapping to it, so somebody has
   * to drive the frames while it settles. The editor's stage does the same thing with the same
   * three lines; without them a drag moves the destination and nothing on screen.
   */
  const pump = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (navigator.current?.tick()) pump()
    })
  }, [])

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
  }, [])

  useEffect(() => {
    if (!shown || navigator.current) return
    navigator.current = new ViewNavigator(shown.view, DEFAULT_PREFERENCES, {
      apply: (next) => {
        setView(next)
        viewport.current?.setView(next)
        pump()
      },
      commit: (next) => setView(next),
      boundsOf: () => viewport.current?.bounds() ?? null,
      size: () => viewport.current?.pixelSize ?? { width: 1, height: 1 },
    })
    setView(shown.view)
  }, [shown, pump])

  if (!document || !shown) {
    return <StatusMessage>That scene is not in this browser. Open it from the library on the machine it was made on.</StatusMessage>
  }

  const nav = navigator.current
  return (
    <div className="scene-preview" aria-label={`${name}, three-dimensional preview`}>
      <SceneViewportHost
        document={shown}
        selection={NOTHING_SELECTED}
        view={view ?? shown.view}
        keepKey={documentId}
        {...(createViewport ? { createViewport } : {})}
        onReady={(instance) => {
          viewport.current = instance
          setReady(instance !== null)
        }}
      >
        <div
          className="scene-preview__surface"
          onPointerDown={(event) => {
            const gesture = nav?.gestureFor(event.nativeEvent) ?? null
            if (!gesture || !nav) return
            event.preventDefault()
            // A synthetic press has no pointer to capture, and a test that dispatches one should
            // not take the whole preview down with it.
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              /* Nothing to capture. */
            }
            nav.begin(gesture, event.pointerId, event.clientX, event.clientY)
          }}
          onPointerMove={(event) => nav?.move(event.clientX, event.clientY)}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture?.(event.pointerId)
            nav?.end()
          }}
          onPointerCancel={() => nav?.end()}
          onWheel={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            nav?.wheel(event.nativeEvent, event.clientX - box.left, event.clientY - box.top)
          }}
          onDoubleClick={() => nav?.frame('all', { animate: true })}
        />
      </SceneViewportHost>
    </div>
  )
}
