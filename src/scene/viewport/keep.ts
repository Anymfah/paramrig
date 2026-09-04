import type { SceneViewport, SceneViewportOptions } from '@/scene/viewport/SceneViewport'

/**
 * One viewport per document, kept alive across the switch between editing and tuning.
 *
 * Editing a scene and tuning its controls are two different React trees: the editor page, and the
 * workbench's shell with an inspector beside a preview. Mounting a viewport in each would mean a
 * second WebGL context, a second shader cache, a second copy of every geometry on the card — and,
 * every time a person pressed Edit or Tune, a black frame while all of it was built again.
 *
 * So the viewport outlives the component. It is asked for by document id, moved into whichever
 * container is on screen, and given back rather than destroyed. Disposal is deferred by a moment
 * because React unmounts the old tree before it mounts the new one: without the delay, the switch
 * would destroy the very thing it is about to ask for.
 */

type Kept = {
  viewport: SceneViewport
  /** How many hosts are showing it. Above zero it is never disposed. */
  users: number
  /** The pending disposal, cancelled when it is asked for again. */
  timer: ReturnType<typeof setTimeout> | null
}

/** How long a viewport waits, unused, before it is given back to the graphics card. */
const GRACE_MS = 4000

const kept = new Map<string, Kept>()

/**
 * The viewport for a document, built if there is not one, moved into `container` either way.
 *
 * `build` is called only when there is nothing to reuse, so a caller that wants a double for a
 * test gets one — and the same double is reused on the next mount, which is what the test is
 * usually checking.
 */
export function acquireSceneViewport(
  key: string,
  container: HTMLElement,
  build: () => SceneViewport,
  options: SceneViewportOptions = {},
): SceneViewport {
  const existing = kept.get(key)
  if (existing) {
    if (existing.timer) {
      clearTimeout(existing.timer)
      existing.timer = null
    }
    existing.users += 1
    existing.viewport.reparent(container, options)
    return existing.viewport
  }
  /*
   * One document at a time. Asking for another document's viewport means this one has been left
   * rather than switched away from, and two contexts is exactly what all of this exists to avoid.
   */
  for (const other of [...kept.keys()]) {
    if (other !== key && (kept.get(other)?.users ?? 0) === 0) dropSceneViewport(other)
  }
  const viewport = build()
  kept.set(key, { viewport, users: 1, timer: null })
  return viewport
}

/** Given back. The viewport lives on for a moment, in case the other tree is about to ask for it. */
export function releaseSceneViewport(key: string): void {
  const entry = kept.get(key)
  if (!entry) return
  entry.users = Math.max(0, entry.users - 1)
  if (entry.users > 0 || entry.timer) return
  entry.timer = setTimeout(() => {
    const current = kept.get(key)
    if (!current || current.users > 0) return
    kept.delete(key)
    current.viewport.dispose()
  }, GRACE_MS)
}

/** Disposes at once, whatever is holding it: closing a document, and the tests. */
export function dropSceneViewport(key: string): void {
  const entry = kept.get(key)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  kept.delete(key)
  entry.viewport.dispose()
}

/** Every document whose viewport is still alive, for the tests and the debug hatch. */
export function keptViewportKeys(): string[] {
  return [...kept.keys()]
}
