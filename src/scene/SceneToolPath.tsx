import { useSyncExternalStore } from 'react'
import type { ToolPathChannel } from '@/scene/viewport/toolPath'

/**
 * The preview a tool draws: a loop cut's cuts before they are made, a knife's path before it cuts.
 *
 * It is SVG over the canvas rather than geometry inside it. The lines are already in screen space
 * by the time they arrive — a loop cut's are projected from the mesh, a knife's are where the
 * pointer has been — and drawing them here keeps them crisp, keeps them out of the id buffer, and
 * keeps them from fighting the surface they lie on for depth.
 */
export function SceneToolPath({ channel }: { channel: ToolPathChannel }) {
  const state = useSyncExternalStore(channel.subscribe, channel.snapshot, channel.snapshot)
  if (!state.kind) return null
  return (
    <svg className="scene-tool-path" data-kind={state.kind} aria-hidden="true">
      {state.lines.map((line, index) => (
        <polyline
          key={index}
          className="scene-tool-path__line"
          points={line.map((point) => `${point[0]},${point[1]}`).join(' ')}
        />
      ))}
      {state.placed.map((point, index) => (
        <circle key={index} className="scene-tool-path__point" cx={point[0]} cy={point[1]} r={3.5} />
      ))}
      {state.snap ? <circle className="scene-tool-path__snap" cx={state.snap[0]} cy={state.snap[1]} r={5} /> : null}
    </svg>
  )
}
