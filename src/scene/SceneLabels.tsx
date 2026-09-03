import { useSyncExternalStore } from 'react'
import type { LabelChannel } from '@/scene/viewport/labels'

/**
 * The measurement overlays: an index, a length, an angle, an area, each where its element is.
 *
 * Text over a canvas rather than in it. A browser draws a legible number at every device ratio and
 * in the reader's own font size; a canvas has to be taught how, and would lose it to the viewport's
 * own scaling. They never take the pointer — what is underneath is the mesh, and clicking a number
 * should select the face it belongs to.
 */
export function SceneLabels({ channel }: { channel: LabelChannel }) {
  const labels = useSyncExternalStore(channel.subscribe, channel.snapshot, channel.snapshot)
  if (labels.length === 0) return null
  return (
    <div className="scene-labels" aria-hidden="true">
      {labels.map((label, index) => (
        <span
          key={`${label.kind}-${index}`}
          className="scene-label"
          data-kind={label.kind}
          style={{ transform: `translate(${label.x}px, ${label.y}px)` }}
        >
          {label.text}
        </span>
      ))}
    </div>
  )
}
