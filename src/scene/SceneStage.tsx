import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Euler, Matrix4 } from 'three'
import { ModalTransform, selectionPivot } from '@/scene/modalTransform'
import { orientationBasis } from '@/scene/transform/orientation'
import { worldTransform } from '@/scene/objects'
import { SceneHud } from '@/scene/SceneHud'
import { SceneViewportHost } from '@/scene/SceneViewportHost'
import type { ScenePreferences } from '@/scene/prefs'
import type { TransformMode } from '@/scene/transform/session'
import type { SceneDocument, SceneObject, SceneSelection, Vec3, ViewState } from '@/scene/types'
import { HudChannel } from '@/scene/viewport/hud'
import { ViewNavigator } from '@/scene/viewport/navigation'
import type { SceneViewport, SceneViewportOptions } from '@/scene/viewport/SceneViewport'
import { cameraBasis, type AxisView } from '@/scene/viewport/view'

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
  /** Opens a modal transform on the selection. False when there is nothing to move. */
  startTransform: (mode: TransformMode) => boolean
  /** Offers a key to a running modal tool; true when it took it. */
  handleKey: (event: KeyboardEvent) => boolean
  transformActive: () => boolean
}

export function SceneStage({
  document,
  selection,
  preferences,
  onView,
  onSelect,
  onTransform,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
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
  /** Writes transforms during a gesture, without recording each frame. */
  onTransform: (patches: Array<{ id: string; patch: Partial<SceneObject> }>) => void
  onGestureStart: (label: string) => void
  onGestureEnd: (label: string) => void
  onGestureCancel: () => void
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
  const gestures = useRef({ onTransform, onGestureStart, onGestureEnd, onGestureCancel })
  gestures.current = { onTransform, onGestureStart, onGestureEnd, onGestureCancel }
  const pointer = useRef<[number, number]>([0, 0])
  const hud = useMemo(() => new HudChannel(), [])
  const modal = useRef<ModalTransform | null>(null)
  if (!modal.current) {
    modal.current = new ModalTransform({
      viewport: () => viewport.current,
      document: () => latestDocument.current,
      selection: () => latestSelection.current,
      hud,
      overlay: () => viewport.current?.transformOverlay ?? null,
      apply: (patches) => gestures.current.onTransform(patches),
      beginGesture: (label) => gestures.current.onGestureStart(label),
      endGesture: (label) => gestures.current.onGestureEnd(label),
      cancelGesture: () => gestures.current.onGestureCancel(),
      invalidate: () => viewport.current?.invalidate(),
      pointer: () => pointer.current,
    })
  }
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
      onReadyRef.current?.({
        viewport: null,
        navigator: null,
        toAxis: () => undefined,
        frame: () => undefined,
        toggleProjection: () => undefined,
        step: () => undefined,
        startTransform: () => false,
        handleKey: () => false,
        transformActive: () => false,
      })
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
      startTransform: (mode) => modal.current?.start(mode, surface.current, {}) ?? false,
      handleKey: (event) => modal.current?.key(event) ?? false,
      transformActive: () => modal.current?.active ?? false,
    })
  }, [preferences, pump])

  useEffect(() => {
    navigator.current?.setPreferences(preferences)
  }, [preferences])

  /**
   * Where the gizmos are, and which of them are shown. It is recomputed when the selection, the
   * pivot or the orientation changes — never per frame, because the only thing that changes per
   * frame is their size on screen, which the viewport works out for itself.
   */
  useEffect(() => {
    const instance = viewport.current
    if (!instance) return
    const kinds: Array<'move' | 'rotate' | 'scale'> = []
    if (document.view.gizmos.move) kinds.push('move')
    if (document.view.gizmos.rotate) kinds.push('rotate')
    if (document.view.gizmos.scale) kinds.push('scale')
    const pivot = selectionPivot(document, selection)
    if (!pivot || kinds.length === 0 || document.view.mode === 'sculpt') {
      instance.setGizmos([], [0, 0, 0], { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] })
      return
    }
    const active = document.objects.find((object) => object.id === selection.activeObjectId)
    const camera = cameraBasis(document.view.yaw, document.view.pitch)
    const basis = orientationBasis(document.view.orientation, {
      active: active ? worldTransform(document, active) : null,
      view: { ...camera, unitsPerPixel: instance.unitsPerPixelAt(pivot), pivotScreen: instance.project(pivot) ?? [0, 0] },
      normal: null,
      cursor: cursorBasis(document.cursor.rotation),
    })
    instance.setGizmos(kinds, pivot, basis)
  }, [document, selection])

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
          // A modal transform owns the pointer: the left button confirms it, any other cancels.
          const running = modal.current
          if (running?.active && !running.dragging) {
            event.preventDefault()
            if (event.button === 0) running.confirm()
            else running.cancel()
            return
          }
          const gesture = nav.gestureFor(event.nativeEvent)
          const box = event.currentTarget.getBoundingClientRect()
          const x = event.clientX - box.left
          const y = event.clientY - box.top
          // A gizmo handle is grabbed before anything else, and opens the same session G would.
          if (!gesture && event.button === 0) {
            const handle = instance.gizmoHandle(instance.pick(x, y, 8))
            if (handle) {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              modal.current?.start(handle.mode, surface.current, {
                pointer: [x, y],
                fromDrag: true,
                ...(handle.axes.length === 1
                  ? { constraint: { axis: handle.axes[0]!, kind: 'axis' as const, space: 'global' as const } }
                  : handle.axes.length === 2
                    ? { constraint: { axis: (['x', 'y', 'z'] as const).find((name) => !handle.axes.includes(name))!, kind: 'plane' as const, space: 'global' as const } }
                    : {}),
              })
              return
            }
          }
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
          pointer.current = [x, y]
          const running = modal.current
          if (running?.active) {
            running.move({
              x,
              y,
              dx: event.nativeEvent.movementX,
              dy: event.nativeEvent.movementY,
              shift: event.shiftKey,
              ctrl: event.ctrlKey,
              alt: event.altKey,
            })
            return
          }
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
          // Hovering costs one small read of the id buffer, and never a React render. A gizmo
          // handle wins over the object behind it, which is the first rule of the click order.
          const picked = instance.pick(x, y, 8)
          const handle = instance.gizmoHandle(picked)
          instance.setGizmoHover(handle?.id ?? null)
          const found = handle ? null : picked?.kind === 'object'
            ? latestDocument.current.objects[picked.id]?.id ?? null
            : null
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
          // Letting go of a handle finishes the transform it started; a session begun from the
          // keyboard is not ended by a button coming back up.
          if (modal.current?.dragging) {
            modal.current.confirm()
            return
          }
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
      <SceneHud channel={hud} />
      {children}
    </SceneViewportHost>
  )
}

/** The 3D cursor's own frame, from the Euler angles the document stores it with. */
function cursorBasis(rotation: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const euler = new Euler((rotation[0] * Math.PI) / 180, (rotation[1] * Math.PI) / 180, (rotation[2] * Math.PI) / 180, 'XYZ')
  const element = new Matrix4().makeRotationFromEuler(euler).elements
  return {
    x: [element[0]!, element[1]!, element[2]!],
    y: [element[4]!, element[5]!, element[6]!],
    z: [element[8]!, element[9]!, element[10]!],
  }
}

/**
 * The world point under a pixel: where the ray meets geometry, and otherwise where it crosses the
 * plane the view is looking at. Zooming towards the second is what makes the wheel usable over
 * empty space instead of doing nothing.
 */
function pointUnder(viewport: SceneViewport, x: number, y: number): Vec3 | null {
  return viewport.raycast(x, y)?.point ?? viewport.pointOnViewPlane(x, y)
}
