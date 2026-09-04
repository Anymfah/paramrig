import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireSceneViewport, dropSceneViewport, keptViewportKeys, releaseSceneViewport } from '@/scene/viewport/keep'
import type { SceneViewport } from '@/scene/viewport/SceneViewport'

/**
 * The viewport that outlives the tree that showed it.
 *
 * What is being tested is the timing rather than the rendering: React unmounts the old tree before
 * it mounts the new one, so a viewport given back must not be destroyed on the spot — and one that
 * nobody comes back for must not be kept for ever.
 */

type Fake = { reparented: HTMLElement[]; disposed: number; viewport: SceneViewport }

function fake(): Fake {
  const state = { reparented: [] as HTMLElement[], disposed: 0 }
  const viewport = {
    reparent(container: HTMLElement) { state.reparented.push(container) },
    dispose() { state.disposed += 1 },
  } as unknown as SceneViewport
  return {
    get reparented() { return state.reparented },
    get disposed() { return state.disposed },
    viewport,
  }
}

function element(): HTMLElement {
  return document.createElement('div')
}

afterEach(() => {
  for (const key of keptViewportKeys()) dropSceneViewport(key)
  vi.useRealTimers()
})

describe('keeping a viewport', () => {
  it('builds one the first time and hands the same one back afterwards', () => {
    const instance = fake()
    const build = vi.fn(() => instance.viewport)
    const first = acquireSceneViewport('scene-1', element(), build)
    releaseSceneViewport('scene-1')
    const second = acquireSceneViewport('scene-1', element(), build)

    expect(build).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(instance.disposed).toBe(0)
  })

  it('moves it into whichever container is on screen', () => {
    const instance = fake()
    const tune = element()
    acquireSceneViewport('scene-1', element(), () => instance.viewport)
    releaseSceneViewport('scene-1')
    acquireSceneViewport('scene-1', tune, () => instance.viewport)

    expect(instance.reparented).toEqual([tune])
  })

  it('survives the gap between one tree unmounting and the next mounting', () => {
    vi.useFakeTimers()
    const instance = fake()
    acquireSceneViewport('scene-1', element(), () => instance.viewport)

    // Exactly what React does on a switch: the old host lets go, then the new one asks.
    releaseSceneViewport('scene-1')
    vi.advanceTimersByTime(16)
    acquireSceneViewport('scene-1', element(), () => instance.viewport)
    vi.advanceTimersByTime(10_000)

    expect(instance.disposed).toBe(0)
    expect(keptViewportKeys()).toEqual(['scene-1'])
  })

  it('gives it back to the graphics card when nobody comes for it', () => {
    vi.useFakeTimers()
    const instance = fake()
    acquireSceneViewport('scene-1', element(), () => instance.viewport)
    releaseSceneViewport('scene-1')

    expect(instance.disposed).toBe(0)
    vi.advanceTimersByTime(10_000)
    expect(instance.disposed).toBe(1)
    expect(keptViewportKeys()).toEqual([])
  })

  it('keeps one per document while both are on screen', () => {
    const first = fake()
    const second = fake()
    acquireSceneViewport('scene-1', element(), () => first.viewport)
    acquireSceneViewport('scene-2', element(), () => second.viewport)

    expect(keptViewportKeys().sort()).toEqual(['scene-1', 'scene-2'])
    expect(acquireSceneViewport('scene-2', element(), () => fake().viewport)).toBe(second.viewport)
  })

  it('drops the one nobody is showing when another document is opened', () => {
    const first = fake()
    const second = fake()
    acquireSceneViewport('scene-1', element(), () => first.viewport)
    releaseSceneViewport('scene-1')
    acquireSceneViewport('scene-2', element(), () => second.viewport)

    // Leaving a document is not switching modes: the context goes back at once rather than in four
    // seconds, and two scenes never hold two contexts between them.
    expect(first.disposed).toBe(1)
    expect(keptViewportKeys()).toEqual(['scene-2'])
  })

  it('disposes at once when a document is closed, whoever is holding it', () => {
    const instance = fake()
    acquireSceneViewport('scene-1', element(), () => instance.viewport)
    dropSceneViewport('scene-1')

    expect(instance.disposed).toBe(1)
    expect(keptViewportKeys()).toEqual([])
  })
})
