import { useMemo, type ReactNode } from 'react'
import type { SceneCounts } from '@/scene/document'
import { editStats } from '@/scene/editStats'
import type { SceneDocument, SceneSelection } from '@/scene/types'

/**
 * The line along the bottom: what the pointer and the keyboard can do here, what the editor is
 * saying, and the scene's numbers.
 *
 * The hints are the reason it exists. A modelling viewport has no visible affordances — there is
 * nothing on screen that says a middle drag orbits — so the status bar teaches the gestures as the
 * context changes, which is what Blender does and what makes the first minute survivable.
 */
export function SceneStatusBar({ document, selection, counts, message, keymapHint, animation }: {
  document: SceneDocument
  selection: SceneSelection
  counts: SceneCounts
  message: string | null
  /** The one-line "press F1 for the keys" affordance, which stays after the hint chip has gone. */
  keymapHint?: ReactNode
  /**
   * The transport, shown only once the scene has something to play.
   *
   * A timeline is a whole editor of its own and it lives in the workbench; what belongs here is the
   * frame and the play button, so that a person who has just keyed something can watch it without
   * leaving the viewport.
   */
  animation?: {
    frame: number
    frames: number
    playing: boolean
    onPlay: (playing: boolean) => void
    onFrame: (frame: number) => void
  }
}) {
  const editing = document.view.mode === 'edit'
  const hints = editing
    ? [['Select', 'click'], ['Extend', '⇧ click'], ['Loop', '⌥ click'], ['Path', '⌃ click'], ['Orbit', 'middle drag']]
    : [['Select', 'click'], ['Extend', '⇧ click'], ['Orbit', 'middle drag'], ['Add', '⇧A']]
  // Edit mode counts what is being edited, not the scene: that is the number a person is watching.
  // Counted when the document or the selection changes, not on every render of the bar.
  const stats = useMemo(
    () => (document.view.mode === 'edit' ? editStats(document, selection) : null),
    [document, selection],
  )

  return (
    <div className="scene-status" role="status">
      <div className="scene-status__hints">
        {keymapHint}
        {keymapHint ? <span className="scene-status__rule" aria-hidden="true" /> : null}
        {hints.map(([label, gesture]) => (
          <span key={label} className="scene-status__hint">
            <kbd>{gesture}</kbd>
            {label}
          </span>
        ))}
      </div>
      <p className="scene-status__message">{message ?? ''}</p>
      {animation ? (
        <div className="scene-status__transport" role="group" aria-label="Playback">
          <button
            type="button"
            className="scene-status__step"
            aria-label="Step back one frame"
            onClick={() => animation.onFrame(animation.frame - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="scene-status__play"
            aria-label={animation.playing ? 'Pause' : 'Play'}
            aria-pressed={animation.playing}
            onClick={() => animation.onPlay(!animation.playing)}
          >
            {animation.playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="scene-status__step"
            aria-label="Step forward one frame"
            onClick={() => animation.onFrame(animation.frame + 1)}
          >
            ›
          </button>
          <span className="scene-status__frame">Frame {animation.frame} / {animation.frames}</span>
        </div>
      ) : null}
      <div className="scene-status__stats">
        {stats ? (
          <>
            <span>Verts {stats.vertices.selected.toLocaleString()}/{stats.vertices.total.toLocaleString()}</span>
            <span>Edges {stats.edges.selected.toLocaleString()}/{stats.edges.total.toLocaleString()}</span>
            <span>Faces {stats.faces.selected.toLocaleString()}/{stats.faces.total.toLocaleString()}</span>
            <span>Tris {stats.triangles.toLocaleString()}</span>
            {stats.objects > 1 ? <span>Objects {stats.objects}</span> : null}
          </>
        ) : (
          <>
            <span>Objects {selection.objectIds.length}/{counts.objects}</span>
            <span>Vertices {counts.vertices.toLocaleString()}</span>
            <span>Edges {counts.edges.toLocaleString()}</span>
            <span>Faces {counts.faces.toLocaleString()}</span>
            <span>Triangles {counts.triangles.toLocaleString()}</span>
          </>
        )}
      </div>
    </div>
  )
}
