import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Euler, Matrix4 } from 'three'
import { ModalOperator, type ModalOperatorDeps } from '@/scene/modalOperator'
import { modalSpecFor } from '@/scene/modalSpecs'
import { elementWorldPoints, loopCutPolylines } from '@/scene/toolPreview'
import { SceneToolPath } from '@/scene/SceneToolPath'
import { ToolPathChannel } from '@/scene/viewport/toolPath'
import { ModalTransform, selectionPivot } from '@/scene/modalTransform'
import { elementTargets } from '@/scene/transform/elements'
import { orientationBasis } from '@/scene/transform/orientation'
import { worldTransform } from '@/scene/objects'
import { SceneHud } from '@/scene/SceneHud'
import { SceneViewportHost } from '@/scene/SceneViewportHost'
import type { ScenePreferences } from '@/scene/prefs'
import type { TransformMode } from '@/scene/transform/session'
import type { SceneDocument, SceneObject, SceneSelection, SceneTool, SelectMode, Vec3, ViewState } from '@/scene/types'
import { HudChannel } from '@/scene/viewport/hud'
import { boundsOfPoints, insidePolygon, MarqueeChannel, type MarqueeKind } from '@/scene/viewport/marquee'
import { SceneMarquee } from '@/scene/SceneMarquee'
import { ViewNavigator } from '@/scene/viewport/navigation'
import type { ElementHits, SceneViewport, SceneViewportOptions } from '@/scene/viewport/SceneViewport'
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
  /** Opens a pointer-driven operator — an extrusion, a bevel, a loop cut. */
  beginModalOperator: (operatorId: string, extra?: { edge?: number }) => boolean
  /** The element the pointer is over in edit mode, for the tools that need one. */
  hoveredElement: () => ElementPick | null
  /** Whether the knife has a line on the go, which the status bar says. */
  knifeActive: () => boolean
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
  operatorBridge,
  onPickElement,
  onRegionElements,
  onPlaceCursor,
  onContextMenu,
  onAnnotate,
  onMeasure,
  onTransform,
  onEditDocument,
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
  /** How a pointer-driven operator previews, keeps and abandons its work. */
  operatorBridge: OperatorBridge
  /** A click on an element in edit mode, with what the modifiers asked for. */
  onPickElement: (hit: ElementPick | null, mode: ElementPickMode) => void
  /** What a box, lasso or circle covered in edit mode, per object being edited. */
  onRegionElements: (found: Map<string, ElementRegion>, mode: 'new' | 'extend' | 'subtract') => void
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
  /** The same for edit mode, where a gesture moves vertices rather than objects. */
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument) => void
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
  const press = useRef<{
    x: number
    y: number
    button: number
    moved: boolean
    navigating: boolean
    touch: boolean
    /** A ⌥ press in edit mode: an orbit if it moves, an edge loop if it does not. */
    loop?: boolean
    /** The operator a tool would open once this press turns into a drag. */
    tool?: string
  } | null>(null)
  /**
   * The fingers on the glass. Blender's touch scheme, which is also every map's: one finger turns
   * the view, two pan it and pinch it, a tap picks, and a long press is the right button.
   */
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; centre: [number, number] } | null>(null)
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hover = useRef<string | null>(null)
  const latestSelection = useRef(selection)
  latestSelection.current = selection
  const latestDocument = useRef(document)
  latestDocument.current = document
  const onViewRef = useRef(onView)
  onViewRef.current = onView
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const gestures = useRef({ onTransform, onEditDocument, onGestureStart, onGestureEnd, onGestureCancel })
  gestures.current = { onTransform, onEditDocument, onGestureStart, onGestureEnd, onGestureCancel }
  const pointer = useRef<[number, number]>([0, 0])
  const hud = useMemo(() => new HudChannel(), [])
  const marquee = useMemo(() => new MarqueeChannel(), [])
  const toolPath = useMemo(() => new ToolPathChannel(), [])
  const region = useRef<{ kind: MarqueeKind; points: Array<[number, number]>; mode: 'new' | 'extend' | 'subtract'; radius: number } | null>(null)
  const onRegionRef = useRef(onRegionSelect)
  onRegionRef.current = onRegionSelect
  const onElementRef = useRef({ onPickElement, onRegionElements })
  onElementRef.current = { onPickElement, onRegionElements }
  const hoveredElement = useRef<ElementPick | null>(null)
  const onPlaceRef = useRef(onPlaceCursor)
  onPlaceRef.current = onPlaceCursor
  const onMenuRef = useRef(onContextMenu)
  onMenuRef.current = onContextMenu
  const sketch = useRef<{ tool: 'annotate' | 'measure'; points: Vec3[] } | null>(null)
  /** The knife's line so far, in world metres, and where it would put the next point. */
  const knife = useRef<{ points: Vec3[]; next: Vec3 | null } | null>(null)
  const onDrawRef = useRef({ onAnnotate, onMeasure })
  onDrawRef.current = { onAnnotate, onMeasure }
  const bridge = useRef(operatorBridge)
  bridge.current = operatorBridge
  const modalOp = useRef<ModalOperator | null>(null)
  if (!modalOp.current) {
    modalOp.current = new ModalOperator({
      viewport: () => viewport.current,
      document: () => latestDocument.current,
      selection: () => latestSelection.current,
      hud,
      preview: (id, params, before, before2) => bridge.current.preview(id, params, before, before2),
      commit: (id, params, before, before2) => bridge.current.commit(id, params, before, before2),
      restore: (document, selection) => bridge.current.restore(document, selection),
      message: (text) => bridge.current.message(text),
      pointer: () => pointer.current,
      edgeUnder: (x, y) => viewport.current?.pickElements(x, y, ELEMENT_RADIUS).edge?.slot ?? null,
      showPreview: (lines) => {
        const instance = viewport.current
        if (!lines || lines.length === 0 || !instance) {
          toolPath.clear()
          return
        }
        // The lines arrive in world space and are drawn in the DOM, so they are projected here,
        // once per pointer move, which is the only place that knows both.
        const projected = lines
          .map((line) => line.map((point) => instance.project(point)).filter((point): point is [number, number] => point !== null))
          .filter((line) => line.length > 1)
        if (projected.length === 0) toolPath.clear()
        else toolPath.set({ kind: 'loop-cut', lines: projected })
      },
    })
  }
  const modal = useRef<ModalTransform | null>(null)
  if (!modal.current) {
    modal.current = new ModalTransform({
      viewport: () => viewport.current,
      document: () => latestDocument.current,
      selection: () => latestSelection.current,
      hud,
      overlay: () => viewport.current?.transformOverlay ?? null,
      apply: (patches) => gestures.current.onTransform(patches),
      applyDocument: (edit) => gestures.current.onEditDocument(edit),
      setProportionalSize: (size) => onViewRef.current({ ...latestDocument.current.view, proportionalSize: size }),
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
        beginModalOperator: () => false,
        hoveredElement: () => null,
        knifeActive: () => false,
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
      handleKey: (event) => {
        // The knife owns the keyboard while a line is being drawn: Enter cuts, Escape throws the
        // line away, and nothing else may run — X would delete the selection mid-cut.
        const line = knife.current
        if (line) {
          if (event.key === 'Escape') {
            knife.current = null
            toolPath.clear()
            return true
          }
          if (event.key === 'Enter' || event.key === ' ' || event.code === 'Space') {
            const points = line.points
            knife.current = null
            toolPath.clear()
            if (points.length < 2) {
              bridge.current.message('A knife cut needs at least two points.')
              return true
            }
            const error = bridge.current.commit(
              'mesh.knife',
              { path: JSON.stringify(points), cutThrough: event.shiftKey, occlude: true, midpointSnap: false, angleConstrain: false },
              latestDocument.current,
              latestSelection.current,
            )
            if (error) bridge.current.message(error)
            return true
          }
          return true
        }
        return (modalOp.current?.key(event) ?? false) || (modal.current?.key(event) ?? false)
      },
      beginModalOperator: (operatorId, extra) => {
        const document = latestDocument.current
        const spec = modalSpecFor(operatorId, {
          normal: document.view.mode === 'edit'
            ? elementTargets(document, latestSelection.current).normalBasis?.z ?? null
            : null,
          loopCutPreview: (params) => loopCutPolylines(
            latestDocument.current,
            latestSelection.current,
            Number(params.edge ?? -1),
            Number(params.cuts ?? 1),
            Number(params.factor ?? 0),
          ),
          ...(extra?.edge !== undefined ? { edge: extra.edge } : {}),
        })
        if (!spec) return false
        return modalOp.current?.begin(spec, surface.current, {}) ?? false
      },
      hoveredElement: () => hoveredElement.current,
      knifeActive: () => knife.current !== null,
      transformActive: () => (modal.current?.active ?? false) || (modalOp.current?.running ?? false),
      pointerPage: () => {
        const box = surface.current?.getBoundingClientRect()
        return box
          ? { x: box.left + pointer.current[0], y: box.top + pointer.current[1] }
          : { x: pointer.current[0], y: pointer.current[1] }
      },
    })
  }, [preferences, pump, toolPath])

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
      // Blender's Normal orientation is the frame of what is selected: only edit mode has one.
      normal: document.view.mode === 'edit' ? elementTargets(document, selection).normalBasis : null,
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
    if (longPress.current) clearTimeout(longPress.current)
    longPress.current = null
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
      // A running bevel or loop cut takes the wheel for its segments, and a running transform takes
      // it for the proportional radius; the view does not move under either.
      if (modalOp.current?.wheel(event.deltaY)) return
      if (modal.current?.wheel(event.deltaY)) return
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
          /*
           * ⌥ and the left button orbit, for a mouse with no middle button — and in edit mode they
           * are also how Blender takes an edge loop. Both are kept, told apart by whether the
           * pointer moved: a ⌥ drag turns the view, and a ⌥ press that stays still takes the loop.
           * Anything else would mean choosing between orbiting on a trackpad and loop select, and
           * neither is one a modelling editor can do without.
           */
          const takingALoop = latestDocument.current.view.mode === 'edit'
            && event.button === 0
            && event.altKey
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
          const touch = event.pointerType === 'touch'
          if (touch) {
            touches.current.set(event.pointerId, { x, y })
            if (touches.current.size === 2) {
              // The second finger takes over: whatever the first one had started is abandoned.
              press.current = null
              nav.end()
              const [a, b] = [...touches.current.values()]
              pinch.current = {
                distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
                centre: [(a!.x + b!.x) / 2, (a!.y + b!.y) / 2],
              }
              if (longPress.current) clearTimeout(longPress.current)
              longPress.current = null
              event.currentTarget.setPointerCapture(event.pointerId)
              return
            }
            if (touches.current.size > 2) return
            // A press held still is the right button, which is how a menu is reached with no mouse.
            if (longPress.current) clearTimeout(longPress.current)
            longPress.current = setTimeout(() => {
              longPress.current = null
              if (press.current?.moved) return
              press.current = null
              onMenuRef.current({ x: event.clientX, y: event.clientY })
            }, 500)
          }
          press.current = { x, y, button: event.button, moved: false, navigating: !!gesture, touch, loop: takingALoop }
          try {
            // A synthetic press — a QA script, an assistive device — may arrive without a live
            // pointer to capture, and refusing to capture one is not a reason to drop the gesture.
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            /* The gesture runs uncaptured: it ends at the edge of the viewport instead of beyond it. */
          }
          if (gesture) {
            event.preventDefault()
            nav.begin(gesture, event.pointerId, x, y)
            return
          }
          /*
           * A tool in the T bar is the same operator its key runs, opened by a *drag* rather than by
           * the press: choosing Extrude and dragging is E, and the F9 panel afterwards says so. It
           * waits for the movement on purpose — a plain click with a tool held still selects, as it
           * does in Blender, and an extrusion of nothing would leave a duplicate nobody asked for.
           */
          if (event.button === 0 && latestDocument.current.view.mode === 'edit') {
            const operatorId = TOOL_OPERATORS[latestDocument.current.view.tool]
            if (operatorId) {
              press.current = { x, y, button: event.button, moved: false, navigating: false, touch, tool: operatorId }
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                /* An uncaptured gesture ends at the edge of the viewport instead of beyond it. */
              }
              return
            }
          }
          // The knife places a point where the pointer is, snapped to whatever it is over.
          if (event.button === 0 && latestDocument.current.view.mode === 'edit' && latestDocument.current.view.tool === 'knife') {
            event.preventDefault()
            const found = knifePoint(instance, latestDocument.current, x, y, { shift: event.shiftKey, ctrl: event.ctrlKey })
            const line = knife.current ?? { points: [], next: null }
            line.points = [...line.points, found.world]
            line.next = found.world
            knife.current = line
            drawKnife(instance, line, found, toolPath)
            press.current = null
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
          const waiting = press.current
          if (waiting?.tool && !waiting.moved && Math.hypot(x - waiting.x, y - waiting.y) > threshold()) {
            waiting.moved = true
            const spec = modalSpecFor(waiting.tool, {
              normal: elementTargets(latestDocument.current, latestSelection.current).normalBasis?.z ?? null,
              loopCutPreview: (params) => loopCutPolylines(
                latestDocument.current,
                latestSelection.current,
                Number(params.edge ?? -1),
                Number(params.cuts ?? 1),
                Number(params.factor ?? 0),
              ),
            })
            if (spec) modalOp.current?.begin(spec, surface.current, { pointer: [waiting.x, waiting.y], fromDrag: true })
          }
          const gesture = modalOp.current
          if (gesture?.running) {
            gesture.move({ x, y, dx: event.nativeEvent.movementX, dy: event.nativeEvent.movementY, shift: event.shiftKey })
            return
          }
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
          // Two fingers pan and pinch; that is the whole of it, and it never selects anything.
          if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
            touches.current.set(event.pointerId, { x, y })
            const held = pinch.current
            if (held && touches.current.size === 2) {
              const [a, b] = [...touches.current.values()]
              const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
              const centre: [number, number] = [(a!.x + b!.x) / 2, (a!.y + b!.y) / 2]
              nav.pan(centre[0] - held.centre[0], centre[1] - held.centre[1])
              if (held.distance > 1 && distance > 1) nav.zoomBy((held.distance - distance) * 6)
              pinch.current = { distance, centre }
              pump()
              return
            }
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
            if (!held.moved && Math.hypot(x - held.x, y - held.y) > threshold()) {
              held.moved = true
              // One finger past the threshold turns the view; under it, it was a tap, and taps pick.
              if (held.touch && !held.navigating) {
                if (longPress.current) clearTimeout(longPress.current)
                longPress.current = null
                held.navigating = true
                nav.begin('orbit', event.pointerId, held.x, held.y)
              }
            }
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
          const drawing = knife.current
          if (drawing) {
            const found = knifePoint(instance, latestDocument.current, x, y, { shift: event.shiftKey, ctrl: event.ctrlKey })
            drawing.next = found.world
            drawKnife(instance, drawing, found, toolPath)
            return
          }
          if (latestDocument.current.view.mode === 'edit') {
            // In edit mode the pointer is over elements, not objects: one read of the id buffer
            // answers for all three kinds and the priority picks between them.
            const chosen = chooseElement(instance.pickElements(x, y, ELEMENT_RADIUS), latestDocument.current.view.selectMode)
            hoveredElement.current = chosen
            if (instance.setElementHover(chosen)) instance.invalidate()
            if (hover.current !== null) {
              hover.current = null
              instance.setHover(null)
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
          if (event.pointerType === 'touch') {
            touches.current.delete(event.pointerId)
            if (touches.current.size < 2) pinch.current = null
            if (longPress.current) clearTimeout(longPress.current)
            longPress.current = null
          }
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
          // A click keeps a running gesture, whichever button opened it; the right button throws
          // it away, which is handled where the context menu is.
          if (modalOp.current?.running && event.button === 0) {
            modalOp.current.confirm()
            return
          }
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
            // A ⌥ press that never moved was not an orbit: it was a loop select waiting to happen.
            if (!held.loop || held.moved) return
          }
          const drawing = region.current
          region.current = null
          marquee.clear()
          if (drawing && held.moved) {
            if (latestDocument.current.view.mode === 'edit') {
              onElementRef.current.onRegionElements(readElementRegion(instance, drawing), drawing.mode)
              return
            }
            const found = readRegion(instance, drawing)
            onRegionRef.current(found, drawing.mode)
            return
          }
          if (held.moved || held.button !== 0) return
          const box = event.currentTarget.getBoundingClientRect()

          if (latestDocument.current.view.mode === 'edit') {
            const hits = instance.pickElements(event.clientX - box.left, event.clientY - box.top, ELEMENT_RADIUS)
            const mode: ElementPickMode = event.altKey && event.ctrlKey
              ? 'ring'
              : event.altKey ? 'loop' : event.ctrlKey ? 'path' : event.shiftKey ? 'toggle' : 'new'
            // A loop and a ring are always about an edge, whichever kind is being selected: that is
            // how ⌥ click takes a loop of vertices while the editor is in vertex mode.
            const chosen = mode === 'loop' || mode === 'ring'
              ? (hits.edge ? { objectId: hits.edge.objectId, kind: 'edge' as const, slot: hits.edge.slot } : null)
              : chooseElement(hits, latestDocument.current.view.selectMode)
            if (!chosen && mode === 'new' && !preferences.deselectOnEmptyClick) return
            onElementRef.current.onPickElement(chosen, mode)
            return
          }
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
        onPointerCancel={(event) => {
          touches.current.delete(event.pointerId)
          pinch.current = null
          if (longPress.current) clearTimeout(longPress.current)
          longPress.current = null
          press.current = null
          region.current = null
          marquee.clear()
          modal.current?.cancel()
          navigator.current?.end()
        }}
        ref={surface}
        onContextMenu={(event) => {
          event.preventDefault()
          // The right button ends the knife's line and cuts with it, as Blender's does.
          if (knife.current) {
            const points = knife.current.points
            knife.current = null
            toolPath.clear()
            if (points.length >= 2) {
              const error = bridge.current.commit(
                'mesh.knife',
                { path: JSON.stringify(points), cutThrough: false, occlude: true, midpointSnap: false, angleConstrain: false },
                latestDocument.current,
                latestSelection.current,
              )
              if (error) bridge.current.message(error)
            }
            return
          }
          // The right button abandons a running gesture, as Blender's does, and asks for nothing.
          if (modalOp.current?.running) {
            modalOp.current.cancel()
            return
          }
          // ⇧ and the right button place the cursor instead; that is handled on the press.
          if (event.shiftKey || modal.current?.active) return
          onMenuRef.current({ x: event.clientX, y: event.clientY })
        }}
      />
      <SceneMarquee channel={marquee} />
      <SceneToolPath channel={toolPath} />
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
/** How a pointer-driven operator reaches the document: preview, keep, abandon, and say why not. */
export type OperatorBridge = {
  preview: ModalOperatorDeps['preview']
  commit: ModalOperatorDeps['commit']
  restore: ModalOperatorDeps['restore']
  message: ModalOperatorDeps['message']
}

/** What a click in edit mode landed on, and what the modifiers asked to be done with it. */
export type ElementPick = { objectId: string; kind: SelectMode; slot: number }
export type ElementPickMode = 'new' | 'extend' | 'toggle' | 'loop' | 'ring' | 'path'
export type ElementRegion = { vertices: Set<number>; edges: Set<number>; faces: Set<number> }

/**
 * Which operator each edit-mode tool is the interactive half of.
 *
 * The tools that draw a line rather than drag a number — the knife, bisect, poly build — are not
 * here: they take the press themselves, because a click of theirs places a point rather than
 * opening a gesture.
 */
const TOOL_OPERATORS: Partial<Record<SceneTool, string>> = {
  extrude: 'mesh.extrudeRegion',
  inset: 'mesh.inset',
  bevel: 'mesh.bevelEdges',
  'loop-cut': 'mesh.loopCut',
  spin: 'mesh.spin',
  smooth: 'mesh.smoothVertices',
  'edge-slide': 'mesh.edgeSlide',
  'shrink-fatten': 'mesh.shrinkFatten',
  shear: 'mesh.shear',
  rip: 'mesh.rip',
}

/** How far from the pointer an element is still worth picking, in CSS pixels. Blender's is ten. */
const ELEMENT_RADIUS = 10

/**
 * Blender's priority: a vertex beats an edge beats a face, within the radius, and only among the
 * kinds being selected. It is a priority rather than a plain nearest-wins because a vertex sits on
 * top of both the edges that meet at it — nearest alone would make a corner unreachable.
 */
function chooseElement(hits: ElementHits, modes: SelectMode[]): ElementPick | null {
  const order: SelectMode[] = ['vertex', 'edge', 'face']
  for (const kind of order) {
    if (!modes.includes(kind)) continue
    const hit = hits[kind]
    if (hit) return { objectId: hit.objectId, kind, slot: hit.slot }
  }
  return null
}

/**
 * Where the knife would put a point, and whether it is snapping to something.
 *
 * Blender snaps to the vertices and the edges the line passes over, and holding shift turns that
 * off. It matters more than it looks: a cut that lands a hair off a vertex leaves two vertices
 * where there should be one, and the crack it opens is invisible until something else fails.
 */
function knifePoint(
  viewport: SceneViewport,
  document: SceneDocument,
  x: number,
  y: number,
  modifiers: { shift: boolean; ctrl: boolean },
): { world: Vec3; screen: [number, number]; snapped: boolean } {
  const free = { world: viewport.pointOnViewPlane(x, y), screen: [x, y] as [number, number], snapped: false }
  if (modifiers.shift) return free
  const hits = viewport.pickElements(x, y, ELEMENT_RADIUS)
  if (hits.vertex) {
    const [point] = elementWorldPoints(document, hits.vertex.objectId, 'vertex', hits.vertex.slot)
    const screen = point ? viewport.project(point) : null
    if (point && screen) return { world: point, screen, snapped: true }
  }
  if (hits.edge) {
    const ends = elementWorldPoints(document, hits.edge.objectId, 'edge', hits.edge.slot)
    const a = ends[0]
    const b = ends[1]
    const first = a ? viewport.project(a) : null
    const second = b ? viewport.project(b) : null
    if (a && b && first && second) {
      // ⌃ takes the middle of the edge; otherwise the point nearest the pointer along it.
      const along = modifiers.ctrl ? 0.5 : closestOnSegment(first, second, [x, y])
      const world: Vec3 = [
        a[0] + (b[0] - a[0]) * along,
        a[1] + (b[1] - a[1]) * along,
        a[2] + (b[2] - a[2]) * along,
      ]
      const screen = viewport.project(world)
      if (screen) return { world, screen, snapped: true }
    }
  }
  return free
}

/** The knife's line as it stands, projected and handed to the overlay. */
function drawKnife(
  viewport: SceneViewport,
  line: { points: Vec3[]; next: Vec3 | null },
  found: { screen: [number, number]; snapped: boolean },
  channel: ToolPathChannel,
): void {
  const placed = line.points
    .map((point) => viewport.project(point))
    .filter((point): point is [number, number] => point !== null)
  const path = line.next ? [...placed, found.screen] : placed
  channel.set({
    kind: 'knife',
    lines: path.length > 1 ? [path] : [],
    placed,
    snap: found.snapped ? found.screen : null,
  })
}

/** How far along a screen segment the nearest point to a pointer is, from 0 to 1. */
function closestOnSegment(a: [number, number], b: [number, number], point: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  if (length < 1e-9) return 0
  return Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length))
}

function readElementRegion(
  viewport: SceneViewport,
  region: { kind: MarqueeKind; points: Array<[number, number]>; radius: number },
): Map<string, ElementRegion> {
  if (region.kind === 'box') {
    const [a, b] = region.points
    if (!a || !b) return new Map()
    return viewport.pickElementRegion(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
  }
  if (region.kind === 'circle') {
    const centre = region.points[0]
    if (!centre) return new Map()
    const radius = region.radius
    return viewport.pickElementRegion(centre[0] - radius, centre[1] - radius, radius * 2, radius * 2,
      (x, y) => Math.hypot(x - centre[0], y - centre[1]) <= radius)
  }
  if (region.points.length < 3) return new Map()
  const box = boundsOfPoints(region.points)
  return viewport.pickElementRegion(box.x, box.y, box.width, box.height, (x, y) => insidePolygon(region.points, x, y))
}

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
