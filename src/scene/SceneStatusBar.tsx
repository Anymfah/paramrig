import type { ReactNode } from 'react'
import type { SceneCounts } from '@/scene/document'
import type { SceneDocument, SceneSelection } from '@/scene/types'

/**
 * The line along the bottom: what the pointer and the keyboard can do here, what the editor is
 * saying, and the scene's numbers.
 *
 * The hints are the reason it exists. A modelling viewport has no visible affordances — there is
 * nothing on screen that says a middle drag orbits — so the status bar teaches the gestures as the
 * context changes, which is what Blender does and what makes the first minute survivable.
 */
export function SceneStatusBar({ document, selection, counts, message, keymapHint }: {
  document: SceneDocument
  selection: SceneSelection
  counts: SceneCounts
  message: string | null
  /** The one-line "press F1 for the keys" affordance, which stays after the hint chip has gone. */
  keymapHint?: ReactNode
}) {
  const hints = document.view.mode === 'edit'
    ? [['Select', 'click'], ['Extend', '⇧ click'], ['Orbit', 'middle drag'], ['Menu', 'right click']]
    : [['Select', 'click'], ['Extend', '⇧ click'], ['Orbit', 'middle drag'], ['Add', '⇧A']]

  return (
    <div className="scene-status" role="status">
      <div className="scene-status__hints">
        {keymapHint}
        {hints.map(([label, gesture]) => (
          <span key={label} className="scene-status__hint">
            <kbd>{gesture}</kbd>
            {label}
          </span>
        ))}
      </div>
      <p className="scene-status__message">{message ?? ''}</p>
      <div className="scene-status__stats">
        <span>Objects {selection.objectIds.length}/{counts.objects}</span>
        <span>Vertices {counts.vertices.toLocaleString()}</span>
        <span>Edges {counts.edges.toLocaleString()}</span>
        <span>Faces {counts.faces.toLocaleString()}</span>
        <span>Triangles {counts.triangles.toLocaleString()}</span>
      </div>
    </div>
  )
}
