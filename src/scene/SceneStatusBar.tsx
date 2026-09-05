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
export function SceneStatusBar({ document, selection, counts, message, alert, editData, keymapHint, animation }: {
  document: SceneDocument
  selection: SceneSelection
  counts: SceneCounts
  message: string | null
  /**
   * A condition that holds until something is done about it, as opposed to the operator feedback
   * beside it, which is about the last thing that happened.
   *
   * It has its own place because the two must not take turns: a scene too big for browser storage
   * stops being saved, and the next extrude's "Extruded 4 faces" would carry that news away. While
   * one is up the gesture hints stand down — they teach, and this is not the moment for teaching —
   * so the whole sentence fits, including the half that says what to do about it.
   */
  alert?: string | null
  /** What the active object being edited is, so the line says what the next gesture does. */
  editData?: 'mesh' | 'curve' | 'text'
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
  /*
   * The line says what the *next* gesture does, so it has to know what is open. A loop and a path
   * mean nothing on a curve, and nothing at all on a text object, where the keyboard writes letters
   * rather than running operators.
   */
  const hints = document.view.mode === 'vertex-paint'
    ? [['Paint', 'drag'], ['Second colour', '⌃ drag'], ['Smooth', '⇧ drag'], ['Size', 'F'], ['Fill', '⇧K']]
    : !editing
    ? [['Select', 'click'], ['Extend', '⇧ click'], ['Orbit', 'middle drag'], ['Add', '⇧A']]
    : editData === 'text'
      ? [['Type', 'letters'], ['Select', '⇧ ←→'], ['Paste', '⌘V'], ['Done', 'Tab']]
      : editData === 'curve'
        ? [['Select', 'click'], ['Extend', '⇧ click'], ['Move', 'G'], ['Handles', 'V'], ['Orbit', 'middle drag']]
        : [['Select', 'click'], ['Extend', '⇧ click'], ['Loop', '⌥ click'], ['Path', '⌃ click'], ['Orbit', 'middle drag']]
  // Edit mode counts what is being edited, not the scene: that is the number a person is watching.
  // Counted when the document or the selection changes, not on every render of the bar.
  const stats = useMemo(
    // A text object has no elements to count: the numbers would all be zero, which says less than
    // nothing. Its own line of hints is what the bar carries instead.
    () => (document.view.mode === 'edit' && editData !== 'text' ? editStats(document, selection) : null),
    [document, selection, editData],
  )

  return (
    <div className="scene-status" role="status">
      {alert ? null : (
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
      )}
      {alert ? <p className="scene-status__alert" role="alert">{alert}</p> : null}
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
