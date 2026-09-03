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
import { boundsOfPoints, insidePolygon, MarqueeChannel, type MarqueeKind } from '@/scene/viewport/marquee'
import { SceneMarquee } from '@/scene/SceneMarquee'
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
  /** Where the pointer last was, in page coordinates, for a menu that opens at it. */
  pointerPage: () => { x: number; y: number }
}

export function SceneStage({
  document,
  selection,
  preferences,
  onView,
  onSelect,
  onRegionSelect,
  onPlaceCursor,
  onContextMenu,
  onAnnotate,
  onMeasure,
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
  /** What a box, lasso or circle covered, and how it should be combined with the selection. */
  onRegionSelect: (ids: string[], mode: 'new' | 'extend' | 'subtract') => void
  /** Where a ⇧ right-click asks for the 3D cursor to go. */
  onPlaceCursor: (position: Vec3, normal: Vec3 | null) => void
  /** A plain right-click asks for the object menu at that point. */
  onContextMenu: (at: { x: number; y: number }) => void
  /** A freehand stroke, finished. Kept in the document but outside the history. */
  onAnnotate: (points: Vec3[]) => void
  /** A ruler, finished, likewise. */
  onMeasure: (from: Vec3, to: Vec3) => void
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
  const marquee = useMemo(() => new MarqueeChannel(), [])
  const region = useRef<{ kind: MarqueeKind; points: Array<[number, number]>; mode: 'new' | 'extend' | 'subtract'; radius: number } | null>(null)
  const onRegionRef = useRef(onRegionSelect)
  onRegionRef.current = onRegionSelect
  const onPlaceRef = useRef(onPlaceCursor)
  onPlaceRef.current = onPlaceCursor
  const onMenuRef = useRef(onContextMenu)
  onMenuRef.current = onContextMenu
  const sketch = useRef<{ tool: 'annotate' | 'measure'; points: Vec3[] } | null>(null)
  const onDrawRef = useRef({ onAnnotate, onMeasure })
  onDrawRef.current = { onAnnotate, onMeasure }
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
        pointerPage: () => ({ x: 0, y: 0 }),
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
      pointerPage: () => {
        const box = surface.current?.getBoundingClientRect()
        return box
          ? { x: box.left + pointer.current[0], y: box.top + pointer.current[1] }
          : { x: pointer.current[0], y: pointer.current[1] }
      },
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
          // ⇧ and the right button put the 3D cursor on the surface under the pointer, and on the
          // plane the view is looking at where there is no surface — which is what Blender does.
          if (event.button === 2 && event.shiftKey) {
            event.preventDefault()
            const hit = instance.raycast(x, y)
            onPlaceRef.current(hit?.point ?? instance.pointOnViewPlane(x, y), hit?.normal ?? null)
            return
          }
          press.current = { x, y, button: event.button, moved: false, navigating: !!gesture }
          event.currentTarget.setPointerCapture(event.pointerId)
          if (gesture) {
            event.preventDefault()
            nav.begin(gesture, event.pointerId, x, y)
            return
          }
          // The two tools that draw on the scene take the press before the marquee does.
          if (event.button === 0 && (latestDocument.current.view.tool === 'annotate' || latestDocument.current.view.tool === 'measure')) {
            const tool = latestDocument.current.view.tool as 'annotate' | 'measure'
            sketch.current = { tool, points: [pointInScene(instance, x, y)] }
            return
          }
          // A drag with the select tool draws a region; ⌃ makes it a lasso, as in Blender.
          if (event.button === 0) {
            const tool = latestDocument.current.view.tool
            const kind: MarqueeKind | null = event.ctrlKey || tool === 'select-lasso'
              ? 'lasso'
              : tool === 'select-circle'
                ? 'circle'
                : tool === 'select-box'
                  ? 'box'
                  : null
            if (kind) {
              region.current = {
                kind,
                points: [[x, y]],
                mode: event.shiftKey ? 'extend' : event.ctrlKey && kind !== 'lasso' ? 'subtract' : 'new',
                radius: 40,
              }
            }
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
          const stroke = sketch.current
          if (stroke) {
            const point = pointInScene(instance, x, y)
            if (stroke.tool === 'annotate') {
              stroke.points.push(point)
              instance.annotations?.setDraft(stroke.points, latestTheme(instance), 3)
            } else {
              stroke.points[1] = point
              instance.annotations?.setDraftRuler(stroke.points[0]!, point)
            }
            instance.invalidate()
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
            const drawing = region.current
            if (drawing && held.moved) {
              if (drawing.kind === 'box') drawing.points = [[held.x, held.y], [x, y]]
              else if (drawing.kind === 'lasso') drawing.points.push([x, y])
              else drawing.points = [[x, y]]
              marquee.set({ kind: drawing.kind, points: [...drawing.points], radius: drawing.radius })
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
          const stroke = sketch.current
          sketch.current = null
          if (stroke && instance) {
            instance.annotations?.setDraft([], '#ffffff', 3)
            instance.annotations?.setDraftRuler(null, null)
            instance.invalidate()
            if (stroke.tool === 'annotate' && stroke.points.length > 1) onDrawRef.current.onAnnotate(stroke.points)
            if (stroke.tool === 'measure' && stroke.points.length === 2) onDrawRef.current.onMeasure(stroke.points[0]!, stroke.points[1]!)
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            return
          }
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
            region.current = null
            marquee.clear()
            return
          }
          const drawing = region.current
          region.current = null
          marquee.clear()
          if (drawing && held.moved) {
            const found = readRegion(instance, drawing)
            onRegionRef.current(found, drawing.mode)
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
          // ⌥ steps to the next object along the ray, so an object inside another can be reached.
          if (event.altKey) {
            const stack = instance.raycastStack(event.clientX - box.left, event.clientY - box.top)
            if (stack.length > 1) {
              const at = current.activeObjectId ? stack.indexOf(current.activeObjectId) : -1
              const next = stack[(at + 1) % stack.length]!
              onSelectRef.current([next], next)
              return
            }
          }
          onSelectRef.current([found], found)
        }}
        onPointerCancel={() => {
          press.current = null
          region.current = null
          marquee.clear()
          modal.current?.cancel()
          navigator.current?.end()
        }}
        ref={surface}
        onContextMenu={(event) => {
          event.preventDefault()
          // ⇧ and the right button place the cursor instead; that is handled on the press.
          if (event.shiftKey || modal.current?.active) return
          onMenuRef.current({ x: event.clientX, y: event.clientY })
        }}
      />
      <SceneMarquee channel={marquee} />
      <SceneHud channel={hud} />
      {children}
    </SceneViewportHost>
  )
}

/**
 * Which objects a drawn region covers.
 *
 * A box is read straight out of the id buffer; a lasso and a circle read the buffer over the box
 * that holds them and then keep only the pixels actually inside the shape. Reading a rectangle once
 * and filtering is far cheaper than asking the graphics card a question per pixel.
 */
function readRegion(
  viewport: SceneViewport,
  region: { kind: MarqueeKind; points: Array<[number, number]>; radius: number },
): string[] {
  if (region.kind === 'box') {
    const [a, b] = region.points
    if (!a || !b) return []
    return viewport.pickRegion(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
  }
  if (region.kind === 'circle') {
    const centre = region.points[0]
    if (!centre) return []
    const radius = region.radius
    return viewport.pickRegion(centre[0] - radius, centre[1] - radius, radius * 2, radius * 2,
      (x, y) => Math.hypot(x - centre[0], y - centre[1]) <= radius)
  }
  const box = boundsOfPoints(region.points)
  if (region.points.length < 3) return []
  return viewport.pickRegion(box.x, box.y, box.width, box.height, (x, y) => insidePolygon(region.points, x, y))
}

/**
 * Where a drawn point sits in the world: on the surface under the pointer when there is one, and
 * otherwise on the plane the view is looking at. A note drawn over an object should stick to it.
 */
function pointInScene(viewport: SceneViewport, x: number, y: number): Vec3 {
  const hit = viewport.raycast(x, y)
  if (!hit) return viewport.pointOnViewPlane(x, y)
  // Lifted a hair off the surface, or the note is buried inside it by depth fighting.
  return [
    hit.point[0] + hit.normal[0] * 0.002,
    hit.point[1] + hit.normal[1] * 0.002,
    hit.point[2] + hit.normal[2] * 0.002,
  ]
}

/** The colour a fresh annotation is drawn in: the viewport's own foreground. */
function latestTheme(viewport: SceneViewport): string {
  void viewport
  return '#f2f4f3'
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
