import { useSyncExternalStore } from 'react'
import type { MarqueeChannel } from '@/scene/viewport/marquee'

/** The rectangle, the lasso path or the circle a region selection is drawing. */
export function SceneMarquee({ channel }: { channel: MarqueeChannel }) {
  const state = useSyncExternalStore(channel.subscribe, channel.snapshot, channel.snapshot)
  if (!state.kind || state.points.length === 0) return null
  return (
    <svg className="scene-marquee" aria-hidden="true">
      {state.kind === 'box' && state.points.length === 2 ? (
        <rect
          className="scene-marquee__shape"
          x={Math.min(state.points[0]![0], state.points[1]![0])}
          y={Math.min(state.points[0]![1], state.points[1]![1])}
          width={Math.abs(state.points[1]![0] - state.points[0]![0])}
          height={Math.abs(state.points[1]![1] - state.points[0]![1])}
        />
      ) : null}
      {state.kind === 'lasso' && state.points.length > 1 ? (
        <polygon className="scene-marquee__shape" points={state.points.map((point) => `${point[0]},${point[1]}`).join(' ')} />
      ) : null}
      {state.kind === 'circle' && state.points[0] ? (
        <circle className="scene-marquee__circle" cx={state.points[0][0]} cy={state.points[0][1]} r={state.radius} />
      ) : null}
    </svg>
  )
}
