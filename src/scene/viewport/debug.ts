import type { SceneViewport } from '@/scene/viewport/SceneViewport'
import type { Vec3 } from '@/scene/types'

/**
 * The hatch the browser QA scripts reach the viewport through.
 *
 * A 3D editor cannot be driven from the outside by CSS selectors: a script that wants to click a
 * vertex has to know where that vertex is on screen, and a script that wants to prove nothing is
 * animating has to see the frame counter. This exposes exactly that much and no more, and only in
 * a development build — a production bundle has no `window.__paramrigScene` at all.
 */

export type SceneDebugApi = {
  project: (point: Vec3) => [number, number] | null
  unproject: (x: number, y: number, depth?: number) => Vec3
  pick: (x: number, y: number) => { kind: string; id: number } | null
  pickObject: (x: number, y: number) => string | null
  stats: () => ReturnType<SceneViewport['stats']>
  /** Draws one frame synchronously and returns how long it took, in milliseconds. */
  frame: () => number
  /** Frames drawn since the page loaded; a still viewport does not move it. */
  frames: () => number
  invalidateCount: () => number
  bounds: (objectIds?: string[]) => { min: Vec3; max: Vec3 } | null
  /** Milliseconds from navigation to the first frame the viewport drew. */
  firstFrame: () => number | null
  loseContext: () => boolean
  restoreContext: () => boolean
}

declare global {
  interface Window {
    __paramrigScene?: SceneDebugApi
  }
}

const FIRST_FRAME_MARK = 'paramrig-scene-first-frame'

let firstFrameAt: number | null = null

export function markFirstFrame(): void {
  if (firstFrameAt !== null || typeof performance === 'undefined') return
  firstFrameAt = performance.now()
  try {
    performance.mark(FIRST_FRAME_MARK)
  } catch {
    /* A browser that refuses the mark still reports the number below. */
  }
}

export function installSceneDebug(viewport: SceneViewport): () => void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return () => undefined
  const api: SceneDebugApi = {
    project: (point) => viewport.project(point),
    unproject: (x, y, depth) => viewport.unproject(x, y, depth),
    pick: (x, y) => viewport.pick(x, y),
    pickObject: (x, y) => viewport.pickObject(x, y),
    stats: () => viewport.stats(),
    frame: () => {
      const started = performance.now()
      viewport.render()
      return performance.now() - started
    },
    frames: () => viewport.stats().frames,
    invalidateCount: () => viewport.stats().invalidateCount,
    bounds: (objectIds) => viewport.bounds(objectIds),
    firstFrame: () => firstFrameAt,
    loseContext: () => {
      const context = (viewport.canvas.getContext('webgl2') ?? viewport.canvas.getContext('webgl')) as WebGLRenderingContext | null
      const extension = context?.getExtension('WEBGL_lose_context')
      if (!extension) return false
      extension.loseContext()
      return true
    },
    restoreContext: () => {
      const context = (viewport.canvas.getContext('webgl2') ?? viewport.canvas.getContext('webgl')) as WebGLRenderingContext | null
      const extension = context?.getExtension('WEBGL_lose_context')
      if (!extension) return false
      extension.restoreContext()
      return true
    },
  }
  window.__paramrigScene = api
  return () => {
    if (window.__paramrigScene === api) delete window.__paramrigScene
  }
}
