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
  leaks: () => SceneLeakCounters
}

/**
 * What a closed scene left behind. A viewport that does not give its geometries, its textures and
 * its render targets back keeps them on the graphics card for the life of the tab, and nothing in
 * the interface would ever say so — which is why the numbers are counted here and asserted by a QA
 * script rather than trusted.
 */
export type SceneLeakCounters = {
  /** Viewports built and not yet disposed. */
  viewports: number
  /** What the renderer still held when the last one was disposed. */
  geometries: number
  textures: number
  programs: number
}

declare global {
  interface Window {
    __paramrigScene?: SceneDebugApi
    __paramrigSceneLeaks?: SceneLeakCounters
  }
}

function counters(): SceneLeakCounters {
  if (typeof window === 'undefined') return { viewports: 0, geometries: 0, textures: 0, programs: 0 }
  if (!window.__paramrigSceneLeaks) window.__paramrigSceneLeaks = { viewports: 0, geometries: 0, textures: 0, programs: 0 }
  return window.__paramrigSceneLeaks
}

/** Called by the viewport as it is built and as it is disposed. */
export function countViewport(change: 1 | -1, left?: { geometries: number; textures: number; programs: number }): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  const held = counters()
  held.viewports = Math.max(0, held.viewports + change)
  if (!left) return
  held.geometries = left.geometries
  held.textures = left.textures
  held.programs = left.programs
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
    leaks: () => counters(),
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
