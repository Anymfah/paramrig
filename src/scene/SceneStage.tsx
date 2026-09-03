import { useCallback, useEffect, useRef } from 'react'
import { SceneViewportHost } from '@/scene/SceneViewportHost'
import type { ScenePreferences } from '@/scene/prefs'
import type { SceneDocument, SceneSelection, Vec3, ViewState } from '@/scene/types'
import { ViewNavigator } from '@/scene/viewport/navigation'
import type { SceneViewport, SceneViewportOptions } from '@/scene/viewport/SceneViewport'
import type { AxisView } from '@/scene/viewport/view'

/**
 * The canvas and everything that happens on it.
 *
 * The pointer is handled here rather than in the page because every decision it makes — is this a
 * navigation gesture, a click, or a drag; has it passed the threshold; who has the capture — has to
 * be made in the same place, in order, on every event. Splitting it across components is how a
 * viewport ends up with a click that sometimes also orbits.
 */

/** Below this, a press and release is a click and never a drag. Coarse pointers get more room. */
const DRAG_THRESHOLD_PX = 3
const COARSE_DRAG_THRESHOLD_PX = 5

export type SceneStageHandle = {
  viewport: SceneViewport | null
  navigator: ViewNavigator | null
  toAxis: (axis: AxisView, opposite?: boolean) => void
  frame: (which: 'all' | 'selection') => void
  toggleProjection: () => void
  step: (direction: 'up' | 'down' | 'left' | 'right') => void
}

export function SceneStage({
  document,
  selection,
  preferences,
  onView,
  onSelect,
  onReady,
  createViewport,
  options,
  children,
}: {
  document: SceneDocument
  selection: SceneSelection
  preferences: ScenePreferences
  /** Called when a view movement settles, so the document keeps the view without re-rendering. */
  onView: (view: ViewState) => void
  onSelect: (ids: string[], active: string | null) => void
  onReady?: (handle: SceneStageHandle) => void
  createViewport?: (container: HTMLElement, options: SceneViewportOptions) => SceneViewport
  options?: SceneViewportOptions
  children?: React.ReactNode
}) {
  const surface = useRef<HTMLDivElement>(null)
  const viewport = useRef<SceneViewport | null>(null)
  const navigator = useRef<ViewNavigator | null>(null)
  const frameHandle = useRef<number | null>(null)
  const press = useRef<{ x: number; y: number; button: number; moved: boolean; navigating: boolean } | null>(null)
  const hover = useRef<string | null>(null)
  const latestSelection = useRef(selection)
  latestSelection.current = selection
  const latestDocument = useRef(document)
  latestDocument.current = document
  const onViewRef = useRef(onView)
  onViewRef.current = onView
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  const pump = useCallback(() => {
    if (frameHandle.current !== null) return
    frameHandle.current = requestAnimationFrame(() => {
      frameHandle.current = null
      const nav = navigator.current
      if (!nav) return
      if (nav.tick()) pump()
    })
  }, [])

  const ready = useCallback((instance: SceneViewport | null) => {
    viewport.current = instance
    if (!instance) {
      navigator.current?.dispose()
      navigator.current = null
      onReadyRef.current?.({ viewport: null, navigator: null, toAxis: () => undefined, frame: () => undefined, toggleProjection: () => undefined, step: () => undefined })
      return
    }
    const nav = new ViewNavigator(latestDocument.current.view, preferences, {
      apply: (view) => {
        instance.setView(view)
        instance.invalidate()
        pump()
      },
      commit: (view) => onViewRef.current(view),
      size: () => instance.pixelSize,
      depthAt: (x, y) => pointUnder(instance, x, y),
      boundsOf: (which) => {
        const ids = which === 'selection' ? latestSelection.current.objectIds : undefined
        if (which === 'selection' && (!ids || ids.length === 0)) return instance.bounds()
        return instance.bounds(ids)
      },
    })
    navigator.current = nav
    instance.setView(latestDocument.current.view)
    instance.setDocument(latestDocument.current)
    instance.setSelection(latestSelection.current)
    onReadyRef.current?.({
      viewport: instance,
      navigator: nav,
      toAxis: (axis, opposite) => {
        nav.toAxis(axis)
        if (opposite) nav.toOpposite({ animate: false })
        pump()
      },
      frame: (which) => {
        nav.frame(which)
        pump()
      },
      toggleProjection: () => nav.toggleProjection(),
      step: (direction) => {
        nav.step(direction)
        pump()
      },
    })
  }, [preferences, pump])

  useEffect(() => {
    navigator.current?.setPreferences(preferences)
  }, [preferences])

  /**
   * A view set from outside — a View operator, the sidebar, a document opening — is travelled to
   * rather than jumped to. The navigator is the only thing that moves the camera, whoever asked.
   */
  useEffect(() => {
    const nav = navigator.current
    if (!nav || nav.active) return
    nav.adopt(document.view)
    pump()
  }, [document.view, pump])

  useEffect(() => () => {
    if (frameHandle.current !== null) cancelAnimationFrame(frameHandle.current)
    frameHandle.current = null
    navigator.current?.dispose()
  }, [])

  const threshold = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? COARSE_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX)

  /**
   * React attaches its wheel handler passively at the root, where `preventDefault` is refused and
   * the page scrolls behind the viewport. The zoom binds its own listener, once, non-passively.
   */
  useEffect(() => {
    const element = surface.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      const nav = navigator.current
      if (!nav) return
      event.preventDefault()
      const box = element.getBoundingClientRect()
      nav.wheel(event, event.clientX - box.left, event.clientY - box.top)
      pump()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [pump])

  return (
    <SceneViewportHost
      document={document}
      selection={selection}
      view={document.view}
      hoverId={hover.current}
      onReady={ready}
      createViewport={createViewport}
      options={options}
    >
      <div
        className="scene-surface"
        data-testid="scene-surface"
        onPointerDown={(event) => {
          const nav = navigator.current
          const instance = viewport.current
          if (!nav || !instance) return
          const gesture = nav.gestureFor(event.nativeEvent)
          const box = event.currentTarget.getBoundingClientRect()
          const x = event.clientX - box.left
          const y = event.clientY - box.top
          press.current = { x, y, button: event.button, moved: false, navigating: !!gesture }
          event.currentTarget.setPointerCapture(event.pointerId)
          if (gesture) {
            event.preventDefault()
            nav.begin(gesture, event.pointerId, x, y)
          }
        }}
        onPointerMove={(event) => {
          const nav = navigator.current
          const instance = viewport.current
          if (!nav || !instance) return
          const box = event.currentTarget.getBoundingClientRect()
          const x = event.clientX - box.left
          const y = event.clientY - box.top
          const held = press.current
          if (held) {
            if (!held.moved && Math.hypot(x - held.x, y - held.y) > threshold()) held.moved = true
            if (held.navigating) {
              nav.move(x, y)
              pump()
              return
            }
            return
          }
          // Hovering costs one small read of the id buffer, and never a React render.
          const found = instance.pickObject(x, y, 6)
          if (found === hover.current) return
          hover.current = found
          instance.setHover(found)
        }}
        onPointerUp={(event) => {
          const nav = navigator.current
          const instance = viewport.current
          const held = press.current
          press.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          if (!nav || !instance || !held) return
          if (held.navigating) {
            nav.end()
            return
          }
          if (held.moved || held.button !== 0) return
          const box = event.currentTarget.getBoundingClientRect()
          const found = instance.pickObject(event.clientX - box.left, event.clientY - box.top, 6)
          const current = latestSelection.current
          if (!found) {
            if (preferences.deselectOnEmptyClick) onSelectRef.current([], null)
            return
          }
          if (event.shiftKey) {
            const next = current.objectIds.includes(found)
              ? current.objectIds.filter((id) => id !== found)
              : [...current.objectIds, found]
            onSelectRef.current(next, next.includes(found) ? found : next.at(-1) ?? null)
            return
          }
          onSelectRef.current([found], found)
        }}
        onPointerCancel={() => {
          press.current = null
          navigator.current?.end()
        }}
        ref={surface}
        onContextMenu={(event) => event.preventDefault()}
      />
      {children}
    </SceneViewportHost>
  )
}

/**
 * The world point under a pixel: where the ray meets geometry, and otherwise where it crosses the
 * plane the view is looking at. Zooming towards the second is what makes the wheel usable over
 * empty space instead of doing nothing.
 */
function pointUnder(viewport: SceneViewport, x: number, y: number): Vec3 | null {
  return viewport.raycast(x, y)?.point ?? viewport.pointOnViewPlane(x, y)
}
